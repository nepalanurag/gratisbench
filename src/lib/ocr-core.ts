// Image OCR pure logic: language list + validation, OCR text cleanup,
// progress labels, filenames. No DOM. The tesseract.js engine is
// browser-only (worker + language data download at runtime), so everything
// except the engine calls is tested here.

export interface OcrLanguage {
  code: string;
  label: string;
}

/** Languages offered in the UI. Codes are tesseract traineddata names. */
export const OCR_LANGUAGES: readonly OcrLanguage[] = [
  { code: 'eng', label: 'English' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'spa', label: 'Spanish' },
  { code: 'ita', label: 'Italian' },
  { code: 'por', label: 'Portuguese' },
  { code: 'nld', label: 'Dutch' },
  { code: 'rus', label: 'Russian' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'hin', label: 'Hindi' },
  { code: 'ara', label: 'Arabic' },
];

export const DEFAULT_OCR_LANG = 'eng';

/** Honest engine note: the worker and language data download on first use. */
export const OCR_ENGINE_NOTE =
  'The OCR engine and language data (~15 MB) download the first time you run it, ' +
  'then stay cached in your browser. Your image never leaves your device.';

/** Validate a language code from the UI; unknown values fall back to English. */
export function resolveOcrLanguage(code: unknown): string {
  if (typeof code === 'string' && OCR_LANGUAGES.some((l) => l.code === code)) return code;
  return DEFAULT_OCR_LANG;
}

export interface OcrOptions {
  lang: string;
  /** Upscale images whose long edge is small: tesseract wants ~300 DPI text. */
  upscaleSmall: boolean;
  /** Grayscale + contrast stretch before recognition. */
  enhanceContrast: boolean;
  /** Light whitespace cleanup of the recognized text. */
  lightCleanup: boolean;
}

/** Normalize raw option values from the DOM into a safe OcrOptions object. */
export function validateOcrOptions(raw: {
  lang?: unknown;
  upscaleSmall?: unknown;
  enhanceContrast?: unknown;
  lightCleanup?: unknown;
}): OcrOptions {
  return {
    lang: resolveOcrLanguage(raw.lang),
    upscaleSmall: raw.upscaleSmall !== false,
    enhanceContrast: raw.enhanceContrast !== false,
    lightCleanup: raw.lightCleanup !== false,
  };
}

/**
 * Light, honest cleanup of OCR output. This only fixes whitespace that OCR
 * engines routinely emit (page feeds, ragged trailing spaces, runs of blank
 * lines); it never rewrites words, because silent "correction" would invent
 * text the image did not contain.
 */
export function cleanupOcrText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n') // normalize line endings
      .replace(/\f/g, '') // drop form feeds between pages
      // join a hyphenated line break: "exam-\nple" -> "example"
      .replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, '')) // trailing spaces per line
      .join('\n')
      .replace(/\n{3,}/g, '\n\n') // collapse 3+ blank lines to one blank line
      .trim()
  );
}

/** Strip the extension from a filename; dotfiles like ".png" have no stem. */
function stemOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot > 0) return base.slice(0, dot);
  return 'image';
}

/** Output filename: scan.png -> scan-ocr.txt */
export function ocrOutputFileName(originalName: string): string {
  return `${stemOf(originalName)}-ocr.txt`;
}

/** A tesseract.js logger message: { status, progress }. */
export interface TesseractProgress {
  status: string;
  progress: number;
}

/**
 * Map a tesseract.js logger message to a UI label + percent.
 * tesseract reports progress 0..1 per status; statuses arrive in order
 * core -> language data -> init -> recognition.
 */
export function ocrProgressLabel(msg: TesseractProgress): { percent: number; label: string } {
  const p = Math.max(0, Math.min(1, Number(msg.progress) || 0));
  const status = (msg.status || '').toLowerCase();
  if (status.includes('loading tesseract core')) {
    return { percent: Math.round(p * 25), label: 'Loading the OCR engine…' };
  }
  if (status.includes('initializing tesseract')) {
    return { percent: 25 + Math.round(p * 5), label: 'Starting the OCR engine…' };
  }
  if (status.includes('loading language traineddata')) {
    return { percent: 30 + Math.round(p * 25), label: 'Downloading language data… (once per browser)' };
  }
  if (status.includes('initializing api')) {
    return { percent: 55 + Math.round(p * 5), label: 'Preparing recognition…' };
  }
  if (status.includes('recognizing text')) {
    return { percent: 60 + Math.round(p * 40), label: 'Reading the text…' };
  }
  return { percent: Math.round(p * 100), label: 'Working…' };
}

/** Friendly message for common OCR failures. */
export function ocrErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|failed to fetch|load/i.test(msg)) {
    return 'Could not download the OCR engine or language data. Check your connection and try again — your image never left your device.';
  }
  return msg || 'Text recognition failed.';
}
