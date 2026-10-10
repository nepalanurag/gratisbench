// On-device resume parsing with a BERT named-entity model via Transformers.js.
//
// The model (an ONNX build of yashpwr/resume-ner-bert-v2, Apache 2.0) labels
// tokens as names, emails, job titles, companies, skills, and so on. The
// repository publishes a 431 MB full-precision ONNX file at its root; it is
// downloaded only after the user opts in and cached by the browser after.
// and runs fully on-device with WebAssembly, so the resume text never leaves
// the browser.
//
// NER finds entities but does not understand document structure, so the
// entities are merged with the heuristic parser's assembly: the heuristic
// gives structure (sections, entries, bullets, dates) and the NER entities
// upgrade the fields the heuristic gets wrong (names, titles, companies,
// skills).
//
// The transformers library is dynamically imported inside loadModel() so this
// module stays light until the user actually picks on-device parsing.
import type { ParsedResume, SplitResume } from './resume-import.ts';
import { parseResumeText, splitResumeSections } from './resume-import.ts';

export type LocalAiProgress = (fraction: number, label: string) => void;

/**
 * ONNX build of the resume NER model. Its full-precision artifact is published
 * as `model.onnx` at the repository root rather than under `onnx/`; specify
 * both explicitly so Transformers.js does not request a missing quantized file.
 */
const MODEL_ID = 'scottgal/resume-ner-bert-v2-onnx';

/** Keep each model input well under BERT's 512-token limit. */
const MAX_CHUNK_CHARS = 1500;
/** Drop entities below this confidence; below it the model is guessing. */
const MIN_SCORE = 0.35;
/** Above this, trust the NER label over the heuristic's guess. */
const TRUST_SCORE = 0.6;

interface NerToken {
  entity: string;
  score: number;
  index: number;
}

export interface NerEntity {
  /** e.g. 'Name', 'Email Address', 'Companies worked at', 'Designation', 'Skills' */
  type: string;
  text: string;
  score: number;
  /** index into the document line list */
  line: number;
}

interface LoadedModel {
  classify: (text: string) => Promise<NerToken[]>;
  tokenize: (text: string) => string[];
}

let modelPromise: Promise<LoadedModel> | null = null;

interface ProgressInfo {
  status: string;
  file?: string;
  name?: string;
  loaded?: number;
  total?: number;
}

async function loadModel(onProgress?: LocalAiProgress): Promise<LoadedModel> {
  if (!modelPromise) {
    modelPromise = (async (): Promise<LoadedModel> => {
      // (pipeline's own generics are too complex for tsc here, so the module
      // is imported once and used through a simplified structural type.)
      const mod = (await import('@huggingface/transformers')) as {
        AutoTokenizer: {
          from_pretrained: (id: string) => Promise<{ tokenize: (text: string) => string[] }>;
        };
        pipeline: (
          task: string,
          model: string,
          opts?: Record<string, unknown>
        ) => Promise<unknown>;
      };
      const { AutoTokenizer } = mod;
      const loadPipe = mod.pipeline;
      const seen = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (ev: ProgressInfo): void => {
        if (!onProgress) return;
        const key = ev.file ?? ev.name ?? 'model';
        if (ev.status === 'progress') {
          seen.set(key, { loaded: ev.loaded ?? 0, total: ev.total ?? 0 });
          let loaded = 0;
          let total = 0;
          for (const v of seen.values()) {
            loaded += v.loaded;
            total += v.total;
          }
          if (total > 0) onProgress(Math.min(1, loaded / total), 'Downloading the on-device reader');
        } else if (ev.status === 'done' || ev.status === 'ready') {
          seen.delete(key);
        }
      };
      const classifier = (await loadPipe('token-classification', MODEL_ID, {
        dtype: 'fp32',
        subfolder: '',
        model_file_name: 'model',
        progress_callback,
      })) as (text: string) => Promise<unknown>;
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
      return {
        classify: async (text: string): Promise<NerToken[]> => {
          const out = (await classifier(text)) as NerToken[] | NerToken[][];
          const arr = Array.isArray(out) && out.length > 0 && Array.isArray(out[0])
            ? (out[0] as NerToken[])
            : (out as NerToken[]);
          return arr.filter((t) => t && typeof t.entity === 'string' && t.entity !== 'O');
        },
        tokenize: (text: string): string[] => tokenizer.tokenize(text),
      };
    })();
  }
  return modelPromise;
}

interface Chunk {
  text: string;
  /** global line index of the chunk's first line */
  firstLine: number;
  /** char offset of each line's start within chunk.text */
  lineStarts: number[];
}

/** Group document lines into chunks the model can swallow, tracking line offsets. */
function chunkLines(lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: string[] = [];
  let curLen = 0;
  let firstLine = 0;
  const flush = (): void => {
    if (cur.length === 0) return;
    const lineStarts: number[] = [];
    let off = 0;
    cur.forEach((l, i) => {
      lineStarts.push(off);
      off += l.length + (i < cur.length - 1 ? 1 : 0);
    });
    chunks.push({ text: cur.join('\n'), firstLine, lineStarts });
    firstLine += cur.length;
    cur = [];
    curLen = 0;
  };
  for (const line of lines) {
    if (curLen + line.length + 1 > MAX_CHUNK_CHARS && cur.length > 0) flush();
    cur.push(line);
    curLen += line.length + 1;
  }
  flush();
  return chunks;
}

interface MergedEntity {
  type: string;
  text: string;
  score: number;
}

/**
 * Merge BIO-tagged subword tokens into entities. `pieces` is the raw WordPiece
 * token list for the chunk (with ## continuation markers); a classified token
 * at index j maps to pieces[j - 1] because index 0 is [CLS].
 */
function mergeEntities(pieces: string[], tokens: NerToken[]): MergedEntity[] {
  const out: MergedEntity[] = [];
  let cur: { type: string; pieces: string[]; scores: number[] } | null = null;
  const push = (): void => {
    if (cur && cur.pieces.length > 0) {
      const text = cur.pieces
        .map((p, i) => (p.startsWith('##') ? p.slice(2) : i === 0 ? p : ` ${p}`))
        .join('')
        .trim();
      if (text) {
        out.push({
          type: cur.type,
          text,
          score: cur.scores.reduce((a, b) => a + b, 0) / cur.scores.length,
        });
      }
    }
    cur = null;
  };
  const sorted = [...tokens].sort((a, b) => a.index - b.index);
  for (const t of sorted) {
    const m = t.entity.match(/^([BI])-(.+)$/);
    const piece = pieces[t.index - 1];
    if (!m || !piece) {
      if (!m) push();
      continue;
    }
    const type = m[2];
    const continues = m[1] === 'I' && cur !== null && cur.type === type;
    if (!continues) push();
    if (!cur) cur = { type, pieces: [], scores: [] };
    cur.pieces.push(piece);
    cur.scores.push(t.score);
  }
  push();
  return out;
}

/**
 * Find each entity's position in the chunk text (sequential search, so repeated
 * names resolve in document order) and map it to a document line index.
 */
function locateEntities(chunk: Chunk, merged: MergedEntity[]): NerEntity[] {
  const found: NerEntity[] = [];
  let cursor = 0;
  for (const e of merged) {
    if (e.score < MIN_SCORE) continue;
    let at = chunk.text.indexOf(e.text, cursor);
    if (at < 0) {
      // Tokenizer spacing quirks (e.g. "C++" vs "C ++"): fall back to a
      // whitespace-normalized search. The offset is approximate but close
      // enough for line assignment.
      const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
      const ni = norm(chunk.text.slice(cursor)).indexOf(norm(e.text));
      if (ni < 0) continue;
      at = cursor + ni;
    }
    let li = 0;
    for (let i = 0; i < chunk.lineStarts.length; i++) {
      if (chunk.lineStarts[i] <= at) li = i;
      else break;
    }
    found.push({ type: e.type, text: e.text, score: e.score, line: chunk.firstLine + li });
    cursor = at + e.text.length;
  }
  return found;
}

/** Keep the highest-scoring entity for each type+text pair, in document order. */
function dedupeEntities(entities: NerEntity[]): NerEntity[] {
  const best = new Map<string, NerEntity>();
  for (const e of entities) {
    const key = `${e.type}::${e.text.toLowerCase()}`;
    const prev = best.get(key);
    if (!prev || e.score > prev.score) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => a.line - b.line);
}

const MONTH =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const DATE = `(?:${MONTH})\\.?\\s+\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4}[/.-]\\d{1,2}|\\d{4}`;
const DATE_RANGE_RE = new RegExp(
  `(${DATE})\\s*[\\u2013\\u2014-]\\s*(${DATE}|present|current|now)\\b`,
  'i'
);
const BULLET_RE = /^[•·▪◦▸‣⁃]\s*|^(?:[*+>]|\d+[.)]|[-–—])\s+/;

function entitiesOfTypeOnLines(
  entities: NerEntity[],
  lines: Set<number>,
  type: string
): NerEntity[] {
  return entities
    .filter((e) => e.type === type && lines.has(e.line))
    .sort((a, b) => b.score - a.score);
}

function bestEntity(
  entities: NerEntity[],
  lines: Set<number>,
  type: string,
  fallback: string
): string {
  const found = entitiesOfTypeOnLines(entities, lines, type);
  if (found.length === 0) return fallback;
  const top = found[0];
  if (!fallback) return top.text;
  return top.score >= TRUST_SCORE ? top.text : fallback;
}

/**
 * Merge NER entities into the heuristic parse. The heuristic owns structure
 * (sections, entries, bullets, dates); NER upgrades the fields it extracts
 * best: contact details, job titles, company names, degrees, schools, skills.
 */
function enrich(base: ParsedResume, entities: NerEntity[], split: SplitResume): ParsedResume {
  const lineKind = (i: number): string => split.kinds[i] ?? '';
  const linesOfKind = (kind: string): Set<number> => {
    const s = new Set<number>();
    split.lines.forEach((_, i) => {
      if (lineKind(i) === kind) s.add(i);
    });
    return s;
  };

  // ---- contact ----
  const contactLines = linesOfKind('contact');
  const headLines = new Set<number>();
  for (let i = 0; i < Math.min(split.lines.length, 12); i++) headLines.add(i);
  const names = entitiesOfTypeOnLines(entities, contactLines, 'Name');
  const headNames = entitiesOfTypeOnLines(entities, headLines, 'Name');
  const name = names[0] ?? headNames[0];
  if (name) base.fullName = name.text;
  if (!base.email) {
    const e = entitiesOfTypeOnLines(entities, headLines, 'Email Address')[0];
    if (e) base.email = e.text;
  }
  if (!base.phone) {
    const p = entitiesOfTypeOnLines(entities, headLines, 'Phone')[0];
    if (p) base.phone = p.text;
  }
  if (!base.location) {
    const l = entitiesOfTypeOnLines(entities, contactLines, 'Location')[0];
    if (l) base.location = l.text;
  }

  // ---- experience & education: attach entities to entry header lines ----
  // Entries sit in the same order as the heuristic's, so align by index.
  const enrichEntries = (
    sectionKey: 'experience' | 'education',
    entries: { title: string; company: string; location: string }[] | { degree: string; school: string; location: string; end: string }[],
    mapping: [string, string][]
  ): void => {
    const sectionLines: { text: string; line: number }[] = [];
    split.lines.forEach((text, i) => {
      if (lineKind(i) === sectionKey) sectionLines.push({ text, line: i });
    });
    // Group lines into entries on date-range lines; the 1-2 non-bullet lines
    // above each date line are the entry's header.
    const headerSets: Set<number>[] = [];
    const dateIdx: number[] = [];
    sectionLines.forEach((l, i) => {
      if (DATE_RANGE_RE.test(l.text)) dateIdx.push(i);
    });
    for (const di of dateIdx) {
      const hs = new Set<number>();
      for (let i = di - 1; i >= 0 && hs.size < 2; i--) {
        const l = sectionLines[i];
        if (DATE_RANGE_RE.test(l.text) || BULLET_RE.test(l.text)) break;
        hs.add(l.line);
      }
      headerSets.push(hs);
    }
    entries.forEach((entry, k) => {
      const hs = headerSets[k];
      if (!hs || hs.size === 0) return;
      for (const [entityType, field] of mapping) {
        const rec = entry as Record<string, string>;
        rec[field] = bestEntity(entities, hs, entityType, rec[field] ?? '');
      }
    });
  };

  enrichEntries(
    'experience',
    base.experience,
    [
      ['Designation', 'title'],
      ['Companies worked at', 'company'],
      ['Location', 'location'],
    ]
  );
  enrichEntries(
    'education',
    base.education,
    [
      ['Degree', 'degree'],
      ['College Name', 'school'],
      ['Location', 'location'],
    ]
  );
  // Graduation years the heuristic missed: take the NER year on the entry's header.
  {
    const sectionLines: { text: string; line: number }[] = [];
    split.lines.forEach((text, i) => {
      if (lineKind(i) === 'education') sectionLines.push({ text, line: i });
    });
    const headerSets: Set<number>[] = [];
    const dateIdx: number[] = [];
    sectionLines.forEach((l, i) => {
      if (DATE_RANGE_RE.test(l.text)) dateIdx.push(i);
    });
    for (const di of dateIdx) {
      const hs = new Set<number>();
      for (let i = di - 1; i >= 0 && hs.size < 2; i--) {
        const l = sectionLines[i];
        if (DATE_RANGE_RE.test(l.text) || BULLET_RE.test(l.text)) break;
        hs.add(l.line);
      }
      headerSets.push(hs);
    }
    base.education.forEach((entry, k) => {
      if (entry.end) return;
      const hs = headerSets[k];
      if (!hs) return;
      const y = entitiesOfTypeOnLines(entities, hs, 'Graduation Year')[0];
      if (y) entry.end = y.text;
    });
  }

  // ---- skills: merge NER skill phrases into the skill groups ----
  const skillLines = linesOfKind('skills');
  const seen = new Set<string>();
  for (const g of base.skills) for (const it of g.items) seen.add(it.toLowerCase());
  const extra: string[] = [];
  for (const e of entitiesOfTypeOnLines(entities, skillLines, 'Skills')) {
    for (const part of e.text.split(/[,;·•|/]/)) {
      const t = part.trim();
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        extra.push(t);
      }
    }
  }
  if (extra.length > 0) {
    if (base.skills.length > 0) base.skills[base.skills.length - 1].items.push(...extra);
    else base.skills.push({ label: '', items: extra });
  }

  return base;
}

/**
 * Parse resume text with the on-device NER model. Returns null when the model
 * cannot load or finds nothing — the caller then tries the next method.
 * Reports download progress (0..0.85) and reading progress (0.85..1).
 */
export async function localAiParseResume(
  text: string,
  onProgress?: LocalAiProgress
): Promise<ParsedResume | null> {
  const input = text.length > 20000 ? text.slice(0, 20000) : text;
  if (!input.trim()) return null;
  const model = await loadModel(
    onProgress ? (f, label) => onProgress(f * 0.85, label) : undefined
  );
  const split = splitResumeSections(input);
  const chunks = chunkLines(split.lines);
  const all: NerEntity[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.text.trim()) {
      onProgress?.(0.85 + (0.13 * i) / chunks.length, `Reading the resume (${i + 1} of ${chunks.length})`);
      const tokens = await model.classify(chunk.text);
      const pieces = model.tokenize(chunk.text);
      all.push(...locateEntities(chunk, mergeEntities(pieces, tokens)));
    }
  }
  const entities = dedupeEntities(all);
  if (entities.length === 0) return null;
  onProgress?.(1, 'Putting the details together');
  return enrich(parseResumeText(input), entities, split);
}

/** True when the model files are already cached from a previous parse. */
export function isLocalAiReady(): boolean {
  return modelPromise !== null;
}
