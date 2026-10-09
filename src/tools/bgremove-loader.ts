// @bg0/browser loading for the background remover tool.
// BiRefNet model, runs locally in the browser via WebGPU (WASM fallback).
// Lazy-loaded only after the user picks an image.
type Bg0 = typeof import('@bg0/browser');

let bg0Promise: Promise<Bg0> | null = null;

/** How long the ~90MB model may take to download before we give up loudly. */
const LOAD_TIMEOUT_MS = 300_000;

export function loadBackgroundRemoval(): Promise<Bg0> {
  if (!bg0Promise) {
    bg0Promise = (async () => {
      const load = import('@bg0/browser');
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('The background-removal engine download stalled. Check your connection and try again.')),
          LOAD_TIMEOUT_MS,
        );
      });
      return Promise.race([load, timeout]);
    })();
    bg0Promise.catch(() => {
      bg0Promise = null;
    });
  }
  return bg0Promise;
}

/** Friendly message for common engine load failures. */
export function bgEngineLoadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|failed to fetch/i.test(msg)) {
    return 'Could not download the background-removal engine. Check your connection and try again.';
  }
  return msg || 'Could not start the background-removal engine.';
}
