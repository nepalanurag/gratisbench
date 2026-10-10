// Tesseract.js is lazy-loaded only after a user starts OCR. Its worker, WASM
// core, and English data are hosted with the site; other language data is
// fetched from the Tesseract data CDN only when that language is selected.

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

export function tesseractWorkerOptions(language: string) {
  const base = import.meta.env.BASE_URL;
  return {
    workerPath: `${base}tesseract/worker.min.js`,
    corePath: `${base}tesseract/core/`,
    langPath:
      language === 'eng'
        ? `${base}tesseract/lang`
        : `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}/4.0.0_best_int`,
    gzip: true,
  };
}

/** Friendly message for common engine load failures. */
export function tesseractLoadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|failed to fetch/i.test(msg)) {
    return 'Could not load the OCR engine or language data. Check your connection and try again.';
  }
  return msg || 'Could not start the OCR engine.';
}
