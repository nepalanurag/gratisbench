// OG image generator tool: DOM glue. Layout math lives in ../lib/og-core.ts;
// this module only draws what the layout describes onto a canvas.
import {
  OG_STORAGE_KEY,
  OG_PRESETS,
  OG_THEMES,
  OG_PATTERNS,
  blankOgSpec,
  exampleOgSpec,
  sanitizeOgSpec,
  serializeOgSpec,
  deserializeOgSpec,
  ogPresetById,
  ogThemeById,
  layoutOg,
  headlineFont,
  bodyFont,
  ogFileName,
  type OgSpec,
  type OgTheme,
  type OgPattern,
} from '../lib/og-core.ts';
import { el, downloadDataUrl, showError, hideError } from './common.ts';

function drawPattern(ctx: CanvasRenderingContext2D, theme: OgTheme, pattern: OgPattern, w: number, h: number): void {
  if (pattern === 'none') return;
  ctx.save();
  ctx.fillStyle = theme.pattern;
  ctx.strokeStyle = theme.pattern;
  if (pattern === 'dots') {
    const gap = Math.round(w / 24);
    const r = Math.max(2, gap * 0.09);
    for (let y = gap; y < h; y += gap) {
      for (let x = gap; x < w; x += gap) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === 'grid') {
    const gap = Math.round(w / 20);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = gap; x < w; x += gap) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = gap; y < h; y += gap) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  } else if (pattern === 'diagonal') {
    const gap = Math.round(w / 26);
    ctx.lineWidth = Math.max(2, gap * 0.12);
    ctx.beginPath();
    for (let x = -h; x < w + h; x += gap) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
    }
    ctx.stroke();
  } else if (pattern === 'rings') {
    const cx = w * 0.88;
    const cy = h * 0.12;
    ctx.lineWidth = Math.max(2, w * 0.004);
    for (let i = 1; i <= 6; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (w * 0.055) * i, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCard(canvas: HTMLCanvasElement, spec: OgSpec): void {
  const s = sanitizeOgSpec(spec);
  const layout = layoutOg(s);
  const { preset, theme } = layout;
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, preset.width, preset.height);
  drawPattern(ctx, theme, s.pattern, preset.width, preset.height);

  // headline
  ctx.fillStyle = theme.fg;
  ctx.font = `700 ${layout.headline.px}px ${headlineFont()}`;
  ctx.textBaseline = 'alphabetic';
  layout.headline.lines.forEach((line, i) => {
    ctx.fillText(line, layout.padX, layout.headlineTop + i * layout.headline.lineHeight, preset.width - layout.padX * 2);
  });

  // subtext
  if (s.subtext.trim()) {
    ctx.fillStyle = theme.muted;
    ctx.font = `400 ${layout.sub.px}px ${bodyFont()}`;
    layout.sub.lines.forEach((line, i) => {
      ctx.fillText(line, layout.padX, layout.subTop + i * layout.sub.lineHeight, preset.width - layout.padX * 2);
    });
  }

  // brand line with accent rule
  if (s.brand.trim()) {
    const rule = layout.accentRule;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(rule.x, rule.y, rule.w, rule.h);
    ctx.fillStyle = theme.fg;
    ctx.font = `700 ${layout.brandPx}px ${bodyFont()}`;
    ctx.fillText(s.brand.trim().toUpperCase(), layout.padX, layout.brandBaseline);
  }
}

export function initOgImageGenerator(): void {
  let spec: OgSpec;
  try {
    spec = deserializeOgSpec(localStorage.getItem(OG_STORAGE_KEY));
  } catch {
    spec = blankOgSpec();
  }

  function save(): void {
    try {
      localStorage.setItem(OG_STORAGE_KEY, serializeOgSpec(spec));
    } catch {
      /* storage unavailable: the tool still works for the session */
    }
  }

  const presetSel = el<HTMLSelectElement>('og-preset');
  presetSel.innerHTML = OG_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  const patternSel = el<HTMLSelectElement>('og-pattern');
  patternSel.innerHTML = OG_PATTERNS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');

  function renderThemes(): void {
    el('og-themes').innerHTML = OG_THEMES.map((t) => {
      const active = t.id === spec.themeId;
      return `<button type="button" class="swatch" data-theme="${t.id}" aria-pressed="${active}" title="${t.name}" aria-label="Theme: ${t.name}" style="background: linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%);"></button>`;
    }).join('');
  }

  function render(): void {
    hideError('og-error');
    try {
      renderThemes();
      const canvas = el<HTMLCanvasElement>('og-canvas');
      drawCard(canvas, spec);
      const preset = ogPresetById(spec.presetId);
      const theme = ogThemeById(spec.themeId);
      el('og-size-note').textContent = `${preset.width} x ${preset.height} px · ${theme.name} theme · PNG download is full resolution.`;
    } catch (err) {
      showError('og-error', err instanceof Error ? err.message : 'Could not draw the card.');
    }
    save();
  }

  // wire inputs
  presetSel.value = spec.presetId;
  patternSel.value = spec.pattern;
  el<HTMLTextAreaElement>('og-headline').value = spec.headline;
  el<HTMLInputElement>('og-subtext').value = spec.subtext;
  el<HTMLInputElement>('og-brand').value = spec.brand;

  presetSel.addEventListener('change', () => {
    spec.presetId = presetSel.value;
    render();
  });
  patternSel.addEventListener('change', () => {
    spec.pattern = patternSel.value as OgPattern;
    render();
  });
  el<HTMLTextAreaElement>('og-headline').addEventListener('input', (e) => {
    spec.headline = (e.target as HTMLTextAreaElement).value;
    render();
  });
  el<HTMLInputElement>('og-subtext').addEventListener('input', (e) => {
    spec.subtext = (e.target as HTMLInputElement).value;
    render();
  });
  el<HTMLInputElement>('og-brand').addEventListener('input', (e) => {
    spec.brand = (e.target as HTMLInputElement).value;
    render();
  });

  el('og-themes').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-theme]');
    if (!btn) return;
    spec.themeId = btn.getAttribute('data-theme') || spec.themeId;
    render();
  });

  el('og-download').addEventListener('click', () => {
    hideError('og-error');
    try {
      const canvas = el<HTMLCanvasElement>('og-canvas');
      drawCard(canvas, spec); // redraw at full export resolution
      downloadDataUrl(ogFileName(spec.brand, spec.presetId), canvas.toDataURL('image/png'));
    } catch (err) {
      showError('og-error', err instanceof Error ? err.message : 'Download failed.');
    }
  });

  el('og-example').addEventListener('click', () => {
    spec = exampleOgSpec();
    presetSel.value = spec.presetId;
    patternSel.value = spec.pattern;
    el<HTMLTextAreaElement>('og-headline').value = spec.headline;
    el<HTMLInputElement>('og-subtext').value = spec.subtext;
    el<HTMLInputElement>('og-brand').value = spec.brand;
    render();
  });

  render();
}
