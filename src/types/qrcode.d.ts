// The `qrcode` package ships no TypeScript types and @types/qrcode is not
// installed; minimal declarations for the three entry points qr-core uses.
declare module 'qrcode' {
  export interface QRCodeOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
    type?: string;
    color?: { dark?: string; light?: string };
  }
  export interface QRCodeSegments {
    modules: { size: number; data: Uint8Array };
  }
  const QRCode: {
    toDataURL(text: string, options?: QRCodeOptions): Promise<string>;
    toString(text: string, options?: QRCodeOptions): Promise<string>;
    create(text: string, options?: { errorCorrectionLevel?: string }): QRCodeSegments;
  };
  export default QRCode;
}
