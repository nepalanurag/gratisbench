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

  let current = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  async function render() {
    const mine = ++seq;
    const text = input.value.trim();
    if (err) err.hidden = true;
    if (!text) {
      current = '';
      img.hidden = true;
      if (empty) empty.hidden = false;
      dl.disabled = true;
      return;
    }
    try {
      const url = await makeQrPng({ text, size: 512, errorCorrection: 'M' });
      if (mine !== seq) return; // a newer keystroke already started
      current = url;
      img.src = url;
      img.hidden = false;
      if (empty) empty.hidden = true;
      dl.disabled = false;
    } catch (e) {
      if (mine !== seq) return;
      if (err) {
        err.textContent = e instanceof Error ? e.message : 'Could not make that code.';
        err.hidden = false;
      }
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 250);
  });
  dl.addEventListener('click', () => {
    if (!current) return;
    const a = document.createElement('a');
    a.href = current;
    a.download = 'freekit-qr.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  render();
}
