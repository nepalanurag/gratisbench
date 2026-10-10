// U2Netp background removal: direct onnxruntime-web wrapper.
// 4.7MB model, MIT license. Smaller and simpler than ISNet, better WASM support.
// Input: 320x320, output: 320x320 sigmoid mask.
import * as ort from 'onnxruntime-web';

// Model is hosted on truepdf-models repo (separate Vercel project for large assets).
// This keeps TruePDF's main repo lean and avoids GitHub API size limits.
const MODEL_URL = 'https://truepdf-models.vercel.app/models/u2netp.onnx';
const MODEL_SIZE = 320;
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
  // U2Net expects BGR with ImageNet mean/std normalization (not RGB [0,1])
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    float32[i] = (b - 0.406) / 0.225; // B
    float32[n + i] = (g - 0.456) / 0.224; // G
    float32[2 * n + i] = (r - 0.485) / 0.229; // R
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
    // Use the session's actual input name (U2Netp uses 'input.1', ISNet uses 'input')
    const feeds = { [session.inputNames[0]]: tensor };
    const results = await session.run(feeds);
    // ISNet has a single clean output named 'output', shape [1, 1, 1024, 1024].
    const output = results[OUTPUT_NAME] ?? results[session.outputNames[0]];
    const maskData = output.data as Float32Array;
    // Get actual mask dimensions from the tensor shape (don't assume 1024)
    const dims = output.dims as number[];
    const maskH = dims[dims.length - 2];
    const maskW = dims[dims.length - 1];

    onProgress?.({ stage: 'processing', progress: 0.8, message: 'Creating cutout…' });

    // Apply mask to original image using per-pixel mapping (erase-bg approach).
    // Maps each output pixel back to the correct mask sample, accounting for letterbox.
    // Note: mask is in letterboxed 1024x1024 space, but actual dims may differ.
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const octx = outCanvas.getContext('2d');
    if (!octx) throw new Error('Could not create output canvas');
    octx.drawImage(img, 0, 0);
    const outImageData = octx.getImageData(0, 0, w, h);
    const outData = outImageData.data;
    // Scale letterbox geometry to actual mask dimensions
    const sx = maskW / MODEL_SIZE;
    const sy = maskH / MODEL_SIZE;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const maskX = Math.min(maskW - 1, Math.round(((x * dw) / w + dx) * sx));
        const maskY = Math.min(maskH - 1, Math.round(((y * dh) / h + dy) * sy));
        const maskIdx = maskY * maskW + maskX;
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
