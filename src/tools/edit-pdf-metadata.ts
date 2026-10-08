// Edit PDF Metadata tool: DOM glue. Pure read/write lives in
// ../lib/pdf-meta-ext.ts (the extended variant with the Producer field).
import {
  readPdfMetadataFull,
  writePdfMetadataFull,
  EMPTY_METADATA_FULL,
  PERSONAL_FIELDS,
  type PdfMetadataFull,
} from '../lib/pdf-meta-ext.ts';
import { metadataFileName } from '../lib/pdf-meta.ts';
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

const FIELDS: { id: string; key: keyof PdfMetadataFull; label: string }[] = [
  { id: 'meta-title', key: 'title', label: 'Title' },
  { id: 'meta-author', key: 'author', label: 'Author' },
  { id: 'meta-subject', key: 'subject', label: 'Subject' },
  { id: 'meta-keywords', key: 'keywords', label: 'Keywords' },
  { id: 'meta-creator', key: 'creator', label: 'Creator' },
  { id: 'meta-producer', key: 'producer', label: 'Producer' },
];

let sourceBytes: Uint8Array | null = null;
let fileStem = 'document';
let originalMeta: PdfMetadataFull = { ...EMPTY_METADATA_FULL };

function readForm(): PdfMetadataFull {
  const meta = { ...EMPTY_METADATA_FULL };
  for (const { id, key } of FIELDS) {
    meta[key] = el<HTMLInputElement>(id).value.trim();
  }
  return meta;
}

function fillForm(meta: PdfMetadataFull): void {
  for (const { id, key } of FIELDS) {
    el<HTMLInputElement>(id).value = meta[key];
  }
  updatePreview();
}

/** Render the "what will change" preview: every edited field, old vs new. */
function updatePreview(): void {
  const wrap = el('change-preview');
  const current = readForm();
  const changes = FIELDS.filter(({ key }) => current[key] !== originalMeta[key]);
  if (changes.length === 0) {
    wrap.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No changes yet. Edit a field above and the change shows up here before you save.';
    wrap.appendChild(p);
    return;
  }
  wrap.innerHTML = '';
  const heading = document.createElement('p');
  heading.className = 'hint';
  heading.textContent = `This will change when you save (${changes.length}):`;
  wrap.appendChild(heading);
  const list = document.createElement('ul');
  list.className = 'change-list';
  for (const { key, label } of changes) {
    const li = document.createElement('li');
    const from = document.createElement('span');
    from.className = 'change-from';
    from.textContent = originalMeta[key] === '' ? 'empty' : originalMeta[key];
    const arrow = document.createElement('span');
    arrow.className = 'change-arrow';
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    const to = document.createElement('span');
    to.className = 'change-to';
    to.textContent = current[key] === '' ? 'empty' : current[key];
    const name = document.createElement('strong');
    name.textContent = `${label}: `;
    li.append(name, from, ' ', arrow, ' ', to);
    list.appendChild(li);
  }
  wrap.appendChild(list);
}

export function initEditPdfMetadata(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('meta-form-wrap').hidden = true;
    el('file-info').hidden = true;
    sourceBytes = null;
    originalMeta = { ...EMPTY_METADATA_FULL };
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
      originalMeta = await readPdfMetadataFull(sourceBytes);
      fillForm(originalMeta);
      const info = el('file-info');
      info.textContent = `${f.name} · ${formatBytes(f.size)}`;
      info.hidden = false;
      el('meta-form-wrap').hidden = false;
    } catch (err) {
      showError('error-box', pdfLoadErrorMessage(err));
    }
  });

  for (const { id } of FIELDS) {
    el<HTMLInputElement>(id).addEventListener('input', updatePreview);
  }

  el('save-btn').addEventListener('click', async () => {
    if (!sourceBytes) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('save-btn', true, 'Saving…');
    try {
      const out = await writePdfMetadataFull(sourceBytes.slice(), readForm());
      const outName = metadataFileName(fileStem);
      const changed = FIELDS.filter(
        ({ key }) => readForm()[key] !== originalMeta[key]
      ).length;
      el('result-info').textContent =
        `${formatBytes(out.length)} · ` +
        (changed === 0
          ? 'no changes were made, so the file is identical.'
          : `${changed} field${changed === 1 ? '' : 's'} updated.`);
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
    fillForm({ ...EMPTY_METADATA_FULL });
  });

  el('scrub-btn').addEventListener('click', () => {
    const current = readForm();
    for (const key of PERSONAL_FIELDS) current[key] = '';
    fillForm(current);
  });
}
