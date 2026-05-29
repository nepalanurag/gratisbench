// @imgly/background-removal loading for the background remover tool.
// The engine is lazy-loaded (dynamic import) only after the user picks an
// image, so the page stays fast on first paint. The ~40MB ONNX model then
// downloads from the package's CDN on first use and is cached by the browser.
// Same lazy pattern as src/tools/pdf-render.ts (pdf.js).
type BgRemoval = typeof import('@imgly/background-removal');

let bgRemovalPromise: Promise<BgRemoval> | null = null;

/**
 * Load the background-removal engine on demand and return a shared module.
 * A failed load clears the cached promise so the user can retry.
 */
export function loadBackgroundRemoval(): Promise<BgRemoval> {
  if (!bgRemovalPromise) {
    bgRemovalPromise = import('@imgly/background-removal');
    bgRemovalPromise.catch(() => {
      bgRemovalPromise = null;
    });
  }
  return bgRemovalPromise;
}

/** Friendly message for common engine load failures. */
export function bgEngineLoadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|failed to fetch/i.test(msg)) {
    return 'Could not download the background-removal engine. Check your connection and try again.';
  }
  return msg || 'Could not start the background-removal engine.';
}
