// Pure PDF logic shared by the browser tools and the Node verification script.
// No DOM access here — everything takes Uint8Array in and returns Uint8Array.
import { PDFDocument } from 'pdf-lib';

export interface SplitPart {
  name: string;
  data: Uint8Array;
}

export interface PdfImage {
  /** Raw file bytes. */
  data: Uint8Array;
  /** 'image/png' or 'image/jpeg'. Other formats must be converted to PNG first. */
  mime: string;
}

export type PageSizeOption = 'fit' | 'a4' | 'letter';

/**
 * Merge PDF files into one, in the given order. Pages are copied as-is
 * (no re-rendering), so quality and text selection are preserved.
 */
export async function mergePdfs(buffers: Uint8Array[]): Promise<Uint8Array> {
  if (buffers.length === 0) {
    throw new Error('Add at least one PDF file to merge.');
  }
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: false });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return out.save();
}

/**
 * Parse a page-range expression like "1-3, 5" into zero-based page indices.
 * Throws a human-readable error for anything it cannot understand.
 */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const picked = new Set<number>();
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length === 0) {
    throw new Error('Enter at least one page or range, for example "1-3, 5".');
  }

  const addPage = (p: number) => {
    if (!Number.isInteger(p) || p < 1 || p > pageCount) {
      throw new Error(
        `Page ${p} is out of range. This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`
      );
    }
    picked.add(p - 1);
  };

  for (const part of parts) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let a = parseInt(range[1], 10);
      let b = parseInt(range[2], 10);
      if (a > b) [a, b] = [b, a]; // accept "5-3" as "3-5"
      if (b - a > 10000) {
        throw new Error(`Range "${part}" is too large.`);
      }
      for (let p = a; p <= b; p++) addPage(p);
      continue;
    }
    if (/^\d+$/.test(part)) {
      addPage(parseInt(part, 10));
      continue;
    }
    throw new Error(`Could not understand "${part}". Use page numbers and ranges like "1-3, 5".`);
  }

  return [...picked].sort((x, y) => x - y);
}

export const MAX_SPLIT_GROUPS = 50;

/**
 * Split a PDF according to a spec. Commas group pages into one file;
 * semicolons start a new output file. Example: "1-3; 4-6; 9" -> 3 PDFs.
 */
export async function splitPdf(buffer: Uint8Array, spec: string): Promise<SplitPart[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: false });
  const pageCount = src.getPageCount();

  const groups = spec
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (groups.length === 0) {
    throw new Error('Enter page ranges to extract, for example "1-3; 4-6".');
  }
  if (groups.length > MAX_SPLIT_GROUPS) {
    throw new Error(`Too many output files. Keep it to ${MAX_SPLIT_GROUPS} or fewer groups.`);
  }

  const results: SplitPart[] = [];
  for (let i = 0; i < groups.length; i++) {
    const indices = parsePageRanges(groups[i], pageCount);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    for (const page of pages) out.addPage(page);
    results.push({
      name: groups.length === 1 ? 'split.pdf' : `split-part-${i + 1}.pdf`,
      data: await out.save(),
    });
  }
  return results;
}

/**
 * One-click "split every page": one output PDF per page.
 * Names are split-page-1.pdf, split-page-2.pdf, ... so the UI can re-stem them.
 */
export async function splitEveryPage(buffer: Uint8Array): Promise<SplitPart[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: false });
  const pageCount = src.getPageCount();
  if (pageCount > MAX_SPLIT_GROUPS) {
    throw new Error(
      `This PDF has ${pageCount} pages. Splitting every page is capped at ${MAX_SPLIT_GROUPS} files per run; use "every N pages" for bigger documents.`
    );
  }
  const results: SplitPart[] = [];
  for (let i = 0; i < pageCount; i++) {
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(src, [i]);
    out.addPage(page);
    results.push({ name: `split-page-${i + 1}.pdf`, data: await out.save() });
  }
  return results;
}

/**
 * Chunk a PDF into fixed-size groups of N pages: pages 1-N, N+1-2N, ...
 * The last group holds whatever remains.
 */
export async function splitEveryNPages(buffer: Uint8Array, n: number): Promise<SplitPart[]> {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('Pages per file must be a whole number of 1 or more.');
  }
  if (n > MAX_SPLIT_GROUPS) {
    throw new Error(`Pages per file is capped at ${MAX_SPLIT_GROUPS}.`);
  }
  const src = await PDFDocument.load(buffer, { ignoreEncryption: false });
  const pageCount = src.getPageCount();
  const groupCount = Math.ceil(pageCount / n);
  if (groupCount > MAX_SPLIT_GROUPS) {
    throw new Error(
      `That would make ${groupCount} files. Keep it to ${MAX_SPLIT_GROUPS} or fewer; use a bigger chunk size.`
    );
  }
  const results: SplitPart[] = [];
  for (let g = 0; g < groupCount; g++) {
    const indices: number[] = [];
    for (let i = g * n; i < Math.min((g + 1) * n, pageCount); i++) indices.push(i);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indices);
    for (const page of pages) out.addPage(page);
    results.push({
      name: groupCount === 1 ? 'split.pdf' : `split-part-${g + 1}.pdf`,
      data: await out.save(),
    });
  }
  return results;
}

const A4: [number, number] = [595.28, 841.89]; // points
const LETTER: [number, number] = [612, 792];
const MARGIN = 36; // 0.5 inch

/**
 * Pack images into a PDF, one image per page.
 * - 'fit': each page is exactly the image size (no scaling, no margins).
 * - 'a4' / 'letter': image is scaled to fit the page with a 0.5in margin.
 */
export async function imagesToPdf(
  images: PdfImage[],
  pageSize: PageSizeOption
): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new Error('Add at least one image.');
  }
  const doc = await PDFDocument.create();

  for (const img of images) {
    const embedded =
      img.mime === 'image/png' ? await doc.embedPng(img.data) : await doc.embedJpg(img.data);
    const iw = embedded.width;
    const ih = embedded.height;

    if (pageSize === 'fit') {
      const page = doc.addPage([iw, ih]);
      page.drawImage(embedded, { x: 0, y: 0, width: iw, height: ih });
      continue;
    }

    const [pw, ph] = pageSize === 'a4' ? A4 : LETTER;
    const page = doc.addPage([pw, ph]);
    const maxW = pw - MARGIN * 2;
    const maxH = ph - MARGIN * 2;
    const scale = Math.min(maxW / iw, maxH / ih);
    const w = iw * scale;
    const h = ih * scale;
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }

  return doc.save();
}

/** Return the page count of a PDF buffer. Used by the UI to show info. */
export async function getPageCount(buffer: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  return doc.getPageCount();
}

/**
 * Bake a PDF's form fields into the page content so they can no longer be
 * edited. The filled values stay visible; the fields themselves are gone.
 */
export async function flattenPdf(buffer: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  let form;
  try {
    form = doc.getForm();
  } catch {
    throw new Error('This PDF has no form fields. There is nothing to flatten.');
  }
  if (form.getFields().length === 0) {
    throw new Error('This PDF has no form fields. There is nothing to flatten.');
  }
  form.updateFieldAppearances();
  form.flatten();
  return doc.save();
}

/**
 * Attempt to repair a damaged PDF: load it and re-save it, which rebuilds
 * the file's internal structure. This fixes some damaged files and not
 * others; a file that still cannot be read is likely beyond repair.
 */
export async function repairPdf(buffer: Uint8Array): Promise<Uint8Array> {
  let doc;
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  } catch {
    try {
      doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    } catch {
      throw new Error(
        'This file could not be repaired. It may be too damaged, or it may not be a PDF at all.'
      );
    }
  }
  return doc.save();
}

/** Output filename for the flattened PDF. */
export function flattenedFileName(stem: string): string {
  return `${stem}-flattened.pdf`;
}

/** Output filename for the repaired PDF. */
export function repairedFileName(stem: string): string {
  return `${stem}-repaired.pdf`;
}

/**
 * Copy the given 1-based page numbers into a new PDF, in the order given.
 * Used by the split tool's visual page picker.
 */
export async function extractPages(buffer: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: false });
  const pageCount = src.getPageCount();
  const indices = [...new Set(pages)]
    .map((p) => Math.floor(p))
    .filter((p) => p >= 1 && p <= pageCount)
    .map((p) => p - 1);
  if (indices.length === 0) {
    throw new Error('Pick at least one page to extract.');
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  return out.save();
}
