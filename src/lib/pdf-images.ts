// Pure helpers for the PDF-to-images tool: filenames and option validation.
// Rendering itself needs pdf.js + canvas, so it lives in src/tools/pdf-render.ts.
export type PageImageFormat = 'jpg' | 'png';

/** "report" + page 3 + jpg -> "report-page-3.jpg". */
export function pageFileName(stem: string, pageNumber: number, format: PageImageFormat): string {
  const clean = stem.replace(/\.[^.]+$/, '').trim() || 'document';
  return `${clean}-page-${pageNumber}.${format}`;
}

export const PAGE_IMAGE_DPIS = [72, 150, 300] as const;

export interface PageImageOptions {
  dpi: number;
  format: PageImageFormat;
}

/** Validate the DPI/format choices from the UI. Throws a human-readable error. */
export function validatePageImageOptions(opts: PageImageOptions): void {
  if (!(PAGE_IMAGE_DPIS as readonly number[]).includes(opts.dpi)) {
    throw new Error(`Resolution must be one of ${PAGE_IMAGE_DPIS.join(', ')} DPI.`);
  }
  if (opts.format !== 'jpg' && opts.format !== 'png') {
    throw new Error('Image format must be JPG or PNG.');
  }
}
