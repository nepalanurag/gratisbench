// Optional on-device resume parsing. The standard heuristic parser remains the
// default; the larger model is loaded only after the user explicitly opts in.
import type { ParsedResume } from './resume-import.ts';
import { localAiParseResume } from './resume-local-ai.ts';

const MODE_LS = 'truepdf_parse_mode';

/** How resume import reads a file: on-device AI or the standard reader. */
export type ParseMode = 'local' | 'heuristic';

export function getParseMode(): ParseMode {
  try {
    const mode = localStorage.getItem(MODE_LS);
    if (mode === 'local' || mode === 'heuristic') return mode;
  } catch {
    // Storage may be disabled; use the no-download reader.
  }
  return 'heuristic';
}

export function setParseMode(mode: ParseMode): void {
  try {
    localStorage.setItem(MODE_LS, mode);
  } catch {
    // The selected mode still applies for this page session.
  }
}

/** True when the parse found something worth showing in the review step. */
export function hasParsedContent(parsed: ParsedResume): boolean {
  return (
    parsed.fullName.length > 0 ||
    parsed.experience.length > 0 ||
    parsed.education.length > 0 ||
    parsed.skills.length > 0 ||
    parsed.projects.length > 0
  );
}

export type SmartParseProgress = (fraction: number, label: string) => void;

/** Return local-AI results only when the user opted into downloading the model. */
export async function smartParseResume(
  text: string,
  onProgress?: SmartParseProgress
): Promise<ParsedResume | null> {
  if (getParseMode() !== 'local') return null;
  try {
    const parsed = await localAiParseResume(text, onProgress);
    return parsed && hasParsedContent(parsed) ? parsed : null;
  } catch {
    // The import UI reports the fallback and uses the standard local parser.
    return null;
  }
}
