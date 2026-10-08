// QR generator tool: DOM glue. Core logic lives in ../lib/qr-core.ts
import { makeQrPng, makeQrSvg, type QrErrorCorrection } from '../lib/qr-core.ts';
import { el, downloadDataUrl, downloadText, showError, hideError, setBusy, loadImage, bindSetting } from './common.ts';

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
  const marginSel = el<HTMLSelectElement>('qr-margin');
  const kindSel = el<HTMLSelectElement>('qr-kind');
  const kindFields = el('qr-kind-fields');
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

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }

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
      const rendered = await renderQr();
      let png = rendered.png;
      if (logoFile) png = await composeWithLogo(png, logoFile, rendered.px);
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
  for (const node of [textInput, sizeSel, ecSel, darkInput, lightInput, transparentChk, marginSel]) {
    node.addEventListener('input', refreshSoon);
    node.addEventListener('change', refreshSoon);
  }

  /**
   * Render the QR at the chosen size with a configurable quiet zone. The SVG
   * is rasterized module-exact (module count read from its viewBox), so the
   * margin is a precise number of modules instead of a guess.
   */
  async function renderQr(): Promise<{ png: string; px: number }> {
    const o = options();
    const size = o.size;
    const marginModules = Math.max(0, Math.min(10, Number(marginSel.value) || 0));
    const svg = await makeQrSvg({ ...o, light: '#ffffff00' });
    const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?)[ ,]/);
    const modules = m ? parseFloat(m[1]) - 8 : 0; // the library always adds a 4-module margin
    if (!(modules > 0)) return { png: await makeQrPng(o), px: size };
    const modulePx = size / modules;
    const px = Math.max(1, Math.round((modules + marginModules * 2) * modulePx));
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    if (!transparentChk.checked) {
      ctx.fillStyle = lightInput.value;
      ctx.fillRect(0, 0, px, px);
    }
    const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    const off = marginModules * modulePx;
    ctx.drawImage(img, off, off, modules * modulePx, modules * modulePx);
    return { png: canvas.toDataURL('image/png'), px };
  }

  // Content templates: fill the textarea with the right format for the job.
  document.querySelectorAll<HTMLButtonElement>('[data-qr-template]').forEach((btn) => {
    btn.addEventListener('click', () => {
      textInput.value = btn.getAttribute('data-qr-template') || '';
      refreshSoon();
      textInput.focus();
      // Put the cursor where the user types their own value.
      const v = textInput.value;
      const at = v.indexOf('YourNetwork') >= 0 ? v.indexOf('YourNetwork')
        : v.indexOf('you@example.com') >= 0 ? v.indexOf('you@example.com')
        : v.indexOf('+15551234567') >= 0 ? v.indexOf('+15551234567')
        : v.length;
      textInput.setSelectionRange(at, at + (v.startsWith('WIFI') ? 11 : v.startsWith('mailto') ? 15 : v.startsWith('tel') ? 12 : 0));
    });
  });

  // Remember the size, error-correction, and margin picks between visits.
  bindSetting('qr-generator', 'size', sizeSel, '1024');
  bindSetting('qr-generator', 'ec', ecSel, 'M');
  bindSetting('qr-generator', 'margin', marginSel, '4');

  // ---------- content builder ----------

  interface KindField {
    id: string;
    label: string;
    ph: string;
    kind?: 'select';
    options?: string[];
  }

  const KINDS: Record<string, { fields: KindField[] }> = {
    url: { fields: [{ id: 'url', label: 'Website address', ph: 'https://example.com' }] },
    wifi: {
      fields: [
        { id: 'ssid', label: 'Network name', ph: 'Home WiFi' },
        { id: 'pw', label: 'Password', ph: 'Leave blank for open networks' },
        { id: 'sec', label: 'Security', ph: '', kind: 'select', options: ['WPA', 'WEP', 'None'] },
      ],
    },
    email: {
      fields: [
        { id: 'to', label: 'To', ph: 'you@example.com' },
        { id: 'subject', label: 'Subject (optional)', ph: '' },
        { id: 'body', label: 'Message (optional)', ph: '' },
      ],
    },
    sms: {
      fields: [
        { id: 'to', label: 'Phone number', ph: '+15551234567' },
        { id: 'body', label: 'Message (optional)', ph: '' },
      ],
    },
    phone: { fields: [{ id: 'to', label: 'Phone number', ph: '+15551234567' }] },
    vcard: {
      fields: [
        { id: 'name', label: 'Full name', ph: 'Sam Rivera' },
        { id: 'phone', label: 'Phone (optional)', ph: '' },
        { id: 'email', label: 'Email (optional)', ph: '' },
        { id: 'org', label: 'Company (optional)', ph: '' },
      ],
    },
    location: {
      fields: [
        { id: 'lat', label: 'Latitude', ph: '37.7749' },
        { id: 'lng', label: 'Longitude', ph: '-122.4194' },
      ],
    },
    whatsapp: {
      fields: [
        { id: 'to', label: 'Phone number (country code + number, digits only)', ph: '15551234567' },
        { id: 'body', label: 'Prefilled message (optional)', ph: '' },
      ],
    },
  };

  function fieldVal(id: string): string {
    const n = kindFields.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-kfield="${id}"]`);
    return n ? n.value.trim() : '';
  }

  function useKindContent(): void {
    const kind = kindSel.value;
    const def = KINDS[kind];
    if (!def) return;
    if (!def.fields.some((f) => fieldVal(f.id) !== '')) {
      showError('error-box', 'Fill in the fields first, then use the content.');
      return;
    }
    let payload = '';
    if (kind === 'url') {
      payload = fieldVal('url');
    } else if (kind === 'wifi') {
      const sec = fieldVal('sec');
      const escWifi = (s: string): string => s.replace(/([\\;,:"'])/g, '\\$1');
      payload = `WIFI:T:${sec === 'None' ? 'nopass' : sec};S:${escWifi(fieldVal('ssid'))};${
        sec === 'None' ? '' : `P:${escWifi(fieldVal('pw'))};`
      };`;
    } else if (kind === 'email') {
      const q = [
        fieldVal('subject') ? `subject=${encodeURIComponent(fieldVal('subject'))}` : '',
        fieldVal('body') ? `body=${encodeURIComponent(fieldVal('body'))}` : '',
      ]
        .filter(Boolean)
        .join('&');
      payload = `mailto:${fieldVal('to')}${q ? `?${q}` : ''}`;
    } else if (kind === 'sms') {
      payload = `SMSTO:${fieldVal('to')}:${fieldVal('body')}`;
    } else if (kind === 'phone') {
      payload = `tel:${fieldVal('to')}`;
    } else if (kind === 'vcard') {
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${fieldVal('name')}`];
      if (fieldVal('phone')) lines.push(`TEL:${fieldVal('phone')}`);
      if (fieldVal('email')) lines.push(`EMAIL:${fieldVal('email')}`);
      if (fieldVal('org')) lines.push(`ORG:${fieldVal('org')}`);
      lines.push('END:VCARD');
      payload = lines.join('\n');
    } else if (kind === 'location') {
      payload = `geo:${fieldVal('lat')},${fieldVal('lng')}`;
    } else if (kind === 'whatsapp') {
      const digits = fieldVal('to').replace(/\D/g, '');
      payload = `https://wa.me/${digits}${fieldVal('body') ? `?text=${encodeURIComponent(fieldVal('body'))}` : ''}`;
    }
    hideError('error-box');
    textInput.value = payload;
    refreshSoon();
    textInput.focus();
  }

  function renderKindFields(): void {
    const def = KINDS[kindSel.value];
    if (!def) {
      kindFields.innerHTML = '';
      return;
    }
    kindFields.innerHTML =
      `<div class="field-row">` +
      def.fields
        .map((f) => {
          const input =
            f.kind === 'select'
              ? `<select data-kfield="${f.id}" aria-label="${escapeHtml(f.label)}">${(f.options ?? [])
                  .map((o) => `<option>${escapeHtml(o)}</option>`)
                  .join('')}</select>`
              : `<input type="text" data-kfield="${f.id}" placeholder="${escapeHtml(f.ph)}" aria-label="${escapeHtml(f.label)}" />`;
          return `<div class="field"><label>${escapeHtml(f.label)}</label>${input}</div>`;
        })
        .join('') +
      `</div><div class="btn-row"><button type="button" id="qr-kind-use" class="btn btn-secondary btn-small">Use this content</button></div>`;
    el('qr-kind-use').addEventListener('click', useKindContent);
  }

  kindSel.addEventListener('change', renderKindFields);
  renderKindFields();

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
  const logoUrl = URL.createObjectURL(logo);
  try {
    const [qrImg, logoImg] = await Promise.all([loadImage(qrDataUrl), loadImage(logoUrl)]);
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
  } finally {
    URL.revokeObjectURL(logoUrl);
  }
}
