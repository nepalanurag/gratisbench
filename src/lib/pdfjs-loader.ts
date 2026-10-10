// pdf.js is lazy-loaded only when a user opens a PDF. Keep its worker URL
// aligned with the deployed base path and serve it from the same origin.
type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          `${import.meta.env.BASE_URL}pdf.worker.min.mjs`,
          window.location.href
        ).href;
        return pdfjs;
      } catch (err) {
        const detail = err instanceof Error ? ` ${err.message}` : '';
        throw new Error(`Could not load the PDF reader or its same-origin worker.${detail}`);
      }
    })();
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}
