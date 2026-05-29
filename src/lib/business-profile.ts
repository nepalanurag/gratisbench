// Pure business-profile logic shared by the browser tool and the Node verification script.
// No DOM access here — everything is data in, data out.
// localStorage is guarded: under Node (no localStorage) an in-memory store is
// used instead, so this module imports cleanly in tests.

export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_STORAGE_KEY = 'freekit.business-profile.v1';

/** The details a business reuses across tools: name, logo, contact, brand color. */
export interface BusinessProfile {
  name: string;
  tagline: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  color: string; // hex like #a63d21, or empty
  logoDataUrl: string; // data:image/... or empty
}

/** An empty profile: every field unset. */
export function blankBusinessProfile(): BusinessProfile {
  return {
    name: '',
    tagline: '',
    address: '',
    email: '',
    phone: '',
    website: '',
    color: '',
    logoDataUrl: '',
  };
}

/** True when nothing has been filled in yet. */
export function profileIsEmpty(p: BusinessProfile): boolean {
  return [p.name, p.tagline, p.address, p.email, p.phone, p.website, p.color, p.logoDataUrl].every(
    (v) => v.trim() === ''
  );
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function validDataUrl(v: unknown): string {
  return typeof v === 'string' && v.startsWith('data:image/') ? v : '';
}

function validHexColor(v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : '';
}

/**
 * Coerce an unknown value into a clean BusinessProfile. Unknown fields are
 * dropped, wrong types become empty strings. Never throws.
 */
export function sanitizeBusinessProfile(v: unknown): BusinessProfile {
  const blank = blankBusinessProfile();
  if (!v || typeof v !== 'object') return blank;
  const o = v as Record<string, unknown>;
  return {
    name: asString(o.name),
    tagline: asString(o.tagline),
    address: asString(o.address),
    email: asString(o.email),
    phone: asString(o.phone),
    website: asString(o.website),
    color: validHexColor(o.color),
    logoDataUrl: validDataUrl(o.logoDataUrl),
  };
}

// ---------- storage ----------

interface SimpleStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const memoryStore = new Map<string, string>();
const memoryStorage: SimpleStorage = {
  getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k)! : null),
  setItem: (k, v) => {
    memoryStore.set(k, v);
  },
  removeItem: (k) => {
    memoryStore.delete(k);
  },
};

function getStorage(): SimpleStorage {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    // storage blocked or unavailable
  }
  return memoryStorage;
}

/** Load the saved profile, or a blank one when nothing is stored. */
export function loadBusinessProfile(): BusinessProfile {
  try {
    const raw = getStorage().getItem(PROFILE_STORAGE_KEY);
    if (!raw) return blankBusinessProfile();
    return sanitizeBusinessProfile(JSON.parse(raw));
  } catch {
    return blankBusinessProfile(); // corrupt JSON or blocked storage
  }
}

/** Save the profile to this browser. */
export function saveBusinessProfile(p: BusinessProfile): void {
  try {
    getStorage().setItem(PROFILE_STORAGE_KEY, JSON.stringify({ ...sanitizeBusinessProfile(p), version: PROFILE_SCHEMA_VERSION }));
  } catch {
    // storage full or blocked: the caller still works for this session
  }
}

/** Delete the saved profile from this browser. */
export function clearBusinessProfile(): void {
  try {
    getStorage().removeItem(PROFILE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Export the current profile as pretty JSON, for backup or moving devices. */
export function exportBusinessProfile(): string {
  return JSON.stringify({ ...loadBusinessProfile(), version: PROFILE_SCHEMA_VERSION }, null, 2);
}

/**
 * Parse an exported profile file back into a BusinessProfile. Unknown fields
 * are dropped and wrong types are coerced to empty strings. Throws on input
 * that is not JSON at all, so the caller can tell a bad file apart from a
 * merely odd one (and must not overwrite a good profile with a blank one).
 */
export function parseBusinessProfileFile(json: string): BusinessProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file does not look like a business profile export.');
  }
  return sanitizeBusinessProfile(parsed);
}
