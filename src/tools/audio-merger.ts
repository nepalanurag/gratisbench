// Audio merger: DOM glue. Clips are decoded with Web Audio, resampled to a
// common rate with the pure resampleLinear helper, concatenated in an
// OfflineAudioContext with a linear fade-out/fade-in at each join, and the
// render is encoded as WAV (pure encodeWav helper) or MP3 (lamejs), per the
// user's format choice.
import {
  formatTime,
  resampleLinear,
  encodeWav,
  withExtension,
} from '../lib/media-core.ts';
import { encodeMp3 } from '../lib/mp3-encode.ts';
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
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  duration: number;
}

export function initAudioMerger(): void {
  const clips: Clip[] = [];
  const list = el('file-list');
  const empty = el('empty-state');
  let audioCtx: AudioContext | null = null;
  // Drag-to-reorder state: index of the row being dragged.
  let dragIndex: number | null = null;

  function getCtx(): AudioContext {
    if (!audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AC();
    }
    return audioCtx;
  }

  function render(): void {
    empty.hidden = clips.length > 0;
    list.innerHTML = '';
    clips.forEach((clip, i) => {
      const row = document.createElement('li');
      row.className = 'file-row';
      row.draggable = true;
      row.dataset.i = String(i);
      row.title = 'Drag to reorder';
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

  /** Drag-to-reorder: whole rows are draggable (the buttons opt out). Drop
   *  position is decided by which half of the target row the pointer is in. */
  list.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest('li.file-row');
    if (!row || (e.target as HTMLElement).closest('button')) {
      e.preventDefault();
      return;
    }
    dragIndex = Number((row as HTMLElement).dataset.i);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(dragIndex));
      } catch {
        /* dataTransfer optional in some browsers */
      }
    }
  });
  list.addEventListener('dragover', (e) => {
    const row = (e.target as HTMLElement).closest('li.file-row');
    if (!row || dragIndex === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    list.querySelectorAll('.file-row').forEach((r) => {
      (r as HTMLElement).style.boxShadow = '';
    });
    const rect = row.getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    (row as HTMLElement).style.boxShadow = after
      ? '0 3px 0 0 #b3242c'
      : '0 -3px 0 0 #b3242c';
  });
  list.addEventListener('drop', (e) => {
    const row = (e.target as HTMLElement).closest('li.file-row');
    if (!row || dragIndex === null) return;
    e.preventDefault();
    const from = dragIndex;
    const rect = row.getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    let to = Number((row as HTMLElement).dataset.i) + (after ? 1 : 0);
    const [moved] = clips.splice(from, 1);
    if (from < to) to -= 1;
    clips.splice(to, 0, moved);
    dragIndex = null;
    render();
  });
  list.addEventListener('dragend', () => {
    dragIndex = null;
    list.querySelectorAll('.file-row').forEach((r) => {
      (r as HTMLElement).style.boxShadow = '';
    });
  });
  list.addEventListener('dragleave', () => {
    list.querySelectorAll('.file-row').forEach((r) => {
      (r as HTMLElement).style.boxShadow = '';
    });
  });

  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    for (const file of files) {
      try {
        const bytes = await file.arrayBuffer();
        const decoded = await getCtx().decodeAudioData(bytes);
        const channels: Float32Array<ArrayBuffer>[] = [];
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

  function joinStyle(): 'crossfade' | 'fade' {
    return document.querySelector<HTMLInputElement>('input[name="join-style"]:checked')?.value === 'fade'
      ? 'fade'
      : 'crossfade';
  }

  function updateJoinHint(): void {
    el('fade-hint').textContent =
      joinStyle() === 'crossfade'
        ? 'How long the clips overlap at each join. Half a second blends smoothly; longer overlaps sound DJ-style. Zero means a hard cut.'
        : 'Each join fades the outgoing clip out and the incoming clip in, dipping briefly toward quiet. Zero means a hard cut.';
  }
  document.querySelectorAll('input[name="join-style"]').forEach((r) => {
    r.addEventListener('change', updateJoinHint);
  });
  updateJoinHint();

  /** Equal-power fade curve (cosine): the pro crossfade shape, so the blend
   *  never sounds like it dips in the middle. `up` fades in, else fades out. */
  function eqPowerCurve(n: number, up: boolean): Float32Array {
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 1 : i / (n - 1);
      curve[i] = up ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2);
    }
    return curve;
  }

  // Remember the output format between visits.
  const fmtKey = 'truepdf:audio-merger:out-format';
  const fmtRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="out-format"]'));
  try {
    const stored = localStorage.getItem(fmtKey);
    if (stored === 'mp3' || stored === 'wav') {
      fmtRadios.forEach((r) => {
        r.checked = r.value === stored;
      });
    }
  } catch {
    /* localStorage unavailable — keep the default */
  }
  fmtRadios.forEach((r) =>
    r.addEventListener('change', () => {
      try {
        localStorage.setItem(fmtKey, r.value);
      } catch {
        /* ignore quota errors */
      }
    })
  );

  el('merge-btn').addEventListener('click', async () => {
    hideError('error-box');
    el('result').hidden = true;
    setBusy('merge-btn', true, 'Joining…');
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the busy state paint
      const fadeSec = Number(el<HTMLInputElement>('fade-slider').value);
      const style = joinStyle();
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

      const durs = prepared.map((c) => c.channels[0].length / targetRate);
      // Crossfade overlaps each join; fade-to-quiet keeps clips back-to-back.
      const overlaps: number[] = durs.slice(0, -1).map((d, i) =>
        style === 'crossfade' ? Math.min(fadeSec, d / 2, durs[i + 1] / 2) : 0
      );
      const totalSec = durs.reduce((a, d) => a + d, 0) - overlaps.reduce((a, o) => a + o, 0);
      const offline = new OfflineAudioContext(chanCount, Math.ceil(totalSec * targetRate), targetRate);

      // Schedule each clip, overlapping by the crossfade length where set.
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
        const fadeIn = i === 0 ? 0 : style === 'crossfade' ? overlaps[i - 1] : Math.min(fadeSec, dur / 2);
        const fadeOut = i === prepared.length - 1 ? 0 : style === 'crossfade' ? overlaps[i] : Math.min(fadeSec, dur / 2);
        if (style === 'crossfade') {
          // Equal-power curves so the blend holds its level through the join.
          if (fadeIn > 0) gain.gain.setValueCurveAtTime(eqPowerCurve(64, true), cursor, fadeIn);
          if (fadeOut > 0) gain.gain.setValueCurveAtTime(eqPowerCurve(64, false), cursor + dur - fadeOut, fadeOut);
        } else {
          if (fadeIn > 0) {
            gain.gain.setValueAtTime(0, cursor);
            gain.gain.linearRampToValueAtTime(1, cursor + fadeIn);
          }
          if (fadeOut > 0) {
            gain.gain.setValueAtTime(1, cursor + dur - fadeOut);
            gain.gain.linearRampToValueAtTime(0, cursor + dur);
          }
        }
        src.start(cursor);
        cursor += dur - (i < overlaps.length ? overlaps[i] : 0);
      });

      const rendered = await offline.startRendering();
      const outChannels: Float32Array[] = [];
      for (let i = 0; i < rendered.numberOfChannels; i++) {
        outChannels.push(rendered.getChannelData(i).slice());
      }
      const asMp3 = document.querySelector<HTMLInputElement>('input[name="out-format"]:checked')?.value === 'mp3';
      const fadeNote =
        fadeSec > 0
          ? style === 'crossfade'
            ? ` · ${fadeSec.toFixed(1)}s crossfade at each join`
            : ` · ${fadeSec.toFixed(1)}s fades at each join`
          : '';
      if (asMp3) {
        const mp3 = await encodeMp3(outChannels, targetRate, 192);
        const name = withExtension('merged-audio', 'mp3');
        downloadBytes(name, mp3, 'audio/mpeg');
        el('result').hidden = false;
        el('result-info').textContent =
          `${clips.length} clips joined · ${formatTime(totalSec)} · ${formatBytes(mp3.length)} · MP3 192 kbps` + fadeNote;
      } else {
        const wav = encodeWav(outChannels, targetRate);
        const name = withExtension('merged-audio', 'wav');
        downloadBytes(name, wav, 'audio/wav');
        el('result').hidden = false;
        el('result-info').textContent =
          `${clips.length} clips joined · ${formatTime(totalSec)} · ${formatBytes(wav.length)}` + fadeNote;
      }
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
