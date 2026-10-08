// PDF to Handwriting: renders text as realistic handwriting on canvas.
// Each letter is drawn separately with small random tilt, size, and spacing
// differences so it does not read as a repeating font. All client-side.
import { PDFDocument } from 'pdf-lib';
import {
  el,
  showError,
  hideError,
  setBusy,
  downloadBytes,
  mobileFileSizeGuard,
} from './common.ts';
import { loadPdfjs } from './pdf-render.ts';

type StyleId = 'casual' | 'neat' | 'cursive' | 'custom';

const FONTS: Record<StyleId, string> = {
  casual: "'Caveat', cursive",
  neat: "'Kalam', cursive",
  cursive: "'Dancing Script', cursive",
  custom: "'Caveat', cursive", // fallback when a drawn letter is missing
};

/** Built-in font to measure/fall back with ('custom' uses casual as its stand-in). */
function baseFontFor(style: StyleId): string {
  return FONTS[style === 'custom' ? 'casual' : style];
}

const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Dancing+Script:wght@600;700&family=Kalam:wght@400;700&display=swap';

// A4 at 150 DPI: good print quality without huge files.
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 110;

let pdfFile: File | null = null;
let pdfTextPages: Array<Array<{ str: string; x: number; y: number; size: number }>> | null = null;
let pdfPageImages: string[] | null = null;
let resultPngs: string[] = [];

function loadFonts(): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector('link[data-hw-fonts]')) {
      void document.fonts.ready.then(() => resolve());
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    link.dataset.hwFonts = '1';
    link.onload = () => void document.fonts.ready.then(() => resolve());
    link.onerror = () => resolve(); // fall back to cursive generic
    document.head.appendChild(link);
    // Do not hang forever on a blocked font CDN.
    setTimeout(() => resolve(), 8000);
  });
}

async function ensureStyleFont(style: StyleId): Promise<void> {
  if (style === 'custom') return; // drawn letters need no webfont
  try {
    await document.fonts.load(`600 40px ${FONTS[style]}`);
  } catch {
    /* fallback fonts still render */
  }
}

/** Deterministic pseudo-random from a seed so re-renders look identical. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface HwOpts {
  style: StyleId;
  ink: string;
  size: number;
  slant: number; // degrees, negative leans left
  mess: number; // 0..100, scales the per-letter variation
}

/* ---------------- custom (draw-your-own) handwriting ---------------- */

interface Glyph {
  img: HTMLImageElement;
  aspect: number; // width / height of the trimmed drawing
}

const GLYPH_KEY = 'truepdf-hw-glyphs-v1';
const glyphCache = new Map<string, Glyph>();

export const DRAW_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function readGlyphStore(): Record<string, { url: string; aspect: number }> {
  try {
    return JSON.parse(localStorage.getItem(GLYPH_KEY) || '{}') as Record<string, { url: string; aspect: number }>;
  } catch {
    return {};
  }
}

function writeGlyphStore(store: Record<string, { url: string; aspect: number }>): void {
  try {
    localStorage.setItem(GLYPH_KEY, JSON.stringify(store));
  } catch {
    /* storage full or unavailable: drawings just won't persist */
  }
}

export function saveGlyph(ch: string, url: string, aspect: number): void {
  const store = readGlyphStore();
  store[ch] = { url, aspect };
  writeGlyphStore(store);
  glyphCache.delete(ch);
}

export function clearGlyph(ch: string): void {
  const store = readGlyphStore();
  delete store[ch];
  writeGlyphStore(store);
  glyphCache.delete(ch);
}

export function glyphCount(): number {
  return Object.keys(readGlyphStore()).length;
}

function getGlyph(ch: string): Glyph | null {
  const hit = glyphCache.get(ch);
  if (hit) return hit;
  const entry = readGlyphStore()[ch];
  if (!entry) return null;
  const img = new Image();
  img.src = entry.url;
  const g: Glyph = { img, aspect: entry.aspect || 1 };
  glyphCache.set(ch, g);
  return g;
}

/** Recolor a drawn letter with the chosen ink. Cached per letter+ink. */
const tintCache = new Map<string, HTMLCanvasElement>();
function tintGlyph(ch: string, g: Glyph, ink: string): HTMLCanvasElement {
  const key = `${ch}::${ink}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = Math.max(1, g.img.naturalWidth);
  c.height = Math.max(1, g.img.naturalHeight);
  const tctx = c.getContext('2d')!;
  tctx.drawImage(g.img, 0, 0);
  tctx.globalCompositeOperation = 'source-in';
  tctx.fillStyle = ink;
  tctx.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c);
  if (tintCache.size > 240) {
    const first = tintCache.keys().next().value;
    if (first !== undefined) tintCache.delete(first);
  }
  return c;
}

/** Draw one line of handwriting, letter by letter with natural variation. */
function drawHandLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  opts: HwOpts,
  seed: number
): number {
  const rand = mulberry(seed);
  const mv = 0.25 + (opts.mess / 100) * 1.5; // messiness scales the wobble
  const custom = opts.style === 'custom';
  ctx.save();
  ctx.font = `600 ${opts.size}px ${baseFontFor(opts.style)}`;
  ctx.fillStyle = opts.ink;
  ctx.textBaseline = 'alphabetic';
  let cx = x;
  for (const ch of text) {
    if (ch === ' ') {
      cx += opts.size * 0.32 * (0.9 + rand() * 0.2);
      continue;
    }
    // A hand-drawn letter, if the user drew one: placed on the same baseline
    // with the same variation transforms as font letters.
    const g = custom ? getGlyph(ch) : null;
    if (g && g.img.complete && g.img.naturalWidth > 0) {
      const s = 0.94 + rand() * 0.12;
      const h = opts.size * s;
      const w = h * g.aspect;
      if (cx + w > x + maxW) break;
      const tilt = (rand() - 0.5) * 0.09 * mv;
      const dy = (rand() - 0.5) * opts.size * 0.08 * mv;
      ctx.save();
      ctx.translate(cx + w / 2, y + dy);
      ctx.rotate(tilt);
      ctx.transform(1, 0, Math.tan(((opts.slant + (rand() - 0.5) * 3) * Math.PI) / 180), 1, 0, 0);
      ctx.globalAlpha = 0.92;
      // The drawing cell's baseline sits at 72% of its height.
      ctx.drawImage(tintGlyph(ch, g, opts.ink), -w / 2, -h * 0.72, w, h);
      ctx.restore();
      cx += w * (0.92 + rand() * 0.16);
      continue;
    }
    const w = ctx.measureText(ch).width;
    if (cx + w > x + maxW) break; // clipped by caller normally; guard anyway
    const tilt = (rand() - 0.5) * 0.09 * mv; // ±2.6°
    const dy = (rand() - 0.5) * opts.size * 0.08 * mv;
    const s = 0.94 + rand() * 0.12;
    ctx.save();
    ctx.translate(cx + w / 2, y + dy);
    ctx.rotate(tilt);
    ctx.transform(1, 0, Math.tan(((opts.slant + (rand() - 0.5) * 3) * Math.PI) / 180), 1, 0, 0);
    ctx.scale(s, s);
    // Slightly heavier stroke reads as pen pressure.
    ctx.fillText(ch, -w / 2, 0);
    ctx.restore();
    cx += w * (0.92 + rand() * 0.16);
  }
  ctx.restore();
  return cx - x;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  size: number,
  style: StyleId
): string[] {
  ctx.font = `600 ${size}px ${baseFontFor(style)}`;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (ctx.measureText(trial).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawRuled(ctx: CanvasRenderingContext2D, lineH: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  // Red margin line.
  ctx.strokeStyle = '#e8a0a0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN - 28, 0);
  ctx.lineTo(MARGIN - 28, PAGE_H);
  ctx.stroke();
  // Blue rules.
  ctx.strokeStyle = '#bcd3e8';
  ctx.lineWidth = 1;
  const top = MARGIN;
  for (let y = top; y < PAGE_H - 60; y += lineH) {
    ctx.beginPath();
    ctx.moveTo(0, y + lineH * 0.78);
    ctx.lineTo(PAGE_W, y + lineH * 0.78);
    ctx.stroke();
  }
}

function drawPlain(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = '#c9d8e8';
  ctx.lineWidth = 1;
  const step = 44;
  ctx.beginPath();
  for (let x = 0; x <= PAGE_W; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, PAGE_H);
  }
  for (let y = 0; y <= PAGE_H; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(PAGE_W, y + 0.5);
  }
  ctx.stroke();
}

function renderNotebookPage(text: string, pageNum: number, opts: HwOpts, paper: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d')!;
  const lineH = opts.size * 1.9;
  if (paper === 'ruled') drawRuled(ctx, lineH);
  else if (paper === 'grid') drawGrid(ctx);
  else drawPlain(ctx);
  const maxW = PAGE_W - MARGIN * 2;
  const lines = wrapLines(ctx, text, maxW, opts.size, opts.style);
  let y = MARGIN + opts.size;
  const seedBase = pageNum * 100003;
  for (let i = 0; i < lines.length; i++) {
    if (y > PAGE_H - 60) break;
    if (lines[i]) drawHandLine(ctx, lines[i], MARGIN, y, maxW, opts, seedBase + i * 7919);
    y += lineH;
  }
  return canvas.toDataURL('image/png');
}

async function renderLayoutPages(opts: HwOpts, onProgress: (n: number, total: number) => void): Promise<string[]> {
  // "Keep original layout": original page as background, handwriting over it.
  const pdfjs = await loadPdfjs();
  const buf = new Uint8Array(await pdfFile!.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress(p, doc.numPages);
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = PAGE_W / base.width;
    const viewport = page.getViewport({ scale });
    const bg = document.createElement('canvas');
    bg.width = PAGE_W;
    bg.height = Math.round(viewport.height);
    const bctx = bg.getContext('2d')!;
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, bg.width, bg.height);
    await page.render({ canvas: bg, viewport }).promise;

    // White-out the original text regions, then hand-write over them.
    const tc = await page.getTextContent();
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = bg.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bg, 0, 0);
    const seedBase = p * 100003;
    let li = 0;
    for (const raw of tc.items) {
      const ti = raw as unknown as { str: string; transform: number[]; width: number };
      if (!ti.str.trim()) continue;
      const [a, b, , , e, f] = ti.transform;
      const size = Math.max(14, Math.hypot(a, b) * scale * 1.35);
      const x = e * scale;
      const y = (base.height - f) * scale + size * 0.35;
      const w = ti.width * scale;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 2, y - size, w + 4, size * 1.2);
      const lineOpts = { ...opts, size };
      drawHandLine(ctx, ti.str, x, y, w + size * 2, lineOpts, seedBase + li++ * 7919);
    }
    page.cleanup();
    out.push(canvas.toDataURL('image/png'));
  }
  return out;
}

/* ---------------- draw-your-own alphabet panel ---------------- */

const DRAW_SIZE = 320; // CSS px; backing store is 2x for smooth strokes
const DRAW_SCALE = 2;

function drawGuides(ctx: CanvasRenderingContext2D, S: number): void {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  ctx.lineWidth = 2;
  // x-height / cap guides, faint
  ctx.strokeStyle = '#d7e3f0';
  ctx.beginPath();
  ctx.moveTo(0, S * 0.32); ctx.lineTo(S, S * 0.32);
  ctx.moveTo(0, S * 0.08); ctx.lineTo(S, S * 0.08);
  ctx.stroke();
  // baseline, stronger
  ctx.strokeStyle = '#e08080';
  ctx.beginPath();
  ctx.moveTo(0, S * 0.72); ctx.lineTo(S, S * 0.72);
  ctx.stroke();
  ctx.restore();
}

/** Trim transparent margins around the ink; returns null when blank. */
function trimInk(ink: HTMLCanvasElement): { url: string; aspect: number } | null {
  const ctx = ink.getContext('2d')!;
  const S = ink.width;
  const data = ctx.getImageData(0, 0, S, S).data;
  let minX = S, minY = S, maxX = -1, maxY = -1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (data[(y * S + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = Math.round(S * 0.04);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(S - 1, maxX + pad); maxY = Math.min(S - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d')!.drawImage(ink, minX, minY, w, h, 0, 0, w, h);
  return { url: out.toDataURL('image/png'), aspect: w / h };
}

function initDrawPanel(): void {
  const view = el<HTMLCanvasElement>('hw-draw-canvas');
  const S = DRAW_SIZE * DRAW_SCALE;
  view.width = S; view.height = S;
  const ink = document.createElement('canvas');
  ink.width = S; ink.height = S;
  const vctx = view.getContext('2d')!;
  const ictx = ink.getContext('2d')!;
  ictx.lineCap = 'round';
  ictx.lineJoin = 'round';
  ictx.strokeStyle = '#1a1a1a';
  ictx.lineWidth = 9 * DRAW_SCALE;

  let photo: HTMLImageElement | null = null;
  let drawing = false;
  let idx = 0;
  let hasInk = false;

  const repaint = () => {
    drawGuides(vctx, S);
    if (photo && photo.naturalWidth) {
      vctx.save();
      vctx.globalAlpha = 0.22;
      // cover-fit the photo into the square
      const pr = photo.naturalWidth / photo.naturalHeight;
      let dw = S, dh = S;
      if (pr > 1) dw = S * pr; else dh = S / pr;
      vctx.drawImage(photo, (S - dw) / 2, (S - dh) / 2, dw, dh);
      vctx.restore();
    }
    vctx.drawImage(ink, 0, 0);
  };

  const label = () => {
    const ch = DRAW_CHARSET[idx];
    el('hw-draw-label').textContent = `${ch} — letter ${idx + 1} of ${DRAW_CHARSET.length}`;
    el('hw-draw-count').textContent =
      `${glyphCount()} of ${DRAW_CHARSET.length} letters drawn. Undrawn letters use the Casual style.`;
  };

  const loadLetter = () => {
    ictx.clearRect(0, 0, S, S);
    photo = null;
    hasInk = false;
    const g = getGlyph(DRAW_CHARSET[idx]);
    if (g && g.img.complete && g.img.naturalWidth) {
      // Place the saved drawing back on the same 72%-baseline grid.
      const h = S;
      const w = h * g.aspect;
      ictx.drawImage(g.img, (S - w) / 2, 0, w, h);
      hasInk = true;
    } else if (g) {
      g.img.onload = () => loadLetter();
    }
    repaint();
    label();
  };

  const saveLetter = (silent: boolean) => {
    if (!hasInk) return;
    const t = trimInk(ink);
    if (t) {
      saveGlyph(DRAW_CHARSET[idx], t.url, t.aspect);
      if (!silent) setStatusLite('Saved.');
      scheduleLivePreview();
    }
    label();
  };

  const pos = (e: PointerEvent): [number, number] => {
    const r = view.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * S, ((e.clientY - r.top) / r.height) * S];
  };

  view.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    view.setPointerCapture(e.pointerId);
    drawing = true;
    const [x, y] = pos(e);
    ictx.beginPath();
    ictx.moveTo(x, y);
    ictx.lineTo(x + 0.1, y + 0.1);
    ictx.stroke();
    hasInk = true;
    repaint();
  });
  view.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    e.preventDefault();
    const [x, y] = pos(e);
    ictx.lineTo(x, y);
    ictx.stroke();
    repaint();
  });
  const stop = () => { drawing = false; };
  view.addEventListener('pointerup', stop);
  view.addEventListener('pointercancel', stop);
  // No scrolling the page while drawing on touch.
  view.style.touchAction = 'none';

  el('hw-draw-prev').addEventListener('click', () => {
    saveLetter(true);
    idx = (idx - 1 + DRAW_CHARSET.length) % DRAW_CHARSET.length;
    loadLetter();
  });
  el('hw-draw-next').addEventListener('click', () => {
    saveLetter(true);
    idx = (idx + 1) % DRAW_CHARSET.length;
    loadLetter();
  });
  el('hw-draw-save').addEventListener('click', () => saveLetter(false));
  el('hw-draw-clear').addEventListener('click', () => {
    clearGlyph(DRAW_CHARSET[idx]);
    ictx.clearRect(0, 0, S, S);
    hasInk = false;
    repaint();
    label();
  });
  el('hw-draw-photo').addEventListener('click', () => el<HTMLInputElement>('hw-draw-photo-input').click());
  el<HTMLInputElement>('hw-draw-photo-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      photo = img;
      URL.revokeObjectURL(url);
      repaint();
    };
    img.src = url;
  });

  loadLetter();
}

function setStatusLite(msg: string): void {
  el('hw-draw-count').textContent = msg;
  setTimeout(() => {
    el('hw-draw-count').textContent =
      `${glyphCount()} of ${DRAW_CHARSET.length} letters drawn. Undrawn letters use the Casual style.`;
  }, 1200);
}

/* ---------------- live preview ---------------- */

/** A small two-line sample rendered with the current options. */
function renderLiveSample(opts: HwOpts): string {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 230;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 230);
  ctx.strokeStyle = '#bcd3e8';
  ctx.lineWidth = 1;
  for (const y of [86, 162]) {
    ctx.beginPath();
    ctx.moveTo(0, y + 2);
    ctx.lineTo(900, y + 2);
    ctx.stroke();
  }
  const line = { ...opts, size: 44 };
  drawHandLine(ctx, 'The quick brown fox jumps over the lazy dog.', 40, 78, 820, line, 7);
  drawHandLine(ctx, 'Pack my box with five dozen liquor jugs 0123456789.', 40, 154, 820, line, 701);
  return canvas.toDataURL('image/png');
}

let liveTimer = 0;

function scheduleLivePreview(): void {
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => void renderLivePreview(), 400);
}

async function renderLivePreview(): Promise<void> {
  const wrap = document.getElementById('hw-live-wrap');
  const img = document.getElementById('hw-live-img') as HTMLImageElement | null;
  if (!wrap || !img) return;
  try {
    await loadFonts();
    const opts = currentOpts();
    await ensureStyleFont(opts.style);
    img.src = renderLiveSample(opts);
    wrap.hidden = false;
  } catch {
    /* the preview is a bonus; the real render still works */
  }
}

function toggleDrawSection(): void {
  const style = document.querySelector<HTMLInputElement>('input[name="hw-style"]:checked')?.value;
  const section = document.getElementById('hw-draw-section');
  if (section) section.hidden = style !== 'custom';
}

function currentOpts(): HwOpts {
  const style = (document.querySelector<HTMLInputElement>('input[name="hw-style"]:checked')?.value ?? 'casual') as StyleId;
  const inkRadio = document.querySelector<HTMLInputElement>('input[name="hw-ink"]:checked');
  const ink = inkRadio?.value === 'custom'
    ? el<HTMLInputElement>('hw-ink-custom').value
    : (inkRadio?.value ?? '#1a2a6c');
  return {
    style,
    ink,
    size: Number(el<HTMLInputElement>('hw-size').value),
    slant: Number(el<HTMLInputElement>('hw-slant').value),
    mess: Number(el<HTMLInputElement>('hw-mess').value),
  };
}

function paperMode(): string {
  return document.querySelector<HTMLInputElement>('input[name="hw-paper"]:checked')?.value ?? 'ruled';
}

function setProgress(n: number, total: number, label: string): void {
  el('hw-progress').hidden = false;
  el('hw-progress-bar').style.width = `${Math.round((n / total) * 100)}%`;
  el('hw-progress-label').textContent = label;
}

function showPreview(): void {
  const wrap = el('hw-preview');
  wrap.innerHTML = '';
  const show = resultPngs.slice(0, 4);
  for (const [i, png] of show.entries()) {
    const img = document.createElement('img');
    img.src = png;
    img.alt = `Handwritten page ${i + 1}`;
    wrap.appendChild(img);
  }
  if (resultPngs.length > 4) {
    const more = document.createElement('p');
    more.className = 'hint';
    more.textContent = `+ ${resultPngs.length - 4} more pages in the download.`;
    wrap.appendChild(more);
  }
  el('hw-result-info').textContent = `${resultPngs.length} page${resultPngs.length === 1 ? '' : 's'} ready.`;
  el('hw-result').hidden = false;
}

async function makeHandwriting(): Promise<void> {
  hideError('error-box');
  const mode = paperMode();
  const pasted = el<HTMLTextAreaElement>('hw-text-input').value.trim();
  if (mode === 'layout' && !pdfFile) {
    showError('error-box', 'Original layout needs a PDF. Choose the PDF tab or pick notebook paper.');
    return;
  }
  if (mode !== 'layout' && !pdfFile && !pasted) {
    showError('error-box', 'Add a PDF or paste some text first.');
    return;
  }
  setBusy('hw-make', true, 'Writing…');
  try {
    await loadFonts();
    const opts = currentOpts();
    await ensureStyleFont(opts.style);
    resultPngs = [];
    if (mode === 'layout') {
      resultPngs = await renderLayoutPages(opts, (n, total) => setProgress(n, total, `Writing page ${n} of ${total}…`));
    } else {
      // Gather text: PDF text per page, or pasted text split into pages.
      let texts: string[] = [];
      if (pdfFile) {
        const pdfjs = await loadPdfjs();
        const buf = new Uint8Array(await pdfFile.arrayBuffer());
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        for (let p = 1; p <= doc.numPages; p++) {
          setProgress(p, doc.numPages, `Reading page ${p} of ${doc.numPages}…`);
          const page = await doc.getPage(p);
          const tc = await page.getTextContent();
          const strs = tc.items
            .map((it) => (it as unknown as { str: string }).str)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          texts.push(strs || '(blank page)');
          page.cleanup();
        }
      } else {
        // Split pasted text into ~page-sized chunks.
        const paras = pasted.split('\n');
        let cur: string[] = [];
        let count = 0;
        for (const para of paras) {
          cur.push(para);
          count += para.length;
          if (count > 2600) {
            texts.push(cur.join('\n'));
            cur = [];
            count = 0;
          }
        }
        if (cur.length) texts.push(cur.join('\n'));
      }
      const paper = mode === 'layout' ? 'plain' : mode;
      texts.forEach((t, i) => {
        setProgress(i + 1, texts.length, `Writing page ${i + 1} of ${texts.length}…`);
        resultPngs.push(renderNotebookPage(t, i + 1, opts, paper));
      });
    }
    setProgress(1, 1, 'Done.');
    showPreview();
    el('hw-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch {
    showError('error-box', 'Could not make the handwriting. Please try again with a different file.');
  } finally {
    setBusy('hw-make', false);
    setTimeout(() => {
      el('hw-progress').hidden = true;
    }, 800);
  }
}

async function downloadPdf(): Promise<void> {
  if (resultPngs.length === 0) return;
  setBusy('hw-download', true, 'Building…');
  try {
    const out = await PDFDocument.create();
    for (const png of resultPngs) {
      const bytes = Uint8Array.from(atob(png.split(',')[1]), (c) => c.charCodeAt(0));
      const img = await out.embedPng(bytes);
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const data = await out.save();
    downloadBytes('handwriting.pdf', data, 'application/pdf');
  } catch {
    showError('error-box', 'Could not build the PDF. Please try again.');
  } finally {
    setBusy('hw-download', false);
  }
}

function updateMakeButton(): void {
  const mode = paperMode();
  const pasted = el<HTMLTextAreaElement>('hw-text-input').value.trim();
  el<HTMLButtonElement>('hw-make').disabled = mode === 'layout' ? !pdfFile : !(pdfFile || pasted);
  // Original layout only makes sense with a PDF.
  const layoutRadio = document.querySelector<HTMLInputElement>('input[name="hw-paper"][value="layout"]');
  if (layoutRadio && !pdfFile && paperMode() === 'layout') {
    const ruled = document.querySelector<HTMLInputElement>('input[name="hw-paper"][value="ruled"]');
    if (ruled) ruled.checked = true;
  }
}

export function initHandwriting(): void {
  const dz = el('hw-dropzone');
  const input = el<HTMLInputElement>('hw-file-input');

  const tabPdf = el('hw-tab-pdf');
  const tabText = el('hw-tab-text');
  const panePdf = el('hw-pdf-pane');
  const paneText = el('hw-text-pane');
  const pickTab = (pdf: boolean) => {
    tabPdf.classList.toggle('active', pdf);
    tabText.classList.toggle('active', !pdf);
    tabPdf.setAttribute('aria-selected', pdf ? 'true' : 'false');
    tabText.setAttribute('aria-selected', !pdf ? 'true' : 'false');
    panePdf.hidden = !pdf;
    paneText.hidden = pdf;
    updateMakeButton();
  };
  tabPdf.addEventListener('click', () => pickTab(true));
  tabText.addEventListener('click', () => pickTab(false));

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const guard = mobileFileSizeGuard(f);
    const note = el('size-note');
    note.hidden = true;
    if (guard?.block) {
      showError('error-box', guard.message);
      return;
    }
    if (guard) {
      note.textContent = guard.message;
      note.hidden = false;
    }
    hideError('error-box');
    pdfFile = f;
    el('hw-file-info').textContent = `${f.name}`;
    el('hw-result').hidden = true;
    resultPngs = [];
    updateMakeButton();
  });
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragging');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragging');
    const f = e.dataTransfer?.files[0];
    if (f) {
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    }
  });

  el<HTMLTextAreaElement>('hw-text-input').addEventListener('input', () => {
    el('hw-result').hidden = true;
    resultPngs = [];
    updateMakeButton();
  });
  document.querySelectorAll('input[name="hw-paper"]').forEach((r) =>
    r.addEventListener('change', updateMakeButton)
  );

  el('hw-make').addEventListener('click', () => void makeHandwriting());
  el('hw-download').addEventListener('click', () => void downloadPdf());

  // Own-handwriting panel: only the alphabet box needs wiring; the panel
  // itself shows when the "My handwriting" style is picked.
  initDrawPanel();
  toggleDrawSection();
  document.querySelectorAll('input[name="hw-style"]').forEach((r) =>
    r.addEventListener('change', () => {
      toggleDrawSection();
      scheduleLivePreview();
    })
  );
  document.querySelectorAll('input[name="hw-ink"], input[name="hw-paper"]').forEach((r) =>
    r.addEventListener('change', scheduleLivePreview)
  );
  for (const id of ['hw-size', 'hw-slant', 'hw-mess']) {
    el<HTMLInputElement>(id).addEventListener('input', scheduleLivePreview);
  }
  el<HTMLInputElement>('hw-ink-custom').addEventListener('input', scheduleLivePreview);
  scheduleLivePreview();
  updateMakeButton();
}
