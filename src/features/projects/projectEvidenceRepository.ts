// SmartFlow -- ProjectEvidence Foundation (Slice 4B) and Observation
// Foundation (ADR-0007).
//
// The persistence boundary. `ProjectEvidenceRepository` is an explicit,
// strongly-typed interface so `projectEvidenceService.ts` depends on a
// contract, not a concrete Supabase client, and can be exercised in tests
// with an in-memory fake. `createSupabaseProjectEvidenceRepository` is the
// only concrete implementation; `projectEvidenceRepository` is the
// production singleton built from it.
//
// This module owns every raw `user_id`/snake_case detail. Nothing above it
// (service or any future caller) ever sees a Supabase row or Database type.
//
// There is no `update` or `delete` method on this interface at all --
// ProjectEvidence and ProjectEvidenceObservation are both immutable once
// created (project-evidence-acquisition.md section 14; ADR-0007). A
// correction or newer observation is always a new `insert`, never a
// mutation of an existing row.
//
// `insert` calls the `create_project_evidence_with_observation` Postgres
// function (ADR-0007), never a plain, direct table-level create call --
// the database no longer grants `authenticated` a direct INSERT on either
// table (see the accompanying migration), so a bare table insert would
// simply fail with a permission error. The function performs the atomic
// evidence+observation write and returns both rows, or the existing pair
// when the content-hash-based candidate fingerprint already exists.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { CreateProjectEvidenceResult, NormalizedCreateProjectEvidenceInput, ProjectEvidence } from "./projectEvidenceTypes";
import type { ProjectEvidenceObservation } from "./projectEvidenceObservationTypes";
import type { ProjectSourceKind } from "./projectContextTypes";

type ProjectEvidenceRow = Database["public"]["Tables"]["project_evidence"]["Row"];
type ProjectEvidenceObservationRow = Database["public"]["Tables"]["project_evidence_observations"]["Row"];

const PROJECT_EVIDENCE_SELECT_COLUMNS =
  "id,user_id,project_id,source_kind,classification,title,reference,collected_at,adapter_identity,adapter_version,verification_method,source_revision,confidence,uncertainty,notes,supersedes_id,acquisition_attempt_id,created_at";

const PROJECT_EVIDENCE_OBSERVATION_SELECT_COLUMNS =
  "id,evidence_id,user_id,project_id,payload_kind,text_content,mime_type,byte_length,content_hash,git_revision,created_at";

/** Postgres unique_violation. Kept for defense in depth even though the RPC now handles the content-hash-based conflict internally and never lets this surface as a raw Postgres error for that specific case. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

export class ProjectEvidenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectEvidenceConflictError";
  }
}

export class ProjectEvidencePersistenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ProjectEvidencePersistenceError";
  }
}

/** Raised only when the atomic RPC itself reports a typed failure (e.g. `PROJECT_ARCHIVED`) via its raised exception message -- mapped from the RPC's plain `raise exception '<CODE>'` text. */
export class ProjectEvidenceTransactionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProjectEvidenceTransactionError";
  }
}

function mapRowToProjectEvidence(row: ProjectEvidenceRow): ProjectEvidence {
  const evidence: ProjectEvidence = {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.user_id,
    sourceKind: row.source_kind as ProjectSourceKind,
    classification: row.classification as ProjectEvidence["classification"],
    title: row.title,
    reference: row.reference,
    collectedAt: row.collected_at,
    adapterIdentity: row.adapter_identity,
    adapterVersion: row.adapter_version,
    verificationMethod: row.verification_method,
    createdAt: row.created_at,
  };
  if (row.source_revision) evidence.sourceRevision = row.source_revision;
  if (row.confidence !== null && row.confidence !== undefined) evidence.confidence = row.confidence;
  if (row.uncertainty) evidence.uncertainty = row.uncertainty;
  if (row.notes) evidence.notes = row.notes;
  if (row.supersedes_id) evidence.supersedesId = row.supersedes_id;
  if (row.acquisition_attempt_id) evidence.acquisitionAttemptId = row.acquisition_attempt_id;
  return evidence;
}

function mapRowToProjectEvidenceObservation(row: ProjectEvidenceObservationRow): ProjectEvidenceObservation {
  const observation: ProjectEvidenceObservation = {
    id: row.id,
    evidenceId: row.evidence_id,
    projectId: row.project_id,
    ownerId: row.user_id,
    payloadKind: "text",
    textContent: row.text_content,
    mimeType: row.mime_type as ProjectEvidenceObservation["mimeType"],
    byteLength: row.byte_length,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
  if (row.git_revision) observation.gitRevision = row.git_revision;
  return observation;
}

function isPostgrestUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

/** Typed codes the `create_project_evidence_with_observation` function raises via a plain `raise exception '<CODE>'` -- see the ADR-0007 migration. `EVIDENCE_CONFLICT_LOOKUP_FAILED` and `EVIDENCE_MISSING_OBSERVATION` are the function's own fail-closed guards against an unresolvable fingerprint collision (the row a unique_violation says must exist is not found, or exists without its paired observation) -- both indicate a database-level inconsistency, never a normal outcome. */
const TRANSACTION_ERROR_CODES = new Set([
  "UNAUTHENTICATED",
  "PROJECT_NOT_FOUND",
  "PROJECT_ARCHIVED",
  "SOURCE_KIND_NOT_ENABLED",
  "SUPERSEDED_EVIDENCE_NOT_FOUND",
  "EVIDENCE_CONFLICT_LOOKUP_FAILED",
  "EVIDENCE_MISSING_OBSERVATION",
]);

function extractTransactionErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  // PostgREST surfaces a plpgsql `raise exception 'X'` as an error whose
  // `message` is exactly "X" (no additional wrapping text in the common
  // case); matching on the whole trimmed message, rather than a substring,
  // avoids ever accidentally matching a code name that merely appears
  // inside a longer, unrelated Postgres error message.
  const trimmed = message.trim();
  return TRANSACTION_ERROR_CODES.has(trimmed) ? trimmed : null;
}

/**
 * A stable digest over exactly the fields that identify "the same exact
 * evidence candidate": which project, which source kind, which reference,
 * which exact content, by which adapter/version. Deliberately excludes
 * `collectedAt` (ADR-0007) -- unlike the original Slice 4B formula, this
 * uses the observation's content hash instead of the acquisition timestamp,
 * so two acquisitions of byte-identical content always collide on the same
 * fingerprint regardless of when each ran, closing the concurrency gap a
 * `collectedAt`-based formula left open. A *changed* content hash, or a
 * different reference, always produces a different fingerprint, so a
 * legitimate re-observation of changed content is never blocked. This is
 * Slice-local duplicate-prevention, not a canonical identity scheme, and is
 * reimplemented locally here rather than imported from `src/features/agent/*`,
 * exactly as `projectContextBuilder.ts` already reimplements its own safety
 * scanner locally rather than importing across that same boundary.
 */
async function computeCandidateFingerprint(
  projectId: string,
  input: Pick<NormalizedCreateProjectEvidenceInput, "sourceKind" | "reference" | "adapterIdentity" | "adapterVersion">,
  contentHash: string,
): Promise<string> {
  const canonical = JSON.stringify([projectId, input.sourceKind, input.reference, contentHash, input.adapterIdentity, input.adapterVersion]);
  if (!globalThis.crypto?.subtle) {
    throw new ProjectEvidencePersistenceError("Standard SHA-256 crypto API is unavailable.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ProjectEvidencePersistenceError("Standard SHA-256 crypto API is unavailable.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface ProjectEvidenceRepository {
  /** Atomically creates a ProjectEvidence row and its ProjectEvidenceObservation, or returns the existing pair for an unchanged, content-hash-identical re-acquisition. Never creates one without the other. */
  insert(ownerId: string, projectId: string, input: NormalizedCreateProjectEvidenceInput): Promise<CreateProjectEvidenceResult>;
  findById(ownerId: string, id: string): Promise<{ evidence: ProjectEvidence; observation: ProjectEvidenceObservation } | null>;
  listByProject(
    ownerId: string,
    projectId: string,
    options: { includeSuperseded: boolean },
  ): Promise<Array<{ evidence: ProjectEvidence; observation: ProjectEvidenceObservation }>>;
}

async function fetchObservationsByEvidenceIds(
  evidenceIds: readonly string[],
): Promise<Map<string, ProjectEvidenceObservation>> {
  if (evidenceIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("project_evidence_observations")
    .select(PROJECT_EVIDENCE_OBSERVATION_SELECT_COLUMNS)
    .in("evidence_id", evidenceIds);

  if (error) {
    throw new ProjectEvidencePersistenceError("Unable to load project evidence observations.", error);
  }
  const rows = (data ?? []) as ProjectEvidenceObservationRow[];
  const byEvidenceId = new Map<string, ProjectEvidenceObservation>();
  for (const row of rows) {
    byEvidenceId.set(row.evidence_id, mapRowToProjectEvidenceObservation(row));
  }
  return byEvidenceId;
}

export function createSupabaseProjectEvidenceRepository(): ProjectEvidenceRepository {
  return {
    async insert(_ownerId, projectId, input) {
      const contentHash = await sha256Hex(input.observation.textContent);
      const candidateFingerprint = await computeCandidateFingerprint(projectId, input, contentHash);

      const { data, error } = await supabase.rpc("create_project_evidence_with_observation", {
        p_project_id: projectId,
        p_source_kind: input.sourceKind,
        p_classification: input.classification,
        p_title: input.title,
        p_reference: input.reference,
        p_collected_at: input.collectedAt,
        p_adapter_identity: input.adapterIdentity,
        p_adapter_version: input.adapterVersion,
        p_verification_method: input.verificationMethod,
        p_candidate_fingerprint: candidateFingerprint,
        p_text_content: input.observation.textContent,
        p_mime_type: input.observation.mimeType,
        p_byte_length: input.observation.byteLength,
        p_content_hash: contentHash,
        p_git_revision: input.observation.gitRevision ?? null,
        p_source_revision: input.sourceRevision ?? null,
        p_confidence: input.confidence ?? null,
        p_uncertainty: input.uncertainty ?? null,
        p_notes: input.notes ?? null,
        p_supersedes_id: input.supersedesId ?? null,
        p_acquisition_attempt_id: input.acquisitionAttemptId ?? null,
      });

      if (error) {
        const transactionCode = extractTransactionErrorCode(error);
        if (transactionCode) {
          throw new ProjectEvidenceTransactionError(transactionCode, "The evidence transaction was rejected.");
        }
        if (isPostgrestUniqueViolation(error)) {
          throw new ProjectEvidenceConflictError("This exact evidence candidate has already been recorded.");
        }
        throw new ProjectEvidencePersistenceError("Unable to create project evidence.", error);
      }

      const result = data as { outcome?: "created" | "unchanged"; evidence?: ProjectEvidenceRow | null; observation?: ProjectEvidenceObservationRow | null };
      // Defense in depth against a malformed or incomplete RPC response --
      // the function itself now fails closed (raises EVIDENCE_CONFLICT_
      // LOOKUP_FAILED / EVIDENCE_MISSING_OBSERVATION) rather than ever
      // returning a null-filled pair, but this repository never trusts
      // that guarantee blindly: a response missing either row's `id`,
      // however it could arise, is treated as a persistence failure, never
      // silently mapped into a domain object with missing/undefined
      // fields.
      if (
        (result.outcome !== "created" && result.outcome !== "unchanged") ||
        !result.evidence ||
        !result.evidence.id ||
        !result.observation ||
        !result.observation.id
      ) {
        throw new ProjectEvidencePersistenceError("The evidence transaction returned an incomplete result.");
      }
      return {
        outcome: result.outcome,
        evidence: mapRowToProjectEvidence(result.evidence),
        observation: mapRowToProjectEvidenceObservation(result.observation),
      };
    },

    async findById(ownerId, id) {
      const { data, error } = await supabase
        .from("project_evidence")
        .select(PROJECT_EVIDENCE_SELECT_COLUMNS)
        .eq("id", id)
        .eq("user_id", ownerId)
        .maybeSingle();

      if (error) {
        throw new ProjectEvidencePersistenceError("Unable to load project evidence.", error);
      }
      if (!data) return null;

      const evidenceRow = data as ProjectEvidenceRow;
      const observations = await fetchObservationsByEvidenceIds([evidenceRow.id]);
      const observation = observations.get(evidenceRow.id);
      if (!observation) {
        // Every ProjectEvidence row is created atomically with its
        // observation (ADR-0007); a missing observation for an existing
        // evidence row means the paired read is inconsistent, never a
        // legitimate "metadata-only" evidence state.
        throw new ProjectEvidencePersistenceError("Project evidence is missing its required observation.");
      }
      return { evidence: mapRowToProjectEvidence(evidenceRow), observation };
    },

    async listByProject(ownerId, projectId, options) {
      const query = supabase
        .from("project_evidence")
        .select(PROJECT_EVIDENCE_SELECT_COLUMNS)
        .eq("user_id", ownerId)
        .eq("project_id", projectId);

      const { data, error } = await query.order("collected_at", { ascending: false });

      if (error) {
        throw new ProjectEvidencePersistenceError("Unable to list project evidence.", error);
      }
      const rows = (data ?? []) as ProjectEvidenceRow[];
      let filteredRows = rows;
      if (!options.includeSuperseded) {
        const supersededIds = new Set(rows.map((row) => row.supersedes_id).filter((sid): sid is string => Boolean(sid)));
        filteredRows = rows.filter((row) => !supersededIds.has(row.id));
      }

      const observations = await fetchObservationsByEvidenceIds(filteredRows.map((row) => row.id));
      return filteredRows.map((row) => {
        const observation = observations.get(row.id);
        if (!observation) {
          throw new ProjectEvidencePersistenceError("Project evidence is missing its required observation.");
        }
        return { evidence: mapRowToProjectEvidence(row), observation };
      });
    },
  };
}

/** Production singleton. Tests inject their own fake `ProjectEvidenceRepository` into `createProjectEvidenceService` instead of using this. */
export const projectEvidenceRepository = createSupabaseProjectEvidenceRepository();
