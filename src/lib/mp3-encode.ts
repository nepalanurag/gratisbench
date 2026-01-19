// Client-side MP3 encoding via @breezystack/lamejs (a maintained fork of lamejs
// with a working ES module entry; the original lamejs package's ESM entry is
// broken). Pure logic here — no DOM — so it runs in the Node verification
// script too. The tool pages dynamic-import this module only when the user
// asks for an MP3, keeping it out of the initial page bundle.
import { Mp3Encoder } from '@breezystack/lamejs';
import { resampleLinear, floatToInt16, clamp } from './media-core.ts';

/** Sample rates lamejs can actually encode (MPEG-1, MPEG-2, MPEG-2.5). */
const LAME_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

/** Pick a sample rate lamejs supports; fall back to 44100 Hz. */
export function mp3SafeSampleRate(sampleRate: number): number {
  const sr = Math.round(sampleRate);
  return LAME_SAMPLE_RATES.includes(sr) ? sr : 44100;
}

/**
 * Encode float32 channels (-1..1) as MP3 at the given bitrate (clamped 64-320).
 * Uses the first two channels (mono input stays mono). Resamples only when the
 * source rate is one lamejs cannot encode.
 */
export async function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  kbps = 192
): Promise<Uint8Array> {
  if (channels.length === 0) {
    throw new Error('Nothing to encode: no audio channels.');
  }
  const frames = channels[0].length;
  if (frames === 0) {
    throw new Error('Nothing to encode: the selection is empty.');
  }
  const kb = clamp(Math.round(kbps), 64, 320);
  const targetRate = mp3SafeSampleRate(sampleRate);
  const prepared = channels
    .slice(0, 2)
    .map((c) => (targetRate === Math.round(sampleRate) ? c : resampleLinear(c, sampleRate, targetRate)))
    .map(floatToInt16);

  const stereo = prepared.length === 2;
  const encoder = new Mp3Encoder(stereo ? 2 : 1, targetRate, kb);
  const BLOCK = 1152; // one MP3 frame's worth of samples per channel
  const parts: Int8Array[] = [];
  const total = prepared[0].length;
  for (let i = 0; i < total; i += BLOCK) {
    const left = prepared[0].subarray(i, i + BLOCK);
    const chunk = stereo
      ? encoder.encodeBuffer(left, prepared[1].subarray(i, i + BLOCK))
      : encoder.encodeBuffer(left);
    if (chunk.length > 0) parts.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);

  const bytes = parts.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(bytes);
  let o = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.length), o);
    o += p.length;
  }
  return out;
}
