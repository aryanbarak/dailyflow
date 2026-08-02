// SmartFlow Slice 4B -- ProjectEvidence Foundation.
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
// ProjectEvidence is immutable once created
// (project-evidence-acquisition.md section 14). A correction or newer
// observation is always a new `insert`, never a mutation of an existing row.

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { NormalizedCreateProjectEvidenceInput, ProjectEvidence } from "./projectEvidenceTypes";
import type { ProjectSourceKind } from "./projectContextTypes";

type ProjectEvidenceRow = Database["public"]["Tables"]["project_evidence"]["Row"];

const PROJECT_EVIDENCE_SELECT_COLUMNS =
  "id,user_id,project_id,source_kind,classification,title,reference,collected_at,adapter_identity,adapter_version,verification_method,source_revision,confidence,uncertainty,notes,supersedes_id,acquisition_attempt_id,created_at";

/** Postgres unique_violation. See project_evidence_candidate_fingerprint_key in the Slice 4B migration. */
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

function isPostgrestUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

/**
 * A stable digest over exactly the fields that identify "the same exact
 * evidence candidate": which project, which source kind, which reference,
 * observed at which moment, by which adapter/version. Two acquisition
 * attempts that legitimately re-observe the same source at a different time
 * produce a different fingerprint (a different `collectedAt`), so
 * re-observation is never blocked -- only an exact, unintentional
 * resubmission of the identical candidate is. This is Slice-local
 * duplicate-prevention, not a canonical identity scheme; the underlying
 * hashing approach mirrors the existing GitHub code-proposal-ID precedent
 * (execution-intent.md section 6) but is reimplemented locally here rather
 * than imported from `src/features/agent/*`, exactly as
 * projectContextBuilder.ts already reimplements its own safety scanner
 * locally rather than importing across that same boundary.
 */
async function computeCandidateFingerprint(
  projectId: string,
  input: Pick<NormalizedCreateProjectEvidenceInput, "sourceKind" | "reference" | "collectedAt" | "adapterIdentity" | "adapterVersion">,
): Promise<string> {
  const canonical = JSON.stringify([projectId, input.sourceKind, input.reference, input.collectedAt, input.adapterIdentity, input.adapterVersion]);
  if (!globalThis.crypto?.subtle) {
    throw new ProjectEvidencePersistenceError("Standard SHA-256 crypto API is unavailable.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface ProjectEvidenceRepository {
  insert(ownerId: string, projectId: string, input: NormalizedCreateProjectEvidenceInput): Promise<ProjectEvidence>;
  findById(ownerId: string, id: string): Promise<ProjectEvidence | null>;
  listByProject(
    ownerId: string,
    projectId: string,
    options: { includeSuperseded: boolean },
  ): Promise<ProjectEvidence[]>;
}

export function createSupabaseProjectEvidenceRepository(): ProjectEvidenceRepository {
  return {
    async insert(ownerId, projectId, input) {
      const candidateFingerprint = await computeCandidateFingerprint(projectId, input);

      const patch: Database["public"]["Tables"]["project_evidence"]["Insert"] = {
        user_id: ownerId,
        project_id: projectId,
        source_kind: input.sourceKind,
        classification: input.classification,
        title: input.title,
        reference: input.reference,
        collected_at: input.collectedAt,
        adapter_identity: input.adapterIdentity,
        adapter_version: input.adapterVersion,
        verification_method: input.verificationMethod,
        source_revision: input.sourceRevision ?? null,
        confidence: input.confidence ?? null,
        uncertainty: input.uncertainty ?? null,
        notes: input.notes ?? null,
        supersedes_id: input.supersedesId ?? null,
        acquisition_attempt_id: input.acquisitionAttemptId ?? null,
        candidate_fingerprint: candidateFingerprint,
      };

      const { data, error } = await supabase
        .from("project_evidence")
        .insert(patch)
        .select(PROJECT_EVIDENCE_SELECT_COLUMNS)
        .single();

      if (error) {
        if (isPostgrestUniqueViolation(error)) {
          throw new ProjectEvidenceConflictError("This exact evidence candidate has already been recorded.");
        }
        throw new ProjectEvidencePersistenceError("Unable to create project evidence.", error);
      }
      return mapRowToProjectEvidence(data as ProjectEvidenceRow);
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
      return data ? mapRowToProjectEvidence(data as ProjectEvidenceRow) : null;
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
      if (options.includeSuperseded) {
        return rows.map(mapRowToProjectEvidence);
      }
      const supersededIds = new Set(rows.map((row) => row.supersedes_id).filter((id): id is string => Boolean(id)));
      return rows.filter((row) => !supersededIds.has(row.id)).map(mapRowToProjectEvidence);
    },
  };
}

/** Production singleton. Tests inject their own fake `ProjectEvidenceRepository` into `createProjectEvidenceService` instead of using this. */
export const projectEvidenceRepository = createSupabaseProjectEvidenceRepository();
