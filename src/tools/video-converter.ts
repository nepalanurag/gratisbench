// Video converter: DOM glue. MP4 (H.264), WebM (VP8), or MOV (H.264) via
// ffmpeg.wasm, lazy-loaded after the user picks a file.
//
// Note on WebM: the single-threaded in-browser ffmpeg build's VP9 encoder
// hangs, so this tool encodes WebM with VP8 instead — widely supported and
// reliable here. That tradeoff is stated on the page.
import { withExtension } from '../lib/media-core.ts';
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

type OutFormat = 'mp4' | 'webm' | 'mov';

const MIME: Record<OutFormat, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export function initVideoConverter(): void {
  let file: File | null = null;
  const status = el('engine-status');

  function selectedFormat(): OutFormat {
    const checked = document.querySelector<HTMLInputElement>('input[name="format"]:checked');
    return (checked?.value as OutFormat) || 'mp4';
  }

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    const f = files[0];
    if (!f) return;
    file = f;
    el('file-info').textContent = `${f.name} · ${formatBytes(f.size)}`;
    el('convert-btn').disabled = false;
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

  el('convert-btn').addEventListener('click', async () => {
    if (!file) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('convert-btn', true, 'Converting…');
    setProgress(0, 'Starting…');
    try {
      const ffmpeg = await loadFFmpeg();
      const fmt = selectedFormat();
      const inName = 'input' + extOf(file.name);
      const outName = 'output.' + fmt;
      await ffmpeg.writeFile(inName, await fetchFileBytes(file));
      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.round(progress * 100);
        setProgress(pct, `Converting… ${pct}%`);
      });
      const args =
        fmt === 'mp4'
          ? ['-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
             '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', outName]
          : fmt === 'webm'
            ? ['-i', inName, '-c:v', 'libvpx', '-b:v', '0', '-crf', '28',
               '-deadline', 'good', '-cpu-used', '5', '-c:a', 'libvorbis', outName]
            : ['-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
               '-pix_fmt', 'yuv420p', '-c:a', 'aac', outName];
      await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      await ffmpeg.deleteFile(inName);
      await ffmpeg.deleteFile(outName);
      const out = new Uint8Array(data.buffer, data.byteOffset, data.length);
      const name = withExtension(file.name, fmt);
      downloadBytes(name, out, MIME[fmt]);
      setProgress(100, 'Done.');
      el('result').hidden = false;
      el('result-info').textContent = `${name} · ${formatBytes(out.length)}`;
    } catch (err) {
      showError('error-box', ffmpegErrorMessage(err));
    } finally {
      setBusy('convert-btn', false);
    }
  });

  function setProgress(pct: number, label: string): void {
    el('progress-bar').style.width = `${pct}%`;
    el('progress-label').textContent = label;
  }

  function extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  }
}
