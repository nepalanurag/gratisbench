// v2: rebuilt to fix stale bundle
// Extract Images tool: DOM glue. Pure extraction lives in ../lib/pdf-extract.ts.
// Thumbnails render in a grid; each image downloads on its own, or all as a ZIP.
import {
  extractEmbeddedImages,
  extractedImageFileName,
  type ExtractedImage,
} from '../lib/pdf-extract.ts';
import { pdfLoadErrorMessage } from './common.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  mobileFileSizeGuard,
} from './common.ts';

let images: ExtractedImage[] = [];

function rgbaToBlob(image: ExtractedImage & { kind: 'rgba' }): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Your browser could not create a drawing surface.'));
      return;
    }
    // ImageData needs a real ArrayBuffer-backed array, not ArrayBufferLike.
    const pixels = Uint8ClampedArray.from(image.data);
    ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the image.'));
    }, 'image/png');
  });
}

/** Resolved bytes for an image, ready to download: { bytes, mime, ext }. */
async function imageBytes(image: ExtractedImage): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  if (image.kind === 'jpeg') {
    return { bytes: image.data, mime: 'image/jpeg', ext: 'jpg' };
  }
  const blob = await rgbaToBlob(image);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', ext: 'png' };
}

export function initExtractImages(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('images-wrap').innerHTML = '';
    el<HTMLButtonElement>('zip-btn').disabled = true;
    images = [];
    const f = files[0];
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      showError('error-box', `"${f.name}" is not a PDF.`);
      return;
    }
    const sizeNote = el('size-note');
    sizeNote.hidden = true;
    const guard = mobileFileSizeGuard(f);
    if (guard?.block) {
      showError('error-box', guard.message);
      return;
    }
    if (guard) {
      sizeNote.textContent = guard.message;
      sizeNote.hidden = false;
    }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      images = await extractEmbeddedImages(bytes);
      if (images.length === 0) {
        el('images-empty').hidden = false;
        el('images-empty').textContent = 'No images found in this PDF. Some PDFs only contain text and vector drawings.';
        return;
      }
      el('images-empty').hidden = true;
      const wrap = el('images-wrap');
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const card = document.createElement('div');
        card.className = 'image-card';
        const img = document.createElement('img');
        img.className = 'image-card-thumb';
        img.alt = `Image ${i + 1} from page ${image.page}`;
        img.loading = 'lazy';
        if (image.kind === 'jpeg') {
          const blob = new Blob([image.data as unknown as BlobPart], { type: 'image/jpeg' });
          img.src = URL.createObjectURL(blob);
        } else {
          const blob = await rgbaToBlob(image);
          img.src = URL.createObjectURL(blob);
        }
        const meta = document.createElement('div');
        meta.className = 'image-card-meta';
        meta.textContent = `Page ${image.page} · ${image.width}×${image.height}`;
        const dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'btn btn-secondary';
        dl.textContent = 'Download';
        dl.addEventListener('click', async () => {
          try {
            const { bytes, mime } = await imageBytes(image);
            downloadBytes(extractedImageFileName(i, image.kind), bytes, mime);
          } catch (err) {
            showError('error-box', err instanceof Error ? err.message : 'Download failed.');
          }
        });
        card.append(img, meta, dl);
        wrap.appendChild(card);
      }
      el('count-label').textContent =
        `${images.length} image${images.length === 1 ? '' : 's'} found`;
      el<HTMLButtonElement>('zip-btn').disabled = false;
      el('result').hidden = false;
    } catch (err) {
      showError('error-box', pdfLoadErrorMessage(err));
    }
  });

  el('zip-btn').addEventListener('click', async () => {
    if (images.length === 0) return;
    hideError('error-box');
    setBusy('zip-btn', true, 'Zipping…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (let i = 0; i < images.length; i++) {
        const { bytes } = await imageBytes(images[i]);
        zip.file(extractedImageFileName(i, images[i].kind), bytes);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBytes('images.zip', new Uint8Array(await blob.arrayBuffer()), 'application/zip');
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Zipping failed.');
    } finally {
      setBusy('zip-btn', false);
    }
  });
}
// v2: rebuilt
