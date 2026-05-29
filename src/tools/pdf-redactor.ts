// Redact PDF tool: DOM glue. Rebuild logic lives in ../lib/pdf-redact.ts
import { redactPdf, type RedactedPageBitmap } from '../lib/pdf-redact.ts';
import { loadPdfjs, renderPageToCanvas, canvasToBytes, pdfJsLoadErrorMessage } from './pdf-render.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
} from './common.ts';

const PREVIEW_DPI = 110;
const OUTPUT_DPI = 150;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageState {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  rects: Rect[];
  widthPt: number;
  heightPt: number;
  doc: import('pdfjs-dist').PDFDocumentProxy;
  pageIndex: number;
}

let fileName = 'document.pdf';
let sourceBytes: Uint8Array | null = null;
let pages: PageState[] = [];
let pdfDoc: import('pdfjs-dist').PDFDocumentProxy | null = null;

function toCanvasCoords(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left) / r.width) * canvas.width,
    y: ((clientY - r.top) / r.height) * canvas.height,
  };
}

function drawRects(state: PageState): void {
  state.overlay.innerHTML = '';
  const cw = state.canvas.width;
  const ch = state.canvas.height;
  state.rects.forEach((rc, i) => {
    const d = document.createElement('div');
    d.className = 'redact-box';
    // Percentages: the overlay is sized in CSS px, the canvas may be CSS-scaled.
    d.style.left = `${(rc.x / cw) * 100}%`;
    d.style.top = `${(rc.y / ch) * 100}%`;
    d.style.width = `${(rc.width / cw) * 100}%`;
    d.style.height = `${(rc.height / ch) * 100}%`;
    d.title = `Marked area ${i + 1}. Double-click to remove`;
    d.addEventListener('dblclick', () => {
      state.rects.splice(i, 1);
      drawRects(state);
      updateCounts();
    });
    state.overlay.appendChild(d);
  });
}

function updateCounts(): void {
  const markedPages = pages.filter((p) => p.rects.length > 0).length;
  const totalRects = pages.reduce((a, p) => a + p.rects.length, 0);
  el('count-label').textContent =
    totalRects === 0
      ? ''
      : `${totalRects} area${totalRects === 1 ? '' : 's'} marked on ${markedPages} page${markedPages === 1 ? '' : 's'}`;
  el<HTMLButtonElement>('redact-btn').disabled = totalRects === 0;
}

function setProgress(done: number, total: number, label: string): void {
  const wrap = el('progress-wrap');
  wrap.hidden = false;
  el('progress-bar').style.width = `${Math.round((done / total) * 100)}%`;
  el('progress-label').textContent = label.replace('{n}', String(done)).replace('{t}', String(total));
}

export function initPdfRedactor(): void {
  const redactBtn = el<HTMLButtonElement>('redact-btn');

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    const file = files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showError('error-box', `"${file.name}" is not a PDF.`);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      sourceBytes = bytes.slice();
      const pdfjs = await loadPdfjs();
      pdfDoc = await pdfjs.getDocument({ data: bytes }).promise;
      fileName = file.name;
      pages = [];
      const holder = el('pages-wrap');
      holder.innerHTML = '';
      el('pages-empty').hidden = true;

      for (let i = 0; i < pdfDoc.numPages; i++) {
        const proxy = await pdfDoc.getPage(i + 1);
        const canvas = await renderPageToCanvas(proxy, PREVIEW_DPI);
        const pt = proxy.getViewport({ scale: 1 });
        const block = document.createElement('div');
        block.className = 'redact-page';
        const label = document.createElement('div');
        label.className = 'redact-page-label';
        const labelText = document.createElement('span');
        labelText.textContent = `Page ${i + 1}`;
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'link-btn';
        clearBtn.textContent = 'Clear marks';
        label.append(labelText, clearBtn);
        const stage = document.createElement('div');
        stage.className = 'redact-stage';
        const overlay = document.createElement('div');
        overlay.className = 'redact-overlay';
        stage.append(canvas, overlay);
        block.append(label, stage);
        holder.appendChild(block);

        const state: PageState = {
          canvas,
          overlay,
          rects: [],
          widthPt: pt.width,
          heightPt: pt.height,
          doc: pdfDoc,
          pageIndex: i,
        };
        clearBtn.addEventListener('click', () => {
          state.rects = [];
          drawRects(state);
          updateCounts();
        });

        let drawing: { x0: number; y0: number } | null = null;
        let ghost: HTMLElement | null = null;
        overlay.addEventListener('pointerdown', (e) => {
          const p = toCanvasCoords(canvas, e.clientX, e.clientY);
          drawing = { x0: p.x, y0: p.y };
          ghost = document.createElement('div');
          ghost.className = 'redact-box redact-ghost';
          overlay.appendChild(ghost);
          overlay.setPointerCapture(e.pointerId);
        });
        overlay.addEventListener('pointermove', (e) => {
          if (!drawing || !ghost) return;
          const p = toCanvasCoords(canvas, e.clientX, e.clientY);
          const x = Math.min(drawing.x0, p.x);
          const y = Math.min(drawing.y0, p.y);
          ghost.style.left = `${(x / canvas.width) * 100}%`;
          ghost.style.top = `${(y / canvas.height) * 100}%`;
          ghost.style.width = `${(Math.abs(p.x - drawing.x0) / canvas.width) * 100}%`;
          ghost.style.height = `${(Math.abs(p.y - drawing.y0) / canvas.height) * 100}%`;
        });
        overlay.addEventListener('pointerup', (e) => {
          if (!drawing) return;
          const p = toCanvasCoords(canvas, e.clientX, e.clientY);
          const x = Math.min(drawing.x0, p.x);
          const y = Math.min(drawing.y0, p.y);
          const w = Math.abs(p.x - drawing.x0);
          const h = Math.abs(p.y - drawing.y0);
          ghost?.remove();
          ghost = null;
          drawing = null;
          if (w >= 8 && h >= 8) {
            state.rects.push({ x, y: y, width: w, height: h });
            drawRects(state);
            updateCounts();
          }
        });
        pages.push(state);
        proxy.cleanup();
      }
      updateCounts();
    } catch (err) {
      showError('error-box', pdfJsLoadErrorMessage(err));
    }
  });

  redactBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('redact-btn', true, 'Redacting…');
    try {
      const marked = pages.filter((p) => p.rects.length > 0);
      const bitmaps: RedactedPageBitmap[] = [];
      let done = 0;
      for (const st of marked) {
        setProgress(done + 1, marked.length, 'Redacting page {n} of {t}…');
        await new Promise((r) => setTimeout(r, 0));
        const proxy = await st.doc.getPage(st.pageIndex + 1);
        const canvas = await renderPageToCanvas(proxy, OUTPUT_DPI);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Your browser could not create a drawing surface.');
        const sx = canvas.width / st.canvas.width;
        const sy = canvas.height / st.canvas.height;
        ctx.fillStyle = '#000000';
        for (const rc of st.rects) {
          ctx.fillRect(rc.x * sx, rc.y * sy, rc.width * sx, rc.height * sy);
        }
        const data = await canvasToBytes(canvas, 'image/png');
        bitmaps.push({
          pageIndex: st.pageIndex,
          data,
          mime: 'image/png',
          widthPt: st.widthPt,
          heightPt: st.heightPt,
        });
        proxy.cleanup();
        done++;
      }
      // Rebuild from our own copy of the source bytes (pdf.js got its own copy).
      if (!sourceBytes) throw new Error('The PDF data was lost. Add the file again.');
      const out = await redactPdf(sourceBytes, bitmaps);
      const stem = fileName.replace(/\.[^.]+$/, '');
      el('result-info').textContent =
        `${formatBytes(out.length)} · ${marked.length} page${marked.length === 1 ? '' : 's'} redacted as images, ` +
        `the rest untouched`;
      el('result').hidden = false;
      el<HTMLButtonElement>('download-btn').onclick = () =>
        downloadBytes(`${stem}-redacted.pdf`, out, 'application/pdf');
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Redaction failed.');
    } finally {
      el('progress-wrap').hidden = true;
      setBusy('redact-btn', false);
    }
  });

  updateCounts();
}
