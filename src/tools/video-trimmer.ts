// Video trimmer: DOM glue. The user picks the part to keep on a visual
// timeline (or in the two text boxes); the tool trims with ffmpeg.wasm,
// which is lazy-loaded after the user picks a file.
import { formatTime, parseTimeInput, validateTrimRange, withExtension } from '../lib/media-core.ts';
import { loadFFmpeg, fetchFileBytes, ffmpegErrorMessage } from './ffmpeg-loader.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  mobileFileSizeGuard,
} from './common.ts';

export function initVideoTrimmer(): void {
  let file: File | null = null;
  let duration = 0;
  let timelineReady = false;
  let filmstripRun = 0;
  const status = el('engine-status');

  /**
   * Forgiving time parser. Takes whatever the shared parser understands
   * ("90", "1:30", "1:30.5") plus plain suffix forms ("90s", "1m", "1m30s",
   * "1h2m3s"). Throws a plain message for anything else.
   */
  function parseTimeLoose(input: string): number {
    try {
      return parseTimeInput(input);
    } catch {
      const raw = input.trim().toLowerCase().replace(/\s+/g, '');
      const m = raw.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/);
      if (m && (m[1] !== undefined || m[2] !== undefined || m[3] !== undefined)) {
        return (
          (m[1] ? parseFloat(m[1]) * 3600 : 0) +
          (m[2] ? parseFloat(m[2]) * 60 : 0) +
          (m[3] ? parseFloat(m[3]) : 0)
        );
      }
      throw new Error(`Could not understand "${input}".`);
    }
  }

  function readRange(): { start: number; end: number } {
    const s = parseTimeLoose(el<HTMLInputElement>('start-input').value);
    const e = parseTimeLoose(el<HTMLInputElement>('end-input').value);
    return validateTrimRange(s, e, duration);
  }

  function refreshHint(): void {
    try {
      const { start, end } = readRange();
      el('range-hint').textContent =
        `Keeping ${formatTime(start)} to ${formatTime(end)} (${formatTime(end - start)} long).`;
      el('error-box').hidden = true;
    } catch {
      el('range-hint').textContent = '';
    }
  }
  el('start-input').addEventListener('input', () => { refreshHint(); syncTimeline(); });
  el('end-input').addEventListener('input', () => { refreshHint(); syncTimeline(); });

  /** Timeline scrubber: visual start/end selection synced with text inputs. */
  function syncTimeline(): void {
    if (duration <= 0) return;
    try {
      const { start, end } = readRange();
      const pct = (t: number) => `${(t / duration) * 100}%`;
      const range = el('timeline-range');
      range.style.left = pct(start);
      range.style.width = `calc(${pct(end)} - ${pct(start)})`;
      el('timeline-start').style.left = pct(start);
      el('timeline-end').style.left = pct(end);
    } catch {
      /* invalid range — leave timeline as-is */
    }
  }

  /**
   * Draw a strip of thumbnails across the timeline by seeking a scratch
   * video element. Fire-and-forget: if anything fails the styled track
   * underneath still looks fine.
   */
  async function buildFilmstrip(srcUrl: string, run: number): Promise<void> {
    const canvas = el<HTMLCanvasElement>('filmstrip');
    const timeline = el('timeline');
    const thumbs = 14;
    const w = Math.max(320, timeline.clientWidth || 640);
    const h = 54;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#16130f';
    ctx.fillRect(0, 0, w, h);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = srcUrl;
    try {
      await new Promise<void>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('thumb load timeout')), 15000);
        v.onloadedmetadata = () => { clearTimeout(to); resolve(); };
        v.onerror = () => { clearTimeout(to); reject(new Error('thumb load failed')); };
      });
    } catch {
      return;
    }
    const tw = w / thumbs;
    for (let i = 0; i < thumbs; i++) {
      if (run !== filmstripRun) return; // a newer file took over
      const t = duration * (i + 0.5) / thumbs;
      try {
        await new Promise<void>((resolve, reject) => {
          const to = setTimeout(() => reject(new Error('seek timeout')), 4000);
          v.onseeked = () => { clearTimeout(to); resolve(); };
          v.onerror = () => { clearTimeout(to); reject(new Error('seek failed')); };
          v.currentTime = Math.min(Math.max(t, 0), Math.max(0, duration - 0.05));
        });
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        if (vw > 0 && vh > 0) {
          const scale = Math.max(tw / vw, h / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          ctx.drawImage(v, i * tw + (tw - dw) / 2, (h - dh) / 2, dw, dh);
        }
      } catch {
        /* leave that cell dark */
      }
    }
    v.removeAttribute('src');
    v.load();
  }

  function initTimeline(): void {
    if (timelineReady) return;
    timelineReady = true;
    const timeline = el('timeline');
    const preview = el<HTMLVideoElement>('preview');
    let dragging: 'start' | 'end' | 'scrub' | null = null;

    const timeFromEvent = (e: PointerEvent): number => {
      const rect = timeline.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      return (x / rect.width) * duration;
    };

    const setFromTimeline = (t: number, which: 'start' | 'end') => {
      try {
        const { start, end } = readRange();
        let ns = start;
        let ne = end;
        if (which === 'start') ns = Math.min(t, ne - 0.1);
        else ne = Math.max(t, ns + 0.1);
        el<HTMLInputElement>('start-input').value = formatTime(ns);
        el<HTMLInputElement>('end-input').value = formatTime(ne);
        refreshHint();
        syncTimeline();
        preview.currentTime = which === 'start' ? ns : ne;
      } catch {
        /* ignore */
      }
    };

    timeline.addEventListener('pointerdown', (e) => {
      const t = timeFromEvent(e);
      const rect = timeline.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let startX = -Infinity;
      let endX = Infinity;
      try {
        const { start, end } = readRange();
        startX = (start / duration) * rect.width;
        endX = (end / duration) * rect.width;
      } catch {
        /* invalid range — treat the whole track as scrubbable */
      }
      // Generous grab zone so handles are easy to catch on touch.
      const grab = 20;
      if (Math.abs(x - startX) <= grab) dragging = 'start';
      else if (Math.abs(x - endX) <= grab) dragging = 'end';
      else dragging = 'scrub';
      timeline.setPointerCapture(e.pointerId);
      if (dragging === 'scrub') {
        preview.currentTime = t;
      } else {
        setFromTimeline(t, dragging);
      }
    });
    timeline.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const t = timeFromEvent(e);
      if (dragging === 'scrub') {
        preview.currentTime = t;
      } else {
        setFromTimeline(t, dragging);
      }
    });
    const stop = () => { dragging = null; };
    timeline.addEventListener('pointerup', stop);
    timeline.addEventListener('pointercancel', stop);

    // Playhead follows the preview video
    preview.addEventListener('timeupdate', () => {
      const playhead = el('timeline-playhead');
      if (duration > 0) {
        playhead.hidden = false;
        playhead.style.left = `${(preview.currentTime / duration) * 100}%`;
      }
    });

    syncTimeline();
  }

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    const f = files[0];
    if (!f) return;
    // Mobile file-size guard: a tab crash is worse than a clear message.
    const sizeNote = el('size-note');
    sizeNote.hidden = true;
    const guard = mobileFileSizeGuard(f);
    if (guard?.block) {
      showError('error-box', guard.message);
      return;
    }
    if (guard) {
      sizeNote.textContent = guard.message;
      sizeNote.hidden = false;
    }
    file = f;
    const url = URL.createObjectURL(f);
    try {
      duration = await probeDuration(url);
    } catch {
      duration = 0;
    } finally {
      URL.revokeObjectURL(url);
    }
    const preview = el<HTMLVideoElement>('preview');
    preview.src = URL.createObjectURL(f);
    el('preview-wrap').hidden = false;
    el('file-info').textContent =
      `${f.name} · ${formatBytes(f.size)}` + (duration > 0 ? ` · ${formatTime(duration)}` : '');
    if (duration <= 0) {
      showError('error-box', 'Could not read that video. Try a different file.');
      el<HTMLButtonElement>('trim-btn').disabled = true;
      return;
    }
    el<HTMLInputElement>('start-input').value = '0:00.0';
    el<HTMLInputElement>('end-input').value = formatTime(duration);
    el<HTMLButtonElement>('trim-btn').disabled = false;
    el('timeline-wrap').hidden = false;
    el('timeline-caption').textContent =
      `Full video: ${formatTime(duration)}. Drag a handle to set a cut point. Click anywhere else to preview that spot.`;
    initTimeline();
    filmstripRun += 1;
    void buildFilmstrip(preview.src, filmstripRun);
    refreshHint();
    syncTimeline();
    status.hidden = false;
    status.textContent = 'Loading the video engine (about 30MB, first use only)…';
    try {
      await loadFFmpeg();
      status.textContent = 'Video engine ready. Your file stays on this device.';
    } catch (err) {
      status.textContent = '';
      showError('error-box', ffmpegErrorMessage(err));
    }
  });

  el('trim-btn').addEventListener('click', async () => {
    if (!file) return;
    hideError('error-box');
    el('result').hidden = true;
    let range: { start: number; end: number };
    try {
      range = readRange();
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Could not read the trim range.');
      return;
    }
    setBusy('trim-btn', true, 'Trimming…');
    setProgress(0, 'Starting…');
    // Hoisted so finally can clean up MEMFS even on failure. Without it,
    // a leftover output file makes the next run hit ffmpeg's overwrite
    // prompt — and with no stdin in wasm, exec() hangs forever silently.
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const inName = 'input' + extOf(file.name);
    const outName = 'output.mp4';
    // Phase label shared with the progress listener below.
    let phase = 'Trimming';
    try {
      ffmpeg = await loadFFmpeg();
      await ffmpeg.writeFile(inName, await fetchFileBytes(file));
      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.round(progress * 100);
        setProgress(pct, `${phase}… ${pct}%`);
      });
      const keep = range.end - range.start;
      const startArg = String(range.start);
      const keepArg = String(keep);
      // Pass 1: copy the video data as-is. Instant and lossless, and exact
      // whenever the cut lands on a clean cut point. When it does not, the
      // output comes out longer than asked for — detected below, fixed by
      // pass 2.
      await ffmpeg.exec(['-y', '-ss', startArg, '-i', inName, '-t', keepArg,
        '-c', 'copy', '-movflags', '+faststart', outName]);
      let data = (await ffmpeg.readFile(outName)) as Uint8Array;
      // A cut at the very start always lands cleanly, so skip the check.
      let exact = range.start < 0.05;
      if (!exact) {
        const actual = await probeBytesDuration(data);
        exact = Math.abs(actual - keep) <= 0.5;
      }
      if (!exact) {
        // The cut did not land cleanly, so rebuild the kept section instead.
        // Slower, but the cut lands exactly where it was set.
        phase = 'Getting the cut exact';
        setProgress(0, `${phase}…`);
        await ffmpeg.deleteFile(outName).catch(() => {});
        await ffmpeg.exec(['-y', '-ss', startArg, '-i', inName, '-t', keepArg,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outName]);
        data = (await ffmpeg.readFile(outName)) as Uint8Array;
      }
      const out = new Uint8Array(data.buffer, data.byteOffset, data.length);
      const name = withExtension(file.name.replace(/(\.\w+)?$/, '-trimmed$1'), 'mp4');
      downloadBytes(name, out, 'video/mp4');
      setProgress(100, 'Done.');
      el('result').hidden = false;
      el('result-info').textContent = `${name} · ${formatTime(keep)} · ${formatBytes(out.length)}`;
    } catch (err) {
      showError('error-box', ffmpegErrorMessage(err));
    } finally {
      if (ffmpeg) {
        await ffmpeg.deleteFile(inName).catch(() => {});
        await ffmpeg.deleteFile(outName).catch(() => {});
      }
      setBusy('trim-btn', false);
    }
  });

  function setProgress(pct: number, label: string): void {
    el('progress-bar').style.width = `${pct}%`;
    el('progress-label').textContent = label;
  }

  function probeDuration(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(v.duration || 0);
      v.onerror = () => reject(new Error('unreadable'));
      v.src = url;
    });
  }

  /** Read the duration of encoded video bytes. Resolves NaN on failure. */
  function probeBytesDuration(bytes: Uint8Array): Promise<number> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'video/mp4' }));
      const v = document.createElement('video');
      v.preload = 'metadata';
      const done = (d: number) => {
        URL.revokeObjectURL(url);
        resolve(d);
      };
      const timer = setTimeout(() => done(NaN), 10000);
      v.onloadedmetadata = () => { clearTimeout(timer); done(v.duration || NaN); };
      v.onerror = () => { clearTimeout(timer); done(NaN); };
      v.src = url;
    });
  }

  function extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  }
}
