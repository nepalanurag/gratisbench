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
  bindSetting,
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
    r.addEventListener('change', updateSameFormatNote);
  });
  // Remember the bitrate pick between visits.
  bindSetting('audio-converter', 'bitrate', el<HTMLSelectElement>('quality-select'), '192');

  /** Warn when the input is already in the selected lossy format: converting
   *  re-encodes it, which can only lose quality. WAV-to-WAV is lossless, so
   *  no warning there. */
  function updateSameFormatNote(): void {
    const note = el('same-format-note');
    if (!file) {
      note.hidden = true;
      return;
    }
    const fmt = selectedFormat();
    const inExt = extOf(file.name).toLowerCase();
    const lossyMatch = (fmt === 'mp3' || fmt === 'ogg') && inExt === '.' + fmt;
    note.hidden = !lossyMatch;
    if (lossyMatch) {
      note.textContent =
        `Heads up: this file is already ${fmt.toUpperCase()}, so converting re-encodes ` +
        `it and can slightly lower the quality. That is fine if you are changing ` +
        `the bitrate, but if you just need the same file, you already have it.`;
    }
  }

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    const f = files[0];
    if (!f) return;
    file = f;
    el('file-info').textContent = `${f.name} · ${formatBytes(f.size)}`;
    el<HTMLButtonElement>('convert-btn').disabled = false;
    updateSameFormatNote();
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
    // Hoisted so finally can clean up MEMFS even on failure. Without it,
    // a leftover output file makes the next run hit ffmpeg's overwrite
    // prompt — and with no stdin in wasm, exec() hangs forever silently.
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const fmt = selectedFormat();
    const kbps = el<HTMLSelectElement>('quality-select').value;
    const inName = 'input' + extOf(file.name);
    const outName = 'output.' + fmt;
    try {
      ffmpeg = await loadFFmpeg();
      await ffmpeg.writeFile(inName, await fetchFileBytes(file));

      const args =
        fmt === 'mp3'
          ? ['-y', '-i', inName, '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, outName]
          : fmt === 'ogg'
            ? ['-y', '-i', inName, '-c:a', 'libvorbis', '-b:a', `${kbps}k`, outName]
            : ['-y', '-i', inName, '-c:a', 'pcm_s16le', outName];

      ffmpeg.on('progress', ({ progress }) => {
        setProgress(Math.round(progress * 100), `Converting… ${Math.round(progress * 100)}%`);
      });
      await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;

      const out = new Uint8Array(data.buffer, data.byteOffset, data.length);
      const name = withExtension(file.name, fmt);
      downloadBytes(name, out, MIME[fmt]);
      setProgress(100, 'Done.');
      el('result').hidden = false;
      el('result-info').textContent = `${name} · ${formatBytes(out.length)}`;
    } catch (err) {
      showError('error-box', ffmpegErrorMessage(err));
    } finally {
      if (ffmpeg) {
        await ffmpeg.deleteFile(inName).catch(() => {});
        await ffmpeg.deleteFile(outName).catch(() => {});
      }
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
