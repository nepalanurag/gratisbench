// Unlock PDF tool: DOM glue. Decryption runs in the browser via the
// Pyodide + pypdf engine (see ./pyodide-loader.ts). pdf-lib cannot
// decrypt password-protected PDFs, so it is only used to double-check
// that the unlocked output opens without a password.
import { PDFDocument } from 'pdf-lib';
import { unlockPdfBytes } from './pyodide-loader.ts';
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
  let file: File | null = null;

  function refresh(): void {
    hideError('error-box');
    result.hidden = true;
    unlockBtn.disabled = !file;
  }

  setupDropzone('dropzone', 'file-input', (files) => {
    const f = files.find((x) => x.type === 'application/pdf' || x.name.toLowerCase().endsWith('.pdf'));
    if (!f) {
      showError('error-box', 'That is not a PDF file.');
      return;
    }
    file = f;
    el('file-label').textContent = `${f.name} · ${formatBytes(f.size)}`;
    refresh();
  });

  passInput.addEventListener('input', refresh);

  unlockBtn.addEventListener('click', async () => {
    if (!file) return;
    hideError('error-box');
    result.hidden = true;
    const status = el('engine-status');
    setBusy('unlock-btn', true, 'Unlocking…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const bytes = new Uint8Array(await file.arrayBuffer());
      const out = await unlockPdfBytes(bytes, passInput.value, (msg) => {
        status.textContent = msg;
      });
      status.textContent = '';
      // Prove the password is really gone: the output must open with no password.
      const check = await PDFDocument.load(out);
      const pages = check.getPageCount();
      const baseName = file.name.replace(/\.pdf$/i, '');
      el('result-info').textContent =
        `${formatBytes(out.length)} · ${pages} page${pages === 1 ? '' : 's'} · opens with no password`;
      const dl = el<HTMLButtonElement>('download-btn');
      dl.onclick = () => downloadBytes(`${baseName}-unlocked.pdf`, out, 'application/pdf');
      void showPdfPreview('preview-wrap', out);
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      status.textContent = '';
      showError(
        'error-box',
        err instanceof Error && err.message === 'WRONG_PASSWORD'
          ? 'That password did not work for this file. Check for typos and try again.'
          : err instanceof Error
            ? err.message
            : 'Unlocking failed.'
      );
    } finally {
      setBusy('unlock-btn', false);
    }
  });

  refresh();
}
