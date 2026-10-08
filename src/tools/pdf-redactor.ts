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

/* ---------------- batch pattern redaction ---------------- */

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Box a text item on the preview canvas, in canvas pixels.
 * pdf.js reports item.width already in PDF points for horizontal text
 * (verified against pdf-lib measurements); the box is padded generously
 * because for redaction, covering too much beats covering too little.
 * Rotated runs are skipped — they are rare, and hand-drawn boxes still work.
 */
function itemRect(item: TextItemLike, st: PageState): Rect | null {
  const t = item.transform;
  if (!t || t.length < 6) return null;
  const [a, b, c, , e, f] = t;
  const size = Math.hypot(a, b);
  if (!(size > 0)) return null;
  if (Math.abs(b) > size * 0.12 || Math.abs(c) > size * 0.12) return null;
  const s = st.canvas.width / st.widthPt;
  const x = e * s;
  const w = item.width * s;
  if (!(w > 1)) return null;
  const h = Math.max(item.height, size) * s;
  const yBase = (st.heightPt - f) * s; // baseline, measured from the top
  const padX = Math.max(2, h * 0.18);
  const top = Math.max(0, yBase - h - padX * 0.5);
  const bottom = yBase + h * 0.38 + padX * 0.5;
  const left = Math.max(0, x - padX);
  const right = Math.min(st.canvas.width, x + w + padX);
  if (right <= left) return null;
  return { x: left, y: top, width: right - left, height: Math.max(2, bottom - top) };
}

function luhnOk(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

interface FindPattern {
  id: string;
  label: string;
  test: (str: string) => boolean;
}

const FIND_PATTERNS: FindPattern[] = [
  {
    id: 'email',
    label: 'Email addresses',
    test: (s) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s),
  },
  {
    id: 'phone',
    label: 'Phone numbers',
    test: (s) => /(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/.test(s),
  },
  {
    id: 'ssn',
    label: 'ID numbers (123-45-6789)',
    test: (s) => /\b\d{3}-\d{2}-\d{4}\b/.test(s),
  },
  {
    id: 'card',
    label: 'Card numbers',
    test: (s) => {
      const m = s.match(/\b(?:\d[ -]?){13,19}\b/);
      return !!m && luhnOk(m[0].replace(/\D/g, ''));
    },
  },
];

/** Mark every text item on every page whose text matches `test`. */
async function markMatches(test: (str: string) => boolean, busyLabel: string): Promise<number> {
  let marked = 0;
  const status = el('find-status');
  for (const st of pages) {
    status.textContent = `${busyLabel} — page ${st.pageIndex + 1} of ${pages.length}…`;
    await new Promise((r) => setTimeout(r, 0)); // let the status paint
    const proxy = await st.doc.getPage(st.pageIndex + 1);
    try {
      const tc = await proxy.getTextContent();
      for (const raw of tc.items) {
        const it = raw as unknown as TextItemLike;
        if (!it.str || !test(it.str)) continue;
        const rc = itemRect(it, st);
        if (rc) {
          st.rects.push(rc);
          marked++;
        }
      }
    } finally {
      proxy.cleanup();
    }
    drawRects(st);
  }
  updateCounts();
  return marked;
}

function initFindPanel(): void {
  const bar = el('find-bar');
  for (const p of FIND_PATTERNS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary';
    b.textContent = p.label;
    b.addEventListener('click', () => {
      void (async () => {
        hideError('error-box');
        b.disabled = true;
        try {
          const n = await markMatches(p.test, `Finding ${p.label.toLowerCase()}`);
          el('find-status').textContent =
            n === 0
              ? `No ${p.label.toLowerCase()} found. They may be inside scanned images, which have no readable text.`
              : `${n} spot${n === 1 ? '' : 's'} marked. Review every page before downloading — automatic search can miss things.`;
        } catch {
          el('find-status').textContent = '';
          showError('error-box', 'The search failed. Please try again.');
        } finally {
          b.disabled = false;
        }
      })();
    });
    bar.appendChild(b);
  }
  const customBtn = el<HTMLButtonElement>('find-custom-btn');
  customBtn.addEventListener('click', () => {
    const q = el<HTMLInputElement>('find-custom-input').value.trim().toLowerCase();
    if (!q) {
      showError('error-box', 'Type the text to find first.');
      return;
    }
    void (async () => {
      hideError('error-box');
      customBtn.disabled = true;
      try {
        const n = await markMatches((s) => s.toLowerCase().includes(q), `Finding "${q}"`);
        el('find-status').textContent =
          n === 0
            ? `Nothing matched "${q}".`
            : `${n} spot${n === 1 ? '' : 's'} marked. Review every page before downloading.`;
      } catch {
        el('find-status').textContent = '';
        showError('error-box', 'The search failed. Please try again.');
      } finally {
        customBtn.disabled = false;
      }
    })();
  });
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
    el('find-status').textContent = '';
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
      el('find-panel').hidden = true;
      const loading = document.createElement('p');
      loading.className = 'hint';
      loading.setAttribute('role', 'status');
      loading.innerHTML = '<span class="spinner" aria-hidden="true"></span> Loading pages…';
      holder.appendChild(loading);

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
        label.append(labelText);
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
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'link-btn';
        undoBtn.textContent = 'Undo last';
        undoBtn.addEventListener('click', () => {
          state.rects.pop();
          drawRects(state);
          updateCounts();
        });
        label.append(labelText, undoBtn, clearBtn);

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
      loading.remove();
      el('find-panel').hidden = false;
      updateCounts();
    } catch (err) {
      el('find-panel').hidden = true;
      el('pages-wrap').innerHTML = '';
      el('pages-empty').hidden = false;
      showError('error-box', pdfJsLoadErrorMessage(err));
    }
  });

  initFindPanel();

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
