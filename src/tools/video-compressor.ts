// Video compressor: DOM glue. Targets a file size by estimating the video
// bitrate (targetBytes / duration, minus audio) and encoding one H.264 pass
// with ffmpeg.wasm, lazy-loaded after the user picks a file.
import { estimateVideoBitrateKbps, mbToBytes, formatTime, withExtension } from '../lib/media-core.ts';
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

export function initVideoCompressor(): void {
  let file: File | null = null;
  let duration = 0;
  const status = el('engine-status');

  function targetMB(): number {
    const checked = document.querySelector<HTMLInputElement>('input[name="preset"]:checked');
    if (checked?.value === 'custom') {
      return Math.max(1, Number(el<HTMLInputElement>('custom-mb').value) || 25);
    }
    return Number(checked?.value || 25);
  }

  function updateEstimate(): void {
    const note = el('bitrate-note');
    if (!file || duration <= 0) {
      note.textContent = '';
      note.hidden = true;
      return;
    }
    try {
      const vkb = estimateVideoBitrateKbps(mbToBytes(targetMB()), duration);
      note.textContent =
        `Target ${targetMB()}MB for ${formatTime(duration)} → about ${vkb} kbps video + 128 kbps audio.`;
      note.hidden = false;
    } catch {
      note.textContent = '';
      note.hidden = true;
    }
  }
  document.querySelectorAll('input[name="preset"]').forEach((r) => {
    r.addEventListener('change', () => {
      el('custom-row').hidden = document.querySelector<HTMLInputElement>('input[name="preset"]:checked')?.value !== 'custom';
      updateEstimate();
    });
  });
  el<HTMLInputElement>('custom-mb').addEventListener('input', updateEstimate);

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    const f = files[0];
    if (!f) return;
    file = f;
    // Read the duration from a throwaway video element — no engine needed.
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
    el('compress-btn').disabled = duration <= 0;
    if (duration <= 0) {
      showError('error-box', 'Could not read that video. Try a different file.');
    }
    updateEstimate();
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

  el('compress-btn').addEventListener('click', async () => {
    if (!file || duration <= 0) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('compress-btn', true, 'Compressing…');
    setProgress(0, 'Starting…');
    try {
      const ffmpeg = await loadFFmpeg();
      const vkb = estimateVideoBitrateKbps(mbToBytes(targetMB()), duration);
      const maxrate = Math.ceil(vkb * 1.5);
      const bufsize = vkb * 2;
      const inName = 'input' + extOf(file.name);
      const outName = 'output.mp4';
      await ffmpeg.writeFile(inName, await fetchFileBytes(file));
      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.round(progress * 100);
        setProgress(pct, `Compressing… ${pct}%`);
      });
      // Single pass with a computed target bitrate. True two-pass encoding is
      // possible but much slower in a browser for little visible gain, so this
      // tool does one careful pass instead.
      await ffmpeg.exec([
        '-i', inName,
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-b:v', `${vkb}k`, '-maxrate', `${maxrate}k`, '-bufsize', `${bufsize}k`,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outName,
      ]);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      await ffmpeg.deleteFile(inName);
      await ffmpeg.deleteFile(outName);
      const out = new Uint8Array(data.buffer, data.byteOffset, data.length);
      const name = withExtension(file.name.replace(/(\.\w+)?$/, '-compressed$1'), 'mp4');
      downloadBytes(name, out, 'video/mp4');
      setProgress(100, 'Done.');
      el('result').hidden = false;
      el('result-info').textContent =
        `${name} · ${formatBytes(out.length)} (was ${formatBytes(file.size)})`;
    } catch (err) {
      showError('error-box', ffmpegErrorMessage(err));
    } finally {
      setBusy('compress-btn', false);
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

  updateEstimate();
}
