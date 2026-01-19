// Video trimmer: DOM glue. Two modes: fast (stream copy — cuts snap to
// keyframes, no re-encoding) or precise (re-encodes with H.264 so the cut is
// frame-accurate). ffmpeg.wasm is lazy-loaded after the user picks a file.
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
} from './common.ts';

export function initVideoTrimmer(): void {
  let file: File | null = null;
  let duration = 0;
  const status = el('engine-status');

  function fastMode(): boolean {
    return document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value === 'fast';
  }

  function readRange(): { start: number; end: number } {
    const s = parseTimeInput(el<HTMLInputElement>('start-input').value);
    const e = parseTimeInput(el<HTMLInputElement>('end-input').value);
    return validateTrimRange(s, e, duration);
  }

  function refreshHint(): void {
    try {
      const { start, end } = readRange();
      el('range-hint').textContent =
        `Keeping ${formatTime(start)} → ${formatTime(end)} (${formatTime(end - start)}).` +
        (fastMode()
          ? ' Fast trim cuts on the nearest keyframes, so the cut points may shift by a second or so.'
          : ' Precise trim re-encodes, so the cut is exact.');
      el('error-box').hidden = true;
    } catch (err) {
      el('range-hint').textContent = '';
    }
  }
  el('start-input').addEventListener('input', refreshHint);
  el('end-input').addEventListener('input', refreshHint);
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener('change', refreshHint);
  });

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    const f = files[0];
    if (!f) return;
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
      el('trim-btn').disabled = true;
      return;
    }
    el<HTMLInputElement>('start-input').value = '0:00.0';
    el<HTMLInputElement>('end-input').value = formatTime(duration);
    el('trim-btn').disabled = false;
    refreshHint();
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
      showError('error-box', err instanceof Error ? err.message : 'Invalid trim range.');
      return;
    }
    setBusy('trim-btn', true, 'Trimming…');
    setProgress(0, 'Starting…');
    try {
      const ffmpeg = await loadFFmpeg();
      const inName = 'input' + extOf(file.name);
      const outName = 'output.mp4';
      await ffmpeg.writeFile(inName, await fetchFileBytes(file));
      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.round(progress * 100);
        setProgress(pct, `Trimming… ${pct}%`);
      });
      const keep = String(range.end - range.start);
      const args = fastMode()
        ? // Stream copy: instant, no quality loss, but cuts land on keyframes.
          ['-ss', String(range.start), '-i', inName, '-t', keep, '-c', 'copy', outName]
        : // Re-encode: exact cuts, slower, tiny quality cost.
          ['-ss', String(range.start), '-i', inName, '-t', keep,
           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
           '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outName];
      await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      await ffmpeg.deleteFile(inName);
      await ffmpeg.deleteFile(outName);
      const out = new Uint8Array(data.buffer, data.byteOffset, data.length);
      const name = withExtension(file.name.replace(/(\.\w+)?$/, '-trimmed$1'), 'mp4');
      downloadBytes(name, out, 'video/mp4');
      setProgress(100, 'Done.');
      el('result').hidden = false;
      el('result-info').textContent = `${name} · ${formatTime(range.end - range.start)} · ${formatBytes(out.length)}`;
    } catch (err) {
      showError('error-box', ffmpegErrorMessage(err));
    } finally {
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

  function extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  }
}
