// ORMBG background removal: direct onnxruntime-web wrapper.
// Bypasses buggy wrapper libraries (@imgly, @bg0). Uses the ORMBG model
// (Apache-2.0, 43MB int8) from Hugging Face. Proven working via direct
// ONNX inference tests on 2026-10-08.
import * as ort from 'onnxruntime-web';

const MODEL_URL = 'https://huggingface.co/onnx-community/ormbg-ONNX/resolve/main/onnx/model_int8.onnx';
const MODEL_SIZE = 1024;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

export interface BgProgress {
  stage: 'downloading' | 'processing';
  progress: number; // 0-1
  message: string;
}

async function loadModel(onProgress?: (p: BgProgress) => void): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      onProgress?.({ stage: 'downloading', progress: 0, message: 'Downloading AI model (43MB)…' });
      // Fetch with progress
      const resp = await fetch(MODEL_URL);
      if (!resp.ok) throw new Error(`Model download failed: ${resp.status}`);
      const contentLength = Number(resp.headers.get('content-length') || '44315136');
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('Could not read model download');
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress?.({
          stage: 'downloading',
          progress: received / contentLength,
          message: `Downloading AI model… ${Math.round((received / contentLength) * 100)}%`,
        });
      }
      const modelData = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        modelData.set(chunk, offset);
        offset += chunk.length;
      }
      onProgress?.({ stage: 'downloading', progress: 1, message: 'Loading model…' });
      const session = await ort.InferenceSession.create(modelData, {
        executionProviders: ['wasm'],
      });
      return session;
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/** Preprocess: resize to 1024x1024, normalize to [0,1], CHW format. */
async function preprocess(img: HTMLImageElement): Promise<{ tensor: ort.Tensor; w: number; h: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create canvas');
  ctx.drawImage(img, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const imageData = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
  const data = imageData.data;
  const float32 = new Float32Array(1 * 3 * MODEL_SIZE * MODEL_SIZE);
  const n = MODEL_SIZE * MODEL_SIZE;
  for (let i = 0; i < n; i++) {
    float32[i] = data[i * 4] / 255; // R
    float32[n + i] = data[i * 4 + 1] / 255; // G
    float32[2 * n + i] = data[i * 4 + 2] / 255; // B
  }
  const tensor = new ort.Tensor('float32', float32, [1, 3, MODEL_SIZE, MODEL_SIZE]);
  return { tensor, w: img.naturalWidth, h: img.naturalHeight };
}

/**
 * Remove background from an image file.
 * Returns a transparent PNG Blob.
 */
export async function removeBackgroundOrmBg(
  file: File | Blob,
  onProgress?: (p: BgProgress) => void
): Promise<Blob> {
  const session = await loadModel(onProgress);
  onProgress?.({ stage: 'processing', progress: 0, message: 'Loading image…' });

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });

    onProgress?.({ stage: 'processing', progress: 0.2, message: 'Analyzing image…' });
    const { tensor, w, h } = await preprocess(img);

    onProgress?.({ stage: 'processing', progress: 0.4, message: 'Removing background…' });
    const feeds = { [session.inputNames[0]]: tensor };
    const results = await session.run(feeds);
    const output = results[session.outputNames[0]];
    const maskData = output.data as Float32Array; // 1024x1024, values 0-1

    onProgress?.({ stage: 'processing', progress: 0.8, message: 'Creating cutout…' });

    // Create mask canvas at 1024x1024, then resize to original
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = MODEL_SIZE;
    maskCanvas.height = MODEL_SIZE;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) throw new Error('Could not create mask canvas');
    const maskImage = mctx.createImageData(MODEL_SIZE, MODEL_SIZE);
    for (let i = 0; i < MODEL_SIZE * MODEL_SIZE; i++) {
      const v = Math.max(0, Math.min(1, maskData[i]));
      const a = Math.round(v * 255);
      maskImage.data[i * 4] = a;
      maskImage.data[i * 4 + 1] = a;
      maskImage.data[i * 4 + 2] = a;
      maskImage.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(maskImage, 0, 0);

    // Apply mask to original image
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const octx = outCanvas.getContext('2d');
    if (!octx) throw new Error('Could not create output canvas');
    octx.drawImage(img, 0, 0);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(maskCanvas, 0, 0, w, h);
    octx.globalCompositeOperation = 'source-over';

    onProgress?.({ stage: 'processing', progress: 0.95, message: 'Encoding PNG…' });
    const blob = await new Promise<Blob | null>((resolve) =>
      outCanvas.toBlob(resolve, 'image/png')
    );
    if (!blob) throw new Error('Could not encode PNG');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
