// v2: force rebuild
// Repair PDF tool: DOM glue. The attempt is one pdf-lib call in
// ../lib/pdf-core.ts (repairPdf), with deliberately honest messaging.
import { repairPdf, repairedFileName, getPageCount } from '../lib/pdf-core.ts';
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

export function initRepairPdf(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('repair-wrap').hidden = true;
    sourceBytes = null;
    const f = files[0];
    if (!f) return;
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
    sourceBytes = new Uint8Array(await f.arrayBuffer());
    el('file-info').textContent = `${f.name} · ${formatBytes(f.size)}`;
    el('repair-wrap').hidden = false;
  });

  el('repair-btn').addEventListener('click', async () => {
    if (!sourceBytes) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('repair-btn', true, 'Repairing…');
    try {
      const out = await repairPdf(sourceBytes.slice());
      const pages = await getPageCount(out);
      const outName = repairedFileName(fileStem);
      el('result-info').textContent =
        `${formatBytes(out.length)} · ${pages} page${pages === 1 ? '' : 's'} recovered. ` +
        'Open it and check that the content looks right before relying on it.';
      el('result').hidden = false;
      el<HTMLButtonElement>('download-btn').onclick = () => downloadBytes(outName, out, 'application/pdf');
      el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Repair failed.');
    } finally {
      setBusy('repair-btn', false);
    }
  });
}
