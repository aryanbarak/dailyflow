// SmartFlow -- Project Brief Foundation.
//
// Deterministic extraction from an `architecture_document` evidence item:
// open decisions, non-goals, out-of-scope items, and (optionally)
// limitations -- each kept as its own field. "Non-Goals" and "Out of
// Scope" are recognized as two distinct headings, not synonyms: a
// deliberate scope exclusion and an out-of-scope boundary statement are
// related but not stated to be the same claim by the source document, so
// this extractor never merges them. Invariants and ownership-boundary
// extraction are explicitly not implemented in this slice -- named in
// docs/architecture/project-domain.md section 7 as something an
// architecture document "may provide," but bounding this extractor to a
// small, explicit heading set keeps it a small, explicit extractor rather
// than a general architecture-document summarizer. This is a deliberate
// scope limit, not an oversight -- see PROJECT_STATUS.md.

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

export interface ArchitectureExtractionFacts {
  readonly openDecisions: readonly ProjectBriefExtractedItem[];
  readonly nonGoals: readonly ProjectBriefExtractedItem[];
  readonly outOfScope: readonly ProjectBriefExtractedItem[];
  readonly limitations: readonly ProjectBriefExtractedItem[];
}

const OPEN_DECISIONS_HEADINGS = ["open decisions"];
const NON_GOALS_HEADINGS = ["non-goals"];
const OUT_OF_SCOPE_HEADINGS = ["out of scope", "explicitly out of scope"];
const ALL_KNOWN_HEADINGS = [...OPEN_DECISIONS_HEADINGS, ...NON_GOALS_HEADINGS, ...OUT_OF_SCOPE_HEADINGS];

export function extractArchitectureDocument(input: ProjectBriefExtractorInput): ExtractorResult<ArchitectureExtractionFacts> {
  const warnings: ProjectBriefExtractionWarning[] = [];
  const sections = splitByHeadings(input.textContent);

  if (findAllSections(sections, ALL_KNOWN_HEADINGS).length === 0) {
    warnings.push({
      code: "UNSUPPORTED_DOCUMENT_SHAPE",
      message: "No recognized architecture-document section headings were found in this document.",
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return { facts: { openDecisions: [], nonGoals: [], outOfScope: [], limitations: [] }, warnings };
  }

  const openDecisionsSection = resolveUniqueSection(sections, OPEN_DECISIONS_HEADINGS, input, warnings);
  const openDecisions = openDecisionsSection ? extractBoundedBulletItems(openDecisionsSection, input, warnings) : [];

  const nonGoalsSection = resolveUniqueSection(sections, NON_GOALS_HEADINGS, input, warnings);
  const nonGoals = nonGoalsSection ? extractBoundedBulletItems(nonGoalsSection, input, warnings) : [];

  const outOfScopeSection = resolveUniqueSection(sections, OUT_OF_SCOPE_HEADINGS, input, warnings);
  const outOfScope = outOfScopeSection ? extractBoundedBulletItems(outOfScopeSection, input, warnings) : [];

  const limitations = extractOptionalLimitations(sections, input, warnings);

  return { facts: { openDecisions, nonGoals, outOfScope, limitations }, warnings };
}
