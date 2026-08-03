// SmartFlow -- Project Brief Foundation.
//
// Deterministic extraction from a `product_direction_document` evidence
// item: explicit non-goals, and (optionally) limitations -- kept as two
// distinct fields, never merged. Mission, positioning, and "current
// proving ground" are named in docs/architecture/project-domain.md's
// product-direction description as facts such a document "may provide,"
// but none of the ProjectBrief contract's required fields has a home for
// them, and inventing a new top-level field not requested by the contract
// would overstate what this slice was asked to build. This is a
// deliberate scope limit, not an oversight -- see PROJECT_STATUS.md.

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

export interface ProductDirectionExtractionFacts {
  readonly nonGoals: readonly ProjectBriefExtractedItem[];
  readonly limitations: readonly ProjectBriefExtractedItem[];
}

const NON_GOALS_HEADINGS = ["explicit non-goals", "non-goals"];

export function extractProductDirectionDocument(input: ProjectBriefExtractorInput): ExtractorResult<ProductDirectionExtractionFacts> {
  const warnings: ProjectBriefExtractionWarning[] = [];
  const sections = splitByHeadings(input.textContent);

  const nonGoalsSection = resolveUniqueSectionOrUnsupported(sections, input, warnings);
  const nonGoals = nonGoalsSection ? extractBoundedBulletItems(nonGoalsSection, input, warnings) : [];
  const limitations = extractOptionalLimitations(sections, input, warnings);

  return { facts: { nonGoals, limitations }, warnings };
}

function resolveUniqueSectionOrUnsupported(
  sections: ReturnType<typeof splitByHeadings>,
  input: ProjectBriefExtractorInput,
  warnings: ProjectBriefExtractionWarning[],
) {
  if (findAllSections(sections, NON_GOALS_HEADINGS).length === 0) {
    warnings.push({
      code: "UNSUPPORTED_DOCUMENT_SHAPE",
      message: "No recognized product-direction section headings were found in this document.",
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return undefined;
  }
  return resolveUniqueSection(sections, NON_GOALS_HEADINGS, input, warnings);
}
