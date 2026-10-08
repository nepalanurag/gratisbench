// Subtitle editor: DOM glue. The user types captions, times them against a
// local video preview, and downloads an SRT file. No ffmpeg needed — the
// video element is only a timing reference, and SRT is plain text.
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

export function initSubtitleEditor(): void {
  let fileName = '';
  let duration = 0;
  let cues: Cue[] = [];
  let idSeq = 0;
  const video = el<HTMLVideoElement>('preview');
  const overlay = el('subtitle-overlay');
  const track = el('cue-track');
  const playhead = el('cue-playhead');
  const cueList = el('cue-list');

  function sortedCues(): Cue[] {
    return [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function activeCue(t: number): Cue | null {
    for (const c of cues) {
      if (t >= c.start && t < c.end) return c;
    }
    return null;
  }

  function renderOverlay(): void {
    const c = activeCue(video.currentTime);
    overlay.textContent = c ? c.text : '';
    overlay.style.display = c ? 'block' : 'none';
    const pct = duration > 0 ? (video.currentTime / duration) * 100 : 0;
    playhead.style.left = `${pct}%`;
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

  function renderTimeline(): void {
    track.innerHTML = '';
    const list = sortedCues();
    list.forEach((c, i) => {
      const block = document.createElement('div');
      block.className = 'cue-block';
      block.style.left = `${(c.start / duration) * 100}%`;
      block.style.width = `${Math.max(1, ((c.end - c.start) / duration) * 100)}%`;
      block.style.background = cueColor(i);
      block.title = `${formatClock(c.start)} – ${formatClock(c.end)}: ${c.text.slice(0, 60)}`;
      block.dataset.id = c.id;

      const left = document.createElement('div');
      left.className = 'cue-resize cue-resize-left';
      const right = document.createElement('div');
      right.className = 'cue-resize cue-resize-right';
      block.append(left, right);
      track.appendChild(block);

      let mode: 'left' | 'right' | null = null;
      const toTime = (clientX: number): number => {
        const r = track.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        return Math.round(frac * duration * 10) / 10;
      };
      const onMove = (e: PointerEvent) => {
        if (!mode) return;
        const t = toTime(e.clientX);
        if (mode === 'left') c.start = Math.min(t, c.end - 0.5);
        else c.end = Math.max(t, c.start + 0.5);
        c.start = Math.max(0, c.start);
        c.end = Math.min(duration, c.end);
        renderTimeline();
        renderList();
        renderOverlay();
      };
      const onUp = () => {
        mode = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      left.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        mode = 'left';
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      right.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        mode = 'right';
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        video.currentTime = c.start;
      });
    });
    updateOverlapNote();
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
      row.innerHTML = `
        <span class="cue-num">${i + 1}</span>
        <span class="cue-time">${formatClock(c.start)} → ${formatClock(c.end)}</span>
        <textarea rows="2" aria-label="Subtitle ${i + 1} text">${c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>
        <button type="button" class="icon-btn" data-act="jump" aria-label="Jump to subtitle ${i + 1}">▶</button>
        <button type="button" class="icon-btn" data-act="del" aria-label="Delete subtitle ${i + 1}">✕</button>
      `;
      const ta = row.querySelector('textarea')!;
      ta.addEventListener('input', () => {
        c.text = ta.value;
        renderOverlay();
      });
      row.querySelector('[data-act="jump"]')!.addEventListener('click', () => {
        video.currentTime = c.start;
        video.play().catch(() => {});
      });
      row.querySelector('[data-act="del"]')!.addEventListener('click', () => {
        cues = cues.filter((x) => x.id !== c.id);
        renderTimeline();
        renderList();
        renderOverlay();
      });
      cueList.appendChild(row);
    });
    updateOverlapNote();
  }

  function addCue(): void {
    if (duration <= 0) return;
    const t = Math.round(video.currentTime * 10) / 10;
    const start = Math.min(t, Math.max(0, duration - 2));
    cues.push({
      id: `cue-${++idSeq}`,
      start,
      end: Math.min(duration, start + 2),
      text: '',
    });
    renderTimeline();
    renderList();
    // Focus the new cue's textarea.
    const rows = cueList.querySelectorAll('.cue-row');
    const last = rows[rows.length - 1];
    last?.querySelector('textarea')?.focus();
  }

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

  el('cue-timeline').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.cue-block')) return;
    const r = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    video.currentTime = frac * duration;
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
    el('editor').hidden = false;
    el('file-info').textContent = f.name;
    video.src = URL.createObjectURL(f);
    video.onloadedmetadata = () => {
      duration = video.duration || 0;
      el('file-info').textContent = `${f.name} · ${formatClock(duration)}`;
      renderTimeline();
      renderList();
      renderOverlay();
    };
  });
}
