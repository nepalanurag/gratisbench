// Edit PDF Metadata tool: DOM glue. Pure read/write lives in ../lib/pdf-meta.ts.
import {
  readPdfMetadata,
  writePdfMetadata,
  metadataIsEmpty,
  metadataFileName,
  type PdfMetadata,
} from '../lib/pdf-meta.ts';
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

const FIELDS: { id: string; key: keyof PdfMetadata }[] = [
  { id: 'meta-title', key: 'title' },
  { id: 'meta-author', key: 'author' },
  { id: 'meta-subject', key: 'subject' },
  { id: 'meta-keywords', key: 'keywords' },
  { id: 'meta-creator', key: 'creator' },
];

let sourceBytes: Uint8Array | null = null;
let fileStem = 'document';

function readForm(): PdfMetadata {
  const meta = { title: '', author: '', subject: '', keywords: '', creator: '' };
  for (const { id, key } of FIELDS) {
    meta[key] = el<HTMLInputElement>(id).value.trim();
  }
  return meta;
}

function fillForm(meta: PdfMetadata): void {
  for (const { id, key } of FIELDS) {
    el<HTMLInputElement>(id).value = meta[key];
  }
}

export function initEditPdfMetadata(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('meta-form-wrap').hidden = true;
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
      const meta = await readPdfMetadata(sourceBytes);
      fillForm(meta);
      const info = el('file-info');
      info.textContent = `${f.name} · ${formatBytes(f.size)}`;
      info.hidden = false;
      el('meta-empty-note').hidden = !metadataIsEmpty(meta);
      el('meta-form-wrap').hidden = false;
    } catch (err) {
      showError('error-box', pdfLoadErrorMessage(err));
    }
  });

  el('save-btn').addEventListener('click', async () => {
    if (!sourceBytes) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('save-btn', true, 'Saving…');
    try {
      const out = await writePdfMetadata(sourceBytes.slice(), readForm());
      const outName = metadataFileName(fileStem);
      el('result-info').textContent = `${formatBytes(out.length)} · metadata updated.`;
      el('result').hidden = false;
      el<HTMLButtonElement>('download-btn').onclick = () => downloadBytes(outName, out, 'application/pdf');
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Saving failed.');
    } finally {
      setBusy('save-btn', false);
    }
  });

  el('clear-btn').addEventListener('click', () => {
    fillForm({ title: '', author: '', subject: '', keywords: '', creator: '' });
  });
}
