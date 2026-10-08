// Fake data generator tool: DOM glue. Generation, formatting, and escaping
// live in ../lib/fakedata-core.ts (pure, unit-tested in Node).
import {
  el,
  showError,
  hideError,
  setBusy,
  downloadText,
  bindSetting,
} from './common.ts';
import {
  FAKEDATA_STORAGE_KEY,
  blankSettings,
  serializeSettings,
  deserializeSettings,
  defaultColumns,
  formatOutput,
  outputFileName,
  outputMime,
  addColumn,
  removeColumn,
  moveColumn,
  updateColumn,
  sanitizeIdentifier,
  type ColumnDef,
  type ColumnType,
  type FakeDataSettings,
  type OutputFormat,
  type Cell,
} from '../lib/fakedata-core.ts';
import {
  allColumnTypes,
  isExtraColumnType,
  isExtraFormat,
  generateAllRows,
  clampRowCountExtended,
  formatOutputExtended,
  extraOutputFileName,
  extraOutputMime,
  loadFakeDataExtras,
  saveFakeDataExtras,
  type ExtraFormat,
} from '../lib/fakedata-extras.ts';
import { ICONS } from './common.ts';

let settings: FakeDataSettings;
let seed: number = Math.floor(Math.random() * 900000) + 100000;
let previewRows: Cell[][] = [];
let lastOutput = '';

/** Every column type the picker can offer: core types first, extras after. */
const ALL_TYPES = allColumnTypes();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function save(): void {
  try {
    localStorage.setItem(FAKEDATA_STORAGE_KEY, serializeSettings(settings));
  } catch {
    /* storage unavailable: the tool still works for the session */
  }
  saveFakeDataExtras(settings.columns, currentFormat(), settings.rowCount);
}

type AnyFormat = OutputFormat | ExtraFormat;

function currentFormat(): AnyFormat {
  const checked = document.querySelector<HTMLInputElement>('input[name="fakedata-format"]:checked');
  const v = checked ? checked.value : 'csv';
  if (v === 'json' || v === 'sql') return v;
  return isExtraFormat(v) ? v : 'csv';
}

function typeOptions(col: ColumnDef): string {
  switch (col.type) {
    case 'lorem':
      return `<label class="opt">Words <input type="number" min="1" max="500" value="${col.words ?? 25}" data-opt="words" data-id="${col.id}" aria-label="Word count" /></label>`;
    case 'integer':
      return `<label class="opt">Min <input type="number" value="${col.intMin ?? 1}" data-opt="intMin" data-id="${col.id}" aria-label="Minimum" /></label>
        <label class="opt">Max <input type="number" value="${col.intMax ?? 100}" data-opt="intMax" data-id="${col.id}" aria-label="Maximum" /></label>`;
    case 'decimal':
      return `<label class="opt">Min <input type="number" value="${col.decMin ?? 0}" data-opt="decMin" data-id="${col.id}" aria-label="Minimum" /></label>
        <label class="opt">Max <input type="number" value="${col.decMax ?? 100}" data-opt="decMax" data-id="${col.id}" aria-label="Maximum" /></label>
        <label class="opt">Places <input type="number" min="0" max="6" value="${col.decPlaces ?? 2}" data-opt="decPlaces" data-id="${col.id}" aria-label="Decimal places" /></label>`;
    case 'date':
      return `<label class="opt">From <input type="date" value="${col.dateFrom ?? '2022-01-01'}" data-opt="dateFrom" data-id="${col.id}" aria-label="From date" /></label>
        <label class="opt">To <input type="date" value="${col.dateTo ?? '2026-09-23'}" data-opt="dateTo" data-id="${col.id}" aria-label="To date" /></label>`;
    default:
      return '';
  }
}

function renderColumns(): void {
  const list = el('fakedata-col-list');
  list.innerHTML = settings.columns
    .map(
      (c) => `<div class="fd-col" data-id="${c.id}">
        <input type="text" class="fd-label" data-id="${c.id}" value="${escapeHtml(c.label)}" aria-label="Column label" maxlength="64" />
        <select class="fd-type" data-id="${c.id}" aria-label="Column type">
          ${ALL_TYPES.map((t) => `<option value="${t.type}"${t.type === c.type ? ' selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
        </select>
        <span class="fd-opts">${typeOptions(c)}</span>
        <span class="fd-actions">
          <button type="button" class="icon-btn" data-act="up" data-id="${c.id}" aria-label="Move column up">${ICONS.up}</button>
          <button type="button" class="icon-btn" data-act="down" data-id="${c.id}" aria-label="Move column down">${ICONS.down}</button>
          <button type="button" class="icon-btn" data-act="del" data-id="${c.id}" aria-label="Remove column">${ICONS.x}</button>
        </span>
      </div>`
    )
    .join('');

  list.querySelectorAll<HTMLElement>('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      const act = btn.dataset.act!;
      if (act === 'del') {
        if (settings.columns.length <= 1) {
          showError('fakedata-error', 'Keep at least one column.');
          return;
        }
        settings = { ...settings, columns: removeColumn(settings.columns, id) };
      } else {
        settings = { ...settings, columns: moveColumn(settings.columns, id, act === 'up' ? -1 : 1) };
      }
      hideError('fakedata-error');
      save();
      renderColumns();
      regenerate();
    });
  });

  list.querySelectorAll<HTMLInputElement>('.fd-label').forEach((input) => {
    input.addEventListener('change', () => {
      settings = { ...settings, columns: updateColumn(settings.columns, input.dataset.id!, { label: input.value.trim() || 'column' }) };
      save();
      regenerate();
    });
  });

  list.querySelectorAll<HTMLSelectElement>('.fd-type').forEach((sel) => {
    sel.addEventListener('change', () => {
      const type = sel.value as ColumnType;
      settings = { ...settings, columns: updateColumn(settings.columns, sel.dataset.id!, { type }) };
      save();
      renderColumns();
      regenerate();
    });
  });

  list.querySelectorAll<HTMLInputElement>('[data-opt]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.id!;
      const opt = input.dataset.opt!;
      let value: string | number = input.value;
      if (input.type === 'number') value = Number(input.value);
      settings = { ...settings, columns: updateColumn(settings.columns, id, { [opt]: value } as Partial<ColumnDef>) };
      save();
      regenerate();
    });
  });
}

function regenerate(): void {
  hideError('fakedata-error');
  if (settings.columns.length === 0) {
    el('fakedata-preview').innerHTML = '<p class="empty-state">Add at least one column to preview data.</p>';
    el('fakedata-result').hidden = true;
    return;
  }
  try {
    const rows = generateAllRows(seed, settings.columns, settings.rowCount);
    previewRows = rows.slice(0, 10);
    const format = currentFormat();
    lastOutput = isExtraFormat(format)
      ? formatOutputExtended(format, settings.columns, rows)
      : formatOutput(format, settings.columns, rows, settings.tableName);

    const head = settings.columns.map((c) => `<th>${escapeHtml(c.label || c.type)}</th>`).join('');
    const body = previewRows
      .map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(String(v))}</td>`).join('')}</tr>`)
      .join('');
    el('fakedata-preview').innerHTML =
      `<p class="preview-note">Preview of the first 10 rows. The download contains all ${settings.rowCount.toLocaleString('en-US')} rows.</p>` +
      `<div class="table-wrap"><table class="fd-preview"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

    const bytes = new Blob([lastOutput]).size;
    el('fakedata-stats').textContent =
      `${settings.rowCount.toLocaleString('en-US')} rows × ${settings.columns.length} columns · ${format.toUpperCase()} · ~${bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'} · seed ${seed}`;
    el('fakedata-result').hidden = false;
  } catch (err) {
    showError('fakedata-error', err instanceof Error ? err.message : 'Could not generate data.');
  }
}

export function initFakeDataGenerator(): void {
  try {
    settings = deserializeSettings(localStorage.getItem(FAKEDATA_STORAGE_KEY));
  } catch {
    settings = blankSettings();
  }
  // Extra column types live outside the core serializer (it drops unknown
  // types), so reapply the remembered full column list, keeping any tuned
  // options on the core-typed columns.
  const remembered = loadFakeDataExtras();
  if (remembered) {
    const byId = new Map(settings.columns.map((c) => [c.id, c]));
    settings = {
      ...settings,
      columns: remembered.columns.map((c) =>
        isExtraColumnType(c.type)
          ? { id: c.id, type: c.type as ColumnType, label: c.label }
          : (byId.get(c.id) ?? { id: c.id, type: c.type as ColumnType, label: c.label })
      ),
      rowCount: clampRowCountExtended(remembered.rowCount),
    };
  }

  // Add-column picker
  el('fakedata-add-type').innerHTML = ALL_TYPES.map(
    (t) => `<option value="${t.type}">${escapeHtml(t.label)}${t.hint ? `: ${escapeHtml(t.hint)}` : ''}</option>`
  ).join('');
  el('fakedata-add-col').addEventListener('click', () => {
    const type = (el<HTMLSelectElement>('fakedata-add-type')).value as ColumnType;
    settings = { ...settings, columns: addColumn(settings.columns, type) };
    save();
    renderColumns();
    regenerate();
  });

  // Row count
  const rowSel = el<HTMLSelectElement>('fakedata-rows');
  for (const n of [10, 50, 100, 500, 1000, 5000, 10000, 25000, 50000]) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = n.toLocaleString('en-US');
    if (n === settings.rowCount) opt.selected = true;
    rowSel.appendChild(opt);
  }
  // A remembered count above the old 10k cap has no matching option: add it.
  if (![...rowSel.options].some((o) => Number(o.value) === settings.rowCount)) {
    const opt = document.createElement('option');
    opt.value = String(settings.rowCount);
    opt.textContent = settings.rowCount.toLocaleString('en-US');
    opt.selected = true;
    rowSel.appendChild(opt);
  }
  rowSel.addEventListener('change', () => {
    settings = { ...settings, rowCount: clampRowCountExtended(Number(rowSel.value)) };
    save();
    regenerate();
  });

  // Format radios
  const initialFormat = remembered && (remembered.format === 'json' || remembered.format === 'sql' || isExtraFormat(remembered.format))
    ? remembered.format
    : settings.format;
  document.querySelectorAll<HTMLInputElement>('input[name="fakedata-format"]').forEach((radio) => {
    if (radio.value === initialFormat) radio.checked = true;
    radio.addEventListener('change', () => {
      const f = currentFormat();
      settings = { ...settings, format: f === 'json' || f === 'sql' ? f : 'csv' };
      el('fakedata-table-wrap').hidden = f !== 'sql';
      save();
      regenerate();
    });
  });
  el('fakedata-table-wrap').hidden = settings.format !== 'sql';
  const tableInput = el<HTMLInputElement>('fakedata-table');
  tableInput.value = settings.tableName;
  tableInput.addEventListener('change', () => {
    settings = { ...settings, tableName: sanitizeIdentifier(tableInput.value, 'fake_data') };
    tableInput.value = settings.tableName;
    save();
    regenerate();
  });

  // Seed
  const seedInput = el<HTMLInputElement>('fakedata-seed');
  seedInput.value = String(seed);
  const applySeed = () => {
    const v = seedInput.value.trim();
    seed = /^\d+$/.test(v) ? Number(v) >>> 0 : Math.floor(Math.random() * 900000) + 100000;
    seedInput.value = String(seed);
    regenerate();
  };
  seedInput.addEventListener('change', applySeed);
  // Remember the seed so the same dataset can be regenerated next visit.
  bindSetting('fake-data-generator', 'seed', seedInput, String(seed));
  el('fakedata-reroll').addEventListener('click', () => {
    seed = Math.floor(Math.random() * 900000) + 100000;
    seedInput.value = String(seed);
    // Fire change so the seed is validated, persisted, and applied.
    seedInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  el('fakedata-download').addEventListener('click', () => {
    if (!lastOutput) return;
    const format = currentFormat();
    if (isExtraFormat(format)) downloadText(extraOutputFileName(format), lastOutput, extraOutputMime(format));
    else downloadText(outputFileName(format), lastOutput, outputMime(format));
  });

  el('fakedata-copy').addEventListener('click', async () => {
    if (!lastOutput) return;
    const btn = el<HTMLButtonElement>('fakedata-copy');
    try {
      await navigator.clipboard.writeText(lastOutput);
      setBusy('fakedata-copy', true, 'Copied');
      setTimeout(() => setBusy('fakedata-copy', false), 1200);
    } catch {
      showError('fakedata-error', 'Could not copy to the clipboard. Use the download button instead.');
    }
  });

  el('fakedata-reset').addEventListener('click', () => {
    settings = { ...blankSettings(), columns: defaultColumns() };
    save();
    renderColumns();
    regenerate();
  });

  renderColumns();
  regenerate();
}
