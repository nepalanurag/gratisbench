// Small DOM helpers shared by all tool pages. No business logic here.
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

export function showError(boxId: string, message: string): void {
  const box = el(boxId);
  box.textContent = message;
  box.hidden = false;
}

export function hideError(boxId: string): void {
  el(boxId).hidden = true;
}

export function setBusy(btnId: string, busy: boolean, label = ''): void {
  const btn = el<HTMLButtonElement>(btnId);
  btn.disabled = busy;
  if (label) btn.dataset.label = btn.dataset.label || btn.textContent || '';
  if (busy) {
    btn.dataset.label = btn.textContent || '';
    btn.textContent = label || 'Working…';
  } else if (btn.dataset.label) {
    btn.textContent = btn.dataset.label;
  }
}

/** Wire a drop zone: click opens the file picker, drop adds files. */
export function setupDropzone(
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
    onFiles([...input.files]);
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

/** Friendly message for common pdf-lib load failures. */
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
