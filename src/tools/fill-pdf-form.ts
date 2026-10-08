// Fill PDF Form tool: DOM glue. Field listing and filling live in
// ../lib/pdf-forms.ts; this file renders the fields as a plain form, tracks
// required fields and fill progress, and can save/load answers as JSON.
import { PDFDocument } from 'pdf-lib';
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
  downloadText,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  mobileFileSizeGuard,
} from './common.ts';

let sourceBytes: Uint8Array | null = null;
let fileStem = 'document';
let fields: FormFieldInfo[] = [];
let requiredNames: Set<string> = new Set();
let confirmedRequired = false;
let progressWired = false;

function prettyName(name: string): string {
  // Internal names look like "topmostSubform[0].Page1[0].Name"; show the last bit.
  const tail = name.split('.').pop() ?? name;
  return tail.replace(/\[\d+\]$/, '').replace(/[_-]+/g, ' ').trim() || name;
}

/** Which fields the PDF itself marks as required (pdf-lib, read separately). */
async function detectRequired(buffer: Uint8Array): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
    for (const f of doc.getForm().getFields()) {
      try {
        if (f.isRequired()) out.add(f.getName());
      } catch {
        /* skip fields that refuse to answer */
      }
    }
  } catch {
    /* no form at all; the caller already handles that */
  }
  return out;
}

function buildFieldRow(field: FormFieldInfo, index: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field-row';
  const label = document.createElement('label');
  label.setAttribute('for', `field-${index}`);
  label.textContent = prettyName(field.name);
  if (requiredNames.has(field.name)) {
    const tag = document.createElement('span');
    tag.className = 'required-tag';
    tag.textContent = 'required';
    label.appendChild(tag);
  }
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

/** True when the field's on-screen input currently holds an answer. */
function fieldIsFilled(field: FormFieldInfo, index: number): boolean {
  if (field.type === 'checkbox') {
    return el<HTMLInputElement>(`field-${index}`).checked;
  }
  if (field.type === 'list') {
    return el<HTMLSelectElement>(`field-${index}`).selectedOptions.length > 0;
  }
  if (field.type === 'radio') {
    return !!document.querySelector(`input[name="field-${index}"]:checked`);
  }
  return el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`field-${index}`).value.trim() !== '';
}

function updateProgress(): void {
  const filled = fields.filter((f, i) => fieldIsFilled(f, i)).length;
  el('fill-progress').textContent = `${filled} of ${fields.length} fields filled`;
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

/** Names of required fields that are still empty, in display form. */
function emptyRequired(): string[] {
  const out: string[] = [];
  fields.forEach((field, index) => {
    if (requiredNames.has(field.name) && !fieldIsFilled(field, index)) {
      out.push(prettyName(field.name));
    }
  });
  return out;
}

async function doSave(): Promise<void> {
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
}

function applyAnswers(answers: Record<string, unknown>): number {
  let applied = 0;
  fields.forEach((field, index) => {
    if (!(field.name in answers)) return;
    const v = answers[field.name];
    try {
      if (field.type === 'checkbox') {
        el<HTMLInputElement>(`field-${index}`).checked = v === true || v === 'true' || v === 'Yes';
      } else if (field.type === 'list') {
        const select = el<HTMLSelectElement>(`field-${index}`);
        const want = new Set(Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()));
        for (const o of select.options) o.selected = want.has(o.value);
      } else if (field.type === 'radio') {
        const radio = document.querySelector<HTMLInputElement>(
          `input[name="field-${index}"][value="${CSS.escape(String(v))}"]`
        );
        if (radio) radio.checked = true;
      } else {
        el<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`field-${index}`).value = String(v ?? '');
      }
      applied++;
    } catch {
      /* one bad value must not stop the rest */
    }
  });
  return applied;
}

export function initFillPdfForm(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('form-wrap').hidden = true;
    el('no-fields').hidden = true;
    el('fields-list').innerHTML = '';
    el('file-info').hidden = true;
    el('save-anyway-btn').hidden = true;
    sourceBytes = null;
    fields = [];
    requiredNames = new Set();
    confirmedRequired = false;
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
      requiredNames = await detectRequired(sourceBytes);
      const list = el('fields-list');
      fields.forEach((field, i) => list.appendChild(buildFieldRow(field, i)));
      if (!progressWired) {
        list.addEventListener('input', updateProgress);
        list.addEventListener('change', updateProgress);
        progressWired = true;
      }
      el('count-label').textContent = `${fields.length} field${fields.length === 1 ? '' : 's'} found`;
      updateProgress();
      el('form-wrap').hidden = false;
    } catch (err) {
      showError('error-box', pdfLoadErrorMessage(err));
    }
  });

  el('save-btn').addEventListener('click', async () => {
    const missing = emptyRequired();
    if (missing.length > 0 && !confirmedRequired) {
      showError(
        'error-box',
        `These required fields are still empty: ${missing.join(', ')}. Fill them in, or save anyway.`
      );
      el('save-anyway-btn').hidden = false;
      el('error-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    await doSave();
  });

  el('save-anyway-btn').addEventListener('click', async () => {
    confirmedRequired = true;
    el('save-anyway-btn').hidden = true;
    await doSave();
  });

  el('answers-save').addEventListener('click', () => {
    if (fields.length === 0) return;
    const payload = {
      tool: 'truepdf-fill-pdf-form',
      form: `${fileStem}.pdf`,
      savedAt: new Date().toISOString(),
      answers: readValues(),
    };
    downloadText(`${fileStem}-answers.json`, JSON.stringify(payload, null, 2), 'application/json');
  });

  el('answers-load').addEventListener('click', () => {
    el<HTMLInputElement>('answers-input').click();
  });

  el<HTMLInputElement>('answers-input').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f || fields.length === 0) return;
    hideError('error-box');
    try {
      const parsed = JSON.parse(await f.text()) as { answers?: Record<string, unknown> };
      if (!parsed || typeof parsed.answers !== 'object' || parsed.answers === null) {
        showError('error-box', 'That file does not look like a saved answers file.');
        return;
      }
      const applied = applyAnswers(parsed.answers);
      updateProgress();
      if (applied === 0) {
        showError('error-box', 'None of the saved answers matched this form\u2019s fields. It may be answers for a different form.');
      }
    } catch {
      showError('error-box', 'Could not read that answers file. It may be damaged.');
    }
  });
}
