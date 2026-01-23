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
  extractPages,
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
  parseResumeText,
  parsedToResumeData,
  pdfItemsToLines,
} from '../src/lib/resume-import.ts';
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
import {
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORAGE_KEY,
  blankBusinessProfile,
  profileIsEmpty,
  sanitizeBusinessProfile,
  loadBusinessProfile,
  saveBusinessProfile,
  clearBusinessProfile,
  exportBusinessProfile,
  parseBusinessProfileFile,
} from '../src/lib/business-profile.ts';
import {
  clamp,
  formatTime,
  parseTimeInput,
  estimateVideoBitrateKbps,
  mbToBytes,
  encodeWav,
  parseWavHeader,
  readWavSample,
  floatToInt16,
  resampleLinear,
  computePeaks,
  sliceChannels,
  validateTrimRange,
  stemOf,
  withExtension,
  preferredRecorderMimeTypes,
} from '../src/lib/media-core.ts';
import { encodeMp3, mp3SafeSampleRate } from '../src/lib/mp3-encode.ts';
import {
  validateBgChoice,
  bgFillColor,
  bgOutputFileName,
  bgStageFromProgressKey,
  bgProgressLabel,
  bgRemoveErrorMessage,
  BG_MODEL_DOWNLOAD_NOTE,
} from '../src/lib/bgremove-core.ts';
import {
  OCR_LANGUAGES,
  DEFAULT_OCR_LANG,
  OCR_ENGINE_NOTE,
  resolveOcrLanguage,
  validateOcrOptions,
  cleanupOcrText,
  ocrOutputFileName,
  ocrProgressLabel,
  ocrErrorMessage,
} from '../src/lib/ocr-core.ts';
import {
  validateTraceOptions,
  resolveImageTracerOptions,
  scaleForTrace,
  traceOutputFileName,
  tracePreviewFileName,
  validateSvg,
  countSvgPaths,
  svgDimensions,
  traceErrorMessage,
  TRACE_DETAIL_DEFAULT,
  TRACE_ENGINE_NOTE,
} from '../src/lib/trace-core.ts';
import {
  BUDGET_SCHEMA_VERSION,
  BUDGET_STORAGE_KEY,
  blankIncomeEntry,
  blankCategory,
  blankMonth,
  blankStore as blankBudgetStore,
  exampleMonth,
  monthKey,
  parseMonthKey,
  currentMonthKey,
  shiftMonth,
  monthLabel,
  totalIncomeCents,
  totalPlannedCents,
  totalActualCents,
  remainingToAssignCents,
  actualLeftCents,
  categoryLeftCents,
  validateBudgetMonth,
  addIncomeEntry,
  removeIncomeEntry,
  addCategory,
  removeCategory,
  serializeStore as serializeBudgetStore,
  deserializeStore as deserializeBudgetStore,
} from '../src/lib/budget-core.ts';
import {
  SUBS_SCHEMA_VERSION,
  SUBS_STORAGE_KEY,
  isCycle,
  blankSubscription,
  blankStore as blankSubsStore,
  exampleSubscriptions,
  isValidISODate,
  addMonthsClamped,
  addYearsClamped,
  nextRenewalDate,
  daysUntil,
  renewalLabel,
  formatISODate,
  monthlyEquivalentCents,
  totals as subsTotals,
  sortedByRenewal,
  upcomingRenewals,
  validateSubscription,
  addSubscription,
  removeSubscription,
  updateSubscription,
  serializeStore as serializeSubsStore,
  deserializeStore as deserializeSubsStore,
} from '../src/lib/subs-core.ts';
import {
  LOGO_SCHEMA_VERSION,
  LOGO_STORAGE_KEY,
  LOGO_ICONS,
  LOGO_SHAPES,
  LOGO_FONTS,
  LOGO_PRESETS,
  LOGO_PNG_SIZES,
  logoIconById,
  logoSvg,
  logoPngSize,
  logoFileName,
  blankLogoSpec,
  exampleLogoSpec,
  sanitizeLogoSpec,
  serializeLogoSpec,
  deserializeLogoSpec,
  fitFontSize as logoFitFontSize,
} from '../src/lib/logo-core.ts';
import {
  OG_SCHEMA_VERSION,
  OG_STORAGE_KEY,
  OG_PRESETS,
  OG_PATTERNS,
  OG_THEMES,
  ogPresetById,
  blankOgSpec,
  exampleOgSpec,
  sanitizeOgSpec,
  serializeOgSpec,
  deserializeOgSpec,
  wrapLines,
  fitFontSize as ogFitFontSize,
  layoutOg,
  ogFileName,
} from '../src/lib/og-core.ts';
import {
  MOCKUP_SCHEMA_VERSION,
  MOCKUP_STORAGE_KEY,
  MOCKUP_FRAMES,
  MOCKUP_BACKGROUNDS,
  blankMockupSettings,
  sanitizeMockupSettings,
  serializeMockupSettings,
  deserializeMockupSettings,
  mockupBackgroundById,
  fitContain,
  frameGeometry,
  mockupFileName,
} from '../src/lib/mockup-core.ts';
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
  const picked = await extractPages(src, [3, 1, 2, 3]);
  ok('extractPages dedupes and keeps order', (await PDFDocument.load(picked)).getPageCount() === 3);
  const pickedOrdered = await extractPages(src, [9, 2]);
  ok('extractPages honors given order', (await PDFDocument.load(pickedOrdered)).getPageCount() === 2);
  await expectThrowAsync('extractPages rejects empty', () => extractPages(src, []), 'at least one page');
  await expectThrowAsync('extractPages rejects out-of-range only', () => extractPages(src, [99]), 'at least one page');
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

console.log('== resume-import ==');
{
  const sample = [
    'Priya Sharma',
    'Senior Product Designer',
    'priya.sharma@example.com · +1 (415) 555-0132 · San Francisco, CA',
    'linkedin.com/in/priyasharma',
    '',
    'Summary',
    'Product designer with 6 years of experience shipping mobile apps used by millions.',
    '',
    'Experience',
    'Senior Product Designer, Northwind Mobile',
    'San Francisco, CA · Mar 2021 – Present',
    '• Led redesign of onboarding; activation rose from 31% to 47%.',
    '• Built the design system used by 4 product teams.',
    '',
    'Product Designer, Brightline Health',
    'Remote · Jun 2018 – Feb 2021',
    '• Designed the patient scheduling app from zero to launch.',
    '• Partnered with clinicians to simplify intake forms.',
    '',
    'Education',
    'BFA, Communication Design — California College of the Arts',
    '2012 – 2016',
    '',
    'Skills',
    'Design: Figma, Sketch, prototyping, design systems',
    'Code: HTML, CSS, JavaScript',
  ].join('\n');

  const parsed = parseResumeText(sample);
  ok('import finds name', parsed.fullName === 'Priya Sharma', parsed.fullName);
  ok('import finds headline', parsed.title === 'Senior Product Designer', parsed.title);
  ok('import finds email', parsed.email === 'priya.sharma@example.com', parsed.email);
  ok('import finds phone', parsed.phone === '+1 (415) 555-0132', parsed.phone);
  ok('import finds location', parsed.location === 'San Francisco, CA', parsed.location);
  ok('import finds linkedin', parsed.linkedin === 'linkedin.com/in/priyasharma', parsed.linkedin);
  ok('import finds summary', parsed.summary.startsWith('Product designer with 6 years'));
  ok('import finds two jobs', parsed.experience.length === 2, String(parsed.experience.length));
  const j1 = parsed.experience[0];
  ok('first job title/company', j1.title === 'Senior Product Designer' && j1.company === 'Northwind Mobile', `${j1.title} @ ${j1.company}`);
  ok('first job location', j1.location === 'San Francisco, CA', j1.location);
  ok('first job dates', j1.start === 'Mar 2021' && j1.end === '' && j1.current === true, `${j1.start} - ${j1.end} current=${j1.current}`);
  ok('first job bullets', j1.bullets.length === 2 && j1.bullets[0].startsWith('Led redesign'), j1.bullets.join(' | '));
  const j2 = parsed.experience[1];
  ok('second job title/company', j2.title === 'Product Designer' && j2.company === 'Brightline Health', `${j2.title} @ ${j2.company}`);
  ok('second job dates', j2.start === 'Jun 2018' && j2.end === 'Feb 2021' && j2.current === false, `${j2.start} - ${j2.end}`);
  ok('second job location', j2.location === 'Remote', j2.location);
  ok('import finds education', parsed.education.length === 1, String(parsed.education.length));
  const edu = parsed.education[0];
  ok('education degree/school', edu.degree === 'BFA, Communication Design' && edu.school === 'California College of the Arts', `${edu.degree} / ${edu.school}`);
  ok('education dates', edu.start === '2012' && edu.end === '2016', `${edu.start}-${edu.end}`);
  ok('import groups skills', parsed.skills.length === 2 && parsed.skills[0].label === 'Design' && parsed.skills[1].label === 'Code');
  ok('skill items split', parsed.skills[0].items.includes('Figma') && parsed.skills[1].items.includes('JavaScript'), JSON.stringify(parsed.skills));

  // dash-separated header variant
  const dashy = parseResumeText(['Jane Doe', 'Experience', 'UI Designer - Pixelworks Studio', 'Jan 2016 - May 2018', '• Shipped websites for 15 clients.'].join('\n'));
  ok('dash header splits title/company', dashy.experience[0].title === 'UI Designer' && dashy.experience[0].company === 'Pixelworks Studio', `${dashy.experience[0].title} @ ${dashy.experience[0].company}`);

  // mapping to ResumeData
  const data = parsedToResumeData(parsed);
  ok('mapped data has schema version', data.version === RESUME_SCHEMA_VERSION);
  ok('mapped data keeps contact', data.contact.fullName === 'Priya Sharma' && data.contact.email === 'priya.sharma@example.com');
  ok('mapped entries have unique ids', (() => {
    const ids = data.experience.map((e) => e.id).concat(data.education.map((e) => e.id));
    return ids.every((id) => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length;
  })());
  ok('mapped data keeps bullets', data.experience[0].bullets.length === 2);
  ok('mapped skills become groups', data.skills[0].label === 'Design' && data.skills[0].items.includes('Figma'));
  ok('mapped data round-trips', deserialize(serialize(data)).contact.phone === '+1 (415) 555-0132');

  // empty input
  const empty = parseResumeText('');
  ok('empty text gives blank parse', empty.fullName === '' && empty.experience.length === 0 && empty.skills.length === 0);

  // pdf.js item -> line reconstruction (the PDF extractor feeds these to the parser)
  const eolItems = [
    { str: 'Priya Sharma', hasEOL: true, transform: [1, 0, 0, 1, 72, 720] },
    { str: 'priya.sharma@example.com', hasEOL: false, transform: [1, 0, 0, 1, 72, 706] },
    { str: ' · ', hasEOL: false, transform: [1, 0, 0, 1, 200, 706] },
    { str: 'San Francisco, CA', hasEOL: true, transform: [1, 0, 0, 1, 210, 706] },
    { str: 'Experience', hasEOL: true, transform: [1, 0, 0, 1, 72, 690] },
  ];
  const eolLines = pdfItemsToLines(eolItems);
  ok('hasEOL items become lines', JSON.stringify(eolLines) === JSON.stringify(['Priya Sharma', 'priya.sharma@example.com · San Francisco, CA', 'Experience']), JSON.stringify(eolLines));
  const eolParsed = parseResumeText(eolLines.join('\n'));
  ok('parsed from reconstructed lines finds name', eolParsed.fullName === 'Priya Sharma', eolParsed.fullName);

  const yItems = [
    { str: 'Priya Sharma', transform: [1, 0, 0, 1, 72, 720] },
    { str: 'priya.sharma@example.com', transform: [1, 0, 0, 1, 72, 706] },
    { str: ' · ', transform: [1, 0, 0, 1, 200, 706.4] },
    { str: 'San Francisco, CA', transform: [1, 0, 0, 1, 215, 705.6] },
    { str: 'Experience', transform: [1, 0, 0, 1, 72, 690] },
  ];
  const yLines = pdfItemsToLines(yItems);
  ok('Y-grouping fallback joins same-line items', yLines.length === 3 && yLines[1].includes('San Francisco, CA'), JSON.stringify(yLines));
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

console.log('== business-profile ==');
{
  const blank = blankBusinessProfile();
  ok('blank profile is empty', profileIsEmpty(blank));
  ok('filled profile is not empty', !profileIsEmpty({ ...blank, name: 'Acme' }));
  ok('storage key namespaced', PROFILE_STORAGE_KEY === 'freekit.business-profile.v1' && PROFILE_SCHEMA_VERSION === 1);
  ok('sanitize handles null', profileIsEmpty(sanitizeBusinessProfile(null)));

  const valid = {
    name: 'Acme Co', tagline: 'We make things', address: '1 Main St', email: 'a@b.co',
    phone: '123', website: 'acme.co', color: '#a63d21', logoDataUrl: 'data:image/png;base64,AAA',
    extra: 'should be dropped', version: 1,
  };
  const parsed = parseBusinessProfileFile(JSON.stringify(valid));
  ok('valid JSON parses', parsed.name === 'Acme Co' && parsed.tagline === 'We make things');
  ok('unknown fields dropped', !('extra' in parsed));
  ok('logo data URL kept', parsed.logoDataUrl === 'data:image/png;base64,AAA');
  ok('valid hex color kept', parsed.color === '#a63d21');

  const coerced = parseBusinessProfileFile(JSON.stringify({
    name: 42, email: null, tagline: ['a'], color: 'not-a-color', logoDataUrl: 'https://x/y.png',
  }));
  ok('wrong types coerced to empty', coerced.name === '' && coerced.email === '' && coerced.tagline === '');
  ok('bad color dropped', coerced.color === '');
  ok('non-data-url logo dropped', coerced.logoDataUrl === '');

  expectThrow('junk JSON throws', () => parseBusinessProfileFile('{{{'), 'business profile');
  expectThrow('empty string throws', () => parseBusinessProfileFile(''), 'business profile');

  // save/load go through the in-memory fallback under node (no localStorage here)
  saveBusinessProfile({ ...blankBusinessProfile(), name: 'Round Trip Co', website: 'rt.co' });
  const back = loadBusinessProfile();
  ok('save/load round trip', back.name === 'Round Trip Co' && back.website === 'rt.co');
  clearBusinessProfile();
  ok('clear empties the profile', profileIsEmpty(loadBusinessProfile()));
  ok('export is valid JSON', JSON.parse(exportBusinessProfile()).name === '');
}

console.log('== media-core: time ==');
{
  ok('formatTime 0 -> 0:00.0', formatTime(0) === '0:00.0', formatTime(0));
  ok('formatTime 75.25 -> 1:15.3 (rounds)', formatTime(75.25) === '1:15.3', formatTime(75.25));
  ok('formatTime 61.04 -> 1:01.0', formatTime(61.04) === '1:01.0', formatTime(61.04));
  ok('formatTime 3599.9 -> 59:59.9', formatTime(3599.9) === '59:59.9', formatTime(3599.9));
  ok('formatTime pads seconds', formatTime(5.05) === '0:05.1', formatTime(5.05));
  expectThrow('formatTime rejects negative', () => formatTime(-1), 'non-negative');
  expectThrow('formatTime rejects NaN', () => formatTime(NaN), 'non-negative');

  ok('parse "90"', parseTimeInput('90') === 90);
  ok('parse "1:30"', parseTimeInput('1:30') === 90);
  ok('parse "1:30.5"', parseTimeInput('1:30.5') === 90.5);
  ok('parse "0:05.25"', parseTimeInput('0:05.25') === 5.25);
  ok('parse " 2:03 " trims', parseTimeInput(' 2:03 ') === 123);
  ok('parse "0"', parseTimeInput('0') === 0);
  expectThrow('parse garbage rejected', () => parseTimeInput('abc'), 'Could not understand');
  expectThrow('parse empty rejected', () => parseTimeInput('   '), 'Enter a time');
  expectThrow('parse "1:70" rejected', () => parseTimeInput('1:70'), 'Could not understand');
  expectThrow('parse "1:2:3" rejected', () => parseTimeInput('1:2:3'), 'Could not understand');
  expectThrow('parse "-5" rejected', () => parseTimeInput('-5'), 'Could not understand');
}

console.log('== media-core: bitrate math ==');
{
  // 25MB over 60s: (25*1024*1024*8/60)/1000 = 3495.25 -> floor 3495 - 128 = 3367
  const vkb = estimateVideoBitrateKbps(mbToBytes(25), 60);
  ok('25MB/60s -> 3367 kbps video', vkb === 3367, `got ${vkb}`);
  ok('10MB/30s -> 2668 kbps', estimateVideoBitrateKbps(mbToBytes(10), 30) === 2668, `${estimateVideoBitrateKbps(mbToBytes(10), 30)}`);
  ok('tiny target floors at 100', estimateVideoBitrateKbps(1000, 3600) === 100);
  ok('custom audio bitrate subtracted', estimateVideoBitrateKbps(mbToBytes(25), 60, 64) === 3431);
  expectThrow('zero duration throws', () => estimateVideoBitrateKbps(1000, 0), 'duration');
  expectThrow('negative target throws', () => estimateVideoBitrateKbps(-5, 60), 'positive');
  ok('mbToBytes(25)', mbToBytes(25) === 25 * 1024 * 1024);
  ok('clamp', clamp(5, 0, 3) === 3 && clamp(-1, 0, 3) === 0 && clamp(2, 0, 3) === 2);
}

console.log('== media-core: WAV encode/decode round trip ==');
{
  // 1s stereo 44100Hz sine, like the browser trimmer would export.
  const sr = 44100;
  const n = sr;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
    left[i] = v;
    right[i] = -v;
  }
  const wav = encodeWav([left, right], sr);
  ok('RIFF magic', wav[0] === 0x52 && wav[1] === 0x49 && wav[2] === 0x46 && wav[3] === 0x46);
  ok('WAVE magic', wav[8] === 0x57 && wav[9] === 0x41 && wav[10] === 0x56 && wav[11] === 0x45);
  ok('file length = 44 + frames*channels*2', wav.length === 44 + n * 2 * 2, `got ${wav.length}`);
  const info = parseWavHeader(wav);
  ok('header: 44100Hz stereo 16-bit', info.sampleRate === 44100 && info.channels === 2 && info.bitsPerSample === 16);
  ok('header: sample count matches', info.sampleCount === n, `got ${info.sampleCount}`);
  // sample values survive the round trip (16-bit quantization tolerance)
  const f0l = readWavSample(wav, info, 0, 0);
  const f0r = readWavSample(wav, info, 0, 1);
  ok('frame 0 ~ 0 (sine starts at 0)', Math.abs(f0l) < 0.001 && Math.abs(f0r) < 0.001, `${f0l}, ${f0r}`);
  const peakFrame = Math.round(sr / 440 / 4); // quarter period ~ peak
  const peakL = readWavSample(wav, info, peakFrame, 0);
  const peakR = readWavSample(wav, info, peakFrame, 1);
  ok('peak frame ~ +0.5 / -0.5', Math.abs(peakL - 0.5) < 0.002 && Math.abs(peakR + 0.5) < 0.002, `${peakL}, ${peakR}`);
  // mono
  const mono = encodeWav([left], 22050);
  const mi = parseWavHeader(mono);
  ok('mono 22050 header', mi.channels === 1 && mi.sampleRate === 22050 && mi.sampleCount === n);
  expectThrow('empty channels throws', () => encodeWav([], 44100), 'no audio channels');
  expectThrow('empty frames throws', () => encodeWav([new Float32Array(0)], 44100), 'empty');
  expectThrow('mismatched channels throws', () => encodeWav([left, new Float32Array(10)], 44100), 'same length');
  expectThrow('garbage header rejected', () => parseWavHeader(new Uint8Array([1, 2, 3])), 'too short');
}

console.log('== media-core: resample / int16 / peaks / slice ==');
{
  const flat = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  const half = resampleLinear(flat, 44100, 22050);
  ok('44100->22050 halves length', half.length === 2, `got ${half.length}`);
  ok('flat signal stays flat', Math.abs(half[0] - 0.5) < 1e-6 && Math.abs(half[1] - 0.5) < 1e-6);
  const same = resampleLinear(flat, 44100, 44100);
  ok('equal rates return a copy', same.length === 4 && same !== flat);
  const ramp = new Float32Array([0, 1]);
  const up = resampleLinear(ramp, 1, 5);
  ok('ramp interpolates endpoints', up.length === 10 && up[0] === 0 && up[9] === 1 && Math.abs(up[4] - 4 / 9) < 1e-6, `${[...up].slice(0, 5)}…`);
  expectThrow('bad rate throws', () => resampleLinear(flat, 0, 44100), 'positive');

  const i16 = floatToInt16(new Float32Array([1, -1, 0, 2, -2, 0.5]));
  ok('1.0 -> 32767, -1.0 -> -32767 (symmetric)', i16[0] === 32767 && i16[1] === -32767, `${i16[0]}, ${i16[1]}`);
  ok('clamps out-of-range', i16[3] === 32767 && i16[4] === -32767);
  ok('0.5 -> 16384', i16[5] === 16384, `${i16[5]}`);

  const peaks = computePeaks(new Float32Array([0, 0.5, -1, 0.25, 0, 0, 0.75, 0]), 4);
  ok('4 buckets', peaks.length === 4);
  ok('loudest bucket normalizes to 1', peaks[1] === 1, `${[...peaks]}`);
  ok('bucket values proportional', Math.abs(peaks[0] - 0.5) < 1e-6 && Math.abs(peaks[3] - 0.75) < 1e-6, `${[...peaks]}`);
  const silent = computePeaks(new Float32Array(8), 4);
  ok('silence -> zeros', [...silent].every((v) => v === 0));
  expectThrow('zero buckets throws', () => computePeaks(new Float32Array(8), 0), 'bucket');

  const ch = [new Float32Array([1, 2, 3, 4, 5]), new Float32Array([6, 7, 8, 9, 10])];
  const sliced = sliceChannels(ch, 1, 4);
  ok('slice [1,4)', sliced[0].length === 3 && sliced[0][0] === 2 && sliced[1][2] === 9);
  expectThrow('empty slice throws', () => sliceChannels(ch, 3, 3), 'empty');
}

console.log('== media-core: trim validation + filenames + recorder mimes ==');
{
  const r = validateTrimRange(1.5, 10, 60);
  ok('valid range passes through', r.start === 1.5 && r.end === 10);
  expectThrow('end <= start rejected', () => validateTrimRange(10, 10, 60), 'after the start');
  expectThrow('end past duration rejected', () => validateTrimRange(1, 61, 60), 'past the end');
  expectThrow('negative start rejected', () => validateTrimRange(-1, 10, 60), 'negative');
  expectThrow('tiny range rejected', () => validateTrimRange(1, 1.01, 60), 'too short');
  expectThrow('zero duration rejected', () => validateTrimRange(0, 1, 0), 'length');

  ok('stemOf strips extension', stemOf('song.mp3') === 'song');
  ok('stemOf keeps inner dots', stemOf('my.song.mp3') === 'my.song');
  ok('stemOf falls back for dotfile', stemOf('.mp3') === 'audio');
  ok('withExtension replaces', withExtension('song.mp3', 'wav') === 'song.wav');
  ok('withExtension adds', withExtension('song', 'mp3') === 'song.mp3');
  ok('withExtension dotfile fallback', withExtension('.mp3', 'wav') === 'audio.wav');
  ok('withExtension tolerates leading dot', withExtension('song.mp3', '.ogg') === 'song.ogg');

  const mimes = preferredRecorderMimeTypes();
  ok('mime list non-empty, webm first', mimes.length > 0 && mimes[0].includes('webm'), mimes.join(' | '));
  ok('mp4 fallback present', mimes.some((m) => m === 'video/mp4'));
}

console.log('== mp3-encode (lamejs) ==');
{
  ok('44100 is mp3-safe', mp3SafeSampleRate(44100) === 44100);
  ok('48000 is mp3-safe', mp3SafeSampleRate(48000) === 48000);
  ok('96000 falls back to 44100', mp3SafeSampleRate(96000) === 44100);
  ok('11025 stays (MPEG-2.5)', mp3SafeSampleRate(11025) === 11025);

  const sr = 44100;
  const n = sr; // 1s
  const mk = (f) => {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.sin((2 * Math.PI * f * i) / sr) * 0.5;
    return c;
  };
  const mk22 = (f) => {
    const len = 22050;
    const c = new Float32Array(len);
    for (let i = 0; i < len; i++) c[i] = Math.sin((2 * Math.PI * f * i) / 22050) * 0.5;
    return c;
  };
  const mp3 = await encodeMp3([mk(440), mk(880)], sr, 192);
  ok('stereo MP3 starts with frame sync', mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0, `${mp3[0].toString(16)} ${mp3[1].toString(16)}`);
  // 192kbps 1s stereo ≈ 24000 bytes; allow ±25% for encoder padding/headers
  ok('stereo 192kbps 1s plausible size', mp3.length > 18000 && mp3.length < 30000, `got ${mp3.length}`);
  // walk frames: every header parses as a valid MPEG-1 Layer III frame
  const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  let pos = 0;
  let frames = 0;
  let bad = 0;
  while (pos + 4 <= mp3.length) {
    if (mp3[pos] === 0xff && (mp3[pos + 1] & 0xe0) === 0xe0) {
      frames++;
      const br = BITRATES[(mp3[pos + 2] >> 4) & 15];
      const pad = (mp3[pos + 2] >> 1) & 1;
      const flen = Math.floor((144 * br * 1000) / sr) + pad;
      if (!flen || br !== 192) {
        bad++;
        break;
      }
      pos += flen;
    } else {
      bad++;
      pos++;
    }
  }
  ok('all frames valid 192kbps MPEG-1', bad === 0 && frames > 30 && pos === mp3.length, `frames=${frames} bad=${bad} pos=${pos}/${mp3.length}`);

  const monoMp3 = await encodeMp3([mk22(440)], 22050, 96);
  ok('mono 22050 MP3 has frame sync', monoMp3[0] === 0xff && (monoMp3[1] & 0xe0) === 0xe0);
  ok('mono 96kbps 1s plausible size', monoMp3.length > 9000 && monoMp3.length < 15000, `got ${monoMp3.length}`);
  await expectThrowAsync('empty channels throws', () => encodeMp3([], 44100), 'no audio channels');
  await expectThrowAsync('empty frames throws', () => encodeMp3([new Float32Array(0)], 44100), 'empty');
}

console.log('== bgremove-core ==');
{
  ok('transparent validates', validateBgChoice('transparent') === 'transparent');
  ok('white validates', validateBgChoice('white') === 'white');
  ok('black validates', validateBgChoice('black') === 'black');
  ok('junk falls back to transparent', validateBgChoice('checker') === 'transparent' && validateBgChoice(null) === 'transparent');
  ok('fill colors', bgFillColor('white') === '#ffffff' && bgFillColor('black') === '#000000' && bgFillColor('transparent') === null);
  ok('output filename', bgOutputFileName('photo.jpg') === 'photo-no-bg.png');
  ok('dotfile falls back', bgOutputFileName('.jpg') === 'image-no-bg.png');
  ok('fetch key -> loading-model', bgStageFromProgressKey('fetch:isnet.onnx') === 'loading-model');
  ok('compute key -> removing', bgStageFromProgressKey('compute:inference') === 'removing');
  ok('model label mentions once per browser', bgProgressLabel('fetch:x', 50, 100).includes('once per browser'));
  ok('model label percent', bgProgressLabel('fetch:x', 50, 100).includes('50%'));
  ok('inference label', bgProgressLabel('compute:inference', 1, 4) === 'Removing the background…');
  ok('mask label', bgProgressLabel('compute:mask', 2, 4) === 'Cleaning up the edges…');
  ok('model note mentions 40 MB', BG_MODEL_DOWNLOAD_NOTE.includes('40 MB'));
  ok('network error is friendly', bgRemoveErrorMessage(new Error('fetch failed')).includes('Check your connection'));
  ok('gpu error is friendly', bgRemoveErrorMessage(new Error('wasm init failed')).includes('WebAssembly'));
}

console.log('== ocr-core ==');
{
  ok('12 languages offered', OCR_LANGUAGES.length === 12);
  ok('english is first/default', OCR_LANGUAGES[0].code === 'eng' && DEFAULT_OCR_LANG === 'eng');
  ok('resolve known code', resolveOcrLanguage('fra') === 'fra' && resolveOcrLanguage('chi_sim') === 'chi_sim');
  ok('resolve junk -> eng', resolveOcrLanguage('xx') === 'eng' && resolveOcrLanguage(null) === 'eng');
  const o = validateOcrOptions({ lang: 'deu' });
  ok('options default on', o.upscaleSmall && o.enhanceContrast && o.lightCleanup && o.lang === 'deu');
  const o2 = validateOcrOptions({ lang: 'xx', upscaleSmall: false });
  ok('junk lang + opt-out', o2.lang === 'eng' && o2.upscaleSmall === false);
  ok('cleanup joins hyphenated breaks', cleanupOcrText('exam-\nple') === 'example');
  ok('cleanup collapses blank lines', cleanupOcrText('a\n\n\n\nb') === 'a\n\nb');
  ok('cleanup drops form feeds', cleanupOcrText('a\fb') === 'ab');
  ok('cleanup trims trailing spaces', cleanupOcrText('a   \nb') === 'a\nb');
  ok('cleanup normalizes CRLF', cleanupOcrText('a\r\nb') === 'a\nb');
  ok('cleanup trims ends', cleanupOcrText('\n\n hi \n') === 'hi');
  ok('ocr filename', ocrOutputFileName('scan.png') === 'scan-ocr.txt');
  ok('ocr dotfile fallback', ocrOutputFileName('.png') === 'image-ocr.txt');
  const p1 = ocrProgressLabel({ status: 'recognizing text', progress: 0.5 });
  ok('recognition 50% -> 80% "Reading"', p1.percent === 80 && p1.label.includes('Reading'), `${p1.percent} ${p1.label}`);
  const p2 = ocrProgressLabel({ status: 'loading language traineddata', progress: 1 });
  ok('language data 100% -> 55%', p2.percent === 55, `${p2.percent}`);
  const p3 = ocrProgressLabel({ status: 'loading tesseract core', progress: 0.5 });
  ok('core load 50% -> ~13%', p3.percent === 13 && p3.label.includes('engine'), `${p3.percent}`);
  ok('engine note mentions 15 MB', OCR_ENGINE_NOTE.includes('15 MB'));
  ok('ocr network error is friendly', ocrErrorMessage(new Error('Failed to fetch')).includes('Check your connection'));
}

console.log('== trace-core (incl. real imagetracerjs run in Node) ==');
{
  ok('color validates', validateTraceOptions({ mode: 'color', detail: 6 }).mode === 'color');
  ok('mono validates', validateTraceOptions({ mode: 'mono', detail: 3 }).detail === 3);
  ok('junk mode -> color', validateTraceOptions({ mode: 'x', detail: 6 }).mode === 'color');
  ok('detail clamps high', validateTraceOptions({ detail: 99 }).detail === 10);
  ok('detail clamps low', validateTraceOptions({ detail: -2 }).detail === 1);
  ok('detail rounds', validateTraceOptions({ detail: 4.6 }).detail === 5);
  ok('NaN detail -> default', validateTraceOptions({ detail: NaN }).detail === TRACE_DETAIL_DEFAULT);
  const hi = resolveImageTracerOptions({ mode: 'color', detail: 10 });
  ok('detail 10 color -> 16 colors, pathomit 4', hi.numberofcolors === 16 && hi.pathomit === 4, JSON.stringify({ c: hi.numberofcolors, p: hi.pathomit }));
  const lo = resolveImageTracerOptions({ mode: 'color', detail: 1 });
  ok('detail 1 color -> 2 colors, pathomit 48', lo.numberofcolors === 2 && lo.pathomit === 48);
  const mo = resolveImageTracerOptions({ mode: 'mono', detail: 10 });
  ok('mono always 2 colors', mo.numberofcolors === 2);
  ok('scale passes small images through', JSON.stringify(scaleForTrace(800, 600)) === '{"width":800,"height":600}');
  const sc = scaleForTrace(2048, 1024);
  ok('scale caps long edge at 1024', sc.width === 1024 && sc.height === 512, `${sc.width}x${sc.height}`);
  expectThrow('zero dims rejected', () => scaleForTrace(0, 10), 'Invalid image');
  ok('trace filename', traceOutputFileName('logo.png') === 'logo-traced.svg');
  ok('preview filename', tracePreviewFileName('logo.png') === 'logo-traced.png');

  // imagetracerjs is pure JS: run a real trace on canned pixels.
  const it = (await import('imagetracerjs')).default;
  const w = 16;
  const h = 16;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const black = x > 3 && x < 12 && y > 3 && y < 12;
      data[i] = data[i + 1] = data[i + 2] = black ? 0 : 255;
      data[i + 3] = 255;
    }
  }
  const svg = it.imagedataToSVG({ width: w, height: h, data }, resolveImageTracerOptions({ mode: 'mono', detail: 6 }));
  ok('real trace validates as SVG with paths', validateSvg(svg).ok === true, svg.slice(0, 90));
  ok('real trace has >= 1 path', countSvgPaths(svg) >= 1, `paths=${countSvgPaths(svg)}`);
  const dims = svgDimensions(svg);
  ok('svg dimensions parse 16x16', dims !== null && dims.width === 16 && dims.height === 16, JSON.stringify(dims));
  // color mode on a two-tone image
  const svgColor = it.imagedataToSVG({ width: w, height: h, data }, resolveImageTracerOptions({ mode: 'color', detail: 8 }));
  ok('color trace validates too', validateSvg(svgColor).ok === true);
  ok('garbage rejected', validateSvg('nope').ok === false);
  ok('short string rejected', validateSvg('<svg></svg>').ok === false);
  const pathless = `<svg width="8" height="8" xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>`.padEnd(300, ' ');
  ok('pathless svg rejected', validateSvg(pathless).ok === false);
  ok('truncated svg rejected', validateSvg('<svg width="8" height="8"><path d="M0 0L8 8Z"/>'.padEnd(300, 'x')).ok === false);
  ok('engine note honest about photos', TRACE_ENGINE_NOTE.includes('photos do not'));
  ok('memory error is friendly', traceErrorMessage(new Error('allocation failed')).includes('smaller image'));
}

console.log('== budget-core ==');
{
  ok('monthKey formats', monthKey(2026, 9) === '2026-09' && monthKey(2026, 1) === '2026-01');
  expectThrow('monthKey rejects month 13', () => monthKey(2026, 13), 'Invalid year/month');
  ok('parseMonthKey round trip', JSON.stringify(parseMonthKey('2026-09')) === '{"year":2026,"month":9}');
  ok('parseMonthKey rejects junk', parseMonthKey('sep 2026') === null && parseMonthKey('2026-13') === null);
  ok('shiftMonth across year', shiftMonth('2026-01', -1) === '2025-12' && shiftMonth('2026-12', 1) === '2027-01');
  ok('shiftMonth zero', shiftMonth('2026-09', 0) === '2026-09');
  ok('monthLabel', monthLabel('2026-09') === 'September 2026' && monthLabel('2026-01') === 'January 2026');
  ok('currentMonthKey shape', /^\d{4}-(0[1-9]|1[0-2])$/.test(currentMonthKey()));
  ok('storage key versioned', BUDGET_STORAGE_KEY === 'freekit.budget-planner.v1' && BUDGET_SCHEMA_VERSION === 1);

  // integer-cent money math
  ok('parseCents dollars', parseCents('15.49') === 1549);
  ok('parseCents with symbols', parseCents('$1,234.56') === 123456);
  ok('parseCents junk is 0', parseCents('abc') === 0 && parseCents('') === 0);
  ok('formatMoney', formatMoney(123456, 'USD') === '$1,234.56');

  const m = exampleMonth('2026-09');
  ok('example month has income and categories', m.income.length > 0 && m.categories.length > 0);
  ok('example income total', totalIncomeCents(m) === 365000, String(totalIncomeCents(m)));
  ok('planned and actual >= 0', totalPlannedCents(m) >= 0 && totalActualCents(m) >= 0);
  ok(
    'remaining = income - planned',
    remainingToAssignCents(m) === totalIncomeCents(m) - totalPlannedCents(m)
  );
  ok(
    'actual left = income - actual',
    actualLeftCents(m) === totalIncomeCents(m) - totalActualCents(m)
  );
  const cat = m.categories[0];
  ok('category left = planned - actual', categoryLeftCents(cat) === cat.plannedCents - cat.actualCents);

  // add/remove entries
  const withIncome = addIncomeEntry([], { ...blankIncomeEntry(), label: 'Paycheck', cents: 300000 });
  ok('addIncomeEntry appends', withIncome.length === 1 && withIncome[0].cents === 300000);
  ok('removeIncomeEntry removes by id', removeIncomeEntry(withIncome, withIncome[0].id).length === 0);
  ok('removeIncomeEntry keeps others', removeIncomeEntry(withIncome, 'nope').length === 1);
  const withCat = addCategory([], { ...blankCategory(), name: 'Rent', plannedCents: 150000 });
  ok('addCategory appends', withCat.length === 1 && withCat[0].plannedCents === 150000);
  ok('removeCategory removes by id', removeCategory(withCat, withCat[0].id).length === 0);

  // validation
  ok('blank month asks for data', validateBudgetMonth(blankMonth('2026-09')).length === 1);
  ok('example month validates', validateBudgetMonth(m).length === 0);
  const neg = {
    ...blankMonth('2026-09'),
    income: [],
    categories: [{ ...blankCategory(), name: 'Fun', plannedCents: -500 }],
  };
  ok('negative planned flagged', validateBudgetMonth(neg).length > 0);
  const unlabeled = {
    ...blankMonth('2026-09'),
    income: [{ ...blankIncomeEntry(), label: '', cents: 100000 }],
    categories: [],
  };
  ok('unlabeled income flagged', validateBudgetMonth(unlabeled).length > 0);

  // serialization
  const store = { months: { '2026-09': m }, version: BUDGET_SCHEMA_VERSION };
  const rt = deserializeBudgetStore(serializeBudgetStore(store));
  ok('store round trip', totalIncomeCents(rt.months['2026-09']) === totalIncomeCents(m));
  ok('deserialize null -> blank', Object.keys(deserializeBudgetStore(null).months).length === 0);
  ok('deserialize junk -> blank', Object.keys(deserializeBudgetStore('{{{').months).length === 0);
  ok('blankBudgetStore has no months', Object.keys(blankBudgetStore().months).length === 0);
}

console.log('== subs-core ==');
{
  ok('storage key versioned', SUBS_STORAGE_KEY === 'freekit.subscription-tracker.v1' && SUBS_SCHEMA_VERSION === 1);
  ok('isCycle', isCycle('weekly') && isCycle('monthly') && isCycle('yearly') && !isCycle('daily'));
  ok('isValidISODate', isValidISODate('2026-09-23') && !isValidISODate('2026-13-01') && !isValidISODate('nope'));

  // renewal edge cases: the Jan 31 problem and friends
  ok('Jan 31 + 1 month clamps to Feb 28', addMonthsClamped('2026-01-31', 1) === '2026-02-28');
  ok('Jan 31 + 1 month in leap year -> Feb 29', addMonthsClamped('2024-01-31', 1) === '2024-02-29');
  ok(
    'Jan 31 anchored: next after Mar 1 is Mar 31',
    nextRenewalDate('2026-01-31', 'monthly', '2026-03-01') === '2026-03-31'
  );
  ok(
    'Jan 31 as of Feb 15 renews Feb 28',
    nextRenewalDate('2026-01-31', 'monthly', '2026-02-15') === '2026-02-28'
  );
  ok('Feb 29 yearly -> Feb 28 next year', addYearsClamped('2024-02-29', 1) === '2025-02-28');
  ok(
    'Feb 29 yearly renewal clamps',
    nextRenewalDate('2024-02-29', 'yearly', '2025-01-15') === '2025-02-28'
  );
  ok(
    'weekly steps 7 days',
    nextRenewalDate('2026-09-01', 'weekly', '2026-09-23') === '2026-09-29'
  );
  ok(
    'weekly start in future stays',
    nextRenewalDate('2026-10-01', 'weekly', '2026-09-23') === '2026-10-01'
  );
  ok(
    'start date itself is a renewal',
    nextRenewalDate('2026-09-23', 'monthly', '2026-09-23') === '2026-09-23'
  );
  expectThrow('bad date throws', () => nextRenewalDate('nope', 'monthly', '2026-09-23'), 'Invalid date');

  ok('daysUntil counts whole days', daysUntil('2026-09-23', '2026-09-29') === 6);
  ok('daysUntil same day is 0', daysUntil('2026-09-23', '2026-09-23') === 0);
  ok('renewalLabel today', renewalLabel(0) === 'renews today');
  ok('renewalLabel tomorrow', renewalLabel(1) === 'renews tomorrow');
  ok('renewalLabel n days', renewalLabel(5) === 'renews in 5 days');
  ok('formatISODate', formatISODate('2026-09-23') === 'Sep 23, 2026', formatISODate('2026-09-23'));

  // monthly-equivalent math
  ok('yearly / 12', monthlyEquivalentCents(11999, 'yearly') === 1000);
  ok('weekly * 52 / 12', monthlyEquivalentCents(2999, 'weekly') === 12996);
  ok('monthly passes through', monthlyEquivalentCents(1549, 'monthly') === 1549);

  const subs = exampleSubscriptions();
  ok('example subscriptions load', subs.length === 3);
  const t = subsTotals(subs);
  ok('totals count', t.count === 3);
  ok('totals monthly', t.monthlyCents === 15545, String(t.monthlyCents));
  ok('totals yearly = 12x monthly', t.yearlyCents === t.monthlyCents * 12);
  ok('per-day positive', t.perDayCents > 0);

  const sorted = sortedByRenewal(subs, '2026-09-23');
  ok(
    'sorted by renewal ascending',
    sorted.every((r, i, a) => i === 0 || a[i - 1].renewal <= r.renewal)
  );
  const upcoming = upcomingRenewals(subs, '2026-09-23', 7);
  ok('upcoming within 7 days', upcoming.every((r) => r.days <= 7));
  ok(
    'upcoming default window is 7',
    upcomingRenewals(subs, '2026-09-23').every((r) => r.days <= 7)
  );

  // validation + CRUD
  const bad = validateSubscription(blankSubscription());
  ok('blank subscription invalid', bad.length >= 2, bad.join('; '));
  ok(
    'zero cost invalid',
    validateSubscription({ ...blankSubscription(), name: 'X', costCents: 0, cycle: 'monthly', startDate: '2026-09-01' }).length > 0
  );
  const good = { ...blankSubscription(), name: 'Test', costCents: 999, cycle: 'monthly', startDate: '2026-09-01' };
  ok('valid subscription passes', validateSubscription(good).length === 0);
  const added = addSubscription([], good);
  ok('addSubscription appends', added.length === 1);
  const updated = updateSubscription(added, { ...good, costCents: 1999 });
  ok('updateSubscription changes', updated[0].costCents === 1999 && updated.length === 1);
  ok('removeSubscription removes', removeSubscription(updated, good.id).length === 0);

  const rt = deserializeSubsStore(serializeSubsStore({ subscriptions: subs, version: SUBS_SCHEMA_VERSION }));
  ok('store round trip', rt.subscriptions.length === subs.length);
  ok('deserialize null -> blank', deserializeSubsStore(null).subscriptions.length === 0);
  ok('blankSubsStore empty', blankSubsStore().subscriptions.length === 0);
}

console.log('== logo-core ==');
{
  ok('storage key versioned', LOGO_STORAGE_KEY === 'freekit.logo-maker.v1' && LOGO_SCHEMA_VERSION === 1);
  ok('18 icons', LOGO_ICONS.length === 18, String(LOGO_ICONS.length));
  ok('shapes none/circle/square/badge', LOGO_SHAPES.map((s) => s.id).join(',') === 'none,circle,square,badge');
  ok('4 fonts', LOGO_FONTS.length === 4);
  ok('8 presets', LOGO_PRESETS.length === 8);
  ok('icon lookup by id', logoIconById('star').id === 'star');
  ok('icon lookup falls back', logoIconById('bogus').id === LOGO_ICONS[0].id);

  const spec = exampleLogoSpec();
  ok('example spec named', spec.name === 'Northwind');
  const svg = logoSvg(spec);
  ok('svg starts with <svg', svg.startsWith('<svg'));
  ok('svg contains the name', svg.includes('Northwind'));
  ok('svg contains tagline', svg.includes('MOBILE STUDIO'));
  ok('svg has viewBox', svg.includes('viewBox'));
  const evil = logoSvg({ ...spec, name: '<img src=x onerror=alert(1)>' });
  ok('name is HTML-escaped', !evil.includes('<img src=x') && evil.includes('&lt;img'));

  ok('png size 512', JSON.stringify(logoPngSize(512)) === '{"width":512,"height":512}');
  ok('png size 1024', JSON.stringify(logoPngSize(1024)) === '{"width":1024,"height":1024}');
  expectThrow('bad png size throws', () => logoPngSize(100), 'Unsupported export size');
  ok('LOGO_PNG_SIZES', JSON.stringify([...LOGO_PNG_SIZES]) === '[512,1024]');
  ok('filename slug', logoFileName('Acme Bakery', 'png') === 'acme-bakery-logo.png');
  ok('filename blank -> logo', logoFileName('', 'svg') === 'logo-logo.svg');
  ok('fitFontSize shrinks long names', logoFitFontSize('A very long business name indeed', 100, 76) < 76);
  ok('fitFontSize keeps short names', logoFitFontSize('Acme', 400, 76) === 76);

  const clean = sanitizeLogoSpec({ name: 42, iconId: 'bogus', shape: 'bogus', fontId: 'bogus', presetId: 'bogus', tagline: null });
  ok('sanitize coerces types', clean.name === '' && clean.tagline === '');
  ok('sanitize falls back on bad ids', clean.iconId === LOGO_ICONS[0].id && clean.shape === 'circle');
  const rt = deserializeLogoSpec(serializeLogoSpec(spec));
  ok('spec round trip', rt.name === spec.name && rt.shape === spec.shape && rt.presetId === spec.presetId);
  ok('deserialize junk -> blank-ish', deserializeLogoSpec('{{{').name === '');
}

console.log('== og-core ==');
{
  ok('storage key versioned', OG_STORAGE_KEY === 'freekit.og-image-generator.v1' && OG_SCHEMA_VERSION === 1);
  ok(
    '4 presets with exact sizes',
    OG_PRESETS.map((p) => `${p.width}x${p.height}`).join(',') === '1200x630,1080x1080,1600x900,1200x675'
  );
  ok('preset lookup', ogPresetById('og').width === 1200 && ogPresetById('bogus').id === 'og');
  ok('5 patterns', OG_PATTERNS.length === 5);
  ok('8 themes', OG_THEMES.length === 8);

  const wrapped = wrapLines('one two three four five six seven eight', 200, 20);
  ok('wrapLines breaks into lines', wrapped.length > 1 && wrapped.join(' ') === 'one two three four five six seven eight');
  ok('wrapLines empty -> one empty line', JSON.stringify(wrapLines('', 200, 20)) === '[""]');
  const hard = wrapLines('supercalifragilisticexpialidocious', 100, 20);
  ok('wrapLines hard-breaks long words', hard.length > 1 && hard.join('') === 'supercalifragilisticexpialidocious');
  ok('fitFontSize shrinks', ogFitFontSize('A really long headline that will not fit', 200, 120) < 120);
  ok('fitFontSize keeps short text', ogFitFontSize('Hi', 1000, 120) === 120);
  ok('fitFontSize never below min', ogFitFontSize('Supercalifragilisticexpialidocious '.repeat(20), 50, 120) >= 12);

  const lay = layoutOg(exampleOgSpec());
  ok('layout matches preset size', lay.preset.width === 1200 && lay.preset.height === 630);
  ok('layout has headline lines', lay.headline.lines.length >= 1);
  ok('headline text preserved', lay.headline.lines.join(' ').length > 0);
  ok(
    'headline lines fit the card',
    lay.headline.lines.every((l) => l.length * lay.headline.px * 0.55 <= lay.preset.width)
  );
  ok('og filename', ogFileName('Acme Co', 'og') === 'acme-co-1200x630.png');
  ok('og filename blank brand', ogFileName('', 'square') === 'card-1080x1080.png');

  const clean = sanitizeOgSpec({ presetId: 'nope', themeId: 'nope', pattern: 'nope', headline: 42 });
  ok('sanitize falls back on bad ids', clean.presetId === 'og');
  ok('sanitize coerces headline', clean.headline === '');
  const rt = deserializeOgSpec(serializeOgSpec(exampleOgSpec()));
  ok('spec round trip', rt.headline === exampleOgSpec().headline && rt.presetId === exampleOgSpec().presetId);
}

console.log('== mockup-core ==');
{
  ok('storage key versioned', MOCKUP_STORAGE_KEY === 'freekit.device-mockup.v1' && MOCKUP_SCHEMA_VERSION === 1);
  ok('3 frames', MOCKUP_FRAMES.map((f) => f.id).join(',') === 'browser,phone,laptop');
  ok('7 backgrounds incl transparent', MOCKUP_BACKGROUNDS.length === 7);
  ok('transparent bg has null color', mockupBackgroundById('transparent').color === null);
  ok('bg lookup falls back', mockupBackgroundById('bogus').id === 'paper');

  const fit = fitContain(1600, 900, { x: 0, y: 0, w: 800, h: 800 });
  ok('contain-fit scales to box', fit.w === 800 && fit.h === 450, JSON.stringify(fit));
  ok('contain-fit centers', fit.x === 0 && fit.y === 175, JSON.stringify(fit));
  const fitTall = fitContain(900, 1600, { x: 0, y: 0, w: 800, h: 800 });
  ok('contain-fit tall image', fitTall.h === 800 && fitTall.w === 450, JSON.stringify(fitTall));
  expectThrow('zero image size throws', () => fitContain(0, 100, { x: 0, y: 0, w: 10, h: 10 }), 'Invalid image size');

  const geo = frameGeometry('browser', 1600, 900);
  ok('geometry canvas 1600 wide', geo.canvasW === 1600);
  ok('screen inside frame', geo.screen.x >= geo.frame.x && geo.screen.y >= geo.frame.y);
  ok('frame inside canvas', geo.frame.x >= 0 && geo.frame.y >= 0 && geo.frame.x + geo.frame.w <= geo.canvasW);
  const phone = frameGeometry('phone', 900, 1600);
  ok('phone frame is portrait-ish', phone.frame.h >= phone.frame.w);
  const laptop = frameGeometry('laptop', 1600, 900);
  ok('laptop wider than phone', laptop.frame.w >= phone.frame.w);
  ok('mockup filename', mockupFileName('phone') === 'screenshot-mockup-phone.png');

  const clamped = sanitizeMockupSettings({ padding: 999, shadow: -5, frame: 'nope', backgroundId: 'nope' });
  ok('padding clamps to max', clamped.padding === 240, String(clamped.padding));
  ok('shadow clamps to >= 0', clamped.shadow >= 0);
  ok('bad frame falls back', clamped.frame === 'browser');
  const rt = deserializeMockupSettings(serializeMockupSettings({ ...blankMockupSettings(), frame: 'laptop' }));
  ok('settings round trip', rt.frame === 'laptop');
  ok('deserialize junk -> defaults', deserializeMockupSettings('{{{').frame === 'browser');
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
  checkGlueIds('src/tools/audio-trimmer.ts', 'src/pages/audio-trimmer.astro');
  checkGlueIds('src/tools/audio-merger.ts', 'src/pages/audio-merger.astro');
  checkGlueIds('src/tools/audio-converter.ts', 'src/pages/audio-converter.astro');
  checkGlueIds('src/tools/video-compressor.ts', 'src/pages/video-compressor.astro');
  checkGlueIds('src/tools/video-trimmer.ts', 'src/pages/video-trimmer.astro');
  checkGlueIds('src/tools/video-converter.ts', 'src/pages/video-converter.astro');
  checkGlueIds('src/tools/screen-recorder.ts', 'src/pages/screen-recorder.astro');
  checkGlueIds('src/tools/background-remover.ts', 'src/pages/background-remover.astro');
  checkGlueIds('src/tools/image-ocr.ts', 'src/pages/image-ocr.astro');
  checkGlueIds('src/tools/image-tracer.ts', 'src/pages/image-tracer.astro');
  checkGlueIds('src/tools/business-profile.ts', 'src/pages/business-profile.astro');
  checkGlueIds('src/tools/resume-import-ui.ts', 'src/pages/resume-builder.astro');
  checkGlueIds('src/tools/budget-planner.ts', 'src/pages/budget-planner.astro');
  checkGlueIds('src/tools/subscription-tracker.ts', 'src/pages/subscription-tracker.astro');
  checkGlueIds('src/tools/logo-maker.ts', 'src/pages/logo-maker.astro');
  checkGlueIds('src/tools/og-image-generator.ts', 'src/pages/og-image-generator.astro');
  checkGlueIds('src/tools/device-mockup-generator.ts', 'src/pages/device-mockup-generator.astro');
  checkGlueIds('src/tools/merge-pdf.ts', 'src/pages/merge-pdf.astro');
  checkGlueIds('src/tools/split-pdf.ts', 'src/pages/split-pdf.astro');
  checkGlueIds('src/tools/pdf-compressor.ts', 'src/pages/pdf-compressor.astro');
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
    '../src/tools/resume-import-ui.ts',
    '../src/tools/invoice-generator.ts',
    '../src/tools/email-signature-generator.ts',
    '../src/tools/business-profile.ts',
    '../src/tools/ffmpeg-loader.ts',
    '../src/tools/audio-trimmer.ts',
    '../src/tools/audio-merger.ts',
    '../src/tools/audio-converter.ts',
    '../src/tools/video-compressor.ts',
    '../src/tools/video-trimmer.ts',
    '../src/tools/video-converter.ts',
    '../src/tools/screen-recorder.ts',
    '../src/tools/bgremove-loader.ts',
    '../src/tools/tesseract-loader.ts',
    '../src/tools/trace-loader.ts',
    '../src/tools/background-remover.ts',
    '../src/tools/image-ocr.ts',
    '../src/tools/image-tracer.ts',
    '../src/tools/budget-planner.ts',
    '../src/tools/subscription-tracker.ts',
    '../src/tools/logo-maker.ts',
    '../src/tools/og-image-generator.ts',
    '../src/tools/device-mockup-generator.ts',
  ];
  for (const m of mods) {
    await import(m);
    ok(`imports cleanly: ${m.split('/').pop()}`, true);
  }
  const { ICONS } = await import('../src/tools/common.ts');
  ok('ICONS exported', !!(ICONS.up && ICONS.down && ICONS.x));
}

console.log('== built HTML: page scripts survived the build ==');
{
  // Bug-class guard: each tool page's <script> must actually land in the
  // built output. (Note: esbuild minifies the bundle, so the literal init
  // function name, e.g. initAudioTrimmer, does not survive. Instead we check
  // that the page HTML references a bundled script chunk and that the chunk
  // contains a minification-proof marker string unique to that tool's code —
  // which fails the same way if the script were silently dropped.)
  const { existsSync } = await import('node:fs');
  const pages = [
    ['audio-trimmer', 'waveform'],
    ['audio-merger', 'merge-btn'],
    ['audio-converter', 'quality-select'],
    ['video-compressor', 'compress-btn'],
    ['video-trimmer', 'trim-btn'],
    ['video-converter', 'libvpx'],
    ['screen-recorder', 'rec-timer'],
    ['background-remover', 'removeBackground'],
    ['image-ocr', 'createWorker'],
    ['image-tracer', 'imagedataToSVG'],
    ['budget-planner', 'budget-month-label'],
    ['subscription-tracker', 'subs-upcoming'],
    ['logo-maker', 'logo-save-profile'],
    ['og-image-generator', 'og-canvas'],
    ['device-mockup-generator', 'mockup-dropzone'],
  ];
  const distAudio = join(ROOT, 'dist', 'audio-trimmer', 'index.html');
  if (!existsSync(distAudio)) {
    console.log('  SKIP built-HTML check: dist/ not present (run npm run build first)');
  } else {
    for (const [page, marker] of pages) {
      const pageHtml = join(ROOT, 'dist', page, 'index.html');
      if (!existsSync(pageHtml)) {
        console.log(`  SKIP ${page}: not in dist/ yet (run npm run build first)`);
        continue;
      }
      const html = readFileSync(pageHtml, 'utf8');
      // Allow an optional base-path prefix (e.g. /freekit/_astro/ on GitHub Pages).
      const m = html.match(/<script type="module" src="([^"]*\/_astro\/[a-z-]+\.astro_astro_type_script_index_0_lang\.[A-Za-z0-9_-]+\.js)"/);
      const rel = m ? m[1].slice(m[1].indexOf('/_astro/') + 1) : null;
      const chunkPath = rel ? join(ROOT, 'dist', rel) : null;
      const chunk = chunkPath && existsSync(chunkPath) ? readFileSync(chunkPath, 'utf8') : '';
      ok(
        `${page}: bundled page script references tool code ("${marker}")`,
        !!chunk && chunk.includes(marker) && chunk.length > 1000,
        chunkPath ? `${chunkPath} missing marker or too small (${chunk.length}b)` : 'no bundled page script in HTML'
      );
    }
  }
}

console.log('== coverage honesty note (not pass/fail) ==');
{
  // These genuinely cannot run under Node and are verified by build + review:
  console.log('  NOTE not covered in Node: ffmpeg.wasm encoding (needs the WASM core + browser worker),');
  console.log('  NOTE MediaRecorder/getDisplayMedia, AudioContext.decodeAudioData, OfflineAudioContext,');
  console.log('  NOTE canvas waveform drawing, and <video> duration probing. The pure math they rely on');
  console.log('  NOTE (bitrate estimation, WAV encode, time parsing, trim validation, MP3 frames) is tested above.');
  console.log('  NOTE not covered in Node: @imgly/background-removal and tesseract.js inference');
  console.log('  NOTE (both need browser WASM + CDN model downloads at runtime). imagetracerjs IS');
  console.log('  NOTE exercised in Node above because it is dependency-free pure JS on ImageData.');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
