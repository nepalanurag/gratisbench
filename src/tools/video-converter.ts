// Video converter: DOM glue. MP4 (H.264), WebM (VP8), or MOV (H.264) via
// ffmpeg.wasm, lazy-loaded after the user picks a file.
//
// Note on WebM: the single-threaded in-browser ffmpeg build's VP9 encoder
// hangs, so this tool encodes WebM with VP8 instead — widely supported and
// reliable here. That tradeoff is stated on the page.
import { withExtension } from '../lib/media-core.ts';
import { loadFFmpeg, fetchFileBytes, ffmpegErrorMessage } from './ffmpeg-loader.ts';
import { canUseFastPath, convertVideoFast } from './mediabunny-engine.ts';
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

  function selectedSpeed(): number {
    const checked = document.querySelector<HTMLInputElement>('input[name="speed"]:checked');
    const v = parseFloat(checked?.value ?? '1');
    return [0.5, 1, 1.5, 2].includes(v) ? v : 1;
  }

  function selectedAspect(): string {
    const checked = document.querySelector<HTMLInputElement>('input[name="aspect"]:checked');
    const v = checked?.value ?? 'original';
    return ['original', '16:9', '9:16', '1:1', '4:3'].includes(v) ? v : 'original';
  }

  /** Crop filter that trims the frame to the target aspect ratio, centered.
   *  The trailing scale forces even dimensions (required by yuv420p). */
  function aspectCropFilter(aspect: string): string | null {
    const ratio: Record<string, [number, number]> = {
      '16:9': [16, 9],
      '9:16': [9, 16],
      '1:1': [1, 1],
      '4:3': [4, 3],
    };
    const r = ratio[aspect];
    if (!r) return null;
    const [w, h] = r;
    return (
      `crop=w='min(iw,ih*${w}/${h})':h='min(ih,iw*${h}/${w})'` +
      `,scale=trunc(iw/2)*2:trunc(ih/2)*2`
    );
  }

  /** Combined -vf chain for speed + aspect. Empty array when neither applies. */
  function videoFilters(speed: number, aspect: string): string[] {
    const chain: string[] = [];
    if (speed !== 1) chain.push(`setpts=${1 / speed}*PTS`);
    const crop = aspectCropFilter(aspect);
    if (crop) chain.push(crop);
    // atempo supports 0.5–2.0 in a single filter.
    const audio = speed === 1 ? [] : ['-af', `atempo=${speed}`];
    return chain.length > 0 ? ['-vf', chain.join(','), ...audio] : audio;
  }

  /** True when the input file is already in the chosen output container,
   *  so ffmpeg can copy the streams instead of re-encoding them. */
  function canFastCopy(): boolean {
    if (!file) return false;
    const inExt = extOf(file.name).toLowerCase();
    const fmt = selectedFormat();
    return inExt === '.' + fmt || (fmt === 'mp4' && inExt === '.m4v');
  }

  function updateFastCopyRow(): void {
    const row = el('fastcopy-row');
    // Fast copy needs 1× speed, matching container, and no aspect change —
    // any of those requires re-encoding.
    const match = selectedSpeed() === 1 && selectedAspect() === 'original' && canFastCopy();
    row.hidden = !match;
    if (match) el<HTMLInputElement>('fastcopy-check').checked = true;
  }

  document.querySelectorAll('input[name="format"]').forEach((r) => {
    r.addEventListener('change', updateFastCopyRow);
  });
  document.querySelectorAll('input[name="speed"]').forEach((r) => {
    r.addEventListener('change', updateFastCopyRow);
  });
  document.querySelectorAll('input[name="aspect"]').forEach((r) => {
    r.addEventListener('change', updateFastCopyRow);
  });

  /** Smart default: match the output format to the input container when the
   *  user hasn't picked one yet — converting webm→webm is usually a tweak
   *  (speed, aspect), not a format change. MP4 stays the default otherwise. */
  function applyFormatDefault(fileName: string): void {
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    const map: Record<string, string> = { '.webm': 'webm', '.mov': 'mov' };
    const fmt = map[ext];
    if (!fmt) return;
    const radio = document.querySelector<HTMLInputElement>(`input[name="format"][value="${fmt}"]`);
    if (radio) radio.checked = true;
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
    el('file-info').textContent = `${f.name} · ${formatBytes(f.size)}`;
    el<HTMLButtonElement>('convert-btn').disabled = false;
    applyFormatDefault(f.name);
    updateFastCopyRow();
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

  el('convert-btn').addEventListener('click', async () => {
    if (!file) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('convert-btn', true, 'Converting…');
    setProgress(0, 'Starting…');
    const fmt = selectedFormat();
    const speed = selectedSpeed();
    const aspect = selectedAspect();
    const mute = el<HTMLInputElement>('mute-check').checked;
    // Re-encoding is required for speed, aspect, or container changes; fast
    // copy only works when everything stays as-is. Muting does not force a
    // re-encode: the video stream can still be copied while audio is dropped.
    const useFastCopy = speed === 1 && aspect === 'original' && canFastCopy() && el<HTMLInputElement>('fastcopy-check').checked;
    // Fast path: WebCodecs via MediaBunny for plain MP4/MOV transcodes.
    // Speed changes, aspect crops, and WebM output stay on ffmpeg.wasm.
    const useFastConvert =
      canUseFastPath() &&
      (fmt === 'mp4' || fmt === 'mov') &&
      speed === 1 &&
      aspect === 'original' &&
      !useFastCopy;
    if (useFastConvert) {
      status.textContent = 'Converting with your device\u2019s hardware encoder…';
      const eta = new EtaTracker();
      try {
        const blob = await convertVideoFast(file, {
          format: fmt as 'mp4' | 'mov',
          mute,
          onProgress: (progress) => {
            const pct = Math.round(progress * 100);
            const left = eta.eta(progress);
            setProgress(pct, `Converting… ${pct}%${left ? ` · ${left}` : ''}`);
          },
        });
        const out = new Uint8Array(await blob.arrayBuffer());
        const name = withExtension(file!.name, fmt);
        downloadBytes(name, out, MIME[fmt]);
        setProgress(100, 'Done.');
        el('result').hidden = false;
        el('result-info').textContent = `${name} · ${formatBytes(out.length)}${mute ? ' · sound removed' : ''}`;
      } catch (err) {
        console.warn('Fast convert failed, falling back to ffmpeg.wasm:', err);
        status.textContent = 'Hardware encode unavailable — using the standard engine…';
        await convertWithFFmpeg();
      } finally {
        setBusy('convert-btn', false);
      }
      return;
    }
    await convertWithFFmpeg();
    setBusy('convert-btn', false);
  });

  async function convertWithFFmpeg(): Promise<void> {
    // Hoisted so finally can clean up MEMFS even on failure. Without it,
    // a leftover output file makes the next run hit ffmpeg's overwrite
    // prompt — and with no stdin in wasm, exec() hangs forever silently.
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const fmt = selectedFormat();
    const speed = selectedSpeed();
    const aspect = selectedAspect();
    const mute = el<HTMLInputElement>('mute-check').checked;
    const inName = 'input' + extOf(file!.name);
    const outName = 'output.' + fmt;
    // Re-encoding is required for speed, aspect, or container changes; fast
    // copy only works when everything stays as-is. Muting does not force a
    // re-encode: the video stream can still be copied while audio is dropped.
    const useFastCopy = speed === 1 && aspect === 'original' && canFastCopy() && el<HTMLInputElement>('fastcopy-check').checked;
    try {
      ffmpeg = await loadFFmpeg();
      await ffmpeg.writeFile(inName, await fetchFileBytes(file!));
      const eta = new EtaTracker();
      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.round(progress * 100);
        const left = eta.eta(progress);
        setProgress(pct, `Converting… ${pct}%${left ? ` · ${left}` : ''}`);
      });
      const vf = videoFilters(speed, aspect);
      const noAudio = mute ? ['-an'] : [];
      const args =
        useFastCopy
          ? // Same container: copy the original streams. No re-encode, no
            // quality loss, and it finishes in seconds. faststart only
            // applies to the MP4/MOV muxers.
            ['-y', '-i', inName, ...(mute ? ['-c:v', 'copy', '-an'] : ['-c', 'copy']),
             ...(fmt === 'webm' ? [] : ['-movflags', '+faststart']), outName]
          : fmt === 'mp4'
          ? ['-y', '-i', inName, ...vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
             '-pix_fmt', 'yuv420p', ...(mute ? noAudio : ['-c:a', 'aac']), '-movflags', '+faststart', outName]
          : fmt === 'webm'
            ? ['-y', '-i', inName, ...vf, '-c:v', 'libvpx', '-b:v', '0', '-crf', '28',
               '-deadline', 'good', '-cpu-used', '5', ...(mute ? noAudio : ['-c:a', 'libvorbis']), outName]
            : ['-y', '-i', inName, ...vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
               '-pix_fmt', 'yuv420p', ...(mute ? noAudio : ['-c:a', 'aac']), outName];
      await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      const out = new Uint8Array(data.buffer, data.byteOffset, data.length);
      const name = withExtension(file!.name, fmt);
      downloadBytes(name, out, MIME[fmt]);
      setProgress(100, 'Done.');
      el('result').hidden = false;
      el('result-info').textContent = `${name} · ${formatBytes(out.length)}${mute ? ' · sound removed' : ''}`;
    } catch (err) {
      showError('error-box', ffmpegErrorMessage(err));
    } finally {
      if (ffmpeg) {
        await ffmpeg.deleteFile(inName).catch(() => {});
        await ffmpeg.deleteFile(outName).catch(() => {});
      }
    }
  }

  function setProgress(pct: number, label: string): void {
    el('progress-wrap').hidden = false;
    el('progress-bar').style.width = `${pct}%`;
    el('progress-label').textContent = label;
  }

  function extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  }
}
