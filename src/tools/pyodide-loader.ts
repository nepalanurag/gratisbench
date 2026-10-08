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
pdf_was_locked = bool(reader.is_encrypted)
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

const ENCRYPT_PYTHON = `
from pypdf import PdfReader, PdfWriter
try:
    from pypdf import UserAccessPermissions
except ImportError:
    from pypdf.constants import UserAccessPermissions
import io

reader = PdfReader(io.BytesIO(bytes(pdf_data_in)))
if reader.is_encrypted:
    raise ValueError("already-encrypted")
writer = PdfWriter()
for page in reader.pages:
    writer.add_page(page)
# Owner password + permission flags are optional. When omitted, the file gets
# a plain open-with-password lock (the previous behavior, unchanged). Note:
# permissions_flag must be omitted rather than passed as None, because
# pypdf's default is ALL_DOCUMENT_PERMISSIONS.
owner = pdf_owner_password if pdf_owner_password else None
if pdf_permissions is None:
    writer.encrypt(pdf_password, owner_password=owner)
else:
    writer.encrypt(
        pdf_password,
        owner_password=owner,
        permissions_flag=UserAccessPermissions(int(pdf_permissions)),
    )
buf = io.BytesIO()
writer.write(buf)
pdf_data_out = buf.getvalue()
`;

interface PyodideValue {
  toJs(): unknown;
  destroy(): void;
}

interface Pyodide {
  globals: {
    set(name: string, value: unknown): void;
    get(name: string): PyodideValue;
  };
  runPython(code: string): void;
  loadPackage(name: string): Promise<void>;
  pyimport(name: string): { install(spec: string): Promise<void> };
}

/** Read bytes out of a Pyodide global and free it. */
function takeBytes(v: PyodideValue): Uint8Array {
  try {
    return v.toJs() as Uint8Array;
  } finally {
    v.destroy();
  }
}

let enginePromise: Promise<Pyodide> | null = null;

function timeoutError(engineLabel: string): Error {
  return new Error(
    `The ${engineLabel} engine took too long to download. Check your connection and try again.`
  );
}

/** Load the engine, reporting progress. Cached after the first call. */
export function loadUnlockEngine(
  onProgress?: (msg: string) => void,
  engineLabel = 'unlock'
): Promise<Pyodide> {
  if (!enginePromise) {
    enginePromise = (async (): Promise<Pyodide> => {
      onProgress?.(`Downloading the ${engineLabel} engine (one-time)…`);
      const { loadPyodide } = (await import(/* @vite-ignore */ PYODIDE_URL)) as {
        loadPyodide: () => Promise<Pyodide>;
      };
      const pyodide = await loadPyodide();
      onProgress?.(`Preparing the ${engineLabel} engine…`);
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
    const t = setTimeout(() => reject(timeoutError(engineLabel)), ENGINE_TIMEOUT_MS);
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
 * Returns the unlocked PDF bytes plus whether the file was actually
 * locked (it may only have carried copy/print limits). Throws
 * WRONG_PASSWORD when the password (and a blank password) both fail.
 */
export async function unlockPdfBytes(
  data: Uint8Array,
  password: string,
  onProgress?: (msg: string) => void
): Promise<{ bytes: Uint8Array; wasLocked: boolean }> {
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
  const flag = pyodide.globals.get('pdf_was_locked');
  const bytes = takeBytes(out); // frees `out`
  try {
    return { bytes, wasLocked: flag.toJs() === true || flag.toJs() === 1 };
  } finally {
    flag.destroy();
  }
}

/**
 * Permission preset for PDF protection. Both fields are optional; when
 * omitted the file gets a plain open-with-password lock.
 *
 * pypdf permission flags (UserAccessPermissions): 4 = print only,
 * 20 = print + copy text, 0 = view only. Omit the flags for full access.
 */
export interface EncryptPermissions {
  /** The password that unlocks printing/copying/changing. Defaults to the user password. */
  ownerPassword?: string;
  /** Permission bit flags. Omit for full access once the password is given. */
  permissionFlags?: number;
}

/**
 * Add password protection to a PDF (AES encryption, pypdf).
 * Returns the protected PDF bytes. Throws ALREADY_ENCRYPTED when the
 * input is already password-protected.
 *
 * Pass `password` as '' with an ownerPassword to leave the file openable
 * without a password while restricting what can be done with it.
 */
export async function encryptPdfBytes(
  data: Uint8Array,
  password: string,
  onProgress?: (msg: string) => void,
  engineLabel = 'protect',
  permissions?: EncryptPermissions
): Promise<Uint8Array> {
  if (!password && !permissions?.ownerPassword) {
    throw new Error('Choose a password first.');
  }
  const pyodide = await loadUnlockEngine(onProgress, engineLabel);
  pyodide.globals.set('pdf_data_in', data);
  pyodide.globals.set('pdf_password', password);
  pyodide.globals.set('pdf_owner_password', permissions?.ownerPassword ?? null);
  pyodide.globals.set('pdf_permissions', permissions?.permissionFlags ?? null);
  try {
    pyodide.runPython(ENCRYPT_PYTHON);
  } catch (err) {
    if (err instanceof Error && err.message.includes('already-encrypted')) {
      throw new Error('ALREADY_ENCRYPTED');
    }
    throw err;
  }
  const out = pyodide.globals.get('pdf_data_out');
  return takeBytes(out);
}

/**
 * Verify that encrypted bytes really require the password: load them with
 * pypdf and report the page count. pdf-lib cannot open encrypted files,
 * so the check goes through the same engine.
 */
export async function verifyEncryptedBytes(
  data: Uint8Array,
  password: string
): Promise<number> {
  const pyodide = await loadUnlockEngine();
  pyodide.globals.set('pdf_check_in', data);
  pyodide.globals.set('pdf_password', password);
  pyodide.runPython(`
from pypdf import PdfReader
import io
reader = PdfReader(io.BytesIO(bytes(pdf_check_in)))
if reader.is_encrypted:
    ok = reader.decrypt(pdf_password)
    if not ok:
        raise ValueError("verify-failed")
check_page_count = len(reader.pages)
`);
  const pages = pyodide.globals.get('check_page_count');
  try {
    return Number(pages.toJs());
  } finally {
    pages.destroy();
  }
}
