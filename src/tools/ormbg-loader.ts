// BiRefNet Lite background removal: direct onnxruntime-web wrapper.
// Browser-compatible 512x512 export (studioludens/birefnet-lite-512), MIT license.
// Input: 512x512 RGB with ImageNet normalization. Output: logits (apply sigmoid).
// Proven in browser by bg0 and Repper.
import * as ort from 'onnxruntime-web';

// Model hosted on HuggingFace (CORS-enabled). Browser-compatible export.
const MODEL_URL = 'https://huggingface.co/studioludens/birefnet-lite-512/resolve/main/onnx/model_fp16.onnx';
const MODEL_SIZE = 512;
const INPUT_NAME = 'input_image';

let sessionPromise: Promise<ort.InferenceSession> | null = null;

// Configure WASM paths for onnxruntime-web. The WASM binaries are in public/ort/.
if (typeof window !== 'undefined') {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  ort.env.wasm.wasmPaths = {
    wasm: `${base}/ort/ort-wasm-simd-threaded.jsep.wasm`,
  };
  // Fix WASM multi-threading tensor corruption bug (affects Swin transformer models).
  // Forces single-threaded execution - slower but produces correct output.
  ort.env.wasm.numThreads = 1;
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

export function preloadBackgroundRemoval(): Promise<ort.InferenceSession> {
  return loadModel();
}

/** Preprocess to the square size expected by the model's ViT feature extractor. */
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
  // BiRefNet expects RGB with ImageNet mean/std normalization
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    float32[i] = (r - 0.485) / 0.229; // R
    float32[n + i] = (g - 0.456) / 0.224; // G
    float32[2 * n + i] = (b - 0.406) / 0.225; // B
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
    // Use the session's actual input name (U2Netp uses 'input.1', ISNet uses 'input')
    const feeds = { [session.inputNames[0]]: tensor };
    const results = await session.run(feeds);
    const output = results[session.outputNames[0]];
    const maskData = output.data as Float32Array;
    // Get actual mask dimensions from the tensor shape (don't assume 1024)
    const dims = output.dims as number[];
    const maskH = dims[dims.length - 2];
    const maskW = dims[dims.length - 1];

    onProgress?.({ stage: 'processing', progress: 0.8, message: 'Creating cutout…' });

    // Apply mask to original image: crop padding from mask, then resize to original.
    // (Symmetrical to the letterbox preprocessing - fixes aspect ratio mismatch.)
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const octx = outCanvas.getContext('2d');
    if (!octx) throw new Error('Could not create output canvas');
    octx.drawImage(img, 0, 0);
    
    // Create mask canvas from model output (apply sigmoid to logits)
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskW;
    maskCanvas.height = maskH;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) throw new Error('Could not create mask canvas');
    const maskImageData = mctx.createImageData(maskW, maskH);
    const maskPixels = maskImageData.data;
    for (let i = 0; i < maskW * maskH; i++) {
      const logit = maskData[i] ?? 0;
      const v = 1 / (1 + Math.exp(-logit));
      const val = Math.round(v * 255);
      maskPixels[i * 4] = val;
      maskPixels[i * 4 + 1] = val;
      maskPixels[i * 4 + 2] = val;
      maskPixels[i * 4 + 3] = 255;
    }
    mctx.putImageData(maskImageData, 0, 0);
    
    // Resize the model's square mask back to the original image dimensions.
    const resizedMaskCanvas = document.createElement('canvas');
    resizedMaskCanvas.width = w;
    resizedMaskCanvas.height = h;
    const rctx = resizedMaskCanvas.getContext('2d');
    if (!rctx) throw new Error('Could not create resized mask canvas');
    rctx.drawImage(maskCanvas, 0, 0, maskW, maskH, 0, 0, w, h);
    const resizedMaskData = rctx.getImageData(0, 0, w, h).data;
    
    // Apply as alpha
    const outImageData = octx.getImageData(0, 0, w, h);
    const outData = outImageData.data;
    for (let i = 0; i < w * h; i++) {
      outData[i * 4 + 3] = resizedMaskData[i * 4]; // grayscale, use red channel
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
