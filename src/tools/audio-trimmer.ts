// Audio trimmer: DOM glue. Pure logic lives in ../lib/media-core.ts and
// ../lib/mp3-encode.ts. Decodes with Web Audio, draws a canvas waveform,
// previews the selection, and exports WAV (pure JS) or MP3 (lazy lamejs).
import {
  formatTime,
  parseTimeInput,
  encodeWav,
  computePeaks,
  sliceChannels,
  applyFades,
  validateTrimRange,
  withExtension,
  clamp,
} from '../lib/media-core.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
} from './common.ts';

export function initAudioTrimmer(): void {
  const editor = el('editor');
  const canvas = el<HTMLCanvasElement>('waveform');
  const ctx = canvas.getContext('2d');

  let audioCtx: AudioContext | null = null;
  let channels: Float32Array[] = [];
  let sampleRate = 44100;
  let duration = 0;
  let fileName = 'audio';
  let start = 0;
  let end = 0;
  let playhead = 0;
  let source: AudioBufferSourceNode | null = null;
  let playTimer: number | null = null;
  // Waveform zoom: the visible time window. viewEnd <= viewStart means "whole file".
  let viewStart = 0;
  let viewEnd = 0;
  // Cached per loaded file: the mono mix and the peaks for the current canvas
  // width and zoom window. draw() runs on every slider move and every 50ms
  // during playback; without this cache it re-mixed the full-length buffer
  // (~600MB for an hour-long file) on every single repaint.
  let mono: Float32Array = new Float32Array(0);
  let peakCache: { key: string; peaks: Float32Array } | null = null;

  /** The visible window as [start, end] seconds; whole file when unset. */
  function view(): [number, number] {
    if (duration <= 0 || viewEnd <= viewStart) return [0, Math.max(duration, 0.001)];
    return [viewStart, viewEnd];
  }

  function setView(vs: number, ve: number): void {
    const minSpan = 1; // never zoom closer than a 1-second window
    let span = Math.min(duration, Math.max(minSpan, ve - vs));
    let s = clamp(vs, 0, Math.max(0, duration - span));
    viewStart = s;
    viewEnd = s + span;
    syncZoomButtons();
  }

  function syncZoomButtons(): void {
    const [vs, ve] = view();
    const span = ve - vs;
    const zoomed = duration > 0 && span < duration - 0.01;
    el('pan-left-btn').hidden = !zoomed;
    el('pan-right-btn').hidden = !zoomed;
    el<HTMLButtonElement>('zoom-in-btn').disabled = span <= 1.001;
    el<HTMLButtonElement>('zoom-out-btn').disabled = !zoomed;
    el<HTMLButtonElement>('zoom-reset-btn').disabled = !zoomed;
  }

  function zoom(factor: number): void {
    if (duration <= 0) return;
    const [vs, ve] = view();
    const span = ve - vs;
    // Zoom toward the playhead when it is in view, else the selection middle.
    const center = playhead >= vs && playhead <= ve ? playhead : (start + end) / 2;
    const next = clamp(span * factor, 1, duration);
    setView(center - next / 2, center + next / 2);
    draw();
  }

  el('zoom-in-btn').addEventListener('click', () => zoom(0.5));
  el('zoom-out-btn').addEventListener('click', () => zoom(2));
  el('zoom-reset-btn').addEventListener('click', () => {
    viewStart = 0;
    viewEnd = 0;
    syncZoomButtons();
    draw();
  });
  el('pan-left-btn').addEventListener('click', () => {
    const [vs, ve] = view();
    const span = ve - vs;
    setView(vs - span / 4, ve - span / 4);
    draw();
  });
  el('pan-right-btn').addEventListener('click', () => {
    const [vs, ve] = view();
    const span = ve - vs;
    setView(vs + span / 4, ve + span / 4);
    draw();
  });

  function getCtx(): AudioContext {
    if (!audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  }

  // iOS Safari only lets an AudioContext start inside a user gesture. Create
  // (and resume) it on the first tap/keypress so playback works on the first
  // Play click instead of silently staying muted.
  function warmCtx(): void {
    try {
      getCtx();
    } catch {
      /* audio unavailable — decode paths handle errors */
    }
  }
  window.addEventListener('pointerdown', warmCtx, { once: true });
  window.addEventListener('keydown', warmCtx, { once: true });

  function themeColors(): { wave: string; marker: string; region: string; playhead: string } {
    // Canvas sits on var(--paper): #ffffff light, #1b1b1b dark. Pick colors
    // with real contrast on both; repaint when the theme flips.
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark
      ? { wave: '#8a8a8a', marker: '#e0705f', region: 'rgba(224, 112, 95, 0.20)', playhead: '#f0f0f0' }
      : { wave: '#767676', marker: '#a63d21', region: 'rgba(166, 61, 33, 0.14)', playhead: '#23201a' };
  }

  function draw(): void {
    if (!ctx || channels.length === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 640;
    const cssH = 160;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const buckets = Math.max(1, Math.floor(cssW));
    const [vs, ve] = view();
    const span = ve - vs;
    // Peaks are computed over the visible window only, so zooming in is fast.
    // mono.subarray is a view, not a copy.
    const frame0 = Math.max(0, Math.floor(vs * sampleRate));
    const frame1 = Math.min(mono.length, Math.max(frame0 + 1, Math.ceil(ve * sampleRate)));
    const key = `${frame0}:${frame1}:${buckets}`;
    if (!peakCache || peakCache.key !== key) {
      // subarray() widens the type to ArrayBufferLike; the mono buffer is
      // always ArrayBuffer-backed (new Float32Array / .slice()), so narrow it.
      const visible = mono.subarray(frame0, frame1) as Float32Array<ArrayBuffer>;
      peakCache = { key, peaks: computePeaks(visible, buckets) };
    }
    const peaks = peakCache.peaks;
    const mid = cssH / 2;
    const c = themeColors();
    const x = (t: number): number => ((t - vs) / span) * cssW;

    // dim full waveform
    ctx.fillStyle = c.wave;
    for (let b = 0; b < buckets; b++) {
      const h = Math.max(1, peaks[b] * (cssH / 2 - 6));
      ctx.fillRect((b / buckets) * cssW, mid - h, Math.max(1, cssW / buckets - 0.5), h * 2);
    }

    // selection region, full height
    const x0 = x(start);
    const x1 = x(end);
    ctx.fillStyle = c.region;
    ctx.fillRect(x0, 0, x1 - x0, cssH);
    ctx.fillStyle = c.marker;
    ctx.fillRect(x0 - 1, 0, 2.5, cssH);
    ctx.fillRect(x1 - 1, 0, 2.5, cssH);

    // playhead
    const xp = x(playhead);
    ctx.fillStyle = c.playhead;
    ctx.fillRect(xp - 0.75, 0, 1.5, cssH);
  }

  // Repaint the waveform when the theme toggles.
  new MutationObserver((muts) => {
    if (muts.some((m) => m.attributeName === 'data-theme')) draw();
  }).observe(document.documentElement, { attributes: true });

  function mixMono(): Float32Array {
    const frames = channels[0].length;
    const out = new Float32Array(frames);
    for (const c of channels) {
      for (let i = 0; i < frames; i++) out[i] += c[i] / channels.length;
    }
    return out;
  }

  function syncControls(): void {
    el<HTMLInputElement>('start-input').value = formatTime(start);
    el<HTMLInputElement>('end-input').value = formatTime(end);
    const sSl = el<HTMLInputElement>('start-slider');
    const eSl = el<HTMLInputElement>('end-slider');
    sSl.value = String(start);
    eSl.value = String(end);
    el('start-readout').textContent = formatTime(start);
    el('end-readout').textContent = formatTime(end);
    el('duration-readout').textContent = `Selection: ${formatTime(end - start)} of ${formatTime(duration)}`;
    draw();
  }

  function setRange(ns: number, ne: number): void {
    const r = validateTrimRange(ns, ne, duration);
    start = Math.round(r.start * 10) / 10;
    end = Math.round(r.end * 10) / 10;
    playhead = clamp(playhead, start, end);
    syncControls();
  }

  function stopPlayback(): void {
    try {
      source?.stop();
    } catch {
      /* already stopped */
    }
    source = null;
    if (playTimer !== null) {
      window.clearInterval(playTimer);
      playTimer = null;
    }
    el<HTMLButtonElement>('play-btn').textContent = 'Play selection';
  }

  function playSelection(): void {
    stopPlayback();
    const ctxA = getCtx();
    // Use selectionChannels() so the preview includes the chosen effects.
    const sliced = selectionChannels();
    const buf = ctxA.createBuffer(sliced.length, sliced[0].length, sampleRate);
    sliced.forEach((c, i) => buf.copyToChannel(c, i));
    source = ctxA.createBufferSource();
    source.buffer = buf;
    source.connect(ctxA.destination);
    const t0 = ctxA.currentTime;
    source.start(0);
    playhead = start;
    el<HTMLButtonElement>('play-btn').textContent = 'Stop';
    const dur = end - start;
    playTimer = window.setInterval(() => {
      playhead = start + (ctxA.currentTime - t0);
      if (playhead >= end) {
        stopPlayback();
        playhead = end;
      }
      // When zoomed in, keep the playhead in view while playing.
      const [vs, ve] = view();
      if (ve - vs < duration - 0.01 && (playhead < vs || playhead > ve)) {
        const span = ve - vs;
        setView(playhead - span / 2, playhead + span / 2);
      }
      draw();
    }, 50);
    source.onended = () => {
      if (source) stopPlayback();
    };
    draw();
  }

  function selectionChannels(): Float32Array[] {
    const sliced = sliceChannels(channels, start * sampleRate, end * sampleRate);
    const fadeMs = Number(el<HTMLSelectElement>('fade-ms').value);
    if (fadeMs > 0) applyFades(sliced, sampleRate, fadeMs);
    if (el<HTMLInputElement>('reverse-check').checked) {
      for (const ch of sliced) ch.reverse();
    }
    if (el<HTMLInputElement>('normalize-check').checked) {
      let peak = 0;
      for (const ch of sliced) {
        for (let i = 0; i < ch.length; i++) {
          const a = Math.abs(ch[i]);
          if (a > peak) peak = a;
        }
      }
      if (peak > 0 && peak < 1) {
        const gain = 1 / peak;
        for (const ch of sliced) {
          for (let i = 0; i < ch.length; i++) ch[i] *= gain;
        }
      }
    }
    return sliced;
  }

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    const file = files[0];
    if (!file) return;
    stopPlayback();
    setBusy('play-btn', true);
    try {
      const bytes = await file.arrayBuffer();
      const ctxA = getCtx();
      const decoded = await ctxA.decodeAudioData(bytes);
      sampleRate = decoded.sampleRate;
      duration = decoded.duration;
      channels = [];
      for (let i = 0; i < decoded.numberOfChannels; i++) {
        channels.push(decoded.getChannelData(i).slice());
      }
      // Cache the mono mix once per file; draw() reuses it on every repaint.
      mono = mixMono();
      peakCache = null;
      fileName = file.name;
      start = 0;
      end = Math.round(duration * 10) / 10;
      playhead = 0;
      // A new file resets the zoom to the whole file.
      viewStart = 0;
      viewEnd = 0;
      syncZoomButtons();
      editor.hidden = false;
      const sSl = el<HTMLInputElement>('start-slider');
      const eSl = el<HTMLInputElement>('end-slider');
      sSl.max = String(duration);
      sSl.step = '0.1';
      eSl.max = String(duration);
      eSl.step = '0.1';
      el('file-info').textContent =
        `${file.name} · ${formatTime(duration)} · ${sampleRate} Hz · ${formatBytes(file.size)}`;
      syncControls();
      el('waveform-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Could not decode that audio file.');
    } finally {
      setBusy('play-btn', false);
    }
  });

  // sliders: keep start <= end with a 0.1s gap
  el<HTMLInputElement>('start-slider').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    try {
      setRange(Math.min(v, end - 0.1), end);
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Invalid range.');
    }
  });
  el<HTMLInputElement>('end-slider').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    try {
      setRange(start, Math.max(v, start + 0.1));
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Invalid range.');
    }
  });

  const applyInputs = () => {
    hideError('error-box');
    try {
      const ns = parseTimeInput(el<HTMLInputElement>('start-input').value);
      const ne = parseTimeInput(el<HTMLInputElement>('end-input').value);
      setRange(ns, ne);
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Invalid time.');
      syncControls();
    }
  };
  el('start-input').addEventListener('change', applyInputs);
  el('end-input').addEventListener('change', applyInputs);

  // canvas interaction: drag near a handle to move it, click/drag elsewhere to scrub
  let dragMode: 'start' | 'end' | 'play' | null = null;
  const posToTime = (clientX: number): number => {
    const rect = canvas.getBoundingClientRect();
    const [vs, ve] = view();
    return clamp(vs + ((clientX - rect.left) / rect.width) * (ve - vs), 0, duration);
  };
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const [vs, ve] = view();
    const span = ve - vs;
    const x = e.clientX - rect.left;
    const x0 = ((start - vs) / span) * rect.width;
    const x1 = ((end - vs) / span) * rect.width;
    if (Math.abs(x - x0) < 14) dragMode = 'start';
    else if (Math.abs(x - x1) < 14) dragMode = 'end';
    else dragMode = 'play';
    canvas.setPointerCapture(e.pointerId);
    const t = posToTime(e.clientX);
    if (dragMode === 'start') setRange(Math.min(t, end - 0.1), end);
    else if (dragMode === 'end') setRange(start, Math.max(t, start + 0.1));
    else {
      playhead = t;
      draw();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragMode) return;
    const t = posToTime(e.clientX);
    if (dragMode === 'start') setRange(Math.min(t, end - 0.1), end);
    else if (dragMode === 'end') setRange(start, Math.max(t, start + 0.1));
    else {
      playhead = t;
      draw();
    }
  });
  canvas.addEventListener('pointerup', () => {
    dragMode = null;
  });

  el('play-btn').addEventListener('click', () => {
    if (source) stopPlayback();
    else playSelection();
  });

  el('export-wav-btn').addEventListener('click', () => {
    hideError('error-box');
    try {
      const wav = encodeWav(selectionChannels(), sampleRate);
      const name = withExtension(fileName.replace(/(\.\w+)?$/, '-trimmed$1'), 'wav');
      downloadBytes(name, wav, 'audio/wav');
      el('result').hidden = false;
      el('result-info').textContent = `Trimmed WAV · ${formatTime(end - start)} · ${formatBytes(wav.length)}`;
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Export failed.');
    }
  });

  el('export-mp3-btn').addEventListener('click', async () => {
    hideError('error-box');
    setBusy('export-mp3-btn', true, 'Encoding MP3…');
    try {
      // lamejs is lazy-loaded here so the encoder (~150KB) is not in the
      // page's initial bundle; the 30MB ffmpeg engine is never needed for this.
      const { encodeMp3 } = await import('../lib/mp3-encode.ts');
      const kbps = Number(el<HTMLSelectElement>('mp3-bitrate').value);
      const mp3 = await encodeMp3(selectionChannels(), sampleRate, kbps);
      const name = withExtension(fileName.replace(/(\.\w+)?$/, '-trimmed$1'), 'mp3');
      downloadBytes(name, mp3, 'audio/mpeg');
      el('result').hidden = false;
      el('result-info').textContent = `Trimmed MP3 (${kbps} kbps) · ${formatTime(end - start)} · ${formatBytes(mp3.length)}`;
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'MP3 export failed.');
    } finally {
      setBusy('export-mp3-btn', false);
    }
  });

  window.addEventListener('resize', () => {
    if (!editor.hidden) draw();
  });
}
