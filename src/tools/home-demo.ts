// Homepage "try it now" demo: a small live QR generator.
// Reuses the tested QR core. No network, no dependencies beyond the
// vendored 'qrcode' package that the full QR tool already uses.
import { makeQrPng } from '../lib/qr-core.ts';

export function initHomeDemo(): void {
  const input = document.getElementById('demo-qr-text') as HTMLInputElement | null;
  const img = document.getElementById('demo-qr-img') as HTMLImageElement | null;
  const empty = document.getElementById('demo-qr-empty');
  const dl = document.getElementById('demo-qr-dl') as HTMLButtonElement | null;
  const err = document.getElementById('demo-qr-err');
  if (!input || !img || !dl) return;
  // Narrowed aliases: TS does not propagate the guard's narrowing into the
  // nested render() closure, so bind the non-null values to fresh consts.
  const textInput: HTMLInputElement = input;
  const qrImg: HTMLImageElement = img;
  const dlBtn: HTMLButtonElement = dl;

  let current = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  async function render() {
    const mine = ++seq;
    const text = textInput.value.trim();
    if (err) err.hidden = true;
    if (!text) {
      current = '';
      qrImg.hidden = true;
      if (empty) empty.hidden = false;
      dlBtn.disabled = true;
      return;
    }
    try {
      const url = await makeQrPng({ text, size: 512, errorCorrection: 'M' });
      if (mine !== seq) return; // a newer keystroke already started
      current = url;
      qrImg.src = url;
      qrImg.hidden = false;
      if (empty) empty.hidden = true;
      dlBtn.disabled = false;
    } catch (e) {
      if (mine !== seq) return;
      if (err) {
        err.textContent = e instanceof Error ? e.message : 'Could not make that code.';
        err.hidden = false;
      }
    }
  }

  textInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 250);
  });
  dlBtn.addEventListener('click', () => {
    if (!current) return;
    const a = document.createElement('a');
    a.href = current;
    a.download = 'truepdf-qr.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  render();
}
