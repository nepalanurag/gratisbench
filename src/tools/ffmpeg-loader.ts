// ffmpeg.wasm loading for the browser media tools.
// ffmpeg.wasm is lazy-loaded (dynamic import) only after the user picks a file,
// so the tool pages stay fast on first paint — the ~31MB single-threaded core
// downloads only when a conversion actually needs it. Same lazy pattern as
// src/tools/pdf-render.ts (pdf.js).
import type { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpegPromise: Promise<FFmpeg> | null = null;

/** How long the ~31MB engine may take to download before we give up loudly. */
const LOAD_TIMEOUT_MS = 120_000;

/**
 * Load the ffmpeg.wasm engine on demand and return a shared instance.
 * onLog receives ffmpeg's own log lines (useful for the progress label).
 * A failed load clears the cached promise so the user can retry.
 * The load races a timeout: a stalled download must surface an error,
 * never leave the tool stuck on "Starting…" forever.
 */
export function loadFFmpeg(onLog?: (message: string) => void): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      // `?url` is a Vite/Astro build-time feature: these become same-origin
      // asset URLs in the static build. @ffmpeg/core 0.12.x is the
      // single-threaded build, so no SharedArrayBuffer / COOP+COEP headers
      // are needed (GitHub Pages cannot set those).
      const { default: classWorkerURL } = await import('@ffmpeg/ffmpeg/worker?url');
      const { default: coreURL } = await import('@ffmpeg/core?url');
      const { default: wasmURL } = await import('@ffmpeg/core/wasm?url');
      const ffmpeg = new FFmpeg();
      if (onLog) {
        ffmpeg.on('log', ({ message }) => onLog(message));
      }
      const load = ffmpeg.load({
        classWorkerURL: await toBlobURL(classWorkerURL, 'text/javascript'),
        coreURL: await toBlobURL(coreURL, 'text/javascript'),
        wasmURL: await toBlobURL(wasmURL, 'application/wasm'),
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('load timed out: the media engine download stalled — check your connection and try again')),
          LOAD_TIMEOUT_MS,
        );
      });
      try {
        await Promise.race([load, timeout]);
      } finally {
        clearTimeout(timer);
      }
      return ffmpeg;
    })();
    ffmpegPromise.catch(() => {
      ffmpegPromise = null;
    });
  }
  return ffmpegPromise;
}

/** Read a File into the Uint8Array shape ffmpeg.writeFile expects. */
export async function fetchFileBytes(file: File): Promise<Uint8Array> {
  const { fetchFile } = await import('@ffmpeg/util');
  return (await fetchFile(file)) as Uint8Array;
}

/** Friendly message for common ffmpeg.wasm load / run failures. */
export function ffmpegErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/memory|allocation|abort\(\)/i.test(msg)) {
    return 'The encoder ran out of memory. Try a smaller file or a lower target size — video encoding happens in your browser\'s memory.';
  }
  if (/load|fetch|network/i.test(msg)) {
    return 'Could not download the video engine. Check your connection and try again.';
  }
  return msg || 'The conversion failed.';
}
