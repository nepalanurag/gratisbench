// Background removal via @bg0/browser (BiRefNet, client-side).
// Proven implementation - handles model loading, preprocessing, inference, postprocessing.
import { removeBackground } from '@bg0/browser';

export interface BgProgress {
  stage: 'downloading' | 'processing';
  progress: number; // 0-1
  message: string;
}

/**
 * Remove background from an image file.
 * Returns a transparent PNG Blob.
 */
export async function removeBackgroundOrmBg(
  file: File | Blob,
  onProgress?: (p: BgProgress) => void
): Promise<Blob> {
  const result = await removeBackground(file, {
    quality: 'quality',
    onProgress: (p) => {
      onProgress?.({
        stage: p.stage === 'downloading' ? 'downloading' : 'processing',
        progress: p.progress,
        message: p.message,
      });
    },
  });
  return result.blob;
}
