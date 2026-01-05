// Pure QR logic shared by the browser tool and the Node verification script.
// No DOM access here.
import QRCode from 'qrcode';

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrOptions {
  text: string;
  /** Output pixel size (square). */
  size: number;
  errorCorrection: QrErrorCorrection;
  dark?: string;
  light?: string;
}

function baseOptions(opts: QrOptions) {
  return {
    errorCorrectionLevel: opts.errorCorrection,
    margin: 4,
    color: {
      dark: opts.dark ?? '#000000',
      light: opts.light ?? '#ffffff00', // transparent background by default
    },
  };
}

/** Generate a PNG data URL of the QR code. */
export async function makeQrPng(opts: QrOptions): Promise<string> {
  if (!opts.text) throw new Error('Enter some text or a link first.');
  if (opts.text.length > 4000) throw new Error('That text is too long for a QR code.');
  return QRCode.toDataURL(opts.text, {
    ...baseOptions(opts),
    width: opts.size,
  });
}

/** Generate an SVG string of the QR code (scales cleanly for print). */
export async function makeQrSvg(opts: QrOptions): Promise<string> {
  if (!opts.text) throw new Error('Enter some text or a link first.');
  if (opts.text.length > 4000) throw new Error('That text is too long for a QR code.');
  return QRCode.toString(opts.text, {
    ...baseOptions(opts),
    type: 'svg',
    width: opts.size,
  });
}

/**
 * Estimate which QR version a payload needs. Useful for UI hints.
 * Returns the module count (version 1 = 21 modules).
 */
export async function qrModuleCount(text: string, ec: QrErrorCorrection): Promise<number> {
  const segs = QRCode.create(text, { errorCorrectionLevel: ec });
  return segs.modules.size;
}
