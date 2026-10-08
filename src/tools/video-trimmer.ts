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
  EtaTracker,
} from './common.ts';

export function initVideoTrimmer(): void {
  let file: File | null = null;
  let duration = 0;
  let timelineReady = false;
  let filmstripRun = 0;
  // 'keep': one continuous section (existing flow). 'cut': mark sections to
  // remove; the rest is joined back together (multi-segment trim).
  let trimMode: 'keep' | 'cut' = 'keep';
  let cuts: { start: number; end: number }[] = [];
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

  /** Validate the cut list: every cut inside [0, duration], start < end, and
   *  no two cuts overlapping. Returns the cuts sorted by start time. */
  function validateCuts(): { start: number; end: number }[] {
    if (cuts.length === 0) throw new Error('Add at least one section to cut.');
    const sorted = [...cuts].sort((a, b) => a.start - b.start);
    for (const c of sorted) {
      if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end > duration) {
        throw new Error('Every cut section must sit inside the video.');
      }
      if (c.end - c.start < 0.1) {
        throw new Error('Every cut section must be at least 0.1 seconds long.');
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end - 0.001) {
        throw new Error('Cut sections must not overlap. Remove or resize one of them.');
      }
    }
    return sorted;
  }

  /** The parts that survive the cuts: the complement of the cut ranges. */
  function keepRangesFromCuts(sorted: { start: number; end: number }[]): { start: number; end: number }[] {
    const keeps: { start: number; end: number }[] = [];
    let cur = 0;
    for (const c of sorted) {
      if (c.start > cur + 0.001) keeps.push({ start: cur, end: c.start });
      cur = c.end;
    }
    if (cur < duration - 0.001) keeps.push({ start: cur, end: duration });
    return keeps;
  }

  function updateCutHint(): void {
    const hint = el('cut-hint');
    if (duration <= 0 || trimMode !== 'cut') {
      hint.textContent = '';
      return;
    }
    try {
      const sorted = validateCuts();
      const keeps = keepRangesFromCuts(sorted);
      const kept = keeps.reduce((a, k) => a + (k.end - k.start), 0);
      const n = sorted.length;
      hint.textContent =
        keeps.length === 0
          ? 'The cuts remove the whole video — shrink or remove one of them.'
          : `Keeping ${formatTime(kept)} of ${formatTime(duration)} · ${n} section${n === 1 ? '' : 's'} cut out.`;
      el<HTMLButtonElement>('trim-btn').disabled = keeps.length === 0;
    } catch {
      hint.textContent = cuts.length === 0 ? 'Add at least one section to cut above.' : '';
      el<HTMLButtonElement>('trim-btn').disabled = true;
    }
  }

  function renderCuts(): void {
    const box = el('cut-list');
    box.innerHTML = '';
    if (cuts.length === 0) {
      box.innerHTML = '<p class="hint">No sections marked yet. Add the first one below.</p>';
    }
    cuts.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'cue-row';
      row.innerHTML =
        `<span class="cue-num">${i + 1}</span>` +
        `<span class="cue-time">Cut out</span>` +
        `<input type="text" value="${formatTime(c.start)}" data-i="${i}" data-f="start" ` +
        `aria-label="Cut section ${i + 1} start" style="width:5.5em" inputmode="decimal" />` +
        `<span class="hint">to</span>` +
        `<input type="text" value="${formatTime(c.end)}" data-i="${i}" data-f="end" ` +
        `aria-label="Cut section ${i + 1} end" style="width:5.5em" inputmode="decimal" />` +
        `<button type="button" class="icon-btn" data-del="${i}" aria-label="Remove cut section ${i + 1}">✕</button>`;
      box.appendChild(row);
    });
    box.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => {
        const i = Number(input.getAttribute('data-i'));
        const f = input.getAttribute('data-f') as 'start' | 'end';
        try {
          const t = parseTimeLoose(input.value);
          const next = Math.round(t * 10) / 10;
          cuts[i] = { ...cuts[i], [f]: next };
          validateCuts();
          hideError('error-box');
        } catch (err) {
          showError('error-box', err instanceof Error ? err.message : 'Could not read that time.');
        }
        renderCuts();
        syncTimeline();
      });
    });
    box.querySelectorAll('button[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        cuts.splice(Number(btn.getAttribute('data-del')), 1);
        hideError('error-box');
        renderCuts();
        syncTimeline();
      });
    });
    updateCutHint();
  }

  el('add-cut-btn').addEventListener('click', () => {
    hideError('error-box');
    // Default the new cut around the current preview spot, so marking a
    // mistake you just watched takes one click plus a nudge.
    const preview = el<HTMLVideoElement>('preview');
    const center = duration > 0 ? Math.min(Math.max(preview.currentTime || 0, 1), duration - 1) : 5;
    const s = Math.round(Math.max(0, center - 2.5) * 10) / 10;
    const e = Math.round(Math.min(duration, center + 2.5) * 10) / 10;
    cuts.push({ start: s, end: Math.max(e, s + 0.1) });
    renderCuts();
    syncTimeline();
  });

  document.querySelectorAll('input[name="trim-mode"]').forEach((r) => {
    r.addEventListener('change', () => {
      trimMode = document.querySelector<HTMLInputElement>('input[name="trim-mode"]:checked')?.value === 'cut'
        ? 'cut'
        : 'keep';
      hideError('error-box');
      el('keep-ui').hidden = trimMode !== 'keep';
      el('cut-ui').hidden = !(trimMode === 'cut' && duration > 0);
      if (trimMode === 'cut') {
        renderCuts();
      } else {
        refreshHint();
        el<HTMLButtonElement>('trim-btn').disabled = duration <= 0;
      }
      syncTimeline();
    });
  });

  /** Timeline scrubber: visual start/end selection synced with text inputs.
   *  In "cut" mode the keep handles hide and the cut sections show as red
   *  overlays instead. */
  function syncTimeline(): void {
    if (duration <= 0) return;
    const startH = el('timeline-start');
    const endH = el('timeline-end');
    const range = el('timeline-range');
    // Cut overlays are rebuilt from scratch each time (inline styles, no CSS).
    el('timeline').querySelectorAll('.timeline-cut-ov').forEach((n) => n.remove());
    if (trimMode === 'cut') {
      startH.style.display = 'none';
      endH.style.display = 'none';
      range.style.display = 'none';
      const timeline = el('timeline');
      for (const c of cuts) {
        const ov = document.createElement('div');
        ov.className = 'timeline-cut-ov';
        ov.style.cssText =
          `position:absolute;top:0;bottom:0;left:${(c.start / duration) * 100}%;` +
          `width:${((c.end - c.start) / duration) * 100}%;` +
          `background:rgba(190,40,30,0.45);border-left:2px solid #d34a3a;` +
          `border-right:2px solid #d34a3a;pointer-events:none;border-radius:2px;`;
        timeline.appendChild(ov);
      }
      updateCutHint();
      return;
    }
    startH.style.display = '';
    endH.style.display = '';
    range.style.display = '';
    try {
      const { start, end } = readRange();
      const pct = (t: number) => `${(t / duration) * 100}%`;
      range.style.left = pct(start);
      range.style.width = `calc(${pct(end)} - ${pct(start)})`;
      startH.style.left = pct(start);
      endH.style.left = pct(end);
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
      // In "cut" mode there are no handles: clicking just previews the spot.
      if (trimMode === 'cut') {
        dragging = 'scrub';
        timeline.setPointerCapture(e.pointerId);
        preview.currentTime = t;
        return;
      }
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
    // A new file resets the cut list; the visible UI follows the mode.
    cuts = [];
    el('keep-ui').hidden = trimMode !== 'keep';
    el('cut-ui').hidden = trimMode !== 'cut';
    if (trimMode === 'cut') renderCuts();
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

  /**
   * Cut mode: extract every kept section (re-encoded so the cuts land exactly
   * and every segment has identical codec settings), then join the sections
   * with the concat demuxer without re-encoding.
   */
  async function trimCutMode(): Promise<void> {
    const f = file;
    if (!f) return;
    let sorted: { start: number; end: number }[];
    try {
      sorted = validateCuts();
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Could not read the cut sections.');
      return;
    }
    const keeps = keepRangesFromCuts(sorted);
    if (keeps.length === 0) {
      showError('error-box', 'The cuts remove the whole video — shrink or remove one of them.');
      return;
    }
    setBusy('trim-btn', true, 'Cutting…');
    setProgress(0, 'Starting…');
    // Hoisted so finally can clean up MEMFS even on failure (same overwrite-
    // prompt hang note as the keep-mode path above).
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const inName = 'input' + extOf(f.name);
    const outName = 'output.mp4';
    const segNames: string[] = [];
    let phase = 'Cutting';
    try {
      ffmpeg = await loadFFmpeg();
      await ffmpeg.writeFile(inName, await fetchFileBytes(f));
      const eta = new EtaTracker();
      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.round(progress * 100);
        const left = eta.eta(progress);
        setProgress(pct, `${phase}… ${pct}%${left ? ` · ${left}` : ''}`);
      });
      // One re-encoded pass per kept section.
      for (let i = 0; i < keeps.length; i++) {
        const k = keeps[i];
        const segName = `seg${i}.mp4`;
        segNames.push(segName);
        phase = `Cutting section ${i + 1} of ${keeps.length}`;
        setProgress(0, `${phase}…`);
        await ffmpeg.exec(['-y', '-ss', String(k.start), '-i', inName, '-t', String(k.end - k.start),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', segName]);
      }
      // Join the sections without re-encoding.
      phase = 'Joining sections';
      setProgress(0, `${phase}…`);
      const listText = segNames.map((n) => `file '${n}'`).join('\n');
      await ffmpeg.writeFile('list.txt', new TextEncoder().encode(listText));
      await ffmpeg.exec(['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
        '-c', 'copy', '-movflags', '+faststart', outName]);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      const out = new Uint8Array(data.buffer, data.byteOffset, data.length);
      const kept = keeps.reduce((a, k) => a + (k.end - k.start), 0);
      const name = withExtension(f.name.replace(/(\.\w+)?$/, '-cut$1'), 'mp4');
      downloadBytes(name, out, 'video/mp4');
      setProgress(100, 'Done.');
      el('result').hidden = false;
      const n = sorted.length;
      el('result-info').textContent =
        `${name} · ${formatTime(kept)} kept · ${n} section${n === 1 ? '' : 's'} cut · ${formatBytes(out.length)}`;
    } catch (err) {
      showError('error-box', ffmpegErrorMessage(err));
    } finally {
      if (ffmpeg) {
        await ffmpeg.deleteFile(inName).catch(() => {});
        await ffmpeg.deleteFile(outName).catch(() => {});
        await ffmpeg.deleteFile('list.txt').catch(() => {});
        for (const s of segNames) await ffmpeg.deleteFile(s).catch(() => {});
      }
      setBusy('trim-btn', false);
    }
  }

  el('trim-btn').addEventListener('click', async () => {
    if (!file) return;
    hideError('error-box');
    el('result').hidden = true;
    if (trimMode === 'cut') {
      await trimCutMode();
      return;
    }
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
      const eta2 = new EtaTracker();
      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.round(progress * 100);
        const left = eta2.eta(progress);
        setProgress(pct, `${phase}… ${pct}%${left ? ` · ${left}` : ''}`);
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
    el('progress-wrap').hidden = false;
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
