// Audio converter: DOM glue. Converts between MP3, WAV, and OGG Vorbis with
// ffmpeg.wasm, lazy-loaded only after the user picks a file.
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

type OutFormat = 'mp3' | 'wav' | 'ogg';

const MIME: Record<OutFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export function initAudioConverter(): void {
  let file: File | null = null;
  const status = el('engine-status');

  function selectedFormat(): OutFormat {
    const checked = document.querySelector<HTMLInputElement>('input[name="format"]:checked');
    return (checked?.value as OutFormat) || 'mp3';
  }

  function qualityRowVisible(): void {
    const fmt = selectedFormat();
    el('quality-row').hidden = fmt === 'wav';
  }
  document.querySelectorAll('input[name="format"]').forEach((r) => {
    r.addEventListener('change', qualityRowVisible);
  });

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    const f = files[0];
    if (!f) return;
    file = f;
    el('file-info').textContent = `${f.name} · ${formatBytes(f.size)}`;
    el('convert-btn').disabled = false;
    // Start loading the engine in the background while the user picks options.
    status.hidden = false;
    status.textContent = 'Loading the audio engine (about 30MB, first use only)…';
    try {
      await loadFFmpeg();
      status.textContent = 'Audio engine ready. Your file stays on this device.';
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
      const kbps = el<HTMLSelectElement>('quality-select').value;
      const inName = 'input' + extOf(file.name);
      const outName = 'output.' + fmt;
      await ffmpeg.writeFile(inName, await fetchFileBytes(file));

      const args =
        fmt === 'mp3'
          ? ['-i', inName, '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, outName]
          : fmt === 'ogg'
            ? ['-i', inName, '-c:a', 'libvorbis', '-b:a', `${kbps}k`, outName]
            : ['-i', inName, '-c:a', 'pcm_s16le', outName];

      ffmpeg.on('progress', ({ progress }) => {
        setProgress(Math.round(progress * 100), `Converting… ${Math.round(progress * 100)}%`);
      });
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

  qualityRowVisible();
}
