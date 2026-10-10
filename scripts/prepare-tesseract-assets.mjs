#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = join(root, 'public', 'tesseract');
const coreDir = join(publicDir, 'core');
const languageDir = join(publicDir, 'lang');
const corePackage = join(root, 'node_modules', 'tesseract.js-core');
const workerPackage = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
const pdfWorkerPackage = join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const coreVariants = ['relaxedsimd-lstm', 'simd-lstm', 'lstm'];
const englishUrl = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';
const englishPath = join(languageDir, 'eng.traineddata.gz');

async function download(url, destination, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects downloading English OCR data.');
  const response = await new Promise((resolve, reject) => {
    const request = get(url, { headers: { 'User-Agent': 'truepdf-build/1.0' } }, resolve);
    request.setTimeout(30_000, () => request.destroy(new Error('English OCR data download timed out.')));
    request.on('error', reject);
  });
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.resume();
    return download(new URL(response.headers.location, url).href, destination, redirects + 1);
  }
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`English OCR data download failed with HTTP ${response.statusCode}.`);
  }
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  const data = Buffer.concat(chunks);
  if (data.length < 1_000_000 || data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new Error('Downloaded English OCR data is not a valid gzip asset.');
  }
  const temporaryPath = `${destination}.tmp`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, destination);
}

async function copyIfMissing(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function main() {
  await mkdir(coreDir, { recursive: true });
  await mkdir(languageDir, { recursive: true });
  await copyFile(pdfWorkerPackage, join(root, 'public', 'pdf.worker.min.mjs'));
  await copyIfMissing(workerPackage, join(publicDir, 'worker.min.js'));
  for (const variant of coreVariants) {
    for (const extension of ['wasm.js', 'wasm']) {
      const name = `tesseract-core-${variant}.${extension}`;
      await copyIfMissing(join(corePackage, name), join(coreDir, name));
    }
  }
  let englishDataReady = false;
  try {
    const data = await readFile(englishPath);
    englishDataReady = data.length > 1_000_000 && data[0] === 0x1f && data[1] === 0x8b;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!englishDataReady) {
    console.log('[prebuild] Downloading English OCR data (~3 MB)...');
    await download(englishUrl, englishPath);
  }
  console.log('[prebuild] Tesseract worker, core, and English data are ready.');
}

main().catch((error) => {
  console.error('[prebuild] Failed to prepare Tesseract assets:', error.message);
  process.exitCode = 1;
});
