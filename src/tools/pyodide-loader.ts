// Lazy browser unlock engine: Pyodide (Python in WebAssembly) + pypdf.
// pdf-lib cannot decrypt password-protected PDFs at all, so unlocking is
// delegated to pypdf, which handles RC4 and AES (including AES-256).
// Everything still runs on the visitor's device; only the engine files
// (~15 MB, cached by the browser) come from a CDN on first use.

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs';
const PYPDF_PIN = 'pypdf==6.19.0';
const ENGINE_TIMEOUT_MS = 180000;

const DECRYPT_PYTHON = `
from pypdf import PdfReader, PdfWriter
import io

reader = PdfReader(io.BytesIO(bytes(pdf_data_in)))
if reader.is_encrypted:
    ok = reader.decrypt(pdf_password)
    if not ok:
        # Some files only restrict the owner; a blank password opens those.
        ok = reader.decrypt("")
    if not ok:
        raise ValueError("wrong-password")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
buf = io.BytesIO()
writer.write(buf)
pdf_data_out = buf.getvalue()
`;

interface Pyodide {
  globals: {
    set(name: string, value: unknown): void;
    get(name: string): { toJs(): Uint8Array; destroy(): void };
  };
  runPython(code: string): void;
  loadPackage(name: string): Promise<void>;
  pyimport(name: string): { install(spec: string): Promise<void> };
}

let enginePromise: Promise<Pyodide> | null = null;

function timeoutError(): Error {
  return new Error(
    'The unlock engine took too long to download. Check your connection and try again.'
  );
}

/** Load the engine, reporting progress. Cached after the first call. */
export function loadUnlockEngine(onProgress?: (msg: string) => void): Promise<Pyodide> {
  if (!enginePromise) {
    enginePromise = (async (): Promise<Pyodide> => {
      onProgress?.('Downloading the unlock engine (one-time)…');
      const { loadPyodide } = (await import(/* @vite-ignore */ PYODIDE_URL)) as {
        loadPyodide: () => Promise<Pyodide>;
      };
      const pyodide = await loadPyodide();
      onProgress?.('Preparing the unlock engine…');
      await pyodide.loadPackage('micropip');
      await pyodide.pyimport('micropip').install(PYPDF_PIN);
      return pyodide;
    })();
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  const load = enginePromise;
  const timeout = new Promise<Pyodide>((_, reject) => {
    const t = setTimeout(() => reject(timeoutError()), ENGINE_TIMEOUT_MS);
    load.then(
      (v) => {
        clearTimeout(t);
      },
      () => {
        clearTimeout(t);
      }
    );
  });
  return Promise.race([load, timeout]);
}

/**
 * Remove password protection from a PDF when the password is known.
 * Returns the unlocked PDF bytes. Throws WRONG_PASSWORD when the
 * password (and a blank password) both fail.
 */
export async function unlockPdfBytes(
  data: Uint8Array,
  password: string,
  onProgress?: (msg: string) => void
): Promise<Uint8Array> {
  const pyodide = await loadUnlockEngine(onProgress);
  pyodide.globals.set('pdf_data_in', data);
  pyodide.globals.set('pdf_password', password);
  try {
    pyodide.runPython(DECRYPT_PYTHON);
  } catch (err) {
    if (err instanceof Error && err.message.includes('wrong-password')) {
      throw new Error('WRONG_PASSWORD');
    }
    throw err;
  }
  const out = pyodide.globals.get('pdf_data_out');
  try {
    return out.toJs();
  } finally {
    out.destroy();
  }
}
