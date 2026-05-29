// Canvas encode/decode helpers for the image tools. Browser-only:
// every function here touches the DOM or the Canvas API. Pure decisions
// (formats, filenames, savings math) live in ../lib/image-core.ts.
import { loadImage } from './common.ts';

export interface LoadedImage {
  img: HTMLImageElement;
  /** Object URL backing the image. Revoke it when the image is discarded. */
  url: string;
}

/** Decode a File into an <img>. Works for PNG/JPEG/WebP/GIF/BMP; TIFF depends on the browser. */
export async function fileToImage(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { img, url };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err instanceof Error ? err : new Error('Could not read that image.');
  }
}

/** Draw an image onto a canvas, optionally filling the background first (for JPEG output). */
export function drawToCanvas(img: HTMLImageElement, fill: string | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create a drawing surface.');
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/** Encode a canvas to image bytes with any MIME type the browser supports. */
export function canvasToImageBytes(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Your browser could not encode that image in the chosen format.'));
          return;
        }
        blob
          .arrayBuffer()
          .then((buf) => resolve(new Uint8Array(buf)))
          .catch(() => reject(new Error('Could not read the encoded image.')));
      },
      mime,
      quality
    );
  });
}

/** Small JPEG data URL for the file-list thumbnail. */
export function thumbnailDataUrl(img: HTMLImageElement, maxSize = 104): string {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

let avifCache: boolean | null = null;

/**
 * Feature-detect AVIF encoding. A browser that cannot encode AVIF silently
 * returns a PNG data URL, which is exactly what we test for.
 */
export function canEncodeAvif(): boolean {
  if (avifCache === null) {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      avifCache = c.toDataURL('image/avif').startsWith('data:image/avif');
    } catch {
      avifCache = false;
    }
  }
  return avifCache;
}

/**
 * Check whether the image actually has non-opaque pixels, via a downscaled
 * scan. Used to show the JPEG transparency warning only when it is real.
 */
export function imageHasAlpha(img: HTMLImageElement): boolean {
  const max = 48;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}
