// SmartFlow -- Project Brief Foundation.
//
// Deterministic extraction from an `adr` evidence item, matching this
// repository's own ADR convention (docs/decisions/adr/ADR-0001 onward): an
// `# ADR-NNNN: Title` H1 heading followed immediately by a
// `- **Status:** ...` / `- **Supersedes:** ...` / `- **Superseded by:** ...`
// metadata block, then a `## Consequences` and/or `## Deferred Decisions`
// section. Only an ADR whose Status is exactly "Accepted" and whose
// Superseded-by field is empty/"None" contributes a decision, consequences,
// or deferred decisions -- a non-accepted or explicitly-superseded ADR
// still counts as evidence read, but contributes nothing to the brief,
// each case recorded with its own typed warning rather than silently.
//
// Consequences bullets are extracted verbatim into `consequences` --
// unconditionally, regardless of whether a given bullet reads as an action
// (some are scope/boundary statements, not action directives; section
// membership alone never implies "this is a next action"). Separately,
// only the bullets among them that also carry the literal, per-item
// `"Next action:"` label are additionally extracted into `nextActions`.

import type { ProjectBriefExtractionWarning } from "./projectBriefTypes";
import { splitByHeadings, findSection } from "./projectBriefMarkdownSections";
import {
  extractBoundedBulletItems,
  extractLabeledActionItems,
  provenanceFor,
  type ExtractorResult,
  type ProjectBriefExtractedItem,
  type ProjectBriefExtractorInput,
} from "./projectBriefExtractorTypes";

export interface AdrExtractionFacts {
  readonly title?: string;
  readonly status?: string;
  readonly supersedes?: string;
  readonly supersededBy?: string;
  readonly acceptedDecision?: ProjectBriefExtractedItem;
  readonly consequences: readonly ProjectBriefExtractedItem[];
  readonly nextActions: readonly ProjectBriefExtractedItem[];
  readonly deferredDecisions: readonly ProjectBriefExtractedItem[];
}

const STATUS_PATTERN = /^-\s*\*\*Status:\*\*\s*(.+)$/im;
const SUPERSEDES_PATTERN = /^-\s*\*\*Supersedes:\*\*\s*(.+)$/im;
const SUPERSEDED_BY_PATTERN = /^-\s*\*\*Superseded by:\*\*\s*(.+)$/im;
const VALID_STATUSES = new Set(["accepted", "proposed", "rejected", "superseded"]);
const CONSEQUENCES_HEADING = ["consequences"];
const DEFERRED_DECISIONS_HEADING = ["deferred decisions"];
const EMPTY_FACTS = { consequences: [], nextActions: [], deferredDecisions: [] };

function isNoneValue(raw: string | undefined): boolean {
  return raw === undefined || raw.trim().length === 0 || raw.trim().toLowerCase() === "none";
}

export function extractAdrDocument(input: ProjectBriefExtractorInput): ExtractorResult<AdrExtractionFacts> {
  const warnings: ProjectBriefExtractionWarning[] = [];
  const sections = splitByHeadings(input.textContent);
  const titleSection = sections[0];

  if (!titleSection || titleSection.level !== 1) {
    warnings.push({
      code: "UNSUPPORTED_DOCUMENT_SHAPE",
      message: "No top-level ADR title heading was found in this document.",
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return { facts: EMPTY_FACTS, warnings };
  }

  const title = titleSection.headingText.trim();
  const statusMatch = STATUS_PATTERN.exec(titleSection.bodyText);
  if (!statusMatch) {
    warnings.push({
      code: "MALFORMED_ADR_METADATA",
      message: `ADR "${title}" is missing a "- **Status:**" metadata line.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return { facts: { title, ...EMPTY_FACTS }, warnings };
  }

  const statusRaw = statusMatch[1].trim();
  const statusNormalized = statusRaw.toLowerCase();
  if (!VALID_STATUSES.has(statusNormalized)) {
    warnings.push({
      code: "MALFORMED_ADR_METADATA",
      message: `ADR "${title}" has an unrecognized status value: "${statusRaw}".`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return { facts: { title, status: statusRaw, ...EMPTY_FACTS }, warnings };
  }

  const supersedesMatch = SUPERSEDES_PATTERN.exec(titleSection.bodyText);
  const supersededByMatch = SUPERSEDED_BY_PATTERN.exec(titleSection.bodyText);
  const supersedes = isNoneValue(supersedesMatch?.[1]) ? undefined : supersedesMatch![1].trim();
  const supersededBy = isNoneValue(supersededByMatch?.[1]) ? undefined : supersededByMatch![1].trim();

  const baseFacts = { title, status: statusRaw, supersedes, supersededBy, ...EMPTY_FACTS };

  if (statusNormalized !== "accepted") {
    warnings.push({
      code: "ADR_NOT_ACCEPTED",
      message: `ADR "${title}" has status "${statusRaw}" and does not contribute a decision.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return { facts: baseFacts, warnings };
  }

  if (supersededBy) {
    warnings.push({
      code: "ADR_SUPERSEDED",
      message: `ADR "${title}" is explicitly superseded by "${supersededBy}" and does not contribute a decision.`,
      sourceEvidenceId: input.evidenceId,
      sourceReference: input.sourceReference,
    });
    return { facts: baseFacts, warnings };
  }

  const acceptedDecision: ProjectBriefExtractedItem = {
    text: title,
    provenance: provenanceFor(input, title, titleSection.headingLineOffset),
  };

  const consequencesSection = findSection(sections, CONSEQUENCES_HEADING);
  const consequences = consequencesSection ? extractBoundedBulletItems(consequencesSection, input, warnings) : [];
  // Same section, re-scanned for the literal "Next action:" per-item label
  // only -- a consequence is not automatically an action, and this is the
  // one explicit signal that promotes a specific bullet into an action.
  const nextActions = consequencesSection ? extractLabeledActionItems(consequencesSection, input, warnings) : [];

  const deferredSection = findSection(sections, DEFERRED_DECISIONS_HEADING);
  const deferredDecisions = deferredSection ? extractBoundedBulletItems(deferredSection, input, warnings) : [];

  return { facts: { ...baseFacts, acceptedDecision, consequences, nextActions, deferredDecisions }, warnings };
}
