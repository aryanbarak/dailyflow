// SmartFlow -- ProjectEvidence Foundation (Slice 4B) and Observation
// Foundation (ADR-0007).
//
// Orchestration layer: resolves the trusted authenticated owner, validates
// input (projectEvidenceValidation.ts, which now also validates the
// mandatory observation payload via projectEvidenceObservationValidation.ts),
// verifies the owning ProjectRecord, and calls the atomic persistence
// boundary (projectEvidenceRepository.ts), translating every failure into a
// typed `ProjectEvidenceError`. This module never accepts an owner id from a
// caller-supplied argument or input payload -- it resolves one itself from
// the Supabase Auth session, exactly like `projectRecordService.ts`'s
// existing convention.
//
// This module is the ProjectEvidence Acquisition Service's persistence-and-
// validation half only (docs/architecture/project-evidence-acquisition.md
// section 9), with no live Evidence Source Adapter behind it in this slice:
// callers submit an already-formed evidence-and-observation candidate (as
// the Repository Documents Adapter now does), and this module validates,
// verifies, and durably stores it atomically. It never reads a real source,
// never calls `ProjectContextBuilder`, never resolves an evidence conflict,
// and never touches policy, approval, execution, Smart Automation, or an
// LLM.

import { supabase } from "@/integrations/supabase/client";
import {
  ProjectEvidenceError,
  type CreateProjectEvidenceInput,
  type CreateProjectEvidenceResult,
  type ListProjectEvidenceOptions,
  type ProjectEvidenceWithObservation,
} from "./projectEvidenceTypes";
import { validateCreateProjectEvidenceInput } from "./projectEvidenceValidation";
import {
  ProjectEvidenceConflictError,
  ProjectEvidencePersistenceError,
  ProjectEvidenceTransactionError,
  projectEvidenceRepository,
  type ProjectEvidenceRepository,
} from "./projectEvidenceRepository";
import { projectRecordRepository, type ProjectRecordRepository } from "./projectRecordRepository";

/** Resolves the current trusted authenticated user id, or `null` when unauthenticated. Never derived from request input, localStorage, or component state. */
export type OwnerIdResolver = () => Promise<string | null>;

async function resolveOwnerIdFromSupabaseAuth(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export interface ProjectEvidenceServiceDependencies {
  repository?: ProjectEvidenceRepository;
  /** The ProjectRecord repository used only to load and verify project ownership/status/enabled evidence sources -- this module never writes through it. */
  projectRepository?: ProjectRecordRepository;
  resolveOwnerId?: OwnerIdResolver;
}

/** The `create_project_evidence_with_observation` transaction's own typed codes map 1:1 onto existing `ProjectEvidenceErrorCode` values -- the function replicates the identical checks this service already performs, as defense in depth. */
const TRANSACTION_ERROR_MAP: Record<string, ProjectEvidenceError["code"] | undefined> = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  PROJECT_ARCHIVED: "PROJECT_ARCHIVED",
  SOURCE_KIND_NOT_ENABLED: "SOURCE_KIND_NOT_ENABLED",
  SUPERSEDED_EVIDENCE_NOT_FOUND: "SUPERSEDED_EVIDENCE_NOT_FOUND",
};

function toProjectEvidenceError(error: unknown, fallbackMessage: string): ProjectEvidenceError {
  if (error instanceof ProjectEvidenceError) return error;
  if (error instanceof ProjectEvidenceTransactionError) {
    const code = TRANSACTION_ERROR_MAP[error.code];
    if (code) return new ProjectEvidenceError(code, fallbackMessage);
    return new ProjectEvidenceError("PERSISTENCE_FAILED", fallbackMessage);
  }
  if (error instanceof ProjectEvidenceConflictError) {
    return new ProjectEvidenceError("DUPLICATE_EVIDENCE", error.message);
  }
  if (error instanceof ProjectEvidencePersistenceError) {
    return new ProjectEvidenceError("PERSISTENCE_FAILED", fallbackMessage);
  }
  return new ProjectEvidenceError("PERSISTENCE_FAILED", fallbackMessage);
}

export interface ProjectEvidenceService {
  create(input: unknown): Promise<CreateProjectEvidenceResult>;
  getById(id: string): Promise<ProjectEvidenceWithObservation>;
  listByProject(projectId: string, options?: ListProjectEvidenceOptions): Promise<ProjectEvidenceWithObservation[]>;
}

export function createProjectEvidenceService(
  dependencies: ProjectEvidenceServiceDependencies = {},
): ProjectEvidenceService {
  const repository = dependencies.repository ?? projectEvidenceRepository;
  const projectRepository = dependencies.projectRepository ?? projectRecordRepository;
  const resolveOwnerId = dependencies.resolveOwnerId ?? resolveOwnerIdFromSupabaseAuth;

  async function requireOwnerId(): Promise<string> {
    const ownerId = await resolveOwnerId();
    if (!ownerId) {
      throw new ProjectEvidenceError("UNAUTHENTICATED", "You must be signed in to manage project evidence.");
    }
    return ownerId;
  }

  return {
    async create(input: unknown): Promise<CreateProjectEvidenceResult> {
      const ownerId = await requireOwnerId();

      let validation: ReturnType<typeof validateCreateProjectEvidenceInput>;
      try {
        validation = validateCreateProjectEvidenceInput(input);
      } catch {
        // A property access inside the validator (e.g. a throwing getter on
        // the input object, including a nested getter on `observation`)
        // must still surface as a typed validation failure, never as a raw,
        // untyped exception.
        throw new ProjectEvidenceError("INVALID_INPUT", "Project evidence input is invalid.");
      }
      if (validation.valid === false) {
        throw new ProjectEvidenceError("INVALID_INPUT", "Project evidence input is invalid.", validation.errors);
      }
      const value = validation.value;

      let project;
      try {
        project = await projectRepository.findById(ownerId, value.projectId);
      } catch (error) {
        throw toProjectEvidenceError(error, "Unable to load the owning project.");
      }
      if (!project) {
        throw new ProjectEvidenceError("PROJECT_NOT_FOUND", "Project was not found for this user.");
      }
      // Archived projects are explicitly rejected for new evidence creation,
      // not silently allowed: an archived project is no longer under active
      // configuration attention, and this slice has no canonical-architecture
      // reason to let evidence keep accumulating against it. This does not
      // affect reading evidence already collected before archival -- reads
      // remain unrestricted by project lifecycle state.
      if (project.status === "archived") {
        throw new ProjectEvidenceError("PROJECT_ARCHIVED", "Cannot record evidence for an archived project.");
      }
      if (!project.enabledEvidenceSourceKinds.includes(value.sourceKind)) {
        throw new ProjectEvidenceError(
          "SOURCE_KIND_NOT_ENABLED",
          "This evidence source kind is not enabled on the project's configuration.",
        );
      }

      if (value.supersedesId !== undefined) {
        let superseded: ProjectEvidenceWithObservation | null;
        try {
          superseded = await repository.findById(ownerId, value.supersedesId);
        } catch (error) {
          throw toProjectEvidenceError(error, "Unable to verify the superseded evidence record.");
        }
        // Deliberately the same error whether the id does not exist at all,
        // belongs to another owner (findById is already owner-scoped), or
        // belongs to a different project -- never disclosing which case it
        // is, mirroring ProjectRecordError's NOT_FOUND non-disclosure
        // convention. Self-reference and supersession cycles are
        // structurally impossible here: `id` is server-generated only after
        // this check completes, so no candidate can ever reference itself or
        // a record that does not yet exist.
        if (!superseded || superseded.evidence.projectId !== value.projectId) {
          throw new ProjectEvidenceError(
            "SUPERSEDED_EVIDENCE_NOT_FOUND",
            "The referenced superseded evidence record was not found for this project.",
          );
        }
      }

      // The atomic create_project_evidence_with_observation transaction
      // (ADR-0007) re-verifies ownership/project/archive/enabled-kind/
      // supersession itself, as defense in depth -- exactly as the removed
      // direct-INSERT RLS policy used to. This service's own checks above
      // are not redundant scaffolding: they let a rejected create fail fast
      // with a typed error before any database round trip for the common
      // cases, and they preserve this service's existing, already-tested
      // error contract regardless of how the persistence layer enforces it.
      try {
        return await repository.insert(ownerId, value.projectId, value);
      } catch (error) {
        throw toProjectEvidenceError(error, "Unable to create project evidence.");
      }
    },

    async getById(id: string): Promise<ProjectEvidenceWithObservation> {
      const ownerId = await requireOwnerId();
      let record: ProjectEvidenceWithObservation | null;
      try {
        record = await repository.findById(ownerId, id);
      } catch (error) {
        throw toProjectEvidenceError(error, "Unable to load project evidence.");
      }
      if (!record) {
        throw new ProjectEvidenceError("NOT_FOUND", "Project evidence was not found for this user.");
      }
      return record;
    },

    async listByProject(
      projectId: string,
      options: ListProjectEvidenceOptions = {},
    ): Promise<ProjectEvidenceWithObservation[]> {
      const ownerId = await requireOwnerId();

      let project;
      try {
        project = await projectRepository.findById(ownerId, projectId);
      } catch (error) {
        throw toProjectEvidenceError(error, "Unable to load the owning project.");
      }
      // Same non-disclosure convention as `create`: a project that does not
      // exist and a project owned by someone else produce the identical
      // error. Archived-project reads are explicitly allowed -- evidence
      // already collected remains visible regardless of project lifecycle
      // state; only creation is blocked for an archived project.
      if (!project) {
        throw new ProjectEvidenceError("PROJECT_NOT_FOUND", "Project was not found for this user.");
      }

      try {
        return await repository.listByProject(ownerId, projectId, {
          includeSuperseded: options.includeSuperseded ?? false,
        });
      } catch (error) {
        throw toProjectEvidenceError(error, "Unable to list project evidence.");
      }
    },
  };
}

/** Production singleton, backed by the real Supabase repositories and Supabase Auth session. */
export const projectEvidenceService = createProjectEvidenceService();

export type { CreateProjectEvidenceInput };
