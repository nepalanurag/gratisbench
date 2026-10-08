// OCR PDF core: assemble a searchable PDF from page images plus invisible
// text words. DOM-free: the browser tool renders pages and runs tesseract;
// this module only does pdf-lib assembly, so it runs in Node for verification.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface OcrWordBox {
  text: string;
  /** Bounding box in PDF points, measured from the page's top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OcrPagePlan =
  | { kind: 'keep'; sourceIndex: number }
  | {
      kind: 'ocr';
      image: { data: Uint8Array; mime: string };
      words: OcrWordBox[];
      widthPt: number;
      heightPt: number;
    };

/**
 * Convert a tesseract word box (pixels, top-left origin) to PDF points.
 * `scale` is pixels-per-point of the rendered page image.
 */
export function pixelBoxToPoints(
  box: { x0: number; y0: number; x1: number; y1: number },
  scale: number
): OcrWordBox {
  const w = (box.x1 - box.x0) / scale;
  const h = (box.y1 - box.y0) / scale;
  return {
    text: '',
    x: box.x0 / scale,
    y: box.y0 / scale,
    w: Math.max(0, w),
    h: Math.max(0, h),
  };
}

/**
 * Build the output PDF. Pages marked 'keep' are copied from the source as-is
 * (their real text layer survives). Pages marked 'ocr' are rebuilt as page
 * images with an invisible text layer drawn over them: selectable and
 * searchable, but visually identical to the scan.
 */
export async function assembleSearchablePdf(
  sourceBytes: Uint8Array,
  plans: OcrPagePlan[]
): Promise<Uint8Array> {
  if (plans.length === 0) {
    throw new Error('Nothing to assemble.');
  }
  const src = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  for (const plan of plans) {
    if (plan.kind === 'keep') {
      const [page] = await out.copyPages(src, [plan.sourceIndex]);
      out.addPage(page);
      continue;
    }
    const embedded =
      plan.image.mime === 'image/png'
        ? await out.embedPng(plan.image.data)
        : await out.embedJpg(plan.image.data);
    const page = out.addPage([plan.widthPt, plan.heightPt]);
    page.drawImage(embedded, { x: 0, y: 0, width: plan.widthPt, height: plan.heightPt });
    // Invisible words: fully transparent, so they never show, but every PDF
    // text tool (search, select, copy) still finds them.
    for (const word of plan.words) {
      const text = word.text.trim();
      if (!text || word.w <= 0 || word.h <= 0) continue;
      page.drawText(text, {
        x: word.x,
        y: plan.heightPt - word.y - word.h, // PDF y-origin is bottom-left
        size: Math.max(1, word.h * 0.85),
        font,
        color: rgb(1, 1, 1),
        opacity: 0,
      });
    }
  }

  return out.save();
}

/** Output filename for the searchable PDF. */
export function ocrFileName(stem: string): string {
  return `${stem}-searchable.pdf`;
}
