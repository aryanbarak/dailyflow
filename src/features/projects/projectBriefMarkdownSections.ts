// SmartFlow -- Project Brief Foundation.
//
// Bounded, heading-aware document parsing shared by every Project Brief
// extractor. This is deliberately NOT a general Markdown parser: it detects
// ATX headings (`#`/`##`/`###`) and top-level `-`/`*` bullet items under a
// heading, and locates one labeled sentence (an exact, literal text label
// like "Current phase:") within a section. It never interprets prose, never
// resolves nested list structure, and never infers meaning from anything but
// literal heading text, literal bullet syntax, and literal sentence
// punctuation.

/** A bounded upper limit shared by every extractor's item extraction to keep worst-case work and output size predictable against a pathological document. */
export const MAX_ITEMS_PER_SECTION = 200;
/** A single extracted bullet item's text is rejected (not truncated -- truncation would silently misrepresent the source) past this length. */
export const MAX_BULLET_TEXT_LENGTH = 500;
/** A single extracted labeled-sentence value (e.g. "Current phase: ...") is rejected past this length. */
export const MAX_LABELED_TEXT_LENGTH = 800;

export interface MarkdownSection {
  readonly level: number;
  readonly headingText: string;
  /** Leading numeric prefixes (`1.`, `2.3`) stripped, lowercased, trimmed -- so `## 2. Current Project Phase` and `## Current Project Phase` match the same allowlist entry. */
  readonly headingTextNormalized: string;
  readonly bodyText: string;
  /** 0-indexed line offset of the heading line itself within the full document text. */
  readonly headingLineOffset: number;
}

export interface MarkdownBulletItem {
  readonly text: string;
  /** 0-indexed line offset within the full document text. */
  readonly lineOffset: number;
}

export interface LabeledSentenceMatch {
  readonly text: string;
  readonly lineOffset: number;
}

const HEADING_PATTERN = /^(#{1,3})\s+(.*?)\s*#*\s*$/;
const BULLET_PATTERN = /^\s*[-*]\s+(.*\S)\s*$/;
const NUMERIC_PREFIX_PATTERN = /^\d+(\.\d+)*\.?\s+/;

function normalizeHeadingText(headingText: string): string {
  return headingText.replace(NUMERIC_PREFIX_PATTERN, "").trim().toLowerCase();
}

/** Splits a document into an ordered list of heading-delimited sections. Content before the first heading is discarded -- every extractor in this module only ever reads content that lives under a recognized heading. */
export function splitByHeadings(text: string): readonly MarkdownSection[] {
  const lines = text.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: { level: number; headingText: string; bodyLines: string[]; headingLineOffset: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const match = HEADING_PATTERN.exec(lines[i]);
    if (match) {
      if (current) sections.push(finalizeSection(current));
      current = { level: match[1].length, headingText: match[2], bodyLines: [], headingLineOffset: i };
    } else if (current) {
      current.bodyLines.push(lines[i]);
    }
  }
  if (current) sections.push(finalizeSection(current));
  return sections;
}

function finalizeSection(current: { level: number; headingText: string; bodyLines: string[]; headingLineOffset: number }): MarkdownSection {
  return {
    level: current.level,
    headingText: current.headingText,
    headingTextNormalized: normalizeHeadingText(current.headingText),
    bodyText: current.bodyLines.join("\n"),
    headingLineOffset: current.headingLineOffset,
  };
}

/** First section whose normalized heading text is in the allowlist, or `undefined`. Duplicate-heading detection is the caller's job (see `findAllSections`) -- this helper alone cannot distinguish "no match" from "matched, but a duplicate was ignored." */
export function findSection(sections: readonly MarkdownSection[], normalizedNameAllowlist: readonly string[]): MarkdownSection | undefined {
  const allowed = new Set(normalizedNameAllowlist);
  return sections.find((section) => allowed.has(section.headingTextNormalized));
}

/** Every section whose normalized heading text is in the allowlist, in document order -- length > 1 means a duplicate heading. */
export function findAllSections(sections: readonly MarkdownSection[], normalizedNameAllowlist: readonly string[]): readonly MarkdownSection[] {
  const allowed = new Set(normalizedNameAllowlist);
  return sections.filter((section) => allowed.has(section.headingTextNormalized));
}

/** Top-level `-`/`*` bullet lines directly in a section's body, in document order, bounded by `MAX_ITEMS_PER_SECTION`. Nested bullets are not distinguished from top-level ones -- this is bounded list extraction, not a list-tree parser. */
export function extractBulletItems(section: MarkdownSection, maxItems: number = MAX_ITEMS_PER_SECTION): readonly MarkdownBulletItem[] {
  const bodyLines = section.bodyText.split(/\r?\n/);
  const items: MarkdownBulletItem[] = [];
  for (let i = 0; i < bodyLines.length && items.length < maxItems; i++) {
    const match = BULLET_PATTERN.exec(bodyLines[i]);
    if (match) items.push({ text: match[1], lineOffset: section.headingLineOffset + 1 + i });
  }
  return items;
}

/**
 * Finds an exact, literal text label (e.g. `"Current phase:"`) at the start
 * of a line within a section, and returns the paragraph that follows it --
 * the labeled line plus any immediately following non-blank lines (a
 * soft-wrapped Markdown paragraph), joined with a single space, and bounded
 * to the first complete sentence (first `". "` or end of paragraph). This
 * is a literal-label match plus a structural (blank-line) paragraph
 * boundary and orthographic (period) sentence boundary -- never semantic
 * interpretation of the sentence's content.
 */
export function findLabeledSentence(section: MarkdownSection, label: string): LabeledSentenceMatch | undefined {
  const bodyLines = section.bodyText.split(/\r?\n/);
  const labelPattern = new RegExp(`^\\s*${label}\\s*(.*)$`, "i");
  for (let i = 0; i < bodyLines.length; i++) {
    const match = labelPattern.exec(bodyLines[i]);
    if (!match) continue;
    const paragraphLines = [match[1]];
    for (let j = i + 1; j < bodyLines.length && bodyLines[j].trim().length > 0; j++) {
      paragraphLines.push(bodyLines[j]);
    }
    const paragraph = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
    if (paragraph.length === 0) return undefined;
    const sentenceEnd = paragraph.indexOf(". ");
    const text = sentenceEnd === -1 ? paragraph : paragraph.slice(0, sentenceEnd + 1);
    return { text, lineOffset: section.headingLineOffset + 1 + i };
  }
  return undefined;
}
