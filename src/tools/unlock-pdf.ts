// Unlock PDF tool: remove password protection when the password is known.
// pdf-lib can open an encrypted PDF with the right password; saving the
// loaded document writes it back without encryption. Nothing is uploaded.
import { PDFDocument } from 'pdf-lib';
import { showPdfPreview } from './pdf-render.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
} from './common.ts';

export function initUnlockPdf(): void {
  const passInput = el<HTMLInputElement>('pass-input');
  const unlockBtn = el<HTMLButtonElement>('unlock-btn');
  const result = el('result');
  let fileBytes: Uint8Array | null = null;
  let baseName = 'document';

  const updateBtn = () => {
    unlockBtn.disabled = !(fileBytes && passInput.value.length > 0);
  };

  setupDropzone('dropzone', 'file-input', async (files) => {
    const file = files[0];
    if (!file) return;
    hideError('error-box');
    result.hidden = true;
    fileBytes = new Uint8Array(await file.arrayBuffer());
    baseName = file.name.replace(/\.pdf$/i, '') || 'document';
    el('file-label').textContent = `${file.name} · ${formatBytes(file.size)}`;
    updateBtn();
  });

  passInput.addEventListener('input', updateBtn);

  unlockBtn.addEventListener('click', async () => {
    if (!fileBytes || !passInput.value) return;
    hideError('error-box');
    result.hidden = true;
    setBusy('unlock-btn', true, 'Unlocking…');
    try {
      const doc = await PDFDocument.load(fileBytes.slice(), { password: passInput.value });
      const out = await doc.save();
      // Sanity check: the output must open with no password at all.
      await PDFDocument.load(out);
      el('result-info').textContent =
        `${formatBytes(out.length)} · ${doc.getPageCount()} pages · password removed`;
      const dl = el<HTMLButtonElement>('download-btn');
      dl.onclick = () => downloadBytes(`${baseName}-unlocked.pdf`, out, 'application/pdf');
      void showPdfPreview('preview-wrap', out);
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showError(
        'error-box',
        /password|decrypt|encrypt/i.test(msg)
          ? 'That password did not work for this file. Check for typos and try again.'
          : msg || 'Could not unlock that file.'
      );
    } finally {
      setBusy('unlock-btn', false);
    }
  });
}
