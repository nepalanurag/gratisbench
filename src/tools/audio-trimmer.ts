// Audio trimmer: DOM glue. Pure logic lives in ../lib/media-core.ts and
// ../lib/mp3-encode.ts. Decodes with Web Audio, draws a canvas waveform,
// previews the selection, and exports WAV (pure JS) or MP3 (lazy lamejs).
import {
  formatTime,
  parseTimeInput,
  encodeWav,
  computePeaks,
  sliceChannels,
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

  function getCtx(): AudioContext {
    if (!audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  }

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
    const mono = mixMono();
    const peaks = computePeaks(mono, buckets);
    const mid = cssH / 2;
    const c = themeColors();

    // dim full waveform
    ctx.fillStyle = c.wave;
    for (let b = 0; b < buckets; b++) {
      const h = Math.max(1, peaks[b] * (cssH / 2 - 6));
      ctx.fillRect((b / buckets) * cssW, mid - h, Math.max(1, cssW / buckets - 0.5), h * 2);
    }

    // selection region, full height
    const x0 = (start / duration) * cssW;
    const x1 = (end / duration) * cssW;
    ctx.fillStyle = c.region;
    ctx.fillRect(x0, 0, x1 - x0, cssH);
    ctx.fillStyle = c.marker;
    ctx.fillRect(x0 - 1, 0, 2.5, cssH);
    ctx.fillRect(x1 - 1, 0, 2.5, cssH);

    // playhead
    const xp = (playhead / duration) * cssW;
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
    el('start-input').value = formatTime(start);
    el('end-input').value = formatTime(end);
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
    const sliced = sliceChannels(channels, start * sampleRate, end * sampleRate);
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
      draw();
    }, 50);
    source.onended = () => {
      if (source) stopPlayback();
    };
    draw();
  }

  function selectionChannels(): Float32Array[] {
    return sliceChannels(channels, start * sampleRate, end * sampleRate);
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
      fileName = file.name;
      start = 0;
      end = Math.round(duration * 10) / 10;
      playhead = 0;
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
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const x0 = (start / duration) * rect.width;
    const x1 = (end / duration) * rect.width;
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
