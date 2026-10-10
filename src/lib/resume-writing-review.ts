import type { ResumeData } from './resume-core.ts';

export interface ResumeWritingNote {
  kind: 'essential' | 'bullet';
  title: string;
  detail: string;
  prompt: string;
}

const VAGUE_DUTY_RE =
  /^(?:responsible for|duties include|worked on|helped with|assisted with|handled|tasked with|participated in|involved in)\b/i;
const OUTCOME_RE =
  /\b(?:increased|improved|reduced|grew|launched|shipped|delivered|saved|cut|raised|lowered|accelerated|automated|result(?:ed|ing)? in|earning|generating|by \d|from .{1,45} to .{1,45})\b|\b\d+(?:\.\d+)?\s?%/i;

export function reviewResumeWriting(resume: ResumeData): ResumeWritingNote[] {
  const notes: ResumeWritingNote[] = [];
  const addEssential = (title: string, detail: string, prompt: string): void => {
    notes.push({ kind: 'essential', title, detail, prompt });
  };

  if (!resume.contact.fullName.trim()) {
    addEssential('Add your name', 'A name is usually expected at the top of a resume.', 'What name should employers see?');
  }
  if (!resume.contact.email.trim() && !resume.contact.phone.trim()) {
    addEssential(
      'Add a way to reach you',
      'No email address or phone number is filled in.',
      'Which professional contact detail do you want to share?'
    );
  }
  if (!resume.summary.trim()) {
    addEssential(
      'Consider a short summary',
      'A brief introduction can make your focus and strengths clear.',
      'What role are you targeting, and what strengths or experience make you a fit?'
    );
  }
  if (resume.experience.length === 0 && resume.projects.length === 0) {
    addEssential(
      'Add relevant experience or projects',
      'There are no work entries or projects in this draft yet.',
      'Which role, project, or achievement best demonstrates your work?'
    );
  }

  const bulletGroups: { label: string; bullets: string[] }[] = [
    ...resume.experience.map((entry) => ({
      label: [entry.title, entry.company].filter(Boolean).join(' at ') || 'Work experience',
      bullets: entry.bullets,
    })),
    ...resume.volunteer.map((entry) => ({
      label: [entry.title, entry.company].filter(Boolean).join(' at ') || 'Volunteer experience',
      bullets: entry.bullets,
    })),
    ...resume.projects.map((entry) => ({
      label: entry.name || 'Project',
      bullets: entry.bullets,
    })),
  ];

  for (const group of bulletGroups) {
    for (const bullet of group.bullets) {
      const text = bullet.trim();
      if (!text) continue;
      if (VAGUE_DUTY_RE.test(text)) {
        notes.push({
          kind: 'bullet',
          title: group.label,
          detail: `“${text}” starts with a vague duty phrase.`,
          prompt: 'Replace it with a specific action + scope + outcome. What did you do, how much or for whom, and what changed?',
        });
      } else if (!OUTCOME_RE.test(text)) {
        notes.push({
          kind: 'bullet',
          title: group.label,
          detail: `“${text}” describes work but no clear result.`,
          prompt: 'Could you add the outcome, scale, or evidence of impact? Use a metric only if you can support it.',
        });
      }
      if (notes.filter((note) => note.kind === 'bullet').length >= 8) return notes;
    }
  }
  return notes;
}
