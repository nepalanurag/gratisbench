type EngineWarmup = () => Promise<unknown>;
export type EngineWarmupState = 'preparing' | 'ready' | 'retry';

const warmPdfjs: EngineWarmup = async () => (await import('./pdf-render.ts')).loadPdfjs();
const warmFfmpeg: EngineWarmup = async () => (await import('./ffmpeg-loader.ts')).loadFFmpeg();
const warmPyodide: EngineWarmup = async () => (await import('./pyodide-loader.ts')).loadUnlockEngine();

const WARMUPS: Record<string, EngineWarmup> = {
  '/background-remover': async () => (await import('./ormbg-loader.ts')).preloadBackgroundRemoval(),
  '/image-ocr': async () => (await import('./image-ocr.ts')).preloadImageOcr(),
  '/image-tracer': async () => (await import('./trace-loader.ts')).loadImageTracer(),
  '/ocr-pdf': async () => {
    await Promise.all([warmPdfjs(), (await import('./ocr-pdf.ts')).preloadOcrPdf()]);
  },
  '/audio-converter': warmFfmpeg,
  '/audio-trimmer': async () => import('../lib/mp3-encode.ts'),
  '/video-compressor': warmFfmpeg,
  '/video-converter': warmFfmpeg,
  '/video-trimmer': warmFfmpeg,
  '/unlock-pdf': warmPyodide,
  '/pdf-editor': async () => Promise.all([warmPdfjs(), warmPyodide()]),
  '/pdf-compressor': warmPdfjs,
  '/pdf-to-jpg': warmPdfjs,
  '/pdf-redactor': warmPdfjs,
  '/pdf-esignature': warmPdfjs,
  '/pdf-to-word': warmPdfjs,
  '/extract-images': warmPdfjs,
  '/extract-text': warmPdfjs,
  '/pdf-to-handwriting': warmPdfjs,
  '/resume-builder': async () => (await import('../lib/resume-import.ts')).preloadResumeFileReaders(),
};

/** Start only the current tool's cached engine after its first paint. */
export function scheduleEnginePreload(path: string, onState: (state: EngineWarmupState) => void): void {
  const key = path.replace(/\/+$/, '') || '/';
  const warmup = WARMUPS[key];
  if (!warmup || typeof window === 'undefined') return;

  const start = () => {
    onState('preparing');
    void Promise.resolve()
      .then(warmup)
      .then(() => onState('ready'))
      .catch(() => onState('retry'));
  };
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(start, { timeout: 2500 });
  else window.setTimeout(start, 700);
}