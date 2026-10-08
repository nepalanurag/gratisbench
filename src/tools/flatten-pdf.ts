// Flatten PDF tool: DOM glue. Handles several PDFs at once: each file's
// form fields are listed, then baked into the page on demand. An optional
// pass also removes comments, highlights, and sticky notes.
import { PDFDocument, PDFName } from 'pdf-lib';
import { flattenPdf, flattenedFileName } from '../lib/pdf-core.ts';
import { listFormFields } from '../lib/pdf-forms.ts';
import { pdfLoadErrorMessage } from './common.ts';
import {
  el,
  formatBytes,
  downloadBytes,
  showError,
  hideError,
  setBusy,
  setupDropzone,
  mobileFileSizeGuard,
} from './common.ts';

interface FlatJob {
  name: string;
  stem: string;
  bytes: Uint8Array;
  fieldCount: number;
  out: Uint8Array | null;
  status: string;
}

let jobs: FlatJob[] = [];

/** Remove every annotation (comments, highlights, sticky notes) from a PDF. */
async function stripAnnotations(buffer: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of('Annots'));
  }
  return doc.save();
}

function renderJobs(): void {
  const list = el('file-list');
  list.innerHTML = '';
  for (const job of jobs) {
    const row = document.createElement('div');
    row.className = 'flat-file';

    const info = document.createElement('div');
    info.className = 'flat-file-info';
    const name = document.createElement('strong');
    name.textContent = job.name;
    const sub = document.createElement('span');
    sub.className = 'flat-file-sub';
    sub.textContent =
      job.fieldCount > 0
        ? `${job.fieldCount} form field${job.fieldCount === 1 ? '' : 's'}`
        : 'no form fields';
    info.append(name, sub);

    const right = document.createElement('div');
    right.className = 'flat-file-right';
    const status = document.createElement('span');
    status.className = 'flat-status';
    status.textContent = job.status;
    right.appendChild(status);
    if (job.out) {
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'btn btn-secondary btn-small';
      dl.textContent = 'Download';
      dl.addEventListener('click', () => {
        if (job.out) downloadBytes(flattenedFileName(job.stem), job.out, 'application/pdf');
      });
      right.appendChild(dl);
    }
    row.append(info, right);
    list.appendChild(row);
  }
  const done = jobs.filter((j) => j.out).length;
  const zipBtn = el<HTMLButtonElement>('zip-btn');
  zipBtn.disabled = done === 0;
  zipBtn.textContent = done === 0 ? 'Download all as ZIP' : `Download ${done} as ZIP`;
}

export function initFlattenPdf(): void {
  setupDropzone('dropzone', 'file-input', async (files) => {
    hideError('error-box');
    el('result').hidden = true;
    el('files-wrap').hidden = true;
    el('file-list').innerHTML = '';
    jobs = [];
    const pdfs = files.filter(
      (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
    );
    if (files.length > 0 && pdfs.length === 0) {
      showError('error-box', `"${files[0].name}" is not a PDF.`);
      return;
    }
    if (pdfs.length === 0) return;
    const tooBig = pdfs.map(mobileFileSizeGuard).find((g) => g?.block);
    if (tooBig?.block) {
      showError('error-box', tooBig.message);
      return;
    }
    el('files-wrap').hidden = false;
    for (const f of pdfs) {
      const job: FlatJob = {
        name: f.name,
        stem: f.name.replace(/\.[^.]+$/, '') || 'document',
        bytes: new Uint8Array(await f.arrayBuffer()),
        fieldCount: 0,
        out: null,
        status: 'reading…',
      };
      jobs.push(job);
      renderJobs();
      try {
        job.fieldCount = (await listFormFields(job.bytes)).length;
        job.status = job.fieldCount > 0 ? 'ready' : 'nothing to flatten';
      } catch (err) {
        job.status = 'could not read';
        showError('error-box', pdfLoadErrorMessage(err));
      }
      renderJobs();
    }
  });

  el('flatten-btn').addEventListener('click', async () => {
    if (jobs.length === 0) return;
    hideError('error-box');
    el('result').hidden = true;
    setBusy('flatten-btn', true, 'Flattening…');
    const strip = el<HTMLInputElement>('opt-annots').checked;
    try {
      for (const job of jobs) {
        if (job.out || job.status === 'could not read') continue;
        job.status = 'working…';
        renderJobs();
        await new Promise((r) => setTimeout(r, 0));
        try {
          let out: Uint8Array | null = null;
          if (job.fieldCount > 0) {
            out = await flattenPdf(job.bytes.slice());
          }
          if (strip) {
            // Strip markups even when there were no fields to flatten.
            out = await stripAnnotations((out ?? job.bytes).slice());
          }
          if (!out) {
            job.status = 'nothing to flatten';
          } else {
            job.out = out;
            job.status = strip ? 'flattened, markups removed' : 'flattened';
          }
        } catch (err) {
          job.status = 'failed';
          showError('error-box', `${job.name}: ${err instanceof Error ? err.message : 'flattening failed.'}`);
        }
        renderJobs();
      }
      const done = jobs.filter((j) => j.out).length;
      if (done > 0) {
        el('result-info').textContent =
          `${done} of ${jobs.length} file${jobs.length === 1 ? '' : 's'} flattened. ` +
          'Open one and try clicking a field: nothing should respond.';
        el('result').hidden = false;
        el('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } finally {
      setBusy('flatten-btn', false);
    }
  });

  el('zip-btn').addEventListener('click', async () => {
    const done = jobs.filter((j) => j.out);
    if (done.length === 0) return;
    hideError('error-box');
    setBusy('zip-btn', true, 'Zipping…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const job of done) {
        if (job.out) zip.file(flattenedFileName(job.stem), job.out);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBytes('flattened.zip', new Uint8Array(await blob.arrayBuffer()), 'application/zip');
    } catch (err) {
      showError('error-box', err instanceof Error ? err.message : 'Zipping failed.');
    } finally {
      setBusy('zip-btn', false);
    }
  });
}
