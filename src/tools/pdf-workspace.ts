// PDF workspace: one screen for the common PDF jobs. Drop PDFs, see every
// page as a thumbnail, drag to reorder, rotate, delete, edit text in place,
// stamp watermarks / page numbers / headers, crop, password-protect, download.
// All structural edits apply to the thumbnail grid instantly; content edits
// (text, stamps, crop) are recorded and baked in at download time.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import {
  el,
  showError,
  hideError,
  setBusy,
  downloadBytes,
  mobileFileSizeGuard,
} from './common.ts';
import { loadPdfjs, renderPageToCanvas } from './pdf-render.ts';
import { encryptPdfBytes } from './pyodide-loader.ts';

type PdfJs = typeof import('pdfjs-dist');
type PdfJsDoc = import('pdfjs-dist').PDFDocumentProxy;

interface DocSource {
  id: number;
  name: string;
  bytes: Uint8Array;
  jsDoc: PdfJsDoc;
  libDoc: PDFDocument;
}

interface PageItem {
  uid: string;
  docId: number;
  pageIndex: number;
  rotation: 0 | 90 | 180 | 270;
  thumb: string | null;
}

interface TextEdit {
  pageUid: string;
  x: number; // PDF points, bottom-left origin
  y: number;
  size: number;
  font: 'sans' | 'serif' | 'mono';
  bold: boolean;
  italic: boolean;
  width: number;
  text: string;
}

interface CropRect {
  pageUid: string;
  x: number; // PDF points, bottom-left origin
  y: number;
  w: number;
  h: number;
}

interface UndoEntry {
  label: string;
  pages: PageItem[];
}

interface TextItem {
  str: string;
  x: number; // CSS px within the rendered page image
  y: number;
  w: number;
  h: number;
  pdfX: number; // PDF points, bottom-left origin
  pdfY: number;
  size: number;
  font: 'sans' | 'serif' | 'mono';
  bold: boolean;
  italic: boolean;
}

let pdfjs: PdfJs | null = null;
let docs: DocSource[] = [];
let pages: PageItem[] = [];
let selected = new Set<string>();
let undoStack: UndoEntry[] = [];
let nextDocId = 1;
let nextUid = 1;
let textEdits: TextEdit[] = [];
let crops = new Map<string, CropRect>();
let watermark: { text: string; opacity: number; size: number; angle: boolean } | null = null;
let pageNumbers: { pos: string; format: string; start: number; size: number } | null = null;
let headerFooter: { header: string; footer: string; size: number } | null = null;
let protectPassword: string | null = null;
let pageViewUid: string | null = null;

const THUMB_W = 168;

function uid(): string {
  return `p${nextUid++}`;
}

function pushUndo(label: string): void {
  undoStack.push({ label, pages: pages.map((p) => ({ ...p })) });
  if (undoStack.length > 50) undoStack.shift();
  el<HTMLButtonElement>('ws-undo').disabled = false;
}

function doUndo(): void {
  const entry = undoStack.pop();
  if (!entry) return;
  pages = entry.pages;
  selected.clear();
  textEdits = textEdits.filter((t) => pages.some((p) => p.uid === t.pageUid));
  for (const key of [...crops.keys()]) {
    if (!pages.some((p) => p.uid === key)) crops.delete(key);
  }
  el<HTMLButtonElement>('ws-undo').disabled = undoStack.length === 0;
  renderGrid();
  updateToolbar();
  setStatus(`${entry.label} undone.`);
}

function setStatus(msg: string): void {
  el('ws-status').textContent = msg;
}

function docOf(item: PageItem): DocSource {
  const d = docs.find((x) => x.id === item.docId);
  if (!d) throw new Error('A file went missing. Please add your PDFs again.');
  return d;
}

/* ---------------- file loading ---------------- */

async function ensurePdfjs(): Promise<PdfJs> {
  if (!pdfjs) pdfjs = await loadPdfjs();
  return pdfjs;
}

async function addFiles(files: File[]): Promise<void> {
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdfs.length === 0) {
    showError('error-box', 'Please choose PDF files.');
    return;
  }
  hideError('error-box');
  const sizeNote = el('size-note');
  sizeNote.hidden = true;
  for (const f of pdfs) {
    const guard = mobileFileSizeGuard(f);
    if (guard?.block) {
      showError('error-box', guard.message);
      continue;
    }
    if (guard) {
      sizeNote.textContent = guard.message;
      sizeNote.hidden = false;
    }
  }
  const ok = pdfs.filter((f) => !mobileFileSizeGuard(f)?.block);
  if (ok.length === 0) return;

  let js: PdfJs;
  try {
    js = await ensurePdfjs();
  } catch (err) {
    showError('error-box', err instanceof Error ? err.message : String(err));
    return;
  }
  for (const f of ok) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const jsDoc = await js.getDocument({ data: bytes.slice() }).promise;
      const libDoc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: false });
      const doc: DocSource = { id: nextDocId++, name: f.name, bytes, jsDoc, libDoc };
      docs.push(doc);
      for (let i = 0; i < jsDoc.numPages; i++) {
        pages.push({ uid: uid(), docId: doc.id, pageIndex: i, rotation: 0, thumb: null });
      }
      setStatus(`Added ${f.name} (${jsDoc.numPages} page${jsDoc.numPages === 1 ? '' : 's'}).`);
    } catch {
      showError('error-box', `Could not open "${f.name}". It may be damaged or password-protected.`);
    }
  }
  el('ws-dropzone').hidden = pages.length > 0;
  el('ws-toolbar').hidden = pages.length === 0;
  el('ws-grid').hidden = pages.length === 0;
  renderGrid();
  updateToolbar();
  void renderThumbsIncremental();
}

async function renderThumbsIncremental(): Promise<void> {
  for (const item of pages) {
    if (item.thumb) continue;
    try {
      item.thumb = await renderThumb(item);
      const img = document.querySelector<HTMLImageElement>(`img[data-uid="${item.uid}"]`);
      if (img) img.src = item.thumb;
    } catch {
      /* leave the placeholder */
    }
    await new Promise((r) => setTimeout(r, 0));
  }
}

async function renderThumb(item: PageItem): Promise<string> {
  const doc = docOf(item);
  const page = await doc.jsDoc.getPage(item.pageIndex + 1);
  // Render at device-pixel-ratio resolution (capped at 3x) but display at
  // THUMB_W CSS px, so thumbnails stay sharp on retina displays. Rotation is
  // baked into the render itself, never faked with CSS.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const base = page.getViewport({ scale: 1, rotation: item.rotation });
  const scale = (THUMB_W * dpr) / base.width;
  const viewport = page.getViewport({ scale, rotation: item.rotation });
  const canvas = await renderPageToCanvas(page, scale * 72, item.rotation);
  page.cleanup();
  if (!crops.get(item.uid)) return canvas.toDataURL('image/jpeg', 0.8);
  const crop = crops.get(item.uid)!;
  // Map the crop rect (stored in un-rotated PDF points) into the rendered
  // canvas through the viewport, so it stays correct on rotated pages.
  const [x1, y1] = viewport.convertToViewportPoint(crop.x, crop.y);
  const [x2, y2] = viewport.convertToViewportPoint(crop.x + crop.w, crop.y + crop.h);
  const sx = Math.min(x1, x2);
  const sy = Math.min(y1, y2);
  const sw = Math.abs(x2 - x1);
  const sh = Math.abs(y2 - y1);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  const ctx = out.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/jpeg', 0.8);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.8);
}

/* ---------------- thumbnail grid ---------------- */

function renderGrid(): void {
  const grid = el('ws-grid');
  grid.innerHTML = '';
  pages.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'ws-thumb' + (selected.has(item.uid) ? ' selected' : '');
    card.dataset.uid = item.uid;
    card.tabIndex = 0;
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', selected.has(item.uid) ? 'true' : 'false');
    card.setAttribute('aria-label', `Page ${idx + 1}`);

    const img = document.createElement('img');
    img.dataset.uid = item.uid;
    img.alt = `Page ${idx + 1}`;
    img.draggable = false;
    img.src = item.thumb ?? placeholderThumb();
    card.appendChild(img);

    const num = document.createElement('span');
    num.className = 'ws-num';
    num.textContent = String(idx + 1);
    card.appendChild(num);

    const bits: string[] = [];
    if (textEdits.some((t) => t.pageUid === item.uid)) bits.push('edited');
    if (crops.has(item.uid)) bits.push('cropped');
    if (bits.length) {
      const badges = document.createElement('span');
      badges.className = 'ws-badges';
      badges.textContent = bits.join(' · ');
      card.appendChild(badges);
    }

    const hover = document.createElement('div');
    hover.className = 'ws-hover';
    const rotBtn = document.createElement('button');
    rotBtn.type = 'button';
    rotBtn.className = 'ws-iconbtn';
    rotBtn.title = 'Rotate page';
    rotBtn.setAttribute('aria-label', `Rotate page ${idx + 1}`);
    rotBtn.textContent = '⟳';
    rotBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      rotateItems([item.uid]);
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ws-iconbtn ws-del';
    delBtn.title = 'Delete page';
    delBtn.setAttribute('aria-label', `Delete page ${idx + 1}`);
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteItems([item.uid]);
    });
    hover.appendChild(rotBtn);
    hover.appendChild(delBtn);
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ws-iconbtn ws-edit';
    editBtn.title = 'Open page editor';
    editBtn.setAttribute('aria-label', `Edit page ${idx + 1}`);
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void openPageView(item.uid);
    });
    hover.appendChild(editBtn);
    card.appendChild(hover);

    card.addEventListener('click', (e) => {
      if (suppressClick) return;
      const me = e as MouseEvent;
      if (me.shiftKey && pages.length) {
        const anchorIdx = pages.findIndex((p) => selected.has(p.uid));
        const from = anchorIdx >= 0 ? Math.min(anchorIdx, idx) : idx;
        const to = anchorIdx >= 0 ? Math.max(anchorIdx, idx) : idx;
        for (let i = from; i <= to; i++) selected.add(pages[i].uid);
      } else if (me.ctrlKey || me.metaKey) {
        if (selected.has(item.uid)) selected.delete(item.uid);
        else selected.add(item.uid);
      } else {
        selected.clear();
        selected.add(item.uid);
      }
      renderGrid();
      updateToolbar();
    });
    card.addEventListener('dblclick', () => void openPageView(item.uid));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void openPageView(item.uid);
      if (e.key === 'Delete' || e.key === 'Backspace') deleteItems([item.uid]);
    });

    card.addEventListener('pointerdown', (e) => onCardPointerDown(e, item, card));

    grid.appendChild(card);
  });
  updateCount();
}

function placeholderThumb(): string {
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="168" height="220"><rect width="168" height="220" fill="#f0f0f0"/></svg>'
  );
}

function updateCount(): void {
  const n = pages.length;
  setStatus(
    n === 0
      ? ''
      : `${n} page${n === 1 ? '' : 's'}` +
          (selected.size ? ` · ${selected.size} selected` : '') +
          (watermark ? ' · watermark on' : '') +
          (pageNumbers ? ' · page numbers on' : '') +
          (headerFooter ? ' · header/footer on' : '') +
          (protectPassword ? ' · password on' : '')
  );
}

/* ---------------- smooth drag & drop (pointer-based) ----------------
 * Replaces HTML5 drag-and-drop with a pointer-event system that gives:
 * - FLIP-animated reflow: cards glide aside as the drop gap moves
 * - A real gap indicator showing exactly where pages will land
 * - Touch drag (long-press to start, so vertical scroll still works)
 * - Multi-select drag: dragging one selected page moves the whole selection
 * - A floating ghost that follows the pointer
 */

interface WsDrag {
  uids: string[];
  ghost: HTMLElement;
  gap: HTMLElement;
  insertIndex: number;
  pointerId: number;
}

interface WsPending {
  uid: string;
  card: HTMLElement;
  startX: number;
  startY: number;
  pointerId: number;
  isTouch: boolean;
  timer: number | null;
}

let activeDrag: WsDrag | null = null;
let pendingDrag: WsPending | null = null;
/** Set on drop so the click that follows pointerup doesn't toggle selection. */
let suppressClick = false;

const DRAG_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 350;
const REDUCED_MOTION =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function onCardPointerDown(e: PointerEvent, item: PageItem, card: HTMLElement): void {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if ((e.target as HTMLElement).closest('button, input, a')) return;
  if (activeDrag || pendingDrag) return;
  const isTouch = e.pointerType === 'touch';
  const p: WsPending = {
    uid: item.uid,
    card,
    startX: e.clientX,
    startY: e.clientY,
    pointerId: e.pointerId,
    isTouch,
    timer: null,
  };
  if (isTouch) {
    // Long-press to start on touch so a normal swipe still scrolls the page.
    p.timer = window.setTimeout(() => {
      if (pendingDrag === p) beginDrag(p, p.startX, p.startY);
    }, LONG_PRESS_MS);
  }
  pendingDrag = p;
  window.addEventListener('pointermove', onDragPointerMove, { passive: false });
  window.addEventListener('pointerup', onDragPointerUp);
  window.addEventListener('pointercancel', onDragPointerCancel);
}

function onDragPointerMove(e: PointerEvent): void {
  const p = pendingDrag;
  if (p && !activeDrag) {
    if (e.pointerId !== p.pointerId) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (p.isTouch) {
      // Any real movement before the long-press fires means "scroll", not "drag".
      if (Math.hypot(dx, dy) > 10) cancelPending();
      return;
    }
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) beginDrag(p, e.clientX, e.clientY);
    return;
  }
  const d = activeDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  if (e.cancelable) e.preventDefault();
  moveGhost(d, e.clientX, e.clientY);
  updateDropGap(d, e.clientX, e.clientY);
  autoScroll(e.clientY);
}

function onDragPointerUp(e: PointerEvent): void {
  if (pendingDrag && !activeDrag) {
    // Plain click: leave selection to the card's click handler.
    cancelPending();
    return;
  }
  const d = activeDrag;
  if (!d || e.pointerId !== d.pointerId) return;
  endDrag(true);
}

function onDragPointerCancel(): void {
  if (activeDrag) endDrag(false);
  else cancelPending();
}

function cancelPending(): void {
  if (pendingDrag?.timer) window.clearTimeout(pendingDrag.timer);
  pendingDrag = null;
  window.removeEventListener('pointermove', onDragPointerMove);
  window.removeEventListener('pointerup', onDragPointerUp);
  window.removeEventListener('pointercancel', onDragPointerCancel);
}

/** Which pages travel with this drag: the whole selection if the grabbed
 *  card is selected, otherwise just the grabbed card. */
function dragUids(grabbedUid: string): string[] {
  if (selected.has(grabbedUid)) return pages.filter((p) => selected.has(p.uid)).map((p) => p.uid);
  return [grabbedUid];
}

function beginDrag(p: WsPending, x: number, y: number): void {
  if (p.timer) window.clearTimeout(p.timer);
  pendingDrag = null;
  const grid = el('ws-grid');
  const uids = dragUids(p.uid);

  // If the grabbed card wasn't selected, it becomes the selection now.
  if (!selected.has(p.uid)) {
    selected.clear();
    for (const u of uids) selected.add(u);
    grid.querySelectorAll('.ws-thumb.selected').forEach((c) => {
      c.classList.remove('selected');
      c.setAttribute('aria-selected', 'false');
    });
    p.card.classList.add('selected');
    p.card.setAttribute('aria-selected', 'true');
    updateToolbar();
  }

  // Lift the dragged cards out of flow (slots stay hidden) and put a visible
  // gap where the block currently sits.
  const lifted = new Set(uids);
  grid.querySelectorAll<HTMLElement>('.ws-thumb').forEach((c) => {
    if (c.dataset.uid && lifted.has(c.dataset.uid)) c.classList.add('ws-lifted');
  });
  const gap = document.createElement('div');
  gap.className = 'ws-gap';
  gap.setAttribute('aria-hidden', 'true');
  if (uids.length > 1) {
    const label = document.createElement('span');
    label.textContent = `${uids.length} pages`;
    gap.appendChild(label);
  }
  const firstLifted = grid.querySelector('.ws-thumb.ws-lifted');
  grid.insertBefore(gap, firstLifted);

  // Floating ghost that follows the pointer.
  const ghost = document.createElement('div');
  ghost.className = 'ws-ghost';
  const w = p.card.offsetWidth || 150;
  const h = p.card.offsetHeight || 200;
  ghost.style.width = `${w}px`;
  ghost.style.height = `${h}px`;
  const img = p.card.querySelector('img');
  if (img) {
    const g = document.createElement('img');
    g.src = (img as HTMLImageElement).src;
    g.alt = '';
    g.draggable = false;
    ghost.appendChild(g);
  }
  if (uids.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'ws-ghost-count';
    badge.textContent = `×${uids.length}`;
    ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);

  activeDrag = { uids, ghost, gap, insertIndex: dropIndexFromDom(grid, gap), pointerId: p.pointerId };
  document.body.classList.add('ws-dragging');
  grid.querySelectorAll<HTMLElement>('.ws-thumb.ws-lifted').forEach((c) =>
    c.setAttribute('aria-grabbed', 'true')
  );
  moveGhost(activeDrag, x, y);
  window.addEventListener('keydown', onDragKeyDown);
}

function moveGhost(d: WsDrag, x: number, y: number): void {
  const w = d.ghost.offsetWidth;
  const h = d.ghost.offsetHeight;
  d.ghost.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) rotate(2deg)`;
}

/** Count of non-lifted cards before the gap = index into the remaining list. */
function dropIndexFromDom(grid: HTMLElement, gap: HTMLElement): number {
  let n = 0;
  for (const kid of Array.from(grid.children)) {
    if (kid === gap) break;
    if (kid.classList.contains('ws-thumb') && !kid.classList.contains('ws-lifted')) n++;
  }
  return n;
}

/** Find where the pointer sits in reading order and slide the gap there,
 *  FLIP-animating the other cards out of the way. */
function updateDropGap(d: WsDrag, x: number, y: number): void {
  const grid = el('ws-grid');
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.ws-thumb:not(.ws-lifted)'));
  let index = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (y < cy - r.height * 0.15) {
      index = i;
      break;
    }
    if (Math.abs(y - cy) <= r.height * 0.65 && x < cx) {
      index = i;
      break;
    }
  }
  if (index === d.insertIndex) return;
  d.insertIndex = index;
  flipGrid(grid, () => {
    const ref = cards[index] ?? null;
    grid.insertBefore(d.gap, ref);
  });
}

/** Animate a DOM mutation with FLIP: snapshot positions, mutate, invert,
 *  then play the transition. Cards glide instead of jumping. */
function flipGrid(grid: HTMLElement, mutate: () => void): void {
  if (REDUCED_MOTION) {
    mutate();
    return;
  }
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.ws-thumb:not(.ws-lifted)'));
  const before = new Map<string, DOMRect>();
  for (const c of cards) {
    if (c.dataset.uid) before.set(c.dataset.uid, c.getBoundingClientRect());
  }
  mutate();
  const animated: HTMLElement[] = [];
  for (const c of cards) {
    const b = c.dataset.uid ? before.get(c.dataset.uid) : undefined;
    if (!b) continue;
    const a = c.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (dx !== 0 || dy !== 0) {
      c.style.transition = 'none';
      c.style.transform = `translate(${dx}px, ${dy}px)`;
      animated.push(c);
    }
  }
  if (!animated.length) return;
  void grid.offsetHeight; // force reflow so the inversion takes hold
  requestAnimationFrame(() => {
    for (const c of animated) {
      c.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.7, 0.3, 1)';
      c.style.transform = '';
    }
    window.setTimeout(() => {
      for (const c of animated) {
        c.style.transition = '';
        c.style.transform = '';
      }
    }, 260);
  });
}

let scrollRaf = 0;
function autoScroll(clientY: number): void {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const edge = 70;
    if (clientY < edge) window.scrollBy(0, -16);
    else if (clientY > window.innerHeight - edge) window.scrollBy(0, 16);
  });
}

function onDragKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && activeDrag) endDrag(false);
}

function endDrag(commit: boolean): void {
  const d = activeDrag;
  activeDrag = null;
  window.removeEventListener('keydown', onDragKeyDown);
  window.removeEventListener('pointermove', onDragPointerMove);
  window.removeEventListener('pointerup', onDragPointerUp);
  window.removeEventListener('pointercancel', onDragPointerCancel);
  document.body.classList.remove('ws-dragging');
  if (!d) return;

  d.ghost.remove();
  d.gap.remove();
  el('ws-grid')
    .querySelectorAll('.ws-thumb.ws-lifted')
    .forEach((c) => {
      c.classList.remove('ws-lifted');
      c.removeAttribute('aria-grabbed');
    });

  if (commit) {
    const moving = pages.filter((pg) => d.uids.includes(pg.uid));
    const rest = pages.filter((pg) => !d.uids.includes(pg.uid));
    const at = Math.max(0, Math.min(d.insertIndex, rest.length));
    const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    const changed = next.length !== pages.length || next.some((pg, i) => pg.uid !== pages[i].uid);
    if (changed) {
      pushUndo(moving.length > 1 ? `Move ${moving.length} pages` : 'Reorder pages');
      pages = next;
    }
  }
  renderGrid();
  updateToolbar();

  // Swallow the click that the browser fires after pointerup.
  suppressClick = true;
  window.setTimeout(() => {
    suppressClick = false;
  }, 50);
}

function updateToolbar(): void {
  const sel = selected.size > 0;
  el<HTMLButtonElement>('ws-rotate').disabled = !sel;
  el<HTMLButtonElement>('ws-delete').disabled = !sel;
  el<HTMLButtonElement>('ws-extract').disabled = !sel;
  const single = selected.size === 1;
  el<HTMLButtonElement>('ws-text').disabled = !single;
  el<HTMLButtonElement>('ws-crop').disabled = !single;
  el<HTMLButtonElement>('ws-undo').disabled = undoStack.length === 0;
  updateCount();
}

/* ---------------- structural operations ---------------- */

function selectedItems(): PageItem[] {
  return pages.filter((p) => selected.has(p.uid));
}

function rotateItems(uids: string[]): void {
  pushUndo('Rotate');
  for (const u of uids) {
    const p = pages.find((x) => x.uid === u);
    if (p) {
      p.rotation = ((p.rotation + 90) % 360) as PageItem['rotation'];
      p.thumb = null; // re-render so the thumbnail itself rotates, right away
    }
  }
  renderGrid();
  updateToolbar();
  setStatus('Page rotated.');
  void renderThumbsIncremental();
}

function deleteItems(uids: string[]): void {
  pushUndo(`Delete ${uids.length === 1 ? 'page' : 'pages'}`);
  const gone = new Set(uids);
  pages = pages.filter((p) => !gone.has(p.uid));
  for (const u of gone) selected.delete(u);
  textEdits = textEdits.filter((t) => !gone.has(t.pageUid));
  for (const u of gone) crops.delete(u);
  if (pages.length === 0) {
    el('ws-dropzone').hidden = false;
    el('ws-toolbar').hidden = true;
    el('ws-grid').hidden = true;
  }
  renderGrid();
  updateToolbar();
  setStatus('Page deleted. Undo brings it back.');
}

async function extractSelected(): Promise<void> {
  const items = selectedItems();
  if (items.length === 0) return;
  setBusy('ws-extract', true, 'Saving…');
  try {
    const out = await buildPdf(items, { skipStamps: false, skipProtect: true });
    downloadBytes('extracted-pages.pdf', out, 'application/pdf');
    setStatus(`Saved ${items.length} page${items.length === 1 ? '' : 's'} as a new PDF.`);
  } catch {
    showError('error-box', 'Could not save those pages. Please try again.');
  } finally {
    setBusy('ws-extract', false);
  }
}

/* ---------------- download ---------------- */

interface BuildOpts {
  skipStamps: boolean;
  skipProtect: boolean;
}

async function buildPdf(items: PageItem[], opts: BuildOpts): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const fonts = {
    sans: await out.embedFont(StandardFonts.Helvetica),
    sansBold: await out.embedFont(StandardFonts.HelveticaBold),
    sansItalic: await out.embedFont(StandardFonts.HelveticaOblique),
    sansBoldItalic: await out.embedFont(StandardFonts.HelveticaBoldOblique),
    serif: await out.embedFont(StandardFonts.TimesRoman),
    serifBold: await out.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await out.embedFont(StandardFonts.TimesRomanItalic),
    serifBoldItalic: await out.embedFont(StandardFonts.TimesRomanBoldItalic),
    mono: await out.embedFont(StandardFonts.Courier),
    monoBold: await out.embedFont(StandardFonts.CourierBold),
  };

  const byDoc = new Map<number, number[]>();
  items.forEach((it, i) => {
    if (!byDoc.has(it.docId)) byDoc.set(it.docId, []);
    byDoc.get(it.docId)!.push(i);
  });
  const newPages: import('pdf-lib').PDFPage[] = new Array(items.length);
  for (const [docId, idxs] of byDoc) {
    const doc = docs.find((d) => d.id === docId)!;
    const srcIdxs = idxs.map((i) => items[i].pageIndex);
    const copied = await out.copyPages(doc.libDoc, srcIdxs);
    idxs.forEach((itemPos, k) => {
      newPages[itemPos] = copied[k];
    });
  }
  for (const np of newPages) out.addPage(np);

  items.forEach((item, i) => {
    const page = out.getPage(i);
    if (item.rotation) {
      const cur = page.getRotation().angle;
      page.setRotation(degrees((cur + item.rotation) % 360));
    }
    const crop = crops.get(item.uid);
    if (crop) {
      page.setCropBox(crop.x, crop.y, crop.w, crop.h);
      page.setTrimBox(crop.x, crop.y, crop.w, crop.h);
    }
    for (const t of textEdits.filter((x) => x.pageUid === item.uid)) {
      page.drawRectangle({ x: t.x - 1, y: t.y - 2, width: t.width + 2, height: t.size + 4, color: rgb(1, 1, 1) });
      const key = `${t.font}${t.bold ? 'Bold' : ''}${t.italic ? 'Italic' : ''}` as keyof typeof fonts;
      page.drawText(t.text, { x: t.x, y: t.y, size: t.size, font: fonts[key] ?? fonts.sans, color: rgb(0, 0, 0) });
    }
  });

  if (!opts.skipStamps) {
    applyWatermark(out, fonts.sans);
    applyPageNumbers(out, items.length, fonts.sans);
    applyHeaderFooter(out, items.length, fonts.sans);
  }

  if (!opts.skipProtect && protectPassword) {
    // pdf-lib cannot write encrypted PDFs, so pypdf (via Pyodide) applies it.
    const plain = await out.save();
    return encryptPdfBytes(plain, protectPassword);
  }
  return out.save();
}

function applyWatermark(out: PDFDocument, font: import('pdf-lib').PDFFont): void {
  if (!watermark || !watermark.text.trim()) return;
  const n = out.getPageCount();
  for (let i = 0; i < n; i++) {
    const page = out.getPage(i);
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(watermark.text, watermark.size);
    page.drawText(watermark.text, {
      x: width / 2 - tw / 2,
      y: height / 2,
      size: watermark.size,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: watermark.opacity,
      rotate: watermark.angle ? degrees(-45) : degrees(0),
    });
  }
}

function applyPageNumbers(out: PDFDocument, count: number, font: import('pdf-lib').PDFFont): void {
  if (!pageNumbers) return;
  for (let i = 0; i < count; i++) {
    const page = out.getPage(i);
    const { width, height } = page.getSize();
    const num = pageNumbers.start + i;
    const text =
      pageNumbers.format === 'n-of-n' ? `${num} of ${pageNumbers.start + count - 1}` : pageNumbers.format === 'page-n' ? `Page ${num}` : String(num);
    const tw = font.widthOfTextAtSize(text, pageNumbers.size);
    let x = width / 2 - tw / 2;
    let y = 36;
    if (pageNumbers.pos === 'top-center') y = height - 36;
    else if (pageNumbers.pos === 'bottom-left') x = 36;
    else if (pageNumbers.pos === 'bottom-right') x = width - tw - 36;
    else if (pageNumbers.pos === 'top-left') { x = 36; y = height - 36; }
    else if (pageNumbers.pos === 'top-right') { x = width - tw - 36; y = height - 36; }
    page.drawText(text, { x, y, size: pageNumbers.size, font, color: rgb(0.35, 0.35, 0.35) });
  }
}

function applyHeaderFooter(out: PDFDocument, count: number, font: import('pdf-lib').PDFFont): void {
  if (!headerFooter) return;
  for (let i = 0; i < count; i++) {
    const page = out.getPage(i);
    const { width, height } = page.getSize();
    if (headerFooter.header.trim()) {
      const t = headerFooter.header;
      const tw = font.widthOfTextAtSize(t, headerFooter.size);
      page.drawText(t, { x: width / 2 - tw / 2, y: height - 30, size: headerFooter.size, font, color: rgb(0.35, 0.35, 0.35) });
    }
    if (headerFooter.footer.trim()) {
      const t = headerFooter.footer;
      const tw = font.widthOfTextAtSize(t, headerFooter.size);
      page.drawText(t, { x: width / 2 - tw / 2, y: 24, size: headerFooter.size, font, color: rgb(0.35, 0.35, 0.35) });
    }
  }
}

async function downloadAll(): Promise<void> {
  if (pages.length === 0) return;
  setBusy('ws-download', true, 'Building…');
  hideError('error-box');
  try {
    const bytes = await buildPdf(pages, { skipStamps: false, skipProtect: false });
    downloadBytes('edited.pdf', bytes, 'application/pdf');
    setStatus('Your PDF is downloading.');
  } catch {
    showError('error-box', 'Could not build the PDF. Please try again.');
  } finally {
    setBusy('ws-download', false);
  }
}

/* ---------------- page view: edit text ---------------- */

function classifyFont(name: string): { font: 'sans' | 'serif' | 'mono'; bold: boolean; italic: boolean } {
  const n = name.toLowerCase();
  const bold = /bold|black|heavy|demi/.test(n);
  const italic = /italic|oblique/.test(n);
  let font: 'sans' | 'serif' | 'mono' = 'sans';
  if (/courier|mono|consol|typewriter/.test(n)) font = 'mono';
  else if (/times|georgia|garamond|serif|palatino|bookman|charter|cambria|minion/.test(n)) font = 'serif';
  return { font, bold, italic };
}

async function openPageView(pageUid: string): Promise<void> {
  const item = pages.find((p) => p.uid === pageUid);
  if (!item) return;
  pageViewUid = pageUid;
  el('ws-grid').hidden = true;
  el('ws-toolbar').hidden = true;
  el('ws-pageview').hidden = false;
  const idx = pages.indexOf(item);
  el('ws-pv-label').textContent = `Page ${idx + 1} of ${pages.length}`;
  const stage = el('ws-pv-stage');
  stage.innerHTML = '<p class="hint">Loading page…</p>';
  try {
    await ensurePdfjs();
    const doc = docOf(item);
    const page = await doc.jsDoc.getPage(item.pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const targetW = Math.min(760, base.width * 2);
    const scale = targetW / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = await renderPageToCanvas(page, scale * 72);
    canvas.className = 'ws-pv-canvas';

    const wrap = document.createElement('div');
    wrap.className = 'ws-pv-wrap';
    wrap.style.width = `${viewport.width}px`;
    wrap.appendChild(canvas);

    const tc = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of tc.items) {
      const ti = raw as unknown as { str: string; transform: number[]; width: number; height: number; fontName: string };
      if (!ti.str.trim()) continue;
      const [a, b, , , e, f] = ti.transform;
      const size = Math.hypot(a, b);
      if (size < 3) continue;
      const x = e * scale;
      const yTop = (base.height - f) * scale;
      const w = ti.width * scale;
      const h = Math.max(ti.height * scale, size * scale * 0.9);
      const cls = classifyFont(ti.fontName || '');
      items.push({
        str: ti.str, x, y: yTop - h * 0.15, w, h: h * 1.25,
        pdfX: e, pdfY: f - size * 0.2, size,
        font: cls.font, bold: cls.bold, italic: cls.italic,
      });
    }
    for (const t of items) {
      const hit = document.createElement('div');
      hit.className = 'ws-text-hit';
      hit.style.left = `${t.x}px`;
      hit.style.top = `${t.y}px`;
      hit.style.width = `${Math.max(t.w, 8)}px`;
      hit.style.height = `${t.h}px`;
      hit.title = 'Click to edit';
      hit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        startTextEdit(wrap, t, scale);
      });
      wrap.appendChild(hit);
    }
    page.cleanup();
    stage.innerHTML = '';
    stage.appendChild(wrap);
    for (const e2 of textEdits.filter((x) => x.pageUid === pageUid)) {
      paintEditOverlay(wrap, e2, scale, base.height);
    }
    paintStampOverlays(wrap, idx, scale, viewport.width, viewport.height);
  } catch {
    stage.innerHTML = '';
    showError('error-box', 'Could not open that page. Please try again.');
    closePageView();
  }
}

function paintStampOverlays(wrap: HTMLElement, pageIdx: number, scale: number, w: number, h: number): void {
  if (watermark && watermark.text.trim()) {
    const wm = document.createElement('div');
    wm.className = 'ws-pv-watermark';
    wm.textContent = watermark.text;
    wm.style.fontSize = `${watermark.size * scale}px`;
    wm.style.opacity = String(watermark.opacity);
    if (watermark.angle) wm.style.transform = 'translate(-50%, -50%) rotate(-45deg)';
    wrap.appendChild(wm);
  }
  if (pageNumbers) {
    const num = pageNumbers.start + pageIdx;
    const text = pageNumbers.format === 'n-of-n' ? `${num} of ${pageNumbers.start + pages.length - 1}` : pageNumbers.format === 'page-n' ? `Page ${num}` : String(num);
    const pn = document.createElement('div');
    pn.className = 'ws-pv-pagenum';
    pn.textContent = text;
    pn.style.fontSize = `${pageNumbers.size * scale}px`;
    const pos = pageNumbers.pos;
    if (pos.includes('top')) pn.style.top = '12px'; else pn.style.bottom = '12px';
    if (pos.includes('left')) pn.style.left = '16px';
    else if (pos.includes('right')) pn.style.right = '16px';
    else { pn.style.left = '50%'; pn.style.transform = 'translateX(-50%)'; }
    wrap.appendChild(pn);
  }
  if (headerFooter) {
    if (headerFooter.header.trim()) {
      const hd = document.createElement('div');
      hd.className = 'ws-pv-header';
      hd.textContent = headerFooter.header;
      hd.style.fontSize = `${headerFooter.size * scale}px`;
      wrap.appendChild(hd);
    }
    if (headerFooter.footer.trim()) {
      const ft = document.createElement('div');
      ft.className = 'ws-pv-footer';
      ft.textContent = headerFooter.footer;
      ft.style.fontSize = `${headerFooter.size * scale}px`;
      wrap.appendChild(ft);
    }
  }
}

function paintEditOverlay(wrap: HTMLElement, e2: TextEdit, scale: number, pageH: number): void {
  const div = document.createElement('div');
  div.className = 'ws-text-overlay';
  div.style.left = `${e2.x * scale}px`;
  div.style.top = `${(pageH - e2.y - e2.size) * scale}px`;
  div.style.fontSize = `${e2.size * scale}px`;
  div.style.fontFamily = e2.font === 'serif' ? 'Georgia, serif' : e2.font === 'mono' ? 'monospace' : 'sans-serif';
  div.style.fontWeight = e2.bold ? 'bold' : 'normal';
  div.style.fontStyle = e2.italic ? 'italic' : 'normal';
  div.textContent = e2.text;
  wrap.appendChild(div);
}

function startTextEdit(wrap: HTMLElement, t: TextItem, scale: number): void {
  wrap.querySelector('.ws-text-editor')?.remove();
  const ed = document.createElement('div');
  ed.className = 'ws-text-editor';
  ed.contentEditable = 'true';
  ed.spellcheck = false;
  ed.style.left = `${t.x - 2}px`;
  ed.style.top = `${t.y - 2}px`;
  ed.style.minWidth = `${Math.max(t.w + 4, 40)}px`;
  ed.style.fontSize = `${t.size * scale}px`;
  ed.style.fontFamily = t.font === 'serif' ? 'Georgia, serif' : t.font === 'mono' ? 'monospace' : 'sans-serif';
  ed.style.fontWeight = t.bold ? 'bold' : 'normal';
  ed.style.fontStyle = t.italic ? 'italic' : 'normal';
  ed.textContent = t.str;
  wrap.appendChild(ed);
  ed.focus();
  document.getSelection()?.selectAllChildren(ed);

  const commit = (saveIt: boolean) => {
    const text = (ed.textContent ?? '').trim();
    ed.remove();
    if (saveIt && text && text !== t.str && pageViewUid) {
      textEdits = textEdits.filter(
        (x) => !(x.pageUid === pageViewUid && Math.abs(x.x - t.pdfX) < 1 && Math.abs(x.y - t.pdfY) < 1)
      );
      textEdits.push({
        pageUid: pageViewUid, x: t.pdfX, y: t.pdfY, size: t.size,
        font: t.font, bold: t.bold, italic: t.italic, width: t.w / scale, text,
      });
      const item = pages.find((p) => p.uid === pageViewUid);
      if (item) {
        item.thumb = null;
        void renderThumb(item).then((url) => {
          item.thumb = url;
        });
      }
      setStatus('Text updated. It will appear in the download.');
    }
    renderGrid();
  };
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(true);
    }
    if (e.key === 'Escape') commit(false);
  });
  ed.addEventListener('blur', () => commit(true));
}

function closePageView(): void {
  pageViewUid = null;
  el('ws-pageview').hidden = true;
  el('ws-grid').hidden = pages.length === 0;
  el('ws-toolbar').hidden = pages.length === 0;
  renderGrid();
  updateToolbar();
}

/* ---------------- crop ---------------- */

async function startCrop(): Promise<void> {
  const item = pages.find((p) => p.uid === pageViewUid);
  if (!item) return;
  const wrap = document.querySelector<HTMLElement>('.ws-pv-wrap');
  const canvas = document.querySelector<HTMLCanvasElement>('.ws-pv-canvas');
  if (!wrap || !canvas) return;
  const doc = docOf(item);
  const page = await doc.jsDoc.getPage(item.pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  page.cleanup();
  const scale = canvas.width / base.width;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  const existing = crops.get(item.uid);
  let m = existing
    ? {
        l: existing.x * scale,
        b: existing.y * scale,
        r: (base.width - existing.x - existing.w) * scale,
        t: (base.height - existing.y - existing.h) * scale,
      }
    : { l: 0, b: 0, r: 0, t: 0 };

  const box = document.createElement('div');
  box.className = 'ws-crop-box';
  wrap.appendChild(box);
  el('ws-pv-hint').textContent = 'Drag the edges to crop. Click "Done cropping" to finish.';

  const paint = () => {
    box.style.left = `${m.l}px`;
    box.style.top = `${m.t}px`;
    box.style.width = `${Math.max(8, W - m.l - m.r)}px`;
    box.style.height = `${Math.max(8, H - m.t - m.b)}px`;
  };
  paint();

  let drag: { edge: 'l' | 'r' | 't' | 'b'; startX: number; startY: number; m0: typeof m } | null = null;
  for (const edge of ['l', 'r', 't', 'b'] as const) {
    const h = document.createElement('div');
    h.className = `ws-crop-handle ${edge}`;
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag = { edge, startX: e.clientX, startY: e.clientY, m0: { ...m } };
    });
    h.addEventListener('pointermove', (e) => {
      if (!drag || drag.edge !== edge) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const nm = { ...drag.m0 };
      if (edge === 'l') nm.l = Math.min(Math.max(0, drag.m0.l + dx), W - drag.m0.r - 20);
      if (edge === 'r') nm.r = Math.min(Math.max(0, drag.m0.r - dx), W - drag.m0.l - 20);
      if (edge === 't') nm.t = Math.min(Math.max(0, drag.m0.t + dy), H - drag.m0.b - 20);
      if (edge === 'b') nm.b = Math.min(Math.max(0, drag.m0.b - dy), H - drag.m0.t - 20);
      m = nm;
      paint();
    });
    h.addEventListener('pointerup', () => {
      drag = null;
    });
    box.appendChild(h);
  }

  const finish = () => {
    box.remove();
    el('ws-pv-crop').textContent = 'Crop this page';
    el('ws-pv-crop').onclick = () => void startCrop();
    el('ws-pv-hint').textContent = 'Click any text on the page to edit it.';
    const x = m.l / scale;
    const y = m.b / scale;
    const w = (W - m.l - m.r) / scale;
    const h = (H - m.t - m.b) / scale;
    if (m.l + m.r + m.t + m.b < 4) crops.delete(item.uid);
    else crops.set(item.uid, { pageUid: item.uid, x, y, w, h });
    item.thumb = null;
    renderGrid();
    void renderThumbsIncremental();
    setStatus('Crop saved. It applies when you download.');
  };

  el('ws-pv-crop').textContent = 'Done cropping';
  el('ws-pv-crop').onclick = finish;
}

/* ---------------- dialogs ---------------- */

function openDialog(title: string, body: HTMLElement, onOk: () => void): void {
  el('ws-dialog-title').textContent = title;
  const bodyEl = el('ws-dialog-body');
  bodyEl.innerHTML = '';
  bodyEl.appendChild(body);
  el('ws-dialog').hidden = false;
  el('ws-dialog-ok').onclick = () => {
    closeDialog();
    onOk();
    updateToolbar();
  };
  el('ws-dialog-cancel').onclick = closeDialog;
}

function closeDialog(): void {
  el('ws-dialog').hidden = true;
}

function field(label: string, input: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  wrap.appendChild(lab);
  wrap.appendChild(input);
  return wrap;
}

function textInput(value: string, placeholder = ''): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value;
  i.placeholder = placeholder;
  return i;
}

function openWatermarkDialog(): void {
  const body = document.createElement('div');
  const text = textInput(watermark?.text ?? 'Confidential', 'e.g. Confidential');
  const op = document.createElement('input');
  op.type = 'range';
  op.min = '10';
  op.max = '80';
  op.value = String(Math.round((watermark?.opacity ?? 0.25) * 100));
  const opVal = document.createElement('span');
  opVal.textContent = `${op.value}%`;
  op.addEventListener('input', () => (opVal.textContent = `${op.value}%`));
  const size = document.createElement('input');
  size.type = 'range';
  size.min = '24';
  size.max = '120';
  size.value = String(watermark?.size ?? 64);
  const angle = document.createElement('input');
  angle.type = 'checkbox';
  angle.checked = watermark?.angle ?? true;
  const angleLab = document.createElement('label');
  angleLab.append('Diagonal ', angle);
  body.append(field('Text', text));
  const opWrap = document.createElement('div');
  opWrap.className = 'field';
  opWrap.append('Lightness ', op, ' ', opVal);
  body.append(opWrap);
  const sizeWrap = document.createElement('div');
  sizeWrap.className = 'field';
  sizeWrap.append('Size ', size);
  body.append(sizeWrap);
  body.append(angleLab);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-secondary';
  clear.textContent = 'Remove watermark';
  clear.addEventListener('click', () => {
    watermark = null;
    closeDialog();
    updateToolbar();
    setStatus('Watermark removed.');
  });
  body.append(clear);
  openDialog('Watermark', body, () => {
    watermark = text.value.trim()
      ? { text: text.value.trim(), opacity: Number(op.value) / 100, size: Number(size.value), angle: angle.checked }
      : null;
    setStatus(watermark ? 'Watermark set. It stamps every page on download.' : 'Watermark removed.');
  });
}

function openPageNumDialog(): void {
  const body = document.createElement('div');
  const pos = document.createElement('select');
  const positions: Array<[string, string]> = [
    ['bottom-center', 'Bottom center'],
    ['bottom-left', 'Bottom left'],
    ['bottom-right', 'Bottom right'],
    ['top-center', 'Top center'],
    ['top-left', 'Top left'],
    ['top-right', 'Top right'],
  ];
  for (const [v, l] of positions) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    if (pageNumbers?.pos === v) o.selected = true;
    pos.appendChild(o);
  }
  const fmt = document.createElement('select');
  const formats: Array<[string, string]> = [
    ['n', '1, 2, 3'],
    ['n-of-n', '1 of 12, 2 of 12'],
    ['page-n', 'Page 1, Page 2'],
  ];
  for (const [v, l] of formats) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = l;
    if (pageNumbers?.format === v) o.selected = true;
    fmt.appendChild(o);
  }
  const start = document.createElement('input');
  start.type = 'number';
  start.min = '1';
  start.value = String(pageNumbers?.start ?? 1);
  body.append(field('Position', pos));
  body.append(field('Style', fmt));
  body.append(field('Start numbering at', start));
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-secondary';
  clear.textContent = 'Remove page numbers';
  clear.addEventListener('click', () => {
    pageNumbers = null;
    closeDialog();
    updateToolbar();
    setStatus('Page numbers removed.');
  });
  body.append(clear);
  openDialog('Page numbers', body, () => {
    pageNumbers = { pos: pos.value, format: fmt.value, start: Math.max(1, Number(start.value) || 1), size: 11 };
    setStatus('Page numbers set. They appear on download.');
  });
}

function openHeaderFooterDialog(): void {
  const body = document.createElement('div');
  const header = textInput(headerFooter?.header ?? '', 'Text at the top of every page');
  const footer = textInput(headerFooter?.footer ?? '', 'Text at the bottom of every page');
  body.append(field('Header', header));
  body.append(field('Footer', footer));
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-secondary';
  clear.textContent = 'Remove header and footer';
  clear.addEventListener('click', () => {
    headerFooter = null;
    closeDialog();
    updateToolbar();
    setStatus('Header and footer removed.');
  });
  body.append(clear);
  openDialog('Header and footer', body, () => {
    headerFooter = header.value.trim() || footer.value.trim()
      ? { header: header.value.trim(), footer: footer.value.trim(), size: 10 }
      : null;
    setStatus(headerFooter ? 'Header and footer set. They appear on download.' : 'Header and footer removed.');
  });
}

function openProtectDialog(): void {
  const body = document.createElement('div');
  const pw = document.createElement('input');
  pw.type = 'password';
  pw.placeholder = 'Choose a password';
  pw.autocomplete = 'new-password';
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = protectPassword
    ? 'A password is already set. Enter a new one to change it, or clear it below.'
    : 'Anyone opening the downloaded PDF will need this password.';
  body.append(note);
  body.append(field('Password', pw));
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-secondary';
  clear.textContent = 'Remove password';
  clear.addEventListener('click', () => {
    protectPassword = null;
    closeDialog();
    updateToolbar();
    setStatus('Password removed.');
  });
  body.append(clear);
  openDialog('Protect with a password', body, () => {
    if (pw.value) {
      protectPassword = pw.value;
      setStatus('Password set. The download will ask for it.');
    }
  });
}

/* ---------------- init ---------------- */

export function initPdfWorkspace(): void {
  const dz = el('ws-dropzone');
  const input = el<HTMLInputElement>('ws-file-input');

  const onFiles = (files: File[]) => {
    if (files.length) void addFiles(files);
  };
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    onFiles([...(input.files ?? [])]);
    input.value = '';
  });
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragging');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragging');
    onFiles([...(e.dataTransfer?.files ?? [])]);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (files.length) void addFiles(files);
  });

  el('ws-add').addEventListener('click', () => input.click());
  el('ws-undo').addEventListener('click', doUndo);
  el('ws-rotate').addEventListener('click', () => rotateItems([...selected]));
  el('ws-delete').addEventListener('click', () => deleteItems([...selected]));
  el('ws-extract').addEventListener('click', () => void extractSelected());
  el('ws-text').addEventListener('click', () => {
    const items = selectedItems();
    if (items.length === 1) void openPageView(items[0].uid);
  });
  el('ws-crop').addEventListener('click', async () => {
    const items = selectedItems();
    if (items.length === 1) {
      await openPageView(items[0].uid);
      void startCrop();
    }
  });
  el('ws-watermark').addEventListener('click', openWatermarkDialog);
  el('ws-pagenum').addEventListener('click', openPageNumDialog);
  el('ws-headerfooter').addEventListener('click', openHeaderFooterDialog);
  el('ws-protect').addEventListener('click', openProtectDialog);
  el('ws-download').addEventListener('click', () => void downloadAll());
  el('ws-pv-back').addEventListener('click', closePageView);
  el('ws-pv-crop').addEventListener('click', () => void startCrop());

  document.addEventListener('keydown', (e) => {
    const inEditor = (e.target as HTMLElement).closest?.('.ws-text-editor, input, select, textarea');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inEditor) {
      e.preventDefault();
      doUndo();
    }
    if (e.key === 'Escape' && !el('ws-dialog').hidden) closeDialog();
    else if (e.key === 'Escape' && !el('ws-pageview').hidden && !inEditor) closePageView();
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inEditor && el('ws-pageview').hidden && selected.size) {
      e.preventDefault();
      deleteItems([...selected]);
    }
  });

  updateToolbar();
}
