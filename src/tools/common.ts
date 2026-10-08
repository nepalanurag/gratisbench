// Small DOM helpers shared by all tool pages. No business logic here.
import { basePath } from '../lib/site.ts';
export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function downloadBytes(name: string, data: Uint8Array, mime: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadDataUrl(name: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(name: string, text: string, mime: string): void {
  downloadBytes(name, new TextEncoder().encode(text), mime);
}

/** Copy text to the clipboard; falls back to a hidden textarea where needed. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.className = 'visually-hidden';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function showError(boxId: string, message: string): void {
  const box = el(boxId);
  // Designed error layout: icon + message body. Falls back to plain text
  // if the box doesn't use the structured markup.
  const body = box.querySelector('.eb-body');
  if (body) {
    body.textContent = message;
  } else {
    box.textContent = message;
  }
  box.hidden = false;
}

export function hideError(boxId: string): void {
  el(boxId).hidden = true;
}

export function setBusy(btnId: string, busy: boolean, label = ''): void {
  const btn = el<HTMLButtonElement>(btnId);
  btn.disabled = busy;
  if (busy) {
    if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
    const text = label || 'Working';
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${text}…`;
    btn.setAttribute('aria-busy', 'true');
  } else {
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    btn.removeAttribute('aria-busy');
  }
}

/**
 * Two-step inline confirm for destructive buttons. First click arms the button
 * ("Click again to delete", .btn-armed styling, auto-disarms after 5s);
 * second click runs the action. Replaces window.confirm(), which is
 * auto-dismissed in some contexts and breaks the interaction flow.
 */
export function armConfirmButton(
  btn: HTMLButtonElement,
  action: () => void,
  armLabel = 'Click again to confirm',
  shouldArm: () => boolean = () => true
): void {
  let armed = false;
  let timer: number | undefined;
  const originalLabel = btn.textContent;
  const disarm = () => {
    armed = false;
    btn.textContent = originalLabel;
    btn.classList.remove('btn-armed');
    if (timer) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
  btn.addEventListener('click', () => {
    if (!shouldArm()) {
      action();
      return;
    }
    if (!armed) {
      armed = true;
      btn.textContent = armLabel;
      btn.classList.add('btn-armed');
      timer = window.setTimeout(disarm, 5000);
      return;
    }
    disarm();
    action();
  });
}

/**
 * Two-step inline confirm for buttons inside delegated click handlers
 * (dynamically rendered lists). Same arming behavior as armConfirmButton,
 * but driven manually from an existing handler instead of a listener.
 */
export function armDelegatedConfirm(
  btn: HTMLElement,
  action: () => void,
  armLabel = 'Click again to confirm'
): void {
  if (btn.dataset.armed === '1') {
    delete btn.dataset.armed;
    btn.textContent = btn.dataset.origLabel || '';
    btn.classList.remove('btn-armed');
    action();
    return;
  }
  btn.dataset.armed = '1';
  btn.dataset.origLabel = btn.textContent || '';
  btn.textContent = armLabel;
  btn.classList.add('btn-armed');
  window.setTimeout(() => {
    if (btn.dataset.armed === '1') {
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.origLabel || '';
      btn.classList.remove('btn-armed');
    }
  }, 5000);
}

/**
 * Cross-tool retention: after a successful download, suggest logical next
 * steps. Renders "What next?" links into the given container. Call once per
 * successful run; it replaces any previous suggestions.
 */
const NEXT_STEPS: Record<string, Array<{ href: string; name: string }>> = {
  'pdf-compressor': [
    { href: '/merge-pdf', name: 'Merge PDFs' },
    { href: '/pdf-editor', name: 'Reorder or edit pages' },
  ],
  'merge-pdf': [
    { href: '/pdf-compressor', name: 'Compress the result' },
    { href: '/pdf-editor', name: 'Reorder or delete pages' },
  ],
  'split-pdf': [
    { href: '/merge-pdf', name: 'Merge some back together' },
    { href: '/pdf-compressor', name: 'Compress the result' },
  ],
  'pdf-to-jpg': [
    { href: '/image-compressor', name: 'Compress the images' },
    { href: '/images-to-pdf', name: 'Make a new PDF' },
  ],
  'images-to-pdf': [
    { href: '/pdf-compressor', name: 'Compress the PDF' },
    { href: '/merge-pdf', name: 'Merge with another PDF' },
  ],
  'image-compressor': [
    { href: '/image-converter', name: 'Convert the format' },
    { href: '/images-to-pdf', name: 'Make a PDF from them' },
  ],
  'image-converter': [
    { href: '/image-compressor', name: 'Compress the result' },
    { href: '/images-to-pdf', name: 'Make a PDF from them' },
  ],
  'video-compressor': [
    { href: '/video-trimmer', name: 'Trim it' },
    { href: '/subtitle-editor', name: 'Add subtitles' },
  ],
  'video-trimmer': [
    { href: '/video-compressor', name: 'Compress the result' },
    { href: '/subtitle-editor', name: 'Add subtitles' },
  ],
  'video-converter': [
    { href: '/video-compressor', name: 'Compress the result' },
    { href: '/video-trimmer', name: 'Trim it' },
  ],
  'audio-trimmer': [
    { href: '/audio-merger', name: 'Merge with another clip' },
    { href: '/audio-converter', name: 'Convert the format' },
  ],
  'audio-merger': [
    { href: '/audio-converter', name: 'Convert the format' },
    { href: '/audio-trimmer', name: 'Trim the result' },
  ],
  'qr-generator': [
    { href: '/pdf-editor', name: 'Add it to a PDF' },
    { href: '/og-image-generator', name: 'Make a social card' },
  ],
  'pdf-editor': [
    { href: '/pdf-compressor', name: 'Compress the result' },
    { href: '/merge-pdf', name: 'Merge with another PDF' },
  ],
};

export function suggestNextSteps(containerId: string, toolId: string): void {
  const steps = NEXT_STEPS[toolId];
  if (!steps || steps.length === 0) return;
  const box = document.getElementById(containerId);
  if (!box) return;
  box.querySelector('.next-steps')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'next-steps';
  const label = document.createElement('p');
  label.className = 'next-steps-label';
  label.textContent = 'What next?';
  wrap.appendChild(label);
  for (const s of steps) {
    const a = document.createElement('a');
    a.className = 'link-btn';
    a.href = basePath(s.href);
    a.textContent = s.name;
    wrap.appendChild(a);
  }
  box.appendChild(wrap);
}

/** Wire a drop zone: click opens the file picker, drop adds files. */export function setupDropzone(
  zoneId: string,
  inputId: string,
  onFiles: (files: File[]) => void
): void {
  const zone = el(zoneId);
  const input = el<HTMLInputElement>(inputId);
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    onFiles(Array.from(input.files ?? []));
    input.value = '';
  });
  for (const evt of ['dragenter', 'dragover']) {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('dragging');
    });
  }
  for (const evt of ['dragleave', 'drop']) {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('dragging');
    });
  }
  zone.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  });
}

/**
 * Paste-from-clipboard support for image tools. Listens for Ctrl+V / Cmd+V
 * anywhere on the page and passes image files from the clipboard to onFiles.
 * Returns a cleanup function. No-op on browsers without clipboard read.
 */
export function setupPasteHandler(
  onFiles: (files: File[]) => void,
  accept?: (file: File) => boolean
): () => void {
  const handler = (e: ClipboardEvent) => {
    // Don't hijack paste in text inputs — user is probably pasting text.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && (!accept || accept(file))) files.push(file);
      }
    }
    if (files.length) {
      e.preventDefault();
      onFiles(files);
    }
  };
  document.addEventListener('paste', handler);
  return () => document.removeEventListener('paste', handler);
}

/**
 * True on phones/tablets. Used for file-size guards: mobile browsers kill
 * tabs that use too much memory, so a clear "too large for this device"
 * message beats a crash. Prefers the UA client hint, falls back to UA sniff.
 */
export function isMobileDevice(): boolean {
  try {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  } catch {
    /* fall through to UA sniffing */
  }
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
}

/**
 * Mobile file-size guard for the ffmpeg tools. Returns null when the file is
 * fine, or { block, message }: block=true means refuse the file (it would
 * crash the tab), block=false means warn but let the user continue.
 * Desktop has far more headroom, so it only blocks truly huge files.
 */
export function mobileFileSizeGuard(file: File): { block: boolean; message: string } | null {
  const MB = 1024 * 1024;
  if (isMobileDevice()) {
    if (file.size >= 500 * MB) {
      return {
        block: true,
        message:
          'That file is over 500 MB, which is too large to process on a phone or tablet — the browser would likely crash. Please use a desktop computer for this one.',
      };
    }
    if (file.size >= 200 * MB) {
      return {
        block: false,
        message:
          'Heads up: that file is over 200 MB. Phones and tablets can run out of memory on large files — if the tab closes unexpectedly, try a smaller file or use a desktop.',
      };
    }
  } else if (file.size >= 2 * 1024 * MB) {
    return {
      block: true,
      message: 'That file is over 2 GB, which is too large to process in a browser tab. Please use a smaller file.',
    };
  }
  return null;
}
export function pdfLoadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/encrypted|password/i.test(msg)) {
    return 'This PDF is password-protected. Remove the password first, then try again.';
  }
  if (/invalid|parse|header/i.test(msg)) {
    return 'That file does not look like a valid PDF.';
  }
  return msg || 'Could not read that file.';
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

/**
 * Shrink an image file to at most maxSize px on the long edge and return a
 * PNG data URL. Keeps localStorage payloads small for uploaded logos/photos.
 */
export async function downscaleImageFile(file: File, maxSize = 400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not read that image.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Inline SVG icons for dynamically rendered rows (same stroke style as Icon.astro). */
export const ICONS = {
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>',
};

/**
 * Remember a tool setting in localStorage and restore it on load.
 * Usage: bindSetting('image-compressor', 'quality', rangeEl, '80')
 * Reads the stored value (if any), sets the element, and saves on change.
 */
export function bindSetting(
  tool: string,
  key: string,
  element: HTMLInputElement | HTMLSelectElement,
  defaultValue: string
): void {
  const storageKey = `truepdf:${tool}:${key}`;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      element.value = stored;
      // Fire input/change so any bound UI (like range value labels) updates.
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch {
    /* localStorage unavailable — use defaults */
  }
  element.addEventListener('change', () => {
    try {
      localStorage.setItem(storageKey, element.value);
    } catch {
      /* ignore quota errors */
    }
  });
}

/** Animated success checkmark SVG. Insert into a result box on completion. */
export function successCheckSVG(): string {
  return `<span class="success-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle class="check-circle" cx="26" cy="26" r="24"/><path class="check-path" d="M15 27l7 7 15-16"/></svg></span>`;
}

/** Briefly pulse a button to confirm a completed action (e.g. download). */
export function pulseDone(btnId: string): void {
  const btn = el(btnId);
  btn.classList.remove('download-done');
  // Force reflow so re-adding the class restarts the animation.
  void btn.offsetWidth;
  btn.classList.add('download-done');
  setTimeout(() => btn.classList.remove('download-done'), 600);
}

function formatEta(sec: number): string {
  const s = Math.max(1, Math.round(sec));
  if (s < 50) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h}h ${rest}m`;
}

/**
 * Estimates time remaining for a long operation from its progress fraction.
 * Feed it the 0..1 progress each time it updates; `eta()` returns '' until
 * enough progress (default 12%) and a couple of seconds have passed, so the
 * label never shows a wild early guess. If progress jumps backwards (a new
 * phase starting over at 0%), the timer resets automatically.
 */
export class EtaTracker {
  private start = 0;
  private lastFrac = 0;
  private readonly minFrac: number;

  constructor(minFrac = 0.12) {
    this.minFrac = minFrac;
    this.reset();
  }

  reset(): void {
    this.start = performance.now();
    this.lastFrac = 0;
  }

  /** "About 3 minutes left", or '' when too early to estimate. */
  eta(frac: number): string {
    if (!(frac > 0) || frac >= 1) return '';
    if (frac < this.lastFrac - 0.05) this.reset(); // new phase
    this.lastFrac = frac;
    if (frac < this.minFrac) return '';
    const elapsedSec = (performance.now() - this.start) / 1000;
    if (elapsedSec < 2) return '';
    const remainSec = (elapsedSec / frac) * (1 - frac);
    if (!(remainSec > 1)) return '';
    return `About ${formatEta(remainSec)} left`;
  }
}
