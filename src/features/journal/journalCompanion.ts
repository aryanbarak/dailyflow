// CORE-W3 (2026-09-06, CORE audit items ۱-۱ + ۱-۲): pure analysis of a
// plain-text journal draft. CORE anchors these mechanics to TipTap nodes
// and a server-side Yjs scanner; SmartFlow's journal is a plain textarea
// saved straight to Supabase, so the translation is line-based detection
// feeding an EXPLICIT companion panel under the editor -- nothing runs or
// is created silently (matching both CORE's suggestion-only product rule
// and this repo's explicit-trigger governance, ADR-0010).
//
// Detected per line:
//   checkboxes  -- "- [ ] buy milk", "* [ ] X", "[ ] X", "[] X"
//                  (unchecked only; "[x]" is deliberately ignored)
//   instructions -- "@ai summarize this week" (also mid-line trailing
//                  "@ai ..." is NOT matched -- the mention must start the
//                  line, so prose about "@ai" never triggers anything)

export interface DetectedCheckbox {
  /** 0-based line number in the draft -- stable identity for UI keys. */
  lineIndex: number;
  title: string;
}

export interface DetectedInstruction {
  lineIndex: number;
  instruction: string;
}

export interface JournalDraftAnalysis {
  checkboxes: DetectedCheckbox[];
  instructions: DetectedInstruction[];
}

const CHECKBOX_RE = /^\s*(?:[-*]\s*)?\[\s?\]\s+(.+)$/;
const INSTRUCTION_RE = /^\s*@ai\s+(.+)$/i;

export const JOURNAL_TASK_TITLE_MAX = 120;
export const JOURNAL_INSTRUCTION_MAX = 500;

export function analyzeJournalDraft(content: string): JournalDraftAnalysis {
  const checkboxes: DetectedCheckbox[] = [];
  const instructions: DetectedInstruction[] = [];
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const checkbox = CHECKBOX_RE.exec(line);
    if (checkbox) {
      const title = checkbox[1].trim();
      if (title.length > 0) {
        checkboxes.push({
          lineIndex,
          title: title.length > JOURNAL_TASK_TITLE_MAX ? `${title.slice(0, JOURNAL_TASK_TITLE_MAX - 1)}…` : title,
        });
      }
      continue;
    }
    const instruction = INSTRUCTION_RE.exec(line);
    if (instruction) {
      const text = instruction[1].trim();
      if (text.length > 0) {
        instructions.push({ lineIndex, instruction: text.slice(0, JOURNAL_INSTRUCTION_MAX) });
      }
    }
  }

  return { checkboxes, instructions };
}
