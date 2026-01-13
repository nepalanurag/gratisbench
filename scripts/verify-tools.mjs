// Verification: exercises the same src/lib modules the browser tools use.
// Run: node scripts/verify-tools.mjs   (exit 0 = all pass)
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';
import jsqr from 'jsqr';
import {
  mergePdfs,
  splitPdf,
  parsePageRanges,
  imagesToPdf,
  getPageCount,
} from '../src/lib/pdf-core.ts';
import { makeQrPng, makeQrSvg } from '../src/lib/qr-core.ts';
import {
  rebuildImagePdf,
  pageSizeFromBitmap,
  jpegQualityFromSlider,
} from '../src/lib/pdf-compress.ts';
import { redactPdf } from '../src/lib/pdf-redact.ts';
import { signPdf, previewRectToPdf } from '../src/lib/pdf-esign.ts';
import {
  pageFileName,
  validatePageImageOptions,
  PAGE_IMAGE_DPIS,
} from '../src/lib/pdf-images.ts';
import {
  detectInputKind,
  resolveKeepFormat,
  resolveCompressorSettings,
  converterOutputOptions,
  converterInputNote,
  qualityFromSlider,
  outputFileName,
  batchZipName,
  alphaLossRisk,
  savings,
  totalSavings,
  parsePngHeader,
} from '../src/lib/image-core.ts';
import {
  RESUME_SCHEMA_VERSION,
  RESUME_STORAGE_KEY,
  TEMPLATES,
  isTemplateId,
  blankResume,
  exampleResume,
  blankWorkEntry,
  addEntry,
  removeEntry,
  moveEntry,
  validateResume,
  serialize,
  deserialize,
  renderResume,
} from '../src/lib/resume-core.ts';
import {
  INVOICE_SCHEMA_VERSION,
  INVOICE_STORAGE_KEY,
  INVOICE_NUMBER_KEY,
  INVOICE_HISTORY_KEY,
  blankInvoice,
  blankLineItem,
  exampleInvoice,
  parseCents,
  parseQty,
  parsePct,
  lineTotalCents,
  computeTotals,
  CURRENCIES,
  isCurrencyCode,
  formatMoney,
  formatDate,
  nextInvoiceNumber,
  validateInvoice,
  addItem,
  removeItem,
  moveItem,
  serializeInvoice,
  deserializeInvoice,
  upsertHistory,
  removeFromHistory,
  renderInvoice,
} from '../src/lib/invoice-core.ts';
import {
  SIGNATURE_SCHEMA_VERSION,
  SIGNATURE_STORAGE_KEY,
  ACCENT_SWATCHES,
  LAYOUTS,
  isLayoutId,
  isAccentId,
  accentHex,
  blankSignature,
  blankSocialLink,
  exampleSignature,
  validateSignature,
  serializeSignature,
  deserializeSignature,
  renderSignature,
} from '../src/lib/signature-core.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}
function expectThrow(name, fn, snippet) {
  try {
    fn();
    failed++;
    console.log(`  FAIL ${name} (did not throw)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (snippet && !msg.includes(snippet)) {
      failed++;
      console.log(`  FAIL ${name} (wrong message: ${msg})`);
    } else {
      passed++;
      console.log(`  PASS ${name}`);
    }
  }
}
async function expectThrowAsync(name, fn, snippet) {
  try {
    await fn();
    failed++;
    console.log(`  FAIL ${name} (did not throw)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (snippet && !msg.includes(snippet)) {
      failed++;
      console.log(`  FAIL ${name} (wrong message: ${msg})`);
    } else {
      passed++;
      console.log(`  PASS ${name}`);
    }
  }
}

/** Make a simple n-page PDF with labeled pages. */
async function makePdf(n, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} page ${i + 1}`, { x: 50, y: 800, size: 24, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

/** Make a solid-color PNG via pngjs (pure JS, no canvas). */
function makePng(w, h, r, g, b) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function dataUrlToPng(dataUrl) {
  const b64 = dataUrl.split(',')[1];
  return PNG.sync.read(Buffer.from(b64, 'base64'));
}

console.log('== merge ==');
{
  const a = await makePdf(5, 'A');
  const b = await makePdf(3, 'B');
  const out = await mergePdfs([a, b]);
  const doc = await PDFDocument.load(out);
  ok('merges 5+3 pages into 8', doc.getPageCount() === 8, `got ${doc.getPageCount()}`);
  const single = await mergePdfs([a]);
  ok('single file passes through', (await PDFDocument.load(single)).getPageCount() === 5);
  await expectThrowAsync('empty list throws', () => mergePdfs([]), 'at least one');
  ok('merged output is non-trivial bytes', out.length > 1000, `got ${out.length}`);
}

console.log('== parsePageRanges ==');
{
  ok('basic "1-3, 5"', JSON.stringify(parsePageRanges('1-3, 5', 10)) === '[0,1,2,4]');
  ok('reversed range "5-3"', JSON.stringify(parsePageRanges('5-3', 10)) === '[2,3,4]');
  ok('dedupes "2, 2-3"', JSON.stringify(parsePageRanges('2, 2-3', 10)) === '[1,2]');
  ok('sorts "5, 1"', JSON.stringify(parsePageRanges('5, 1', 10)) === '[0,4]');
  ok('whitespace tolerant', JSON.stringify(parsePageRanges(' 1 - 3 , 5 ', 10)) === '[0,1,2,4]');
  expectThrow('page 0 rejected', () => parsePageRanges('0', 10), 'out of range');
  expectThrow('page 11 of 10 rejected', () => parsePageRanges('11', 10), 'out of range');
  expectThrow('garbage rejected', () => parsePageRanges('abc', 10), 'Could not understand');
  expectThrow('empty rejected', () => parsePageRanges(' , ', 10), 'at least one');
  expectThrow('page 0 in range rejected', () => parsePageRanges('2-0', 10), 'out of range');
}

console.log('== split ==');
{
  const src = await makePdf(10, 'S');
  const parts = await splitPdf(src, '1-3; 5; 9-10');
  ok('3 groups -> 3 files', parts.length === 3, `got ${parts.length}`);
  const counts = [];
  for (const p of parts) counts.push((await PDFDocument.load(p.data)).getPageCount());
  ok('page counts [3,1,2]', JSON.stringify(counts) === '[3,1,2]', `got ${counts}`);
  ok('single group named split.pdf', (await splitPdf(src, '2-4'))[0].name === 'split.pdf');
  ok('multi groups named split-part-N', parts[1].name === 'split-part-2.pdf');
  await expectThrowAsync('empty spec throws', () => splitPdf(src, ' ; '), 'Enter page ranges');
  await expectThrowAsync('out-of-range throws', () => splitPdf(src, '1-99'), 'out of range');
  ok('getPageCount works', (await getPageCount(src)) === 10);
}

console.log('== imagesToPdf ==');
{
  const red = makePng(200, 100, 200, 40, 40);
  const blue = makePng(100, 300, 40, 60, 200);
  const imgs = [
    { data: red, mime: 'image/png' },
    { data: blue, mime: 'image/png' },
  ];
  const fit = await imagesToPdf(imgs, 'fit');
  const fitDoc = await PDFDocument.load(fit);
  ok('fit: 2 images -> 2 pages', fitDoc.getPageCount() === 2);
  const p0 = fitDoc.getPage(0).getSize();
  const p1 = fitDoc.getPage(1).getSize();
  ok('fit: page 0 matches image 200x100', Math.abs(p0.width - 200) < 0.01 && Math.abs(p1.height - 300) < 0.01, `${p0.width}x${p0.height}, ${p1.width}x${p1.height}`);
  const a4 = await imagesToPdf(imgs, 'a4');
  const a4Doc = await PDFDocument.load(a4);
  const a4p = a4Doc.getPage(0).getSize();
  ok('a4 page size correct', Math.abs(a4p.width - 595.28) < 0.01 && Math.abs(a4p.height - 841.89) < 0.01);
  const letter = await imagesToPdf(imgs, 'letter');
  const lp = (await PDFDocument.load(letter)).getPage(0).getSize();
  ok('letter page size correct', lp.width === 612 && lp.height === 792);
  await expectThrowAsync('no images throws', () => imagesToPdf([], 'fit'), 'at least one');
}

console.log('== QR ==');
{
  const text = 'https://www.freekit.app/merge-pdf';
  for (const ec of ['L', 'M', 'Q', 'H']) {
    const url = await makeQrPng({ text, size: 512, errorCorrection: ec });
    ok(`PNG generated (EC=${ec})`, url.startsWith('data:image/png;base64,'));
    const png = dataUrlToPng(url);
    ok(`PNG is square (EC=${ec})`, png.width === png.height, `${png.width}x${png.height}`);
    const decoded = jsqr(new Uint8ClampedArray(png.data), png.width, png.height);
    ok(`QR decodes back to input (EC=${ec})`, decoded?.data === text, decoded ? `got "${decoded.data}"` : 'no decode');
  }
  // transparent default background path (what the UI uses)
  const t = await makeQrPng({ text, size: 256, errorCorrection: 'M', light: '#ffffff00' });
  const tp = dataUrlToPng(t);
  const td = jsqr(new Uint8ClampedArray(tp.data), tp.width, tp.height);
  ok('transparent-bg QR still decodes', td?.data === text);
  // long text + error paths
  await expectThrowAsync('empty text throws', () => makeQrPng({ text: '', size: 512, errorCorrection: 'M' }), 'Enter some text');
  await expectThrowAsync('oversize text throws', () => makeQrPng({ text: 'x'.repeat(4001), size: 512, errorCorrection: 'M' }), 'too long');
  const svg = await makeQrSvg({ text, size: 1024, errorCorrection: 'M' });
  ok('SVG generated', svg.includes('<svg') && svg.includes('</svg>') && svg.length > 500, `len ${svg.length}`);
}

console.log('== pdf-compress (rebuild from rendered bitmap stand-ins) ==');
{
  // pdf.js rendering cannot run in Node; these PNGs stand in for rendered pages.
  const big = { data: makePng(400, 400, 180, 60, 60), mime: 'image/png', widthPx: 400, heightPx: 400 };
  const small = { data: makePng(100, 100, 180, 60, 60), mime: 'image/png', widthPx: 100, heightPx: 100 };

  const out = await rebuildImagePdf([big, small, big], 100);
  const doc = await PDFDocument.load(out);
  ok('3 bitmaps -> 3 pages', doc.getPageCount() === 3, `got ${doc.getPageCount()}`);
  const p0 = doc.getPage(0).getSize();
  ok('page size follows bitmap/DPI math (400px @100dpi = 288pt)', Math.abs(p0.width - 288) < 0.01 && Math.abs(p0.height - 288) < 0.01, `${p0.width}x${p0.height}`);
  const p1 = doc.getPage(1).getSize();
  ok('smaller bitmap -> smaller page (100px @100dpi = 72pt)', Math.abs(p1.width - 72) < 0.01, `${p1.width}`);

  const [w, h] = pageSizeFromBitmap(200, 100, 100);
  ok('pageSizeFromBitmap 200px@100dpi = 144x72pt', w === 144 && h === 72, `${w}x${h}`);

  // Size-reduction mechanism: the same content at lower resolution -> fewer bytes.
  const hiRes = await rebuildImagePdf([big], 100);
  const loRes = await rebuildImagePdf([small], 100);
  ok('lower-resolution bitmap yields a smaller PDF', loRes.length < hiRes.length, `${loRes.length} vs ${hiRes.length}`);

  ok('jpegQualityFromSlider(60) = 0.6', jpegQualityFromSlider(60) === 0.6);
  await expectThrowAsync('empty pages throws', () => rebuildImagePdf([], 100), 'no pages');
  await expectThrowAsync('bad DPI throws', () => rebuildImagePdf([big], 0), 'DPI');
  await expectThrowAsync('empty bitmap throws', () => rebuildImagePdf([{ data: new Uint8Array(0), mime: 'image/png', widthPx: 10, heightPx: 10 }], 100), 'empty image');
  await expectThrowAsync('zero-size bitmap throws', () => rebuildImagePdf([{ data: big.data, mime: 'image/png', widthPx: 0, heightPx: 10 }], 100), 'invalid bitmap');
  expectThrow('quality 101 rejected', () => jpegQualityFromSlider(101), 'between 5 and 100');
  expectThrow('quality 0 rejected', () => jpegQualityFromSlider(0), 'between 5 and 100');
}

console.log('== pdf-redact ==');
{
  const src = await makePdf(3, 'R');
  const black = { data: makePng(200, 280, 0, 0, 0), mime: 'image/png', widthPt: 595, heightPt: 842 };
  const out = await redactPdf(src, [{ pageIndex: 1, ...black }]);
  const doc = await PDFDocument.load(out);
  ok('3 pages in, 3 pages out', doc.getPageCount() === 3, `got ${doc.getPageCount()}`);
  const p1 = doc.getPage(1).getSize();
  ok('redacted page keeps original page size', Math.abs(p1.width - 595) < 0.01 && Math.abs(p1.height - 842) < 0.01);
  ok('output is non-trivial bytes', out.length > 1000, `got ${out.length}`);
  await expectThrowAsync('no marks throws', () => redactPdf(src, []), 'at least one area');
  await expectThrowAsync('page index out of range throws', () => redactPdf(src, [{ pageIndex: 5, ...black }]), 'out of range');
  await expectThrowAsync('duplicate page index throws', () => redactPdf(src, [{ pageIndex: 0, ...black }, { pageIndex: 0, ...black }]), 'twice');
  await expectThrowAsync('empty bitmap throws', () => redactPdf(src, [{ pageIndex: 0, data: new Uint8Array(0), mime: 'image/png', widthPt: 10, heightPt: 10 }]), 'empty image');
}

console.log('== pdf-esign ==');
{
  // placement math: preview 680x880 px showing a 595x842 pt page
  const pdf = previewRectToPdf({ x: 340, y: 440, width: 170, height: 44 }, 680, 880, 595, 842);
  ok('x scales linearly', Math.abs(pdf.x - 297.5) < 0.01, `got ${pdf.x}`);
  ok('width scales linearly', Math.abs(pdf.width - 148.75) < 0.01, `got ${pdf.width}`);
  ok('y flips (canvas top -> PDF bottom)', Math.abs(pdf.y - (842 - 484 * (842 / 880))) < 0.01, `got ${pdf.y}`);
  expectThrow('zero-size preview rejected', () => previewRectToPdf({ x: 0, y: 0, width: 1, height: 1 }, 0, 880, 595, 842), 'invalid size');

  const src = await makePdf(2, 'S');
  const sigPng = makePng(120, 40, 20, 30, 60); // stand-in signature bitmap
  const out = await signPdf(src, sigPng, [
    { pageIndex: 0, x: 100, y: 100, width: 150, height: 50 },
    { pageIndex: 1, x: 50, y: 700, width: 120, height: 40 },
  ]);
  const doc = await PDFDocument.load(out);
  ok('signed PDF keeps page count', doc.getPageCount() === 2);
  ok('signed output is non-trivial bytes', out.length > 1000, `got ${out.length}`);
  await expectThrowAsync('no placements throws', () => signPdf(src, sigPng, []), 'at least one page');
  await expectThrowAsync('empty signature throws', () => signPdf(src, new Uint8Array(0), [{ pageIndex: 0, x: 1, y: 1, width: 10, height: 10 }]), 'Draw or type');
  await expectThrowAsync('page out of range throws', () => signPdf(src, sigPng, [{ pageIndex: 7, x: 1, y: 1, width: 10, height: 10 }]), 'out of range');
  await expectThrowAsync('zero-size placement throws', () => signPdf(src, sigPng, [{ pageIndex: 0, x: 1, y: 1, width: 0, height: 10 }]), 'invalid');
}

console.log('== pdf-images helpers ==');
{
  ok('pageFileName basic', pageFileName('report.pdf', 3, 'jpg') === 'report-page-3.jpg');
  ok('pageFileName strips extension', pageFileName('my doc.PDF', 1, 'png') === 'my doc-page-1.png');
  ok('pageFileName falls back for empty stem', pageFileName('.pdf', 2, 'jpg') === 'document-page-2.jpg');
  ok('PAGE_IMAGE_DPIS is 72/150/300', JSON.stringify([...PAGE_IMAGE_DPIS]) === '[72,150,300]');
  expectThrow('dpi 200 rejected', () => validatePageImageOptions({ dpi: 200, format: 'jpg' }), '72, 150, 300');
  expectThrow('bad format rejected', () => validatePageImageOptions({ dpi: 150, format: 'gif' }), 'JPG or PNG');
  let threw = false;
  try { validatePageImageOptions({ dpi: 150, format: 'png' }); } catch { threw = true; }
  ok('valid options pass', !threw);
}

console.log('== image-core ==');
{
  ok('mime png wins', detectInputKind('photo', 'image/png') === 'png');
  ok('mime jpeg', detectInputKind('photo.JPG', 'image/jpeg') === 'jpeg');
  ok('mime wins over extension', detectInputKind('photo.png', 'image/jpeg') === 'jpeg');
  ok('extension fallback bmp', detectInputKind('scan.bmp', '') === 'bmp');
  ok('extension fallback tif', detectInputKind('scan.TIF', 'application/octet-stream') === 'tiff');
  ok('unknown for non-image', detectInputKind('doc.pdf', 'application/pdf') === 'unknown');

  ok('keep png -> png', resolveKeepFormat('png') === 'png');
  ok('keep jpeg -> jpeg', resolveKeepFormat('jpeg') === 'jpeg');
  ok('keep webp -> webp', resolveKeepFormat('webp') === 'webp');
  ok('keep gif -> png', resolveKeepFormat('gif') === 'png');
  ok('keep bmp -> png', resolveKeepFormat('bmp') === 'png');
  ok('keep tiff -> png', resolveKeepFormat('tiff') === 'png');

  const s1 = resolveCompressorSettings('png', 'keep', 80);
  ok('png+keep -> png mime', s1.mime === 'image/png');
  ok('png+keep ignores quality', s1.qualityApplies === false);
  ok('png+keep honesty note mentions lossless', typeof s1.honestyNote === 'string' && s1.honestyNote.includes('lossless'));
  const s2 = resolveCompressorSettings('jpeg', 'keep', 80);
  ok('jpeg+keep -> jpeg, quality applies, no note',
    s2.outputFormat === 'jpeg' && s2.qualityApplies && s2.quality01 === 0.8 && s2.honestyNote === null);
  const s3 = resolveCompressorSettings('png', 'webp', 70);
  ok('png->webp q70', s3.outputFormat === 'webp' && s3.quality01 === 0.7 && s3.qualityApplies);
  const s4 = resolveCompressorSettings('bmp', 'keep', 80);
  ok('bmp+keep -> png with re-encode note',
    s4.outputFormat === 'png' && typeof s4.honestyNote === 'string' && s4.honestyNote.includes('BMP'));

  expectThrow('quality 0 rejected', () => qualityFromSlider(0), 'between 5 and 100');
  expectThrow('quality 101 rejected', () => qualityFromSlider(101), 'between 5 and 100');
  ok('quality 5 -> 0.05', qualityFromSlider(5) === 0.05);

  const noAvif = converterOutputOptions(false);
  ok('3 options without AVIF', noAvif.length === 3 && !noAvif.some((o) => o.format === 'avif'));
  const withAvif = converterOutputOptions(true);
  ok('4 options with AVIF', withAvif.length === 4 && withAvif[3].format === 'avif');

  ok('png->jpeg alpha risk', alphaLossRisk('png', 'jpeg') === true);
  ok('webp->jpeg alpha risk', alphaLossRisk('webp', 'jpeg') === true);
  ok('jpeg->jpeg no risk', alphaLossRisk('jpeg', 'jpeg') === false);
  ok('png->webp no risk', alphaLossRisk('png', 'webp') === false);

  ok('gif still-frame note', (converterInputNote('gif') || '').includes('still frame'));
  ok('tiff browser note', (converterInputNote('tiff') || '').includes('browser'));
  ok('jpeg has no input note', converterInputNote('jpeg') === null);

  ok('outputFileName basic', outputFileName('photo.jpg', '-compressed', 'webp') === 'photo-compressed.webp');
  ok('outputFileName without extension', outputFileName('photo', '-converted', 'png') === 'photo-converted.png');
  ok('outputFileName falls back for empty stem', outputFileName('.jpg', '-compressed', 'jpeg') === 'image-compressed.jpg');
  ok('batchZipName compress', batchZipName('compress') === 'compressed-images.zip');
  ok('batchZipName convert', batchZipName('convert') === 'converted-images.zip');

  const sv = savings(1000, 700);
  ok('savings 30%', sv.bytesSaved === 300 && sv.percent === 30, JSON.stringify(sv));
  const neg = savings(1000, 1200);
  ok('negative savings when result grows', neg.bytesSaved === -200 && neg.percent === -20);
  const tot = totalSavings([{ original: 1000, result: 700 }, { original: 2000, result: 1000 }]);
  ok('totalSavings math', tot.totalOriginal === 3000 && tot.totalResult === 1700 && tot.bytesSaved === 1300 && tot.percent === 43.3, JSON.stringify(tot));

  // Real PNG round trip: generate bytes with pngjs (encode), decode the header here.
  const rgba = new PNG({ width: 37, height: 21 });
  for (let i = 0; i < rgba.data.length; i += 4) {
    rgba.data[i] = 10;
    rgba.data[i + 1] = 20;
    rgba.data[i + 2] = 30;
    rgba.data[i + 3] = i % 8 === 0 ? 0 : 255; // some transparent pixels
  }
  const rgbaInfo = parsePngHeader(new Uint8Array(PNG.sync.write(rgba)));
  ok('pngjs RGBA round trip keeps 37x21', rgbaInfo.width === 37 && rgbaInfo.height === 21, `${rgbaInfo.width}x${rgbaInfo.height}`);
  ok('pngjs RGBA round trip reports alpha', rgbaInfo.hasAlpha === true && rgbaInfo.colorType === 6, `ct=${rgbaInfo.colorType}`);
  const rgb = new PNG({ width: 12, height: 9 });
  for (let i = 0; i < rgb.data.length; i += 4) {
    rgb.data[i] = 128;
    rgb.data[i + 1] = 64;
    rgb.data[i + 2] = 32;
    rgb.data[i + 3] = 255; // fully opaque
  }
  const rgbBytes = Buffer.from(PNG.sync.write(rgb));
  // pngjs always writes color type 6 (RGBA); flip the IHDR byte to exercise the no-alpha branch.
  rgbBytes[25] = 2;
  const rgbInfo = parsePngHeader(new Uint8Array(rgbBytes));
  ok('rgb PNG keeps 12x9', rgbInfo.width === 12 && rgbInfo.height === 9);
  ok('color type 2 reports no alpha channel', rgbInfo.hasAlpha === false && rgbInfo.colorType === 2, `ct=${rgbInfo.colorType}`);
  expectThrow('garbage rejected by parsePngHeader', () => parsePngHeader(new Uint8Array([1, 2, 3])), 'Not a PNG');
  expectThrow('zero-size PNG rejected', () => parsePngHeader(new Uint8Array(PNG.sync.write(new PNG({ width: 0, height: 0 })))), 'zero size');
}

console.log('== resume-core ==');
{
  const blank = blankResume();
  ok('blank resume has schema version', blank.version === RESUME_SCHEMA_VERSION);
  ok('blank resume has empty contact', blank.contact.fullName === '' && blank.contact.email === '');
  ok('blank resume lists start empty',
    blank.experience.length === 0 && blank.education.length === 0 && blank.skills.length === 0 &&
    blank.projects.length === 0 && blank.certifications.length === 0 && blank.languages.length === 0);
  ok('storage key is namespaced', RESUME_STORAGE_KEY.startsWith('freekit.resume-builder'));

  // pure entry ops
  const e1 = { ...blankWorkEntry(), title: 'First' };
  const e2 = { ...blankWorkEntry(), title: 'Second' };
  const e3 = { ...blankWorkEntry(), title: 'Third' };
  const base = [e1, e2];
  const added = addEntry(base, e3);
  ok('addEntry appends', added.length === 3 && added[2] === e3);
  ok('addEntry does not mutate input', base.length === 2);
  const removed = removeEntry(added, e2.id);
  ok('removeEntry drops by id', removed.length === 2 && removed.every((e) => e.id !== e2.id));
  ok('removeEntry keeps order', removed[0] === e1 && removed[1] === e3);
  const movedDown = moveEntry(added, e1.id, 1);
  ok('moveEntry down swaps', movedDown[0] === e2 && movedDown[1] === e1 && movedDown[2] === e3);
  const movedUp = moveEntry(added, e3.id, -1);
  ok('moveEntry up swaps', movedUp[1] === e3 && movedUp[2] === e2);
  ok('moveEntry is a no-op at the top', moveEntry(added, e1.id, -1) === added);
  ok('moveEntry is a no-op at the bottom', moveEntry(added, e3.id, 1) === added);
  ok('moveEntry unknown id is a no-op', moveEntry(added, 'nope', 1) === added);
  ok('moveEntry does not mutate input', added[0] === e1 && added[1] === e2);

  // validation
  const blankProblems = validateResume(blankResume());
  ok('blank resume fails validation', blankProblems.length === 3, blankProblems.join(' | '));
  ok('blank validation asks for a name', blankProblems.some((p) => p.includes('full name')));
  ok('blank validation asks for contact', blankProblems.some((p) => p.includes('email address or a phone number')));
  ok('blank validation asks for an entry', blankProblems.some((p) => p.includes('work experience or education')));
  const example = exampleResume();
  ok('example resume validates clean', validateResume(example).length === 0);
  const noContact = exampleResume();
  noContact.contact.email = '';
  noContact.contact.phone = '';
  ok('missing email+phone flagged', validateResume(noContact).some((p) => p.includes('email address')));

  // serialize / deserialize
  const round = deserialize(serialize(example));
  ok('round trip keeps name', round.contact.fullName === 'Sam Rivera');
  ok('round trip keeps entry counts',
    round.experience.length === 3 && round.skills.length === 3 && round.languages.length === 2);
  ok('round trip keeps bullets', round.experience[0].bullets.length === 3);
  ok('corrupt JSON falls back to blank', deserialize('not json{{{').contact.fullName === '');
  ok('null falls back to blank', deserialize(null).experience.length === 0);
  ok('empty string falls back to blank', deserialize('').education.length === 0);
  ok('wrong schema version falls back to blank',
    deserialize(JSON.stringify({ ...example, version: 999 })).contact.fullName === '');
  ok('non-object falls back to blank', deserialize('[1,2,3]').summary === '');
  ok('partial data merges onto defaults', (() => {
    const r = deserialize(JSON.stringify({ version: 1, contact: { fullName: 'Jo' } }));
    return r.contact.fullName === 'Jo' && r.contact.email === '' && r.experience.length === 0;
  })());
  ok('entries without ids get ids', (() => {
    const r = deserialize(JSON.stringify({ version: 1, experience: [{ title: 'Dev' }] }));
    return r.experience.length === 1 && typeof r.experience[0].id === 'string' && r.experience[0].id.length > 0;
  })());

  // templates
  ok('three templates defined', TEMPLATES.length === 3);
  ok('template ids are classic/modern/compact',
    JSON.stringify(TEMPLATES.map((t) => t.id)) === '["classic","modern","compact"]');
  ok('every template has an ATS note', TEMPLATES.every((t) => t.atsNote.length > 10));
  ok('isTemplateId accepts known ids', isTemplateId('classic') && isTemplateId('modern') && isTemplateId('compact'));
  ok('isTemplateId rejects junk', !isTemplateId('fancy') && !isTemplateId('') && !isTemplateId(null));

  // rendering
  for (const t of ['classic', 'modern', 'compact']) {
    const html = renderResume(example, t);
    ok(`${t} renders the name`, html.includes('Sam Rivera'));
    ok(`${t} renders work experience`, html.includes('Northwind Mobile') && html.includes('Work Experience'));
    ok(`${t} renders skills`, html.includes('Figma'));
    ok(`${t} renders education`, html.includes('California College of the Arts'));
  }
  const modern = renderResume(example, 'modern');
  ok('modern uses sidebar structure', modern.includes('rs-side') && modern.includes('rs-main'));
  const evil = blankResume();
  evil.contact.fullName = '<script>alert(1)</script>';
  evil.summary = 'a < b & "c"';
  const evilHtml = renderResume(evil, 'classic');
  ok('rendering escapes HTML in name', evilHtml.includes('&lt;script&gt;') && !evilHtml.includes('<script>alert'));
  ok('rendering escapes HTML in summary', evilHtml.includes('a &lt; b &amp; &quot;c&quot;'));
  ok('blank resume still renders a document shell', renderResume(blankResume(), 'classic').includes('rs-sec') === false);
  ok('skipped when empty: no work section for blank', !renderResume(blankResume(), 'classic').includes('Work Experience'));
}

console.log('== invoice-core ==');
{
  // money parsing
  ok('parseCents "$1,234.56"', parseCents('$1,234.56') === 123456, `${parseCents('$1,234.56')}`);
  ok('parseCents european "1.234,56"', parseCents('1.234,56') === 123456, `${parseCents('1.234,56')}`);
  ok('parseCents rounds "19.999" to 2000', parseCents('19.999') === 2000, `${parseCents('19.999')}`);
  ok('parseCents negative "-5.00"', parseCents('-5.00') === -500);
  ok('parseCents garbage is 0', parseCents('abc') === 0 && parseCents('') === 0 && parseCents(null) === 0);
  ok('parseCents number input', parseCents(19.99) === 1999);
  ok('parseQty "2.5"', parseQty('2.5') === 2.5);
  ok('parseQty negative is 0', parseQty('-3') === 0 && parseQty('abc') === 0);

  // the required precision case: 3 x $19.99 + 8.5% tax - $5 discount
  const inv = blankInvoice();
  inv.items = [{ ...blankLineItem(), description: 'Widget', qty: 3, rate: '19.99' }];
  inv.taxPct = '8.5';
  inv.discountType = 'flat';
  inv.discountValue = '5.00';
  const t = computeTotals(inv);
  ok('3 x $19.99 subtotal is 5997c', t.subtotalCents === 5997, `${t.subtotalCents}`);
  ok('flat $5 discount is 500c', t.discountCents === 500);
  ok('8.5% tax on $54.97 is 467c', t.taxCents === 467, `${t.taxCents}`);
  ok('total is 5964c = $59.64', t.totalCents === 5964 && formatMoney(t.totalCents, 'USD') === '$59.64', `${t.totalCents} ${formatMoney(t.totalCents, 'USD')}`);
  ok('lineTotalCents fractional qty', lineTotalCents(2.5, 1999) === 4998);

  // percent discount + clamping
  const inv2 = blankInvoice();
  inv2.items = [{ ...blankLineItem(), description: 'X', qty: 1, rate: '100.00' }];
  inv2.discountType = 'percent';
  inv2.discountValue = '10';
  const t2 = computeTotals(inv2);
  ok('10% discount on $100 is $10', t2.discountCents === 1000 && t2.taxableCents === 9000);
  inv2.discountValue = '150';
  const t3 = computeTotals(inv2);
  ok('150% discount clamps at subtotal', t3.discountCents === 10000 && t3.totalCents === 0);

  // currencies
  ok('22 currencies listed', CURRENCIES.length === 22);
  ok('isCurrencyCode accepts USD/JPY', isCurrencyCode('USD') && isCurrencyCode('jpy'));
  ok('isCurrencyCode rejects junk', !isCurrencyCode('XXX') && !isCurrencyCode(''));
  ok('JPY renders zero decimals', formatMoney(1999, 'JPY') === '¥20' || formatMoney(1999, 'JPY') === '￥20', formatMoney(1999, 'JPY'));
  ok('unknown currency falls back to USD', formatMoney(100, 'NOPE') === '$1.00');
  ok('formatDate', formatDate('2026-09-23') === 'Sep 23, 2026', formatDate('2026-09-23'));
  ok('formatDate passes garbage through', formatDate('soon') === 'soon');

  // number sequencing
  ok('INV-0042 -> INV-0043', nextInvoiceNumber('INV-0042') === 'INV-0043');
  ok('plain 100 -> 101', nextInvoiceNumber('100') === '101');
  ok('INV-2026-009 -> INV-2026-010', nextInvoiceNumber('INV-2026-009') === 'INV-2026-010');
  ok('empty starts INV-0001', nextInvoiceNumber('') === 'INV-0001' && nextInvoiceNumber(null) === 'INV-0001');
  ok('width preserved past rollover', nextInvoiceNumber('INV-0099') === 'INV-0100');

  // validation
  const blankProblems = validateInvoice(blankInvoice());
  ok('blank invoice fails validation', blankProblems.length >= 3, blankProblems.join(' | '));
  ok('blank validation asks for business name', blankProblems.some((p) => p.includes('business name')));
  ok('blank validation asks for invoice number', blankProblems.some((p) => p.includes('invoice number')));
  ok('blank validation asks for line item', blankProblems.some((p) => p.includes('line item')));
  const ex = exampleInvoice();
  ok('example invoice validates clean', validateInvoice(ex).length === 0);
  const badTax = exampleInvoice();
  badTax.taxPct = 'abc';
  ok('bad tax flagged', validateInvoice(badTax).some((p) => p.includes('tax rate')));
  const badDates = exampleInvoice();
  badDates.dueDate = '2026-01-01';
  ok('due-before-issue flagged', validateInvoice(badDates).some((p) => p.includes('due date')));

  // entry ops
  const a = { ...blankLineItem(), description: 'A' };
  const b = { ...blankLineItem(), description: 'B' };
  ok('addItem appends', addItem([a], b).length === 2);
  ok('removeItem drops by id', removeItem([a, b], a.id).length === 1);
  const moved = moveItem([a, b], a.id, 1);
  ok('moveItem swaps', moved[0] === b && moved[1] === a);
  const edgeList = [a, b];
  ok('moveItem no-op at top', moveItem(edgeList, a.id, -1) === edgeList);
  ok('moveItem no-op at bottom', moveItem(edgeList, b.id, 1) === edgeList);

  // serialize / deserialize
  const round = deserializeInvoice(serializeInvoice(ex));
  ok('round trip keeps number', round.number === 'INV-0007');
  ok('round trip keeps 3 items', round.items.length === 3);
  ok('round trip keeps business name', round.business.name === 'Rivera Design Studio');
  ok('round trip keeps currency', round.currency === 'USD');
  ok('corrupt JSON falls back to blank', deserializeInvoice('nope{{{').items.length === 1);
  ok('wrong version falls back to blank', deserializeInvoice(JSON.stringify({ ...ex, version: 999 })).business.name === '');
  ok('foreign logo url dropped', deserializeInvoice(JSON.stringify({ ...ex, business: { logoDataUrl: 'https://evil/x.png' } })).business.logoDataUrl === '');
  ok('schema version + keys namespaced',
    INVOICE_SCHEMA_VERSION === 1 && INVOICE_STORAGE_KEY.startsWith('freekit.invoice-generator') &&
    INVOICE_NUMBER_KEY.startsWith('freekit.invoice-generator') && INVOICE_HISTORY_KEY.startsWith('freekit.invoice-generator'));

  // history
  const h1 = upsertHistory([], ex);
  ok('upsertHistory adds', h1.length === 1);
  const h2 = upsertHistory(h1, { ...ex, notes: 'v2' });
  ok('upsertHistory replaces same number', h2.length === 1 && h2[0].notes === 'v2');
  ok('removeFromHistory', removeFromHistory(h2, 'INV-0007').length === 0);

  // rendering
  const html = renderInvoice(ex);
  ok('renders business name', html.includes('Rivera Design Studio'));
  ok('renders INVOICE heading', html.includes('>Invoice<'));
  ok('renders line item', html.includes('Onboarding flow redesign'));
  ok('renders amount due', html.includes('Amount due'));
  ok('rendering escapes HTML', (() => {
    const evil = exampleInvoice();
    evil.business.name = '<script>alert(1)</script>';
    evil.items[0].description = 'a < b';
    const h = renderInvoice(evil);
    return h.includes('&lt;script&gt;') && !h.includes('<script>alert') && h.includes('a &lt; b');
  })());
  ok('evil logo not embedded', (() => {
    const evil = exampleInvoice();
    evil.business.logoDataUrl = 'javascript:alert(1)';
    return !renderInvoice(evil).includes('javascript:');
  })());
}

console.log('== signature-core ==');
{
  const ex = exampleSignature();
  const layouts = ['stacked', 'two-column', 'minimal'];
  ok('three layouts defined', LAYOUTS.length === 3 && layouts.every((l) => LAYOUTS.some((x) => x.id === l)));
  ok('isLayoutId accepts known', isLayoutId('stacked') && isLayoutId('two-column') && isLayoutId('minimal'));
  ok('isLayoutId rejects junk', !isLayoutId('fancy') && !isLayoutId(null));
  ok('six accent swatches', ACCENT_SWATCHES.length === 6);
  ok('accentHex brick', accentHex('brick') === '#a63d21');
  ok('accentHex junk falls back', accentHex('nope') === '#a63d21');
  ok('isAccentId', isAccentId('navy') && !isAccentId('rainbow'));

  for (const layout of layouts) {
    const html = renderSignature({ ...ex, layout });
    ok(`${layout} renders the name`, html.includes('Sam Rivera'));
    ok(`${layout} uses inline styles`, html.includes('style="'));
    ok(`${layout} has no class attributes`, !/class=/.test(html), html.slice(0, 120));
    ok(`${layout} has no style block`, !/<style/i.test(html));
    ok(`${layout} uses a table`, html.includes('<table'));
    ok(`${layout} carries the accent color`, html.includes('#a63d21'));
  }
  ok('minimal omits photo markup', !renderSignature({ ...ex, layout: 'minimal', photoDataUrl: 'data:image/png;base64,AAA' }).includes('<img'));
  ok('two-column shows photo', renderSignature({ ...ex, layout: 'two-column', photoDataUrl: 'data:image/png;base64,AAA' }).includes('<img'));

  const evil = blankSignature();
  evil.name = '<script>alert(1)</script>';
  evil.company = 'A & B "Co"';
  evil.website = 'not a url at all !!!';
  const evilHtml = renderSignature(evil);
  ok('escaping: name', evilHtml.includes('&lt;script&gt;') && !evilHtml.includes('<script>alert'));
  ok('escaping: company', evilHtml.includes('A &amp; B &quot;Co&quot;'));
  ok('bad website gets no href', !/href="[^"]*not a url/.test(evilHtml) && evilHtml.includes('not a url at all'));

  const linky = blankSignature();
  linky.name = 'Jo';
  linky.socials = [{ ...blankSocialLink(), label: 'LinkedIn', url: 'linkedin.com/in/jo' }];
  const linkyHtml = renderSignature(linky);
  ok('bare domain gets https://', linkyHtml.includes('https://linkedin.com/in/jo'));

  const probs = validateSignature(blankSignature());
  ok('blank signature needs a name', probs.length === 1 && probs[0].includes('name'));
  ok('example validates clean', validateSignature(ex).length === 0);
  const badMail = exampleSignature();
  badMail.email = 'not-an-email';
  ok('bad email flagged', validateSignature(badMail).some((p) => p.includes('email')));

  const round = deserializeSignature(serializeSignature(ex));
  ok('round trip keeps name', round.name === 'Sam Rivera');
  ok('round trip keeps socials', round.socials.length === 2 && round.socials[0].label === 'LinkedIn');
  ok('round trip keeps layout/accent', round.layout === 'two-column' && round.accent === 'brick');
  ok('corrupt JSON falls back to blank', deserializeSignature('{{{').name === '');
  ok('wrong version falls back to blank', deserializeSignature(JSON.stringify({ ...ex, version: 999 })).name === '');
  ok('unknown layout falls back to two-column', deserializeSignature(JSON.stringify({ ...ex, layout: 'fancy' })).layout === 'two-column');
  ok('non-image photo dropped', deserializeSignature(JSON.stringify({ ...ex, photoDataUrl: 'https://x/y.png' })).photoDataUrl === '');
  ok('storage key namespaced', SIGNATURE_STORAGE_KEY.startsWith('freekit.email-signature') && SIGNATURE_SCHEMA_VERSION === 1);
}

console.log('== element-id cross-checks (glue ids exist in pages) ==');
{
  /** Every el('...') id used by a glue module must exist as id="..." in its page
   *  or in the HTML the glue itself renders into the page. */
  function checkGlueIds(glueFile, pageFile) {
    const glue = readFileSync(join(ROOT, glueFile), 'utf8');
    const page = readFileSync(join(ROOT, pageFile), 'utf8');
    const haystack = page + '\n' + glue;
    const ids = new Set();
    for (const m of glue.matchAll(/el(?:<[^>]+>)?\(\s*['"`]([\w-]+)['"`]\s*\)/g)) ids.add(m[1]);
    for (const m of glue.matchAll(/getElementById\(\s*['"`]([\w-]+)['"`]\s*\)/g)) ids.add(m[1]);
    for (const id of ids) {
      ok(`${glueFile.split('/').pop()} #${id} exists in page or glue-rendered HTML`, haystack.includes(`id="${id}"`), `missing id="${id}"`);
    }
  }
  checkGlueIds('src/tools/invoice-generator.ts', 'src/pages/invoice-generator.astro');
  checkGlueIds('src/tools/email-signature-generator.ts', 'src/pages/email-signature-generator.astro');
}

console.log('== glue module smoke import (no top-level DOM access) ==');
{
  // These must import without touching `document` at module scope.
  const mods = [
    '../src/tools/common.ts',
    '../src/tools/pdf-render.ts',
    '../src/tools/image-canvas.ts',
    '../src/tools/image-compressor.ts',
    '../src/tools/image-converter.ts',
    '../src/tools/merge-pdf.ts',
    '../src/tools/split-pdf.ts',
    '../src/tools/images-to-pdf.ts',
    '../src/tools/pdf-compressor.ts',
    '../src/tools/pdf-to-jpg.ts',
    '../src/tools/pdf-redactor.ts',
    '../src/tools/pdf-esignature.ts',
    '../src/tools/qr-generator.ts',
    '../src/tools/resume-builder.ts',
    '../src/tools/invoice-generator.ts',
    '../src/tools/email-signature-generator.ts',
  ];
  for (const m of mods) {
    await import(m);
    ok(`imports cleanly: ${m.split('/').pop()}`, true);
  }
  const { ICONS } = await import('../src/tools/common.ts');
  ok('ICONS exported', !!(ICONS.up && ICONS.down && ICONS.x));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
