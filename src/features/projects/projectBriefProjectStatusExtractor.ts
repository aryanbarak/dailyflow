// SmartFlow -- Project Brief Foundation.
//
// Deterministic extraction from a `project_status_document` evidence item
// (canonically PROJECT_STATUS.md's shape): current phase, current focus,
// completed milestones, explicit next actions, technical debt, and
// (optionally) limitations. Only four exact, numeric-prefix-tolerant
// heading names are required; nothing outside them plus the optional
// "Limitations" heading is read. `technicalDebt` (from the "Technical
// Debt" heading) and `limitations` (from an explicit "Limitations"/"Known
// Limitations" heading, not currently used by this document) are kept
// distinct -- "technical debt" and "limitation" are not the same claim,
// and this extractor never asserts they are. Explicit next actions use the
// same literal-label-match convention as current phase/focus, extended to
// per-bullet-item labels: a bullet under "Next Sprint" whose text begins
// with the literal, case-insensitive label `"Next action:"` is extracted,
// label stripped; a bullet without that label is not treated as a next
// action, since nothing here ranks or infers priority from an
// unlabeled statement.

import type { ProjectBriefExtractionWarning } from "./projectBriefTypes";
import { findAllSections, splitByHeadings, type MarkdownSection } from "./projectBriefMarkdownSections";
import {
  extractBoundedBulletItems,
  extractBoundedLabeledSentence,
  extractLabeledActionItems,
  extractOptionalLimitations,
  resolveUniqueSection,
  type ExtractorResult,
  type ProjectBriefExtractedItem,
  type ProjectBriefExtractorInput,
} from "./projectBriefExtractorTypes";

export interface ProjectStatusExtractionFacts {
  readonly currentPhase?: ProjectBriefExtractedItem;
  readonly currentFocus?: ProjectBriefExtractedItem;
  readonly completedMilestones: readonly ProjectBriefExtractedItem[];
  readonly explicitNextActions: readonly ProjectBriefExtractedItem[];
  readonly technicalDebt: readonly ProjectBriefExtractedItem[];
  readonly limitations: readonly ProjectBriefExtractedItem[];
}

const PHASE_HEADING = ["current project phase"];
const NEXT_SPRINT_HEADING = ["next sprint"];
const MILESTONES_HEADING = ["completed milestones"];
const TECH_DEBT_HEADING = ["technical debt"];
const ALL_KNOWN_HEADINGS = [...PHASE_HEADING, ...NEXT_SPRINT_HEADING, ...MILESTONES_HEADING, ...TECH_DEBT_HEADING];

function reportMalformedIfSectionEmpty(
  section: MarkdownSection | undefined,
  found: unknown,
  labelDescription: string,
  input: ProjectBriefExtractorInput,
  warnings: ProjectBriefExtractionWarning[],
): void {
  if (section && !found) {
    warnings.push({
      code: "UNSUPPORTED_DOCUMENT_SHAPE",
      message: `Section "${section.headingText}" is present but does not contain the expected "${labelDescription}" statement.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
      sectionHeading: section.headingText,
    });
  }
}

export function extractProjectStatusDocument(input: ProjectBriefExtractorInput): ExtractorResult<ProjectStatusExtractionFacts> {
  const warnings: ProjectBriefExtractionWarning[] = [];
  const sections = splitByHeadings(input.textContent);

  if (findAllSections(sections, ALL_KNOWN_HEADINGS).length === 0) {
    warnings.push({
      code: "UNSUPPORTED_DOCUMENT_SHAPE",
      message: "No recognized project-status section headings were found in this document.",
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return { facts: { completedMilestones: [], explicitNextActions: [], technicalDebt: [], limitations: [] }, warnings };
  }

  const phaseSection = resolveUniqueSection(sections, PHASE_HEADING, input, warnings);
  const currentPhase = phaseSection ? extractBoundedLabeledSentence(phaseSection, "Current phase:", input, warnings) : undefined;
  reportMalformedIfSectionEmpty(phaseSection, currentPhase, "Current phase:", input, warnings);

  const nextSprintSection = resolveUniqueSection(sections, NEXT_SPRINT_HEADING, input, warnings);
  const currentFocus = nextSprintSection
    ? extractBoundedLabeledSentence(nextSprintSection, "Current next milestone:", input, warnings)
    : undefined;
  reportMalformedIfSectionEmpty(nextSprintSection, currentFocus, "Current next milestone:", input, warnings);
  const explicitNextActions = nextSprintSection ? extractLabeledActionItems(nextSprintSection, input, warnings) : [];

  const milestonesSection = resolveUniqueSection(sections, MILESTONES_HEADING, input, warnings);
  const completedMilestones = milestonesSection ? extractBoundedBulletItems(milestonesSection, input, warnings) : [];

  const techDebtSection = resolveUniqueSection(sections, TECH_DEBT_HEADING, input, warnings);
  const technicalDebt = techDebtSection ? extractBoundedBulletItems(techDebtSection, input, warnings) : [];

  const limitations = extractOptionalLimitations(sections, input, warnings);

  return { facts: { currentPhase, currentFocus, completedMilestones, explicitNextActions, technicalDebt, limitations }, warnings };
}
