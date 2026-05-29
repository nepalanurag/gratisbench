// Screen recorder: DOM glue. Captures the screen (getDisplayMedia) with an
// optional microphone track, records with MediaRecorder, previews the result,
// and downloads a WebM. No server, no time cap — the honest limit is the
// device's memory, stated on the page.
import { preferredRecorderMimeTypes, withExtension, formatTime } from '../lib/media-core.ts';
import { el, formatBytes, showError, hideError, setBusy } from './common.ts';

export function initScreenRecorder(): void {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let mimeType = '';
  let startStamp = 0;
  let pausedTotal = 0;
  let pauseStamp = 0;
  let timer: number | null = null;
  let blobUrl: string | null = null;

  const startBtn = el<HTMLButtonElement>('start-btn');
  const pauseBtn = el<HTMLButtonElement>('pause-btn');
  const stopBtn = el<HTMLButtonElement>('stop-btn');
  const preview = el<HTMLVideoElement>('preview');

  function pickMime(): string | null {
    for (const t of preferredRecorderMimeTypes()) {
      try {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function tick(): void {
    const elapsed = Date.now() - startStamp - pausedTotal - (pauseStamp ? Date.now() - pauseStamp : 0);
    el('rec-timer').textContent = formatTime(Math.max(0, elapsed / 1000));
  }

  function stopTimer(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function setState(s: 'idle' | 'recording' | 'paused' | 'done'): void {
    startBtn.disabled = s !== 'idle';
    pauseBtn.disabled = s !== 'recording' && s !== 'paused';
    stopBtn.disabled = s !== 'recording' && s !== 'paused';
    pauseBtn.textContent = s === 'paused' ? 'Resume' : 'Pause';
    el('mic-toggle').disabled = s !== 'idle';
    const dot = el('rec-dot');
    dot.hidden = s !== 'recording';
    el('rec-status').textContent =
      s === 'recording'
        ? 'Recording…'
        : s === 'paused'
          ? 'Paused.'
          : s === 'done'
            ? 'Recording finished.'
            : 'Choose your options, then start recording.';
  }

  startBtn.addEventListener('click', async () => {
    hideError('error-box');
    el('result').hidden = true;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showError('error-box', 'This browser cannot capture the screen. Try Chrome or Edge on a desktop.');
      return;
    }
    const mime = pickMime();
    if (!mime) {
      showError('error-box', 'This browser cannot record video in a supported format.');
      return;
    }
    setBusy('start-btn', true, 'Asking for the screen…');
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true, // system audio when the browser offers it
      });
      // Stop the whole thing if the user ends sharing from the browser UI.
      display.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder && recorder.state !== 'inactive') stopRecording();
      });

      let combined = display;
      if (el<HTMLInputElement>('mic-toggle').checked) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          combined = new MediaStream([...display.getTracks(), ...mic.getAudioTracks()]);
        } catch {
          showError('error-box', 'Microphone was blocked, recording without it.');
        }
      }

      stream = combined;
      preview.srcObject = stream;
      preview.muted = true;
      await preview.play().catch(() => undefined);

      chunks = [];
      mimeType = mime;
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = finishRecording;
      recorder.start(1000); // 1s slices so a crash still leaves most of the recording

      startStamp = Date.now();
      pausedTotal = 0;
      pauseStamp = 0;
      timer = window.setInterval(tick, 250);
      tick();
      setState('recording');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/notallowed|permission|denied/i.test(msg)) {
        showError('error-box', 'Screen capture was cancelled. Click start and choose what to share.');
      } else {
        showError('error-box', 'Could not start recording: ' + msg);
      }
      setState('idle');
    } finally {
      setBusy('start-btn', false);
    }
  });

  pauseBtn.addEventListener('click', () => {
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      pauseStamp = Date.now();
      setState('paused');
    } else if (recorder.state === 'paused') {
      recorder.resume();
      pausedTotal += Date.now() - pauseStamp;
      pauseStamp = 0;
      setState('recording');
    }
  });

  stopBtn.addEventListener('click', () => stopRecording());

  function stopRecording(): void {
    if (!recorder || recorder.state === 'inactive') return;
    if (recorder.state === 'paused') {
      pausedTotal += Date.now() - pauseStamp;
      pauseStamp = 0;
    }
    recorder.stop();
  }

  function finishRecording(): void {
    stopTimer();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    preview.srcObject = null;
    const type = mimeType.split(';')[0] || 'video/webm';
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);
    preview.src = blobUrl;
    preview.muted = false;
    preview.controls = true;
    el('result').hidden = false;
    el('result-info').textContent = `Recording · ${formatBytes(blob.size)} · ${el('rec-timer').textContent}`;
    el<HTMLButtonElement>('download-btn').onclick = () => downloadBlob();
    setState('done');
  }

  function downloadBlob(): void {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = withExtension('screen-recording', 'webm');
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  setState('idle');
}
