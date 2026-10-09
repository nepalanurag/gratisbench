#!/usr/bin/env node
// Downloads the ORMBG model at build time (Vercel build has no CORS restrictions).
// The model is 43MB, hosted on Hugging Face. This runs during `npm run build`
// via the `prebuild` script, placing the file in public/models/ so it's
// served same-origin.
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { get } from 'https';
import { pipeline } from 'stream/promises';

const MODEL_URL = 'https://huggingface.co/onnx-community/ormbg-ONNX/resolve/main/onnx/model_int8.onnx?download=true';
const OUT_PATH = new URL('../public/models/ormbg_int8.onnx', import.meta.url).pathname;

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'truepdf-build/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }
      const file = createWriteStream(dest);
      pipeline(res, file).then(resolve, reject);
    }).on('error', reject);
  });
}

async function main() {
  if (existsSync(OUT_PATH)) {
    console.log('[prebuild] ORMBG model already exists, skipping download.');
    return;
  }
  console.log('[prebuild] Downloading ORMBG model (43MB)...');
  mkdirSync(new URL('../public/models/', import.meta.url).pathname, { recursive: true });
  await download(MODEL_URL, OUT_PATH);
  console.log('[prebuild] ORMBG model downloaded.');
}

main().catch((err) => {
  console.error('[prebuild] Failed:', err.message);
  process.exit(1);
});
