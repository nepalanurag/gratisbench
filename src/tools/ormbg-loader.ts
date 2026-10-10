// Background removal via Transformers.js + RMBG-1.4 (BRIA AI).
// Client-side, runs in Web Worker. Proven to work in browsers.
import { pipeline, RawImage } from '@huggingface/transformers';

export interface BgProgress {
  stage: 'downloading' | 'processing';
  progress: number; // 0-1
  message: string;
}

let segmentatorPromise: Promise<any> | null = null;

async function getSegmentator(onProgress?: (p: BgProgress) => void) {
  if (!segmentatorPromise) {
    onProgress?.({ stage: 'downloading', progress: 0, message: 'Downloading AI model…' });
    segmentatorPromise = pipeline('image-segmentation', 'briaai/RMBG-1.4', {
      progress_callback: (p: any) => {
        if (p.status === 'progress') {
          onProgress?.({
            stage: 'downloading',
            progress: (p.loaded || 0) / (p.total || 1),
            message: `Downloading AI model… ${Math.round(((p.loaded || 0) / (p.total || 1)) * 100)}%`,
          });
        }
      },
    });
  }
  return segmentatorPromise;
}

/**
 * Remove background from an image file.
 * Returns a transparent PNG Blob.
 */
export async function removeBackgroundOrmBg(
  file: File | Blob,
  onProgress?: (p: BgProgress) => void
): Promise<Blob> {
  const segmentator = await getSegmentator(onProgress);
  onProgress?.({ stage: 'processing', progress: 0.5, message: 'Removing background…' });

  const url = URL.createObjectURL(file);
  try {
    const image = await RawImage.fromURL(url);
    const origW = image.width;
    const origH = image.height;
    
    const result = await segmentator(image);
    const mask = result[0].mask as RawImage; // Grayscale mask, may differ in size
    
    // Create canvas at original image size
    const canvas = document.createElement('canvas');
    canvas.width = origW;
    canvas.height = origH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas');
    
    // Draw original image
    const img = await createImageBitmap(file);
    ctx.drawImage(img, 0, 0, origW, origH);
    
    // Get image data
    const imageData = ctx.getImageData(0, 0, origW, origH);
    const data = imageData.data;
    
    // Resize mask to match image dimensions using a temp canvas
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = origW;
    maskCanvas.height = origH;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) throw new Error('Could not create mask canvas');
    
    // Convert RawImage mask to canvas
    // RawImage has .data (Uint8Array), .width, .height
    const maskImageData = maskCtx.createImageData(mask.width, mask.height);
    const maskPixels = maskImageData.data;
    const maskRaw = mask.data as Uint8Array;
    // mask is grayscale, convert to RGBA
    for (let i = 0; i < mask.width * mask.height; i++) {
      const v = maskRaw[i];
      maskPixels[i * 4] = v;
      maskPixels[i * 4 + 1] = v;
      maskPixels[i * 4 + 2] = v;
      maskPixels[i * 4 + 3] = 255;
    }
    maskCtx.putImageData(maskImageData, 0, 0);
    
    // Now draw the mask scaled to full size and get its data
    const scaledMaskCanvas = document.createElement('canvas');
    scaledMaskCanvas.width = origW;
    scaledMaskCanvas.height = origH;
    const scaledCtx = scaledMaskCanvas.getContext('2d');
    if (!scaledCtx) throw new Error('Could not create scaled mask canvas');
    scaledCtx.drawImage(maskCanvas, 0, 0, origW, origH);
    const scaledMaskData = scaledCtx.getImageData(0, 0, origW, origH).data;
    
    // Apply mask as alpha channel
    for (let i = 0; i < origW * origH; i++) {
      data[i * 4 + 3] = scaledMaskData[i * 4]; // Use red channel (grayscale)
    }
    ctx.putImageData(imageData, 0, 0);
    
    onProgress?.({ stage: 'processing', progress: 0.9, message: 'Encoding PNG…' });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) throw new Error('Could not encode PNG');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
