// OCR fallback for the resume importer: when a PDF has no selectable text
// (a scan or photo of a resume), render its pages and read them with the
// on-device tesseract.js engine. Nothing leaves the browser.

import { loadPdfjs, renderPageToCanvas } from './pdf-render.ts';
import { loadTesseract } from './tesseract-loader.ts';
import { cleanupOcrText, ocrProgressLabel } from '../lib/ocr-core.ts';

/** Resumes are short; cap OCR pages so a big scan cannot hang the import. */
export const OCR_MAX_PAGES = 4;
/** 200 DPI is plenty for tesseract on document text. */
export const OCR_DPI = 200;

export type ResumeOcrProgress = (label: string, percent: number) => void;

/**
 * Render the first pages of a PDF and OCR them. Returns the recognized text
 * (possibly empty when the pages hold no readable text).
 */
export async function ocrPdfPages(data: Uint8Array, onProgress?: ResumeOcrProgress): Promise<string> {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data }).promise;
  // Destructure to keep the property name `createWorker` visible to the bundler.
  const { createWorker } = await loadTesseract();
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      const { percent, label } = ocrProgressLabel(m);
      onProgress?.(label, percent);
    },
  });
  try {
    const total = Math.min(pdf.numPages, OCR_MAX_PAGES);
    const pages: string[] = [];
    for (let i = 1; i <= total; i++) {
      onProgress?.(`Reading page ${i} of ${total}…`, 60 + Math.round(((i - 1) / total) * 35));
      const page = await pdf.getPage(i);
      const canvas = await renderPageToCanvas(page, OCR_DPI);
      const { data } = await worker.recognize(canvas);
      pages.push(data.text);
      page.cleanup();
    }
    return cleanupOcrText(pages.join('\n\n'));
  } finally {
    await worker.terminate();
  }
}
