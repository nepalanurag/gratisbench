// Pure PDF-to-Word logic shared by the browser tool and the Node verification script.
// No DOM access here. The browser glue supplies pdf.js text-content items and PNG
// bytes; this module groups text into paragraphs, detects headings, and assembles
// a .docx with the `docx` library (a .docx is just a zip of XML files).
//
// Honest scope: this extracts text and embedded images into an editable Word
// document. Complex layouts, tables, and multi-column designs are NOT preserved.

import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } from 'docx';

/** The shape pdf.js text-content items have; we only read these fields. */
export interface TextItemLike {
  str: string;
  transform: number[]; // [a, b, c, d, e, f]
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface TextLine {
  text: string;
  x: number; // left edge, PDF points
  y: number; // baseline y, PDF points (y-up)
  height: number;
  fontSize: number;
  bold: boolean;
}

export type BlockKind = 'h1' | 'h2' | 'h3' | 'p';

export interface TextBlock {
  kind: BlockKind;
  text: string;
  y: number; // y of the block's first line, PDF points (y-up)
}

/** An embedded image extracted from a page, as PNG bytes. */
export interface PageImage {
  data: Uint8Array;
  widthPx: number;
  heightPx: number;
  x: number; // lower-left corner, PDF points (y-up)
  y: number;
}

export interface DocPage {
  pageIndex: number;
  blocks: TextBlock[];
  images: PageImage[];
  textChars: number;
}

const HEADING_H1_RATIO = 1.7;
const HEADING_H2_RATIO = 1.35;
const HEADING_H3_RATIO = 1.2;
const HEADING_MAX_CHARS = 220;
const BOLD_HEADING_MAX_CHARS = 80;

/** Font size from a pdf.js text transform: |scale| of the x basis vector. */
export function fontSizeOf(item: TextItemLike): number {
  const t = item.transform;
  if (!t || t.length < 6) return 0;
  return Math.hypot(t[0], t[1]);
}

function baseY(item: TextItemLike): number {
  return item.transform && item.transform.length >= 6 ? item.transform[5] : 0;
}

function leftX(item: TextItemLike): number {
  return item.transform && item.transform.length >= 6 ? item.transform[4] : 0;
}

function isBoldFont(fontName: string | undefined): boolean {
  return /bold|black|heavy|demi|extra-bold/i.test(fontName ?? '');
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Group raw pdf.js text items into visual lines: items sharing a baseline
 * (within tolerance) belong to one line; within a line, items sort left to
 * right and a space is inserted when the horizontal gap is wide enough that
 * the PDF clearly intended a word break.
 */
export function groupItemsIntoLines(items: TextItemLike[]): TextLine[] {
  const usable = items.filter((it) => it.str !== '' && it.str !== '\n');
  const sorted = [...usable].sort((a, b) => {
    const dy = baseY(b) - baseY(a);
    if (Math.abs(dy) > 0.001) return dy;
    return leftX(a) - leftX(b);
  });

  const groups: TextItemLike[][] = [];
  for (const it of sorted) {
    const y = baseY(it);
    const last = groups[groups.length - 1];
    const lastY = last ? baseY(last[0]) : 0;
    const tol = Math.max(2.5, it.height * 0.4, last ? last[0].height * 0.4 : 0);
    if (last && Math.abs(y - lastY) <= tol) {
      last.push(it);
    } else {
      groups.push([it]);
    }
  }

  return groups.map((group) => {
    const byX = [...group].sort((a, b) => leftX(a) - leftX(b));
    let chars = 0;
    let widthSum = 0;
    for (const it of byX) {
      chars += it.str.replace(/\s/g, '').length;
      widthSum += it.width;
    }
    const avgChar = chars > 0 ? widthSum / chars : 6;

    let text = '';
    let prevEnd = -Infinity;
    for (const it of byX) {
      const x = leftX(it);
      if (text.length > 0) {
        const gap = x - prevEnd;
        const needSpace = gap > avgChar * 0.35 && !text.endsWith(' ') && !it.str.startsWith(' ');
        if (needSpace) text += ' ';
      }
      text += it.str;
      prevEnd = x + it.width;
    }

    const sizes = byX.map(fontSizeOf).filter((s) => s > 0);
    let boldChars = 0;
    let totalChars = 0;
    for (const it of byX) {
      const n = it.str.replace(/\s/g, '').length;
      totalChars += n;
      if (isBoldFont(it.fontName)) boldChars += n;
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      x: Math.min(...byX.map(leftX)),
      y: baseY(byX[0]),
      height: Math.max(...byX.map((it) => it.height)),
      fontSize: sizes.length ? median(sizes) : 0,
      bold: totalChars > 0 && boldChars / totalChars >= 0.6,
    };
  });
}

function lineSize(lines: TextLine[]): number {
  // Character-weighted median size so a short big line cannot dominate.
  const pool: number[] = [];
  for (const l of lines) {
    const n = Math.min(Math.max(l.text.length, 1), 40);
    for (let i = 0; i < n; i++) pool.push(l.fontSize);
  }
  return median(pool);
}

function classifyParagraph(lines: TextLine[], bodySize: number): BlockKind {
  const text = lines.map((l) => l.text).join(' ');
  if (text.length === 0 || text.length > HEADING_MAX_CHARS) return 'p';
  const size = lineSize(lines);
  if (size <= 0 || bodySize <= 0) return 'p';
  const ratio = size / bodySize;
  const bold = lines.every((l) => l.bold);
  if (ratio >= HEADING_H1_RATIO) return 'h1';
  if (ratio >= HEADING_H2_RATIO) return 'h2';
  if (ratio >= HEADING_H3_RATIO) return 'h3';
  if (bold && text.length <= BOLD_HEADING_MAX_CHARS && ratio >= 1.05) return 'h3';
  return 'p';
}

/**
 * Turn per-page lines into per-page paragraph blocks with heading levels.
 * Paragraph breaks come from vertical gaps clearly larger than the page's
 * normal line spacing. Heading sizes are judged against the document-wide
 * body size (character-weighted median), so a document set entirely in one
 * large size does not turn every paragraph into a heading.
 */
export function linesToBlocks(pagesLines: TextLine[][]): TextBlock[][] {
  const allSizes: number[] = [];
  for (const lines of pagesLines) {
    for (const l of lines) {
      const n = Math.min(Math.max(l.text.length, 1), 40);
      for (let i = 0; i < n; i++) allSizes.push(l.fontSize);
    }
  }
  const sized = allSizes.filter((s) => s > 0);
  const bodySize = sized.length ? median(sized) : 12;

  return pagesLines.map((pageLines) => {
    const sorted = [...pageLines].sort((a, b) => b.y - a.y);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i - 1].y - sorted[i].y);
    const medGap = gaps.length ? median(gaps) : bodySize * 1.2;
    const breakAt = Math.max(medGap * 1.6, bodySize * 1.4);

    const blocks: TextBlock[] = [];
    let current: TextLine[] = [];
    const flush = () => {
      if (current.length === 0) return;
      const text = current
        .map((l) => l.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 0) {
        blocks.push({ kind: classifyParagraph(current, bodySize), text, y: current[0].y });
      }
      current = [];
    };
    sorted.forEach((line, i) => {
      if (i > 0 && sorted[i - 1].y - line.y > breakAt) flush();
      current.push(line);
    });
    flush();
    return blocks;
  });
}

export type ContentItem = { type: 'block'; block: TextBlock } | { type: 'image'; image: PageImage };

/** Interleave a page's text blocks and images in top-to-bottom reading order. */
export function orderPageContent(page: DocPage): ContentItem[] {
  const items: ContentItem[] = [
    ...page.blocks.map((block) => ({ type: 'block' as const, block })),
    ...page.images.map((image) => ({ type: 'image' as const, image })),
  ];
  items.sort((a, b) => {
    const ya = a.type === 'block' ? a.block.y : a.image.y;
    const yb = b.type === 'block' ? b.block.y : b.image.y;
    return yb - ya;
  });
  return items;
}

/** Longest image edge allowed inside the .docx, in CSS pixels (96 dpi). */
export const DOCX_IMAGE_MAX_PX = 576; // 6 inches

function imageRunSize(img: PageImage): { width: number; height: number } {
  const scale = Math.min(1, DOCX_IMAGE_MAX_PX / Math.max(img.widthPx, img.heightPx, 1));
  return {
    width: Math.max(1, Math.round(img.widthPx * scale)),
    height: Math.max(1, Math.round(img.heightPx * scale)),
  };
}

function headingLevel(kind: BlockKind): (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined {
  if (kind === 'h1') return HeadingLevel.HEADING_1;
  if (kind === 'h2') return HeadingLevel.HEADING_2;
  if (kind === 'h3') return HeadingLevel.HEADING_3;
  return undefined;
}

/**
 * Assemble the .docx bytes. Blocks and images are interleaved in reading
 * order per page; headings get real Word heading styles, body text gets the
 * Normal style, images are embedded inline in their own paragraphs.
 */
export async function assembleDocx(pages: DocPage[], title = 'Converted document'): Promise<Uint8Array> {
  const children: Paragraph[] = [];
  let emitted = 0;
  for (const page of pages) {
    for (const item of orderPageContent(page)) {
      if (item.type === 'block') {
        const b = item.block;
        children.push(
          new Paragraph({
            heading: headingLevel(b.kind),
            children: [new TextRun(b.text)],
          })
        );
        emitted++;
      } else {
        const img = item.image;
        const { width, height } = imageRunSize(img);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: img.data,
                transformation: { width, height },
                type: 'png',
              }),
            ],
          })
        );
        emitted++;
      }
    }
  }
  if (emitted === 0) {
    throw new Error('No extractable text or images were found in this PDF.');
  }
  const doc = new Document({
    title,
    creator: 'FreeKit PDF to Word',
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

/** Friendly output file name: "report.pdf" -> "report.docx". */
export function docxFileName(pdfName: string): string {
  const stem = pdfName.replace(/\.pdf$/i, '').trim() || 'document';
  return `${stem}.docx`;
}
