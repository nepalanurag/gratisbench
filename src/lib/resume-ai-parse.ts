// Optional AI resume parsing via the user's own Gemini API key.
// The key is stored only in this browser's localStorage and sent only to
// Google's API. No key is shipped with the site. If AI parsing is off, fails,
// or has no key, the caller falls back to the built-in heuristic parser.
import type { ParsedResume } from './resume-import.ts';
import { localAiParseResume } from './resume-local-ai.ts';

const KEY_LS = 'truepdf_gemini_key';
const ENABLED_LS = 'truepdf_gemini_enabled';
const MODE_LS = 'truepdf_parse_mode';

/** How the resume import reads a resume: on-device AI, the user's Gemini key, or the plain heuristic reader. */
export type ParseMode = 'local' | 'gemini' | 'heuristic';

export function getParseMode(): ParseMode {
  try {
    const m = localStorage.getItem(MODE_LS);
    if (m === 'local' || m === 'gemini' || m === 'heuristic') return m;
    // Migrate the old checkbox: it meant "use my Gemini key".
    if (localStorage.getItem(ENABLED_LS) === '1' && getAiKey()) return 'gemini';
  } catch {
    /* storage unavailable */
  }
  return 'local';
}

export function setParseMode(mode: ParseMode): void {
  try {
    localStorage.setItem(MODE_LS, mode);
  } catch {
    /* storage unavailable */
  }
}

/** True when the parse found something worth showing in the review step. */
export function hasParsedContent(p: ParsedResume): boolean {
  return (
    p.fullName.length > 0 ||
    p.experience.length > 0 ||
    p.education.length > 0 ||
    p.skills.length > 0 ||
    p.projects.length > 0
  );
}

export type SmartParseProgress = (fraction: number, label: string) => void;

/**
 * Parse with the best available method: on-device AI first (unless the user
 * picked standard reading only), then the user's Gemini key when enabled,
 * else null so the caller falls back to the heuristic parser.
 */
export async function smartParseResume(
  text: string,
  onProgress?: SmartParseProgress
): Promise<ParsedResume | null> {
  if (getParseMode() !== 'heuristic') {
    try {
      const local = await localAiParseResume(text, onProgress);
      if (local && hasParsedContent(local)) return local;
    } catch {
      // On-device model failed (no network for the download, no WASM, ...):
      // fall through to the next method.
    }
  }
  if (isAiEnabled()) {
    const gemini = await aiParseResume(text);
    if (gemini && hasParsedContent(gemini)) return gemini;
  }
  return null;
}

export function getAiKey(): string {
  try {
    return localStorage.getItem(KEY_LS) ?? '';
  } catch {
    return '';
  }
}

export function setAiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_LS, key);
    else localStorage.removeItem(KEY_LS);
  } catch {
    /* storage unavailable */
  }
}

export function isAiEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_LS) === '1' && getAiKey().length > 0;
  } catch {
    return false;
  }
}

export function setAiEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_LS, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

const PROMPT = `You extract structured data from resume text. The resume may be messy: bad formatting, missing sections, inconsistent layout. Do your best.

Return ONLY a JSON object (no markdown, no explanation) with this shape. Use empty strings and empty arrays where nothing is found. Keep bullet points intact as full sentences; never split one bullet into fragments. Put awards and honors in "awards", never under education. Identify sections by meaning, not just headings.

{
  "fullName": "", "title": "", "email": "", "phone": "", "location": "",
  "website": "", "linkedin": "", "summary": "",
  "experience": [{"title": "", "company": "", "location": "", "start": "", "end": "", "bullets": [""]}],
  "education": [{"school": "", "degree": "", "field": "", "start": "", "end": "", "details": [""]}],
  "skills": [{"category": "", "items": [""]}],
  "projects": [{"name": "", "description": "", "bullets": [""], "link": ""}],
  "certifications": [{"name": "", "issuer": "", "year": ""}],
  "languages": [{"language": "", "level": ""}],
  "awards": [{"title": "", "issuer": "", "year": ""}],
  "publications": [{"title": "", "publisher": "", "year": ""}],
  "volunteer": [{"title": "", "company": "", "location": "", "start": "", "end": "", "bullets": [""]}],
  "courses": [{"name": "", "provider": "", "year": ""}]
}

Resume text:
`;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strArr(v: unknown): string[] {
  return asArray(v).map(str).filter((s) => s.length > 0);
}

/** Normalize loose AI JSON into the ParsedResume shape. Lenient by design. */
function normalize(data: unknown): ParsedResume | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const work = (v: unknown) =>
    asArray(v).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return {
        title: str(o.title), company: str(o.company), location: str(o.location),
        start: str(o.start), end: str(o.end), current: false, bullets: strArr(o.bullets),
      };
    });
  return {
    fullName: str(d.fullName),
    title: str(d.title),
    email: str(d.email),
    phone: str(d.phone),
    location: str(d.location),
    website: str(d.website),
    linkedin: str(d.linkedin),
    summary: str(d.summary),
    experience: work(d.experience),
    education: asArray(d.education).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return {
        school: str(o.school), degree: str(o.degree), field: str(o.field), location: str(o.location),
        start: str(o.start), end: str(o.end), detail: strArr(o.details).join('\n'),
      };
    }),
    skills: asArray(d.skills).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      // Accept both {category, items[]} and plain string lists.
      if (typeof e === 'string') return { label: '', items: [e] };
      const items = strArr(o.items ?? o.skills);
      return { label: str(o.category ?? o.label), items };
    }),
    projects: asArray(d.projects).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name), link: str(o.link), detail: str(o.description),
        bullets: strArr(o.bullets),
      };
    }),
    certifications: asArray(d.certifications).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return { name: str(o.name), issuer: str(o.issuer), year: str(o.year) };
    }),
    languages: asArray(d.languages).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      if (typeof e === 'string') return { language: e, level: '' };
      return { language: str(o.language), level: str(o.level) };
    }),
    awards: asArray(d.awards).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      if (typeof e === 'string') return { title: e, issuer: '', year: '', description: '' };
      return { title: str(o.title), issuer: str(o.issuer), year: str(o.year), description: str(o.description) };
    }),
    publications: asArray(d.publications).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return { title: str(o.title), publisher: str(o.publisher), year: str(o.year), link: str(o.link) };
    }),
    volunteer: work(d.volunteer),
    courses: asArray(d.courses).map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return { name: str(o.name), provider: str(o.provider), year: str(o.year) };
    }),
  };
}

/**
 * Parse resume text with Gemini. Returns null when AI is disabled, has no key,
 * or fails for any reason — the caller then uses the heuristic parser.
 */
export async function aiParseResume(text: string): Promise<ParsedResume | null> {
  const key = getAiKey();
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    // Cap input to keep the request small; resumes rarely need more.
    const input = text.length > 20000 ? text.slice(0, 20000) : text;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT + input }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
        signal: ctrl.signal,
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    let out = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    out = out.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = out.indexOf('{');
    const end = out.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed: unknown = JSON.parse(out.slice(start, end + 1));
    return normalize(parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
