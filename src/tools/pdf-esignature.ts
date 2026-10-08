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
    // Number placements on the same page: "Page 2", "Page 2 (2)", …
    const samePage = placements.slice(0, i + 1).filter((q) => q.pageIndex === p.pageIndex).length;
    name.textContent = samePage > 1 ? `Page ${p.pageIndex + 1} (${samePage})` : `Page ${p.pageIndex + 1}`;
    const hint = document.createElement('span');
    hint.className = 'file-meta';
    hint.textContent = 'drag on the page to move';
    const actions = document.createElement('span');
    actions.className = 'file-actions';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn';
    rm.setAttribute('aria-label', `Remove signature ${i + 1} from page ${p.pageIndex + 1}`);
    rm.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>';
    rm.addEventListener('click', () => {
      placements.splice(i, 1);
      paintOverlays();
      renderPlacements();
      refreshSignButton();
    });
    actions.appendChild(rm);
    li.append(name, hint, actions);
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
        img.alt = '';
        // Percentages: the stage is sized in CSS px, the canvas may be CSS-scaled.
        img.style.left = `${(p.x / pv.canvas.width) * 100}%`;
        img.style.top = `${(p.y / pv.canvas.height) * 100}%`;
        img.style.width = `${(p.width / pv.canvas.width) * 100}%`;
        img.style.height = `${(p.height / pv.canvas.height) * 100}%`;
        img.style.cursor = 'grab';
        img.style.touchAction = 'none';
        // Keyboard: focus a placement and nudge it with the arrow keys.
        img.tabIndex = 0;
        img.setAttribute(
          'aria-label',
          `Signature on page ${p.pageIndex + 1}. Arrow keys move it, Delete removes it.`
        );
        img.addEventListener('keydown', (e) => {
          const step = e.shiftKey ? 20 : 4;
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowLeft') dx = -step;
          else if (e.key === 'ArrowRight') dx = step;
          else if (e.key === 'ArrowUp') dy = -step;
          else if (e.key === 'ArrowDown') dy = step;
          else if (e.key === 'Delete' || e.key === 'Backspace') {
            const idx = placements.indexOf(p);
            if (idx >= 0) {
              placements.splice(idx, 1);
              paintOverlays();
              renderPlacements();
              refreshSignButton();
            }
            e.preventDefault();
            return;
          } else return;
          e.preventDefault();
          p.x = Math.min(Math.max(0, p.x + dx), pv.canvas.width - p.width);
          p.y = Math.min(Math.max(0, p.y + dy), pv.canvas.height - p.height);
          img.style.left = `${(p.x / pv.canvas.width) * 100}%`;
          img.style.top = `${(p.y / pv.canvas.height) * 100}%`;
        });
        // Pointer drag to reposition.
        img.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          img.setPointerCapture(e.pointerId);
          const startX = e.clientX;
          const startY = e.clientY;
          const origX = p.x;
          const origY = p.y;
          const rect = pv.canvas.getBoundingClientRect();
          const sx = pv.canvas.width / Math.max(1, rect.width);
          const sy = pv.canvas.height / Math.max(1, rect.height);
          img.style.cursor = 'grabbing';
          const move = (ev: PointerEvent) => {
            p.x = Math.min(
              Math.max(0, origX + (ev.clientX - startX) * sx),
              pv.canvas.width - p.width
            );
            p.y = Math.min(
              Math.max(0, origY + (ev.clientY - startY) * sy),
              pv.canvas.height - p.height
            );
            img.style.left = `${(p.x / pv.canvas.width) * 100}%`;
            img.style.top = `${(p.y / pv.canvas.height) * 100}%`;
          };
          const up = () => {
            img.removeEventListener('pointermove', move);
            img.removeEventListener('pointerup', up);
            img.removeEventListener('pointercancel', up);
            img.style.cursor = 'grab';
            // A drag ends in a click on the stage; do not treat it as a
            // request to place another signature.
            lastDragEnd = Date.now();
          };
          img.addEventListener('pointermove', move);
          img.addEventListener('pointerup', up);
          img.addEventListener('pointercancel', up);
        });
        pv.stage.appendChild(img);
      });
  }
}

/** Timestamp of the last overlay drag end; stage clicks right after are ignored. */
let lastDragEnd = 0;

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

  // ---- tabs: draw vs type vs photo ----
  const tabDraw = el('sig-tab-draw');
  const tabType = el('sig-tab-type');
  const tabPhoto = el('sig-tab-photo');
  const tabs = [
    { btn: tabDraw, panel: 'sig-panel-draw' },
    { btn: tabType, panel: 'sig-panel-type' },
    { btn: tabPhoto, panel: 'sig-panel-photo' },
  ];
  function showTab(active: number): void {
    tabs.forEach((t, i) => {
      el(t.panel).hidden = i !== active;
      t.btn.classList.toggle('tab-active', i === active);
      t.btn.setAttribute('aria-selected', String(i === active));
    });
  }
  tabs.forEach((t, i) => t.btn.addEventListener('click', () => showTab(i)));

  // ---- photo signature: lift ink off paper with background removal ----
  let photoFile: File | null = null;
  const photoInput = el<HTMLInputElement>('sig-photo-input');
  const photoBtn = el<HTMLButtonElement>('sig-use-photo');
  const photoStatus = el('sig-photo-status');
  photoInput.addEventListener('change', () => {
    photoFile = photoInput.files?.[0] ?? null;
    photoBtn.disabled = !photoFile;
    photoStatus.textContent = photoFile ? `${photoFile.name} selected.` : '';
  });
  photoBtn.addEventListener('click', async () => {
    if (!photoFile) return;
    hideError('error-box');
    photoStatus.textContent = 'Lifting the signature off the background…';
    photoBtn.disabled = true;
    setBusy('sig-use-photo', true, 'Working…');
    try {
      const { loadBackgroundRemoval, bgEngineLoadErrorMessage } = await import('./bgremove-loader.ts');
      let blob: Blob;
      try {
        const { removeBackground } = await loadBackgroundRemoval();
        blob = await removeBackground(photoFile, {
          output: { format: 'image/png', quality: 1 },
        });
      } catch (err) {
        throw new Error(bgEngineLoadErrorMessage(err));
      }
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error('Could not read the processed photo.'));
          im.src = url;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Your browser could not create a drawing surface.');
        ctx.drawImage(img, 0, 0);
        photoStatus.textContent = '';
        await useSignature(c);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      photoStatus.textContent = '';
      showError('error-box', err instanceof Error ? err.message : 'Could not process that photo.');
    } finally {
      photoBtn.disabled = !photoFile;
      setBusy('sig-use-photo', false);
    }
  });

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
    // Re-scale every already-placed signature to the new size, keeping each
    // one's center fixed on the page (sizes are per-page, canvas widths differ).
    if (placements.length === 0) return;
    for (const p of placements) {
      const pv = pageViews[p.pageIndex];
      if (!pv) continue;
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      const { width, height } = signatureSizeFor(pv);
      p.width = width;
      p.height = height;
      p.x = Math.min(Math.max(0, cx - width / 2), Math.max(0, pv.canvas.width - width));
      p.y = Math.min(Math.max(0, cy - height / 2), Math.max(0, pv.canvas.height - height));
    }
    paintOverlays();
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
        label.textContent = `Page ${i + 1}. Click to place your signature`;
        const stage = document.createElement('div');
        stage.className = 'redact-stage sig-stage';
        stage.appendChild(canvas);
        block.append(label, stage);
        holder.appendChild(block);
        const pv: PageView = { canvas, stage, widthPt: pt.width, heightPt: pt.height, pageIndex: i };
        pageViews.push(pv);
        stage.addEventListener('click', (e) => {
          // Ignore the click that a signature drag ends with, and clicks
          // that land on an existing placed signature (bubbles up from it).
          if (Date.now() - lastDragEnd < 200) return;
          if ((e.target as HTMLElement).closest('.sig-placed')) return;
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
          // Multiple signatures per page are allowed; each click adds one.
          placements.push({ pageIndex: i, x, y, width, height });
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
      const pageCount = new Set(list.map((l) => l.pageIndex)).size;
      el('result-info').textContent =
        `${formatBytes(out.length)} · ${list.length} signature${list.length === 1 ? '' : 's'} on ${pageCount} page${pageCount === 1 ? '' : 's'}`;
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

  showTab(0);
  refreshSignButton();
}
