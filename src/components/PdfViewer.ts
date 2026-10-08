/**
 * PdfViewer — Shared PDF viewer component for TruePDF
 * Features: full-page view, zoom/pinch, page navigation, thumbnail sidebar, search, text selection
 * Used by: pdf-editor (preview mode) and other PDF workflows.
 *
 * pdf.js is lazy-loaded through the shared loader in ../tools/pdf-render.ts,
 * the same path the rest of the tools use, so the engine only downloads after
 * the user actually opens a preview.
 */
import { loadPdfjs } from '../tools/pdf-render.ts';

type PdfJsModule = Awaited<ReturnType<typeof loadPdfjs>>;

export interface PdfViewerOptions {
  container: HTMLElement;
  showThumbnails?: boolean;
  showSearch?: boolean;
  onPageChange?: (pageNum: number, totalPages: number) => void;
}

export class PdfViewer {
  private container: HTMLElement;
  private pdfjs: PdfJsModule | null = null;
  private pdfDoc: any = null;
  private currentPage: number = 1;
  private scale: number = 1.5;
  private basePageWidth = 600;
  private options: PdfViewerOptions;

  private viewerEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private sidebarEl!: HTMLElement | null;
  private searchBox!: HTMLInputElement | null;
  private searchStatus!: HTMLElement | null;
  private matchPages: number[] = [];
  private matchIndex = 0;
  private searchTimer: number | null = null;
  private destroyed = false;

  constructor(options: PdfViewerOptions) {
    this.options = options;
    this.container = options.container;
    this.init();
  }

  private init() {
    this.container.classList.add('pdf-viewer');
    this.container.innerHTML = `
      <div class="pdf-viewer-toolbar">
        <button class="pv-btn" data-action="prev" title="Previous page">‹</button>
        <span class="pv-page-info">
          <input type="number" class="pv-page-input" min="1" value="1"> / <span class="pv-total">0</span>
        </span>
        <button class="pv-btn" data-action="next" title="Next page">›</button>
        <span class="pv-divider"></span>
        <button class="pv-btn" data-action="zoom-out" title="Zoom out">−</button>
        <span class="pv-zoom">100%</span>
        <button class="pv-btn" data-action="zoom-in" title="Zoom in">+</button>
        <button class="pv-btn" data-action="zoom-fit" title="Fit to width">Fit</button>
        ${this.options.showSearch !== false ? `
          <span class="pv-divider"></span>
          <input type="text" class="pv-search" placeholder="Search in document…" aria-label="Search in document">
          <span class="pv-search-status" role="status"></span>
        ` : ''}
      </div>
      <div class="pdf-viewer-body">
        ${this.options.showThumbnails !== false ? '<div class="pdf-viewer-sidebar" aria-label="Page thumbnails"></div>' : ''}
        <div class="pdf-viewer-canvas-wrap">
          <div class="pv-page">
            <canvas class="pdf-viewer-canvas"></canvas>
            <div class="pdf-viewer-text-layer"></div>
          </div>
        </div>
      </div>
    `;

    this.toolbarEl = this.container.querySelector('.pdf-viewer-toolbar')!;
    this.viewerEl = this.container.querySelector('.pdf-viewer-canvas-wrap')!;
    this.sidebarEl = this.container.querySelector('.pdf-viewer-sidebar');

    this.toolbarEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
      if (!btn) return;
      this.handleAction(btn.dataset.action!);
    });

    const pageInput = this.toolbarEl.querySelector('.pv-page-input') as HTMLInputElement;
    pageInput.addEventListener('change', () => {
      const page = parseInt(pageInput.value, 10);
      if (this.pdfDoc && page >= 1 && page <= this.pdfDoc.numPages) {
        void this.goToPage(page);
      } else {
        pageInput.value = String(this.currentPage);
      }
    });

    // Pinch zoom on touch devices
    let initialDistance = 0;
    let initialScale = 1;
    this.viewerEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        initialDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = this.scale;
      }
    });
    this.viewerEl.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const distance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (initialDistance > 0) this.setScale(initialScale * (distance / initialDistance));
      }
    }, { passive: false });

    // Search
    if (this.options.showSearch !== false) {
      this.searchBox = this.toolbarEl.querySelector('.pv-search');
      this.searchStatus = this.toolbarEl.querySelector('.pv-search-status');
      this.searchBox?.addEventListener('input', () => {
        if (this.searchTimer) window.clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => void this.runSearch(), 300);
      });
      this.searchBox?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.nextMatch();
        }
      });
    } else {
      this.searchBox = null;
      this.searchStatus = null;
    }
  }

  /** Load PDF bytes and render the first page plus thumbnails. */
  async load(data: ArrayBuffer | Uint8Array): Promise<void> {
    this.pdfjs = await loadPdfjs();
    if (this.destroyed) return;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.pdfDoc = await this.pdfjs.getDocument({ data: bytes }).promise;
    if (this.destroyed) return;
    const total = this.pdfDoc.numPages;

    (this.toolbarEl.querySelector('.pv-total') as HTMLElement).textContent = String(total);
    const pageInput = this.toolbarEl.querySelector('.pv-page-input') as HTMLInputElement;
    pageInput.max = String(total);
    pageInput.value = '1';

    await this.renderThumbnails();
    await this.goToPage(1);
  }

  private async renderThumbnails(): Promise<void> {
    if (!this.sidebarEl || this.options.showThumbnails === false || !this.pdfDoc) return;
    this.sidebarEl.innerHTML = '';
    const total = this.pdfDoc.numPages;
    for (let i = 1; i <= total; i++) {
      if (this.destroyed) return;
      const page = await this.pdfDoc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      // Fit the thumbnail to the ~100px sidebar width.
      const tScale = 100 / base.width;
      const viewport = page.getViewport({ scale: tScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.className = 'pv-thumb';
      canvas.dataset.page = String(i);
      canvas.title = `Page ${i}`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport }).promise;
      }
      page.cleanup();
      canvas.addEventListener('click', () => void this.goToPage(i));
      this.sidebarEl.appendChild(canvas);
    }
    this.markMatches();
  }

  async goToPage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.pdfjs || pageNum < 1 || pageNum > this.pdfDoc.numPages) return;
    this.currentPage = pageNum;
    const page = await this.pdfDoc.getPage(pageNum);
    if (this.destroyed) return;
    const base = page.getViewport({ scale: 1 });
    this.basePageWidth = base.width;
    const viewport = page.getViewport({ scale: this.scale });

    const canvas = this.viewerEl.querySelector('canvas') as HTMLCanvasElement;
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
    }

    await this.renderTextLayer(page, viewport);
    page.cleanup();

    (this.toolbarEl.querySelector('.pv-page-input') as HTMLInputElement).value = String(pageNum);
    this.sidebarEl?.querySelectorAll('.pv-thumb').forEach((thumb) => {
      thumb.classList.toggle('active', thumb.getAttribute('data-page') === String(pageNum));
    });
    this.viewerEl.scrollTop = 0;

    this.options.onPageChange?.(pageNum, this.pdfDoc.numPages);
  }

  /** Invisible-but-selectable text over the rendered page. */
  private async renderTextLayer(page: any, viewport: any): Promise<void> {
    const textLayer = this.viewerEl.querySelector('.pdf-viewer-text-layer') as HTMLElement;
    textLayer.innerHTML = '';
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    if (!this.pdfjs) return;
    try {
      const textContent = await page.getTextContent();
      for (const raw of textContent.items as any[]) {
        if (!raw.str || !raw.str.trim()) continue;
        const tx = this.pdfjs.Util.transform(viewport.transform, raw.transform);
        const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
        if (fontHeight < 1 || !isFinite(tx[4]) || !isFinite(tx[5])) continue;
        const span = document.createElement('span');
        span.textContent = raw.str;
        span.style.left = `${tx[4]}px`;
        // tx[5] is the baseline; shift up by the font height so the span covers the glyphs.
        span.style.top = `${tx[5] - fontHeight}px`;
        span.style.fontSize = `${fontHeight}px`;
        textLayer.appendChild(span);
      }
    } catch {
      // Text layer is a bonus; a missing one must not break the page view.
    }
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'prev':
        void this.goToPage(this.currentPage - 1);
        break;
      case 'next':
        void this.goToPage(this.currentPage + 1);
        break;
      case 'zoom-in':
        this.setScale(this.scale * 1.25);
        break;
      case 'zoom-out':
        this.setScale(this.scale / 1.25);
        break;
      case 'zoom-fit':
        this.fitToWidth();
        break;
    }
  }

  private setScale(scale: number): void {
    this.scale = Math.max(0.5, Math.min(5, scale));
    (this.toolbarEl.querySelector('.pv-zoom') as HTMLElement).textContent =
      `${Math.round((this.scale / 1.5) * 100)}%`;
    void this.goToPage(this.currentPage);
  }

  private fitToWidth(): void {
    const wrapWidth = this.viewerEl.clientWidth - 40;
    if (wrapWidth > 0 && this.basePageWidth > 0) {
      this.setScale(wrapWidth / this.basePageWidth);
    }
  }

  /** Find every page containing the query and highlight its thumbnail. */
  private async runSearch(): Promise<void> {
    const query = (this.searchBox?.value ?? '').trim().toLowerCase();
    this.matchPages = [];
    this.matchIndex = 0;
    if (!query || !this.pdfDoc || !this.pdfjs) {
      this.markMatches();
      this.updateSearchStatus('');
      return;
    }
    this.updateSearchStatus('Searching…');
    const total = this.pdfDoc.numPages;
    for (let i = 1; i <= total; i++) {
      if (this.destroyed) return;
      // Skip if the user kept typing while we search.
      if ((this.searchBox?.value ?? '').trim().toLowerCase() !== query) return;
      try {
        const page = await this.pdfDoc.getPage(i);
        const tc = await page.getTextContent();
        const text = (tc.items as any[]).map((it) => it.str ?? '').join(' ').toLowerCase();
        page.cleanup();
        if (text.includes(query)) this.matchPages.push(i);
      } catch {
        // Unreadable page: skip it.
      }
    }
    if ((this.searchBox?.value ?? '').trim().toLowerCase() !== query) return;
    this.markMatches();
    if (this.matchPages.length === 0) {
      this.updateSearchStatus('No matches');
    } else {
      this.updateSearchStatus(`${this.matchPages.length} page${this.matchPages.length === 1 ? '' : 's'} — Enter for next`);
      void this.goToPage(this.matchPages[0]);
    }
  }

  private nextMatch(): void {
    if (this.matchPages.length === 0) return;
    this.matchIndex = (this.matchIndex + 1) % this.matchPages.length;
    this.updateSearchStatus(
      `Match ${this.matchIndex + 1} of ${this.matchPages.length}`
    );
    void this.goToPage(this.matchPages[this.matchIndex]);
  }

  private markMatches(): void {
    if (!this.sidebarEl) return;
    const set = new Set(this.matchPages.map(String));
    this.sidebarEl.querySelectorAll('.pv-thumb').forEach((thumb) => {
      thumb.classList.toggle('pv-match', set.has(thumb.getAttribute('data-page') ?? ''));
    });
  }

  private updateSearchStatus(text: string): void {
    if (this.searchStatus) this.searchStatus.textContent = text;
  }

  /** Release the PDF document and clear the DOM. */
  destroy(): void {
    this.destroyed = true;
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    try {
      this.pdfDoc?.destroy();
    } catch {
      // Already gone.
    }
    this.pdfDoc = null;
    this.container.innerHTML = '';
  }

  getCurrentPage(): number {
    return this.currentPage;
  }

  getTotalPages(): number {
    return this.pdfDoc?.numPages ?? 0;
  }
}
