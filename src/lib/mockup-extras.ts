// Extra device frames: tablet, desktop monitor, and a dark-chrome browser.
// Geometry follows the same conventions as the core frameGeometry (canvasW is
// the export width, k scales chrome with it). Core frames delegate to the core
// function; only the new frames are computed here.

import {
  frameGeometry,
  type MockupFrame,
  type MockupGeometry,
  type Rect,
} from './mockup-core.ts';

export const MOCKUP_EXTRA_FRAME_KEY = 'truepdf.device-mockup-generator.frame.v1';

export interface ExtraFrameOption {
  id: string;
  name: string;
  hint: string;
}

export const EXTRA_MOCKUP_FRAMES: ExtraFrameOption[] = [
  { id: 'tablet', name: 'Tablet', hint: 'iPad-style frame for tablet screenshots' },
  { id: 'monitor', name: 'Monitor', hint: 'Desktop display with stand' },
  { id: 'browser-dark', name: 'Browser (dark)', hint: 'Browser window with dark chrome' },
];

export function isExtraMockupFrame(v: unknown): v is string {
  return typeof v === 'string' && EXTRA_MOCKUP_FRAMES.some((f) => f.id === v);
}

function rr(x: number, y: number, w: number, h: number): Rect {
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function fitContain(srcW: number, srcH: number, dst: Rect): Rect {
  const s = Math.min(dst.w / srcW, dst.h / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return rr(dst.x + (dst.w - w) / 2, dst.y + (dst.h - h) / 2, w, h);
}

/** Geometry for the extra frames; delegates to core for the built-ins. */
export function frameGeometryExtended(
  frame: string,
  shotW: number,
  shotH: number,
  canvasW = 1600,
  padding = 90
): MockupGeometry {
  if (!isExtraMockupFrame(frame)) {
    return frameGeometry(frame as MockupFrame, shotW, shotH, canvasW, padding);
  }
  if (!(shotW > 0) || !(shotH > 0)) throw new Error(`Invalid screenshot size: ${shotW}x${shotH}`);
  if (!(canvasW > 0) || !(padding >= 0)) throw new Error(`Invalid canvas: ${canvasW} / ${padding}`);
  const k = canvasW / 1600;

  if (frame === 'tablet') {
    // 4:3-ish tablet, thin even bezels, camera dot on the top edge.
    const tabW = Math.min(canvasW * 0.44, 680 * k);
    const tabH = tabW * 1.34;
    const tabX = (canvasW - tabW) / 2;
    const tabY = padding;
    const bezel = 30 * k;
    const screenAvail: Rect = { x: tabX + bezel, y: tabY + bezel * 1.35, w: tabW - bezel * 2, h: tabH - bezel * 2.35 };
    const screen = fitContain(shotW, shotH, screenAvail);
    return {
      canvasW,
      canvasH: Math.round(tabY + tabH + padding),
      frame: rr(tabX, tabY, tabW, tabH),
      screen: rr(screen.x, screen.y, screen.w, screen.h),
      chromeH: 0,
      deckH: 0,
      radius: Math.round(34 * k),
    };
  }

  if (frame === 'monitor') {
    // 16:9 display on a stand: slim bezels, neck, and a base bar.
    const scrW = canvasW - padding * 2;
    const scrH = (scrW * 9) / 16;
    const bezel = 20 * k;
    const neckH = 90 * k;
    const baseH = 26 * k;
    const baseW = scrW * 0.34;
    const fr = rr(padding - bezel, padding, scrW + bezel * 2, scrH + bezel * 2);
    const screen = fitContain(shotW, shotH, { x: padding, y: padding + bezel, w: scrW, h: scrH });
    return {
      canvasW,
      canvasH: Math.round(fr.y + fr.h + neckH + baseH + padding),
      frame: fr,
      screen: rr(screen.x, screen.y, screen.w, screen.h),
      chromeH: 0,
      // Reuse deckH to carry the stand height so the canvas accounts for it;
      // the glue draws the stand from the frame rect.
      deckH: Math.round(neckH + baseH),
      radius: Math.round(12 * k),
    };
  }

  // browser-dark: same geometry as the browser, drawn with dark chrome.
  return frameGeometry('browser', shotW, shotH, canvasW, padding);
}

export function loadExtraMockupFrame(): string | null {
  try {
    const v = localStorage.getItem(MOCKUP_EXTRA_FRAME_KEY);
    return isExtraMockupFrame(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveExtraMockupFrame(id: string): void {
  try {
    if (isExtraMockupFrame(id)) localStorage.setItem(MOCKUP_EXTRA_FRAME_KEY, id);
    else localStorage.removeItem(MOCKUP_EXTRA_FRAME_KEY);
  } catch {
    // ignore
  }
}
