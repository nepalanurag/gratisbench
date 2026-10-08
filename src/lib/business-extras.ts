// Extra business-profile fields: industry, opening hours, and social profiles.
// Stored under its own key so the shared core profile shape stays untouched.

export const BUSINESS_EXTRAS_KEY = 'truepdf.business-profile.extras.v1';

export interface BusinessSocial {
  id: string;
  label: string;
  url: string;
}

export interface BusinessExtras {
  /** Industry / category, e.g. "Design studio". */
  category: string;
  /** Opening hours as free text, e.g. "Mon–Fri, 9am–6pm". */
  hours: string;
  socials: BusinessSocial[];
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `bx-${Date.now().toString(36)}-${counter}`;
}

export function blankBusinessExtras(): BusinessExtras {
  return { category: '', hours: '', socials: [] };
}

export function blankBusinessSocial(): BusinessSocial {
  return { id: newId(), label: '', url: '' };
}

function cleanSocial(s: BusinessSocial): BusinessSocial {
  return {
    id: typeof s.id === 'string' && s.id ? s.id : newId(),
    label: typeof s.label === 'string' ? s.label.slice(0, 40) : '',
    url: typeof s.url === 'string' ? s.url.slice(0, 300) : '',
  };
}

export function serializeBusinessExtras(e: BusinessExtras): string {
  return JSON.stringify({
    category: e.category.slice(0, 80),
    hours: e.hours.slice(0, 500),
    socials: e.socials.slice(0, 12).map(cleanSocial),
  });
}

export function deserializeBusinessExtras(raw: string | null | undefined): BusinessExtras {
  const blank = blankBusinessExtras();
  if (!raw) return blank;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p || typeof p !== 'object') return blank;
    const socials = Array.isArray(p.socials)
      ? (p.socials as unknown[])
          .filter((s): s is BusinessSocial => !!s && typeof s === 'object')
          .map((s) => cleanSocial(s as BusinessSocial))
          .filter((s) => s.label.trim() || s.url.trim())
          .slice(0, 12)
      : [];
    return {
      category: typeof p.category === 'string' ? p.category.slice(0, 80) : '',
      hours: typeof p.hours === 'string' ? p.hours.slice(0, 500) : '',
      socials,
    };
  } catch {
    return blank;
  }
}

export function loadBusinessExtras(): BusinessExtras {
  try {
    return deserializeBusinessExtras(localStorage.getItem(BUSINESS_EXTRAS_KEY));
  } catch {
    return blankBusinessExtras();
  }
}

export function saveBusinessExtras(e: BusinessExtras): void {
  try {
    localStorage.setItem(BUSINESS_EXTRAS_KEY, serializeBusinessExtras(e));
  } catch {
    // Storage unavailable: the tool still works for this session.
  }
}
