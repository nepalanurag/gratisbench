// Protect PDF tool: DOM glue. Encryption runs in the browser via the
// Pyodide + pypdf engine shared with the unlock tool (see ./pyodide-loader.ts).
// pdf-lib cannot write encrypted PDFs, so pypdf applies AES encryption.
import { encryptPdfBytes, verifyEncryptedBytes, type EncryptPermissions } from './pyodide-loader.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
} from './common.ts';

type ProtectMode = 'open' | 'nocopy' | 'viewonly';

function passwordStrength(pw: string): { label: string; ok: boolean } {
  if (pw.length === 0) return { label: '', ok: false };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: 'Weak: too short or too simple.', ok: false };
  if (score <= 3) return { label: 'Okay, but longer is better.', ok: true };
  return { label: 'Strong password.', ok: true };
}

/** Plain-language description of what each mode locks down. */
const MODE_COPY: Record<ProtectMode, { perms?: EncryptPermissions; result: string }> = {
  open: {
    result: 'opens with your password',
  },
  nocopy: {
    // Anyone can open and print; the owner password is needed to copy text
    // or change anything. pypdf flag 4 = print only.
    perms: { ownerPassword: '', permissionFlags: 4 },
    result: 'opens freely · needs your password to copy text or make changes',
  },
  viewonly: {
    // Anyone can open and read; the owner password is needed to print,
    // copy, or change anything. Flag 0 = no permissions granted.
    perms: { ownerPassword: '', permissionFlags: 0 },
    result: 'opens freely · needs your password to print, copy, or make changes',
  },
};

function currentMode(): ProtectMode {
  return (
    (document.querySelector<HTMLInputElement>('input[name="protect-mode"]:checked')?.value as ProtectMode) ??
    'open'
  );
}

export function initProtectPdf(): void {
  const passInput = el<HTMLInputElement>('pass-input');
  const confirmInput = el<HTMLInputElement>('confirm-input');
  const protectBtn = el<HTMLButtonElement>('protect-btn');
  const result = el('result');
  let file: File | null = null;

  function refresh(): void {
    hideError('error-box');
    result.hidden = true;
    const pw = passInput.value;
    const { label } = passwordStrength(pw);
    el('pw-hint').textContent =
      label ||
      (currentMode() === 'open'
        ? ''
        : 'This password lifts the limits below; the file itself opens without it.');
    protectBtn.disabled = !file || pw.length === 0 || pw !== confirmInput.value;
  }

  setupDropzone('dropzone', 'file-input', (files) => {
    const f = files.find((x) => x.type === 'application/pdf' || x.name.toLowerCase().endsWith('.pdf'));
    if (!f) {
      file = null;
      el('file-label').textContent = '';
      refresh();
      showError('error-box', 'That is not a PDF file.');
      return;
    }
    file = f;
    el('file-label').textContent = `${f.name} · ${formatBytes(f.size)}`;
    refresh();
  });

  passInput.addEventListener('input', refresh);
  confirmInput.addEventListener('input', refresh);
  document
    .querySelectorAll<HTMLInputElement>('input[name="protect-mode"]')
    .forEach((r) => r.addEventListener('change', refresh));
  for (const input of [passInput, confirmInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !protectBtn.disabled) {
        e.preventDefault();
        protectBtn.click();
      }
    });
  }

  protectBtn.addEventListener('click', async () => {
    if (!file) return;
    hideError('error-box');
    result.hidden = true;
    const pw = passInput.value;
    if (pw !== confirmInput.value) {
      showError('error-box', 'The two passwords do not match. Type the same password twice.');
      return;
    }
    if (pw.length < 4) {
      showError('error-box', 'That password is too short. Use at least 4 characters.');
      return;
    }
    const mode = currentMode();
    const preset = MODE_COPY[mode];
    // Permission modes leave the file openable without a password; the
    // typed password becomes the owner password that lifts the limits.
    const userPw = mode === 'open' ? pw : '';
    const perms: EncryptPermissions | undefined =
      preset.perms && mode !== 'open' ? { ownerPassword: pw, permissionFlags: preset.perms.permissionFlags } : undefined;
    const status = el('engine-status');
    setBusy('protect-btn', true, 'Protecting…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const bytes = new Uint8Array(await file.arrayBuffer());
      const out = await encryptPdfBytes(
        bytes,
        userPw,
        (msg) => {
          status.textContent = msg;
        },
        'protect',
        perms
      );
      status.textContent = 'Checking the protected file…';
      // Prove the password really works: the output must open with it.
      // Permission modes must additionally open with no password at all.
      if (mode !== 'open') {
        await verifyEncryptedBytes(out, '');
      }
      const pages = await verifyEncryptedBytes(out, pw);
      status.textContent = '';
      const baseName = file.name.replace(/\.pdf$/i, '');
      el('result-info').textContent =
        `${formatBytes(out.length)} · ${pages} page${pages === 1 ? '' : 's'} · ${preset.result}`;
      const dl = el<HTMLButtonElement>('download-btn');
      dl.onclick = () => downloadBytes(`${baseName}-protected.pdf`, out, 'application/pdf');
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      status.textContent = '';
      showError(
        'error-box',
        err instanceof Error && err.message === 'ALREADY_ENCRYPTED'
          ? 'This PDF is already password-protected. Use the Unlock PDF tool first if you want to change the password.'
          : err instanceof Error
            ? err.message
            : 'Protecting failed.'
      );
    } finally {
      setBusy('protect-btn', false);
    }
  });

  refresh();
}
