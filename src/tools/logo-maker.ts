// Logo maker tool: DOM glue. Core logic lives in ../lib/logo-core.ts
import {
  LOGO_STORAGE_KEY,
  LOGO_ICONS,
  LOGO_SHAPES,
  LOGO_FONTS,
  LOGO_PRESETS,
  LOGO_PNG_SIZES,
  blankLogoSpec,
  exampleLogoSpec,
  sanitizeLogoSpec,
  serializeLogoSpec,
  deserializeLogoSpec,
  logoIconById,
  logoFontById,
  logoPresetById,
  logoSvg,
  logoPngSize,
  logoFileName,
  type LogoSpec,
} from '../lib/logo-core.ts';
import { el, downloadDataUrl, downloadText, showError, hideError } from './common.ts';
import { loadBusinessProfile, saveBusinessProfile } from '../lib/business-profile.ts';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initLogoMaker(): void {
  let spec: LogoSpec;
  let hadSaved: boolean;
  try {
    const raw = localStorage.getItem(LOGO_STORAGE_KEY);
    hadSaved = raw !== null;
    spec = deserializeLogoSpec(raw);
  } catch {
    spec = blankLogoSpec();
    hadSaved = false;
  }
  if (!spec.name) {
    // First visit: borrow the shared business profile's name if the user set
    // one up elsewhere, so the logo starts with their own business name.
    // Anything saved in this tool later always wins over the profile.
    const profile = loadBusinessProfile();
    if (!hadSaved && profile.name.trim()) {
      spec = { ...blankLogoSpec(), name: profile.name.trim(), tagline: profile.tagline.trim() };
    } else {
      spec = { ...exampleLogoSpec() };
    }
  }

  function save(): void {
    try {
      localStorage.setItem(LOGO_STORAGE_KEY, serializeLogoSpec(spec));
    } catch {
      /* storage unavailable: the tool still works for the session */
    }
  }

  function iconButton(iconId: string, active: boolean): string {
    const icon = logoIconById(iconId);
    return `<button type="button" class="icon-pick" data-icon="${icon.id}" aria-pressed="${active}" title="${escapeHtml(icon.name)}" aria-label="Icon: ${escapeHtml(icon.name)}">` +
      `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.paths}</svg></button>`;
  }

  function renderPickers(): void {
    el('logo-icons').innerHTML = LOGO_ICONS.map((i) => iconButton(i.id, i.id === spec.iconId)).join('');
    el('logo-shapes').innerHTML = LOGO_SHAPES.map(
      (s) => `<button type="button" class="pill${s.id === spec.shape ? ' pill-active' : ''}" data-shape="${s.id}" aria-pressed="${s.id === spec.shape}">${s.name}</button>`
    ).join('');
    el('logo-fonts').innerHTML = LOGO_FONTS.map(
      (f) => `<button type="button" class="pill${f.id === spec.fontId ? ' pill-active' : ''}" data-font="${f.id}" aria-pressed="${f.id === spec.fontId}">${f.name}</button>`
    ).join('');
    el('logo-presets').innerHTML = LOGO_PRESETS.map((p) => {
      const active = p.id === spec.presetId;
      return `<button type="button" class="swatch" data-preset="${p.id}" aria-pressed="${active}" title="${escapeHtml(p.name)}" aria-label="Colors: ${escapeHtml(p.name)}" style="background: linear-gradient(135deg, ${p.bg} 50%, ${p.accent} 50%);"></button>`;
    }).join('');
  }

  function renderPreview(): void {
    const svg = logoSvg(spec);
    const box = el('logo-preview');
    box.innerHTML = svg;
    const node = box.querySelector('svg');
    if (node) {
      node.removeAttribute('width');
      node.removeAttribute('height');
      node.style.width = '100%';
      node.style.height = 'auto';
      node.style.display = 'block';
      node.style.borderRadius = '8px';
    }
  }

  function refresh(): void {
    save();
    renderPickers();
    renderPreview();
  }

  function svgToPng(px: number): Promise<string> {
    const { width, height } = logoPngSize(px);
    const svg = logoSvg(spec);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas is not available in this browser.');
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not render the logo image.'));
      };
      img.src = url;
    });
  }

  // inputs
  const nameInput = el<HTMLInputElement>('logo-name');
  const taglineInput = el<HTMLInputElement>('logo-tagline');
  nameInput.value = spec.name;
  taglineInput.value = spec.tagline;
  nameInput.addEventListener('input', () => {
    spec.name = nameInput.value;
    save();
    renderPreview();
  });
  taglineInput.addEventListener('input', () => {
    spec.tagline = taglineInput.value;
    save();
    renderPreview();
  });

  el('logo-icons').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-icon]');
    if (!btn) return;
    spec.iconId = btn.getAttribute('data-icon') || spec.iconId;
    refresh();
  });
  el('logo-shapes').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-shape]');
    if (!btn) return;
    spec.shape = (btn.getAttribute('data-shape') || 'circle') as LogoSpec['shape'];
    refresh();
  });
  el('logo-fonts').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-font]');
    if (!btn) return;
    spec.fontId = (btn.getAttribute('data-font') || 'sans') as LogoSpec['fontId'];
    refresh();
  });
  el('logo-presets').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-preset]');
    if (!btn) return;
    spec.presetId = btn.getAttribute('data-preset') || spec.presetId;
    refresh();
  });

  async function exportPng(px: number): Promise<void> {
    hideError('logo-error');
    try {
      const url = await svgToPng(px);
      downloadDataUrl(logoFileName(spec.name, 'png').replace('.png', `-${px}px.png`), url);
    } catch (err) {
      showError('logo-error', err instanceof Error ? err.message : 'PNG export failed.');
    }
  }

  el('logo-png-512').addEventListener('click', () => void exportPng(LOGO_PNG_SIZES[0]));
  el('logo-png-1024').addEventListener('click', () => void exportPng(LOGO_PNG_SIZES[1]));
  el('logo-svg').addEventListener('click', () => {
    hideError('logo-error');
    downloadText(logoFileName(spec.name, 'svg'), logoSvg(spec), 'image/svg+xml');
  });
  el('logo-example').addEventListener('click', () => {
    hideError('logo-error');
    spec = exampleLogoSpec();
    nameInput.value = spec.name;
    taglineInput.value = spec.tagline;
    refresh();
  });

  // Save the finished logo into the shared business profile so the other
  // business tools (like the invoice generator) can pick it up.
  el('logo-save-profile').addEventListener('click', () => {
    hideError('logo-error');
    const note = el('logo-profile-note');
    note.textContent = '';
    void (async () => {
      try {
        const url = await svgToPng(LOGO_PNG_SIZES[0]);
        const profile = loadBusinessProfile();
        saveBusinessProfile({
          ...profile,
          name: spec.name.trim() || profile.name,
          tagline: spec.tagline.trim() || profile.tagline,
          logoDataUrl: url,
        });
        note.textContent = 'Saved to your business profile.';
      } catch (err) {
        showError('logo-error', err instanceof Error ? err.message : 'Could not save to the business profile.');
      }
    })();
  });

  refresh();
}
