// Screen recorder: DOM glue. Captures the screen (getDisplayMedia) with an
// optional microphone track, records with MediaRecorder, previews the result,
// and downloads a WebM. No server, no time cap — the honest limit is the
// device's memory, stated on the page.
import { preferredRecorderMimeTypes, withExtension, formatTime } from '../lib/media-core.ts';
import { el, formatBytes, showError, hideError, setBusy, isMobileDevice } from './common.ts';

export function initScreenRecorder(): void {
  // Screen capture doesn't exist on phones/tablets — say so up front instead
  // of showing the tool and failing when the user clicks.
  if (isMobileDevice() || !navigator.mediaDevices?.getDisplayMedia) {
    const tool = el('recorder-tool');
    const note = el('recorder-unavailable');
    tool.hidden = true;
    note.hidden = false;
    return;
  }

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  // The raw display capture. When webcam compositing is on, the recorded
  // stream carries the canvas track instead, so the display tracks must be
  // stopped separately or the browser keeps showing the sharing indicator.
  let rawDisplay: MediaStream | null = null;  let chunks: Blob[] = [];
  let mimeType = '';
  let startStamp = 0;
  let pausedTotal = 0;
  let pauseStamp = 0;
  let timer: number | null = null;
  let blobUrl: string | null = null;
  // Webcam PiP compositing state.
  let camStream: MediaStream | null = null;
  let drawLoop: number | null = null;
  let compositeCleanup: (() => void) | null = null;

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
    startBtn.disabled = s !== 'idle' && s !== 'done';
    pauseBtn.disabled = s !== 'recording' && s !== 'paused';
    stopBtn.disabled = s !== 'recording' && s !== 'paused';
    pauseBtn.textContent = s === 'paused' ? 'Resume' : 'Pause';
    el<HTMLInputElement>('mic-toggle').disabled = s !== 'idle' && s !== 'done';
    el<HTMLInputElement>('webcam-toggle').disabled = s !== 'idle' && s !== 'done';
    el<HTMLInputElement>('countdown-toggle').disabled = s !== 'idle' && s !== 'done';
    el<HTMLSelectElement>('webcam-corner').disabled = s !== 'idle' && s !== 'done';
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

  el('webcam-toggle').addEventListener('change', () => {
    el('webcam-corner-row').hidden = !el<HTMLInputElement>('webcam-toggle').checked;
  });

  /** Draw a rounded-rect path (falls back to a plain rect where unsupported). */
  function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    }
  }

  /** Build a composited stream: screen full-frame with the webcam inset in a
   *  corner. Returns the stream plus a cleanup function. */
  async function compositeWithWebcam(
    display: MediaStream,
    corner: string,
  ): Promise<{ stream: MediaStream; cleanup: () => void } | null> {
    let cam: MediaStream;
    try {
      cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, facingMode: 'user' },
        audio: false,
      });
    } catch {
      showError('error-box', 'Webcam was blocked, recording the screen only.');
      return null;
    }
    camStream = cam;
    const vTrack = display.getVideoTracks()[0];
    const ds = vTrack.getSettings();
    const W = ds.width || 1280;
    const H = ds.height || 720;
    const cs = cam.getVideoTracks()[0].getSettings();
    const camAspect = (cs.height || 480) / (cs.width || 640);

    const screenVideo = document.createElement('video');
    screenVideo.muted = true;
    screenVideo.srcObject = new MediaStream([vTrack]);
    const camVideo = document.createElement('video');
    camVideo.muted = true;
    camVideo.srcObject = cam;
    await Promise.all([
      screenVideo.play().catch(() => undefined),
      camVideo.play().catch(() => undefined),
    ]);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      cam.getTracks().forEach((t) => t.stop());
      camStream = null;
      return null;
    }
    const pipW = Math.round(W / 4);
    const pipH = Math.round(pipW * camAspect);
    const m = 16;
    const x = corner.includes('right') ? W - pipW - m : m;
    const y = corner.includes('bottom') ? H - pipH - m : m;

    const render = (): void => {
      ctx.drawImage(screenVideo, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRectPath(ctx, x - 5, y - 5, pipW + 10, pipH + 10, 10);
      ctx.fill();
      ctx.save();
      roundRectPath(ctx, x, y, pipW, pipH, 7);
      ctx.clip();
      ctx.drawImage(camVideo, x, y, pipW, pipH);
      ctx.restore();
      drawLoop = requestAnimationFrame(render);
    };
    render();

    const canvasStream = canvas.captureStream(30);
    const cleanup = (): void => {
      if (drawLoop !== null) {
        cancelAnimationFrame(drawLoop);
        drawLoop = null;
      }
      screenVideo.srcObject = null;
      camVideo.srcObject = null;
    };
    return { stream: canvasStream, cleanup };
  }

  function stopCompositing(): void {
    if (drawLoop !== null) {
      cancelAnimationFrame(drawLoop);
      drawLoop = null;
    }
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
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
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    // Set when the user ends sharing from the browser UI before recording
    // starts (e.g. during the countdown).
    let countdownAborted = false;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true, // system audio when the browser offers it
      });
      rawDisplay = display;
      // Stop the whole thing if the user ends sharing from the browser UI.
      display.getVideoTracks()[0]?.addEventListener('ended', () => {
        countdownAborted = true;
        if (recorder && recorder.state !== 'inactive') stopRecording();
      });

      // Optional webcam picture-in-picture: composite screen + webcam on a
      // canvas so the recording (and preview) shows both.
      let videoStream: MediaStream = display;
      if (el<HTMLInputElement>('webcam-toggle').checked) {
        const corner = el<HTMLSelectElement>('webcam-corner').value;
        const comp = await compositeWithWebcam(display, corner);
        if (comp) {
          videoStream = comp.stream;
          compositeCleanup = comp.cleanup;
        }
      }

      const screenAudio = display.getAudioTracks();
      let combined = new MediaStream([...videoStream.getVideoTracks(), ...screenAudio]);
      if (el<HTMLInputElement>('mic-toggle').checked) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          combined = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...screenAudio,
            ...mic.getAudioTracks(),
          ]);
        } catch {
          showError('error-box', 'Microphone was blocked, recording without it.');
        }
      }

      stream = combined;
      preview.srcObject = stream;
      preview.hidden = false;
      preview.muted = true;
      await preview.play().catch(() => undefined);

      chunks = [];
      mimeType = mime;
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = finishRecording;

      // Countdown: a beat to switch to the tab/window being captured, so the
      // recording does not open on the recorder page itself.
      if (el<HTMLInputElement>('countdown-toggle').checked) {
        setBusy('start-btn', true, 'Starting…');
        for (let i = 3; i >= 1; i--) {
          el('rec-status').textContent = `Starting in ${i}… (end sharing in the browser to cancel)`;
          await sleep(1000);
          if (countdownAborted) {
            stream?.getTracks().forEach((t) => t.stop());
            stream = null;
            rawDisplay?.getTracks().forEach((t) => t.stop());
            rawDisplay = null;
            compositeCleanup?.();
            compositeCleanup = null;
            stopCompositing();
            preview.srcObject = null;
            preview.hidden = true;
            el('rec-status').textContent = 'Recording cancelled.';
            setState('idle');
            return;
          }
        }
      }
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
    // Stop the PiP compositor (rAF loop + webcam tracks) if it was running.
    compositeCleanup?.();
    compositeCleanup = null;
    stopCompositing();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    rawDisplay?.getTracks().forEach((t) => t.stop());
    rawDisplay = null;
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
    // The recorded format can be mp4 on Safari; label the button with what it is.
    el<HTMLButtonElement>('download-btn').textContent = type.includes('mp4')
      ? 'Download MP4'
      : 'Download WebM';
    el<HTMLButtonElement>('download-btn').onclick = () => downloadBlob();
    setState('done');
  }

  function downloadBlob(): void {
    if (!blobUrl) return;
    const type = mimeType.split(';')[0] || 'video/webm';
    // The recorded MIME can be mp4 on Safari; name the file to match what it is.
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = withExtension('screen-recording', ext);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  setState('idle');
}
