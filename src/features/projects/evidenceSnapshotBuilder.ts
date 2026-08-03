// SmartFlow -- Context Rebuild Foundation.
//
// Deterministic evidence snapshot construction: a trusted, already owner/
// project-scoped ProjectEvidence+ProjectEvidenceObservation pair list ->
// a reproducible EvidenceSnapshot, or a typed failure. No Supabase call, no
// clock read (snapshotCreatedAt is injected by the caller), no randomness
// beyond the same standard SHA-256 digest API projectEvidenceRepository.ts
// already uses for candidate_fingerprint/content_hash.
//
// Owns: deterministic ordering, explicit supersession exclusion, per-item
// structural re-validation (defense in depth against a corrupted stored
// row -- this module never trusts the database's own constraints blindly),
// and snapshot identity hashing. Never derives an objective, milestone,
// decision, capability, risk, or candidate action -- that remains
// exclusively ProjectContextBuilder's job
// (docs/architecture/project-domain.md section 7).

import { PROJECT_EVIDENCE_CLASSIFICATIONS, type ProjectEvidenceWithObservation } from "./projectEvidenceTypes";
import { PROJECT_EVIDENCE_OBSERVATION_TEXT_MIME_TYPES } from "./projectEvidenceObservationTypes";
import {
  EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
  type EvidenceSnapshot,
  type EvidenceSnapshotBuildIssue,
  type EvidenceSnapshotBuildResult,
  type EvidenceSnapshotItem,
} from "./evidenceSnapshotTypes";

const VALID_CLASSIFICATIONS = new Set<string>(PROJECT_EVIDENCE_CLASSIFICATIONS);
const VALID_MIME_TYPES = new Set<string>(PROJECT_EVIDENCE_OBSERVATION_TEXT_MIME_TYPES);
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The minimal, already-trusted ProjectRecord identity a snapshot is built against. */
export interface SnapshotProjectIdentity {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
}

function toSnapshotItem(pair: ProjectEvidenceWithObservation): EvidenceSnapshotItem {
  const item: EvidenceSnapshotItem = {
    evidenceId: pair.evidence.id,
    sourceKind: pair.evidence.sourceKind,
    classification: pair.evidence.classification,
    title: pair.evidence.title,
    reference: pair.evidence.reference,
    collectedAt: pair.evidence.collectedAt,
    adapterIdentity: pair.evidence.adapterIdentity,
    adapterVersion: pair.evidence.adapterVersion,
    verificationMethod: pair.evidence.verificationMethod,
    contentHash: pair.observation.contentHash,
    textContent: pair.observation.textContent,
    mimeType: pair.observation.mimeType,
    byteLength: pair.observation.byteLength,
  };
  if (pair.evidence.supersedesId) item.supersedesId = pair.evidence.supersedesId;
  if (pair.observation.gitRevision) item.gitRevision = pair.observation.gitRevision;
  return item;
}

/**
 * Excludes evidence explicitly superseded by another item in this same
 * trusted set -- never by timestamp, never by array order
 * (docs/architecture/project-evidence-acquisition.md section 18). Only a
 * supersession target actually present in this same pair list counts as a
 * valid exclusion; a `supersedesId` pointing outside it is not resolved
 * here. Conflicting, non-superseding evidence is always retained.
 */
function excludeSuperseded(pairs: readonly ProjectEvidenceWithObservation[]): {
  included: readonly ProjectEvidenceWithObservation[];
  excludedIds: readonly string[];
} {
  const presentIds = new Set(pairs.map((pair) => pair.evidence.id));
  const supersededIds = new Set<string>();
  for (const pair of pairs) {
    const supersedesId = pair.evidence.supersedesId;
    if (supersedesId && presentIds.has(supersedesId)) {
      supersededIds.add(supersedesId);
    }
  }
  const included = pairs.filter((pair) => !supersededIds.has(pair.evidence.id));
  return { included, excludedIds: [...supersededIds].sort() };
}

/**
 * One stable, total order: source kind, then reference, then collectedAt,
 * then evidence id as a final deterministic tie-breaker (evidence ids are
 * unique, so this always fully resolves). Never database return order.
 */
function compareSnapshotItems(a: EvidenceSnapshotItem, b: EvidenceSnapshotItem): number {
  if (a.sourceKind !== b.sourceKind) return a.sourceKind < b.sourceKind ? -1 : 1;
  if (a.reference !== b.reference) return a.reference < b.reference ? -1 : 1;
  if (a.collectedAt !== b.collectedAt) return a.collectedAt < b.collectedAt ? -1 : 1;
  if (a.evidenceId === b.evidenceId) return 0;
  return a.evidenceId < b.evidenceId ? -1 : 1;
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Standard SHA-256 crypto API is unavailable.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Deterministic identity over exactly the fields that identify "this
 * snapshot": project id, ProjectRecord version, the ordered evidence ids
 * with their content hashes and supersession references, the excluded-
 * superseded id set, and a schema/canonicalization version. Deliberately
 * excludes `collectedAt` and every other provenance-only field -- two
 * snapshots covering the exact same evidence rows hash identically
 * regardless of collection time, mirroring the same content-identity
 * lesson ADR-0007 already applied to `candidate_fingerprint` (a wall-clock
 * difference alone must never change identity). Always computed over the
 * already-deterministically-sorted item list, never database return order.
 */
async function computeSnapshotHash(
  identity: SnapshotProjectIdentity,
  sortedItems: readonly EvidenceSnapshotItem[],
  excludedIds: readonly string[],
): Promise<string> {
  const canonical = JSON.stringify([
    EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
    identity.id,
    identity.version,
    sortedItems.map((item) => [item.evidenceId, item.contentHash, item.supersedesId ?? null]),
    excludedIds,
  ]);
  return sha256Hex(canonical);
}

/**
 * Builds a deterministic EvidenceSnapshot from an already owner/project-
 * scoped evidence+observation pair list, or a typed failure. `pairs` must
 * include superseded items (callers should read with
 * `includeSuperseded: true`) -- this function performs its own explicit
 * supersession exclusion so the result can record *why* an item was
 * excluded, not just silently drop it.
 */
export async function buildEvidenceSnapshot(
  project: SnapshotProjectIdentity,
  pairs: readonly ProjectEvidenceWithObservation[],
  snapshotCreatedAt: string,
): Promise<EvidenceSnapshotBuildResult> {
  const issues: EvidenceSnapshotBuildIssue[] = [];
  const seenIds = new Set<string>();

  for (const pair of pairs) {
    const { evidence, observation } = pair;

    // Defense in depth only -- the repository call that produced `pairs` is
    // already owner/project-scoped, so this should be structurally
    // unreachable. A snapshot must never silently include a row from
    // outside the trusted scope it claims to represent.
    if (evidence.projectId !== project.id || evidence.ownerId !== project.ownerId) {
      issues.push({
        code: "SNAPSHOT_VALIDATION_FAILED",
        message: `Evidence ${evidence.id} does not belong to the resolved owner/project scope.`,
        evidenceId: evidence.id,
      });
      continue;
    }
    if (seenIds.has(evidence.id)) {
      issues.push({
        code: "SNAPSHOT_VALIDATION_FAILED",
        message: `Duplicate evidence id in snapshot input: ${evidence.id}.`,
        evidenceId: evidence.id,
      });
      continue;
    }
    seenIds.add(evidence.id);

    if (evidence.supersedesId === evidence.id) {
      issues.push({
        code: "SNAPSHOT_VALIDATION_FAILED",
        message: `Evidence ${evidence.id} cannot supersede itself.`,
        evidenceId: evidence.id,
      });
    }
    if (!VALID_CLASSIFICATIONS.has(evidence.classification)) {
      issues.push({
        code: "UNSUPPORTED_EVIDENCE_CLASSIFICATION",
        message: `Evidence ${evidence.id} has an unsupported classification: ${String(evidence.classification)}.`,
        evidenceId: evidence.id,
      });
    }
    if (observation.textContent.length === 0) {
      issues.push({
        code: "MALFORMED_OBSERVATION",
        message: `Evidence ${evidence.id}'s observation has empty text content.`,
        evidenceId: evidence.id,
      });
    }
    if (!VALID_MIME_TYPES.has(observation.mimeType)) {
      issues.push({
        code: "MALFORMED_OBSERVATION",
        message: `Evidence ${evidence.id}'s observation has an unsupported MIME type.`,
        evidenceId: evidence.id,
      });
    }
    if (!CONTENT_HASH_PATTERN.test(observation.contentHash)) {
      issues.push({
        code: "MALFORMED_OBSERVATION",
        message: `Evidence ${evidence.id}'s observation content hash is not a valid lowercase SHA-256 hex digest.`,
        evidenceId: evidence.id,
      });
    }
    const actualByteLength = new TextEncoder().encode(observation.textContent).length;
    if (observation.byteLength !== actualByteLength) {
      issues.push({
        code: "MALFORMED_OBSERVATION",
        message: `Evidence ${evidence.id}'s observation byteLength does not match its actual encoded text length.`,
        evidenceId: evidence.id,
      });
    }
  }

  if (issues.length > 0) {
    return { valid: false, errors: issues };
  }

  const { included, excludedIds } = excludeSuperseded(pairs);
  const items = included.map(toSnapshotItem).sort(compareSnapshotItems);
  const snapshotHash = await computeSnapshotHash(project, items, excludedIds);

  const snapshot: EvidenceSnapshot = {
    schemaVersion: EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
    projectId: project.id,
    ownerId: project.ownerId,
    projectRecordVersion: project.version,
    snapshotCreatedAt,
    items,
    excludedSupersededEvidenceIds: excludedIds,
    snapshotHash,
  };
  return { valid: true, snapshot };
}
