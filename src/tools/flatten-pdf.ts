// Flatten PDF tool: DOM glue. The work is one pdf-lib call in
// ../lib/pdf-core.ts (flattenPdf).
import { flattenPdf, flattenedFileName, getPageCount } from '../lib/pdf-core.ts';
import { listFormFields } from '../lib/pdf-forms.ts';
import { pdfLoadErrorMessage } from './common.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  mobileFileSizeGuard,
} from './common.ts';

let sourceBytes: Uint8Array | null = null;
let fileStem = 'document';

export function initFlattenPdf(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('flatten-wrap').hidden = true;
    el('no-fields').hidden = true;
    el('file-info').hidden = true;
    sourceBytes = null;
    const f = files[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      showError('error-box', `"${f.name}" is not a PDF.`);
      return;
    }
    const sizeNote = el('size-note');
    sizeNote.hidden = true;
    const guard = mobileFileSizeGuard(f);
    if (guard?.block) {
      showError('error-box', guard.message);
      return;
    }
    if (guard) {
      sizeNote.textContent = guard.message;
      sizeNote.hidden = false;
    }
    fileStem = f.name.replace(/\.[^.]+$/, '') || 'document';
    try {
      sourceBytes = new Uint8Array(await f.arrayBuffer());
      const [pages, formFields] = await Promise.all([
        getPageCount(sourceBytes),
        listFormFields(sourceBytes),
      ]);
      const info = el('file-info');
      info.textContent = `${f.name} · ${formatBytes(f.size)} · ${pages} page${pages === 1 ? '' : 's'}`;
      info.hidden = false;
      if (formFields.length === 0) {
        el('no-fields').hidden = false;
        el('no-fields').textContent =
          'This PDF has no form fields. Flattening only matters for fillable forms, so there is nothing to do here.';
        return;
      }
      el('no-fields').hidden = true;
      el('fields-note').textContent =
        `${formFields.length} form field${formFields.length === 1 ? '' : 's'} will be baked into the page.`;
      el('flatten-wrap').hidden = false;
    } catch (err) {
      showError('error-box', pdfLoadErrorMessage(err));
    }
  });

  el('flatten-btn').addEventListener('click', async () => {
    if (!sourceBytes) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('flatten-btn', true, 'Flattening…');
    try {
      const out = await flattenPdf(sourceBytes.slice());
      const outName = flattenedFileName(fileStem);
      el('result-info').textContent = `${formatBytes(out.length)} · fields are now part of the page and cannot be edited.`;
      el('result').hidden = false;
      el<HTMLButtonElement>('download-btn').onclick = () => downloadBytes(outName, out, 'application/pdf');
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Flattening failed.');
    } finally {
      setBusy('flatten-btn', false);
    }
  });
}
