// v2: force rebuild
// Fill PDF Form tool: DOM glue. Field listing and filling live in
// ../lib/pdf-forms.ts; this file only renders the fields as a plain form.
import {
  listFormFields,
  fillFormFields,
  filledFormFileName,
  type FormFieldInfo,
  type FormValues,
} from '../lib/pdf-forms.ts';
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
let fields: FormFieldInfo[] = [];

function prettyName(name: string): string {
  // Internal names look like "topmostSubform[0].Page1[0].Name"; show the last bit.
  const tail = name.split('.').pop() ?? name;
  return tail.replace(/\[\d+\]$/, '').replace(/[_-]+/g, ' ').trim() || name;
}

function buildFieldRow(field: FormFieldInfo, index: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field-row';
  const label = document.createElement('label');
  label.setAttribute('for', `field-${index}`);
  label.textContent = prettyName(field.name);
  const raw = document.createElement('span');
  raw.className = 'raw-name';
  raw.textContent = field.name;
  label.appendChild(raw);
  row.appendChild(label);

  if (field.type === 'text') {
    if (field.multiLine) {
      const ta = document.createElement('textarea');
      ta.id = `field-${index}`;
      ta.value = field.value as string;
      if (field.maxLength) ta.maxLength = field.maxLength;
      row.appendChild(ta);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = `field-${index}`;
      input.value = field.value as string;
      if (field.maxLength) input.maxLength = field.maxLength;
      row.appendChild(input);
    }
  } else if (field.type === 'checkbox') {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `field-${index}`;
    input.checked = field.value === true;
    wrap.appendChild(input);
    row.appendChild(wrap);
  } else if (field.type === 'dropdown') {
    const select = document.createElement('select');
    select.id = `field-${index}`;
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = field.value ? String(field.value) : 'Choose…';
    select.appendChild(empty);
    for (const opt of field.options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === field.value) o.selected = true;
      select.appendChild(o);
    }
    row.appendChild(select);
  } else if (field.type === 'list') {
    const select = document.createElement('select');
    select.id = `field-${index}`;
    select.multiple = true;
    select.size = Math.min(6, Math.max(3, field.options.length));
    const picked = String(field.value).split(',').map((s) => s.trim());
    for (const opt of field.options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (picked.includes(opt)) o.selected = true;
      select.appendChild(o);
    }
    row.appendChild(select);
  } else {
    // radio
    const group = document.createElement('div');
    group.className = 'radio-group';
    for (const opt of field.options) {
      const lab = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `field-${index}`;
      input.value = opt;
      if (opt === field.value) input.checked = true;
      lab.append(input, document.createTextNode(opt));
      group.appendChild(lab);
    }
    row.appendChild(group);
  }
  return row;
}

function readValues(): FormValues {
  const values: FormValues = {};
  fields.forEach((field, index) => {
    if (field.type === 'checkbox') {
      values[field.name] = el<HTMLInputElement>(`field-${index}`).checked;
    } else if (field.type === 'list') {
      const select = el<HTMLSelectElement>(`field-${index}`);
      values[field.name] = [...select.selectedOptions].map((o) => o.value);
    } else if (field.type === 'radio') {
      const picked = document.querySelector<HTMLInputElement>(`input[name="field-${index}"]:checked`);
      values[field.name] = picked ? picked.value : '';
    } else {
      values[field.name] = el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`field-${index}`).value;
    }
  });
  return values;
}

export function initFillPdfForm(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('form-wrap').hidden = true;
    el('no-fields').hidden = true;
    el('fields-list').innerHTML = '';
    el('file-info').hidden = true;
    sourceBytes = null;
    fields = [];
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
      fields = await listFormFields(sourceBytes);
      const info = el('file-info');
      info.textContent = `${f.name} · ${formatBytes(f.size)}`;
      info.hidden = false;
      if (fields.length === 0) {
        el('no-fields').hidden = false;
        return;
      }
      const list = el('fields-list');
      fields.forEach((field, i) => list.appendChild(buildFieldRow(field, i)));
      el('count-label').textContent = `${fields.length} field${fields.length === 1 ? '' : 's'} found`;
      el('form-wrap').hidden = false;
    } catch (err) {
      showError('error-box', pdfLoadErrorMessage(err));
    }
  });

  el('save-btn').addEventListener('click', async () => {
    if (!sourceBytes || fields.length === 0) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('save-btn', true, 'Saving…');
    try {
      const flatten = el<HTMLInputElement>('opt-flatten').checked;
      const out = await fillFormFields(sourceBytes.slice(), readValues(), flatten);
      const outName = filledFormFileName(fileStem);
      el('result-info').textContent =
        `${formatBytes(out.length)} · ` +
        (flatten
          ? 'fields baked in and locked.'
          : 'saved with fields still fillable.');
      el('result').hidden = false;
      el<HTMLButtonElement>('download-btn').onclick = () => downloadBytes(outName, out, 'application/pdf');
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Filling failed.');
    } finally {
      setBusy('save-btn', false);
    }
  });
}
