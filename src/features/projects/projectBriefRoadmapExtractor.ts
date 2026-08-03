// SmartFlow -- Project Brief Foundation.
//
// Deterministic extraction from a `roadmap_document` evidence item:
// deferred items, out-of-scope items, risks, and (optionally)
// limitations -- each kept as its own field, never merged. A roadmap
// capability that has simply not been scheduled yet ("deferred") is not
// the same claim as an out-of-scope boundary statement, and neither is a
// "limitation"; this extractor never asserts otherwise. Current focus is
// recognized ONLY via one explicit, designed marker -- the literal,
// case-insensitive substring `[in progress]` on a Milestones bullet line.
// This is a syntactic marker this extractor defines and looks for, never
// an inference from milestone position, document order, or prose. No
// currently-committed SmartFlow roadmap document uses this marker yet, so
// roadmap-derived current focus is not available in practice today -- see
// PROJECT_STATUS.md's Project Brief Foundation entry for this
// honestly-stated limitation.

import type { ProjectBriefExtractionWarning } from "./projectBriefTypes";
import { findAllSections, splitByHeadings } from "./projectBriefMarkdownSections";
import {
  extractBoundedBulletItems,
  extractOptionalLimitations,
  resolveUniqueSection,
  type ExtractorResult,
  type ProjectBriefExtractedItem,
  type ProjectBriefExtractorInput,
} from "./projectBriefExtractorTypes";

export interface RoadmapExtractionFacts {
  readonly deferredItems: readonly ProjectBriefExtractedItem[];
  readonly outOfScope: readonly ProjectBriefExtractedItem[];
  readonly risks: readonly ProjectBriefExtractedItem[];
  readonly limitations: readonly ProjectBriefExtractedItem[];
  readonly currentFocus?: ProjectBriefExtractedItem;
}

const DEFERRED_HEADINGS = ["explicitly deferred", "deferred"];
const OUT_OF_SCOPE_HEADINGS = ["out of scope", "explicitly out of scope"];
const MILESTONES_HEADINGS = ["milestones"];
const RISKS_HEADINGS = ["risks"];
const ALL_KNOWN_HEADINGS = [...DEFERRED_HEADINGS, ...OUT_OF_SCOPE_HEADINGS, ...MILESTONES_HEADINGS, ...RISKS_HEADINGS];
const IN_PROGRESS_MARKER = /\[in progress\]/i;

export function extractRoadmapDocument(input: ProjectBriefExtractorInput): ExtractorResult<RoadmapExtractionFacts> {
  const warnings: ProjectBriefExtractionWarning[] = [];
  const sections = splitByHeadings(input.textContent);

  if (findAllSections(sections, ALL_KNOWN_HEADINGS).length === 0) {
    warnings.push({
      code: "UNSUPPORTED_DOCUMENT_SHAPE",
      message: "No recognized roadmap section headings were found in this document.",
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return { facts: { deferredItems: [], outOfScope: [], risks: [], limitations: [] }, warnings };
  }

  const deferredSection = resolveUniqueSection(sections, DEFERRED_HEADINGS, input, warnings);
  const deferredItems = deferredSection ? extractBoundedBulletItems(deferredSection, input, warnings) : [];

  const outOfScopeSection = resolveUniqueSection(sections, OUT_OF_SCOPE_HEADINGS, input, warnings);
  const outOfScope = outOfScopeSection ? extractBoundedBulletItems(outOfScopeSection, input, warnings) : [];

  const risksSection = resolveUniqueSection(sections, RISKS_HEADINGS, input, warnings);
  const risks = risksSection ? extractBoundedBulletItems(risksSection, input, warnings) : [];

  const limitations = extractOptionalLimitations(sections, input, warnings);

  const milestonesSection = resolveUniqueSection(sections, MILESTONES_HEADINGS, input, warnings);
  let currentFocus: ProjectBriefExtractedItem | undefined;
  if (milestonesSection) {
    const milestoneItems = extractBoundedBulletItems(milestonesSection, input, warnings);
    const inProgress = milestoneItems.filter((item) => IN_PROGRESS_MARKER.test(item.text));
    if (inProgress.length === 1) {
      currentFocus = { text: inProgress[0].text.replace(IN_PROGRESS_MARKER, "").replace(/\s+/g, " ").trim(), provenance: inProgress[0].provenance };
    } else if (inProgress.length > 1) {
      warnings.push({
        code: "CONFLICTING_CANONICAL_STATEMENT",
        message: `More than one Milestones item is marked "[in progress]" in the same document; no current focus was derived.`,
        sourceEvidenceId: input.evidenceId,
        sourceReference: input.sourceReference,
        sectionHeading: milestonesSection.headingText,
      });
    }
  }

  return { facts: { deferredItems, outOfScope, risks, limitations, currentFocus }, warnings };
}
