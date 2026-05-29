// Pure image-tool logic shared by the browser tools and the Node verification script.
// No DOM or Canvas API here — everything is plain data in, plain data out.
// Encode/decode lives in src/tools/image-canvas.ts (browser-only).

export type ImageInputKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'tiff' | 'unknown';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'avif';
export type CompressorFormatChoice = 'keep' | 'jpeg' | 'webp';

export const OUTPUT_MIMES: Record<ImageOutputFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};

export const OUTPUT_EXTS: Record<ImageOutputFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  avif: 'avif',
};

const MIME_KINDS: Record<string, ImageInputKind> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-tiff': 'tiff',
};

const EXT_KINDS: Record<string, ImageInputKind> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
  gif: 'gif',
  bmp: 'bmp',
  tif: 'tiff',
  tiff: 'tiff',
};

/** Classify an input file by MIME type, falling back to the file extension. */
export function detectInputKind(fileName: string, mime: string): ImageInputKind {
  const fromMime = MIME_KINDS[mime.trim().toLowerCase()];
  if (fromMime) return fromMime;
  const m = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  if (m) {
    const fromExt = EXT_KINDS[m[1].toLowerCase()];
    if (fromExt) return fromExt;
  }
  return 'unknown';
}

/** True if this input kind can carry transparency that JPEG would destroy. */
const ALPHA_CAPABLE: ImageInputKind[] = ['png', 'webp', 'gif', 'tiff'];
export function alphaLossRisk(inputKind: ImageInputKind, outputFormat: ImageOutputFormat): boolean {
  return outputFormat === 'jpeg' && ALPHA_CAPABLE.includes(inputKind);
}

export interface OutputOption {
  format: ImageOutputFormat;
  mime: string;
  ext: string;
  label: string;
  note: string;
}

/**
 * Output formats for the converter. AVIF is only listed when the browser
 * reports it can encode it (feature-detected at runtime, never assumed).
 */
export function converterOutputOptions(canEncodeAvif: boolean): OutputOption[] {
  const opts: OutputOption[] = [
    {
      format: 'png',
      mime: OUTPUT_MIMES.png,
      ext: OUTPUT_EXTS.png,
      label: 'PNG',
      note: 'Lossless. Keeps transparency, but files are usually the largest.',
    },
    {
      format: 'jpeg',
      mime: OUTPUT_MIMES.jpeg,
      ext: OUTPUT_EXTS.jpeg,
      label: 'JPEG',
      note: 'Small files for photos. No transparency; the quality slider applies.',
    },
    {
      format: 'webp',
      mime: OUTPUT_MIMES.webp,
      ext: OUTPUT_EXTS.webp,
      label: 'WebP',
      note: 'Modern format, often smaller than JPEG. Keeps transparency.',
    },
  ];
  if (canEncodeAvif) {
    opts.push({
      format: 'avif',
      mime: OUTPUT_MIMES.avif,
      ext: OUTPUT_EXTS.avif,
      label: 'AVIF',
      note: 'Smallest files of the lot. Newest format; some older software cannot open it.',
    });
  }
  return opts;
}

/** Honest per-input caveats shown above the converter's file list. */
export function converterInputNote(inputKind: ImageInputKind): string | null {
  switch (inputKind) {
    case 'gif':
      return 'Animated GIFs convert as a single still frame (the first one).';
    case 'bmp':
      return 'BMP files are uncompressed, so almost any conversion makes them much smaller.';
    case 'tiff':
      return 'TIFF support depends on your browser. If a TIFF will not load here, save it as PNG in a desktop app first.';
    default:
      return null;
  }
}

/**
 * "Keep original format" for the compressor. Browsers cannot re-encode
 * GIF, BMP, or TIFF via canvas, so those fall back to PNG (lossless).
 */
export function resolveKeepFormat(inputKind: ImageInputKind): ImageOutputFormat {
  switch (inputKind) {
    case 'jpeg':
      return 'jpeg';
    case 'webp':
      return 'webp';
    case 'png':
    case 'gif':
    case 'bmp':
    case 'tiff':
    case 'unknown':
      return 'png';
  }
}

export interface CompressorSettings {
  outputFormat: ImageOutputFormat;
  mime: string;
  ext: string;
  /** 0.05–1.0 from the slider. Ignored by PNG (lossless), kept for the UI to say so. */
  quality01: number;
  qualityApplies: boolean;
  /** Honest caveat for the UI, or null when there is nothing to warn about. */
  honestyNote: string | null;
}

/** Resolve the compressor's radio choice + slider into concrete encode settings. */
export function resolveCompressorSettings(
  inputKind: ImageInputKind,
  choice: CompressorFormatChoice,
  qualitySlider: number
): CompressorSettings {
  const outputFormat = choice === 'keep' ? resolveKeepFormat(inputKind) : choice;
  const quality01 = qualityFromSlider(qualitySlider);
  let honestyNote: string | null = null;
  if (choice === 'keep' && inputKind === 'png') {
    honestyNote =
      'PNG is already lossless, so re-encoding it as PNG rarely shrinks it. Convert to JPEG or WebP for real savings.';
  } else if (choice === 'keep' && (inputKind === 'gif' || inputKind === 'bmp' || inputKind === 'tiff')) {
    const label = inputKind.toUpperCase();
    honestyNote = `Browsers cannot re-encode ${label} files, so this was saved as PNG instead (lossless, smaller than ${label === 'BMP' ? 'the original' : 'keeping it as-is'}).`;
  }
  return {
    outputFormat,
    mime: OUTPUT_MIMES[outputFormat],
    ext: OUTPUT_EXTS[outputFormat],
    quality01,
    qualityApplies: outputFormat !== 'png',
    honestyNote,
  };
}

/** Slider 5–100 -> canvas quality 0.05–1.0. Throws a human-readable error. */
export function qualityFromSlider(v: number): number {
  if (!Number.isFinite(v) || v < 5 || v > 100) {
    throw new Error('Quality must be between 5 and 100.');
  }
  return v / 100;
}

/** "photo.jpg" + "-compressed" + jpeg -> "photo-compressed.jpg". */
export function outputFileName(originalName: string, suffix: string, format: ImageOutputFormat): string {
  const stem = originalName.replace(/\.[^.]+$/, '').trim() || 'image';
  return `${stem}${suffix}.${OUTPUT_EXTS[format]}`;
}

export function batchZipName(kind: 'compress' | 'convert'): string {
  return kind === 'compress' ? 'compressed-images.zip' : 'converted-images.zip';
}

export interface Savings {
  bytesSaved: number;
  /** Positive means smaller, negative means the result grew. One decimal place. */
  percent: number;
}

/** Per-file savings math. Percent may be negative when the result grew. */
export function savings(originalBytes: number, newBytes: number): Savings {
  const bytesSaved = originalBytes - newBytes;
  const percent = originalBytes > 0 ? (bytesSaved / originalBytes) * 100 : 0;
  return { bytesSaved, percent: Math.round(percent * 10) / 10 };
}

export interface TotalSavings extends Savings {
  totalOriginal: number;
  totalResult: number;
}

/** Totals across a batch. */
export function totalSavings(pairs: { original: number; result: number }[]): TotalSavings {
  const totalOriginal = pairs.reduce((a, p) => a + p.original, 0);
  const totalResult = pairs.reduce((a, p) => a + p.result, 0);
  return { totalOriginal, totalResult, ...savings(totalOriginal, totalResult) };
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface PngInfo {
  width: number;
  height: number;
  colorType: number;
  hasAlpha: boolean;
}

/**
 * Decode a PNG header (signature + IHDR) without any image library.
 * Pure and testable in Node: generate PNG bytes with pngjs, parse them here,
 * and confirm width, height, and the alpha flag survive the round trip.
 */
export function parsePngHeader(bytes: Uint8Array): PngInfo {
  if (bytes.length < 33) throw new Error('Not a PNG file: too short.');
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG file: bad signature.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLen = view.getUint32(8);
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== 'IHDR' || ihdrLen !== 13) throw new Error('Not a PNG file: missing IHDR.');
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const colorType = bytes[25];
  if (width === 0 || height === 0) throw new Error('Not a PNG file: zero size.');
  return { width, height, colorType, hasAlpha: colorType === 4 || colorType === 6 };
}
