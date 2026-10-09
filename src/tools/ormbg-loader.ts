// U2Netp background removal: direct onnxruntime-web wrapper.
// 4.6MB model (vs 43MB ORMBG), Apache-2.0, general salient object detection.
// Input: 320x320, output: 320x320 sigmoid mask.
import * as ort from 'onnxruntime-web';

// Model is hosted on the site itself (public/models/) to avoid CORS issues.
// 4.6MB, downloaded once and cached by the browser.
const MODEL_URL = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/models/u2netp.onnx`;
const MODEL_SIZE = 320;
const INPUT_NAME = 'input.1';

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
      onProgress?.({ stage: 'downloading', progress: 0, message: 'Downloading AI model (5MB)…' });
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
    const feeds = { [INPUT_NAME]: tensor };
    const results = await session.run(feeds);
    // U2Netp has multiple outputs (1959-1965). 1959 is the main segmentation mask.
    // Try 1959 first, then fall back to the output with the most balanced mask.
    let output = null;
    let outputData = null;
    const candidateNames = ['1959', ...session.outputNames];
    for (const name of candidateNames) {
      if (!results[name]) continue;
      const data = results[name].data as Float32Array;
      // Check if this output has reasonable segmentation (not all 0 or all 1)
      let mn = Infinity, mx = -Infinity;
      const sample = Math.min(data.length, 1000);
      for (let i = 0; i < sample; i++) {
        const v = data[Math.floor((i / sample) * data.length)];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx - mn > 0.5) { // Good dynamic range
        output = results[name];
        outputData = data;
        break;
      }
    }
    if (!output || !outputData) {
      // Fall back to first output
      const name = session.outputNames[0];
      output = results[name];
      outputData = output.data as Float32Array;
    }
    const maskData = outputData;

    onProgress?.({ stage: 'processing', progress: 0.8, message: 'Creating cutout…' });

    // Create mask canvas. Handle different output shapes: [1,1,320,320], [1,320,320], or [320,320]
    const maskLen = maskData.length;
    const maskDim = Math.sqrt(maskLen); // Should be 320
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskDim;
    maskCanvas.height = maskDim;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) throw new Error('Could not create mask canvas');
    const maskImage = mctx.createImageData(maskDim, maskDim);
    for (let i = 0; i < maskLen; i++) {
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
