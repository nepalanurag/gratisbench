// E-signature tool: DOM glue. Placement math + flattening live in ../lib/pdf-esign.ts
import { signPdf, previewRectToPdf, type SignaturePlacement } from '../lib/pdf-esign.ts';
import { loadPdfjs, renderPageToCanvas, pdfJsLoadErrorMessage } from './pdf-render.ts';
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
const PAD_W = 520;
const PAD_H = 180;

interface PlacedSig {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageView {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  widthPt: number;
  heightPt: number;
  pageIndex: number;
}

let sigPng: Uint8Array | null = null;
let sigW = 0;
let sigH = 0;
let sourceBytes: Uint8Array | null = null;
let fileName = 'document.pdf';
let pageViews: PageView[] = [];
let placements: PlacedSig[] = [];

/** Cut transparent/white margins off a signature canvas. */
function trimCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;
  const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src; // blank
  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')?.drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

async function useSignature(canvas: HTMLCanvasElement): Promise<void> {
  const trimmed = trimCanvas(canvas);
  const url = trimmed.toDataURL('image/png');
  if (trimmed.width < 10 || trimmed.height < 10) {
    showError('error-box', 'The signature looks empty. Draw or type something first.');
    return;
  }
  const bytes = new Uint8Array(
    await (await fetch(url)).arrayBuffer()
  );
  sigPng = bytes;
  sigW = trimmed.width;
  sigH = trimmed.height;
  const img = el<HTMLImageElement>('sig-preview');
  img.src = url;
  img.hidden = false;
  el('sig-status').textContent = 'Signature ready. Now click on a page below to place it.';
  hideError('error-box');
  refreshSignButton();
}

function refreshSignButton(): void {
  el<HTMLButtonElement>('sign-btn').disabled = !sigPng || placements.length === 0 || !sourceBytes;
  const n = placements.length;
  el('placements-label').textContent =
    n === 0 ? 'No placements yet.' : `${n} placement${n === 1 ? '' : 's'}`;
}

function renderPlacements(): void {
  const list = el('placements-list');
  list.innerHTML = '';
  placements.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'file-row';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = `Page ${p.pageIndex + 1}`;
    const actions = document.createElement('span');
    actions.className = 'file-actions';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn';
    rm.setAttribute('aria-label', `Remove signature from page ${p.pageIndex + 1}`);
    rm.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>';
    rm.addEventListener('click', () => {
      placements.splice(i, 1);
      paintOverlays();
      renderPlacements();
      refreshSignButton();
    });
    actions.appendChild(rm);
    li.append(name, actions);
    list.appendChild(li);
  });
}

/** Draw the placed signature images on top of each page preview. */
function paintOverlays(): void {
  for (const pv of pageViews) {
    pv.stage.querySelectorAll('.sig-placed').forEach((n) => n.remove());
    placements
      .filter((p) => p.pageIndex === pv.pageIndex)
      .forEach((p) => {
        const img = document.createElement('img');
        img.className = 'sig-placed';
        img.src = el<HTMLImageElement>('sig-preview').src;
        // Percentages: the stage is sized in CSS px, the canvas may be CSS-scaled.
        img.style.left = `${(p.x / pv.canvas.width) * 100}%`;
        img.style.top = `${(p.y / pv.canvas.height) * 100}%`;
        img.style.width = `${(p.width / pv.canvas.width) * 100}%`;
        img.style.height = `${(p.height / pv.canvas.height) * 100}%`;
        pv.stage.appendChild(img);
      });
  }
}

function signatureSizeFor(pv: PageView): { width: number; height: number } {
  const scale = Number(el<HTMLInputElement>('sig-scale').value) / 100;
  // Natural pad pixels map 1:1 onto preview pixels; the slider scales up/down.
  const width = Math.min(sigW * scale, pv.canvas.width * 0.9);
  const height = (width / sigW) * sigH;
  return { width, height };
}

export function initPdfEsignature(): void {
  // ---- signature pad ----
  const pad = el<HTMLCanvasElement>('sig-pad');
  pad.width = PAD_W;
  pad.height = PAD_H;
  const pctx = pad.getContext('2d');
  let stroking = false;
  let last: { x: number; y: number } | null = null;

  function padPos(e: PointerEvent): { x: number; y: number } {
    const r = pad.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * pad.width,
      y: ((e.clientY - r.top) / r.height) * pad.height,
    };
  }
  pad.addEventListener('pointerdown', (e) => {
    stroking = true;
    last = padPos(e);
    pad.setPointerCapture(e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!stroking || !pctx || !last) return;
    const p = padPos(e);
    pctx.strokeStyle = '#14213d';
    pctx.lineWidth = 3.2;
    pctx.lineCap = 'round';
    pctx.lineJoin = 'round';
    pctx.beginPath();
    pctx.moveTo(last.x, last.y);
    pctx.lineTo(p.x, p.y);
    pctx.stroke();
    last = p;
  });
  for (const evt of ['pointerup', 'pointercancel', 'pointerleave']) {
    pad.addEventListener(evt, () => {
      stroking = false;
      last = null;
    });
  }
  el('sig-clear').addEventListener('click', () => {
    pctx?.clearRect(0, 0, pad.width, pad.height);
  });
  el('sig-use-drawn').addEventListener('click', () => void useSignature(pad));

  // ---- tabs: draw vs type ----
  const tabDraw = el('sig-tab-draw');
  const tabType = el('sig-tab-type');
  function showTab(draw: boolean): void {
    el('sig-panel-draw').hidden = !draw;
    el('sig-panel-type').hidden = draw;
    tabDraw.classList.toggle('tab-active', draw);
    tabType.classList.toggle('tab-active', !draw);
    tabDraw.setAttribute('aria-selected', String(draw));
    tabType.setAttribute('aria-selected', String(!draw));
  }
  tabDraw.addEventListener('click', () => showTab(true));
  tabType.addEventListener('click', () => showTab(false));

  el('sig-create').addEventListener('click', () => {
    const name = el<HTMLInputElement>('sig-name').value.trim();
    if (!name) {
      showError('error-box', 'Type your name first.');
      return;
    }
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 200;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#14213d';
    ctx.font = '92px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.slice(0, 40), 320, 104);
    void useSignature(c);
  });

  el('sig-scale').addEventListener('input', (e) => {
    el('sig-scale-value').textContent = `${(e.target as HTMLInputElement).value}%`;
  });

  // ---- document ----
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
      fileName = file.name;
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      pageViews = [];
      placements = [];
      const holder = el('pages-wrap');
      holder.innerHTML = '';
      el('pages-empty').hidden = true;
      for (let i = 0; i < doc.numPages; i++) {
        const proxy = await doc.getPage(i + 1);
        const canvas = await renderPageToCanvas(proxy, PREVIEW_DPI);
        const pt = proxy.getViewport({ scale: 1 });
        const block = document.createElement('div');
        block.className = 'redact-page';
        const label = document.createElement('div');
        label.className = 'redact-page-label';
        label.textContent = `Page ${i + 1} — click to place your signature`;
        const stage = document.createElement('div');
        stage.className = 'redact-stage sig-stage';
        stage.appendChild(canvas);
        block.append(label, stage);
        holder.appendChild(block);
        const pv: PageView = { canvas, stage, widthPt: pt.width, heightPt: pt.height, pageIndex: i };
        pageViews.push(pv);
        stage.addEventListener('click', (e) => {
          if (!sigPng) {
            showError('error-box', 'Create your signature first (draw or type it above).');
            return;
          }
          hideError('error-box');
          const r = canvas.getBoundingClientRect();
          const cx = ((e.clientX - r.left) / r.width) * canvas.width;
          const cy = ((e.clientY - r.top) / r.height) * canvas.height;
          const { width, height } = signatureSizeFor(pv);
          const x = Math.min(Math.max(0, cx - width / 2), canvas.width - width);
          const y = Math.min(Math.max(0, cy - height / 2), canvas.height - height);
          const existing = placements.findIndex((p) => p.pageIndex === i);
          const placed: PlacedSig = { pageIndex: i, x, y, width, height };
          if (existing >= 0) placements[existing] = placed;
          else placements.push(placed);
          paintOverlays();
          renderPlacements();
          refreshSignButton();
        });
        proxy.cleanup();
      }
      paintOverlays();
      renderPlacements();
      refreshSignButton();
      el('doc-info').textContent = `${file.name} · ${doc.numPages} page${doc.numPages === 1 ? '' : 's'} · ${formatBytes(file.size)}`;
      await doc.destroy();
    } catch (err) {
      showError('error-box', pdfJsLoadErrorMessage(err));
    }
  });

  el('sign-btn').addEventListener('click', async () => {
    if (!sigPng || !sourceBytes || placements.length === 0) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('sign-btn', true, 'Signing…');
    try {
      const list: SignaturePlacement[] = placements.map((p) => {
        const pv = pageViews[p.pageIndex];
        const pdf = previewRectToPdf(
          { x: p.x, y: p.y, width: p.width, height: p.height },
          pv.canvas.width,
          pv.canvas.height,
          pv.widthPt,
          pv.heightPt
        );
        return { pageIndex: p.pageIndex, ...pdf };
      });
      const out = await signPdf(sourceBytes, sigPng, list);
      const stem = fileName.replace(/\.[^.]+$/, '');
      el('result-info').textContent = `${formatBytes(out.length)} · signed on ${list.length} page${list.length === 1 ? '' : 's'}`;
      el('result').hidden = false;
      el<HTMLButtonElement>('download-btn').onclick = () =>
        downloadBytes(`${stem}-signed.pdf`, out, 'application/pdf');
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Signing failed.');
    } finally {
      setBusy('sign-btn', false);
    }
  });

  showTab(true);
  refreshSignButton();
}
