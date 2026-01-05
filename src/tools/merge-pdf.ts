// Merge PDF tool: DOM glue. Core logic lives in ../lib/pdf-core.ts
import { mergePdfs, getPageCount } from '../lib/pdf-core.ts';
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
} from './common.ts';

interface Item {
  file: File;
  bytes: Uint8Array;
  pages: number;
}

export function initMergePdf(): void {
  const items: Item[] = [];
  const list = el('file-list');
  const empty = el('empty-state');
  const mergeBtn = el<HTMLButtonElement>('merge-btn');
  const result = el('result');

  function render(): void {
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    items.forEach((item, i) => {
      const row = document.createElement('li');
      row.className = 'file-row';
      row.innerHTML = `
        <span class="file-order">${i + 1}</span>
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
  }

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
        items.push({ file, bytes, pages });
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
      const name = items.length === 1 ? 'merged.pdf' : `merged-${items.length}-files.pdf`;
      result.hidden = false;
      el('result-info').textContent = `${formatBytes(out.length)} · ${items.reduce((a, b) => a + b.pages, 0)} pages`;
      const dl = el<HTMLButtonElement>('download-btn');
      dl.onclick = () => downloadBytes(name, out, 'application/pdf');
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
