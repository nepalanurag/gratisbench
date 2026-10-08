// Image resize pure logic for the image compressor and converter.
// No DOM or Canvas API here: mode validation + dimension math only.
// The browser glue draws at the computed size.

export type ResizeMode = 'original' | 'half' | 'web' | 'custom';

export const RESIZE_MODES: readonly ResizeMode[] = ['original', 'half', 'web', 'custom'];

/** Long-edge cap for the "fit for the web" preset, in pixels. */
export const WEB_LONG_EDGE = 1920;

/** Bounds for the custom-width input, in pixels. */
export const CUSTOM_WIDTH_MIN = 16;
export const CUSTOM_WIDTH_MAX = 12000;

/** Validate a resize-mode value from the DOM; unknown values keep the original size. */
export function validateResizeMode(value: unknown): ResizeMode {
  return value === 'half' || value === 'web' || value === 'custom' ? value : 'original';
}

export interface ResizeDims {
  width: number;
  height: number;
}

/**
 * Compute the output dimensions for an image of natW x natH.
 * Returns null when the mode means "keep the original size" (or when the
 * image is already small enough / the custom width is invalid or larger
 * than the image — resizing never enlarges).
 */
export function computeResizeDims(
  natW: number,
  natH: number,
  mode: ResizeMode,
  customWidth: unknown
): ResizeDims | null {
  if (!Number.isFinite(natW) || !Number.isFinite(natH) || natW <= 0 || natH <= 0) {
    throw new Error('Invalid image dimensions.');
  }
  if (mode === 'original') return null;
  if (mode === 'half') {
    return { width: Math.max(1, Math.round(natW / 2)), height: Math.max(1, Math.round(natH / 2)) };
  }
  if (mode === 'web') {
    const longEdge = Math.max(natW, natH);
    if (longEdge <= WEB_LONG_EDGE) return null;
    const k = WEB_LONG_EDGE / longEdge;
    return { width: Math.max(1, Math.round(natW * k)), height: Math.max(1, Math.round(natH * k)) };
  }
  // custom: a width in pixels; never enlarges, ignores garbage input.
  const w = Math.round(Number(customWidth));
  if (!Number.isFinite(w) || w <= 0) return null;
  const clamped = Math.min(CUSTOM_WIDTH_MAX, Math.max(CUSTOM_WIDTH_MIN, w));
  if (clamped >= natW) return null;
  const k = clamped / natW;
  return { width: clamped, height: Math.max(1, Math.round(natH * k)) };
}

/** Plain-language one-liner describing what a resize mode does to an image. */
export function resizeModeDescription(mode: ResizeMode, natW: number, natH: number, customWidth: unknown): string {
  const dims = computeResizeDims(natW, natH, mode, customWidth);
  if (!dims) return 'Keeps the original size.';
  return `Shrinks ${natW}×${natH} to ${dims.width}×${dims.height}.`;
}
