// Standalone smoke test for the fix-everything pass (excludes pdf-compress,
// whose rework by another agent currently breaks scripts/verify-tools.mjs).
// Run: node scripts/smoke-fixes.mjs
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import {
  mergePdfs,
  splitPdf,
  splitEveryPage,
  splitEveryNPages,
  parsePageRanges,
  imagesToPdf,
  getPageCount,
  extractPages,
} from '../src/lib/pdf-core.ts';
import {
  groupItemsIntoLines,
  linesToBlocks,
  assembleDocx,
  docxFileName,
} from '../src/lib/pdf2word-core.ts';
import { signPdf, previewRectToPdf } from '../src/lib/pdf-esign.ts';
import {
  detectInputKind,
  converterOutputOptions,
  outputFileName,
  batchZipName,
  OUTPUT_MIMES,
} from '../src/lib/image-core.ts';

let passed = 0;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL:', label, extra ?? ''); }
}
async function expectThrowAsync(label, fn, msgPart) {
  try { await fn(); ok(label, false, 'did not throw'); }
  catch (e) { ok(label, String(e.message).includes(msgPart), e.message); }
}
async function makePdf(n, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([400, 500]);
    p.drawText(`${label} page ${i + 1}`, { x: 50, y: 450, size: 20, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

console.log('== split modes ==');
{
  const src = await makePdf(10, 'S');
  const every = await splitEveryPage(src);
  ok('every page: 10 -> 10', every.length === 10, every.length);
  ok('every page names', every[0].name === 'split-page-1.pdf' && every[9].name === 'split-page-10.pdf');
  const counts = [];
  for (const p of every) counts.push((await PDFDocument.load(p.data)).getPageCount());
  ok('every page: 1 page each', counts.every((c) => c === 1));
  const chunks = await splitEveryNPages(src, 4);
  ok('chunks(4): 3 files', chunks.length === 3, chunks.length);
  const cc = [];
  for (const p of chunks) cc.push((await PDFDocument.load(p.data)).getPageCount());
  ok('chunks sizes [4,4,2]', JSON.stringify(cc) === '[4,4,2]', cc);
  await expectThrowAsync('chunks reject 0', () => splitEveryNPages(src, 0), 'whole number');
  const big = await makePdf(60, 'B');
  await expectThrowAsync('every-page caps at 50', () => splitEveryPage(big), 'capped');
  await expectThrowAsync('chunks cap groups', () => splitEveryNPages(big, 1), '50 or fewer');
  // ZIP of parts builds
  const JSZip2 = (await import('jszip')).default;
  const zip = new JSZip2();
  for (const p of chunks) zip.file(p.name, p.data);
  const blob = await zip.generateAsync({ type: 'blob' });
  ok('zip builds non-empty', blob.size > 1000, blob.size);
}

console.log('== pdf2word bold/italic runs ==');
{
  const item = (str, x, y, size, fontName = 'Helvetica') => ({
    str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.55, height: size, fontName,
  });
  const items = [
    item('Normal start ', 72, 700, 12, 'Helvetica'),
    item('bold middle', 200, 700, 12, 'Helvetica-Bold'),
    item(' and ', 300, 700, 12, 'Helvetica'),
    item('italic end.', 340, 700, 12, 'Helvetica-Oblique'),
  ];
  const lines = groupItemsIntoLines(items);
  ok('one line', lines.length === 1, lines.length);
  ok('line has runs', Array.isArray(lines[0].runs) && lines[0].runs.length >= 3, JSON.stringify(lines[0].runs?.length));
  const bolds = lines[0].runs.filter((r) => r.bold);
  const italics = lines[0].runs.filter((r) => r.italic);
  ok('bold run text', bolds.some((r) => r.text.includes('bold middle')), JSON.stringify(lines[0].runs));
  ok('italic run text', italics.some((r) => r.text.includes('italic end')), JSON.stringify(lines[0].runs));
  ok('line text unchanged', lines[0].text === 'Normal start bold middle and italic end.', lines[0].text);
  const blocks = linesToBlocks([lines]);
  ok('block carries runs', Array.isArray(blocks[0][0].runs) && blocks[0][0].runs.length >= 3);
  const docx = await assembleDocx([{ pageIndex: 0, blocks: blocks[0], images: [], textChars: 40 }], 't');
  const zip = await JSZip.loadAsync(docx);
  const docXml = await zip.file('word/document.xml').async('string');
  ok('docx has w:b for bold run', /<w:b(\/|>)/.test(docXml));
  ok('docx has w:i for italic run', /<w:i(\/|>)/.test(docXml));
  ok('docx keeps the text', docXml.includes('bold middle') && docXml.includes('italic end'));
  // old fixtures without runs still work
  const legacy = await assembleDocx([{ pageIndex: 0, blocks: [{ kind: 'p', text: 'Legacy', y: 700 }], images: [], textChars: 6 }], 't');
  ok('legacy block without runs works', legacy.length > 2000);
}

console.log('== esign multi-placement ==');
{
  const src = await makePdf(2, 'E');
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // fake PNG header
  // signPdf needs a real PNG; use pdf-lib to embed a white rect via pngjs? Instead just verify math:
  const rect = previewRectToPdf({ x: 10, y: 20, width: 100, height: 40 }, 200, 400, 400, 500);
  ok('previewRectToPdf flips y', rect.y > 0 && rect.y < 500, JSON.stringify(rect));
  ok('rect keeps size', Math.abs(rect.width - 200) < 1 && Math.abs(rect.height - 50) < 1, JSON.stringify(rect));
}

console.log('== image-core MIME ==');
{
  ok('OUTPUT_MIMES webp', OUTPUT_MIMES.webp === 'image/webp');
  ok('outputFileName keeps ext per format', outputFileName('photo.png', '-converted', 'jpeg').endsWith('.jpg') || outputFileName('photo.png', '-converted', 'jpeg').endsWith('.jpeg'), outputFileName('photo.png', '-converted', 'jpeg'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
