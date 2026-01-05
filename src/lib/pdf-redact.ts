// Pure redaction logic shared by the browser tool and the Node verification script.
// No DOM access here. The browser renders redacted pages with pdf.js, paints the
// black boxes onto the bitmap, and passes the finished bitmaps in; pages nobody
// marked are copied from the source as untouched vectors.
import { PDFDocument } from 'pdf-lib';

export interface RedactedPageBitmap {
  /** Zero-based index of this page in the source PDF. */
  pageIndex: number;
  /** Rendered bitmap with the redaction boxes already painted over. */
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  /** Original page size in PDF points. The bitmap page keeps this exact size. */
  widthPt: number;
  heightPt: number;
}

/**
 * Build the redacted PDF. Marked pages are replaced by image pages (the
 * painted-over bitmaps); unmarked pages are copied as-is, vectors intact.
 */
export async function redactPdf(
  source: Uint8Array,
  redacted: RedactedPageBitmap[]
): Promise<Uint8Array> {
  if (redacted.length === 0) {
    throw new Error('Mark at least one area to redact before processing.');
  }

  const src = await PDFDocument.load(source, { ignoreEncryption: false });
  const pageCount = src.getPageCount();

  const seen = new Set<number>();
  for (const r of redacted) {
    if (!Number.isInteger(r.pageIndex) || r.pageIndex < 0 || r.pageIndex >= pageCount) {
      throw new Error(
        `Page ${r.pageIndex + 1} is out of range. This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`
      );
    }
    if (seen.has(r.pageIndex)) {
      throw new Error(`Page ${r.pageIndex + 1} was marked twice. This should not happen; please try again.`);
    }
    seen.add(r.pageIndex);
    if (r.data.length === 0) {
      throw new Error(`Page ${r.pageIndex + 1} rendered to an empty image.`);
    }
    if (!(r.widthPt > 0) || !(r.heightPt > 0)) {
      throw new Error(`Page ${r.pageIndex + 1} has an invalid page size.`);
    }
  }

  const byIndex = new Map(redacted.map((r) => [r.pageIndex, r]));
  const out = await PDFDocument.create();

  for (let i = 0; i < pageCount; i++) {
    const mark = byIndex.get(i);
    if (!mark) {
      const [copied] = await out.copyPages(src, [i]);
      out.addPage(copied);
      continue;
    }
    const embedded =
      mark.mime === 'image/png' ? await out.embedPng(mark.data) : await out.embedJpg(mark.data);
    const page = out.addPage([mark.widthPt, mark.heightPt]);
    page.drawImage(embedded, { x: 0, y: 0, width: mark.widthPt, height: mark.heightPt });
  }

  return out.save();
}
