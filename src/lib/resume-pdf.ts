// Direct PDF generation for the resume builder.
// Matches the classic ATS-friendly tech resume style: single column,
// standard headings, clickable links, no graphics.
import { PDFDocument, PDFFont, PDFPage, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import type { ResumeData } from './resume-core.ts';
import { defaultSectionVisibility, asSectionOrder, type SectionKey } from './resume-core.ts';

const MARGIN = 54; // ~0.75 inch
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

const BLACK = rgb(0, 0, 0);
const DARK = rgb(0.2, 0.2, 0.2);
const LINK_BLUE = rgb(0.05, 0.3, 0.65);

interface Ctx {
  doc: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  page: PDFPage;
  y: number;
}

function normUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^mailto:/i.test(t)) return t;
  return 'https://' + t;
}

/** Add a clickable link annotation. */
function addLink(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, url: string): void {
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
  const node = ctx.page.node;
  const existing = node.lookupMaybe('Annots');
  if (existing) {
    (existing as any).push(ref);
  } else {
    node.set(PDFName.of('Annots'), ctx.doc.context.obj([ref]));
  }
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensure(ctx: Ctx, need: number): void {
  if (ctx.y - need < MARGIN) newPage(ctx);
}

/** Draw wrapped text, return height used. Supports inline links via segments. */
function para(
  ctx: Ctx,
  segments: { t: string; bold?: boolean; link?: string; color?: ReturnType<typeof rgb> }[],
  size = 10,
  opts: { x?: number; align?: 'left' | 'center'; spacing?: number } = {}
): void {
  const x0 = opts.x ?? MARGIN;
  const align = opts.align ?? 'left';
  const lineH = size * 1.4;

  // Flatten to words with attributes
  type W = { w: string; bold: boolean; link?: string; color: ReturnType<typeof rgb> };
  const words: W[] = [];
  for (const s of segments) {
    for (const w of s.t.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w)) {
        words.push({ w: ' ', bold: false, color: BLACK });
      } else {
        words.push({ w, bold: !!s.bold, link: s.link, color: s.color ?? BLACK });
      }
    }
  }

  // Greedy line breaking
  const lines: W[][] = [];
  let cur: W[] = [];
  let curW = 0;
  const spaceW = ctx.font.widthOfTextAtSize(' ', size);
  for (const wd of words) {
    const f = wd.bold ? ctx.fontBold : ctx.font;
    const ww = wd.w === ' ' ? spaceW : f.widthOfTextAtSize(wd.w, size);
    if (curW + ww > CONTENT_W && cur.length > 0 && wd.w !== ' ') {
      lines.push(cur);
      cur = [];
      curW = 0;
    }
    cur.push(wd);
    curW += ww;
  }
  if (cur.length > 0) lines.push(cur);

  for (const line of lines) {
    ensure(ctx, lineH);
    // Compute total width for centering
    let total = 0;
    for (const wd of line) {
      const f = wd.bold ? ctx.fontBold : ctx.font;
      total += wd.w === ' ' ? spaceW : f.widthOfTextAtSize(wd.w, size);
    }
    let lx = x0;
    if (align === 'center') lx = MARGIN + (CONTENT_W - total) / 2;

    for (const wd of line) {
      const f = wd.bold ? ctx.fontBold : ctx.font;
      const ww = wd.w === ' ' ? spaceW : f.widthOfTextAtSize(wd.w, size);
      if (wd.w !== ' ') {
        ctx.page.drawText(wd.w, { x: lx, y: ctx.y - size, size, font: f, color: wd.color });
        if (wd.link) addLink(ctx, lx, ctx.y - size - 2, lx + ww, ctx.y + 3, wd.link);
      }
      lx += ww;
    }
    ctx.y -= lineH;
  }
  if (opts.spacing) ctx.y -= opts.spacing;
}

function heading(ctx: Ctx, text: string): void {
  ctx.y -= 8;
  ensure(ctx, 22);
  para(ctx, [{ t: text.toUpperCase(), bold: true }], 11, { spacing: 2 });
  // Thin rule
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 4 },
    end: { x: PAGE_W - MARGIN, y: ctx.y + 4 },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  ctx.y -= 6;
}

function bullet(ctx: Ctx, segments: { t: string; bold?: boolean; link?: string; color?: ReturnType<typeof rgb> }[], size = 10): void {
  ensure(ctx, 18);
  const by = ctx.y - size;
  ctx.page.drawText('\u2022', { x: MARGIN, y: by, size, font: ctx.font, color: BLACK });
  const saveY = ctx.y;
  // Temporarily shift: draw para at indented x
  const x0 = MARGIN + 14;
  // Inline para with custom x
  const lineH = size * 1.4;
  type W = { w: string; bold: boolean; link?: string; color: ReturnType<typeof rgb> };
  const words: W[] = [];
  for (const s of segments) {
    for (const w of s.t.split(/(\s+)/)) {
      if (!w) continue;
      words.push(/^\s+$/.test(w)
        ? { w: ' ', bold: false, color: BLACK }
        : { w, bold: !!s.bold, link: s.link, color: s.color ?? BLACK });
    }
  }
  const maxW = CONTENT_W - 14;
  const spaceW = ctx.font.widthOfTextAtSize(' ', size);
  const lines: W[][] = [];
  let cur: W[] = [];
  let curW = 0;
  for (const wd of words) {
    const f = wd.bold ? ctx.fontBold : ctx.font;
    const ww = wd.w === ' ' ? spaceW : f.widthOfTextAtSize(wd.w, size);
    if (curW + ww > maxW && cur.length > 0 && wd.w !== ' ') {
      lines.push(cur); cur = []; curW = 0;
    }
    cur.push(wd); curW += ww;
  }
  if (cur.length > 0) lines.push(cur);

  for (const line of lines) {
    ensure(ctx, lineH);
    // Redraw bullet on continuation lines? No, just first line has bullet already.
    let lx = x0;
    for (const wd of line) {
      const f = wd.bold ? ctx.fontBold : ctx.font;
      const ww = wd.w === ' ' ? spaceW : f.widthOfTextAtSize(wd.w, size);
      if (wd.w !== ' ') {
        ctx.page.drawText(wd.w, { x: lx, y: ctx.y - size, size, font: f, color: wd.color });
        if (wd.link) addLink(ctx, lx, ctx.y - size - 2, lx + ww, ctx.y + 3, wd.link);
      }
      lx += ww;
    }
    ctx.y -= lineH;
  }
  ctx.y -= 1;
  void saveY;
}

/** Two-part line: left text and right-aligned text on the same row. */
function splitLine(ctx: Ctx, left: string, right: string, size = 10, boldLeft = true): void {
  ensure(ctx, size * 1.5);
  const fL = boldLeft ? ctx.fontBold : ctx.font;
  ctx.page.drawText(left, { x: MARGIN, y: ctx.y - size, size, font: fL, color: BLACK });
  if (right) {
    const rw = ctx.font.widthOfTextAtSize(right, size);
    ctx.page.drawText(right, { x: PAGE_W - MARGIN - rw, y: ctx.y - size, size, font: ctx.font, color: DARK });
  }
  ctx.y -= size * 1.45;
}

export async function generateResumePdf(resume: ResumeData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, font, fontBold, page: null as any, y: 0 };
  newPage(ctx);

  const visibility = resume.sectionVisibility ?? defaultSectionVisibility();
  const order = asSectionOrder(resume.sectionOrder);
  const visible = (k: SectionKey) => visibility[k] !== false;
  const c = resume.contact;

  // Name — large, centered
  if (c.fullName.trim()) {
    para(ctx, [{ t: c.fullName.trim(), bold: true }], 20, { align: 'center', spacing: 0 });
  }

  // Contact line: email | phone | location | GitHub | LinkedIn | Portfolio
  if (visible('contact')) {
    const segs: { t: string; link?: string; color?: ReturnType<typeof rgb> }[] = [];
    const push = (t: string, link?: string) => {
      if (segs.length > 0) segs.push({ t: ' | ' });
      segs.push(link ? { t, link, color: LINK_BLUE } : { t });
    };
    if (c.email.trim()) push(c.email.trim(), `mailto:${c.email.trim()}`);
    if (c.phone.trim()) push(c.phone.trim());
    if (c.location.trim()) push(c.location.trim());
    if (c.website.trim()) {
      // Show as "Portfolio" like the reference resume
      push('Portfolio', normUrl(c.website));
    }
    if (c.linkedin.trim()) push('LinkedIn', normUrl(c.linkedin));
    if (segs.length > 0) {
      para(ctx, segs, 9.5, { align: 'center', spacing: 2 });
    }
  }
  if (c.title.trim()) {
    para(ctx, [{ t: c.title.trim() }], 11, { align: 'center', spacing: 4 });
  }

  if (resume.summary.trim()) {
    heading(ctx, 'Professional Summary');
    para(ctx, [{ t: resume.summary.trim() }], 10, { spacing: 2 });
  }

  for (const key of order) {
    if (key === 'contact' || !visible(key)) continue;

    if (key === 'experience' && resume.experience.length > 0) {
      heading(ctx, 'Work Experience');
      for (const e of resume.experience) {
        const dates = [e.start.trim(), e.current ? 'Present' : e.end.trim()].filter(Boolean).join(' \u2013 ');
        splitLine(ctx, e.company.trim() || e.title.trim(), dates, 10.5, true);
        if (e.company.trim() && e.title.trim()) {
          para(ctx, [{ t: e.title.trim(), bold: true }], 10.5, { spacing: 1 });
        }
        if (e.location.trim()) {
          para(ctx, [{ t: e.location.trim(), color: DARK }], 9.5, { spacing: 1 });
        }
        for (const b of e.bullets) {
          if (b.trim()) bullet(ctx, [{ t: b.trim() }]);
        }
        ctx.y -= 5;
      }
    }

    if (key === 'education' && resume.education.length > 0) {
      heading(ctx, 'Education');
      for (const e of resume.education) {
        const dates = [e.start.trim(), e.end.trim()].filter(Boolean).join(' \u2013 ');
        splitLine(ctx, e.school.trim(), dates, 10.5, true);
        const degLoc = [e.degree.trim(), e.location.trim()].filter(Boolean).join('  ');
        if (degLoc) para(ctx, [{ t: degLoc }], 10, { spacing: 1 });
        if (e.detail.trim()) {
          // Detail may contain multiple lines; split and bullet each
          for (const line of e.detail.split('\n')) {
            if (line.trim()) bullet(ctx, [{ t: line.trim().replace(/^[*\-\u2022]\s*/, '') }], 10);
          }
        }
        ctx.y -= 5;
      }
    }

    if (key === 'projects' && resume.projects.length > 0) {
      heading(ctx, 'Projects');
      for (const p of resume.projects) {
        if (!p.name.trim()) continue;
        ensure(ctx, 20);
        // "Project Name  Live Demo" — Live Demo is a clickable link
        const segs: { t: string; bold?: boolean; link?: string; color?: ReturnType<typeof rgb> }[] = [
          { t: p.name.trim(), bold: true },
        ];
        if (p.link.trim()) {
          segs.push({ t: '  ' });
          segs.push({ t: 'Live Demo', link: normUrl(p.link), color: LINK_BLUE });
        }
        para(ctx, segs, 10.5, { spacing: 1 });
        if (p.detail.trim()) para(ctx, [{ t: p.detail.trim() }], 10, { spacing: 1 });
        for (const b of p.bullets) {
          if (b.trim()) bullet(ctx, [{ t: b.trim() }]);
        }
        ctx.y -= 5;
      }
    }

    if (key === 'skills' && resume.skills.length > 0) {
      heading(ctx, 'Skills');
      for (const s of resume.skills) {
        const label = s.label.trim();
        const items = s.items.trim();
        if (!label && !items) continue;
        if (label) {
          bullet(ctx, [{ t: `${label}: `, bold: true }, { t: items }], 10);
        } else {
          bullet(ctx, [{ t: items }], 10);
        }
      }
      ctx.y -= 2;
    }

    if (key === 'certifications' && resume.certifications.length > 0) {
      heading(ctx, 'Certifications');
      for (const ce of resume.certifications) {
        const parts = [ce.name.trim(), ce.issuer.trim(), ce.year.trim()].filter(Boolean);
        if (parts.length > 0) bullet(ctx, [{ t: parts.join(' — ') }], 10);
      }
      ctx.y -= 2;
    }

    if (key === 'languages' && resume.languages.length > 0) {
      heading(ctx, 'Languages');
      const langs = resume.languages
        .map((l: any) => [l.name?.trim(), l.level?.trim()].filter(Boolean).join(' — '))
        .filter(Boolean);
      if (langs.length > 0) {
        bullet(ctx, [{ t: langs.join('; ') }], 10);
      }
      ctx.y -= 2;
    }

    if (key === 'volunteer' && resume.volunteer.length > 0) {
      heading(ctx, 'Volunteer Experience');
      for (const e of resume.volunteer) {
        const dates = [e.start.trim(), e.current ? 'Present' : e.end.trim()].filter(Boolean).join(' \u2013 ');
        splitLine(ctx, e.company.trim() || e.title.trim(), dates, 10.5, true);
        if (e.company.trim() && e.title.trim()) {
          para(ctx, [{ t: e.title.trim(), bold: true }], 10.5, { spacing: 1 });
        }
        for (const b of e.bullets) {
          if (b.trim()) bullet(ctx, [{ t: b.trim() }]);
        }
        ctx.y -= 5;
      }
    }

    if (key === 'awards' && (resume as any).awards?.length > 0) {
      heading(ctx, 'Awards');
      for (const a of (resume as any).awards) {
        const parts = [a.name?.trim(), a.issuer?.trim(), a.year?.trim()].filter(Boolean);
        if (parts.length > 0) bullet(ctx, [{ t: parts.join(' — ') }], 10);
      }
      ctx.y -= 2;
    }

    if (key === 'publications' && (resume as any).publications?.length > 0) {
      heading(ctx, 'Publications');
      for (const p of (resume as any).publications) {
        const parts = [p.title?.trim(), p.publisher?.trim(), p.year?.trim()].filter(Boolean);
        if (parts.length > 0) bullet(ctx, [{ t: parts.join(' — ') }], 10);
      }
      ctx.y -= 2;
    }

    if (key === 'courses' && (resume as any).courses?.length > 0) {
      heading(ctx, 'Courses');
      for (const co of (resume as any).courses) {
        const parts = [co.name?.trim(), co.provider?.trim(), co.year?.trim()].filter(Boolean);
        if (parts.length > 0) bullet(ctx, [{ t: parts.join(' — ') }], 10);
      }
      ctx.y -= 2;
    }
  }

  const name = c.fullName.trim() || 'Resume';
  doc.setTitle(`${name} - Resume`);
  doc.setAuthor(name);
  doc.setProducer('TruePDF Resume Builder');

  return await doc.save();
}

export function resumePdfFileName(fullName: string): string {
  const clean = fullName.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'resume';
  return `${clean}-resume.pdf`;
}
