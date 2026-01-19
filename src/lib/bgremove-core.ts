// Background remover pure logic: option validation, output filenames, and
// progress labels. No DOM. The @imgly/background-removal engine is
// browser-only (it downloads a ~40MB ONNX model and runs inference on
// canvas/WebGPU), so everything except the engine calls is tested here.

export type BgChoice = 'transparent' | 'white' | 'black';

export const BG_CHOICES: readonly BgChoice[] = ['transparent', 'white', 'black'];

/** The imgly progress callback reports keys like `fetch:<chunk>` (model
 *  download) and `compute:<step>` (inference). Two UI stages follow. */
export type BgStage = 'loading-model' | 'removing';

/** Honest one-time-download note shown next to the file picker. */
export const BG_MODEL_DOWNLOAD_NOTE =
  'The AI model (~40 MB) downloads once per browser the first time you use this tool. ' +
  'After that it is cached, so repeat visits work offline and start instantly.';

/** Validate the background choice radio value; unknown values fall back to transparent. */
export function validateBgChoice(value: unknown): BgChoice {
  return value === 'white' || value === 'black' ? value : 'transparent';
}

/** Fill color to composite behind the cut-out, or null to keep transparency. */
export function bgFillColor(choice: BgChoice): string | null {
  if (choice === 'white') return '#ffffff';
  if (choice === 'black') return '#000000';
  return null;
}

/** Strip the extension from a filename; dotfiles like ".png" have no stem. */
function stemOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot > 0) return base.slice(0, dot);
  return 'image';
}

/** Output filename: photo.png -> photo-no-bg.png */
export function bgOutputFileName(originalName: string): string {
  return `${stemOf(originalName)}-no-bg.png`;
}

/** Which UI stage an imgly progress key belongs to. */
export function bgStageFromProgressKey(key: string): BgStage {
  return key.startsWith('fetch:') ? 'loading-model' : 'removing';
}

/** Human-readable progress label for an imgly progress callback tick. */
export function bgProgressLabel(key: string, current: number, total: number): string {
  if (key.startsWith('fetch:')) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    return `Downloading the AI model… ${pct}% (once per browser)`;
  }
  if (key === 'compute:inference') return 'Removing the background…';
  if (key === 'compute:mask') return 'Cleaning up the edges…';
  if (key === 'compute:decode') return 'Reading your image…';
  return 'Working…';
}

/** Friendly message for common background-removal failures. */
export function bgRemoveErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network|fetch|failed to fetch|load/i.test(msg)) {
    return 'Could not download the AI model. Check your connection and try again — your image never left your device.';
  }
  if (/webgl|webgpu|gpu|wasm/i.test(msg)) {
    return 'Your browser could not start the AI engine (WebAssembly/WebGL blocked). Try a recent Chrome, Edge, Firefox, or Safari.';
  }
  return msg || 'Background removal failed.';
}
