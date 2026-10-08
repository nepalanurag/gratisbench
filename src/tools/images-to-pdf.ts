// Images to PDF tool: DOM glue. Core logic lives in ../lib/pdf-imagestopdf-x.ts
import {
  imagesToPdfEx,
  type ImageOrientation,
  type ImageMargin,
} from '../lib/pdf-imagestopdf-x.ts';
import { showPdfPreview } from './pdf-render.ts';
import { enableDragReorder, GRIP_ICON } from '../lib/drag-reorder-x.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  setupPasteHandler,
  loadImage,
  ICONS,
} from './common.ts';

import type { PdfImage } from '../lib/pdf-core.ts';

interface Item {
  file: File;
  previewUrl: string;
  image: PdfImage;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';

/** Normalize any browser-readable image to PNG or JPEG bytes for pdf-lib. */
async function normalizeImage(file: File): Promise<PdfImage> {
  if (file.type === 'image/png') {
    return { data: new Uint8Array(await file.arrayBuffer()), mime: 'image/png' };
  }
  if (file.type === 'image/jpeg') {
    return { data: new Uint8Array(await file.arrayBuffer()), mime: 'image/jpeg' };
  }
  // WebP, GIF, BMP, … → decode and re-encode as PNG via canvas.
  const url = URL.createObjectURL(file);
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Could not convert that image.');
    return { data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function initImagesToPdf(opts?: { accept?: string; fallbackName?: string }): void {
  const accept = opts?.accept ?? ACCEPT;
  const fallbackName = opts?.fallbackName ?? 'images.pdf';
  const items: Item[] = [];
  const list = el('file-list');
  const empty = el('empty-state');
  const convertBtn = el<HTMLButtonElement>('convert-btn');
  const result = el('result');
  const pageSizeSel = el<HTMLSelectElement>('page-size');
  const orientationSel = el<HTMLSelectElement>('orientation');
  const marginSel = el<HTMLSelectElement>('margin');
  const orientationField = el('orientation-field');
  const marginField = el('margin-field');

  /** Orientation and margins only apply to A4/Letter pages. */
  function syncLayoutFields(): void {
    const fixed = pageSizeSel.value !== 'fit';
    orientationField.hidden = !fixed;
    marginField.hidden = !fixed;
  }
  pageSizeSel.addEventListener('change', syncLayoutFields);
  syncLayoutFields();

  function move(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const [item] = items.splice(from, 1);
    items.splice(from < to ? to - 1 : to, 0, item);
    render();
  }

  function render(): void {
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    items.forEach((item, i) => {
      const row = document.createElement('li');
      row.className = 'file-row thumb-row';
      row.draggable = true;
      row.dataset.idx = String(i);
      row.innerHTML = `
        <span data-drag title="Drag to reorder" aria-hidden="true" style="cursor:grab;display:inline-flex;align-items:center;opacity:.55;touch-action:none">${GRIP_ICON}</span>
        <span class="file-order">${i + 1}</span>
        <img class="thumb" src="${item.previewUrl}" alt="Page ${i + 1} preview" loading="lazy" />
        <span class="file-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
        <span class="file-meta">${formatBytes(item.file.size)}</span>
        <span class="file-actions">
          <button type="button" class="icon-btn" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ICONS.up}</button>
          <button type="button" class="icon-btn" data-act="down" data-i="${i}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">${ICONS.down}</button>
          <button type="button" class="icon-btn" data-act="remove" data-i="${i}" aria-label="Remove">${ICONS.x}</button>
        </span>`;
      list.appendChild(row);
    });
    convertBtn.disabled = items.length === 0;
    el('count-label').textContent =
      items.length === 0 ? '' : `${items.length} image${items.length === 1 ? '' : 's'} → ${items.length} page${items.length === 1 ? '' : 's'}`;
  }

  enableDragReorder(list, move);

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]');
    if (!btn) return;
    const i = Number(btn.getAttribute('data-i'));
    const act = btn.getAttribute('data-act');
    if (act === 'remove') {
      URL.revokeObjectURL(items[i].previewUrl);
      items.splice(i, 1);
    } else if (act === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
    else if (act === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
    render();
  });

  const input = el<HTMLInputElement>('file-input');
  input.accept = accept;

  /** Shared by the dropzone and clipboard paste. */
  async function addFiles(files: File[]): Promise<void> {
    hideError('error-box');
    let added = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        showError('error-box', `"${file.name}" is not an image file.`);
        continue;
      }
      try {
        const image = await normalizeImage(file);
        // Sanity check: make sure the browser can actually decode it.
        const sanityUrl = URL.createObjectURL(new Blob([image.data as unknown as BlobPart], { type: image.mime }));
        try {
          await loadImage(sanityUrl);
        } finally {
          URL.revokeObjectURL(sanityUrl);
        }
        items.push({ file, previewUrl: URL.createObjectURL(file), image });
        added++;
      } catch {
        showError('error-box', `Could not read "${file.name}". Try a PNG or JPEG instead.`);
      }
    }
    if (added > 0) render();
  }

  setupDropzone('dropzone', 'file-input', (files) => void addFiles(files));

  // Paste screenshots straight from the clipboard (Ctrl+V). setupPasteHandler
  // already skips pastes inside text inputs.
  setupPasteHandler((files) => void addFiles(files), (f) => f.type.startsWith('image/'));

  convertBtn.addEventListener('click', async () => {
    hideError('error-box');
    result.hidden = true;
    setBusy('convert-btn', true, 'Building PDF…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const pageSize = pageSizeSel.value as 'fit' | 'a4' | 'letter';
      const out = await imagesToPdfEx(
        items.map((i) => i.image),
        {
          pageSize,
          orientation: orientationSel.value as ImageOrientation,
          margin: marginSel.value as ImageMargin,
        }
      );
      // Name the PDF after the first image: "scan-01.jpg" -> "scan-01.pdf".
      const stem =
        items[0].file.name.replace(/\.[^.]+$/, '').trim() || fallbackName.replace(/\.pdf$/i, '');
      const outName = `${stem}.pdf`;
      result.hidden = false;
      el('result-info').textContent = `${formatBytes(out.length)} · ${items.length} page${items.length === 1 ? '' : 's'} · ${pageSizeLabel(pageSize)} · ${outName}`;
      el<HTMLButtonElement>('download-btn').onclick = () =>
        downloadBytes(outName, out, 'application/pdf');
      void showPdfPreview('preview-wrap', out);
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Conversion failed.');
    } finally {
      setBusy('convert-btn', false);
    }
  });

  render();
}

function pageSizeLabel(pageSize: 'fit' | 'a4' | 'letter'): string {
  return pageSize === 'fit' ? 'fit to image' : pageSize === 'a4' ? 'A4 pages' : 'US Letter pages';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
