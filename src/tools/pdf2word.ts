// PDF to Word tool: DOM glue. Text/paragraph/docx logic lives in ../lib/pdf2word-core.ts
// (pure, unit-tested in Node). pdf.js and the docx library are lazy-loaded only
// after the user picks a file, so the page stays fast on first paint.
import {
  el,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  downloadBytes,
  formatBytes,
  pdfLoadErrorMessage,
} from './common.ts';
import { loadPdfjs } from './pdf-render.ts';
import type {
  TextItemLike,
  PageImage,
  DocPage,
} from '../lib/pdf2word-core.ts';

type PdfJs = typeof import('pdfjs-dist');
type Core = typeof import('../lib/pdf2word-core.ts');

const MAX_PAGES = 200;
const MAX_IMAGES_PER_PAGE = 20;
const MAX_IMAGES_TOTAL = 60;
const IMAGE_MIN_PT = 24; // skip decorative icons/rules smaller than this
const IMAGE_MAX_PX = 800; // downscale embedded images to this long edge

let pickedFile: File | null = null;
let lastResult: { bytes: Uint8Array; name: string } | null = null;

function mul6(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function imageDataToPng(
  img: { width: number; height: number; data?: Uint8ClampedArray | Uint8Array; bitmap?: ImageBitmap }
): Promise<{ data: Uint8Array; w: number; h: number } | null> {
  try {
    const w = img.width;
    const h = img.height;
    if (!w || !h || w * h > 64_000_000) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (img.bitmap) {
      ctx.drawImage(img.bitmap, 0, 0);
    } else if (img.data) {
      const clamped = img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data.buffer as ArrayBuffer, img.data.byteOffset, img.data.byteLength);
      ctx.putImageData(new ImageData(clamped, w, h), 0, 0);
    } else {
      return null;
    }
    const scale = Math.min(1, IMAGE_MAX_PX / Math.max(w, h));
    let outCanvas = canvas;
    if (scale < 1) {
      outCanvas = document.createElement('canvas');
      outCanvas.width = Math.max(1, Math.round(w * scale));
      outCanvas.height = Math.max(1, Math.round(h * scale));
      const octx = outCanvas.getContext('2d');
      if (!octx) return null;
      octx.drawImage(canvas, 0, 0, outCanvas.width, outCanvas.height);
    }
    const blob = await new Promise<Blob | null>((resolve) => outCanvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    const buf = await blob.arrayBuffer();
    return { data: new Uint8Array(buf), w: outCanvas.width, h: outCanvas.height };
  } catch {
    return null;
  }
}

function resolveImage(page: import('pdfjs-dist').PDFPageProxy, objId: string): { width: number; height: number; data?: Uint8ClampedArray; bitmap?: ImageBitmap } | null {
  for (const store of [page.objs, page.commonObjs]) {
    try {
      const img = store.get(objId);
      if (img) return img;
    } catch {
      /* not in this store */
    }
  }
  return null;
}

async function extractPageImages(page: import('pdfjs-dist').PDFPageProxy, pdfjs: PdfJs): Promise<PageImage[]> {
  const ops = await page.getOperatorList();
  const OPS = pdfjs.OPS;
  const out: PageImage[] = [];
  const seen = new Set<string>();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) {
      stack.push(ctm);
      ctm = [...ctm];
    } else if (fn === OPS.restore) {
      const prev = stack.pop();
      if (prev) ctm = prev;
    } else if (fn === OPS.transform) {
      ctm = mul6(ctm, args as number[]);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      let img: { width: number; height: number; data?: Uint8ClampedArray; bitmap?: ImageBitmap } | null = null;
      let key: string;
      if (fn === OPS.paintImageXObject) {
        key = `x:${String(args[0])}`;
        if (seen.has(key)) continue;
        img = resolveImage(page, String(args[0]));
      } else {
        key = `i:${i}`;
        img = args[0] as { width: number; height: number; data?: Uint8ClampedArray; bitmap?: ImageBitmap };
      }
      if (!img) continue;
      // Rendered size in PDF points: |basis vectors| of the placement matrix.
      const rw = Math.hypot(ctm[0], ctm[1]);
      const rh = Math.hypot(ctm[2], ctm[3]);
      if (rw < IMAGE_MIN_PT || rh < IMAGE_MIN_PT) continue; // decorative icon or rule
      const png = await imageDataToPng(img);
      if (!png) continue;
      seen.add(key);
      out.push({ data: png.data, widthPx: png.w, heightPx: png.h, x: ctm[4], y: ctm[5] });
      if (out.length >= MAX_IMAGES_PER_PAGE) break;
    }
  }
  return out;
}

function setStatus(text: string): void {
  el('pdf2word-status').textContent = text;
}

export function initPdfToWord(): void {
  setupDropzone('pdf2word-dropzone', 'pdf2word-input', (files) => {
    const f = files[0];
    if (!f) return;
    hideError('pdf2word-error');
    el('pdf2word-result').hidden = true;
    lastResult = null;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      showError('pdf2word-error', 'That does not look like a PDF. Please pick a .pdf file.');
      return;
    }
    pickedFile = f;
    el('pdf2word-file').textContent = `${f.name} (${formatBytes(f.size)})`;
    el('pdf2word-file').hidden = false;
    (el<HTMLButtonElement>('pdf2word-convert')).disabled = false;
    setStatus('Ready. Click "Convert to Word" when you are.');
  });

  el('pdf2word-convert').addEventListener('click', () => void convert());
  el('pdf2word-download').addEventListener('click', () => {
    if (lastResult) {
      downloadBytes(
        lastResult.name,
        lastResult.bytes,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    }
  });
}

async function convert(): Promise<void> {
  if (!pickedFile) return;
  hideError('pdf2word-error');
  el('pdf2word-result').hidden = true;
  setBusy('pdf2word-convert', true, 'Converting…');
  setStatus('Loading the converter…');
  try {
    // Lazy-load both heavy libraries only now that the user asked for a conversion.
    const [pdfjs, core]: [PdfJs, Core] = await Promise.all([
      loadPdfjs(),
      import('../lib/pdf2word-core.ts'),
    ]);

    const buf = new Uint8Array(await pickedFile.arrayBuffer());
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: buf }).promise;
    } catch (err) {
      throw new Error(pdfLoadErrorMessage(err));
    }
    const totalPages = pdf.numPages;
    const pages = Math.min(totalPages, MAX_PAGES);
    if (totalPages > MAX_PAGES) {
      setStatus(`This PDF has ${totalPages} pages; only the first ${MAX_PAGES} will be converted.`);
    }

    const pagesLines: TextItemLike[][] = [];
    const docPages: DocPage[] = [];
    let imageTotal = 0;
    let textlessPages = 0;

    for (let p = 1; p <= pages; p++) {
      setStatus(`Reading page ${p} of ${pages}…`);
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = (tc.items as unknown as TextItemLike[]).filter((it) => it && typeof it.str === 'string');
      const lines = core.groupItemsIntoLines(items);
      pagesLines.push(lines);

      let images: PageImage[] = [];
      if (imageTotal < MAX_IMAGES_TOTAL) {
        images = await extractPageImages(page, pdfjs);
        imageTotal += images.length;
      }
      const textChars = lines.reduce((n, l) => n + l.text.length, 0);
      if (textChars < 40) textlessPages++;
      docPages.push({ pageIndex: p - 1, blocks: [], images, textChars });
      page.cleanup();
    }

    setStatus('Assembling the Word document…');
    const blocksPerPage = core.linesToBlocks(pagesLines);
    blocksPerPage.forEach((blocks, i) => {
      docPages[i].blocks = blocks;
    });

    const bytes = await core.assembleDocx(docPages, pickedFile.name.replace(/\.pdf$/i, ''));
    const name = core.docxFileName(pickedFile.name);
    lastResult = { bytes, name };

    const headingCount = docPages.reduce((n, d) => n + d.blocks.filter((b) => b.kind !== 'p').length, 0);
    const paraCount = docPages.reduce((n, d) => n + d.blocks.filter((b) => b.kind === 'p').length, 0);
    const stats: string[] = [
      `${pages} page${pages === 1 ? '' : 's'} converted`,
      `${paraCount} paragraphs`,
      `${headingCount} headings`,
      `${imageTotal} images embedded`,
    ];
    if (textlessPages > 0) {
      stats.push(
        `${textlessPages} page${textlessPages === 1 ? '' : 's'} had no extractable text (likely scanned images)`
      );
    }
    el('pdf2word-stats').innerHTML =
      `<ul class="result-list">` + stats.map((s) => `<li>${escapeHtml(s)}</li>`).join('') + `</ul>` +
      `<p class="result-note">Headings were detected by font size. Complex layouts, tables, and multi-column designs are not preserved; for a pixel-faithful conversion use desktop software.</p>`;
    el('pdf2word-result').hidden = false;
    setStatus('Done.');
  } catch (err) {
    showError('pdf2word-error', err instanceof Error ? err.message : 'Conversion failed.');
    setStatus('');
  } finally {
    setBusy('pdf2word-convert', false);
  }
}
