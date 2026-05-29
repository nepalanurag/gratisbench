// Pure device-mockup-generator logic shared by the browser tool and the Node
// verification script. No DOM, no canvas here: the core computes frame
// geometry (rectangles in canvas pixels) for each frame type; the page's glue
// code does the actual drawing.

export const MOCKUP_SCHEMA_VERSION = 1;
export const MOCKUP_STORAGE_KEY = 'freekit.device-mockup.v1';

export type MockupFrame = 'browser' | 'phone' | 'laptop';

export interface MockupFrameOption {
  id: MockupFrame;
  name: string;
  hint: string;
}

export const MOCKUP_FRAMES: MockupFrameOption[] = [
  { id: 'browser', name: 'Browser window', hint: 'Desktop screenshots and web pages' },
  { id: 'phone', name: 'Phone', hint: 'Tall mobile screenshots' },
  { id: 'laptop', name: 'Laptop', hint: 'Wide desktop screenshots' },
];

export function isMockupFrame(v: unknown): v is MockupFrame {
  return v === 'browser' || v === 'phone' || v === 'laptop';
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MockupBackground {
  id: string;
  name: string;
  /** null = transparent (checkerboard in preview, alpha in PNG). */
  color: string | null;
}

export const MOCKUP_BACKGROUNDS: MockupBackground[] = [
  { id: 'paper', name: 'Paper', color: '#faf6ee' },
  { id: 'white', name: 'White', color: '#ffffff' },
  { id: 'ink', name: 'Ink', color: '#23201a' },
  { id: 'brick', name: 'Brick', color: '#a63d21' },
  { id: 'forest', name: 'Forest', color: '#1e2b23' },
  { id: 'navy', name: 'Navy', color: '#14213d' },
  { id: 'transparent', name: 'Transparent', color: null },
];

export function mockupBackgroundById(id: string): MockupBackground {
  return MOCKUP_BACKGROUNDS.find((b) => b.id === id) ?? MOCKUP_BACKGROUNDS[0];
}

export interface MockupSettings {
  frame: MockupFrame;
  backgroundId: string;
  padding: number; // px around the frame at export scale
  shadow: number; // 0-100
}

export function blankMockupSettings(): MockupSettings {
  return { frame: 'browser', backgroundId: 'paper', padding: 90, shadow: 40 };
}

export function sanitizeMockupSettings(raw: unknown): MockupSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
    return Math.min(max, Math.max(min, n));
  };
  const bg = typeof o.backgroundId === 'string' ? o.backgroundId : 'paper';
  return {
    frame: isMockupFrame(o.frame) ? o.frame : 'browser',
    backgroundId: MOCKUP_BACKGROUNDS.some((b) => b.id === bg) ? bg : 'paper',
    padding: num(o.padding, 90, 0, 240),
    shadow: num(o.shadow, 40, 0, 100),
  };
}

export function serializeMockupSettings(s: MockupSettings): string {
  return JSON.stringify({ version: MOCKUP_SCHEMA_VERSION, ...sanitizeMockupSettings(s) });
}

export function deserializeMockupSettings(raw: string | null | undefined): MockupSettings {
  if (!raw) return blankMockupSettings();
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (!parsed || typeof parsed !== 'object' || parsed.version !== MOCKUP_SCHEMA_VERSION) return blankMockupSettings();
    return sanitizeMockupSettings(parsed);
  } catch {
    return blankMockupSettings();
  }
}

// ---------- geometry ----------

export interface MockupGeometry {
  canvasW: number;
  canvasH: number;
  /** Outer frame rectangle (the shape the shadow hugs). */
  frame: Rect;
  /** Screenshot rectangle, contain-fitted inside the screen area. */
  screen: Rect;
  /** Browser chrome bar height; 0 for phone/laptop. */
  chromeH: number;
  /** Laptop deck height below the screen; 0 otherwise. */
  deckH: number;
  /** Frame corner radius. */
  radius: number;
}

/**
 * Fit a srcW x srcH image inside dst, preserving aspect (contain).
 * Returns the centered rectangle the image occupies.
 */
export function fitContain(srcW: number, srcH: number, dst: Rect): Rect {
  if (!(srcW > 0) || !(srcH > 0)) throw new Error(`Invalid image size: ${srcW}x${srcH}`);
  if (!(dst.w > 0) || !(dst.h > 0)) throw new Error(`Invalid box: ${dst.w}x${dst.h}`);
  const s = Math.min(dst.w / srcW, dst.h / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: dst.x + (dst.w - w) / 2, y: dst.y + (dst.h - h) / 2, w, h };
}

function r(x: number, y: number, w: number, h: number): Rect {
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Compute every rectangle the glue needs to draw a framed mockup.
 * canvasW is the export width (1600); canvasH is derived from the frame.
 * The screenshot keeps its aspect ratio via contain-fit.
 */
export function frameGeometry(
  frame: MockupFrame,
  shotW: number,
  shotH: number,
  canvasW = 1600,
  padding = 90
): MockupGeometry {
  if (!isMockupFrame(frame)) throw new Error(`Unknown frame: ${frame}`);
  if (!(shotW > 0) || !(shotH > 0)) throw new Error(`Invalid screenshot size: ${shotW}x${shotH}`);
  if (!(canvasW > 0) || !(padding >= 0)) throw new Error(`Invalid canvas: ${canvasW} / ${padding}`);
  const k = canvasW / 1600; // scale factor for all chrome dimensions

  if (frame === 'browser') {
    const chromeH = 58 * k;
    const bezel = 14 * k;
    const boxW = canvasW - padding * 2;
    const screenAvail: Rect = { x: padding, y: padding + chromeH, w: boxW, h: boxW * 0.62 };
    const screen = fitContain(shotW, shotH, screenAvail);
    const fr = r(
      screen.x - bezel,
      padding,
      screen.w + bezel * 2,
      chromeH + (screen.y - (padding + chromeH)) + screen.h + bezel
    );
    return {
      canvasW,
      canvasH: Math.round(fr.y + fr.h + padding),
      frame: fr,
      screen: r(screen.x, screen.y, screen.w, screen.h),
      chromeH: Math.round(chromeH),
      deckH: 0,
      radius: Math.round(14 * k),
    };
  }

  if (frame === 'phone') {
    const phoneW = Math.min(canvasW * 0.34, 520 * k);
    const phoneH = (phoneW * 19.5) / 9;
    const phoneX = (canvasW - phoneW) / 2;
    const phoneY = padding;
    const insetX = phoneW * 0.05;
    const topInset = phoneH * 0.062;
    const botInset = phoneH * 0.045;
    const screenAvail: Rect = {
      x: phoneX + insetX,
      y: phoneY + topInset,
      w: phoneW - insetX * 2,
      h: phoneH - topInset - botInset,
    };
    const screen = fitContain(shotW, shotH, screenAvail);
    return {
      canvasW,
      canvasH: Math.round(phoneY + phoneH + padding),
      frame: r(phoneX, phoneY, phoneW, phoneH),
      screen: r(screen.x, screen.y, screen.w, screen.h),
      chromeH: 0,
      deckH: 0,
      radius: Math.round(phoneW * 0.13),
    };
  }

  // laptop
  const screenW = canvasW - padding * 2;
  const screenH = (screenW * 10) / 16;
  const bezel = 16 * k;
  const deckH = 52 * k;
  const fr = r(padding - bezel, padding, screenW + bezel * 2, screenH + bezel * 2);
  const screen = fitContain(shotW, shotH, { x: padding, y: padding + bezel, w: screenW, h: screenH });
  return {
    canvasW,
    canvasH: Math.round(fr.y + fr.h + deckH + padding),
    frame: fr,
    screen: r(screen.x, screen.y, screen.w, screen.h),
    chromeH: 0,
    deckH: Math.round(deckH),
    radius: Math.round(10 * k),
  };
}

/** "screenshot-mockup-browser.png" style download names. */
export function mockupFileName(frame: MockupFrame): string {
  return `screenshot-mockup-${frame}.png`;
}
