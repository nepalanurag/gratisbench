// OCR PDF tool: DOM glue. Pure assembly lives in ../lib/pdf-ocr.ts.
// Flow: drop a PDF -> every page with no text is rendered and read by
// tesseract.js -> the output PDF copies text pages as-is and rebuilds the
// rest as page images with an invisible text layer.
import { loadPdfjs, renderPageToCanvas, canvasToBytes, pdfJsLoadErrorMessage } from './pdf-render.ts';
import { loadTesseract, tesseractLoadErrorMessage } from './tesseract-loader.ts';
import { OCR_LANGUAGES } from '../lib/ocr-core.ts';
import {
  assembleSearchablePdf,
  pixelBoxToPoints,
  ocrFileName,
  type OcrPagePlan,
  type OcrWordBox,
} from '../lib/pdf-ocr.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  mobileFileSizeGuard,
} from './common.ts';

const RENDER_DPI = 150;
/** Pages with more real text than this are left alone. */
const TEXT_THRESHOLD = 20;

interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

type OcrWorker = {
  recognize: (image: unknown) => Promise<{ data: { text: string; words?: OcrWord[] } }>;
  terminate: () => Promise<void>;
};

let file: File | null = null;
let sourceBytes: Uint8Array | null = null;
let pageCount = 0;
let textPages = 0;
let scanPages = 0;
let worker: OcrWorker | null = null;
let workerLang: string | null = null;

function refreshOcrButton(): void {
  const forceAll = el<HTMLInputElement>('ocr-force-all').checked;
  const info = el('file-info');
  if (!file) return;
  info.textContent =
    `${file.name} · ${formatBytes(file.size)} · ${pageCount} page${pageCount === 1 ? '' : 's'}` +
    (scanPages === 0 && !forceAll
      ? '. Every page already has text, so this tool would change nothing.'
      : forceAll
        ? '. Every page will be re-read, even ones that already have text.'
        : `. ${scanPages} page${scanPages === 1 ? '' : 's'} need${scanPages === 1 ? 's' : ''} a text layer.`);
  el<HTMLButtonElement>('ocr-btn').disabled = scanPages === 0 && !forceAll;
}

function setProgress(done: number, total: number, label: string): void {
  el('progress-wrap').hidden = false;
  el('progress-bar').style.width = `${Math.round((done / total) * 100)}%`;
  el('progress-label').textContent = label.replace('{n}', String(done)).replace('{t}', String(total));
}

async function getWorker(lang: string): Promise<OcrWorker> {
  if (worker && workerLang === lang) return worker;
  if (worker) {
    try {
      await worker.terminate();
    } catch {
      /* ignore */
    }
    worker = null;
  }
  const { createWorker } = await loadTesseract();
  // tesseract.js minifies badly; the public name `createWorker` is referenced
  // through the same lookup the image OCR tool uses.
  worker = (await createWorker(lang, 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        setProgress(Math.round(m.progress * 100), 100, 'Reading text…');
      }
    },
  })) as unknown as OcrWorker;
  workerLang = lang;
  return worker;
}

export function initOcrPdf(): void {
  const select = el<HTMLSelectElement>('lang-select');
  for (const { code, label } of OCR_LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = 'eng';
  el<HTMLInputElement>('ocr-force-all').addEventListener('change', refreshOcrButton);

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('file-info').hidden = true;
    el('engine-note').hidden = true;
    el<HTMLButtonElement>('ocr-btn').disabled = true;
    const f = files[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      showError('error-box', `"${f.name}" is not a PDF.`);
      return;
    }
    const sizeNote = el('size-note');
    sizeNote.hidden = true;
    const guard = mobileFileSizeGuard(f);
    if (guard?.block) {
      showError('error-box', guard.message);
      return;
    }
    if (guard) {
      sizeNote.textContent = guard.message;
      sizeNote.hidden = false;
    }
    file = f;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      sourceBytes = bytes.slice();
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      pageCount = doc.numPages;
      // Quick text check per page: pages with real text are copied as-is.
      textPages = 0;
      for (let i = 1; i <= pageCount; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((it) => ('str' in it ? (it as { str: string }).str : ''))
          .join('')
          .trim();
        if (text.length > TEXT_THRESHOLD) textPages++;
        page.cleanup();
      }
      const scanPagesLocal = pageCount - textPages;
      scanPages = scanPagesLocal;
      el('file-info').hidden = false;
      refreshOcrButton();
      const note = el('engine-note');
      note.hidden = false;
      note.textContent =
        'First use downloads the text reader (a few MB); after that it is cached. Reading takes a while on long documents. Accuracy depends on scan quality: clean scans read well, blurry ones do not.';
    } catch (err) {
      showError('error-box', pdfJsLoadErrorMessage(err));
    }
  });

  el('ocr-btn').addEventListener('click', async () => {
    if (!file || !sourceBytes) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('ocr-btn', true, 'Reading…');
    try {
      const lang = select.value;
      const forceAll = el<HTMLInputElement>('ocr-force-all').checked;
      el('progress-label').textContent = 'Loading the text reader (first use only)…';
      el('progress-wrap').hidden = false;
      const w = await getWorker(lang);
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: sourceBytes.slice() }).promise;
      const plans: OcrPagePlan[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        setProgress(i, doc.numPages, 'Reading page {n} of {t}…');
        await new Promise((r) => setTimeout(r, 0)); // let the progress bar paint
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((it) => ('str' in it ? (it as { str: string }).str : ''))
          .join('')
          .trim();
        if (text.length > TEXT_THRESHOLD && !forceAll) {
          plans.push({ kind: 'keep', sourceIndex: i - 1 });
          page.cleanup();
          continue;
        }
        const canvas = await renderPageToCanvas(page, RENDER_DPI);
        const vp = page.getViewport({ scale: 1 });
        const scale = canvas.width / vp.width;
        page.cleanup();
        const { data } = await w.recognize(canvas);
        const words: OcrWordBox[] = [];
        for (const word of data.words ?? []) {
          if (!word.text.trim()) continue;
          const box = pixelBoxToPoints(word.bbox, scale);
          box.text = word.text;
          words.push(box);
        }
        const image = await canvasToBytes(canvas, 'image/png');
        plans.push({
          kind: 'ocr',
          image: { data: image, mime: 'image/png' },
          words,
          widthPt: vp.width,
          heightPt: vp.height,
        });
      }
      setProgress(doc.numPages, doc.numPages, 'Building the searchable PDF…');
      const out = await assembleSearchablePdf(sourceBytes.slice(), plans);
      const stem = (file.name || 'document.pdf').replace(/\.[^.]+$/, '');
      const outName = ocrFileName(stem);
      el('result-info').textContent =
        `${formatBytes(out.length)} · ${plans.filter((p) => p.kind === 'ocr').length} page` +
        `${plans.filter((p) => p.kind === 'ocr').length === 1 ? '' : 's'} got a text layer, the rest were copied unchanged.`;
      el('result').hidden = false;
      el<HTMLButtonElement>('download-btn').onclick = () => downloadBytes(outName, out, 'application/pdf');
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError(
        'error-box',
        /tesseract|stalled|fetch/i.test(err instanceof Error ? err.message : '')
          ? tesseractLoadErrorMessage(err)
          : err instanceof Error
            ? err.message
            : 'Reading failed.'
      );
    } finally {
      el('progress-wrap').hidden = true;
      setBusy('ocr-btn', false);
    }
  });
}
