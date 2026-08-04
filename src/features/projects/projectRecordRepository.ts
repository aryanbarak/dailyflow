// SmartFlow Slice 3 -- ProjectRecord Foundation.
//
// The persistence boundary. `ProjectRecordRepository` is an explicit,
// strongly-typed interface so `projectRecordService.ts` depends on a
// contract, not a concrete Supabase client, and can be exercised in tests
// with an in-memory fake instead of mocking Supabase's query-builder chain
// for every scenario. `createSupabaseProjectRecordRepository` is the only
// concrete implementation; `projectRecordRepository` is the production
// singleton built from it.
//
// This module owns every raw `user_id`/snake_case detail. Nothing above it
// (service, validation, or any future caller) ever sees a Supabase row or
// Database type.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  NormalizedCreateProjectRecordInput,
  NormalizedProjectRecordConfigChanges,
  ProjectRecord,
  ProjectRecordRepositoryBinding,
  ProjectRecordRepositoryProvider,
} from "./projectRecordTypes";
import type { ProjectSourceKind, ProjectType } from "./projectContextTypes";

type ProjectRecordRow = Database["public"]["Tables"]["project_records"]["Row"];

const PROJECT_RECORD_SELECT_COLUMNS =
  "id,user_id,project_type,name,description,status,repo_provider,repo_owner,repo_name,enabled_evidence_source_kinds,version,created_at,updated_at";

/** Postgres unique_violation. See project_records_active_repo_binding_key in the Slice 3 migration. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

export class ProjectRecordConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectRecordConflictError";
  }
}

export class ProjectRecordPersistenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ProjectRecordPersistenceError";
  }
}

function mapRowToProjectRecord(row: ProjectRecordRow): ProjectRecord {
  const repository: ProjectRecordRepositoryBinding | undefined =
    row.repo_provider && row.repo_owner && row.repo_name
      ? {
          provider: row.repo_provider as ProjectRecordRepositoryProvider,
          owner: row.repo_owner,
          name: row.repo_name,
        }
      : undefined;

  const record: ProjectRecord = {
    id: row.id,
    ownerId: row.user_id,
    type: row.project_type as ProjectType,
    name: row.name,
    status: row.status === "archived" ? "archived" : "active",
    enabledEvidenceSourceKinds: (row.enabled_evidence_source_kinds ?? []) as readonly ProjectSourceKind[],
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.description) record.description = row.description;
  if (repository) record.repository = repository;
  return record;
}

function isPostgrestUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

export interface ProjectRecordRepository {
  insert(ownerId: string, input: NormalizedCreateProjectRecordInput): Promise<ProjectRecord>;
  findById(ownerId: string, id: string): Promise<ProjectRecord | null>;
  listByOwner(ownerId: string, options: { includeArchived: boolean }): Promise<ProjectRecord[]>;
  /** Conditional update: only applies when `changes.expectedVersion` still matches the stored version and the record is still `active`. Returns `"not_found_or_stale"` when zero rows matched, leaving disambiguation (not found vs. stale vs. archived) to the caller. */
  updateConfig(
    ownerId: string,
    id: string,
    changes: NormalizedProjectRecordConfigChanges,
  ): Promise<ProjectRecord | "not_found_or_stale">;
  /** Conditional update: only transitions an `active` record to `archived`. Returns `"not_found"` when zero rows matched (does not exist, not owned, or already archived) -- the service pre-checks status via `findById` so it can report idempotent-archive vs. not-found accurately. */
  archiveActive(ownerId: string, id: string): Promise<ProjectRecord | "not_found">;
}

export function createSupabaseProjectRecordRepository(client: SupabaseClient<Database>): ProjectRecordRepository {
  return {
    async insert(ownerId, input) {
      const { data, error } = await client
        .from("project_records")
        .insert({
          user_id: ownerId,
          project_type: input.type,
          name: input.name,
          description: input.description ?? null,
          repo_provider: input.repository?.provider ?? null,
          repo_owner: input.repository?.owner ?? null,
          repo_name: input.repository?.name ?? null,
          enabled_evidence_source_kinds: [...input.enabledEvidenceSourceKinds],
        })
        .select(PROJECT_RECORD_SELECT_COLUMNS)
        .single();

      if (error) {
        if (isPostgrestUniqueViolation(error)) {
          throw new ProjectRecordConflictError("An active project is already bound to this repository.");
        }
        throw new ProjectRecordPersistenceError("Unable to create project record.", error);
      }
      return mapRowToProjectRecord(data as ProjectRecordRow);
    },

    async findById(ownerId, id) {
      const { data, error } = await client
        .from("project_records")
        .select(PROJECT_RECORD_SELECT_COLUMNS)
        .eq("id", id)
        .eq("user_id", ownerId)
        .maybeSingle();

      if (error) {
        throw new ProjectRecordPersistenceError("Unable to load project record.", error);
      }
      return data ? mapRowToProjectRecord(data as ProjectRecordRow) : null;
    },

    async listByOwner(ownerId, options) {
      let query = client
        .from("project_records")
        .select(PROJECT_RECORD_SELECT_COLUMNS)
        .eq("user_id", ownerId);
      if (!options.includeArchived) {
        query = query.eq("status", "active");
      }
      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) {
        throw new ProjectRecordPersistenceError("Unable to list project records.", error);
      }
      return (data ?? []).map((row) => mapRowToProjectRecord(row as ProjectRecordRow));
    },

    async updateConfig(ownerId, id, changes) {
      const patch: Database["public"]["Tables"]["project_records"]["Update"] = {
        version: changes.expectedVersion + 1,
      };
      if (changes.name !== undefined) patch.name = changes.name;
      if (changes.description !== undefined) patch.description = changes.description;
      if (changes.repository !== undefined) {
        patch.repo_provider = changes.repository?.provider ?? null;
        patch.repo_owner = changes.repository?.owner ?? null;
        patch.repo_name = changes.repository?.name ?? null;
      }
      if (changes.enabledEvidenceSourceKinds !== undefined) {
        patch.enabled_evidence_source_kinds = [...changes.enabledEvidenceSourceKinds];
      }

      const { data, error } = await client
        .from("project_records")
        .update(patch)
        .eq("id", id)
        .eq("user_id", ownerId)
        .eq("version", changes.expectedVersion)
        .eq("status", "active")
        .select(PROJECT_RECORD_SELECT_COLUMNS)
        .maybeSingle();

      if (error) {
        if (isPostgrestUniqueViolation(error)) {
          throw new ProjectRecordConflictError("An active project is already bound to this repository.");
        }
        throw new ProjectRecordPersistenceError("Unable to update project record.", error);
      }
      return data ? mapRowToProjectRecord(data as ProjectRecordRow) : "not_found_or_stale";
    },

    async archiveActive(ownerId, id) {
      const { data, error } = await client
        .from("project_records")
        .update({ status: "archived" })
        .eq("id", id)
        .eq("user_id", ownerId)
        .eq("status", "active")
        .select(PROJECT_RECORD_SELECT_COLUMNS)
        .maybeSingle();

      if (error) {
        throw new ProjectRecordPersistenceError("Unable to archive project record.", error);
      }
      return data ? mapRowToProjectRecord(data as ProjectRecordRow) : "not_found";
    },
  };
}
