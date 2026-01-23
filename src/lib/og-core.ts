// Pure OG-image-generator logic shared by the browser tool and the Node
// verification script. No DOM, no canvas here: the core computes presets,
// text-fit math, word wrapping, and the full card layout as data; the page's
// glue code does the actual canvas drawing.

export const OG_SCHEMA_VERSION = 1;
export const OG_STORAGE_KEY = 'freekit.og-image-generator.v1';

export interface OgPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const OG_PRESETS: OgPreset[] = [
  { id: 'og', label: 'Open Graph (1200 x 630)', width: 1200, height: 630 },
  { id: 'square', label: 'Square (1080 x 1080)', width: 1080, height: 1080 },
  { id: 'wide', label: 'Wide (1600 x 900)', width: 1600, height: 900 },
  { id: 'x-card', label: 'X / Twitter card (1200 x 675)', width: 1200, height: 675 },
];

export function ogPresetById(id: string): OgPreset {
  return OG_PRESETS.find((p) => p.id === id) ?? OG_PRESETS[0];
}

export function isOgPresetId(v: unknown): v is string {
  return typeof v === 'string' && OG_PRESETS.some((p) => p.id === v);
}

export type OgPattern = 'none' | 'dots' | 'grid' | 'diagonal' | 'rings';

export interface OgPatternOption {
  id: OgPattern;
  name: string;
}

export const OG_PATTERNS: OgPatternOption[] = [
  { id: 'none', name: 'None' },
  { id: 'dots', name: 'Dots' },
  { id: 'grid', name: 'Grid' },
  { id: 'diagonal', name: 'Diagonal lines' },
  { id: 'rings', name: 'Rings' },
];

export function isOgPattern(v: unknown): v is OgPattern {
  return v === 'none' || v === 'dots' || v === 'grid' || v === 'diagonal' || v === 'rings';
}

export interface OgTheme {
  id: string;
  name: string;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  /** Pattern ink: accent at low alpha reads as texture, not decoration. */
  pattern: string;
}

export const OG_THEMES: OgTheme[] = [
  { id: 'paper', name: 'Paper', bg: '#faf6ee', fg: '#23201a', muted: '#6f665a', accent: '#a63d21', pattern: 'rgba(166,61,33,0.08)' },
  { id: 'ink', name: 'Ink', bg: '#23201a', fg: '#faf6ee', muted: '#b8ad9c', accent: '#e0a458', pattern: 'rgba(224,164,88,0.10)' },
  { id: 'brick', name: 'Brick', bg: '#a63d21', fg: '#fff8f0', muted: '#f3d9c8', accent: '#23201a', pattern: 'rgba(255,248,240,0.10)' },
  { id: 'forest', name: 'Forest', bg: '#1e2b23', fg: '#f4f1e8', muted: '#a9b8a6', accent: '#7fc98f', pattern: 'rgba(127,201,143,0.10)' },
  { id: 'navy', name: 'Navy', bg: '#14213d', fg: '#f8f6f0', muted: '#a9b4c7', accent: '#7fb2e5', pattern: 'rgba(127,178,229,0.10)' },
  { id: 'plum', name: 'Plum', bg: '#33222e', fg: '#f7f0f4', muted: '#c2a9b8', accent: '#e08bb4', pattern: 'rgba(224,139,180,0.10)' },
  { id: 'slate', name: 'Slate', bg: '#eef1f4', fg: '#2b3440', muted: '#6b7684', accent: '#4c6a92', pattern: 'rgba(76,106,146,0.08)' },
  { id: 'sand', name: 'Sand', bg: '#efe6d5', fg: '#4a3f30', muted: '#8a7c66', accent: '#b3541e', pattern: 'rgba(179,84,30,0.08)' },
];

export function ogThemeById(id: string): OgTheme {
  return OG_THEMES.find((t) => t.id === id) ?? OG_THEMES[0];
}

export function isOgThemeId(v: unknown): v is string {
  return typeof v === 'string' && OG_THEMES.some((t) => t.id === v);
}

export interface OgSpec {
  headline: string;
  subtext: string;
  brand: string;
  presetId: string;
  themeId: string;
  pattern: OgPattern;
}

export function blankOgSpec(): OgSpec {
  return { headline: '', subtext: '', brand: '', presetId: 'og', themeId: 'paper', pattern: 'dots' };
}

export function exampleOgSpec(): OgSpec {
  return {
    headline: 'Small tools that run in your browser',
    subtext: 'Free, no accounts, no watermarks. Your files never leave your device.',
    brand: 'FreeKit',
    presetId: 'og',
    themeId: 'paper',
    pattern: 'dots',
  };
}

export function sanitizeOgSpec(raw: unknown): OgSpec {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    headline: s(o.headline, 160),
    subtext: s(o.subtext, 220),
    brand: s(o.brand, 60),
    presetId: isOgPresetId(o.presetId) ? (o.presetId as string) : 'og',
    themeId: isOgThemeId(o.themeId) ? (o.themeId as string) : 'paper',
    pattern: isOgPattern(o.pattern) ? o.pattern : 'none',
  };
}

export function serializeOgSpec(spec: OgSpec): string {
  return JSON.stringify({ version: OG_SCHEMA_VERSION, ...sanitizeOgSpec(spec) });
}

export function deserializeOgSpec(raw: string | null | undefined): OgSpec {
  if (!raw) return blankOgSpec();
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (!parsed || typeof parsed !== 'object' || parsed.version !== OG_SCHEMA_VERSION) return blankOgSpec();
    return sanitizeOgSpec(parsed);
  } catch {
    return blankOgSpec();
  }
}

// ---------- text-fit math ----------

/**
 * Estimated rendered width of a string at px size. factor is the average
 * advance per character as a fraction of px (0.55 is a fair average for
 * mixed-case grotesque/sans at weight 700).
 */
export function estimateWidth(text: string, px: number, factor = 0.55): number {
  return text.length * px * factor;
}

/**
 * Shrink a font size until the text fits maxWidth. Never below minPx.
 * Pure and deterministic: the same inputs always give the same size.
 */
export function fitFontSize(text: string, maxWidth: number, startPx: number, minPx = 12, factor = 0.55): number {
  let px = Math.floor(startPx);
  while (px > minPx && estimateWidth(text, px, factor) > maxWidth) px -= 2;
  return px;
}

/**
 * Greedy word wrap on estimated widths. Overlong single words are hard-broken.
 * Returns at least one line (possibly empty) so callers can always draw.
 */
export function wrapLines(text: string, maxWidth: number, px: number, factor = 0.55): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  const push = (w: string) => {
    // hard-break a word that cannot fit on its own line
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

// ---------- card layout (pure geometry; glue draws it) ----------

export interface OgTextBlock {
  lines: string[];
  px: number;
  lineHeight: number;
}

export interface OgLayout {
  preset: OgPreset;
  theme: OgTheme;
  padX: number;
  padY: number;
  headline: OgTextBlock;
  /** Baseline y of the first headline line. */
  headlineTop: number;
  sub: OgTextBlock;
  subTop: number;
  brandPx: number;
  brandBaseline: number;
  accentRule: { x: number; y: number; w: number; h: number };
}

const HEADLINE_FONT = '"Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BODY_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function headlineFont(): string {
  return HEADLINE_FONT;
}

export function bodyFont(): string {
  return BODY_FONT;
}

/**
 * Compute the full card layout for a spec: wrapped + shrunk headline (max 3
 * lines), subtext (max 2 lines), brand line anchored to the bottom with an
 * accent rule above it. Everything is data; the glue draws it on canvas.
 */
export function layoutOg(spec: OgSpec): OgLayout {
  const s = sanitizeOgSpec(spec);
  const preset = ogPresetById(s.presetId);
  const theme = ogThemeById(s.themeId);
  const { width: w, height: h } = preset;

  const padX = Math.round(w * 0.08);
  const padY = Math.round(h * 0.1);
  const maxW = w - padX * 2;

  // Headline: start large, wrap, shrink until it fits in 3 lines.
  let px = Math.round(h * 0.115);
  const minPx = Math.max(26, Math.round(h * 0.055));
  let lines = wrapLines(s.headline.trim() || 'Your headline', maxW, px);
  while (lines.length > 3 && px > minPx) {
    px -= 4;
    lines = wrapLines(s.headline.trim() || 'Your headline', maxW, px);
  }
  const lineHeight = Math.round(px * 1.14);
  const blockH = lines.length * lineHeight;

  // Subtext: proportional size, max 2 lines.
  let subPx = Math.max(22, Math.round(px * 0.38));
  let subLines = wrapLines(s.subtext.trim(), maxW, subPx);
  while (subLines.length > 2 && subPx > 18) {
    subPx -= 2;
    subLines = wrapLines(s.subtext.trim(), maxW, subPx);
  }
  const subLineHeight = Math.round(subPx * 1.35);

  // Brand line pinned to the bottom with an accent rule above it.
  const brandPx = Math.max(20, Math.round(h * 0.042));
  const brandBaseline = h - padY - Math.round(brandPx * 0.4);
  const ruleY = brandBaseline - brandPx - Math.round(h * 0.035);

  // Stack: headline block slightly above center, subtext under it.
  const stackH = blockH + (s.subtext.trim() ? Math.round(h * 0.04) + subLines.length * subLineHeight : 0);
  const stackTop = Math.round(h * 0.5 - stackH / 2 - h * 0.03);

  return {
    preset,
    theme,
    padX,
    padY,
    headline: { lines, px, lineHeight },
    headlineTop: stackTop + lineHeight, // first baseline
    sub: { lines: subLines, px: subPx, lineHeight: subLineHeight },
    subTop: stackTop + blockH + Math.round(h * 0.04) + subLineHeight,
    brandPx,
    brandBaseline,
    accentRule: { x: padX, y: ruleY, w: Math.round(w * 0.055), h: Math.max(5, Math.round(h * 0.011)) },
  };
}

/** "freekit-og-1200x630.png" style download names. */
export function ogFileName(brand: string, presetId: string): string {
  const preset = ogPresetById(presetId);
  const slug = brand.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return `${slug || 'card'}-${preset.width}x${preset.height}.png`;
}
