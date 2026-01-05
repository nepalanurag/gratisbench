// Pure compression logic shared by the browser tool and the Node verification script.
// No DOM access here — rendered page bitmaps are passed in as PNG/JPEG buffers
// (the browser renders them with pdf.js; Node tests use pngjs stand-ins).
import { PDFDocument } from 'pdf-lib';

export interface RenderedPage {
  /** Rendered bitmap bytes (PNG or JPEG). */
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  /** Bitmap size in pixels, as rendered. */
  widthPx: number;
  heightPx: number;
}

/**
 * Physical page size in PDF points for a bitmap rendered at the given DPI.
 * A 200px-wide bitmap rendered at 100 DPI becomes a 144pt-wide page.
 */
export function pageSizeFromBitmap(widthPx: number, heightPx: number, dpi: number): [number, number] {
  return [(widthPx * 72) / dpi, (heightPx * 72) / dpi];
}

/**
 * Rebuild a PDF from rendered page bitmaps. Every page becomes a full-page
 * image at its physical size — this is what shrinks the file (lower DPI and
 * JPEG quality mean fewer, cheaper bytes), and it is also why text in the
 * result is no longer selectable. Callers must say this plainly in the UI.
 */
export async function rebuildImagePdf(pages: RenderedPage[], dpi: number): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new Error('Nothing to compress. The PDF had no pages to render.');
  }
  if (!Number.isFinite(dpi) || dpi <= 0 || dpi > 1200) {
    throw new Error('Render resolution must be between 1 and 1200 DPI.');
  }

  const doc = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!Number.isInteger(p.widthPx) || !Number.isInteger(p.heightPx) || p.widthPx <= 0 || p.heightPx <= 0) {
      throw new Error(`Page ${i + 1} has an invalid bitmap size.`);
    }
    if (p.data.length === 0) {
      throw new Error(`Page ${i + 1} rendered to an empty image.`);
    }
    const embedded =
      p.mime === 'image/png' ? await doc.embedPng(p.data) : await doc.embedJpg(p.data);
    const [w, h] = pageSizeFromBitmap(p.widthPx, p.heightPx, dpi);
    const page = doc.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}

/**
 * Validate a JPEG quality value from the UI slider (0-100).
 * Returns the 0..1 value canvas.toBlob expects.
 */
export function jpegQualityFromSlider(percent: number): number {
  if (!Number.isFinite(percent) || percent < 5 || percent > 100) {
    throw new Error('JPEG quality must be between 5 and 100.');
  }
  return percent / 100;
}
