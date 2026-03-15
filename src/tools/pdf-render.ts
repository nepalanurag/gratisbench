// pdf.js loading + page rendering helpers for the browser tools.
// pdf.js is lazy-loaded (dynamic import) only after the user picks a file,
// so the tool pages stay fast on first paint. The worker URL is also resolved
// lazily for the same reason; `?url` is a Vite/Astro build-time feature.
type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Load pdf.js on demand and point it at the bundled worker. */
export function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** Render one pdf.js page to a canvas at the given DPI. */
export async function renderPageToCanvas(
  page: import('pdfjs-dist').PDFPageProxy,
  dpi: number
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create a drawing surface.');
  // White background so transparent page regions do not turn black in JPEGs.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Encode a canvas to PNG or JPEG bytes. */
export function canvasToBytes(
  canvas: HTMLCanvasElement,
  mime: 'image/png' | 'image/jpeg',
  quality = 0.92
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not encode the page image.'));
          return;
        }
        blob
          .arrayBuffer()
          .then((buf) => resolve(new Uint8Array(buf)))
          .catch(() => reject(new Error('Could not read the page image.')));
      },
      mime,
      quality
    );
  });
}

/**
 * Render the first page of a freshly created PDF into `wrapId`, for the
 * "here is what you made" result preview. Never throws: the preview is a
 * bonus and the download must always work.
 */
export async function showPdfPreview(wrapId: string, data: Uint8Array): Promise<void> {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
    const page = await doc.getPage(1);
    const canvas = await renderPageToCanvas(page, 72);
    page.cleanup();
    canvas.className = 'pdf-preview-canvas';
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
    wrap.hidden = false;
  } catch {
    wrap.hidden = true;
  }
}

/** Friendly message for common pdf.js open failures. */
export function pdfJsLoadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/password|encrypted/i.test(msg)) {
    return 'This PDF is password-protected. Remove the password first, then try again.';
  }
  return msg || 'Could not read that file as a PDF.';
}

/**
 * Render the first page of a PDF to a small JPEG data URL for file-list
 * thumbnails. Returns '' when the page cannot be rendered, so callers can
 * simply skip the <img>.
 */
export async function renderPdfThumb(data: Uint8Array, maxSize = 96): Promise<string> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
    const page = await doc.getPage(1);
    const canvas = await renderPageToCanvas(page, 36);
    page.cleanup();
    const scale = Math.min(1, maxSize / Math.max(canvas.width, canvas.height));
    const tw = Math.max(1, Math.round(canvas.width * scale));
    const th = Math.max(1, Math.round(canvas.height * scale));
    const thumb = document.createElement('canvas');
    thumb.width = tw;
    thumb.height = th;
    const ctx = thumb.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(canvas, 0, 0, tw, th);
    return thumb.toDataURL('image/jpeg', 0.7);
  } catch {
    return '';
  }
}
