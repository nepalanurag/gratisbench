// Extra OG/social-card sizes beyond the core presets. The core sanitizer resets
// unknown preset ids, so extended presets live here with their own layout math
// (a faithful port of the core's proportional layout) and their own storage.

import {
  ogPresetById,
  ogThemeById,
  type OgLayout,
  type OgPreset,
  type OgSpec,
} from './og-core.ts';

export const OG_EXTRA_PRESET_KEY = 'truepdf.og-image-generator.preset.v1';
export const OG_EXTRA_STYLE_KEY = 'truepdf.og-image-generator.style.v1';

export const EXTRA_OG_PRESETS: OgPreset[] = [
  { id: 'youtube', label: 'YouTube thumbnail (1280 x 720)', width: 1280, height: 720 },
  { id: 'insta-portrait', label: 'Instagram portrait (1080 x 1350)', width: 1080, height: 1350 },
  { id: 'pinterest', label: 'Pinterest pin (1000 x 1500)', width: 1000, height: 1500 },
  { id: 'banner', label: 'Wide banner (1920 x 640)', width: 1920, height: 640 },
];

export function isExtraOgPresetId(v: unknown): v is string {
  return typeof v === 'string' && EXTRA_OG_PRESETS.some((p) => p.id === v);
}

export function ogPresetByIdExtended(id: string): OgPreset {
  return EXTRA_OG_PRESETS.find((p) => p.id === id) ?? ogPresetById(id);
}

export function ogFileNameExtended(brand: string, presetId: string): string {
  const preset = ogPresetByIdExtended(presetId);
  const slug = brand.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return `${slug || 'card'}-${preset.width}x${preset.height}.png`;
}

// ---------- layout (port of the core's proportional layout) ----------

function estimateWidth(text: string, px: number, factor = 0.55): number {
  return text.length * px * factor;
}

function wrapLines(text: string, maxWidth: number, px: number, factor = 0.55): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  const push = (w: string): void => {
    while (estimateWidth(w, px, factor) > maxWidth && w.length > 1) {
      const cut = Math.max(1, Math.floor(maxWidth / (px * factor)));
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    if (line === '') {
      line = w;
    } else if (estimateWidth(line + ' ' + w, px, factor) <= maxWidth) {
      line += ' ' + w;
    } else {
      lines.push(line);
      line = w;
    }
  };
  for (const w of words) push(w);
  if (line !== '' || lines.length === 0) lines.push(line);
  return lines;
}

function sanitize(spec: OgSpec): OgSpec {
  const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
  const o = spec as unknown as Record<string, unknown>;
  return {
    headline: s(o.headline, 160),
    subtext: s(o.subtext, 220),
    brand: s(o.brand, 60),
    presetId: typeof o.presetId === 'string' ? o.presetId : 'og',
    themeId: typeof o.themeId === 'string' ? o.themeId : 'paper',
    pattern: (o.pattern as OgSpec['pattern']) ?? 'none',
  };
}

/**
 * Layout for extended presets. Same algorithm as the core layoutOg, but the
 * preset lookup understands the extra sizes. For core presets, prefer the
 * core layoutOg so rendering stays pixel-identical.
 */
export function layoutOgExtended(spec: OgSpec): OgLayout {
  const s = sanitize(spec);
  const preset = ogPresetByIdExtended(s.presetId);
  const theme = ogThemeById(s.themeId);
  const { width: w, height: h } = preset;

  const padX = Math.round(w * 0.08);
  const padY = Math.round(h * 0.1);
  const maxW = w - padX * 2;

  let px = Math.round(h * 0.115);
  const minPx = Math.max(26, Math.round(h * 0.055));
  let lines = wrapLines(s.headline.trim() || 'Your headline', maxW, px);
  while (lines.length > 3 && px > minPx) {
    px -= 4;
    lines = wrapLines(s.headline.trim() || 'Your headline', maxW, px);
  }
  const lineHeight = Math.round(px * 1.14);
  const blockH = lines.length * lineHeight;

  let subPx = Math.max(22, Math.round(px * 0.38));
  let subLines = wrapLines(s.subtext.trim(), maxW, subPx);
  while (subLines.length > 2 && subPx > 18) {
    subPx -= 2;
    subLines = wrapLines(s.subtext.trim(), maxW, subPx);
  }
  const subLineHeight = Math.round(subPx * 1.35);

  const brandPx = Math.max(20, Math.round(h * 0.042));
  const brandBaseline = h - padY - Math.round(brandPx * 0.4);
  const ruleY = brandBaseline - brandPx - Math.round(h * 0.035);

  const stackH = blockH + (s.subtext.trim() ? Math.round(h * 0.04) + subLines.length * subLineHeight : 0);
  const stackTop = Math.round(h * 0.5 - stackH / 2 - h * 0.03);

  return {
    preset,
    theme,
    padX,
    padY,
    headline: { lines, px, lineHeight },
    headlineTop: stackTop + lineHeight,
    sub: { lines: subLines, px: subPx, lineHeight: subLineHeight },
    subTop: stackTop + blockH + Math.round(h * 0.04) + subLineHeight,
    brandPx,
    brandBaseline,
    accentRule: { x: padX, y: ruleY, w: Math.round(w * 0.055), h: Math.max(5, Math.round(h * 0.011)) },
  };
}

// ---------- persisted style extras (accent override + alignment) ----------

export interface OgStyleExtras {
  /** Custom accent color (hex) overriding the theme accent. Blank = theme default. */
  accent: string;
  /** Text alignment for headline, subtext, and brand line. */
  align: 'left' | 'center';
  /** Extra pattern id (beyond the core patterns). Blank = use the spec's pattern. */
  pattern: string;
}

export function blankOgStyleExtras(): OgStyleExtras {
  return { accent: '', align: 'left', pattern: '' };
}

export function loadOgStyleExtras(): OgStyleExtras {
  try {
    const raw = localStorage.getItem(OG_EXTRA_STYLE_KEY);
    if (!raw) return blankOgStyleExtras();
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      accent: typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '',
      align: p.align === 'center' ? 'center' : 'left',
      pattern: typeof p.pattern === 'string' ? p.pattern.slice(0, 24) : '',
    };
  } catch {
    return blankOgStyleExtras();
  }
}

export function saveOgStyleExtras(e: OgStyleExtras): void {
  try {
    localStorage.setItem(OG_EXTRA_STYLE_KEY, JSON.stringify(e));
  } catch {
    // ignore
  }
}

export function loadOgExtraPreset(): string | null {
  try {
    const v = localStorage.getItem(OG_EXTRA_PRESET_KEY);
    return isExtraOgPresetId(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveOgExtraPreset(id: string): void {
  try {
    if (isExtraOgPresetId(id)) localStorage.setItem(OG_EXTRA_PRESET_KEY, id);
    else localStorage.removeItem(OG_EXTRA_PRESET_KEY);
  } catch {
    // ignore
  }
}
