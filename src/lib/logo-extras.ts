// Extra logo icons, color palettes, and fonts. The core sanitizer resets
// unknown ids, so extras are rendered through a wrapper: the core draws the
// logo with a stand-in icon/palette/font, then the exact stand-in strings are
// swapped for the extra ones. Stand-ins are unique literal strings (SVG path
// data, hex colors, font stacks), so the swap is safe.

import {
  logoSvg,
  logoIconById,
  logoPresetById,
  logoFontById,
  type LogoSpec,
} from './logo-core.ts';

export const LOGO_EXTRAS_KEY = 'truepdf.logo-maker.extras.v1';

export interface ExtraIconDef {
  id: string;
  name: string;
  /** Inner SVG for a 24x24 stroke icon (fill none, round caps). */
  paths: string;
}

export const EXTRA_LOGO_ICONS: ExtraIconDef[] = [
  { id: 'coffee', name: 'Coffee cup', paths: '<path d="M4 10h12v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 7c0-1.2 1-1.4 1-2.6M12 7c0-1.2 1-1.4 1-2.6"/>' },
  { id: 'camera', name: 'Camera', paths: '<path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.2"/>' },
  { id: 'music', name: 'Music note', paths: '<path d="M9 18V6l10-2.5V15"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/>' },
  { id: 'code', name: 'Code', paths: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>' },
  { id: 'cart', name: 'Cart', paths: '<path d="M3 4h2l2.4 11h9.8l2.3-7H7"/><circle cx="9.5" cy="19" r="1.6"/><circle cx="16.5" cy="19" r="1.6"/>' },
  { id: 'book', name: 'Book', paths: '<path d="M6 3.5h11A1.5 1.5 0 0 1 18.5 5v15H7.5A1.5 1.5 0 0 1 6 18.5v-15z"/><path d="M6 3.5A1.5 1.5 0 0 1 7.5 2H17v17.5"/><path d="M10 8.5h5"/>' },
  { id: 'rocket', name: 'Rocket', paths: '<path d="M12 3c2.8 2 4.5 5.6 4.5 9.5L13 16h-2l-3.5-3.5C7.5 8.6 9.2 5 12 3z"/><circle cx="12" cy="9" r="1.6"/><path d="M7.5 12.5L4 18l4.5-1M16.5 12.5L20 18l-4.5-1"/>' },
  { id: 'crown', name: 'Crown', paths: '<path d="M4 18h16"/><path d="M4 18l-1.2-9.5L7.5 11l4.5-6.5L16.5 11l4.7-2.5L20 18z"/>' },
  { id: 'bulb', name: 'Light bulb', paths: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.8.7 1.1 1.4 1.1 2.2h5c0-.8.3-1.5 1.1-2.2A6 6 0 0 0 12 3z"/>' },
  { id: 'chat', name: 'Chat', paths: '<path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9.5L4 20v-13.5a1 1 0 0 1 0-1z"/><path d="M8 10.5h8M8 13.5h5"/>' },
  { id: 'gift', name: 'Gift', paths: '<path d="M4 9.5h16V13H4zM5.5 13v7.5h13V13M12 9.5V20.5"/><path d="M12 9.5S8.5 9.5 7 8 8 5 10 6.5 12 9.5 12 9.5zm0 0s3.5 0 5-1.5-1-3-3-1.5L12 9.5z"/>' },
  { id: 'palette', name: 'Palette', paths: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 1.5-2-.5-1.2.2-2.4 1.5-2.4h1.8a3.7 3.7 0 0 0 3.7-3.7c0-4.9-3.8-8.9-8.5-8.9z"/><circle cx="8" cy="10" r="1.1"/><circle cx="12" cy="7.8" r="1.1"/><circle cx="16" cy="10" r="1.1"/>' },
];

export interface ExtraPresetDef {
  id: string;
  name: string;
  bg: string;
  fg: string;
  accent: string;
}

export const EXTRA_LOGO_PRESETS: ExtraPresetDef[] = [
  { id: 'berry', name: 'Berry', bg: '#fff6f4', fg: '#43211f', accent: '#c2453e' },
  { id: 'pine', name: 'Pine', bg: '#f2f7f2', fg: '#1d2b22', accent: '#2e7d46' },
  { id: 'dusk', name: 'Dusk', bg: '#f4f2fa', fg: '#2a2340', accent: '#6b4fa8' },
  { id: 'honey', name: 'Honey', bg: '#fbf7ec', fg: '#4a3f30', accent: '#b3541e' },
  { id: 'harbor', name: 'Harbor', bg: '#f2f5f9', fg: '#22303f', accent: '#3f6fa8' },
  { id: 'copper', name: 'Copper', bg: '#fdf6ec', fg: '#3d2c1c', accent: '#b0703a' },
  { id: 'moss', name: 'Moss', bg: '#f4f6ee', fg: '#2c3320', accent: '#6b7f3a' },
  { id: 'mono', name: 'Mono', bg: '#ffffff', fg: '#1a1a1a', accent: '#1a1a1a' },
];

export interface ExtraFontDef {
  id: string;
  name: string;
  stack: string;
}

export const EXTRA_LOGO_FONTS: ExtraFontDef[] = [
  { id: 'rounded', name: 'Rounded', stack: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" },
  { id: 'trebuchet', name: 'Trebuchet', stack: "'Trebuchet MS', Verdana, sans-serif" },
  { id: 'palatino', name: 'Palatino', stack: "Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif" },
  { id: 'poster', name: 'Poster', stack: "Impact, 'Arial Narrow Bold', 'Franklin Gothic Medium', sans-serif" },
];

export function isExtraLogoIconId(v: unknown): v is string {
  return typeof v === 'string' && EXTRA_LOGO_ICONS.some((i) => i.id === v);
}
export function isExtraLogoPresetId(v: unknown): v is string {
  return typeof v === 'string' && EXTRA_LOGO_PRESETS.some((p) => p.id === v);
}
export function isExtraLogoFontId(v: unknown): v is string {
  return typeof v === 'string' && EXTRA_LOGO_FONTS.some((f) => f.id === v);
}

/**
 * Render the logo, swapping in extra icons/palettes/fonts after the core
 * draws with stand-ins. Output is identical to logoSvg() for core-only specs.
 */
export function logoSvgExtended(spec: LogoSpec): string {
  const extraIcon = EXTRA_LOGO_ICONS.find((i) => i.id === spec.iconId);
  const extraPreset = EXTRA_LOGO_PRESETS.find((p) => p.id === spec.presetId);
  const extraFont = EXTRA_LOGO_FONTS.find((f) => f.id === spec.fontId);
  const baseIcon = logoIconById('star');
  const basePreset = logoPresetById('ink');
  const baseFont = logoFontById('sans');

  let svg = logoSvg({
    ...spec,
    iconId: extraIcon ? baseIcon.id : spec.iconId,
    presetId: extraPreset ? basePreset.id : spec.presetId,
    fontId: extraFont ? baseFont.id : spec.fontId,
  });

  if (extraIcon) {
    svg = svg.split(`>${baseIcon.paths}</g>`).join(`>${extraIcon.paths}</g>`);
  }
  if (extraPreset) {
    svg = svg.split(basePreset.bg).join(extraPreset.bg);
    svg = svg.split(basePreset.fg).join(extraPreset.fg);
    svg = svg.split(basePreset.accent).join(extraPreset.accent);
  }
  if (extraFont) {
    const from = baseFont.stack.replace(/"/g, "'");
    const to = extraFont.stack.replace(/"/g, "'");
    svg = svg.split(`font-family="${from}"`).join(`font-family="${to}"`);
  }
  return svg;
}

// ---------- persistence for the parts the core serializer drops ----------

export interface LogoExtrasPersist {
  iconId: string;
  presetId: string;
  fontId: string;
}

export function loadLogoExtras(): LogoExtrasPersist {
  const blank = { iconId: '', presetId: '', fontId: '' };
  try {
    const raw = localStorage.getItem(LOGO_EXTRAS_KEY);
    if (!raw) return blank;
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      iconId: isExtraLogoIconId(p.iconId) ? (p.iconId as string) : '',
      presetId: isExtraLogoPresetId(p.presetId) ? (p.presetId as string) : '',
      fontId: isExtraLogoFontId(p.fontId) ? (p.fontId as string) : '',
    };
  } catch {
    return blank;
  }
}

export function saveLogoExtras(iconId: string, presetId: string, fontId: string): void {
  try {
    localStorage.setItem(
      LOGO_EXTRAS_KEY,
      JSON.stringify({
        iconId: isExtraLogoIconId(iconId) ? iconId : '',
        presetId: isExtraLogoPresetId(presetId) ? presetId : '',
        fontId: isExtraLogoFontId(fontId) ? fontId : '',
      })
    );
  } catch {
    // ignore
  }
}
