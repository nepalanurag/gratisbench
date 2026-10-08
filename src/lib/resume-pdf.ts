// Direct PDF generation for the resume builder.
// Generates a clean, professional, ATS-friendly PDF with clickable links
// (email, website, LinkedIn, project demo links) — no print dialog needed.
import { PDFDocument, PDFFont, PDFPage, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import type { ResumeData } from './resume-core.ts';
import { defaultSectionVisibility, asSectionOrder, type SectionKey } from './resume-core.ts';

const MARGIN = 50;
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

const BLACK = rgb(0.15, 0.15, 0.15);
const GRAY = rgb(0.45, 0.45, 0.45);
const ACCENT = rgb(0.7, 0.14, 0.17); // PDF red
const LINK_BLUE = rgb(0.1, 0.35, 0.7);

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  fontItalic: PDFFont;
  page: PDFPage;
  y: number;
}

/** Normalize a URL: add https:// if missing. */
function normUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return 'https://' + t;
}

/** Add a clickable link annotation to the current page. */
function addLinkAnnot(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, url: string): void {
  const annot = ctx.doc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [x1, y1, x2, y2],
    Border: [0, 0, 0],
    A: {
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of(url),
    },
  });
  const ref = ctx.doc.context.register(annot);
  const pageDict = ctx.page.node;
  const existing = pageDict.lookupMaybe('Annots');
  if (existing) {
    (existing as any).push(ref);
  } else {
    pageDict.set(PDFName.of('Annots'), ctx.doc.context.obj([ref]));
  }
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN) {
    newPage(ctx);
  }
}

function drawText(
  ctx: Ctx,
  text: string,
  opts: {
    size?: number;
    bold?: boolean;
    italic?: boolean;
    color?: ReturnType<typeof rgb>;
    x?: number;
    align?: 'left' | 'center';
    link?: string;
    maxWidth?: number;
  } = {}
): number {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.fontBold : opts.italic ? ctx.fontItalic : ctx.font;
  const color = opts.color ?? BLACK;
  const x = opts.x ?? MARGIN;
  const maxWidth = opts.maxWidth ?? CONTENT_W;

  // Simple word wrap
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  const lineH = size * 1.35;
  for (const line of lines) {
    ensureSpace(ctx, lineH);
    let lx = x;
    if (opts.align === 'center') {
      const w = font.widthOfTextAtSize(line, size);
      lx = MARGIN + (CONTENT_W - w) / 2;
    }
    ctx.page.drawText(line, { x: lx, y: ctx.y - size, size, font, color });

    // Add clickable link annotation
    if (opts.link) {
      const w = font.widthOfTextAtSize(line, size);
      addLinkAnnot(ctx, lx, ctx.y - size - 2, lx + w, ctx.y + 2, opts.link);
    }
    ctx.y -= lineH;
  }
  return lines.length * lineH;
}

function sectionTitle(ctx: Ctx, title: string): void {
  ctx.y -= 6;
  ensureSpace(ctx, 24);
  drawText(ctx, title.toUpperCase(), { size: 11, bold: true, color: ACCENT });
  // Rule line
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 2 },
    end: { x: PAGE_W - MARGIN, y: ctx.y + 2 },
    thickness: 0.75,
    color: rgb(0.8, 0.8, 0.8),
  });
  ctx.y -= 8;
}

function bullet(ctx: Ctx, text: string): void {
  ensureSpace(ctx, 16);
  const size = 10;
  const bulletX = MARGIN + 8;
  ctx.page.drawText('•', { x: MARGIN, y: ctx.y - size, size, font: ctx.font, color: BLACK });
  drawText(ctx, text, { size, x: bulletX, maxWidth: CONTENT_W - 12 });
  ctx.y -= 2;
}

/** Generate a PDF from resume data. Returns the PDF bytes. */
export async function generateResumePdf(resume: ResumeData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const ctx: Ctx = { doc, font, fontBold, fontItalic, page: null as any, y: 0 };
  newPage(ctx);

  const visibility = resume.sectionVisibility ?? defaultSectionVisibility();
  const order = asSectionOrder(resume.sectionOrder);
  const visible = (k: SectionKey) => visibility[k] !== false;

  const c = resume.contact;

  // Header: name
  if (c.fullName.trim()) {
    drawText(ctx, c.fullName.trim(), { size: 22, bold: true, align: 'center' });
    ctx.y -= 2;
  }
  if (c.title.trim()) {
    drawText(ctx, c.title.trim(), { size: 12, color: GRAY, align: 'center' });
    ctx.y -= 2;
  }

  // Contact line with clickable links
  if (visible('contact')) {
    const parts: { text: string; link?: string }[] = [];
    if (c.email.trim()) parts.push({ text: c.email.trim(), link: `mailto:${c.email.trim()}` });
    if (c.phone.trim()) parts.push({ text: c.phone.trim() });
    if (c.location.trim()) parts.push({ text: c.location.trim() });
    if (c.website.trim()) parts.push({ text: c.website.trim(), link: normUrl(c.website) });
    if (c.linkedin.trim()) parts.push({ text: 'LinkedIn', link: normUrl(c.linkedin) });

    if (parts.length > 0) {
      // Draw as a single centered line with separators, links clickable
      const sep = '  |  ';
      let line = '';
      const linkRanges: { start: number; end: number; link: string }[] = [];
      for (const p of parts) {
        const s = line.length;
        line += (line ? sep : '') + p.text;
        if (p.link) linkRanges.push({ start: s + (line ? sep.length : 0), end: line.length, link: p.link });
      }
      // Simple approach: draw whole line centered, then overlay link annots
      const size = 9;
      const w = font.widthOfTextAtSize(line, size);
      const lx = MARGIN + (CONTENT_W - w) / 2;
      ensureSpace(ctx, 16);
      ctx.page.drawText(line, { x: lx, y: ctx.y - size, size, font, color: GRAY });
      for (const r of linkRanges) {
        const before = line.slice(0, r.start);
        const linkText = line.slice(r.start, r.end);
        const bx = lx + font.widthOfTextAtSize(before, size);
        const bw = font.widthOfTextAtSize(linkText, size);
        addLinkAnnot(ctx, bx, ctx.y - size - 2, bx + bw, ctx.y + 2, r.link);
      }
      ctx.y -= size * 1.35;
      ctx.y -= 4;
    }
  }

  // Summary
  if (resume.summary.trim() && visible('summary' as SectionKey)) {
    sectionTitle(ctx, 'Summary');
    drawText(ctx, resume.summary.trim(), { size: 10 });
    ctx.y -= 4;
  }

  // Body sections in order
  for (const key of order) {
    if (key === 'contact' || !visible(key)) continue;

    if (key === 'experience' && resume.experience.length > 0) {
      sectionTitle(ctx, 'Experience');
      for (const e of resume.experience) {
        ensureSpace(ctx, 40);
        if (e.title.trim()) drawText(ctx, e.title.trim(), { size: 11, bold: true });
        const org = [e.company.trim(), e.location.trim()].filter(Boolean).join(', ');
        const dates = [e.start.trim(), e.current ? 'Present' : e.end.trim()].filter(Boolean).join(' - ');
        const sub = [org, dates].filter(Boolean).join('  |  ');
        if (sub) drawText(ctx, sub, { size: 9, color: GRAY });
        ctx.y -= 2;
        for (const b of e.bullets) {
          if (b.trim()) bullet(ctx, b.trim());
        }
        ctx.y -= 4;
      }
    }

    if (key === 'education' && resume.education.length > 0) {
      sectionTitle(ctx, 'Education');
      for (const e of resume.education) {
        ensureSpace(ctx, 32);
        if (e.degree.trim()) drawText(ctx, e.degree.trim(), { size: 11, bold: true });
        const sub = [e.school.trim(), e.location.trim()].filter(Boolean).join(', ');
        const dates = [e.start.trim(), e.end.trim()].filter(Boolean).join(' - ');
        const line = [sub, dates].filter(Boolean).join('  |  ');
        if (line) drawText(ctx, line, { size: 9, color: GRAY });
        if (e.detail.trim()) drawText(ctx, e.detail.trim(), { size: 10, italic: true });
        ctx.y -= 4;
      }
    }

    if (key === 'skills' && resume.skills.length > 0) {
      sectionTitle(ctx, 'Skills');
      for (const s of resume.skills) {
        const label = s.label.trim();
        const items = s.items.trim();
        if (!label && !items) continue;
        ensureSpace(ctx, 16);
        if (label) {
          drawText(ctx, `${label}: ${items}`, { size: 10 });
        } else {
          drawText(ctx, items, { size: 10 });
        }
      }
      ctx.y -= 4;
    }

    if (key === 'projects' && resume.projects.length > 0) {
      sectionTitle(ctx, 'Projects');
      for (const p of resume.projects) {
        ensureSpace(ctx, 36);
        // Project name with clickable demo link
        if (p.name.trim()) {
          const link = p.link.trim() ? normUrl(p.link) : undefined;
          drawText(ctx, p.name.trim(), {
            size: 11,
            bold: true,
            color: link ? LINK_BLUE : BLACK,
            link,
          });
        }
        if (p.detail.trim()) drawText(ctx, p.detail.trim(), { size: 10, italic: true });
        for (const b of p.bullets) {
          if (b.trim()) bullet(ctx, b.trim());
        }
        // "Live demo" link if present and not already linked via name
        if (p.link.trim()) {
          drawText(ctx, 'Live demo', { size: 9, color: LINK_BLUE, link: normUrl(p.link) });
        }
        ctx.y -= 4;
      }
    }

    if (key === 'certifications' && resume.certifications.length > 0) {
      sectionTitle(ctx, 'Certifications');
      for (const ce of resume.certifications) {
        const parts = [ce.name.trim(), ce.issuer.trim(), ce.year.trim()].filter(Boolean);
        if (parts.length > 0) bullet(ctx, parts.join(' — '));
      }
      ctx.y -= 4;
    }

    if (key === 'languages' && resume.languages.length > 0) {
      sectionTitle(ctx, 'Languages');
      const langs = resume.languages
        .map((l) => [l.name?.trim(), (l as any).level?.trim()].filter(Boolean).join(' (') + ((l as any).level?.trim() ? ')' : ''))
        .filter(Boolean);
      if (langs.length > 0) drawText(ctx, langs.join('  |  '), { size: 10 });
      ctx.y -= 4;
    }

    if (key === 'awards' && (resume as any).awards?.length > 0) {
      sectionTitle(ctx, 'Awards');
      for (const a of (resume as any).awards) {
        const parts = [a.name?.trim(), a.issuer?.trim(), a.year?.trim()].filter(Boolean);
        if (parts.length > 0) bullet(ctx, parts.join(' — '));
      }
      ctx.y -= 4;
    }

    if (key === 'volunteer' && resume.volunteer.length > 0) {
      sectionTitle(ctx, 'Volunteer Experience');
      for (const e of resume.volunteer) {
        ensureSpace(ctx, 40);
        if (e.title.trim()) drawText(ctx, e.title.trim(), { size: 11, bold: true });
        const org = [e.company.trim(), e.location.trim()].filter(Boolean).join(', ');
        if (org) drawText(ctx, org, { size: 9, color: GRAY });
        for (const b of e.bullets) {
          if (b.trim()) bullet(ctx, b.trim());
        }
        ctx.y -= 4;
      }
    }
  }

  // Metadata
  const name = c.fullName.trim() || 'Resume';
  doc.setTitle(`${name} - Resume`);
  doc.setAuthor(name);
  doc.setProducer('TruePDF Resume Builder');

  return await doc.save();
}

/** Download filename for the resume PDF. */
export function resumePdfFileName(fullName: string): string {
  const clean = fullName.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'resume';
  return `${clean}-resume.pdf`;
}
