// Compression core: shrink a PDF by downsampling its embedded images.
// Text, vector graphics, fonts, links, and annotations are never touched,
// so the text layer stays intact: selectable, searchable, copyable. Rendered
// page bitmaps are NOT used anywhere in this module.
//
// The only environment-dependent steps are JPEG decode/encode, injected as an
// ImageCodec (browser: canvas; Node tests: stub). Everything else -- filter
// decoding, predictor reversal, colorspace handling, stream replacement -- is
// plain pdf-lib + JS and runs in Node for verification.
//
// What pdf-lib 1.17.1 can and cannot do here:
// - Image downsampling: yes, by replacing image XObject streams (this file).
// - Font subsetting of a LOADED document: not available. `subset: true` only
//   applies to fonts you embed yourself via embedFont(); fonts in a loaded
//   document are written back as-is.
// - Stream recompression: doc.save({ useObjectStreams: true }) (the default)
//   packs objects into compressed object streams.
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';

export type CompressionLevelName = 'light' | 'medium' | 'heavy';

export interface CompressionLevel {
  /** Longest side, in pixels, that an embedded image is allowed to keep. */
  maxDim: number;
  /** JPEG quality (0..1) used when re-encoding downsampled images. */
  jpegQuality: number;
}

export const COMPRESSION_LEVELS: Record<CompressionLevelName, CompressionLevel> = {
  light: { maxDim: 2400, jpegQuality: 0.82 },
  medium: { maxDim: 1600, jpegQuality: 0.68 },
  heavy: { maxDim: 1000, jpegQuality: 0.55 },
};

/** RGBA pixels. */
export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * The two steps that need a real JPEG codec. In the browser this is canvas
 * (createImageBitmap + toBlob); in Node tests it is a stub. Everything else
 * in this module is codec-free.
 */
export interface ImageCodec {
  decodeJpeg(bytes: Uint8Array): Promise<RawImage>;
  encodeJpeg(img: RawImage, quality: number): Promise<Uint8Array>;
}

export interface CompressImagesStats {
  imagesFound: number;
  imagesReplaced: number;
  imagesSkipped: number;
  imageBytesBefore: number;
  imageBytesAfter: number;
}

/** An image XObject found in the document. */
export interface FoundImage {
  stream: PDFStream;
}

/** PDFName.asString() keeps the leading slash ("/Image"); strip it for comparisons. */
function nameStr(name: PDFName): string {
  const s = name.asString();
  return s.startsWith('/') ? s.slice(1) : s;
}

/**
 * Collect every image XObject in the document: page resources plus any Form
 * XObjects nested inside them (headers/footers/templates often live there).
 * Each stream object is visited once even if used on many pages. Values may
 * be indirect references (the norm in the wild) or direct stream objects
 * (what pdf-lib itself writes), so both are handled.
 */
export function collectImageXObjects(doc: PDFDocument): FoundImage[] {
  const seen = new Set<PDFStream>();
  const found: FoundImage[] = [];
  const visitResources = (res: PDFDict | undefined): void => {
    if (!res) return;
    const xobjects = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) return;
    for (const key of xobjects.keys()) {
      const value = xobjects.lookup(key);
      const obj = value instanceof PDFRef ? doc.context.lookup(value) : value;
      if (!(obj instanceof PDFStream) || seen.has(obj)) continue;
      seen.add(obj);
      const subtype = obj.dict.lookupMaybe(PDFName.of('Subtype'), PDFName);
      if (subtype && nameStr(subtype) === 'Image') {
        found.push({ stream: obj });
      } else if (subtype && nameStr(subtype) === 'Form') {
        visitResources(obj.dict.lookupMaybe(PDFName.of('Resources'), PDFDict));
      }
    }
  };
  for (const page of doc.getPages()) visitResources(page.node.Resources());
  return found;
}

/** Names of the /Filter entry, in order. Empty array means no filter. */
function filterNames(dict: PDFDict): string[] {
  const filter = dict.lookup(PDFName.of('Filter'));
  const names: string[] = [];
  if (filter instanceof PDFName) {
    names.push(nameStr(filter));
  } else if (filter instanceof PDFArray) {
    for (let i = 0; i < filter.size(); i++) {
      const f = filter.lookup(i);
      if (f instanceof PDFName) names.push(nameStr(f));
    }
  }
  return names;
}

const ASCII_FILTERS = new Set(['ASCII85Decode', 'A85', 'ASCIIHexDecode', 'AHx']);
// Encodings we cannot turn into pixels: JPEG2000, fax, JBIG2, or a JPEG that
// is not the final filter (pathological). These images are left untouched.
const UNSUPPORTED_FILTERS = new Set(['JPXDecode', 'CCITTFaxDecode', 'CCF', 'JBIG2Decode']);

function numberEntry(dict: PDFDict, key: string): number | undefined {
  const v = dict.lookupMaybe(PDFName.of(key), PDFNumber);
  return v ? v.asNumber() : undefined;
}

/** Decode ASCII85 (only the bytes; callers strip whitespace and markers). */
export function ascii85Decode(data: Uint8Array): Uint8Array {
  // Strip whitespace and the <~ ~> markers; 'z' is shorthand for 4 zero bytes.
  const clean: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7a) {
      clean.push(0, 0, 0, 0, 0); // 'z' -> five zero digits sentinel
    } else if (c > 32 && c < 127 && c !== 0x7a) {
      clean.push(c);
    }
  }
  // Remove the <~ ~> markers if present.
  const text = clean.filter((c) => c !== 0x3c && c !== 0x3e); // '<' '>'
  const out: number[] = [];
  for (let i = 0; i < text.length; ) {
    const group = text.slice(i, i + 5);
    i += 5;
    if (group.length === 0) break;
    if (group[0] === 0 && group.length === 5) {
      // 'z' sentinel stored above as five zeros
      out.push(0, 0, 0, 0);
      continue;
    }
    const n = group.length;
    while (group.length < 5) group.push(117); // 'u' pads short final groups
    let value = 0;
    for (const c of group) value = value * 85 + (c - 33);
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    out.push(...bytes.slice(0, n - 1));
  }
  return new Uint8Array(out);
}

/** Decode ASCIIHex (whitespace ignored, '>' ends the data). */
export function asciiHexDecode(data: Uint8Array): Uint8Array {
  const hex: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 0x3e) break; // '>'
    if (
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x46) ||
      (c >= 0x61 && c <= 0x66)
    ) {
      hex.push(c);
    }
  }
  if (hex.length % 2 === 1) hex.push(0x30); // odd digit pads with 0
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = (parseInt(String.fromCharCode(hex[2 * i]), 16) << 4) | parseInt(String.fromCharCode(hex[2 * i + 1]), 16);
  }
  return out;
}

/** Peel leading ASCII85/ASCIIHex layers; returns the remaining filter list. */
function peelAsciiLayers(
  bytes: Uint8Array,
  filters: string[],
): { bytes: Uint8Array; rest: string[] } {
  let out = bytes;
  let rest = filters;
  while (rest.length > 0 && ASCII_FILTERS.has(rest[0])) {
    const [first, ...tail] = rest;
    out = first === 'ASCIIHexDecode' || first === 'AHx' ? asciiHexDecode(out) : ascii85Decode(out);
    rest = tail;
  }
  return { bytes: out, rest };
}

/**
 * Reverse PDF predictor filtering (DecodeParms /Predictor).
 * predictor 1: none. 2: TIFF horizontal differencing. 10-15: PNG optimum
 * (each row starts with a filter-type byte: 0 None, 1 Sub, 2 Up, 3 Average,
 * 4 Paeth). Returns the raw sample bytes.
 */
export function reversePredictors(
  data: Uint8Array,
  predictor: number,
  columns: number,
  components: number,
  bpc: 1 | 2 | 4 | 8,
  height: number,
): Uint8Array {
  if (predictor === 1) return data;
  const rowBytes = Math.ceil((columns * components * bpc) / 8);
  if (rowBytes <= 0) throw new Error('Invalid predictor row size.');
  if (predictor === 2) {
    // TIFF horizontal differencing: each byte adds the previous byte in the row.
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const prev = i % rowBytes === 0 ? 0 : out[i - 1];
      out[i] = (data[i] + prev) & 0xff;
    }
    return out;
  }
  if (predictor >= 10 && predictor <= 15) {
    const stride = rowBytes + 1;
    if (data.length !== height * stride) throw new Error('Predictor data size mismatch.');
    const bpp = Math.max(1, Math.ceil((components * bpc) / 8));
    const out = new Uint8Array(height * rowBytes);
    const paeth = (a: number, b: number, c: number): number => {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    for (let r = 0; r < height; r++) {
      const filterType = data[r * stride];
      const rowIn = data.subarray(r * stride + 1, (r + 1) * stride);
      const prev = r === 0 ? new Uint8Array(rowBytes) : out.subarray((r - 1) * rowBytes, r * rowBytes);
      const rowOut = out.subarray(r * rowBytes, (r + 1) * rowBytes);
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? rowOut[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const v = rowIn[i];
        rowOut[i] =
          filterType === 0
            ? v
            : filterType === 1
              ? (v + a) & 0xff
              : filterType === 2
                ? (v + b) & 0xff
                : filterType === 3
                  ? (v + ((a + b) >> 1)) & 0xff
                  : filterType === 4
                    ? (v + paeth(a, b, c)) & 0xff
                    : (() => {
                        throw new Error(`Unknown PNG filter type ${filterType}.`);
                      })();
      }
    }
    return out;
  }
  throw new Error(`Unsupported predictor ${predictor}.`);
}

export type SampleKind = 'gray' | 'rgb' | 'cmyk' | 'indexed';

export interface DecodedImageInfo {
  width: number;
  height: number;
  bpc: 1 | 2 | 4 | 8;
  components: 1 | 3 | 4;
  kind: SampleKind;
  /** For indexed: (hival + 1) * 3 RGB bytes. */
  lookup?: Uint8Array;
  hival?: number;
  /** 2 entries per component; default is [0, 1] per component. */
  decode: number[];
}

function lookupBytes(obj: unknown): Uint8Array | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.asBytes();
  if (obj instanceof PDFStream) return obj.getContents();
  return null;
}

/**
 * Resolve the image's /ColorSpace into component count and kind.
 * Returns null for colorspaces we cannot render (Separation, DeviceN,
 * Pattern, ICCBased with unusual N).
 */
function resolveColorSpace(cs: unknown, context: { lookup: (ref: PDFRef) => unknown }): {
  components: 1 | 3 | 4;
  kind: SampleKind;
  lookup?: Uint8Array;
  hival?: number;
} | null {
  if (cs instanceof PDFName) {
    switch (nameStr(cs)) {
      case 'DeviceRGB':
        return { components: 3, kind: 'rgb' };
      case 'DeviceGray':
      case 'G':
        return { components: 1, kind: 'gray' };
      case 'DeviceCMYK':
      case 'CMYK':
        return { components: 4, kind: 'cmyk' };
      default:
        return null;
    }
  }
  if (cs instanceof PDFArray && cs.size() > 0) {
    const first = cs.lookup(0);
    const family = first instanceof PDFName ? nameStr(first) : null;
    if (family === 'Indexed' || family === 'I') {
      const base = resolveColorSpace(cs.lookup(1), context);
      if (!base || base.kind !== 'rgb') return null;
      const hivalObj = cs.lookup(2);
      const hival = hivalObj instanceof PDFNumber ? hivalObj.asNumber() : 255;
      const lookup = lookupBytes(cs.lookup(3));
      if (!lookup || lookup.length < (hival + 1) * 3) return null;
      return { components: 3, kind: 'indexed', lookup, hival };
    }
    if (family === 'ICCBased') {
      const profileRef = cs.lookup(1);
      const profile = profileRef instanceof PDFRef ? context.lookup(profileRef) : profileRef;
      const n =
        profile instanceof PDFStream
          ? profile.dict.lookupMaybe(PDFName.of('N'), PDFNumber)?.asNumber()
          : undefined;
      if (n === 3) return { components: 3, kind: 'rgb' };
      if (n === 1) return { components: 1, kind: 'gray' };
      if (n === 4) return { components: 4, kind: 'cmyk' };
      return null;
    }
    if (family === 'CalRGB') return { components: 3, kind: 'rgb' };
    if (family === 'CalGray') return { components: 1, kind: 'gray' };
    return null;
  }
  return null;
}

/** Read the image dictionary into a plain description; null if unsupported. */
export function parseImageInfo(dict: PDFDict, context: PDFDocument['context']): DecodedImageInfo | null {
  const width = numberEntry(dict, 'Width');
  const height = numberEntry(dict, 'Height');
  const bpc = numberEntry(dict, 'BitsPerComponent');
  if (!width || !height || width <= 0 || height <= 0) return null;
  if (bpc !== 1 && bpc !== 2 && bpc !== 4 && bpc !== 8) return null;
  const cs = resolveColorSpace(dict.lookup(PDFName.of('ColorSpace')), context);
  if (!cs) return null;
  const decode: number[] = [];
  const decodeArr = dict.lookup(PDFName.of('Decode'));
  if (decodeArr instanceof PDFArray && decodeArr.size() === cs.components * 2) {
    for (let i = 0; i < decodeArr.size(); i++) {
      const v = decodeArr.lookup(i);
      decode.push(v instanceof PDFNumber ? v.asNumber() : i % 2 === 0 ? 0 : 1);
    }
  } else {
    for (let i = 0; i < cs.components; i++) decode.push(0, 1);
  }
  return {
    width,
    height,
    bpc,
    components: cs.components,
    kind: cs.kind,
    lookup: cs.lookup,
    hival: cs.hival,
    decode,
  };
}

/**
 * Turn decoded sample bytes into RGBA pixels. Handles 1/2/4/8 bits per
 * component (MSB first), the /Decode array, and gray/RGB/CMYK/indexed data.
 */
export function samplesToRgba(samples: Uint8Array, info: DecodedImageInfo): Uint8ClampedArray {
  const { width, height, bpc, components, kind, decode } = info;
  const maxSample = (1 << bpc) - 1;
  const needed = Math.ceil((width * height * components * bpc) / 8);
  if (samples.length < needed) throw new Error('Sample data shorter than the image dimensions.');
  const out = new Uint8ClampedArray(width * height * 4);
  let byteIdx = 0;
  let bitsLeft = 0;
  let cur = 0;
  const nextSample = (): number => {
    if (bpc === 8) return samples[byteIdx++];
    if (bitsLeft === 0) {
      cur = samples[byteIdx++];
      bitsLeft = 8;
    }
    bitsLeft -= bpc;
    return (cur >> bitsLeft) & maxSample;
  };
  // Map a raw sample through the /Decode array into 0..1.
  const map = (s: number, c: number): number => {
    const dmin = decode[2 * c];
    const dmax = decode[2 * c + 1];
    const v = dmin + (s / maxSample) * (dmax - dmin);
    return Math.min(1, Math.max(0, v));
  };
  for (let p = 0; p < width * height; p++) {
    const v: number[] = [];
    for (let c = 0; c < components; c++) v.push(map(nextSample(), c));
    const o = p * 4;
    if (kind === 'gray') {
      const g = Math.round(v[0] * 255);
      out[o] = g;
      out[o + 1] = g;
      out[o + 2] = g;
      out[o + 3] = 255;
    } else if (kind === 'rgb') {
      out[o] = Math.round(v[0] * 255);
      out[o + 1] = Math.round(v[1] * 255);
      out[o + 2] = Math.round(v[2] * 255);
      out[o + 3] = 255;
    } else if (kind === 'cmyk') {
      // Naive CMYK -> RGB. Good enough for a downsampled re-encode.
      const [c, m, y, k] = v;
      out[o] = Math.round(255 * (1 - Math.min(1, c * (1 - k) + k)));
      out[o + 1] = Math.round(255 * (1 - Math.min(1, m * (1 - k) + k)));
      out[o + 2] = Math.round(255 * (1 - Math.min(1, y * (1 - k) + k)));
      out[o + 3] = 255;
    } else {
      // indexed: the sample is the palette index
      const idx = Math.min(info.hival ?? 255, Math.max(0, Math.round((v[0] * (info.hival ?? 255)))));
      const table = info.lookup ?? new Uint8Array(0);
      out[o] = table[idx * 3] ?? 0;
      out[o + 1] = table[idx * 3 + 1] ?? 0;
      out[o + 2] = table[idx * 3 + 2] ?? 0;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Bilinear downscale of RGBA pixels. Pure JS so it is testable in Node. */
export function resizeRgba(src: RawImage, dstW: number, dstH: number): RawImage {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const xRatio = src.width / dstW;
  const yRatio = src.height / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.min(src.height - 1, Math.max(0, Math.floor(sy)));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < dstW; x++) {
      const sx = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.min(src.width - 1, Math.max(0, Math.floor(sx)));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, sx - x0));
      const o = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + c];
        const p10 = src.data[(y0 * src.width + x1) * 4 + c];
        const p01 = src.data[(y1 * src.width + x0) * 4 + c];
        const p11 = src.data[(y1 * src.width + x1) * 4 + c];
        out[o + c] = Math.round(
          p00 * (1 - wx) * (1 - wy) + p10 * wx * (1 - wy) + p01 * (1 - wx) * wy + p11 * wx * wy,
        );
      }
    }
  }
  return { width: dstW, height: dstH, data: out };
}

/** Longest-side scale factor for the level; 1 means "leave the image alone". */
export function downsampleScale(width: number, height: number, level: CompressionLevel): number {
  return Math.min(1, level.maxDim / Math.max(width, height));
}

/** Skip images larger than this: the RGBA working buffer would risk the tab. */
const MAX_PIXELS = 50_000_000;

interface Replacement {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Decode one image XObject to RGBA and re-encode it as a smaller JPEG.
 * Returns null when the image should be left untouched (already small enough,
 * unsupported encoding, or the re-encode would not save bytes).
 */
async function downsampleImage(
  stream: PDFStream,
  context: PDFDocument['context'],
  level: CompressionLevel,
  codec: ImageCodec,
): Promise<Replacement | null> {
  const dict = stream.dict;
  const info = parseImageInfo(dict, context);
  if (!info) return null;
  if (info.width * info.height > MAX_PIXELS) return null; // too big to hold as RGBA
  const scale = downsampleScale(info.width, info.height, level);
  if (scale >= 1) return null; // already within the budget; never upscale
  const originalLength = stream.getContents().length;

  const filters = filterNames(dict);
  let rgba: RawImage;
  const peeled = peelAsciiLayers(stream.getContents(), filters);
  if (peeled.rest.length === 1 && peeled.rest[0] === 'DCTDecode') {
    // Already a JPEG: decode the pixels with the codec.
    rgba = await codec.decodeJpeg(peeled.bytes);
  } else {
    if (peeled.rest.some((f) => UNSUPPORTED_FILTERS.has(f))) return null;
    let decoded: Uint8Array;
    try {
      // Handles Flate, LZW, RunLength, ASCII85, ASCIIHex (predictors are NOT
      // handled by pdf-lib, so they are reversed below).
      decoded = decodePDFRawStream({ dict, contents: stream.getContents() } as PDFRawStream).decode();
    } catch {
      return null;
    }
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
    let samples: Uint8Array;
    try {
      samples = reversePredictors(decoded, predictor, columns, info.components, info.bpc, info.height);
    } catch {
      return null;
    }
    try {
      rgba = { width: info.width, height: info.height, data: samplesToRgba(samples, info) };
    } catch {
      return null;
    }
  }

  const dstW = Math.max(1, Math.round(rgba.width * scale));
  const dstH = Math.max(1, Math.round(rgba.height * scale));
  const resized = resizeRgba(rgba, dstW, dstH);
  const jpeg = await codec.encodeJpeg(resized, level.jpegQuality);
  if (jpeg.length === 0 || jpeg.length >= originalLength) return null; // no saving
  return { bytes: jpeg, width: dstW, height: dstH };
}

/**
 * Swap an image XObject's contents for the downsampled JPEG, in place.
 * The same indirect object is kept, so /SMask, /Mask, /Interpolate and
 * /Intent survive; only the pixel data and its describing entries change.
 * (contents is readonly in the typings but a plain field at runtime; the
 * writer recomputes /Length from it when saving.)
 */
function replaceImageContents(stream: PDFStream, replacement: Replacement): void {
  if (!(stream instanceof PDFRawStream)) {
    throw new Error('Cannot replace a non-raw image stream.');
  }
  const dict = stream.dict;
  dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  dict.set(PDFName.of('Width'), PDFNumber.of(replacement.width));
  dict.set(PDFName.of('Height'), PDFNumber.of(replacement.height));
  dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.delete(PDFName.of('DecodeParms'));
  dict.delete(PDFName.of('Decode')); // the old sample mapping must not apply to the new JPEG
  (stream as unknown as { contents: Uint8Array }).contents = replacement.bytes;
}

/**
 * Compress a PDF without rasterizing text: downsample embedded images that
 * exceed the level's pixel budget, re-encode them as JPEG, and save with
 * object streams. Images used as soft masks (/SMask) and stencil masks
 * (/ImageMask) are never touched. Any image that fails to decode is left
 * as-is; it never fails the whole file.
 */
export async function compressPdfImages(
  input: Uint8Array,
  levelName: CompressionLevelName,
  codec: ImageCodec,
  onProgress?: (done: number, total: number) => void,
): Promise<{ data: Uint8Array; stats: CompressImagesStats }> {
  const level = COMPRESSION_LEVELS[levelName];
  if (!level) throw new Error(`Unknown compression level: "${levelName}".`);
  const doc = await PDFDocument.load(input);
  if (doc.getPageCount() === 0) throw new Error('Nothing to compress. The PDF had no pages.');

  const all = collectImageXObjects(doc);
  // Never touch soft-mask images: they must stay grayscale.
  const maskObjs = new Set<PDFStream>();
  for (const { stream } of all) {
    const smask = stream.dict.lookup(PDFName.of('SMask'));
    const smaskObj = smask instanceof PDFRef ? doc.context.lookup(smask) : smask;
    if (smaskObj instanceof PDFStream) maskObjs.add(smaskObj);
  }
  const images = all.filter(({ stream }) => {
    if (maskObjs.has(stream)) return false;
    // Stencil masks (/ImageMask true) are 1-bit; never touch them.
    const imageMask = stream.dict.lookup(PDFName.of('ImageMask'));
    if (imageMask instanceof PDFBool && imageMask.asBoolean()) return false;
    return true;
  });

  const stats: CompressImagesStats = {
    imagesFound: images.length,
    imagesReplaced: 0,
    imagesSkipped: 0,
    imageBytesBefore: 0,
    imageBytesAfter: 0,
  };
  let done = 0;
  for (const { stream } of images) {
    done++;
    try {
      const before = stream.getContents().length;
      const replacement = await downsampleImage(stream, doc.context, level, codec);
      if (replacement) {
        replaceImageContents(stream, replacement);
        stats.imagesReplaced++;
        stats.imageBytesBefore += before;
        stats.imageBytesAfter += replacement.bytes.length;
      } else {
        stats.imagesSkipped++;
      }
    } catch {
      stats.imagesSkipped++;
    }
    onProgress?.(done, images.length);
  }
  const data = await doc.save({ useObjectStreams: true });
  return { data, stats };
}
