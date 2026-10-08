// Extended images-to-PDF builder for the Images to PDF / JPG to PDF tools.
// Adds orientation and margin control for the A4 / US Letter layouts.
// The "fit to image" layout is unchanged from pdf-core.
import { PDFDocument } from 'pdf-lib';
import type { PdfImage } from './pdf-core.ts';

export type ImagePageSize = 'fit' | 'a4' | 'letter';
/** How A4/Letter pages are oriented. "auto" follows each image's own shape. */
export type ImageOrientation = 'auto' | 'portrait' | 'landscape';
/** Margin around the image on A4/Letter pages, in plain words. */
export type ImageMargin = 'none' | 'slim' | 'wide';

const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];

const MARGINS_PT: Record<ImageMargin, number> = {
  none: 0,
  slim: 24,
  wide: 72,
};

export interface ImagesToPdfOptions {
  pageSize: ImagePageSize;
  orientation: ImageOrientation;
  margin: ImageMargin;
}

export async function imagesToPdfEx(
  images: PdfImage[],
  opts: ImagesToPdfOptions
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

    if (opts.pageSize === 'fit') {
      const page = doc.addPage([iw, ih]);
      page.drawImage(embedded, { x: 0, y: 0, width: iw, height: ih });
      continue;
    }

    let [pw, ph] = opts.pageSize === 'a4' ? A4 : LETTER;
    const orientation =
      opts.orientation === 'auto' ? (iw >= ih ? 'landscape' : 'portrait') : opts.orientation;
    if ((orientation === 'landscape') !== (pw > ph)) {
      [pw, ph] = [ph, pw];
    }

    const margin = MARGINS_PT[opts.margin];
    const maxW = Math.max(1, pw - margin * 2);
    const maxH = Math.max(1, ph - margin * 2);
    const scale = Math.min(maxW / iw, maxH / ih);
    const w = iw * scale;
    const h = ih * scale;
    const page = doc.addPage([pw, ph]);
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }

  return doc.save();
}
