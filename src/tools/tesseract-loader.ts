// tesseract.js loading for the image OCR tool.
// Lazy-loaded (dynamic import) only after the user picks an image, so the
// page stays fast on first paint. The worker script, WASM core, and language
// data then download from tesseract.js's CDN on first use and are cached by
// the browser. Same lazy pattern as src/tools/pdf-render.ts (pdf.js).

let tesseractPromise: Promise<typeof import('tesseract.js')> | null = null;

/** How long the OCR engine may take to download before we give up loudly. */
const LOAD_TIMEOUT_MS = 120_000;

/**
 * Load tesseract.js on demand and return a shared module.
 * A failed load clears the cached promise so the user can retry.
 * The load races a timeout: a stalled download must surface an error,
 * never leave the tool stuck on "Loading…" forever.
 */
export function loadTesseract(): Promise<typeof import('tesseract.js')> {
  if (!tesseractPromise) {
    tesseractPromise = (async () => {
      const load = import('tesseract.js');
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('The OCR engine download stalled. Check your connection and try again.')),
          LOAD_TIMEOUT_MS,
        );
      });
      return Promise.race([load, timeout]);
    })();
    tesseractPromise.catch(() => {
      tesseractPromise = null;
    });
  }
  return tesseractPromise;
}

/** Friendly message for common engine load failures. */
export function tesseractLoadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|failed to fetch/i.test(msg)) {
    return 'Could not download the OCR engine. Check your connection and try again.';
  }
  return msg || 'Could not start the OCR engine.';
}
