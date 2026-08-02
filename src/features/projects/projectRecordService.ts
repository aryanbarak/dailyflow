// SmartFlow Slice 3 -- ProjectRecord Foundation.
//
// Orchestration layer: resolves the trusted authenticated owner, validates
// input (projectRecordValidation.ts), and calls the persistence boundary
// (projectRecordRepository.ts), translating every failure into a typed
// `ProjectRecordError`. This module never accepts an owner id from a
// caller-supplied argument or input payload -- it resolves one itself from
// the Supabase Auth session, exactly like `journalService.ts`'s existing
// convention, so a spoofed owner id is not merely rejected by validation but
// structurally has no code path to reach a write at all.
//
// This module creates no execution intent, requests no approval, and calls
// no tool. See docs/architecture/execution-intent.md and
// docs/architecture/authority-model.md: a project record is configuration,
// never execution authority.

import { supabase } from "@/integrations/supabase/client";
import {
  ProjectRecordError,
  type CreateProjectRecordInput,
  type ListProjectRecordsOptions,
  type ProjectRecord,
  type UpdateProjectRecordInput,
} from "./projectRecordTypes";
import { validateCreateProjectRecordInput, validateUpdateProjectRecordInput } from "./projectRecordValidation";
import {
  ProjectRecordConflictError,
  ProjectRecordPersistenceError,
  projectRecordRepository,
  type ProjectRecordRepository,
} from "./projectRecordRepository";

/** Resolves the current trusted authenticated user id, or `null` when unauthenticated. Never derived from request input, localStorage, or component state. */
export type OwnerIdResolver = () => Promise<string | null>;

async function resolveOwnerIdFromSupabaseAuth(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export interface ProjectRecordServiceDependencies {
  repository?: ProjectRecordRepository;
  resolveOwnerId?: OwnerIdResolver;
}

function toProjectRecordError(error: unknown, fallbackMessage: string): ProjectRecordError {
  if (error instanceof ProjectRecordError) return error;
  if (error instanceof ProjectRecordConflictError) {
    return new ProjectRecordError("DUPLICATE_REPOSITORY_BINDING", error.message);
  }
  if (error instanceof ProjectRecordPersistenceError) {
    return new ProjectRecordError("PERSISTENCE_FAILED", fallbackMessage);
  }
  return new ProjectRecordError("PERSISTENCE_FAILED", fallbackMessage);
}

export interface ProjectRecordService {
  create(input: unknown): Promise<ProjectRecord>;
  getById(id: string): Promise<ProjectRecord>;
  list(options?: ListProjectRecordsOptions): Promise<ProjectRecord[]>;
  update(id: string, input: unknown): Promise<ProjectRecord>;
  archive(id: string): Promise<ProjectRecord>;
}

export function createProjectRecordService(
  dependencies: ProjectRecordServiceDependencies = {},
): ProjectRecordService {
  const repository = dependencies.repository ?? projectRecordRepository;
  const resolveOwnerId = dependencies.resolveOwnerId ?? resolveOwnerIdFromSupabaseAuth;

  async function requireOwnerId(): Promise<string> {
    const ownerId = await resolveOwnerId();
    if (!ownerId) {
      throw new ProjectRecordError("UNAUTHENTICATED", "You must be signed in to manage projects.");
    }
    return ownerId;
  }

  return {
    async create(input: unknown): Promise<ProjectRecord> {
      const ownerId = await requireOwnerId();
      let validation: ReturnType<typeof validateCreateProjectRecordInput>;
      try {
        validation = validateCreateProjectRecordInput(input);
      } catch {
        // A property access inside the validator (e.g. a throwing getter on
        // the input object) must still surface as a typed validation
        // failure, never as a raw, untyped exception.
        throw new ProjectRecordError("INVALID_INPUT", "Project record input is invalid.");
      }
      if (validation.valid === false) {
        throw new ProjectRecordError("INVALID_INPUT", "Project record input is invalid.", validation.errors);
      }
      try {
        return await repository.insert(ownerId, validation.value);
      } catch (error) {
        throw toProjectRecordError(error, "Unable to create project record.");
      }
    },

    async getById(id: string): Promise<ProjectRecord> {
      const ownerId = await requireOwnerId();
      let record: ProjectRecord | null;
      try {
        record = await repository.findById(ownerId, id);
      } catch (error) {
        throw toProjectRecordError(error, "Unable to load project record.");
      }
      if (!record) {
        throw new ProjectRecordError("NOT_FOUND", "Project record was not found for this user.");
      }
      return record;
    },

    async list(options: ListProjectRecordsOptions = {}): Promise<ProjectRecord[]> {
      const ownerId = await requireOwnerId();
      try {
        return await repository.listByOwner(ownerId, { includeArchived: options.includeArchived ?? false });
      } catch (error) {
        throw toProjectRecordError(error, "Unable to list project records.");
      }
    },

    async update(id: string, input: unknown): Promise<ProjectRecord> {
      const ownerId = await requireOwnerId();
      let validation: ReturnType<typeof validateUpdateProjectRecordInput>;
      try {
        validation = validateUpdateProjectRecordInput(input);
      } catch {
        throw new ProjectRecordError("INVALID_INPUT", "Project record update input is invalid.");
      }
      if (validation.valid === false) {
        throw new ProjectRecordError("INVALID_INPUT", "Project record update input is invalid.", validation.errors);
      }

      let current: ProjectRecord | null;
      try {
        current = await repository.findById(ownerId, id);
      } catch (error) {
        throw toProjectRecordError(error, "Unable to load project record.");
      }
      if (!current) {
        throw new ProjectRecordError("NOT_FOUND", "Project record was not found for this user.");
      }
      if (current.status === "archived") {
        throw new ProjectRecordError("RECORD_ARCHIVED", "Archived project records cannot be updated.");
      }
      if (current.version !== validation.value.expectedVersion) {
        throw new ProjectRecordError("STALE_VERSION", "This project record has changed since it was last read.");
      }

      let result: ProjectRecord | "not_found_or_stale";
      try {
        result = await repository.updateConfig(ownerId, id, validation.value);
      } catch (error) {
        throw toProjectRecordError(error, "Unable to update project record.");
      }

      if (result === "not_found_or_stale") {
        // The pre-check above passed, but the conditional write still matched
        // zero rows -- a concurrent change landed in between. Re-read once to
        // report the accurate current reason rather than a generic failure.
        let recheck: ProjectRecord | null;
        try {
          recheck = await repository.findById(ownerId, id);
        } catch (error) {
          throw toProjectRecordError(error, "Unable to update project record.");
        }
        if (!recheck) {
          throw new ProjectRecordError("NOT_FOUND", "Project record was not found for this user.");
        }
        if (recheck.status === "archived") {
          throw new ProjectRecordError("RECORD_ARCHIVED", "Archived project records cannot be updated.");
        }
        throw new ProjectRecordError("STALE_VERSION", "This project record has changed since it was last read.");
      }

      return result;
    },

    async archive(id: string): Promise<ProjectRecord> {
      const ownerId = await requireOwnerId();
      let current: ProjectRecord | null;
      try {
        current = await repository.findById(ownerId, id);
      } catch (error) {
        throw toProjectRecordError(error, "Unable to load project record.");
      }
      if (!current) {
        throw new ProjectRecordError("NOT_FOUND", "Project record was not found for this user.");
      }
      if (current.status === "archived") {
        // Archiving is idempotent: an already-archived record is returned
        // unchanged rather than treated as an error, mirroring this
        // repository's existing `tasksService.completeTask` convention for
        // state-idempotent actions.
        return current;
      }

      try {
        const result = await repository.archiveActive(ownerId, id);
        if (result === "not_found") {
          // Race: archived (or removed) between the pre-check and the write.
          const recheck = await repository.findById(ownerId, id);
          if (!recheck) {
            throw new ProjectRecordError("NOT_FOUND", "Project record was not found for this user.");
          }
          return recheck;
        }
        return result;
      } catch (error) {
        throw toProjectRecordError(error, "Unable to archive project record.");
      }
    },
  };
}

/** Production singleton, backed by the real Supabase repository and Supabase Auth session. */
export const projectRecordService = createProjectRecordService();

export type { CreateProjectRecordInput, UpdateProjectRecordInput };
