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
