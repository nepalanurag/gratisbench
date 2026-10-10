// ISNet background removal: direct onnxruntime-web wrapper.
// 85MB FP16 model (imgly/isnet-general-onnx), MIT license, general-purpose segmentation.
// Input: 1024x1024, output: 1024x1024 sigmoid mask. Proven in browser WASM by
// erase-bg, frogmonster12/background_remover, and cutlybg.
import * as ort from 'onnxruntime-web';

// Model is hosted on truepdf-models repo (separate Vercel project for large assets).
// This keeps TruePDF's main repo lean and avoids GitHub API size limits.
const MODEL_URL = 'https://truepdf-models.vercel.app/models/isnet_fp16.onnx';
const MODEL_SIZE = 1024;
const INPUT_NAME = 'input';
const OUTPUT_NAME = 'output';

let sessionPromise: Promise<ort.InferenceSession> | null = null;

// Configure WASM paths for onnxruntime-web. The WASM binaries are in public/ort/.
if (typeof window !== 'undefined') {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  ort.env.wasm.wasmPaths = `${base}/ort/`;
}

export interface BgProgress {
  stage: 'downloading' | 'processing';
  progress: number; // 0-1
  message: string;
}

async function loadModel(onProgress?: (p: BgProgress) => void): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      onProgress?.({ stage: 'downloading', progress: 0, message: 'Downloading AI model (85MB)…' });
      // Fetch the model. Use arrayBuffer for simplicity and reliability.
      const resp = await fetch(MODEL_URL);
      if (!resp.ok) throw new Error(`Model download failed: ${resp.status}`);
      const buffer = await resp.arrayBuffer();
      onProgress?.({ stage: 'downloading', progress: 0.9, message: 'Loading model…' });
      const modelData = new Uint8Array(buffer);
      onProgress?.({ stage: 'downloading', progress: 1, message: 'Starting AI engine…' });
      const session = await ort.InferenceSession.create(modelData, {
        executionProviders: ['webgpu', 'wasm'],
      });
      return session;
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/** Preprocess: letterbox to 1024x1024 (aspect-preserving), normalize to [0,1], CHW format. */
async function preprocess(img: HTMLImageElement): Promise<{ tensor: ort.Tensor; w: number; h: number; dx: number; dy: number; dw: number; dh: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create canvas');
  // Letterbox: scale to fit, center, pad with black (ISNet training preprocessing)
  const scale = Math.min(MODEL_SIZE / img.naturalWidth, MODEL_SIZE / img.naturalHeight);
  const dw = Math.round(img.naturalWidth * scale);
  const dh = Math.round(img.naturalHeight * scale);
  const dx = Math.floor((MODEL_SIZE - dw) / 2);
  const dy = Math.floor((MODEL_SIZE - dh) / 2);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
  ctx.drawImage(img, dx, dy, dw, dh);
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
  return { tensor, w: img.naturalWidth, h: img.naturalHeight, dx, dy, dw, dh };
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
    const { tensor, w, h, dx, dy, dw, dh } = await preprocess(img);

    onProgress?.({ stage: 'processing', progress: 0.4, message: 'Removing background…' });
    const feeds = { [INPUT_NAME]: tensor };
    const results = await session.run(feeds);
    // ISNet has a single clean output named 'output', shape [1, 1, 1024, 1024].
    const output = results[OUTPUT_NAME] ?? results[session.outputNames[0]];
    const maskData = output.data as Float32Array;

    onProgress?.({ stage: 'processing', progress: 0.8, message: 'Creating cutout…' });

    // Apply mask to original image using per-pixel mapping (erase-bg approach).
    // Maps each output pixel back to the correct mask sample, accounting for letterbox.
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const octx = outCanvas.getContext('2d');
    if (!octx) throw new Error('Could not create output canvas');
    octx.drawImage(img, 0, 0);
    const outImageData = octx.getImageData(0, 0, w, h);
    const outData = outImageData.data;
    const maskDim = MODEL_SIZE; // 1024
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const maskX = Math.round((x * dw) / w + dx);
        const maskY = Math.round((y * dh) / h + dy);
        const maskIdx = maskY * maskDim + maskX;
        const v = Math.max(0, Math.min(1, maskData[maskIdx] ?? 0));
        const pixelIdx = (y * w + x) * 4;
        outData[pixelIdx + 3] = Math.round(v * 255);
      }
    }
    octx.putImageData(outImageData, 0, 0);

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
// redeploy 1791579227
