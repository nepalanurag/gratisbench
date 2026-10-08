// Extract embedded images from a PDF.
// DOM-free: JPEG images come out as raw bytes; everything else comes out as
// RGBA pixels that the browser tool paints onto a canvas and encodes as PNG.
// Codec-free, so this module runs in Node for verification too.
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  collectImageXObjects,
  parseImageInfo,
  samplesToRgba,
  reversePredictors,
  filterNames,
  peelAsciiLayers,
  UNSUPPORTED_FILTERS,
} from './pdf-compress.ts';

export type ExtractedImage =
  | { kind: 'jpeg'; data: Uint8Array; width: number; height: number; page: number }
  | { kind: 'rgba'; data: Uint8ClampedArray; width: number; height: number; page: number };

/** Skip the huge-RGBA guard used by compression: extraction must not drop images. */
const MAX_PIXELS = 50_000_000;

function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Extract every embedded image, tagging each with the first page it appears on.
 * Soft masks (alpha data, not visible content) and stencil masks are skipped.
 */
export async function extractEmbeddedImages(buffer: Uint8Array): Promise<ExtractedImage[]> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });

  // Images referenced as another image's soft mask are not visible content.
  const maskObjs = new Set<PDFStream>();
  for (const { stream } of collectImageXObjects(doc)) {
    const smask = stream.dict.lookup(PDFName.of('SMask'));
    const smaskObj = smask instanceof PDFRef ? doc.context.lookup(smask) : smask;
    if (smaskObj instanceof PDFStream) maskObjs.add(smaskObj);
  }

  // Walk page resources directly so each image is tagged with its page.
  const seen = new Set<PDFStream>();
  const byPage: { stream: PDFStream; page: number }[] = [];
  const visit = (res: PDFDict | undefined, page: number): void => {
    if (!res) return;
    const xobjects = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) return;
    for (const key of xobjects.keys()) {
      const value = xobjects.lookup(key);
      const obj = value instanceof PDFRef ? doc.context.lookup(value) : value;
      if (!(obj instanceof PDFStream) || seen.has(obj)) continue;
      seen.add(obj);
      const dict = obj.dict;
      const subtype = dict.lookupMaybe(PDFName.of('Subtype'), PDFName);
      const sub = subtype ? subtype.asString() : '';
      if (sub === '/Image') {
        byPage.push({ stream: obj, page });
      } else if (sub === '/Form') {
        visit(dict.lookupMaybe(PDFName.of('Resources'), PDFDict), page);
      }
    }
  };
  for (const [i, page] of doc.getPages().entries()) {
    visit(page.node.Resources(), i + 1);
  }

  const out: ExtractedImage[] = [];
  for (const { stream, page } of byPage) {
    if (maskObjs.has(stream)) continue;
    const dict = stream.dict;
    const imageMask = dict.lookup(PDFName.of('ImageMask'));
    if (imageMask instanceof PDFBool && imageMask.asBoolean()) continue; // stencil mask
    const info = parseImageInfo(dict, doc.context);
    if (!info) continue;
    if (info.width * info.height > MAX_PIXELS) continue;
    try {
      const filters = filterNames(dict);
      const peeled = peelAsciiLayers(stream.getContents(), filters);
      if (peeled.rest.length === 1 && peeled.rest[0] === 'DCTDecode') {
        // Raw JPEG: hand the bytes back untouched.
        out.push({ kind: 'jpeg', data: peeled.bytes, width: info.width, height: info.height, page });
        continue;
      }
      if (peeled.rest.some((f) => UNSUPPORTED_FILTERS.has(f))) continue;
      const decoded = decodePDFRawStream({ dict, contents: stream.getContents() } as PDFRawStream).decode();
      // Predictor parameters live on the DecodeParms of the Flate/LZW filter.
      let predictor = 1;
      let columns = info.width;
      const dp = dict.lookup(PDFName.of('DecodeParms'));
      let parms: PDFDict | undefined;
      if (dp instanceof PDFDict) {
        parms = dp;
      } else if (dp instanceof PDFArray) {
        const idx = peeled.rest.findIndex((f) => f === 'FlateDecode' || f === 'LZWDecode');
        if (idx >= 0 && dp.lookup(idx) instanceof PDFDict) parms = dp.lookup(idx) as PDFDict;
      }
      if (parms) {
        predictor = parms.lookupMaybe(PDFName.of('Predictor'), PDFNumber)?.asNumber() ?? 1;
        columns = parms.lookupMaybe(PDFName.of('Columns'), PDFNumber)?.asNumber() ?? info.width;
      }
      const samples = reversePredictors(decoded, predictor, columns, info.components, info.bpc, info.height);
      const rgba = samplesToRgba(samples, info);
      out.push({ kind: 'rgba', data: rgba, width: info.width, height: info.height, page });
    } catch {
      continue; // one bad image must not kill the whole extraction
    }
  }
  return out;
}

/** Plain filename for an extracted image: image-1.jpg, image-2.png, ... */
export function extractedImageFileName(index: number, kind: ExtractedImage['kind']): string {
  return `image-${index + 1}.${kind === 'jpeg' ? 'jpg' : 'png'}`;
}
