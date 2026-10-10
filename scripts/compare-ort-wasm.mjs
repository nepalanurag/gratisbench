import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import * as native from 'onnxruntime-node';
import * as web from 'onnxruntime-web';

const modelPath = new URL('../public/models/u2netp.onnx', import.meta.url).pathname;
const imagePath = new URL('../test-fixtures/sample.png', import.meta.url);
const tolerance = Number(process.env.ORT_PARITY_TOLERANCE ?? 1e-3);

function imageTensor(image, shape) {
  const [, , height, width] = shape;
  const tensor = new Float32Array(3 * height * width);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor(y * image.height / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor(x * image.width / width));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = y * width + x;
      for (let channel = 0; channel < 3; channel++) {
        tensor[channel * width * height + target] = image.data[source + channel] / 255;
      }
    }
  }
  return tensor;
}

function randomTensor(shape) {
  const tensor = new Float32Array(shape.reduce((size, dimension) => size * dimension, 1));
  let state = 0x12345678;
  for (let index = 0; index < tensor.length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    tensor[index] = state / 0x100000000;
  }
  return tensor;
}

function summarize(data) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of data) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return { min, max, mean: sum / data.length };
}

const image = PNG.sync.read(await readFile(imagePath));
const nativeSession = await native.InferenceSession.create(modelPath);
const wasmSession = await web.InferenceSession.create(modelPath, {
  executionProviders: ['wasm'],
});

try {
  const inputName = nativeSession.inputNames[0];
  assert.equal(wasmSession.inputNames[0], inputName, 'Runtime input names differ');
  const shape = [1, 3, 320, 320];
  console.log('Model input:', inputName, JSON.stringify(shape));
  console.log('Native outputs:', nativeSession.outputNames.join(', '));
  console.log('WASM outputs:', wasmSession.outputNames.join(', '));

  let failed = false;
  const cases = [
    ['sample image, RGB / 255', imageTensor(image, shape)],
    ['deterministic texture, RGB / 255 range', randomTensor(shape)],
  ];

  for (const [label, data] of cases) {
    const nativeFeeds = { [inputName]: new native.Tensor('float32', data, shape) };
    const wasmFeeds = { [inputName]: new web.Tensor('float32', data, shape) };
    const [nativeOutputs, wasmOutputs] = await Promise.all([
      nativeSession.run(nativeFeeds),
      wasmSession.run(wasmFeeds),
    ]);
    console.log(`\nCase: ${label}`);

    for (const outputName of nativeSession.outputNames) {
      assert.ok(wasmOutputs[outputName], `WASM output missing: ${outputName}`);
      const nativeOutput = nativeOutputs[outputName];
      const wasmOutput = wasmOutputs[outputName];
      assert.deepEqual(wasmOutput.dims, nativeOutput.dims, `${outputName} output shapes differ`);
      assert.equal(wasmOutput.data.length, nativeOutput.data.length, `${outputName} output lengths differ`);

      let maxAbs = 0;
      let sumAbs = 0;
      let overTolerance = 0;
      for (let index = 0; index < nativeOutput.data.length; index++) {
        const difference = Math.abs(Number(nativeOutput.data[index]) - Number(wasmOutput.data[index]));
        maxAbs = Math.max(maxAbs, difference);
        sumAbs += difference;
        if (difference > tolerance) overTolerance++;
      }

      const nativeStats = summarize(nativeOutput.data);
      const wasmStats = summarize(wasmOutput.data);
      const result = {
        output: outputName,
        shape: nativeOutput.dims,
        native: nativeStats,
        wasm: wasmStats,
        maxAbs,
        meanAbs: sumAbs / nativeOutput.data.length,
        overTolerance,
      };
      console.log(JSON.stringify(result));
      if (maxAbs > tolerance) failed = true;
    }
  }

  console.log(`\nAbsolute tolerance: ${tolerance}`);
  console.log(failed ? 'RESULT: outputs differ beyond tolerance' : 'RESULT: outputs agree within tolerance');
  process.exitCode = failed ? 1 : 0;
} finally {
  await wasmSession.release();
  await nativeSession.release();
}