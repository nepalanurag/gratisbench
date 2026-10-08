// Smart-split helpers for the Split PDF tool: bookmarks (chapters) and text.
// pdf.js reads the document outline; pdf-lib (via pdf-core) builds the parts.
// Pure logic + thin pdf.js glue. No DOM.
import { extractPages } from './pdf-core.ts';

/** Minimal shape of a pdf.js document: just the outline and destination APIs we use. */
export interface OutlineCapableDoc {
  numPages: number;
  getOutline(): Promise<Array<OutlineNode> | null | undefined>;
  getDestination(dest: unknown): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

export interface OutlineNode {
  title?: string;
  dest?: unknown;
  items?: OutlineNode[];
}

export interface BookmarkChapter {
  title: string;
  /** 1-based page numbers, inclusive. */
  startPage: number;
  endPage: number;
}

export interface SplitPartOut {
  name: string;
  data: Uint8Array;
  meta: string;
}

interface FlatBookmark {
  title: string;
  pageIndex: number; // 0-based
  depth: number;
}

/** Make a bookmark title safe for a filename. */
export function sanitizeChapterName(title: string, fallback: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

async function resolvePageIndex(doc: OutlineCapableDoc, dest: unknown): Promise<number | null> {
  try {
    if (dest == null) return null;
    const explicit = await doc.getDestination(dest);
    if (!explicit || explicit.length === 0) return null;
    const ref = explicit[0] as unknown;
    if (typeof ref === 'number') {
      // Some outlines point at a page number directly (0-based in pdf.js).
      return ref >= 0 && ref < doc.numPages ? ref : null;
    }
    const idx = await doc.getPageIndex(ref);
    return idx >= 0 && idx < doc.numPages ? idx : null;
  } catch {
    return null;
  }
}

/**
 * Flatten the document outline (bookmarks) in reading order.
 * Items that do not point at a page (e.g. "open a URL" links) are skipped.
 */
export async function getFlatBookmarks(doc: OutlineCapableDoc): Promise<FlatBookmark[]> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline || outline.length === 0) return [];
  const flat: FlatBookmark[] = [];
  const walk = async (nodes: OutlineNode[], depth: number): Promise<void> => {
    for (const node of nodes) {
      const idx = await resolvePageIndex(doc, node.dest);
      const title = (node.title || '').trim();
      if (idx != null && title) flat.push({ title, pageIndex: idx, depth });
      if (node.items && node.items.length > 0) await walk(node.items, depth + 1);
    }
  };
  await walk(outline, 0);
  // Keep reading order even if the outline lists things out of order.
  flat.sort((a, b) => a.pageIndex - b.pageIndex);
  return flat;
}

/**
 * Group top-level bookmarks into chapters: each top-level bookmark starts a
 * new part that runs until the next top-level bookmark begins.
 */
export function bookmarksToChapters(flat: FlatBookmark[], pageCount: number): BookmarkChapter[] {
  const tops = flat.filter((b) => b.depth === 0);
  if (tops.length < 1) return [];
  const chapters: BookmarkChapter[] = [];
  tops.forEach((bm, i) => {
    const startPage = bm.pageIndex + 1;
    const nextStart = i + 1 < tops.length ? tops[i + 1].pageIndex + 1 : pageCount + 1;
    if (nextStart > startPage) {
      chapters.push({ title: bm.title, startPage, endPage: nextStart - 1 });
    }
  });
  return chapters;
}

/** Split the PDF into one file per chapter. Names come from the bookmark titles. */
export async function splitByBookmarks(
  buffer: Uint8Array,
  chapters: BookmarkChapter[],
  stem: string
): Promise<SplitPartOut[]> {
  const parts: SplitPartOut[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const pages: number[] = [];
    for (let p = ch.startPage; p <= ch.endPage; p++) pages.push(p);
    const data = await extractPages(buffer, pages);
    const name = `${stem}-${sanitizeChapterName(ch.title, `chapter-${i + 1}`)}.pdf`;
    const pageLabel = ch.startPage === ch.endPage ? `page ${ch.startPage}` : `pages ${ch.startPage}-${ch.endPage}`;
    parts.push({ name, data, meta: `${pageLabel}` });
  }
  return parts;
}

/**
 * Find 1-based pages whose text contains the query (case-insensitive).
 * Returns at most MAX_SEARCH_PAGES pages of results for responsiveness.
 */
export async function findTextSplitPages(
  doc: {
    numPages: number;
    getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
  },
  query: string
): Promise<number[]> {
  const q = query.trim().toLowerCase();
  if (!q) throw new Error('Type the words to split on, for example "Invoice".');
  const total = Math.min(doc.numPages, 500);
  const hits: number[] = [];
  for (let p = 1; p <= total; p++) {
    const page = await doc.getPage(p);
    try {
      const tc = await page.getTextContent();
      const text = tc.items
        .map((it) => {
          if (typeof it === 'object' && it !== null && 'str' in it) {
            const s = (it as { str?: unknown }).str;
            return typeof s === 'string' ? s : '';
          }
          return '';
        })
        .join(' ')
        .toLowerCase();
      if (text.includes(q)) hits.push(p);
    } finally {
      // @ts-expect-error pdf.js pages expose cleanup; the structural type omits it.
      if (typeof page.cleanup === 'function') page.cleanup();
    }
    if (p % 25 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return hits;
}

/**
 * Split at each hit page: the part before the first hit becomes "before",
 * then each hit starts a new part running to the next hit.
 */
export async function splitByText(
  buffer: Uint8Array,
  pageCount: number,
  hitPages: number[],
  query: string,
  stem: string
): Promise<SplitPartOut[]> {
  const starts = [1, ...hitPages.filter((p) => p > 1)];
  const unique = [...new Set(starts)].sort((a, b) => a - b);
  const parts: SplitPartOut[] = [];
  for (let i = 0; i < unique.length; i++) {
    const start = unique[i];
    const end = i + 1 < unique.length ? unique[i + 1] - 1 : pageCount;
    if (end < start) continue;
    const pages: number[] = [];
    for (let p = start; p <= end; p++) pages.push(p);
    const data = await extractPages(buffer, pages);
    const label = i === 0 && start === 1 ? 'before' : `from-page-${start}`;
    const name = `${stem}-${label}-${sanitizeChapterName(query, 'split')}.pdf`.replace(/-+/g, '-');
    parts.push({ name, data, meta: start === end ? `page ${start}` : `pages ${start}-${end}` });
  }
  return parts;
}
