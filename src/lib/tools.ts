// Canonical tool index: drives the homepage and the Cmd+K palette.
// hrefs are site-root-relative; pages apply basePath().
export interface ToolEntry {
  href: string;
  name: string;
  desc: string;
  group: string;
  tag: string;
}

export const TOOL_GROUPS: { name: string; tools: ToolEntry[] }[] = [
  {
    name: 'Career',
    tools: [
      { href: '/resume-builder', name: 'Resume builder', desc: 'Write a resume with live preview, download the PDF free. No signup, no pay-to-download trap.', group: 'Career', tag: 'PDF' },
    ],
  },
  {
    name: 'Business',
    tools: [
      { href: '/invoice-generator', name: 'Invoice generator', desc: 'Line items, tax, discounts, 22 currencies, live preview, free PDF export.', group: 'Business', tag: 'PDF' },
      { href: '/email-signature-generator', name: 'Email signature generator', desc: 'Three layouts, six accent colors. Copy rich text into Gmail or Outlook.', group: 'Business', tag: 'HTML' },
      { href: '/business-profile', name: 'Business profile', desc: 'Save your logo and company details once; the business tools fill them in.', group: 'Business', tag: 'Settings' },
    ],
  },
  {
    name: 'PDF',
    tools: [
      { href: '/merge-pdf', name: 'Merge PDF', desc: 'Combine several PDFs into one, in your order.', group: 'PDF', tag: 'PDF' },
      { href: '/split-pdf', name: 'Split PDF', desc: 'Extract pages by number into new documents.', group: 'PDF', tag: 'PDF' },
      { href: '/images-to-pdf', name: 'Images to PDF', desc: 'Turn JPG, PNG, and WebP images into one PDF.', group: 'PDF', tag: 'PDF' },
      { href: '/pdf-compressor', name: 'Compress PDF', desc: 'Shrink a PDF by rebuilding pages at lower resolution.', group: 'PDF', tag: 'PDF' },
      { href: '/pdf-to-jpg', name: 'PDF to JPG', desc: 'Convert PDF pages to JPG or PNG images.', group: 'PDF', tag: 'JPG · PNG' },
      { href: '/pdf-redactor', name: 'Redact PDF', desc: 'Permanently black out sensitive parts of a PDF.', group: 'PDF', tag: 'PDF' },
      { href: '/pdf-esignature', name: 'Sign PDF', desc: 'Draw or type a signature and place it on any page.', group: 'PDF', tag: 'PDF' },
    ],
  },
  {
    name: 'Image',
    tools: [
      { href: '/image-compressor', name: 'Image compressor', desc: 'Shrink photos and screenshots with a quality slider.', group: 'Image', tag: 'JPG · PNG · WebP' },
      { href: '/image-converter', name: 'Image converter', desc: 'Convert between PNG, JPEG, WebP, and AVIF.', group: 'Image', tag: 'JPG · PNG · WebP' },
      { href: '/background-remover', name: 'Background remover', desc: 'AI background removal, full-resolution PNG, free.', group: 'Image', tag: 'PNG' },
      { href: '/image-ocr', name: 'Image OCR', desc: 'Read text from photos and scans, copy or download .txt.', group: 'Image', tag: 'TXT' },
      { href: '/image-tracer', name: 'Image tracer', desc: 'Turn logos and icons into SVG vectors, free download.', group: 'Image', tag: 'SVG' },
    ],
  },
  {
    name: 'Media',
    tools: [
      { href: '/audio-trimmer', name: 'Audio trimmer', desc: 'Cut audio with a waveform editor. Export WAV or MP3.', group: 'Media', tag: 'WAV · MP3' },
      { href: '/audio-merger', name: 'Audio merger', desc: 'Join clips into one file, with fades at each join.', group: 'Media', tag: 'WAV · MP3' },
      { href: '/audio-converter', name: 'Audio converter', desc: 'Convert between MP3, WAV, and OGG Vorbis.', group: 'Media', tag: 'MP3 · WAV · OGG' },
      { href: '/video-compressor', name: 'Video compressor', desc: 'Shrink video to 25MB, 10MB, or a custom size.', group: 'Media', tag: 'MP4' },
      { href: '/video-trimmer', name: 'Video trimmer', desc: 'Cut a section out of a video, fast or precise.', group: 'Media', tag: 'MP4' },
      { href: '/video-converter', name: 'Video converter', desc: 'Convert between MP4, WebM, and MOV.', group: 'Media', tag: 'MP4 · WebM' },
      { href: '/screen-recorder', name: 'Screen recorder', desc: 'Record your screen. No time cap, no watermark.', group: 'Media', tag: 'WebM' },
    ],
  },
  {
    name: 'Generators',
    tools: [
      { href: '/qr-generator', name: 'QR generator', desc: 'QR codes for links and text, with optional logo.', group: 'Generators', tag: 'PNG · SVG' },
    ],
  },
];

export const ALL_TOOLS: ToolEntry[] = TOOL_GROUPS.flatMap((g) => g.tools);

export function toolCount(): number {
  return ALL_TOOLS.length;
}
