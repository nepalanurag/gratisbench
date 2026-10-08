// PDF form (AcroForm) helpers: list fillable fields and fill them.
// DOM-free pdf-lib code, shared by the browser tool and the Node verify script.
// User-facing copy never says "AcroForm"; these are "form fields".
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';

export type FormFieldType = 'text' | 'checkbox' | 'dropdown' | 'list' | 'radio';

export interface FormFieldInfo {
  /** The field's internal name; shown to the user, used as the fill key. */
  name: string;
  type: FormFieldType;
  value: string | boolean;
  /** Allowed values for dropdown, list, and radio fields. */
  options: string[];
  multiLine: boolean;
  /** Character cap, when the form sets one; null means unlimited. */
  maxLength: number | null;
}

export type FormValues = Record<string, string | boolean | string[]>;

/**
 * List the fillable fields in a PDF. Returns an empty array when the file
 * has no form (pdf-lib raises on documents without an AcroForm dictionary).
 */
export async function listFormFields(buffer: Uint8Array): Promise<FormFieldInfo[]> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const out: FormFieldInfo[] = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      out.push({
        name,
        type: 'text',
        value: field.getText() ?? '',
        options: [],
        multiLine: field.isMultiline(),
        maxLength: field.getMaxLength() ?? null,
      });
    } else if (field instanceof PDFCheckBox) {
      out.push({ name, type: 'checkbox', value: field.isChecked(), options: [], multiLine: false, maxLength: null });
    } else if (field instanceof PDFDropdown) {
      const selected = field.getSelected();
      out.push({
        name,
        type: 'dropdown',
        value: selected.length > 0 ? selected[0] : '',
        options: field.getOptions(),
        multiLine: false,
        maxLength: null,
      });
    } else if (field instanceof PDFOptionList) {
      out.push({
        name,
        type: 'list',
        value: field.getSelected().join(', '),
        options: field.getOptions(),
        multiLine: false,
        maxLength: null,
      });
    } else if (field instanceof PDFRadioGroup) {
      const selected = field.getSelected();
      out.push({
        name,
        type: 'radio',
        value: selected ?? '',
        options: field.getOptions(),
        multiLine: false,
        maxLength: null,
      });
    }
    // Signature and push-button fields are skipped: they cannot be filled
    // with text or choices.
  }
  return out;
}

/**
 * Fill the named fields and return the new file bytes. Unknown field names
 * are ignored; bad option values throw a plain-language error.
 */
export async function fillFormFields(
  buffer: Uint8Array,
  values: FormValues,
  flatten: boolean
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  let form;
  try {
    form = doc.getForm();
  } catch {
    throw new Error('This PDF has no form fields to fill.');
  }
  for (const [name, value] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      continue; // renamed or removed field; skip rather than fail
    }
    if (field instanceof PDFTextField) {
      field.setText(typeof value === 'boolean' ? (value ? 'Yes' : '') : String(value));
    } else if (field instanceof PDFCheckBox) {
      if (value === true || value === 'true' || value === 'Yes') field.check();
      else if (value === false || value === '' || value === 'false') field.uncheck();
    } else if (field instanceof PDFDropdown) {
      const opt = Array.isArray(value) ? value[0] : String(value);
      if (opt && !field.getOptions().includes(opt)) {
        throw new Error(`"${opt}" is not one of the choices for "${name}".`);
      }
      if (opt) field.select(opt);
    } else if (field instanceof PDFOptionList) {
      const opts: string[] = Array.isArray(value)
        ? value
        : String(value)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      const bad = opts.filter((o) => !field.getOptions().includes(o));
      if (bad.length > 0) {
        throw new Error(`"${bad[0]}" is not one of the choices for "${name}".`);
      }
      if (opts.length > 0) field.select(opts);
    } else if (field instanceof PDFRadioGroup) {
      const opt = Array.isArray(value) ? value[0] : String(value);
      if (opt) field.select(opt);
    }
  }
  form.updateFieldAppearances();
  if (flatten) form.flatten();
  return doc.save();
}

/** Output filename for the filled form. */
export function filledFormFileName(stem: string): string {
  return `${stem}-filled.pdf`;
}
