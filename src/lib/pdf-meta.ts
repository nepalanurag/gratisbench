// PDF metadata read/write. DOM-free pdf-lib helpers shared by the browser
// tool and the Node verification script.
import { PDFDocument } from 'pdf-lib';

/** The editable metadata fields, in the order the form shows them. */
export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
}

export const EMPTY_METADATA: PdfMetadata = {
  title: '',
  author: '',
  subject: '',
  keywords: '',
  creator: '',
};

/** Read a PDF's document info dictionary; missing entries come back empty. */
export async function readPdfMetadata(buffer: Uint8Array): Promise<PdfMetadata> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
  };
}

/** Write the metadata back into the document and return the new file bytes. */
export async function writePdfMetadata(
  buffer: Uint8Array,
  meta: PdfMetadata
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  // pdf-lib takes keywords as an array; the UI edits them comma-separated.
  doc.setKeywords(
    meta.keywords
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
  );
  doc.setCreator(meta.creator);
  return doc.save();
}

/** True when every field is blank: the file carries no descriptive info. */
export function metadataIsEmpty(meta: PdfMetadata): boolean {
  return Object.values(meta).every((v) => v.trim() === '');
}

/** Output filename for the metadata-edited PDF. */
export function metadataFileName(stem: string): string {
  return `${stem}-metadata.pdf`;
}
