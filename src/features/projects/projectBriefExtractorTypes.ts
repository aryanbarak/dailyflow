// SmartFlow -- Project Brief Foundation.
//
// The shared input/output contract every extractor
// (projectBriefProjectStatusExtractor.ts, projectBriefAdrExtractor.ts,
// projectBriefRoadmapExtractor.ts, projectBriefArchitectureExtractor.ts,
// projectBriefProductDirectionExtractor.ts) implements, plus the bounded
// bullet/labeled-sentence extraction helpers they all share. Every
// extractor accepts one evidence-backed text document and never accesses
// the filesystem, network, or any hidden mutable state -- each call is a
// pure function of its input.

import type { ProjectSourceKind } from "./projectContextTypes";
import type { BriefProvenance, ProjectBriefExtractionWarning } from "./projectBriefTypes";
import {
  extractBulletItems,
  findAllSections,
  findLabeledSentence,
  MAX_BULLET_TEXT_LENGTH,
  MAX_ITEMS_PER_SECTION,
  MAX_LABELED_TEXT_LENGTH,
  type MarkdownSection,
} from "./projectBriefMarkdownSections";

export interface ProjectBriefExtractorInput {
  readonly evidenceId: string;
  readonly sourceReference: string;
  readonly sourceKind: ProjectSourceKind;
  readonly textContent: string;
}

export interface ProjectBriefExtractedItem {
  readonly text: string;
  readonly provenance: BriefProvenance;
}

/** Every extractor's return shape: typed facts plus typed warnings, never a thrown exception for an expected malformed-shape condition. */
export interface ExtractorResult<F> {
  readonly facts: F;
  readonly warnings: readonly ProjectBriefExtractionWarning[];
}

export function provenanceFor(input: ProjectBriefExtractorInput, sectionHeading: string, lineOffset: number): BriefProvenance {
  return {
    sourceEvidenceId: input.evidenceId,
    sourceReference: input.sourceReference,
    sourceKind: input.sourceKind,
    sectionHeading,
    lineOffset,
  };
}

/**
 * Extracts a section's bullet items, bounded on both count and per-item
 * length. An oversized item is rejected (never truncated -- truncation
 * would silently misrepresent the source) with a typed warning; a section
 * with more items than the bound is capped, also with a typed warning --
 * never a silent drop.
 */
export function extractBoundedBulletItems(
  section: MarkdownSection,
  input: ProjectBriefExtractorInput,
  warnings: ProjectBriefExtractionWarning[],
): readonly ProjectBriefExtractedItem[] {
  const rawItems = extractBulletItems(section, MAX_ITEMS_PER_SECTION + 1);
  const bounded = rawItems.length > MAX_ITEMS_PER_SECTION ? rawItems.slice(0, MAX_ITEMS_PER_SECTION) : rawItems;
  if (rawItems.length > MAX_ITEMS_PER_SECTION) {
    warnings.push({
      code: "TOO_MANY_ITEMS",
      message: `Section "${section.headingText}" has more than ${MAX_ITEMS_PER_SECTION} items; extra items were not extracted.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
      sectionHeading: section.headingText,
    });
  }

  const items: ProjectBriefExtractedItem[] = [];
  for (const bullet of bounded) {
    if (bullet.text.length > MAX_BULLET_TEXT_LENGTH) {
      warnings.push({
        code: "ITEM_TEXT_TOO_LONG",
        message: `An item under "${section.headingText}" exceeds ${MAX_BULLET_TEXT_LENGTH} characters and was not extracted.`,
        sourceEvidenceId: input.evidenceId,
        sourceReference: input.sourceReference,
        sectionHeading: section.headingText,
      });
      continue;
    }
    items.push({ text: bullet.text, provenance: provenanceFor(input, section.headingText, bullet.lineOffset) });
  }
  return items;
}

/**
 * Resolves exactly one section by an allowlist of normalized heading names:
 * `undefined` plus a `MISSING_EXPECTED_SECTION` warning if absent, the
 * first occurrence plus a `DUPLICATE_HEADING` warning if the heading
 * appears more than once in this document. "First occurrence in this
 * document's own linear text order" is a structural property of the one
 * document being parsed, never a cross-source or cross-evidence
 * array-order resolution.
 */
export function resolveUniqueSection(
  sections: readonly MarkdownSection[],
  names: readonly string[],
  input: ProjectBriefExtractorInput,
  warnings: ProjectBriefExtractionWarning[],
): MarkdownSection | undefined {
  const matches = findAllSections(sections, names);
  if (matches.length === 0) {
    warnings.push({
      code: "MISSING_EXPECTED_SECTION",
      message: `Expected section "${names[0]}" was not found.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return undefined;
  }
  if (matches.length > 1) {
    warnings.push({
      code: "DUPLICATE_HEADING",
      message: `Section "${names[0]}" appears more than once; only the first occurrence was used.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
      sectionHeading: matches[0].headingText,
    });
  }
  return matches[0];
}

const NEXT_ACTION_LABEL = /^next action:\s*(.+)$/i;

/**
 * Extracts only the bullets in a section that carry the literal,
 * case-insensitive label `"Next action:"` -- the one designed, documented
 * convention that makes a statement an explicit next action. Section
 * membership alone (e.g. being under "Consequences" or "Next Sprint")
 * never qualifies a bullet as an action; only this exact per-item label
 * does. Shared by projectBriefProjectStatusExtractor.ts (Next Sprint
 * bullets) and projectBriefAdrExtractor.ts (Consequences bullets) so both
 * apply the identical rule rather than two subtly different ones.
 */
export function extractLabeledActionItems(
  section: MarkdownSection,
  input: ProjectBriefExtractorInput,
  warnings: ProjectBriefExtractionWarning[],
): readonly ProjectBriefExtractedItem[] {
  const bullets = extractBulletItems(section);
  const items: ProjectBriefExtractedItem[] = [];
  for (const bullet of bullets) {
    const match = NEXT_ACTION_LABEL.exec(bullet.text);
    if (!match) continue;
    const text = match[1].trim();
    if (text.length === 0) continue;
    if (text.length > MAX_BULLET_TEXT_LENGTH) {
      warnings.push({
        code: "ITEM_TEXT_TOO_LONG",
        message: `A "Next action:" item under "${section.headingText}" exceeds ${MAX_BULLET_TEXT_LENGTH} characters and was not extracted.`,
        sourceEvidenceId: input.evidenceId,
        sourceReference: input.sourceReference,
        sectionHeading: section.headingText,
      });
      continue;
    }
    items.push({ text, provenance: provenanceFor(input, section.headingText, bullet.lineOffset) });
  }
  return items;
}

/** Heading names that make a section's bullets `limitations` -- deliberately narrow and distinct from `technicalDebt`/`nonGoals`/`deferredItems`/`outOfScope`, none of which imply "limitation" on their own. No currently-committed canonical document uses this heading; see PROJECT_STATUS.md. */
export const LIMITATIONS_HEADINGS = ["limitations", "known limitations"];

/**
 * Optional across every document kind: absence produces no warning (this
 * heading is a bonus fact, never a required part of any document's
 * expected shape), but a repeated occurrence still produces
 * `DUPLICATE_HEADING`, exactly like every other resolved section.
 */
export function extractOptionalLimitations(
  sections: readonly MarkdownSection[],
  input: ProjectBriefExtractorInput,
  warnings: ProjectBriefExtractionWarning[],
): readonly ProjectBriefExtractedItem[] {
  const matches = findAllSections(sections, LIMITATIONS_HEADINGS);
  if (matches.length === 0) return [];
  if (matches.length > 1) {
    warnings.push({
      code: "DUPLICATE_HEADING",
      message: `Section "${LIMITATIONS_HEADINGS[0]}" appears more than once; only the first occurrence was used.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
      sectionHeading: matches[0].headingText,
    });
  }
  return extractBoundedBulletItems(matches[0], input, warnings);
}

/** Extracts one labeled sentence (e.g. `"Current phase:"`), bounded on length. */
export function extractBoundedLabeledSentence(
  section: MarkdownSection,
  label: string,
  input: ProjectBriefExtractorInput,
  warnings: ProjectBriefExtractionWarning[],
): ProjectBriefExtractedItem | undefined {
  const match = findLabeledSentence(section, label);
  if (!match) return undefined;
  if (match.text.length > MAX_LABELED_TEXT_LENGTH) {
    warnings.push({
      code: "ITEM_TEXT_TOO_LONG",
      message: `The "${label}" statement under "${section.headingText}" exceeds ${MAX_LABELED_TEXT_LENGTH} characters and was not extracted.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
      sectionHeading: section.headingText,
    });
    return undefined;
  }
  return { text: match.text, provenance: provenanceFor(input, section.headingText, match.lineOffset) };
}
