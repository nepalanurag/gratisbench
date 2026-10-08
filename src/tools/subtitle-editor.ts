// Subtitle editor: DOM glue. The user types captions, times them against a
// local video preview, and downloads an SRT file. No ffmpeg needed — the
// video element is only a timing reference, and SRT is plain text.
//
// The timeline shows a waveform of the video's audio (decoded in-browser with
// the Web Audio API) with cue blocks on top. Click the timeline to seek, drag
// a block to move it, drag its edges to resize, zoom with the buttons or
// Ctrl+wheel. [ and ] set the selected caption's start/end at the playhead.
import {
  el,
  downloadBytes,
  showError,
  hideError,
  setupDropzone,
  mobileFileSizeGuard,
} from './common.ts';

interface Cue {
  id: string;
  start: number;
  end: number;
  text: string;
}

function formatSrtTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(sec, 2)},${p(rem, 3)}`;
}

function formatVttTime(s: number): string {
  // WebVTT uses the same clock as SRT but with a dot before milliseconds.
  return formatSrtTime(s).replace(',', '.');
}

function formatClock(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

const PEAK_COUNT = 2000;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export function initSubtitleEditor(): void {
  let fileName = '';
  let duration = 0;
  let cues: Cue[] = [];
  let idSeq = 0;
  let selectedId: string | null = null;
  let zoom = 1;
  let peaks: number[] | null = null;

  const video = el<HTMLVideoElement>('preview');
  const overlay = el('subtitle-overlay');
  const timelineScroll = el('cue-timeline-scroll');
  const timeline = el('cue-timeline');
  const waveform = el<HTMLCanvasElement>('waveform');
  const track = el('cue-track');
  const playhead = el('cue-playhead');
  const cueList = el('cue-list');
  const zoomLabel = el('zoom-label');

  function sortedCues(): Cue[] {
    return [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function activeCue(t: number): Cue | null {
    for (const c of cues) {
      if (t >= c.start && t < c.end) return c;
    }
    return null;
  }

  /** Convert a pointer x-position on the timeline to seconds (zoom-aware). */
  function toTime(clientX: number): number {
    if (duration <= 0) return 0;
    const r = timeline.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(frac * duration * 10) / 10;
  }

  function positionPlayhead(): void {
    const pct = duration > 0 ? (video.currentTime / duration) * 100 : 0;
    playhead.style.left = `${pct}%`;
    // Keep the playhead in view while playing on a zoomed timeline.
    if (!video.paused && zoom > 1 && duration > 0) {
      const px = (video.currentTime / duration) * timeline.scrollWidth;
      const sl = timelineScroll.scrollLeft;
      const vw = timelineScroll.clientWidth;
      if (px < sl + 30 || px > sl + vw - 30) {
        timelineScroll.scrollLeft = Math.max(0, px - vw / 2);
      }
    }
  }

  function renderOverlay(): void {
    const c = activeCue(video.currentTime);
    overlay.textContent = c ? c.text : '';
    overlay.style.display = c ? 'block' : 'none';
    positionPlayhead();
  }

  function cueSize(): string {
    return document.querySelector<HTMLInputElement>('input[name="cue-size"]:checked')?.value || 'normal';
  }

  function cuePosition(): 'top' | 'bottom' {
    return document.querySelector<HTMLInputElement>('input[name="cue-pos"]:checked')?.value === 'top'
      ? 'top'
      : 'bottom';
  }

  /** Apply the appearance choices to the live preview overlay. */
  function applyAppearance(): void {
    const sizes: Record<string, string> = { normal: '1.15rem', large: '1.5rem', xlarge: '1.9rem' };
    overlay.style.fontSize = sizes[cueSize()] || sizes.normal;
    if (cuePosition() === 'top') {
      overlay.style.top = '8%';
      overlay.style.bottom = 'auto';
    } else {
      overlay.style.top = 'auto';
      overlay.style.bottom = '8%';
    }
  }
  document.querySelectorAll('input[name="cue-size"], input[name="cue-pos"]').forEach((r) => {
    r.addEventListener('change', applyAppearance);
  });

  /** Warn when two captions overlap in time: most players show only one. */
  function updateOverlapNote(): void {
    const note = el('overlap-note');
    const list = sortedCues();
    for (let i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end - 0.001) {
        note.hidden = false;
        note.textContent =
          `Two captions overlap between ${formatClock(list[i].start)} and ${formatClock(list[i - 1].end)}. ` +
          `Drag their edges on the timeline so only one shows at a time.`;
        return;
      }
    }
    note.hidden = true;
    note.textContent = '';
  }

  function cueColor(i: number): string {
    const hues = [4, 210, 150, 280, 30, 190];
    return `hsl(${hues[i % hues.length]} 70% 55%)`;
  }

  /** Highlight the selected cue in the list and on the timeline. */
  function selectCue(id: string | null): void {
    selectedId = id;
    cueList.querySelectorAll('.cue-row').forEach((r) => {
      r.classList.toggle('selected', (r as HTMLElement).dataset.id === id);
    });
    track.querySelectorAll('.cue-block').forEach((b) => {
      b.classList.toggle('selected', (b as HTMLElement).dataset.id === id);
    });
  }

  function positionBlock(block: HTMLElement, c: Cue): void {
    block.style.left = `${(c.start / duration) * 100}%`;
    block.style.width = `${Math.max(0.5, ((c.end - c.start) / duration) * 100)}%`;
  }

  function renderTimeline(): void {
    if (duration <= 0) return;
    track.innerHTML = '';
    const list = sortedCues();
    list.forEach((c, i) => {
      const block = document.createElement('div');
      block.className = 'cue-block';
      block.style.background = cueColor(i);
      block.title = `${formatClock(c.start)} – ${formatClock(c.end)}: ${c.text.slice(0, 60)}`;
      block.dataset.id = c.id;
      if (c.id === selectedId) block.classList.add('selected');
      positionBlock(block, c);

      const left = document.createElement('div');
      left.className = 'cue-resize cue-resize-left';
      const right = document.createElement('div');
      right.className = 'cue-resize cue-resize-right';
      block.append(left, right);
      track.appendChild(block);

      const commit = () => {
        renderTimeline();
        renderList();
        renderOverlay();
        selectCue(selectedId);
      };

      // Edge drag: resize start/end.
      let mode: 'left' | 'right' | null = null;
      const onResizeMove = (e: PointerEvent) => {
        if (!mode) return;
        const t = toTime(e.clientX);
        if (mode === 'left') c.start = Math.min(t, c.end - 0.5);
        else c.end = Math.max(t, c.start + 0.5);
        c.start = Math.max(0, c.start);
        c.end = Math.min(duration, c.end);
        positionBlock(block, c);
      };
      const onResizeUp = () => {
        mode = null;
        window.removeEventListener('pointermove', onResizeMove);
        window.removeEventListener('pointerup', onResizeUp);
        commit();
      };
      left.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectCue(c.id);
        mode = 'left';
        window.addEventListener('pointermove', onResizeMove);
        window.addEventListener('pointerup', onResizeUp);
      });
      right.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectCue(c.id);
        mode = 'right';
        window.addEventListener('pointermove', onResizeMove);
        window.addEventListener('pointerup', onResizeUp);
      });

      // Body drag: move the whole cue. A plain click seeks to its start.
      block.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.cue-resize')) return;
        e.preventDefault();
        selectCue(c.id);
        const cueLen = c.end - c.start;
        const startX = e.clientX;
        const startT = c.start;
        let moved = false;
        const onMove = (ev: PointerEvent) => {
          const r = timeline.getBoundingClientRect();
          const dt = ((ev.clientX - startX) / r.width) * duration;
          if (Math.abs(dt * duration) > 0.5) moved = true;
          let ns = Math.round((startT + dt) * 10) / 10;
          ns = Math.max(0, Math.min(duration - cueLen, ns));
          c.start = ns;
          c.end = Math.min(duration, ns + cueLen);
          positionBlock(block, c);
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          commit();
          if (!moved) video.currentTime = c.start;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
    updateOverlapNote();
  }

  function duplicateCue(c: Cue): void {
    const cueLen = c.end - c.start;
    let start = c.end + 0.1;
    if (start + cueLen > duration) start = Math.max(0, duration - cueLen);
    const copy: Cue = {
      id: `cue-${++idSeq}`,
      start: Math.round(start * 10) / 10,
      end: Math.round(Math.min(duration, start + cueLen) * 10) / 10,
      text: c.text,
    };
    cues.push(copy);
    renderTimeline();
    renderList();
    renderOverlay();
    selectCue(copy.id);
  }

  function renderList(): void {
    cueList.innerHTML = '';
    const list = sortedCues();
    if (list.length === 0) {
      cueList.innerHTML = '<p class="hint">No subtitles yet. Play the video and add the first one where someone starts talking.</p>';
      return;
    }
    list.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'cue-row';
      row.dataset.id = c.id;
      if (c.id === selectedId) row.classList.add('selected');
      row.innerHTML = `
        <span class="cue-num drag-handle" draggable="true" title="Drag onto another caption to swap their timings">⠿</span>
        <span class="cue-time">${formatClock(c.start)} → ${formatClock(c.end)}</span>
        <textarea rows="2" aria-label="Subtitle ${i + 1} text">${c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>
        <button type="button" class="icon-btn" data-act="jump" aria-label="Jump to subtitle ${i + 1}">▶</button>
        <button type="button" class="icon-btn" data-act="dup" aria-label="Duplicate subtitle ${i + 1}">⧉</button>
        <button type="button" class="icon-btn" data-act="del" aria-label="Delete subtitle ${i + 1}">✕</button>
      `;
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('textarea, button')) return;
        selectCue(c.id);
      });
      const ta = row.querySelector('textarea')!;
      ta.addEventListener('input', () => {
        c.text = ta.value;
        renderOverlay();
      });
      ta.addEventListener('focus', () => selectCue(c.id));
      row.querySelector('[data-act="jump"]')!.addEventListener('click', () => {
        selectCue(c.id);
        video.currentTime = c.start;
        video.play().catch(() => {});
      });
      row.querySelector('[data-act="dup"]')!.addEventListener('click', () => duplicateCue(c));
      row.querySelector('[data-act="del"]')!.addEventListener('click', () => {
        cues = cues.filter((x) => x.id !== c.id);
        if (selectedId === c.id) selectedId = null;
        renderTimeline();
        renderList();
        renderOverlay();
      });

      // Drag a row's handle onto another row to swap their time ranges.
      const handle = row.querySelector('.drag-handle')!;
      handle.addEventListener('dragstart', (e) => {
        (e as DragEvent).dataTransfer!.setData('text/plain', c.id);
        (e as DragEvent).dataTransfer!.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => {
        if (!(e as DragEvent).dataTransfer?.types.includes('text/plain')) return;
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = 'move';
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const srcId = (e as DragEvent).dataTransfer?.getData('text/plain');
        if (!srcId || srcId === c.id) return;
        const src = cues.find((x) => x.id === srcId);
        if (!src) return;
        const s = src.start;
        const en = src.end;
        src.start = c.start;
        src.end = c.end;
        c.start = s;
        c.end = en;
        renderTimeline();
        renderList();
        renderOverlay();
        selectCue(selectedId);
      });

      cueList.appendChild(row);
    });
    updateOverlapNote();
  }

  function addCue(): void {
    if (duration <= 0) return;
    const t = Math.round(video.currentTime * 10) / 10;
    const start = Math.min(t, Math.max(0, duration - 2));
    const cue: Cue = {
      id: `cue-${++idSeq}`,
      start,
      end: Math.min(duration, start + 2),
      text: '',
    };
    cues.push(cue);
    renderTimeline();
    renderList();
    renderOverlay();
    selectCue(cue.id);
    // Focus the new cue's textarea.
    const rows = cueList.querySelectorAll('.cue-row');
    const last = rows[rows.length - 1];
    last?.querySelector('textarea')?.focus();
  }

  /** [ and ] set the selected (or active) cue's start/end at the playhead. */
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('textarea, input, [contenteditable="true"]')) return;
    if (el('editor').hidden) return;
    if (e.key !== '[' && e.key !== ']') return;
    e.preventDefault();
    const cur = Math.round(video.currentTime * 10) / 10;
    let cue = cues.find((c) => c.id === selectedId) || activeCue(video.currentTime);
    if (!cue) {
      if (e.key === '[') addCue();
      return;
    }
    if (e.key === '[') {
      cue.start = Math.max(0, Math.min(cur, cue.end - 0.5));
    } else {
      cue.end = Math.min(duration, Math.max(cur, cue.start + 0.5));
    }
    renderTimeline();
    renderList();
    renderOverlay();
    selectCue(cue.id);
  });

  // ---- Waveform ----

  /** Decode the video's audio and downsample it to peaks for drawing. */
  async function computePeaks(file: File): Promise<void> {
    peaks = null;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const actx = new AC();
      const buf = await file.arrayBuffer();
      const audio = await actx.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const step = Math.max(1, Math.floor(ch.length / PEAK_COUNT));
      const out: number[] = [];
      for (let i = 0; i < ch.length; i += step) {
        let max = 0;
        const end = Math.min(ch.length, i + step);
        for (let j = i; j < end; j += 8) {
          const v = Math.abs(ch[j]);
          if (v > max) max = v;
        }
        out.push(Math.min(1, max));
      }
      peaks = out;
      await actx.close().catch(() => {});
    } catch {
      // Some containers fail to decode; the timeline still works without a waveform.
      peaks = null;
    }
    drawWaveform();
  }

  function drawWaveform(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = timeline.clientWidth;
    const h = timeline.clientHeight;
    if (w <= 0 || h <= 0) return;
    waveform.width = Math.round(w * dpr);
    waveform.height = Math.round(h * dpr);
    const ctx = waveform.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!peaks || peaks.length === 0) return;
    const mid = h / 2;
    const amp = (h / 2) * 0.9;
    ctx.fillStyle = 'rgba(125, 135, 155, 0.5)';
    for (let x = 0; x < w; x++) {
      const idx = Math.min(peaks.length - 1, Math.floor((x / w) * peaks.length));
      const ph = Math.max(1, peaks[idx] * amp);
      ctx.fillRect(x, mid - ph / 2, 1, ph);
    }
  }

  // ---- Zoom ----

  function applyZoom(): void {
    if (duration <= 0) return;
    const w = Math.max(1, Math.round(timelineScroll.clientWidth * zoom));
    timeline.style.width = `${w}px`;
    drawWaveform();
    renderTimeline();
    positionPlayhead();
  }

  function setZoom(z: number): void {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 2) / 2));
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    applyZoom();
  }

  el('zoom-in').addEventListener('click', () => setZoom(zoom + 0.5));
  el('zoom-out').addEventListener('click', () => setZoom(zoom - 0.5));
  el('zoom-reset').addEventListener('click', () => setZoom(1));
  timelineScroll.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(zoom + (e.deltaY < 0 ? 0.5 : -0.5));
    },
    { passive: false },
  );
  window.addEventListener('resize', () => {
    if (!el('editor').hidden) applyZoom();
  });

  // ---- Wiring ----

  function toSrt(): string {
    return (
      sortedCues()
        .map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text.trim() || '(empty)'}\n`)
        .join('\n')
    );
  }

  function toVtt(): string {
    const pos = cuePosition();
    const blocks = sortedCues().map((c, i) => {
      // line:0 pins the caption to the top for web players; the default
      // (no setting) sits at the bottom.
      const setting = pos === 'top' ? ' line:0' : '';
      return `${i + 1}\n${formatVttTime(c.start)} --> ${formatVttTime(c.end)}${setting}\n${c.text.trim() || '(empty)'}\n`;
    });
    return 'WEBVTT\n\n' + blocks.join('\n');
  }

  el('add-cue-btn').addEventListener('click', addCue);

  timeline.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.cue-block')) return;
    video.currentTime = toTime(e.clientX);
  });

  el('download-btn').addEventListener('click', () => {
    hideError('error-box');
    if (cues.length === 0) {
      showError('error-box', 'Add at least one subtitle first.');
      return;
    }
    const vtt = document.querySelector<HTMLInputElement>('input[name="sub-format"]:checked')?.value === 'vtt';
    const text = vtt ? toVtt() : toSrt();
    const base = fileName.replace(/\.[^.]+$/, '') || 'video';
    const bytes = new TextEncoder().encode(text);
    const ext = vtt ? 'vtt' : 'srt';
    downloadBytes(`${base}.${ext}`, bytes, vtt ? 'text/vtt' : 'text/srt');
    el('result').hidden = false;
    el('result-info').textContent = `${base}.${ext} · ${cues.length} subtitle${cues.length === 1 ? '' : 's'} · ${vtt ? 'WebVTT' : 'SRT'}`;
  });

  video.addEventListener('timeupdate', renderOverlay);
  video.addEventListener('seeked', renderOverlay);
  video.addEventListener('play', positionPlayhead);
  applyAppearance();

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    const f = files[0];
    if (!f) return;
    const guard = mobileFileSizeGuard(f);
    if (guard?.block) {
      showError('error-box', guard.message);
      return;
    }
    fileName = f.name;
    cues = [];
    idSeq = 0;
    selectedId = null;
    zoom = 1;
    peaks = null;
    zoomLabel.textContent = '100%';
    el('editor').hidden = false;
    el('file-info').textContent = f.name;
    video.src = URL.createObjectURL(f);
    video.onloadedmetadata = () => {
      duration = video.duration || 0;
      el('file-info').textContent = `${f.name} · ${formatClock(duration)}`;
      applyZoom();
      renderList();
      renderOverlay();
      void computePeaks(f);
    };
  });
}
