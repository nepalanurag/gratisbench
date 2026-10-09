// @imgly/background-removal loading for the background remover tool.
// IS-Net model, runs locally in the browser.
// Lazy-loaded only after the user picks an image.
type BgRemoval = typeof import('@imgly/background-removal');

let bgRemovalPromise: Promise<BgRemoval> | null = null;

/** How long the ~40MB model may take to download before we give up loudly. */
const LOAD_TIMEOUT_MS = 180_000;

export function loadBackgroundRemoval(): Promise<BgRemoval> {
  if (!bgRemovalPromise) {
    bgRemovalPromise = (async () => {
      const load = import('@imgly/background-removal');
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('The background-removal engine download stalled. Check your connection and try again.')),
          LOAD_TIMEOUT_MS,
        );
      });
      return Promise.race([load, timeout]);
    })();
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
