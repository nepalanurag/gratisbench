// MediaBunny-based fast video encoding (WebCodecs).
//
// This is the primary path for video compression/conversion on browsers with
// WebCodecs support (~95% of browsers as of 2026). It uses the device's
// hardware video encoder — 10-50x faster than ffmpeg.wasm for the common
// MP4-in → MP4-out case.
//
// The existing ffmpeg.wasm code (ffmpeg-loader.ts) is kept as a fallback for
// browsers without WebCodecs and for exotic formats/filters WebCodecs can't
// handle. That fallback is frozen: all new video work goes here.
//
// MediaBunny is dynamically imported so the library (~700KB tree-shaken)
// only downloads when a video tool actually needs it.

export interface FastEncodeOptions {
  /** Target video bitrate in kbps (e.g. from estimateVideoBitrateKbps). */
  videoBitrateKbps: number;
  /** Target audio bitrate in kbps. Default 128. */
  audioBitrateKbps?: number;
  /** Prefer the hardware encoder when the browser has one. Default true. */
  preferHardware?: boolean;
  /** Progress callback: 0-1 fraction complete. */
  onProgress?: (progress: number) => void;
}

export interface FastConvertOptions {
  /** Output container. Only 'mp4' and 'mov' use the fast path (H.264). */
  format: 'mp4' | 'mov';
  /** Drop the audio track entirely. */
  mute?: boolean;
  /** Prefer the hardware encoder when the browser has one. Default true. */
  preferHardware?: boolean;
  /** Progress callback: 0-1 fraction complete. */
  onProgress?: (progress: number) => void;
}

/**
 * Convert a video file to MP4/MOV (H.264 + AAC) using WebCodecs.
 * Quality is set to high — this is for format conversion, not compression
 * (use compressVideoFast for target-size work).
 * Throws on failure — callers should fall back to ffmpeg.wasm.
 */
export async function convertVideoFast(
  file: File,
  opts: FastConvertOptions
): Promise<Blob> {
  const mb = await loadMediaBunny();

  const input = new mb.Input({
    source: new mb.BlobSource(file),
    formats: mb.ALL_FORMATS,
  });
  const output = new mb.Output({
    format: opts.format === 'mov'
      ? new mb.MovOutputFormat()
      : new mb.Mp4OutputFormat({ fastStart: 'fragmented' }),
    target: new mb.BufferTarget(),
  });

  const conversion = await mb.Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: {
      codec: 'avc',
      quality: new mb.Quality('high'),
      hardwareAcceleration: opts.preferHardware === false ? 'no-preference' : 'prefer-hardware',
      forceTranscode: true,
    },
    audio: opts.mute
      ? { discard: true }
      : {
          codec: 'aac',
          quality: new mb.Quality({ bitrate: 128_000 }),
          forceTranscode: true,
        },
    showWarnings: false,
  });

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((t) => t.reason).join('; ');
    throw new Error(
      `Fast encoder could not handle this file${reasons ? `: ${reasons}` : '.'}`
    );
  }

  if (opts.onProgress) {
    const cb = opts.onProgress;
    conversion.onProgress = (progress: number) => cb(Math.min(1, Math.max(0, progress)));
  }

  await conversion.execute();
  const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buffer) throw new Error('Fast encoder produced no output.');
  const mime = opts.format === 'mov' ? 'video/quicktime' : 'video/mp4';
  return new Blob([buffer as unknown as BlobPart], { type: mime });
}

/**
 * True when the browser can run the fast WebCodecs path.
 * Safari < 26 lacks AudioEncoder, so we also require that for now
 * (the compressor always re-encodes audio).
 */
export function canUseFastPath(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).VideoEncoder !== 'undefined' &&
    typeof (window as any).VideoDecoder !== 'undefined' &&
    typeof (window as any).AudioEncoder !== 'undefined' &&
    typeof (window as any).AudioDecoder !== 'undefined'
  );
}

let mediabunnyPromise: Promise<typeof import('mediabunny')> | null = null;

function loadMediaBunny(): Promise<typeof import('mediabunny')> {
  if (!mediabunnyPromise) {
    mediabunnyPromise = import('mediabunny');
  }
  return mediabunnyPromise;
}

/**
 * Compress a video file to a target bitrate using WebCodecs via MediaBunny.
 * Returns an MP4 Blob. Throws on failure — callers should fall back to
 * ffmpeg.wasm when this rejects.
 */
export async function compressVideoFast(
  file: File,
  opts: FastEncodeOptions
): Promise<Blob> {
  const mb = await loadMediaBunny();
  const audioBitrateKbps = opts.audioBitrateKbps ?? 128;

  const input = new mb.Input({
    source: new mb.BlobSource(file),
    formats: mb.ALL_FORMATS,
  });
  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: 'fragmented' }),
    target: new mb.BufferTarget(),
  });

  const conversion = await mb.Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: {
      codec: 'avc',
      quality: new mb.Quality({
        bitrate: opts.videoBitrateKbps * 1000,
        bitrateMode: 'variable',
      }),
      hardwareAcceleration: opts.preferHardware === false ? 'no-preference' : 'prefer-hardware',
      forceTranscode: true,
    },
    audio: {
      codec: 'aac',
      quality: new mb.Quality({ bitrate: audioBitrateKbps * 1000 }),
      forceTranscode: true,
    },
    showWarnings: false,
  });

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((t) => t.reason).join('; ');
    throw new Error(
      `Fast encoder could not handle this file${reasons ? `: ${reasons}` : '.'}`
    );
  }

  if (opts.onProgress) {
    const cb = opts.onProgress;
    conversion.onProgress = (progress: number) => cb(Math.min(1, Math.max(0, progress)));
  }

  await conversion.execute();
  const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buffer) throw new Error('Fast encoder produced no output.');
  return new Blob([buffer as unknown as BlobPart], { type: 'video/mp4' });
}
