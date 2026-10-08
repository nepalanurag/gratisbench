// Extract Images tool: DOM glue. Pure extraction lives in ../lib/pdf-extract.ts.
// Thumbnails render in a grid. The user picks a download format (original,
// PNG, or JPG), can hide tiny decoration images, and ticks which images go
// into the ZIP.
import { extractEmbeddedImages, type ExtractedImage } from '../lib/pdf-extract.ts';
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
  loadImage,
} from './common.ts';

type OutFormat = 'original' | 'png' | 'jpg';

/** Images smaller than this on either side count as icons/decorations. */
const MIN_DIM = 100;

let images: ExtractedImage[] = [];
let kept: boolean[] = [];
let outFormat: OutFormat = 'original';
let hideSmall = true;

function isSmall(image: ExtractedImage): boolean {
  return image.width < MIN_DIM || image.height < MIN_DIM;
}

/** Indexes of images currently shown (after the small-image filter). */
function visibleIndexes(): number[] {
  const out: number[] = [];
  for (let i = 0; i < images.length; i++) {
    if (hideSmall && isSmall(images[i])) continue;
    out.push(i);
  }
  return out;
}

function selectedCount(): number {
  let n = 0;
  for (const i of visibleIndexes()) if (kept[i]) n++;
  return n;
}

/** Paint any extracted image onto a canvas for re-encoding. */
async function imageToCanvas(image: ExtractedImage): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create a drawing surface.');
  if (image.kind === 'jpeg') {
    const url = URL.createObjectURL(
      new Blob([image.data as unknown as BlobPart], { type: 'image/jpeg' })
    );
    try {
      ctx.drawImage(await loadImage(url), 0, 0);
    } finally {
      URL.revokeObjectURL(url);
    }
  } else {
    // ImageData needs a real ArrayBuffer-backed array, not ArrayBufferLike.
    const pixels = Uint8ClampedArray.from(image.data);
    ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  }
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the image.'));
    }, mime, quality);
  });
}

/** Resolved bytes for an image in the chosen download format. */
async function imageBytes(
  image: ExtractedImage,
  fmt: OutFormat
): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  if (fmt === 'original') {
    if (image.kind === 'jpeg') {
      return { bytes: image.data, mime: 'image/jpeg', ext: 'jpg' };
    }
    const blob = await canvasToBlob(await imageToCanvas(image), 'image/png');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', ext: 'png' };
  }
  const canvas = await imageToCanvas(image);
  if (fmt === 'png') {
    const blob = await canvasToBlob(canvas, 'image/png');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', ext: 'png' };
  }
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', ext: 'jpg' };
}

function outFileName(index: number, fmt: OutFormat): string {
  const ext =
    fmt === 'original' ? (images[index].kind === 'jpeg' ? 'jpg' : 'png') : fmt;
  return `image-${index + 1}.${ext}`;
}

function updateCounts(): void {
  const sel = selectedCount();
  el('count-label').textContent =
    `${images.length} image${images.length === 1 ? '' : 's'} found · ${sel} selected`;
  const zipBtn = el<HTMLButtonElement>('zip-btn');
  zipBtn.disabled = sel === 0;
  zipBtn.textContent = sel === 0 ? 'Download as ZIP' : `Download ${sel} as ZIP`;
  const hidden = images.length - visibleIndexes().length;
  const note = el('small-note');
  if (hidden > 0) {
    note.textContent =
      `${hidden} tiny image${hidden === 1 ? '' : 's'} hidden (icons, bullets, decorations). Untick the box above to see them.`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

async function renderGrid(): Promise<void> {
  const wrap = el('images-wrap');
  wrap.innerHTML = '';
  for (const i of visibleIndexes()) {
    const image = images[i];
    const card = document.createElement('div');
    card.className = 'image-card';

    // Resolve the thumbnail bytes once; the size shown is the real encoded size.
    let thumbBlob: Blob;
    let thumbType: string;
    if (image.kind === 'jpeg') {
      thumbBlob = new Blob([image.data as unknown as BlobPart], { type: 'image/jpeg' });
      thumbType = 'image/jpeg';
    } else {
      thumbBlob = await canvasToBlob(await imageToCanvas(image), 'image/png');
      thumbType = 'image/png';
    }

    const img = document.createElement('img');
    img.className = 'image-card-thumb';
    img.alt = `Image ${i + 1} from page ${image.page}`;
    img.loading = 'lazy';
    img.src = URL.createObjectURL(thumbBlob);

    const meta = document.createElement('div');
    meta.className = 'image-card-meta';
    meta.textContent =
      `Page ${image.page} · ${image.width}×${image.height} · ${formatBytes(thumbBlob.size)} ${thumbType === 'image/jpeg' ? 'JPG' : 'PNG'}`;

    const keepRow = document.createElement('label');
    keepRow.className = 'keep-row';
    const keep = document.createElement('input');
    keep.type = 'checkbox';
    keep.checked = kept[i];
    keep.setAttribute('aria-label', `Include image ${i + 1} in the ZIP download`);
    keep.addEventListener('change', () => {
      kept[i] = keep.checked;
      updateCounts();
    });
    keepRow.append(keep, document.createTextNode(' Include in ZIP'));
    card.append(img, meta, keepRow);

    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'btn btn-secondary';
    dl.textContent = 'Download';
    dl.addEventListener('click', async () => {
      try {
        const { bytes, mime } = await imageBytes(image, outFormat);
        downloadBytes(outFileName(i, outFormat), bytes, mime);
      } catch (err) {
        showError('error-box', err instanceof Error ? err.message : 'Download failed.');
      }
    });
    card.appendChild(dl);
    wrap.appendChild(card);
  }
  updateCounts();
}

export function initExtractImages(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('img-controls').hidden = true;
    el('images-wrap').innerHTML = '';
    el('small-note').hidden = true;
    el<HTMLButtonElement>('zip-btn').disabled = true;
    images = [];
    kept = [];
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
      kept = images.map(() => true);
      if (images.length === 0) {
        el('images-empty').hidden = false;
        el('images-empty').textContent =
          'No images found in this PDF. Some PDFs only contain text and vector drawings.';
        return;
      }
      el('images-empty').hidden = true;
      el('img-controls').hidden = false;
      await renderGrid();
      el('result').hidden = false;
    } catch (err) {
      showError('error-box', pdfLoadErrorMessage(err));
    }
  });

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="img-format"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) outFormat = radio.value as OutFormat;
    });
  }

  el<HTMLInputElement>('hide-small').addEventListener('change', (e) => {
    hideSmall = (e.target as HTMLInputElement).checked;
    void renderGrid();
  });

  el('select-all').addEventListener('click', () => {
    for (const i of visibleIndexes()) kept[i] = true;
    void renderGrid();
  });

  el('select-none').addEventListener('click', () => {
    for (const i of visibleIndexes()) kept[i] = false;
    void renderGrid();
  });

  el('zip-btn').addEventListener('click', async () => {
    const idxs = visibleIndexes().filter((i) => kept[i]);
    if (idxs.length === 0) return;
    hideError('error-box');
    setBusy('zip-btn', true, 'Zipping…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const i of idxs) {
        const { bytes } = await imageBytes(images[i], outFormat);
        zip.file(outFileName(i, outFormat), bytes);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBytes('images.zip', new Uint8Array(await blob.arrayBuffer()), 'application/zip');
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Zipping failed.');
    } finally {
      setBusy('zip-btn', false);
      updateCounts();
    }
  });
}
