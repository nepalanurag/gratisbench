// Image tracer pure logic: option validation/normalization, imagetracerjs
// option mapping, SVG sanity checks, filenames. No DOM. The imagetracerjs
// engine is dependency-free pure JS and runs on ImageData, so it can be
// exercised in Node with canned pixel data (see scripts/verify-tools.mjs).
// The browser glue only feeds it real image pixels.

export type TraceMode = 'color' | 'mono';

export const TRACE_MODES: readonly TraceMode[] = ['color', 'mono'];

/** Detail slider range exposed in the UI. */
export const TRACE_DETAIL_MIN = 1;
export const TRACE_DETAIL_MAX = 10;
export const TRACE_DETAIL_DEFAULT = 6;

/** Long edge cap for the pixels fed to the tracer: keeps tracing fast. */
export const TRACE_MAX_EDGE = 1024;

export interface TraceOptions {
  mode: TraceMode;
  detail: number;
}

/** Honest engine note shown next to the file picker. */
export const TRACE_ENGINE_NOTE =
  'Tracing runs entirely in your browser — no upload. ' +
  'Logos, icons, and high-contrast art trace beautifully; photos do not.';

/** Validate raw option values from the DOM into a safe TraceOptions object. */
export function validateTraceOptions(raw: { mode?: unknown; detail?: unknown }): TraceOptions {
  const mode: TraceMode = raw.mode === 'mono' ? 'mono' : 'color';
  let detail = Number(raw.detail);
  if (!Number.isFinite(detail)) detail = TRACE_DETAIL_DEFAULT;
  detail = Math.round(detail);
  if (detail < TRACE_DETAIL_MIN) detail = TRACE_DETAIL_MIN;
  if (detail > TRACE_DETAIL_MAX) detail = TRACE_DETAIL_MAX;
  return { mode, detail };
}

/**
 * imagetracerjs options derived from the UI's detail slider (1-10).
 * - detail drives the palette size (color mode) and noise filtering;
 *   higher detail keeps more colors and smaller paths.
 * - ltres/qtres stay at 1: tighter values explode path counts on noisy
 *   photos without visibly better logos.
 */
export function resolveImageTracerOptions(opts: TraceOptions): Record<string, number | boolean | string> {
  const t = (opts.detail - TRACE_DETAIL_MIN) / (TRACE_DETAIL_MAX - TRACE_DETAIL_MIN); // 0..1
  const numberofcolors = opts.mode === 'mono' ? 2 : 2 + Math.round(t * 14); // 2..16
  const pathomit = Math.round(48 - t * 44); // 48 (smooth) .. 4 (detailed)
  return {
    ltres: 1,
    qtres: 1,
    pathomit,
    rightangleenhance: true,
    colorsampling: 2,
    numberofcolors,
    mincolorratio: 0,
    colorquantcycles: 3,
    strokewidth: 1,
    linefilter: false,
    roundcoords: 1,
    viewbox: false,
    desc: true,
    blurradius: 0,
    blurdelta: 20,
  };
}

/** Scale dimensions so the long edge fits maxEdge; never upscales. */
export function scaleForTrace(
  width: number,
  height: number,
  maxEdge = TRACE_MAX_EDGE
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions.');
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const k = maxEdge / longEdge;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Strip the extension from a filename; dotfiles like ".png" have no stem. */
function stemOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot > 0) return base.slice(0, dot);
  return 'image';
}

/** Output filename: logo.png -> logo-traced.svg */
export function traceOutputFileName(originalName: string): string {
  return `${stemOf(originalName)}-traced.svg`;
}

/** Preview PNG filename next to the SVG download. */
export function tracePreviewFileName(originalName: string): string {
  return `${stemOf(originalName)}-traced.png`;
}

/**
 * Sanity check on a produced SVG string: it must parse as an SVG document
 * with real path data. Used in Node tests with a canned SVG; in the browser
 * it guards the download button.
 */
export function validateSvg(svg: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof svg !== 'string' || svg.length < 200) {
    return { ok: false, reason: 'The tracer produced no usable output.' };
  }
  const head = svg.slice(0, 500).toLowerCase();
  if (!head.includes('<svg')) {
    return { ok: false, reason: 'The tracer produced no usable output.' };
  }
  if (!svg.includes('<path') || !/[dD]="[^"]*[MLCQZ]/.test(svg)) {
    return { ok: false, reason: 'The trace contains no vector paths — try a higher-contrast image.' };
  }
  if (!svg.trimEnd().endsWith('</svg>')) {
    return { ok: false, reason: 'The tracer output was cut off.' };
  }
  return { ok: true };
}

/** Count top-level path elements in an SVG string. */
export function countSvgPaths(svg: string): number {
  const m = svg.match(/<path[\s>]/g);
  return m ? m.length : 0;
}

/**
 * Parse width/height from an SVG string's root attributes.
 * Returns null when the SVG uses only a viewBox or the values are not numeric.
 */
export function svgDimensions(svg: string): { width: number; height: number } | null {
  const m = svg.match(/<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/** Friendly message for common tracing failures. */
export function traceErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/memory|allocation/i.test(msg)) {
    return 'Tracing ran out of memory on that image. Try a smaller image or lower detail.';
  }
  return msg || 'Tracing failed.';
}
