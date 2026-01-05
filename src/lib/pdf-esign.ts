// Pure e-signature logic shared by the browser tool and the Node verification script.
// No DOM access here. The browser collects click-to-place rectangles on page
// previews and converts them to PDF points with previewRectToPdf before calling
// signPdf. The signature bitmap itself is a PNG (drawn pad or typed name).
import { PDFDocument } from 'pdf-lib';

export interface SignaturePlacement {
  /** Zero-based page index in the source PDF. */
  pageIndex: number;
  /** Rectangle in PDF points, origin at the page's bottom-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle on a rendered page preview, in preview pixels (origin top-left). */
export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert a placement rectangle from preview pixels to PDF points.
 * The preview is a straight render of the page, so the mapping is a uniform
 * scale plus a vertical flip (PDF origin is bottom-left, canvas is top-left).
 */
export function previewRectToPdf(
  rect: PreviewRect,
  previewWidthPx: number,
  previewHeightPx: number,
  pageWidthPt: number,
  pageHeightPt: number
): { x: number; y: number; width: number; height: number } {
  if (!(previewWidthPx > 0) || !(previewHeightPx > 0)) {
    throw new Error('The page preview has an invalid size.');
  }
  const sx = pageWidthPt / previewWidthPx;
  const sy = pageHeightPt / previewHeightPx;
  const width = rect.width * sx;
  const height = rect.height * sy;
  return {
    x: rect.x * sx,
    y: pageHeightPt - (rect.y + rect.height) * sy,
    width,
    height,
  };
}

/**
 * Flatten a signature PNG onto the PDF at the given placements.
 * The original pages are copied as-is; only the signature images are added.
 */
export async function signPdf(
  source: Uint8Array,
  signaturePng: Uint8Array,
  placements: SignaturePlacement[]
): Promise<Uint8Array> {
  if (placements.length === 0) {
    throw new Error('Place your signature on at least one page before signing.');
  }
  if (signaturePng.length === 0) {
    throw new Error('Draw or type your signature first.');
  }

  const src = await PDFDocument.load(source, { ignoreEncryption: false });
  const pageCount = src.getPageCount();

  for (const p of placements) {
    if (!Number.isInteger(p.pageIndex) || p.pageIndex < 0 || p.pageIndex >= pageCount) {
      throw new Error(
        `Page ${p.pageIndex + 1} is out of range. This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`
      );
    }
    if (!(p.width > 0) || !(p.height > 0)) {
      throw new Error('The signature size is invalid. Try placing it again.');
    }
  }

  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, src.getPageIndices());
  for (const page of pages) out.addPage(page);

  const sig = await out.embedPng(signaturePng);
  for (const p of placements) {
    out.getPage(p.pageIndex).drawImage(sig, {
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
    });
  }

  return out.save();
}
