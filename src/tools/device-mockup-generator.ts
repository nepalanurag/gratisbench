// Device mockup generator tool: DOM glue. Frame geometry lives in
// ../lib/mockup-core.ts; this module only draws what the geometry describes.
import {
  MOCKUP_STORAGE_KEY,
  MOCKUP_FRAMES,
  MOCKUP_BACKGROUNDS,
  blankMockupSettings,
  sanitizeMockupSettings,
  serializeMockupSettings,
  deserializeMockupSettings,
  mockupBackgroundById,
  frameGeometry,
  mockupFileName,
  type MockupSettings,
  type MockupGeometry,
} from '../lib/mockup-core.ts';
import { el, downloadDataUrl, showError, hideError, setupDropzone } from './common.ts';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function initDeviceMockupGenerator(): void {
  let settings: MockupSettings;
  try {
    settings = deserializeMockupSettings(localStorage.getItem(MOCKUP_STORAGE_KEY));
  } catch {
    settings = blankMockupSettings();
  }
  let shot: HTMLImageElement | null = null;
  let shotName = 'screenshot';

  function save(): void {
    try {
      localStorage.setItem(MOCKUP_STORAGE_KEY, serializeMockupSettings(settings));
    } catch {
      /* storage unavailable: the tool still works for the session */
    }
  }

  function draw(): void {
    const canvas = el<HTMLCanvasElement>('mockup-canvas');
    hideError('mockup-error');
    if (!shot) {
      // empty placeholder canvas
      canvas.width = 1200;
      canvas.height = 500;
      canvas.style.background = '';
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#f4efe3';
        ctx.fillRect(0, 0, 1200, 500);
        ctx.fillStyle = '#a89e8d';
        ctx.font = '400 28px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Upload a screenshot to build the mockup', 600, 260);
      }
      el<HTMLButtonElement>('mockup-download').disabled = true;
      return;
    }
    try {
      const geo: MockupGeometry = frameGeometry(settings.frame, shot.naturalWidth, shot.naturalHeight, 1600, settings.padding);
      canvas.width = geo.canvasW;
      canvas.height = geo.canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser.');

      // background
      const bg = mockupBackgroundById(settings.backgroundId);
      if (bg.color) {
        ctx.fillStyle = bg.color;
        ctx.fillRect(0, 0, geo.canvasW, geo.canvasH);
        canvas.style.background = '';
      } else {
        // Transparent background: keep the bitmap alpha untouched. The
        // checkerboard is a CSS preview hint only and never reaches the
        // exported PNG, so downloads stay truly transparent.
        canvas.style.background =
          'repeating-conic-gradient(#e4e0d5 0 25%, #ffffff 0 50%) 0 0 / 32px 32px';
      }

      // shadow
      const sh = settings.shadow / 100;
      if (sh > 0) {
        ctx.save();
        ctx.shadowColor = `rgba(20, 15, 10, ${0.35 * sh})`;
        ctx.shadowBlur = 60 * sh + 10;
        ctx.shadowOffsetY = 24 * sh;
      }

      if (settings.frame === 'browser') drawBrowser(ctx, geo, shot);
      else if (settings.frame === 'phone') drawPhone(ctx, geo, shot);
      else drawLaptop(ctx, geo, shot);

      if (sh > 0) ctx.restore();
      el<HTMLButtonElement>('mockup-download').disabled = false;
    } catch (err) {
      showError('mockup-error', err instanceof Error ? err.message : 'Could not draw the mockup.');
    }
  }

  function drawShot(ctx: CanvasRenderingContext2D, geo: MockupGeometry, img: HTMLImageElement, clipRadius: number): void {
    ctx.save();
    rr(ctx, geo.screen.x, geo.screen.y, geo.screen.w, geo.screen.h, clipRadius);
    ctx.clip();
    ctx.drawImage(img, geo.screen.x, geo.screen.y, geo.screen.w, geo.screen.h);
    ctx.restore();
  }

  function drawBrowser(ctx: CanvasRenderingContext2D, geo: MockupGeometry, img: HTMLImageElement): void {
    const f = geo.frame;
    // frame body
    ctx.fillStyle = '#ffffff';
    rr(ctx, f.x, f.y, f.w, f.h, geo.radius);
    ctx.fill();
    // chrome bar
    ctx.save();
    rr(ctx, f.x, f.y, f.w, f.h, geo.radius);
    ctx.clip();
    ctx.fillStyle = '#f1ece1';
    ctx.fillRect(f.x, f.y, f.w, geo.chromeH);
    // traffic-light dots
    const dots = ['#e0685c', '#e8b44f', '#7fc98f'];
    dots.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(f.x + 34 + i * 30, f.y + geo.chromeH / 2, 8, 0, Math.PI * 2);
      ctx.fill();
    });
    // url pill
    ctx.fillStyle = '#ffffff';
    const pillX = f.x + 120;
    const pillW = f.w - 240;
    const pillH = Math.min(30, geo.chromeH * 0.55);
    rr(ctx, pillX, f.y + (geo.chromeH - pillH) / 2, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = '#a89e8d';
    ctx.font = `${Math.round(pillH * 0.5)}px system-ui, sans-serif`;
    ctx.fillText('your-site.com', pillX + 18, f.y + geo.chromeH / 2 + pillH * 0.18);
    ctx.restore();
    // screenshot below the chrome
    drawShot(ctx, geo, img, 0);
    // frame outline
    ctx.strokeStyle = 'rgba(35,32,26,0.14)';
    ctx.lineWidth = 2;
    rr(ctx, f.x, f.y, f.w, f.h, geo.radius);
    ctx.stroke();
  }

  function drawPhone(ctx: CanvasRenderingContext2D, geo: MockupGeometry, img: HTMLImageElement): void {
    const f = geo.frame;
    ctx.fillStyle = '#1c1a17';
    rr(ctx, f.x, f.y, f.w, f.h, geo.radius);
    ctx.fill();
    // screen
    drawShot(ctx, geo, img, Math.max(4, geo.radius * 0.55));
    // notch
    const notchW = f.w * 0.42;
    const notchH = f.h * 0.028;
    ctx.fillStyle = '#1c1a17';
    rr(ctx, f.x + (f.w - notchW) / 2, f.y + f.h * 0.012, notchW, notchH, notchH / 2);
    ctx.fill();
    // side buttons
    ctx.fillStyle = '#2e2b26';
    ctx.fillRect(f.x - 3, f.y + f.h * 0.22, 3, f.h * 0.07);
    ctx.fillRect(f.x - 3, f.y + f.h * 0.32, 3, f.h * 0.11);
    ctx.fillRect(f.x + f.w, f.y + f.h * 0.28, 3, f.h * 0.09);
  }

  function drawLaptop(ctx: CanvasRenderingContext2D, geo: MockupGeometry, img: HTMLImageElement): void {
    const f = geo.frame;
    // screen bezel
    ctx.fillStyle = '#1c1a17';
    rr(ctx, f.x, f.y, f.w, f.h, geo.radius);
    ctx.fill();
    drawShot(ctx, geo, img, 2);
    // deck: a thin trapezoid below the screen
    const deckY = f.y + f.h;
    const over = f.w * 0.07;
    ctx.fillStyle = '#d8d2c4';
    ctx.beginPath();
    ctx.moveTo(f.x - over, deckY + geo.deckH);
    ctx.lineTo(f.x + over * 0.25, deckY);
    ctx.lineTo(f.x + f.w - over * 0.25, deckY);
    ctx.lineTo(f.x + f.w + over, deckY + geo.deckH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c4bcab';
    ctx.fillRect(f.x - over, deckY + geo.deckH - 3, f.w + over * 2, 3);
    // notch on the deck front edge
    ctx.fillStyle = '#b3aa97';
    const nw = f.w * 0.16;
    rr(ctx, f.x + (f.w - nw) / 2, deckY + geo.deckH - 8, nw, 8, 4);
    ctx.fill();
  }

  function renderControls(): void {
    el('mockup-frames').innerHTML = MOCKUP_FRAMES.map(
      (f) => `<button type="button" class="pill${f.id === settings.frame ? ' pill-active' : ''}" data-frame="${f.id}" aria-pressed="${f.id === settings.frame}" title="${f.hint}">${f.name}</button>`
    ).join('');
    el('mockup-bgs').innerHTML = MOCKUP_BACKGROUNDS.map((b) => {
      const active = b.id === settings.backgroundId;
      const style = b.color ? `background: ${b.color};` : 'background: repeating-conic-gradient(#e4e0d5 0 25%, #ffffff 0 50%) 0 0 / 16px 16px;';
      return `<button type="button" class="swatch" data-bg="${b.id}" aria-pressed="${active}" title="${b.name}" aria-label="Background: ${b.name}" style="${style}"></button>`;
    }).join('');
    const pad = el<HTMLInputElement>('mockup-padding');
    pad.value = String(settings.padding);
    el('mockup-padding-val').textContent = `${settings.padding}px`;
    const sh = el<HTMLInputElement>('mockup-shadow');
    sh.value = String(settings.shadow);
    el('mockup-shadow-val').textContent = `${settings.shadow}%`;
  }

  function refresh(): void {
    save();
    renderControls();
    draw();
  }

  // screenshot upload
  setupDropzone('mockup-dropzone', 'mockup-file', (files) => {
    hideError('mockup-error');
    const file = files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showError('mockup-error', `"${file.name}" is not an image. Upload a PNG, JPG, or WebP screenshot.`);
      return;
    }
    shotName = file.name.replace(/\.[a-z0-9]+$/i, '');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      shot = img;
      URL.revokeObjectURL(url);
      el('mockup-drop-hint').textContent = `${file.name} · ${img.naturalWidth} x ${img.naturalHeight}px`;
      draw();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showError('mockup-error', 'Could not read that image. Try a PNG or JPG screenshot.');
    };
    img.src = url;
  });

  el('mockup-frames').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-frame]');
    if (!btn) return;
    settings.frame = (btn.getAttribute('data-frame') || 'browser') as MockupSettings['frame'];
    refresh();
  });
  el('mockup-bgs').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-bg]');
    if (!btn) return;
    settings.backgroundId = btn.getAttribute('data-bg') || settings.backgroundId;
    refresh();
  });
  el<HTMLInputElement>('mockup-padding').addEventListener('input', (e) => {
    settings.padding = Number((e.target as HTMLInputElement).value);
    save();
    renderControls();
    draw();
  });
  el<HTMLInputElement>('mockup-shadow').addEventListener('input', (e) => {
    settings.shadow = Number((e.target as HTMLInputElement).value);
    save();
    renderControls();
    draw();
  });

  el('mockup-download').addEventListener('click', () => {
    hideError('mockup-error');
    if (!shot) return;
    try {
      const canvas = el<HTMLCanvasElement>('mockup-canvas');
      downloadDataUrl(`${shotName}-mockup-${settings.frame}.png`, canvas.toDataURL('image/png'));
    } catch {
      showError('mockup-error', 'Download failed. Try a smaller screenshot.');
    }
  });

  refresh();
}
