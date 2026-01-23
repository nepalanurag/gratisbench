// Pure logo-maker logic shared by the browser tool and the Node verification script.
// No DOM access here. The icon set is hand-drawn 24x24 stroke paths (round
// caps, no fill) in the same visual language as the site icons. Layout math
// and SVG string building are pure so the Node script can verify them.

export const LOGO_SCHEMA_VERSION = 1;
export const LOGO_STORAGE_KEY = 'freekit.logo-maker.v1';

export interface LogoIcon {
  id: string;
  name: string;
  /** Inner SVG path/shape markup for a 24x24 viewBox, stroke-based. */
  paths: string;
}

export const LOGO_ICONS: LogoIcon[] = [
  { id: 'star', name: 'Star', paths: '<path d="M12 3.2l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3.1 1.1-6.5L2.6 10l6.5-.9z"/>' },
  { id: 'bolt', name: 'Bolt', paths: '<path d="M13 2.5L5 13.5h5.5L10 21.5l8-11h-5.5z"/>' },
  { id: 'leaf', name: 'Leaf', paths: '<path d="M5 19.5C5 10 11.5 4.5 20.5 4.5c0 9-5.5 15-15.5 15z"/><path d="M5 19.5C8 14.5 12 10.5 16.5 8"/>' },
  { id: 'mountain', name: 'Mountain', paths: '<path d="M3 19.5l5.5-9.5 3.2 5.2 2.3-3.2 7 7.5z"/>' },
  { id: 'wave', name: 'Wave', paths: '<path d="M2 9c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2"/><path d="M2 15c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2"/>' },
  { id: 'sun', name: 'Sun', paths: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19"/>' },
  { id: 'moon', name: 'Moon', paths: '<path d="M20.2 14.2A8.8 8.8 0 0 1 9.8 3.8a8.8 8.8 0 1 0 10.4 10.4z"/>' },
  { id: 'heart', name: 'Heart', paths: '<path d="M12 20.5C7 16.5 3.5 13.2 3.5 9.6c0-2.4 1.9-4.3 4.3-4.3 1.6 0 3.1.9 4.2 2.2 1.1-1.3 2.6-2.2 4.2-2.2 2.4 0 4.3 1.9 4.3 4.3 0 3.6-3.5 6.9-8.5 10.9z"/>' },
  { id: 'sparkle', name: 'Sparkle', paths: '<path d="M12 3.5c.6 4.8 2.4 6.6 7.2 7.2-4.8.6-6.6 2.4-7.2 7.2-.6-4.8-2.4-6.6-7.2-7.2 4.8-.6 6.6-2.4 7.2-7.2z"/><path d="M18.5 3v3M17 4.5h3"/>' },
  { id: 'diamond', name: 'Diamond', paths: '<path d="M12 3.5L18.5 12 12 20.5 5.5 12z"/>' },
  { id: 'hexagon', name: 'Hexagon', paths: '<path d="M12 2.8l7.8 4.5v9.4L12 21.2l-7.8-4.5V7.3z"/>' },
  { id: 'triangle', name: 'Triangle', paths: '<path d="M12 4.5L20.5 19.5h-17z"/>' },
  { id: 'globe', name: 'Globe', paths: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c-4.6 4.9-4.6 12.1 0 17"/><path d="M12 3.5c4.6 4.9 4.6 12.1 0 17"/>' },
  { id: 'drop', name: 'Drop', paths: '<path d="M12 3.5c3.4 4.1 5.8 7.4 5.8 10.7a5.8 5.8 0 0 1-11.6 0c0-3.3 2.4-6.6 5.8-10.7z"/>' },
  { id: 'compass', name: 'Compass', paths: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z"/>' },
  { id: 'cloud', name: 'Cloud', paths: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>' },
  { id: 'shield', name: 'Shield', paths: '<path d="M12 2.8l7.3 2.9v6c0 4.9-3.1 8.1-7.3 9.5-4.2-1.4-7.3-4.6-7.3-9.5v-6z"/>' },
  { id: 'flag', name: 'Flag', paths: '<path d="M6 21.5V4"/><path d="M6 4.5h10.5l-2.3 3.2 2.3 3.2H6"/>' },
];

export function logoIconById(id: string): LogoIcon {
  return LOGO_ICONS.find((i) => i.id === id) ?? LOGO_ICONS[0];
}

export function isLogoIconId(v: unknown): v is string {
  return typeof v === 'string' && LOGO_ICONS.some((i) => i.id === v);
}

export type LogoShape = 'none' | 'circle' | 'square' | 'badge';

export interface LogoShapeOption {
  id: LogoShape;
  name: string;
}

export const LOGO_SHAPES: LogoShapeOption[] = [
  { id: 'none', name: 'None' },
  { id: 'circle', name: 'Circle' },
  { id: 'square', name: 'Rounded square' },
  { id: 'badge', name: 'Badge' },
];

export function isLogoShape(v: unknown): v is LogoShape {
  return v === 'none' || v === 'circle' || v === 'square' || v === 'badge';
}

export type LogoFontId = 'serif' | 'sans' | 'mono' | 'editorial';

export interface LogoFont {
  id: LogoFontId;
  name: string;
  /** System-only font stacks: no webfonts, no licensing questions. */
  stack: string;
}

export const LOGO_FONTS: LogoFont[] = [
  { id: 'serif', name: 'Classic serif', stack: "Georgia, 'Times New Roman', Times, serif" },
  { id: 'sans', name: 'Modern sans', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'mono', name: 'Mono', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { id: 'editorial', name: 'Editorial serif', stack: "Didot, 'Bodoni MT', 'Playfair Display', Georgia, serif" },
];

export function logoFontById(id: string): LogoFont {
  return LOGO_FONTS.find((f) => f.id === id) ?? LOGO_FONTS[1];
}

export function isLogoFontId(v: unknown): v is LogoFontId {
  return v === 'serif' || v === 'sans' || v === 'mono' || v === 'editorial';
}

export interface LogoPreset {
  id: string;
  name: string;
  bg: string;
  fg: string;
  accent: string;
}

export const LOGO_PRESETS: LogoPreset[] = [
  { id: 'ink', name: 'Ink on paper', bg: '#faf6ee', fg: '#23201a', accent: '#a63d21' },
  { id: 'midnight', name: 'Midnight', bg: '#14213d', fg: '#f8f6f0', accent: '#e0a458' },
  { id: 'forest', name: 'Forest', bg: '#f4f1e8', fg: '#1e2b23', accent: '#2e7d46' },
  { id: 'ocean', name: 'Ocean', bg: '#eef4f6', fg: '#12303b', accent: '#1f7a8c' },
  { id: 'plum', name: 'Plum', bg: '#f7f0f4', fg: '#33222e', accent: '#8e3b63' },
  { id: 'charcoal', name: 'Charcoal', bg: '#26262b', fg: '#f4f4f5', accent: '#e4572e' },
  { id: 'sand', name: 'Sand', bg: '#efe6d5', fg: '#4a3f30', accent: '#b3541e' },
  { id: 'slate', name: 'Slate', bg: '#eef1f4', fg: '#2b3440', accent: '#4c6a92' },
];

export function logoPresetById(id: string): LogoPreset {
  return LOGO_PRESETS.find((p) => p.id === id) ?? LOGO_PRESETS[0];
}

export function isLogoPresetId(v: unknown): v is string {
  return typeof v === 'string' && LOGO_PRESETS.some((p) => p.id === v);
}

export interface LogoSpec {
  name: string;
  tagline: string;
  iconId: string;
  shape: LogoShape;
  fontId: LogoFontId;
  presetId: string;
}

export function blankLogoSpec(): LogoSpec {
  return { name: '', tagline: '', iconId: 'star', shape: 'circle', fontId: 'sans', presetId: 'ink' };
}

export function exampleLogoSpec(): LogoSpec {
  return { name: 'Northwind', tagline: 'MOBILE STUDIO', iconId: 'mountain', shape: 'circle', fontId: 'sans', presetId: 'ink' };
}

export function sanitizeLogoSpec(raw: unknown): LogoSpec {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    name: s(o.name).slice(0, 60),
    tagline: s(o.tagline).slice(0, 80),
    iconId: isLogoIconId(o.iconId) ? (o.iconId as string) : 'star',
    shape: isLogoShape(o.shape) ? o.shape : 'circle',
    fontId: isLogoFontId(o.fontId) ? o.fontId : 'sans',
    presetId: isLogoPresetId(o.presetId) ? (o.presetId as string) : 'ink',
  };
}

export function serializeLogoSpec(spec: LogoSpec): string {
  return JSON.stringify({ version: LOGO_SCHEMA_VERSION, ...sanitizeLogoSpec(spec) });
}

export function deserializeLogoSpec(raw: string | null | undefined): LogoSpec {
  if (!raw) return blankLogoSpec();
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (!parsed || typeof parsed !== 'object' || parsed.version !== LOGO_SCHEMA_VERSION) return blankLogoSpec();
    return sanitizeLogoSpec(parsed);
  } catch {
    return blankLogoSpec();
  }
}

// ---------- layout math (600x600 viewBox) ----------

export const LOGO_VIEWBOX = 600;

export interface LogoLayout {
  /** Icon drawn in a box of this size, top-left at (iconX, iconY) in viewBox units. */
  iconBox: number;
  iconX: number;
  iconY: number;
  /** Color the icon strokes use. */
  iconColor: 'accent' | 'bg';
  nameY: number;
  taglineY: number;
  nameStartPx: number;
  taglineStartPx: number;
}

/** Where each shape puts the icon, name, and tagline. */
export function logoLayout(shape: LogoShape): LogoLayout {
  switch (shape) {
    case 'circle':
      return { iconBox: 150, iconX: 225, iconY: 160, iconColor: 'bg', nameY: 478, taglineY: 528, nameStartPx: 76, taglineStartPx: 32 };
    case 'square':
      return { iconBox: 150, iconX: 225, iconY: 160, iconColor: 'bg', nameY: 478, taglineY: 528, nameStartPx: 76, taglineStartPx: 32 };
    case 'badge':
      return { iconBox: 140, iconX: 230, iconY: 185, iconColor: 'bg', nameY: 492, taglineY: 540, nameStartPx: 72, taglineStartPx: 30 };
    case 'none':
    default:
      return { iconBox: 170, iconX: 215, iconY: 105, iconColor: 'accent', nameY: 420, taglineY: 472, nameStartPx: 76, taglineStartPx: 32 };
  }
}

/**
 * Shrink a font size until the text (estimated at factor * px per character)
 * fits maxWidth. Returns the largest size that fits, never below minPx.
 */
export function fitFontSize(text: string, maxWidth: number, startPx: number, minPx = 14, factor = 0.58): number {
  let px = startPx;
  while (px > minPx && text.length * px * factor > maxWidth) px -= 2;
  return px;
}

/** Badge (shield) background path in 600-space. */
export function badgePath(): string {
  return 'M300 80 L455 135 V290 C455 410 385 480 300 515 C215 480 145 410 145 290 V135 Z';
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Build the standalone logo SVG (600x600). Pure string building; the page
 * supplies nothing. All user text is escaped.
 */
export function logoSvg(spec: LogoSpec): string {
  const s = sanitizeLogoSpec(spec);
  const preset = logoPresetById(s.presetId);
  const font = logoFontById(s.fontId);
  const icon = logoIconById(s.iconId);
  const layout = logoLayout(s.shape);

  let shapeSvg = '';
  if (s.shape === 'circle') {
    shapeSvg = `<circle cx="300" cy="235" r="140" fill="${preset.accent}"/>`;
  } else if (s.shape === 'square') {
    shapeSvg = `<rect x="160" y="95" width="280" height="280" rx="60" fill="${preset.accent}"/>`;
  } else if (s.shape === 'badge') {
    shapeSvg = `<path d="${badgePath()}" fill="${preset.accent}"/>`;
  }

  const scale = layout.iconBox / 24;
  const iconColor = layout.iconColor === 'bg' ? preset.bg : preset.accent;
  const iconSvg =
    `<g transform="translate(${layout.iconX} ${layout.iconY}) scale(${scale})" fill="none" stroke="${iconColor}" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon.paths}</g>`;

  const name = s.name.trim() || 'Your Name';
  const namePx = fitFontSize(name, 480, layout.nameStartPx);
  const nameSvg =
    `<text x="300" y="${layout.nameY}" text-anchor="middle" font-family="${font.stack}" ` +
    `font-size="${namePx}" font-weight="700" fill="${preset.fg}">${esc(name)}</text>`;

  const tagline = s.tagline.trim();
  let taglineSvg = '';
  if (tagline) {
    const tagPx = fitFontSize(tagline, 440, layout.taglineStartPx);
    taglineSvg =
      `<text x="300" y="${layout.taglineY}" text-anchor="middle" font-family="${font.stack}" ` +
      `font-size="${tagPx}" letter-spacing="2" opacity="0.72" fill="${preset.fg}">${esc(tagline)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="Logo preview">` +
    `<rect width="600" height="600" fill="${preset.bg}"/>` +
    shapeSvg + iconSvg + nameSvg + taglineSvg +
    `</svg>`
  );
}

// ---------- export math ----------

export const LOGO_PNG_SIZES = [512, 1024] as const;

/** PNG export is always square; the SVG scales cleanly to any size. */
export function logoPngSize(px: number): { width: number; height: number } {
  if (px !== 512 && px !== 1024) throw new Error(`Unsupported export size: ${px}`);
  return { width: px, height: px };
}

/** "northwind-logo.svg" style file names from the business name. */
export function logoFileName(name: string, ext: 'svg' | 'png'): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'logo'}-logo.${ext}`;
}
