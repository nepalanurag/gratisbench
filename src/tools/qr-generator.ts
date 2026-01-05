// QR generator tool: DOM glue. Core logic lives in ../lib/qr-core.ts
import { makeQrPng, makeQrSvg, type QrErrorCorrection } from '../lib/qr-core.ts';
import { el, downloadDataUrl, downloadText, showError, hideError, setBusy, loadImage } from './common.ts';

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: never[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

export function initQrGenerator(): void {
  const textInput = el<HTMLTextAreaElement>('qr-text');
  const sizeSel = el<HTMLSelectElement>('qr-size');
  const ecSel = el<HTMLSelectElement>('qr-ec');
  const darkInput = el<HTMLInputElement>('qr-dark');
  const lightInput = el<HTMLInputElement>('qr-light');
  const transparentChk = el<HTMLInputElement>('qr-transparent');
  const logoInput = el<HTMLInputElement>('logo-input');
  const logoName = el('logo-name');
  const preview = el<HTMLImageElement>('qr-preview');
  const previewWrap = el('qr-preview-wrap');
  const placeholder = el('qr-placeholder');
  const pngBtn = el<HTMLButtonElement>('dl-png');
  const svgBtn = el<HTMLButtonElement>('dl-svg');
  const ecNote = el('ec-note');

  let logoFile: File | null = null;
  let currentPng = '';

  function options() {
    // With a center logo, part of the code is covered: force high error
    // correction so the code still scans.
    const ec = (logoFile ? 'H' : ecSel.value) as QrErrorCorrection;
    return {
      text: textInput.value.trim(),
      size: Number(sizeSel.value),
      errorCorrection: ec,
      dark: darkInput.value,
      light: transparentChk.checked ? '#ffffff00' : lightInput.value,
    };
  }

  async function refresh(): Promise<void> {
    hideError('error-box');
    const text = textInput.value.trim();
    if (!text) {
      previewWrap.hidden = true;
      placeholder.hidden = false;
      pngBtn.disabled = true;
      svgBtn.disabled = true;
      return;
    }
    try {
      let png = await makeQrPng(options());
      if (logoFile) png = await composeWithLogo(png, logoFile, Number(sizeSel.value));
      currentPng = png;
      preview.src = png;
      previewWrap.hidden = false;
      placeholder.hidden = true;
      pngBtn.disabled = false;
      svgBtn.disabled = false;
      ecNote.hidden = !logoFile;
    } catch (err) {
      previewWrap.hidden = true;
      placeholder.hidden = false;
      pngBtn.disabled = true;
      svgBtn.disabled = true;
      showError('error-box', err instanceof Error ? err.message : 'Could not generate the QR code.');
    }
  }

  const refreshSoon = debounce(() => void refresh(), 350);
  for (const node of [textInput, sizeSel, ecSel, darkInput, lightInput, transparentChk]) {
    node.addEventListener('input', refreshSoon);
    node.addEventListener('change', refreshSoon);
  }

  logoInput.addEventListener('change', () => {
    logoFile = logoInput.files?.[0] ?? null;
    logoName.textContent = logoFile ? logoFile.name : 'No logo selected';
    el('remove-logo').hidden = !logoFile;
    void refresh();
  });
  el('remove-logo').addEventListener('click', () => {
    logoFile = null;
    logoInput.value = '';
    logoName.textContent = 'No logo selected';
    el('remove-logo').hidden = true;
    void refresh();
  });

  pngBtn.addEventListener('click', () => {
    if (currentPng) downloadDataUrl('qr-code.png', currentPng);
  });
  svgBtn.addEventListener('click', async () => {
    setBusy('dl-svg', true, '…');
    try {
      const svg = await makeQrSvg(options());
      downloadText('qr-code.svg', svg, 'image/svg+xml');
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Could not generate the SVG.');
    } finally {
      setBusy('dl-svg', false);
    }
  });

  void refresh();
}

/** Draw the QR code and center the logo on top with a white backing. */
async function composeWithLogo(qrDataUrl: string, logo: File, size: number): Promise<string> {
  const [qrImg, logoImg] = await Promise.all([
    loadImage(qrDataUrl),
    loadImage(URL.createObjectURL(logo)),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.drawImage(qrImg, 0, 0, size, size);

  const logoSize = Math.round(size * 0.22);
  const x = (size - logoSize) / 2;
  const y = (size - logoSize) / 2;
  // White rounded backing keeps the logo area scannable.
  const pad = Math.round(size * 0.02);
  const rx = x - pad;
  const ry = y - pad;
  const rw = logoSize + pad * 2;
  const rr = Math.round(size * 0.03);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(rx, ry, rw, rw, rr);
  ctx.fill();
  ctx.drawImage(logoImg, x, y, logoSize, logoSize);
  return canvas.toDataURL('image/png');
}
