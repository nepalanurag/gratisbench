// imagetracerjs loading for the image tracer tool.
// Lazy-loaded (dynamic import) only after the user picks an image, so the
// page stays fast on first paint. imagetracerjs is dependency-free pure JS,
// so the chunk is small; the lazy pattern is kept for consistency with the
// other heavy engines (pdf.js, ffmpeg.wasm).
//
// Note: imagetracerjs is a CJS module whose exports are only visible as
// `module.exports` (no statically analyzable named exports), so the dynamic
// import namespace only carries `.default` under Node ESM and Vite/Rollup.
// This loader normalizes to the engine object either way.

export interface ImageTracerEngine {
  imagedataToSVG(
    imgd: { width: number; height: number; data: Uint8ClampedArray },
    options?: Record<string, number | boolean | string>
  ): string;
}

let tracerPromise: Promise<ImageTracerEngine> | null = null;

/**
 * Load the tracer engine on demand and return a shared engine object.
 * A failed load clears the cached promise so the user can retry.
 */
export function loadImageTracer(): Promise<ImageTracerEngine> {
  if (!tracerPromise) {
    tracerPromise = (async () => {
      const mod = await import('imagetracerjs');
      const engine = (mod as unknown as { default?: unknown }).default ?? mod;
      // Minification-proof marker for this tool's bundled chunk: the method
      // name `imagedataToSVG` survives esbuild minification.
      if (!engine || typeof (engine as ImageTracerEngine).imagedataToSVG !== 'function') {
        throw new Error('The tracing engine did not load correctly.');
      }
      return engine as ImageTracerEngine;
    })();
    tracerPromise.catch(() => {
      tracerPromise = null;
    });
  }
  return tracerPromise;
}

/** Friendly message for common engine load failures. */
export function tracerLoadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|failed to fetch/i.test(msg)) {
    return 'Could not download the tracing engine. Check your connection and try again.';
  }
  return msg || 'Could not start the tracing engine.';
}
