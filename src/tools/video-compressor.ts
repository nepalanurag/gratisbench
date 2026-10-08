// Video compressor: DOM glue. Targets a file size by estimating the video
// bitrate (targetBytes / duration, minus audio) and encoding one H.264 pass
// with ffmpeg.wasm, lazy-loaded after the user picks a file.
import { estimateVideoBitrateKbps, mbToBytes, formatTime, withExtension } from '../lib/media-core.ts';
import { loadFFmpeg, fetchFileBytes, ffmpegErrorMessage } from './ffmpeg-loader.ts';
import { canUseFastPath, compressVideoFast } from './mediabunny-engine.ts';
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
  suggestNextSteps,
} from './common.ts';

export function initVideoCompressor(): void {
  let file: File | null = null;
  let duration = 0;
  const status = el('engine-status');

  function targetMB(): number {
    const checked = document.querySelector<HTMLInputElement>('input[name="preset"]:checked');
    if (checked?.value === 'custom') {
      // Mirror the input's min=1 / max=2000 attributes: clamp garbage and
      // oversized entries to the allowed range instead of trusting the raw value.
      return Math.min(2000, Math.max(1, Number(el<HTMLInputElement>('custom-mb').value) || 25));
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
    el<HTMLButtonElement>('compress-btn').disabled = duration <= 0;
    if (duration <= 0) {
      showError('error-box', 'Could not read that video. Try a different file.');
    }
    updateEstimate();
    status.hidden = false;
    if (canUseFastPath()) {
      status.textContent = 'Hardware encoder ready. Your file stays on this device.';
    } else {
      status.textContent = 'Loading the video engine (about 30MB, first use only)…';
      try {
        await loadFFmpeg();
        status.textContent = 'Video engine ready. Your file stays on this device.';
      } catch (err) {
        status.textContent = '';
        showError('error-box', ffmpegErrorMessage(err));
      }
    }
  });

  el('compress-btn').addEventListener('click', async () => {
    if (!file || duration <= 0) return;
    hideError('error-box');
    el('result').hidden = true;
    // No point re-encoding when the target is at or above the input size.
    if (mbToBytes(targetMB()) >= file.size) {
      showError(
        'error-box',
        'This video is already smaller than your target — no need to compress.'
      );
      return;
    }
    setBusy('compress-btn', true, 'Compressing…');
    setProgress(0, 'Starting…');

    const vkb = estimateVideoBitrateKbps(mbToBytes(targetMB()), duration);
    const outName = withExtension(file.name.replace(/(\.\w+)?$/, '-compressed$1'), 'mp4');

    // Fast path: WebCodecs via MediaBunny (10-50x faster, hardware encoding).
    // Falls back to ffmpeg.wasm automatically on unsupported browsers/files.
    if (canUseFastPath()) {
      status.textContent = 'Compressing with your device\u2019s hardware encoder…';
      const eta = new EtaTracker();
      try {
        const blob = await compressVideoFast(file, {
          videoBitrateKbps: vkb,
          audioBitrateKbps: 128,
          onProgress: (progress) => {
            const pct = Math.round(progress * 100);
            const left = eta.eta(progress);
            setProgress(pct, `Compressing… ${pct}%${left ? ` · ${left}` : ''}`);
          },
        });
        const out = new Uint8Array(await blob.arrayBuffer());
        if (out.length >= file.size) {
          setProgress(100, 'Done.');
          el('result').hidden = false;
          const biggerPct = Math.round((out.length / file.size - 1) * 100);
          el('result-info').textContent =
            `Compressed file is ${formatBytes(out.length)} — ${biggerPct}% larger than the original ${formatBytes(file.size)}. The original is already well compressed; keeping it is the better option.`;
          setBusy('compress-btn', false);
          return;
        }
        downloadBytes(outName, out, 'video/mp4');
        setProgress(100, 'Done.');
        el('result').hidden = false;
      suggestNextSteps('result', 'video-compressor');
        const savedPct = Math.round((1 - out.length / file.size) * 100);
        el('result-info').textContent =
          `${outName} · ${formatBytes(out.length)} (was ${formatBytes(file.size)}, ${savedPct}% smaller)`;
        setBusy('compress-btn', false);
        return;
      } catch (err) {
        // Fast path failed (exotic codec, no hardware encoder, etc.).
        // Fall through to the ffmpeg.wasm fallback below.
        console.warn('Fast encode failed, falling back to ffmpeg.wasm:', err);
        status.textContent = 'Hardware encode unavailable — using the standard engine…';
      }
    }

    await compressWithFFmpeg(file, vkb, outName);
    setBusy('compress-btn', false);
  });

  async function compressWithFFmpeg(file: File, vkb: number, outName: string): Promise<void> {
    // Hoisted so the finally block can clean up MEMFS even on failure.
    // Without cleanup, a leftover output file makes the next run hit
    // ffmpeg's overwrite prompt — and with no stdin in wasm, exec()
    // hangs forever with no error (the "starts but never finishes" bug).
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const inName = 'input' + extOf(file.name);
    const outName2 = 'output.mp4';
    try {
      ffmpeg = await loadFFmpeg();
      const maxrate = Math.ceil(vkb * 1.5);
      const bufsize = vkb * 2;
      await ffmpeg.writeFile(inName, await fetchFileBytes(file));
      const eta = new EtaTracker();
      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.round(progress * 100);
        const left = eta.eta(progress);
        setProgress(pct, `Compressing… ${pct}%${left ? ` · ${left}` : ''}`);
      });
      // Single pass with a computed target bitrate. True two-pass encoding is
      // possible but much slower in a browser for little visible gain, so this
      // tool does one careful pass instead.
      // '-y': overwrite without prompting (see the hoisted-cleanup note above).
      await ffmpeg.exec([
        '-y',
        '-i', inName,
        '-c:v', 'libx264', '-preset', 'veryfast',
        '-b:v', `${vkb}k`, '-maxrate', `${maxrate}k`, '-bufsize', `${bufsize}k`,
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outName2,
      ]);
      const data = (await ffmpeg.readFile(outName2)) as Uint8Array;
      const out = new Uint8Array(data.buffer, data.byteOffset, data.length);
      if (out.length >= file.size) {
        setProgress(100, 'Done.');
        el('result').hidden = false;
        const biggerPct = Math.round((out.length / file.size - 1) * 100);
        el('result-info').textContent =
          `Compressed file is ${formatBytes(out.length)} — ${biggerPct}% larger than the original ${formatBytes(file.size)}. The original is already well compressed; keeping it is the better option.`;
      } else {
        downloadBytes(outName, out, 'video/mp4');
        setProgress(100, 'Done.');
        el('result').hidden = false;
        suggestNextSteps('result', 'video-compressor');
        const savedPct = Math.round((1 - out.length / file.size) * 100);
        el('result-info').textContent =
          `${outName} · ${formatBytes(out.length)} (was ${formatBytes(file.size)}, ${savedPct}% smaller)`;
      }
    } catch (err) {
      showError('error-box', ffmpegErrorMessage(err));
    } finally {
      if (ffmpeg) {
        await ffmpeg.deleteFile(inName).catch(() => {});
        await ffmpeg.deleteFile(outName2).catch(() => {});
      }
    }
  }

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

  function extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  }

  updateEstimate();
}
