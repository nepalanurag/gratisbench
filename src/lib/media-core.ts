// Pure media logic shared by the browser media tools and the Node verification script.
// No DOM access here — everything takes typed arrays / numbers / strings in and
// returns plain values or Uint8Array out.

/** Clamp n into [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Format seconds as m:ss.d (tenths), e.g. 75.25 -> "1:15.3".
 * Rounds to the nearest tenth of a second.
 */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) {
    throw new Error('Time must be a non-negative number of seconds.');
  }
  const tenths = Math.round(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const d = tenths % 10;
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

/**
 * Parse a time expression into seconds. Accepts:
 *   "90"        -> 90
 *   "1:30"      -> 90
 *   "1:30.5"    -> 90.5
 *   "0:05.25"   -> 5.25
 * Throws a human-readable error for anything it cannot understand.
 */
export function parseTimeInput(input: string): number {
  const raw = input.trim();
  if (raw.length === 0) {
    throw new Error('Enter a time, for example "90" or "1:30".');
  }
  const plain = raw.match(/^(\d+(?:\.\d+)?)$/);
  if (plain) {
    const v = parseFloat(plain[1]);
    if (!Number.isFinite(v)) throw new Error(`Could not understand "${input}".`);
    return v;
  }
  const clock = raw.match(/^(\d+):([0-5]?\d)(?:\.(\d{1,3}))?$/);
  if (clock) {
    const minutes = parseInt(clock[1], 10);
    const seconds = parseInt(clock[2], 10);
    const frac = clock[3] ? parseInt(clock[3].padEnd(3, '0'), 10) / 1000 : 0;
    return minutes * 60 + seconds + frac;
  }
  throw new Error(
    `Could not understand "${input}". Use seconds like "90" or minutes:seconds like "1:30".`
  );
}

/**
 * Estimate the video bitrate (kbps) needed to hit a target file size:
 *   total bitrate = targetBytes * 8 / duration, minus the audio bitrate.
 * Floor of 100 kbps keeps the encoder from producing unwatchable mush.
 * Throws when the duration is not a positive finite number.
 */
export function estimateVideoBitrateKbps(
  targetBytes: number,
  durationSec: number,
  audioKbps = 128
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('Need a valid duration to estimate the bitrate.');
  }
  if (!Number.isFinite(targetBytes) || targetBytes <= 0) {
    throw new Error('Target size must be positive.');
  }
  const totalKbps = (targetBytes * 8) / durationSec / 1000;
  return Math.max(100, Math.floor(totalKbps - audioKbps));
}

/** Megabytes -> bytes, for the compressor target-size math. */
export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

/**
 * Encode one or more Float32 channels (range -1..1) as 16-bit PCM WAV.
 * Returns the complete file bytes with a valid RIFF header.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  if (channels.length === 0) {
    throw new Error('Nothing to encode: no audio channels.');
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('Sample rate must be a positive integer.');
  }
  const frames = channels[0].length;
  for (const c of channels) {
    if (c.length !== frames) throw new Error('All channels must have the same length.');
  }
  if (frames === 0) {
    throw new Error('Nothing to encode: the selection is empty.');
  }

  const numChannels = channels.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLen = frames * blockAlign;
  const out = new Uint8Array(44 + dataLen);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataLen, true);

  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const v = clamp(channels[c][f], -1, 1);
      view.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
  }
  return out;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  sampleCount: number; // frames per channel
  dataOffset: number;
}

/** Parse the RIFF header of WAV bytes produced by encodeWav. Throws on garbage. */
export function parseWavHeader(bytes: Uint8Array): WavInfo {
  if (bytes.length < 44) {
    throw new Error('Not a WAV file: too short for a header.');
  }
  const ascii = (offset: number, len: number) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]);
    return s;
  };
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE' || ascii(12, 4) !== 'fmt ') {
    throw new Error('Not a WAV file: bad RIFF header.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  if (audioFormat !== 1 || bitsPerSample !== 16) {
    throw new Error('Not a WAV file: expected 16-bit PCM.');
  }
  // 'data' chunk is at 36 in files we produce (no extra chunks).
  if (ascii(36, 4) !== 'data') {
    throw new Error('Not a WAV file: missing data chunk.');
  }
  const dataLen = view.getUint32(40, true);
  const sampleCount = dataLen / (channels * (bitsPerSample / 8));
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new Error('Not a WAV file: invalid data length.');
  }
  return { sampleRate, channels, bitsPerSample, sampleCount, dataOffset: 44 };
}

/** Read one decoded sample (float -1..1) from WAV bytes made by encodeWav. */
export function readWavSample(bytes: Uint8Array, info: WavInfo, frame: number, channel: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = info.dataOffset + (frame * info.channels + channel) * 2;
  return view.getInt16(offset, true) / 32767;
}

/** Convert float samples (-1..1) to int16, clamping out-of-range values. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.round(clamp(samples[i], -1, 1) * 32767);
  }
  return out;
}

/**
 * Linear resampling between sample rates. Returns a copy when the rates match.
 * Good enough for MP3 encoding prep; not studio-grade.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input.slice();
  if (fromRate <= 0 || toRate <= 0) {
    throw new Error('Sample rates must be positive.');
  }
  if (input.length === 0) return new Float32Array(0);
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const ratio = (input.length - 1) / (outLen - 1 || 1);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(input.length - 1, lo + 1);
    out[i] = input[lo] + (input[hi] - input[lo]) * (pos - lo);
  }
  return out;
}

/**
 * Peak-per-bucket waveform data for drawing. Returns `buckets` values in 0..1,
 * normalized so the loudest bucket is 1. All zeros when the input is silent.
 */
export function computePeaks(channel: Float32Array, buckets: number): Float32Array {
  if (!Number.isInteger(buckets) || buckets < 1) {
    throw new Error('Need at least one waveform bucket.');
  }
  const peaks = new Float32Array(buckets);
  if (channel.length === 0) return peaks;
  const per = channel.length / buckets;
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.max(start + 1, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = start; i < end && i < channel.length; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) {
    for (let b = 0; b < buckets; b++) peaks[b] /= max;
  }
  return peaks;
}

/** Copy [startSample, endSample) out of each channel. Sample indices are clamped. */
export function sliceChannels(
  channels: Float32Array[],
  startSample: number,
  endSample: number
): Float32Array[] {
  const frames = channels.length > 0 ? channels[0].length : 0;
  const s = clamp(Math.floor(startSample), 0, frames);
  const e = clamp(Math.ceil(endSample), 0, frames);
  if (e <= s) {
    throw new Error('The selection is empty. Pick a start before the end.');
  }
  return channels.map((c) => c.slice(s, e));
}

export interface TrimRange {
  start: number;
  end: number;
}

/**
 * Validate a trim range against the media duration. Returns the range as-is
 * when valid; throws a human-readable error otherwise.
 */
export function validateTrimRange(start: number, end: number, duration: number): TrimRange {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(duration)) {
    throw new Error('Start, end, and duration must all be numbers.');
  }
  if (duration <= 0) {
    throw new Error('Could not read the length of that file.');
  }
  if (start < 0) {
    throw new Error('The start time cannot be negative.');
  }
  if (end > duration) {
    throw new Error(`The end time is past the end of the file (${formatTime(duration)}).`);
  }
  if (end <= start) {
    throw new Error('The end time must be after the start time.');
  }
  if (end - start < 0.05) {
    throw new Error('The selection is too short. Keep at least a twentieth of a second.');
  }
  return { start, end };
}

/** File name without its last extension; falls back to 'audio' for dotfiles. */
export function stemOf(filename: string): string {
  const base = filename.split('/').pop()!.split('\\').pop()!;
  const dot = base.lastIndexOf('.');
  // A leading dot (".mp3") is an extension with no stem, not a stem.
  const stem = dot > 0 ? base.slice(0, dot) : dot === 0 ? '' : base;
  return stem.length > 0 ? stem : 'audio';
}

/** Replace (or add) the extension of a file name. */
export function withExtension(filename: string, ext: string): string {
  const clean = ext.replace(/^\./, '');
  return `${stemOf(filename)}.${clean}`;
}

/**
 * Recorder MIME types in preference order. The tool picks the first one the
 * browser reports as supported via MediaRecorder.isTypeSupported().
 */
export function preferredRecorderMimeTypes(): string[] {
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
}
