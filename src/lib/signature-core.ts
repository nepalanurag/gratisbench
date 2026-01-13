// Pure email-signature logic shared by the browser tool and the Node verification script.
// No DOM access here — everything is data in, data/HTML strings out.
//
// The generated HTML uses inline styles only and tables for layout: email clients
// (Gmail, Outlook, Apple Mail) strip <style> blocks and class attributes, so the
// robust signature is a single <table> with style attributes everywhere.

export const SIGNATURE_SCHEMA_VERSION = 1;
export const SIGNATURE_STORAGE_KEY = 'freekit.email-signature.v1';

export type SignatureLayout = 'stacked' | 'two-column' | 'minimal';

export interface SocialLink {
  id: string;
  label: string;
  url: string;
}

export interface SignatureData {
  version: number;
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  photoDataUrl: string; // data:image/... or empty
  layout: SignatureLayout;
  accent: string; // hex color from the preset swatches
  socials: SocialLink[];
}

export interface AccentSwatch {
  id: string;
  name: string;
  hex: string;
}

export const ACCENT_SWATCHES: AccentSwatch[] = [
  { id: 'brick', name: 'Brick', hex: '#a63d21' },
  { id: 'navy', name: 'Navy', hex: '#1f3a5f' },
  { id: 'forest', name: 'Forest', hex: '#2e7d46' },
  { id: 'plum', name: 'Plum', hex: '#6b3a5b' },
  { id: 'slate', name: 'Slate', hex: '#4a5560' },
  { id: 'gold', name: 'Gold', hex: '#9c6b1a' },
];

export const LAYOUTS: { id: SignatureLayout; name: string; tagline: string }[] = [
  { id: 'stacked', name: 'Stacked', tagline: 'Photo on top, details below. Clean and formal.' },
  { id: 'two-column', name: 'Two-column', tagline: 'Photo beside the details. The classic business-card look.' },
  { id: 'minimal', name: 'Minimal', tagline: 'One small block, no photo. Subtle and compact.' },
];

let idCounter = 0;
/** Unique-enough id for a new entry. Not a UUID; collisions across sessions don't matter here. */
export function newId(): string {
  idCounter += 1;
  return `s${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function isLayoutId(v: unknown): v is SignatureLayout {
  return v === 'stacked' || v === 'two-column' || v === 'minimal';
}

export function isAccentId(v: unknown): v is string {
  return typeof v === 'string' && ACCENT_SWATCHES.some((s) => s.id === v);
}

export function accentHex(id: string): string {
  return ACCENT_SWATCHES.find((s) => s.id === id)?.hex ?? ACCENT_SWATCHES[0].hex;
}

export function blankSocialLink(): SocialLink {
  return { id: newId(), label: '', url: '' };
}

/** A fresh, empty signature. */
export function blankSignature(): SignatureData {
  return {
    version: SIGNATURE_SCHEMA_VERSION,
    name: '',
    title: '',
    company: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    photoDataUrl: '',
    layout: 'two-column',
    accent: 'brick',
    socials: [],
  };
}

/** Sample content so people can see the layouts before typing a word. */
export function exampleSignature(): SignatureData {
  return {
    version: SIGNATURE_SCHEMA_VERSION,
    name: 'Sam Rivera',
    title: 'Senior Product Designer',
    company: 'Northwind Mobile',
    phone: '(415) 555-0132',
    email: 'sam.rivera@example.com',
    website: 'samrivera.design',
    address: 'San Francisco, CA',
    photoDataUrl: '',
    layout: 'two-column',
    accent: 'brick',
    socials: [
      { id: newId(), label: 'LinkedIn', url: 'https://linkedin.com/in/samrivera' },
      { id: newId(), label: 'Portfolio', url: 'https://samrivera.design' },
    ],
  };
}

// ---------- escaping / URL safety ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Keep only http(s) links; anything else becomes an empty href. */
function safeHttpUrl(url: string): string {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(u)) return `https://${u}`;
  return '';
}

function safeMailto(email: string): string {
  const e = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? `mailto:${e}` : '';
}

function safeTel(phone: string): string {
  const p = phone.trim();
  return p.length > 0 ? `tel:${p.replace(/[^\d+]/g, '')}` : '';
}

function validPhotoDataUrl(v: unknown): string {
  return typeof v === 'string' && v.startsWith('data:image/') ? v : '';
}

// ---------- validation ----------

/**
 * Check the fields a signature needs. Returns human-readable messages;
 * an empty array means the signature is ready to copy.
 */
export function validateSignature(d: SignatureData): string[] {
  const problems: string[] = [];
  if (!d.name.trim()) {
    problems.push('Add your name so the signature says who you are.');
  }
  if (d.email.trim() && !safeMailto(d.email)) {
    problems.push('That email address does not look valid.');
  }
  for (const s of d.socials) {
    if (s.url.trim() && !safeHttpUrl(s.url)) {
      problems.push(`The link for "${s.label.trim() || 'a social profile'}" does not look like a web address.`);
    }
  }
  return problems;
}

// ---------- HTML builder (inline styles only, tables, no classes) ----------

const FONT = "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif";

interface BuiltBits {
  nameLine: string;
  titleLine: string;
  contactLines: string;
  socialLine: string;
}

function buildBits(d: SignatureData, accent: string): BuiltBits {
  const name = d.name.trim();
  const titleCompany = [d.title.trim(), d.company.trim()].filter(Boolean).join(' · ');

  const contacts: string[] = [];
  if (d.phone.trim()) {
    const href = safeTel(d.phone);
    const label = `<span style="color:${accent};">✆</span> ${esc(d.phone.trim())}`;
    contacts.push(href ? `<a href="${esc(href)}" style="color:#4a4438;text-decoration:none;">${label}</a>` : label);
  }
  if (d.email.trim()) {
    const href = safeMailto(d.email);
    const label = `<span style="color:${accent};">✉</span> ${esc(d.email.trim())}`;
    contacts.push(href ? `<a href="${esc(href)}" style="color:#4a4438;text-decoration:none;">${label}</a>` : label);
  }
  if (d.website.trim()) {
    const href = safeHttpUrl(d.website);
    const label = `<span style="color:${accent};">⌂</span> ${esc(d.website.trim())}`;
    contacts.push(href ? `<a href="${esc(href)}" style="color:#4a4438;text-decoration:none;">${label}</a>` : label);
  }
  if (d.address.trim()) {
    contacts.push(`<span style="color:#8a8172;">${esc(d.address.trim())}</span>`);
  }

  const socials = d.socials.filter((s) => s.url.trim());
  const socialLine = socials.length
    ? socials
        .map((s) => {
          const href = safeHttpUrl(s.url);
          const label = esc(s.label.trim() || s.url.trim());
          return href
            ? `<a href="${esc(href)}" style="color:${accent};text-decoration:none;font-weight:bold;">${label}</a>`
            : label;
        })
        .join('<span style="color:#a89e8d;"> · </span>')
    : '';

  return {
    nameLine: `<div style="font-size:17px;font-weight:bold;color:#23201a;line-height:1.3;">${
      name ? esc(name) : '<span style="color:#a89e8d;">Your Name</span>'
    }</div>`,
    titleLine: titleCompany
      ? `<div style="font-size:13px;color:#6f665a;line-height:1.4;">${esc(titleCompany)}</div>`
      : '',
    contactLines: contacts.length
      ? `<div style="font-size:12.5px;color:#4a4438;line-height:1.75;">${contacts.join('<br>')}</div>`
      : '',
    socialLine: socialLine
      ? `<div style="font-size:12.5px;line-height:1.6;padding-top:4px;">${socialLine}</div>`
      : '',
  };
}

function photoHtml(d: SignatureData, size: number, round: boolean): string {
  if (!d.photoDataUrl) return '';
  const radius = round ? '50%' : '6px';
  return `<img src="${esc(d.photoDataUrl)}" width="${size}" height="${size}" alt="" style="width:${size}px;height:${size}px;border-radius:${radius};object-fit:cover;display:block;" />`;
}

function dividerRow(accent: string): string {
  return `<tr><td style="padding:8px 0 0 0;"><div style="border-top:2px solid ${accent};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
}

/**
 * Render the signature as an HTML string. All styles are inline, layout uses
 * nested tables, and every piece of user content is escaped. Contains no
 * class attributes and no <style> block, so it survives email clients.
 */
export function renderSignature(d: SignatureData): string {
  const accent = accentHex(d.accent);
  const b = buildBits(d, accent);
  const body = `${b.nameLine}${b.titleLine}${
    b.contactLines || b.socialLine ? `<div style="padding-top:6px;">${b.contactLines}${b.socialLine}</div>` : ''
  }`;

  if (d.layout === 'two-column') {
    const photo = photoHtml(d, 84, true);
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};font-size:14px;color:#23201a;">
  <tr>
    ${photo ? `<td valign="top" style="padding-right:14px;">${photo}</td>` : ''}
    <td valign="top" style="border-left:2px solid ${accent};padding-left:14px;">${body}</td>
  </tr>
</table>`;
  }

  if (d.layout === 'minimal') {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};font-size:14px;color:#23201a;">
  <tr>
    <td style="border-left:2px solid ${accent};padding-left:12px;">${body}</td>
  </tr>
</table>`;
  }

  // stacked
  const photo = photoHtml(d, 72, false);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};font-size:14px;color:#23201a;">
  ${photo ? `<tr><td style="padding-bottom:8px;">${photo}</td></tr>` : ''}
  <tr><td>${b.nameLine}${b.titleLine}</td></tr>
  ${b.contactLines || b.socialLine ? dividerRow(accent) : ''}
  ${b.contactLines ? `<tr><td style="padding-top:6px;">${b.contactLines}</td></tr>` : ''}
  ${b.socialLine ? `<tr><td style="padding-top:2px;">${b.socialLine}</td></tr>` : ''}
</table>`;
}

// ---------- serialization with schema versioning ----------

export function serializeSignature(d: SignatureData): string {
  return JSON.stringify({ ...d, version: SIGNATURE_SCHEMA_VERSION });
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function validId(v: unknown): string {
  return typeof v === 'string' && v.length > 0 ? v : newId();
}

/**
 * Parse saved JSON back into a SignatureData. Anything corrupt, foreign, or from
 * a different schema version falls back to a blank signature instead of throwing.
 */
export function deserializeSignature(raw: string | null | undefined): SignatureData {
  const blank = blankSignature();
  if (!raw) return blank;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blank; // corrupt JSON
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== SIGNATURE_SCHEMA_VERSION) {
    return blank; // wrong shape or schema version
  }
  const p = parsed as Record<string, unknown>;
  const socialsRaw = p.socials;
  const socials: SocialLink[] = Array.isArray(socialsRaw)
    ? (socialsRaw as unknown[])
        .filter((e) => e && typeof e === 'object')
        .map((e) => {
          const o = e as Record<string, unknown>;
          return { id: validId(o.id), label: asString(o.label), url: asString(o.url) };
        })
        .filter((s) => s.label.trim() || s.url.trim())
    : [];
  return {
    version: SIGNATURE_SCHEMA_VERSION,
    name: asString(p.name),
    title: asString(p.title),
    company: asString(p.company),
    phone: asString(p.phone),
    email: asString(p.email),
    website: asString(p.website),
    address: asString(p.address),
    photoDataUrl: validPhotoDataUrl(p.photoDataUrl),
    layout: isLayoutId(p.layout) ? p.layout : 'two-column',
    accent: isAccentId(p.accent) ? asString(p.accent) : 'brick',
    socials,
  };
}
