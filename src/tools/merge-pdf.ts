// Merge PDF tool: DOM glue. Core logic lives in ../lib/pdf-core.ts
import { mergePdfs, getPageCount } from '../lib/pdf-core.ts';
import { renderPdfThumb, showPdfPreview } from './pdf-render.ts';
import { enableDragReorder, GRIP_ICON } from '../lib/drag-reorder-x.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  pdfLoadErrorMessage,
  ICONS,
  suggestNextSteps,
} from './common.ts';

interface Item {
  file: File;
  bytes: Uint8Array;
  pages: number;
  thumb: string;
}

export function initMergePdf(): void {
  const items: Item[] = [];
  const list = el('file-list');
  const empty = el('empty-state');
  const mergeBtn = el<HTMLButtonElement>('merge-btn');
  const result = el('result');

  function move(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const [item] = items.splice(from, 1);
    // Splicing shifts indices, so insert before the drop target's new position.
    items.splice(from < to ? to - 1 : to, 0, item);
    render();
  }

  function render(): void {
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    items.forEach((item, i) => {
      const row = document.createElement('li');
      row.className = 'file-row';
      row.draggable = true;
      row.dataset.idx = String(i);
      const thumbHtml = item.thumb
        ? `<img class="thumb" src="${item.thumb}" alt="First page of ${escapeHtml(item.file.name)}" loading="lazy" />`
        : '';
      row.innerHTML = `
        <span class="drag-handle" data-drag title="Drag to reorder" aria-hidden="true" style="cursor:grab;display:inline-flex;align-items:center;color:inherit;opacity:.55;touch-action:none">${GRIP_ICON}</span>
        <span class="file-order">${i + 1}</span>
        ${thumbHtml}
        <span class="file-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
        <span class="file-meta">${item.pages} page${item.pages === 1 ? '' : 's'} · ${formatBytes(item.file.size)}</span>
        <span class="file-actions">
          <button type="button" class="icon-btn" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ICONS.up}</button>
          <button type="button" class="icon-btn" data-act="down" data-i="${i}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">${ICONS.down}</button>
          <button type="button" class="icon-btn" data-act="remove" data-i="${i}" aria-label="Remove">${ICONS.x}</button>
        </span>`;
      list.appendChild(row);
    });
    mergeBtn.disabled = items.length === 0;
    el('count-label').textContent =
      items.length === 0
        ? ''
        : `${items.length} file${items.length === 1 ? '' : 's'} · ${items.reduce((a, b) => a + b.pages, 0)} pages total`;
    el('clear-all-btn').hidden = items.length === 0;
  }

  enableDragReorder(list, move);

  el('clear-all-btn').addEventListener('click', () => {
    items.length = 0;
    hideError('error-box');
    result.hidden = true;
    render();
  });

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]');
    if (!btn) return;
    const i = Number(btn.getAttribute('data-i'));
    const act = btn.getAttribute('data-act');
    if (act === 'remove') items.splice(i, 1);
    else if (act === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
    else if (act === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
    render();
  });

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        showError('error-box', `"${file.name}" is not a PDF. Only PDF files can be merged.`);
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pages = await getPageCount(bytes);
        const thumb = await renderPdfThumb(bytes);
        items.push({ file, bytes, pages, thumb });
      } catch (err) {
        showError('error-box', `"${file.name}": ${pdfLoadErrorMessage(err)}`);
      }
    }
    render();
  });

  mergeBtn.addEventListener('click', async () => {
    hideError('error-box');
    result.hidden = true;
    setBusy('merge-btn', true, 'Merging…');
    try {
      // Yield so the busy state paints before the heavy work starts.
      await new Promise((r) => setTimeout(r, 30));
      const out = await mergePdfs(items.map((i) => i.bytes));
      const name =
        items.length === 1
          ? `${items[0].file.name.replace(/\.pdf$/i, '') || 'merged'}-merged.pdf`
          : `merged-${items.length}-files.pdf`;
      result.hidden = false;
      suggestNextSteps('result', 'merge-pdf');
      el('result-info').textContent = `${formatBytes(out.length)} · ${items.reduce((a, b) => a + b.pages, 0)} pages`;
      const dl = el<HTMLButtonElement>('download-btn');
      dl.onclick = () => downloadBytes(name, out, 'application/pdf');
      // Preview renders in the background; the download never waits for it.
      void showPdfPreview('preview-wrap', out);
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Merging failed.');
    } finally {
      setBusy('merge-btn', false);
    }
  });

  render();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
