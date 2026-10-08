// Extended PDF metadata read/write, including the Producer field.
// Tool-specific helper for the edit-pdf-metadata tool only; the shared
// ../lib/pdf-meta.ts stays untouched.
import { PDFDocument } from 'pdf-lib';

/** The editable metadata fields, in the order the form shows them. */
export interface PdfMetadataFull {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export const EMPTY_METADATA_FULL: PdfMetadataFull = {
  title: '',
  author: '',
  subject: '',
  keywords: '',
  creator: '',
  producer: '',
};

/**
 * Read a PDF's document info dictionary; missing entries come back empty.
 * `updateMetadata: false` matters: pdf-lib's default load stamps its own
 * name as the Producer, which would hide the file's real value.
 */
export async function readPdfMetadataFull(buffer: Uint8Array): Promise<PdfMetadataFull> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
  };
}

/** Write the metadata back into the document and return the new file bytes. */
export async function writePdfMetadataFull(
  buffer: Uint8Array,
  meta: PdfMetadataFull
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
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
  doc.setProducer(meta.producer);
  return doc.save();
}

/** The fields that identify a person or app; cleared by "remove personal info". */
export const PERSONAL_FIELDS: (keyof PdfMetadataFull)[] = ['author', 'creator', 'producer'];
