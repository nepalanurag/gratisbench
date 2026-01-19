// Audio merger: DOM glue. Clips are decoded with Web Audio, resampled to a
// common rate with the pure resampleLinear helper, concatenated in an
// OfflineAudioContext with a linear fade-out/fade-in at each join, and the
// render is encoded as WAV with the pure encodeWav helper.
import {
  formatTime,
  resampleLinear,
  encodeWav,
  withExtension,
} from '../lib/media-core.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  ICONS,
} from './common.ts';

interface Clip {
  name: string;
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
}

export function initAudioMerger(): void {
  const clips: Clip[] = [];
  const list = el('file-list');
  const empty = el('empty-state');

  function getCtx(): AudioContext {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    return new AC();
  }

  function render(): void {
    empty.hidden = clips.length > 0;
    list.innerHTML = '';
    clips.forEach((clip, i) => {
      const row = document.createElement('li');
      row.className = 'file-row';
      row.innerHTML = `
        <span class="file-order">${i + 1}</span>
        <span class="file-name" title="${escapeHtml(clip.name)}">${escapeHtml(clip.name)}</span>
        <span class="file-meta">${formatTime(clip.duration)}</span>
        <span class="file-actions">
          <button type="button" class="icon-btn" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ICONS.up}</button>
          <button type="button" class="icon-btn" data-act="down" data-i="${i}" ${i === clips.length - 1 ? 'disabled' : ''} aria-label="Move down">${ICONS.down}</button>
          <button type="button" class="icon-btn" data-act="remove" data-i="${i}" aria-label="Remove">${ICONS.x}</button>
        </span>`;
      list.appendChild(row);
    });
    el<HTMLButtonElement>('merge-btn').disabled = clips.length === 0;
    const total = clips.reduce((a, c) => a + c.duration, 0);
    el('count-label').textContent =
      clips.length === 0 ? '' : `${clips.length} clip${clips.length === 1 ? '' : 's'} · ${formatTime(total)} total`;
  }

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]');
    if (!btn) return;
    const i = Number(btn.getAttribute('data-i'));
    const act = btn.getAttribute('data-act');
    if (act === 'remove') clips.splice(i, 1);
    else if (act === 'up' && i > 0) [clips[i - 1], clips[i]] = [clips[i], clips[i - 1]];
    else if (act === 'down' && i < clips.length - 1) [clips[i + 1], clips[i]] = [clips[i], clips[i + 1]];
    render();
  });

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        const decoded = await getCtx().decodeAudioData(bytes);
        const channels: Float32Array[] = [];
        for (let i = 0; i < decoded.numberOfChannels; i++) {
          channels.push(decoded.getChannelData(i).slice());
        }
        clips.push({
          name: file.name,
          channels,
          sampleRate: decoded.sampleRate,
          duration: decoded.duration,
        });
      } catch (err) {
        showError('error-box', `"${file.name}": could not be decoded as audio.`);
        void err;
      }
    }
    render();
  });

  el<HTMLInputElement>('fade-slider').addEventListener('input', (e) => {
    el('fade-val').textContent = `${Number((e.target as HTMLInputElement).value).toFixed(1)}s`;
  });

  el('merge-btn').addEventListener('click', async () => {
    hideError('error-box');
    el('result').hidden = true;
    setBusy('merge-btn', true, 'Joining…');
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the busy state paint
      const fadeSec = Number(el<HTMLInputElement>('fade-slider').value);
      const targetRate = Math.max(...clips.map((c) => c.sampleRate));
      const chanCount = Math.max(...clips.map((c) => c.channels.length));

      // Resample every clip to the common rate/channel count (pure math).
      const prepared = clips.map((clip) => {
        const resampled = clip.channels.map((c) =>
          clip.sampleRate === targetRate ? c : resampleLinear(c, clip.sampleRate, targetRate)
        );
        while (resampled.length < chanCount) {
          resampled.push(resampled[0]); // mono -> duplicate for stereo targets
        }
        return { ...clip, channels: resampled.slice(0, chanCount) };
      });

      const totalSec = prepared.reduce((a, c) => a + c.channels[0].length / targetRate, 0);
      const offline = new OfflineAudioContext(chanCount, Math.ceil(totalSec * targetRate), targetRate);

      // Schedule each clip back-to-back with a fade-out/fade-in at every join.
      let cursor = 0;
      prepared.forEach((clip, i) => {
        const frames = clip.channels[0].length;
        const dur = frames / targetRate;
        const buf = offline.createBuffer(chanCount, frames, targetRate);
        clip.channels.forEach((c, ch) => buf.copyToChannel(c, ch));
        const src = offline.createBufferSource();
        src.buffer = buf;
        const gain = offline.createGain();
        src.connect(gain).connect(offline.destination);
        const fadeIn = i === 0 ? 0 : Math.min(fadeSec, dur / 2);
        const fadeOut = i === prepared.length - 1 ? 0 : Math.min(fadeSec, dur / 2);
        if (fadeIn > 0) {
          gain.gain.setValueAtTime(0, cursor);
          gain.gain.linearRampToValueAtTime(1, cursor + fadeIn);
        }
        if (fadeOut > 0) {
          gain.gain.setValueAtTime(1, cursor + dur - fadeOut);
          gain.gain.linearRampToValueAtTime(0, cursor + dur);
        }
        src.start(cursor);
        cursor += dur;
      });

      const rendered = await offline.startRendering();
      const outChannels: Float32Array[] = [];
      for (let i = 0; i < rendered.numberOfChannels; i++) {
        outChannels.push(rendered.getChannelData(i).slice());
      }
      const wav = encodeWav(outChannels, targetRate);
      const name = withExtension('merged-audio', 'wav');
      downloadBytes(name, wav, 'audio/wav');
      el('result').hidden = false;
      el('result-info').textContent =
        `${clips.length} clips joined · ${formatTime(totalSec)} · ${formatBytes(wav.length)}` +
        (fadeSec > 0 ? ` · ${fadeSec.toFixed(1)}s fades at each join` : '');
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Joining the clips failed.');
    } finally {
      setBusy('merge-btn', false);
    }
  });

  render();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
