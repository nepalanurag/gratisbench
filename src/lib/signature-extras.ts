// Extra email-signature layouts. The core renderer only knows three layouts;
// these render the same signature data with the same email-safe rules (inline
// styles, nested tables, no classes) so they paste into Gmail/Outlook cleanly.
// renderSignatureExtended() delegates to the core renderer for core layouts.

import {
  accentHex,
  renderSignature,
  type SignatureData,
} from './signature-core.ts';

export const SIGNATURE_EXTRA_LAYOUT_KEY = 'truepdf.signature-generator.layout.v1';

export interface ExtraLayoutDef {
  id: string;
  name: string;
  tagline: string;
}

export const EXTRA_LAYOUTS: ExtraLayoutDef[] = [
  {
    id: 'banner',
    name: 'Banner',
    tagline: 'Centered, photo on top. Friendly and modern.',
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    tagline: 'Big photo beside big type. Made for founders.',
  },
  {
    id: 'compact',
    name: 'Compact',
    tagline: 'Everything on a few short lines. Fits under any reply.',
  },
];

export function isExtraLayoutId(v: unknown): v is string {
  return typeof v === 'string' && EXTRA_LAYOUTS.some((l) => l.id === v);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const FONT = "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif";

function photoImg(d: SignatureData, size: number): string {
  if (!d.photoDataUrl) return '';
  const src = esc(d.photoDataUrl);
  return `<img src="${src}" width="${size}" height="${size}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block;" />`;
}

function nameLine(d: SignatureData, px: number): string {
  const name = d.name.trim();
  return `<div style="font-size:${px}px;font-weight:bold;color:#23201a;line-height:1.25;">${
    name ? esc(name) : '<span style="color:#a89e8d;">Your Name</span>'
  }</div>`;
}

function titleLine(d: SignatureData): string {
  const tc = [d.title.trim(), d.company.trim()].filter(Boolean).join(' · ');
  return tc ? `<div style="font-size:13px;color:#6f665a;line-height:1.4;">${esc(tc)}</div>` : '';
}

function contactBits(d: SignatureData, accent: string): string[] {
  const bits: string[] = [];
  if (d.phone.trim()) bits.push(`<span style="color:${accent};">✆</span> ${esc(d.phone.trim())}`);
  if (d.email.trim()) bits.push(`<span style="color:${accent};">✉</span> ${esc(d.email.trim())}`);
  if (d.website.trim()) bits.push(`<span style="color:${accent};">⌂</span> ${esc(d.website.trim())}`);
  if (d.address.trim()) bits.push(`<span style="color:#8a8172;">${esc(d.address.trim())}</span>`);
  return bits;
}

function socialBits(d: SignatureData, accent: string): string[] {
  return d.socials
    .filter((s) => s.url.trim())
    .map((s) => {
      const label = esc(s.label.trim() || s.url.trim());
      const url = s.url.trim();
      const href = /^https?:\/\//i.test(url) ? esc(url) : '';
      return href
        ? `<a href="${href}" style="color:${accent};text-decoration:none;font-weight:bold;">${label}</a>`
        : label;
    });
}

/** Centered layout: photo on top, everything centered, accent divider. */
function renderBanner(d: SignatureData, accent: string): string {
  const photo = photoImg(d, 76);
  const contacts = contactBits(d, accent);
  const socials = socialBits(d, accent);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};font-size:14px;color:#23201a;" align="center">
  <tr><td align="center" style="text-align:center;">
    ${photo ? `<div style="padding-bottom:10px;">${photo}</div>` : ''}
    ${nameLine(d, 20)}
    ${titleLine(d)}
    <div style="border-top:2px solid ${accent};width:56px;margin:10px auto 0 auto;font-size:0;line-height:0;">&nbsp;</div>
    ${
      contacts.length
        ? `<div style="font-size:12.5px;color:#4a4438;line-height:1.8;padding-top:8px;">${contacts.join('<br>')}</div>`
        : ''
    }
    ${
      socials.length
        ? `<div style="font-size:12.5px;line-height:1.6;padding-top:6px;">${socials.join(
            '<span style="color:#a89e8d;"> · </span>'
          )}</div>`
        : ''
    }
  </td></tr>
</table>`;
}

/** Large photo left, oversized name, contacts under — founder energy. */
function renderSpotlight(d: SignatureData, accent: string): string {
  const photo = photoImg(d, 104);
  const contacts = contactBits(d, accent);
  const socials = socialBits(d, accent);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};font-size:14px;color:#23201a;">
  <tr>
    ${photo ? `<td valign="middle" style="padding-right:18px;">${photo}</td>` : ''}
    <td valign="middle" style="border-left:3px solid ${accent};padding-left:16px;">
      ${nameLine(d, 24)}
      ${titleLine(d)}
      ${
        contacts.length
          ? `<div style="font-size:12.5px;color:#4a4438;line-height:1.7;padding-top:8px;">${contacts.join('<br>')}</div>`
          : ''
      }
      ${
        socials.length
          ? `<div style="font-size:12.5px;line-height:1.6;padding-top:6px;">${socials.join(
              '<span style="color:#a89e8d;"> · </span>'
            )}</div>`
          : ''
      }
    </td>
  </tr>
</table>`;
}

/** A few short lines, no photo: name, then contacts joined with middots. */
function renderCompact(d: SignatureData, accent: string): string {
  const tc = [d.title.trim(), d.company.trim()].filter(Boolean).join(', ');
  const parts: string[] = [];
  if (d.phone.trim()) parts.push(esc(d.phone.trim()));
  if (d.email.trim()) parts.push(esc(d.email.trim()));
  if (d.website.trim()) parts.push(esc(d.website.trim()));
  const socials = socialBits(d, accent);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${FONT};font-size:14px;color:#23201a;">
  <tr><td>
    <div style="font-size:15px;font-weight:bold;color:#23201a;line-height:1.3;">${
      d.name.trim() ? esc(d.name.trim()) : '<span style="color:#a89e8d;">Your Name</span>'
    }${tc ? `<span style="font-weight:normal;color:${accent};"> — ${esc(tc)}</span>` : ''}</div>
    ${
      parts.length
        ? `<div style="font-size:12px;color:#6f665a;line-height:1.6;">${parts.join(
            '<span style="color:#a89e8d;"> · </span>'
          )}</div>`
        : ''
    }
    ${
      socials.length
        ? `<div style="font-size:12px;line-height:1.6;">${socials.join('<span style="color:#a89e8d;"> · </span>')}</div>`
        : ''
    }
  </td></tr>
</table>`;
}

/** Render any layout: extra layouts are handled here, core ones delegate. */
export function renderSignatureExtended(d: SignatureData): string {
  if (!isExtraLayoutId(d.layout)) return renderSignature(d);
  const accent = accentHex(d.accent);
  const layout = d.layout as string;
  if (layout === 'banner') return renderBanner(d, accent);
  if (layout === 'spotlight') return renderSpotlight(d, accent);
  return renderCompact(d, accent);
}

/** Social platforms for the picker: label plus the URL prefix to start from. */
export const SOCIAL_PLATFORMS: { id: string; label: string; prefix: string }[] = [
  { id: 'custom', label: 'Custom link…', prefix: '' },
  { id: 'linkedin', label: 'LinkedIn', prefix: 'https://linkedin.com/in/' },
  { id: 'x', label: 'X (Twitter)', prefix: 'https://x.com/' },
  { id: 'github', label: 'GitHub', prefix: 'https://github.com/' },
  { id: 'instagram', label: 'Instagram', prefix: 'https://instagram.com/' },
  { id: 'facebook', label: 'Facebook', prefix: 'https://facebook.com/' },
  { id: 'youtube', label: 'YouTube', prefix: 'https://youtube.com/@' },
  { id: 'calendly', label: 'Calendly', prefix: 'https://calendly.com/' },
  { id: 'website', label: 'Website', prefix: 'https://' },
];
