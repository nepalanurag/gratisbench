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
  ogThemeById,
  layoutOg,
  headlineFont,
  bodyFont,
  type OgSpec,
  type OgTheme,
} from '../lib/og-core.ts';
import {
  EXTRA_OG_PRESETS,
  isExtraOgPresetId,
  ogPresetByIdExtended,
  ogFileNameExtended,
  layoutOgExtended,
  loadOgStyleExtras,
  saveOgStyleExtras,
  loadOgExtraPreset,
  saveOgExtraPreset,
  type OgStyleExtras,
} from '../lib/og-extras.ts';
import { el, downloadDataUrl, showError, hideError, armConfirmButton } from './common.ts';

const EXTRA_PATTERNS = [
  { id: 'waves', name: 'Waves' },
  { id: 'plus', name: 'Plus signs' },
  { id: 'triangles', name: 'Triangles' },
];

function isExtraPatternId(id: string): boolean {
  return EXTRA_PATTERNS.some((p) => p.id === id);
}

/** #rrggbb with an alpha channel, for the pattern tint of a custom accent. */
function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function drawPattern(ctx: CanvasRenderingContext2D, theme: OgTheme, pattern: string, w: number, h: number): void {
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
  } else if (pattern === 'waves') {
    const gap = Math.round(h / 12);
    ctx.lineWidth = Math.max(2, w * 0.003);
    ctx.beginPath();
    for (let y = gap; y < h + gap; y += gap) {
      for (let x = 0; x < w; x += 80) {
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 20, y - 12, x + 40, y);
        ctx.quadraticCurveTo(x + 60, y + 12, x + 80, y);
      }
    }
    ctx.stroke();
  } else if (pattern === 'plus') {
    const gap = Math.round(w / 22);
    const r = Math.max(2, gap * 0.12);
    ctx.lineWidth = Math.max(2, gap * 0.1);
    ctx.beginPath();
    for (let y = gap; y < h; y += gap) {
      for (let x = gap; x < w; x += gap) {
        ctx.moveTo(x - r, y);
        ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y + r);
      }
    }
    ctx.stroke();
  } else if (pattern === 'triangles') {
    const gap = Math.round(w / 18);
    const r = Math.max(3, gap * 0.16);
    ctx.beginPath();
    for (let y = gap; y < h; y += gap) {
      for (let x = gap; x < w; x += gap) {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y + r * 0.8);
        ctx.lineTo(x - r, y + r * 0.8);
        ctx.closePath();
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawCard(canvas: HTMLCanvasElement, spec: OgSpec, style: OgStyleExtras, patternId: string): void {
  // Extended presets bypass the core sanitizer (it would reset their ids), so
  // the layout choice is made on the raw spec.
  const layout = isExtraOgPresetId(spec.presetId) ? layoutOgExtended(spec) : layoutOg(sanitizeOgSpec(spec));
  const { preset } = layout;
  const baseTheme = layout.theme;
  const theme: OgTheme = style.accent
    ? { ...baseTheme, accent: style.accent, pattern: hexA(style.accent, 0.1) }
    : baseTheme;
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, preset.width, preset.height);
  drawPattern(ctx, theme, patternId, preset.width, preset.height);

  const centered = style.align === 'center';
  const maxTextW = preset.width - layout.padX * 2;
  const tx = (text: string): number =>
    centered ? layout.padX + (maxTextW - ctx.measureText(text).width) / 2 : layout.padX;

  // headline
  ctx.fillStyle = theme.fg;
  ctx.font = `700 ${layout.headline.px}px ${headlineFont()}`;
  ctx.textBaseline = 'alphabetic';
  layout.headline.lines.forEach((line, i) => {
    ctx.fillText(line, tx(line), layout.headlineTop + i * layout.headline.lineHeight, maxTextW);
  });

  // subtext
  const s = sanitizeOgSpec(spec);
  if (s.subtext.trim()) {
    ctx.fillStyle = theme.muted;
    ctx.font = `400 ${layout.sub.px}px ${bodyFont()}`;
    layout.sub.lines.forEach((line, i) => {
      ctx.fillText(line, tx(line), layout.subTop + i * layout.sub.lineHeight, maxTextW);
    });
  }

  // brand line with accent rule
  if (s.brand.trim()) {
    const rule = layout.accentRule;
    ctx.fillStyle = theme.accent;
    const ruleX = centered ? Math.round((preset.width - rule.w) / 2) : rule.x;
    ctx.fillRect(ruleX, rule.y, rule.w, rule.h);
    ctx.fillStyle = theme.fg;
    ctx.font = `700 ${layout.brandPx}px ${bodyFont()}`;
    const brandText = s.brand.trim().toUpperCase();
    ctx.fillText(brandText, tx(brandText), layout.brandBaseline);
  }
}

export function initOgImageGenerator(): void {
  let spec: OgSpec;
  try {
    spec = deserializeOgSpec(localStorage.getItem(OG_STORAGE_KEY));
  } catch {
    spec = blankOgSpec();
  }
  let style: OgStyleExtras = loadOgStyleExtras();
  // Extended picks live outside the core serializer; reapply them.
  const rememberedPreset = loadOgExtraPreset();
  if (rememberedPreset) spec.presetId = rememberedPreset;
  let patternId: string = style.pattern || spec.pattern;

  function save(): void {
    try {
      localStorage.setItem(OG_STORAGE_KEY, serializeOgSpec(spec));
    } catch {
      /* storage unavailable: the tool still works for the session */
    }
    saveOgExtraPreset(spec.presetId);
    saveOgStyleExtras({ ...style, pattern: isExtraPatternId(patternId) ? patternId : '' });
  }

  const presetSel = el<HTMLSelectElement>('og-preset');
  presetSel.innerHTML = [...OG_PRESETS, ...EXTRA_OG_PRESETS]
    .map((p) => `<option value="${p.id}">${p.label}</option>`)
    .join('');
  const patternSel = el<HTMLSelectElement>('og-pattern');
  patternSel.innerHTML = [...OG_PATTERNS, ...EXTRA_PATTERNS]
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');

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
      drawCard(canvas, spec, style, patternId);
      const preset = ogPresetByIdExtended(spec.presetId);
      const theme = ogThemeById(spec.themeId);
      el('og-size-note').textContent = `${preset.width} x ${preset.height} px · ${theme.name} theme · PNG download is full resolution.`;
    } catch (err) {
      showError('og-error', err instanceof Error ? err.message : 'Could not draw the card.');
    }
    save();
  }

  // wire inputs
  presetSel.value = spec.presetId;
  patternSel.value = patternId;
  el<HTMLTextAreaElement>('og-headline').value = spec.headline;
  el<HTMLInputElement>('og-subtext').value = spec.subtext;
  el<HTMLInputElement>('og-brand').value = spec.brand;
  const accentInput = el<HTMLInputElement>('og-accent');
  if (style.accent) accentInput.value = style.accent;
  el<HTMLSelectElement>('og-align').value = style.align;

  presetSel.addEventListener('change', () => {
    spec.presetId = presetSel.value;
    render();
  });
  patternSel.addEventListener('change', () => {
    patternId = patternSel.value;
    if (!isExtraPatternId(patternId)) spec.pattern = patternId as OgSpec['pattern'];
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

  accentInput.addEventListener('input', () => {
    style = { ...style, accent: accentInput.value };
    render();
  });
  el('og-accent-reset').addEventListener('click', () => {
    style = { ...style, accent: '' };
    accentInput.value = '#a63d21';
    render();
  });
  el<HTMLSelectElement>('og-align').addEventListener('change', (e) => {
    style = { ...style, align: (e.target as HTMLSelectElement).value === 'center' ? 'center' : 'left' };
    render();
  });

  el('og-download').addEventListener('click', () => {
    hideError('og-error');
    try {
      const canvas = el<HTMLCanvasElement>('og-canvas');
      drawCard(canvas, spec, style, patternId); // redraw at full export resolution
      downloadDataUrl(ogFileNameExtended(spec.brand, spec.presetId), canvas.toDataURL('image/png'));
    } catch (err) {
      showError('og-error', err instanceof Error ? err.message : 'Download failed.');
    }
  });

  armConfirmButton(
    el<HTMLButtonElement>('og-example'),
    () => {
      spec = exampleOgSpec();
      presetSel.value = spec.presetId;
      patternId = spec.pattern;
      patternSel.value = patternId;
      el<HTMLTextAreaElement>('og-headline').value = spec.headline;
      el<HTMLInputElement>('og-subtext').value = spec.subtext;
      el<HTMLInputElement>('og-brand').value = spec.brand;
      render();
    },
    'Click again to replace',
    () => el<HTMLTextAreaElement>('og-headline').value.trim() !== '' || el<HTMLInputElement>('og-subtext').value.trim() !== ''
  );

  render();
}
