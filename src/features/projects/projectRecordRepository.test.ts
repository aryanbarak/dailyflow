import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

import {
  createSupabaseProjectRecordRepository,
  ProjectRecordConflictError,
  ProjectRecordPersistenceError,
} from "./projectRecordRepository";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "record-1",
    user_id: "user-1",
    project_type: "software_project",
    name: "SmartFlow",
    description: null,
    status: "active",
    repo_provider: null,
    repo_owner: null,
    repo_name: null,
    enabled_evidence_source_kinds: [],
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function chain(methods: string[], response: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of methods) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => response);
  query.maybeSingle = vi.fn(async () => response);
  // order() is the terminal call for list queries in this repository.
  query.order = vi.fn(async () => response);
  return query;
}

describe("createSupabaseProjectRecordRepository", () => {
  let repository: ReturnType<typeof createSupabaseProjectRecordRepository>;

  beforeEach(() => {
    fromMock.mockReset();
    repository = createSupabaseProjectRecordRepository({ from: fromMock } as never);
  });

  describe("insert", () => {
    it("inserts with the given owner id and maps the returned row", async () => {
      const query = chain(["insert", "select"], { data: row(), error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.insert("user-1", {
        type: "software_project",
        name: "SmartFlow",
        enabledEvidenceSourceKinds: [],
      });

      expect(fromMock).toHaveBeenCalledWith("project_records");
      expect(query.insert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "user-1", project_type: "software_project", name: "SmartFlow" }),
      );
      expect(result).toEqual({
        id: "record-1",
        ownerId: "user-1",
        type: "software_project",
        name: "SmartFlow",
        status: "active",
        enabledEvidenceSourceKinds: [],
        version: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      });
    });

    it("assembles the repository binding only when all three columns are present", async () => {
      const query = chain(["insert", "select"], {
        data: row({ repo_provider: "github", repo_owner: "aryanbarak", repo_name: "smartflow" }),
        error: null,
      });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.insert("user-1", {
        type: "software_project",
        name: "SmartFlow",
        repository: { provider: "github", owner: "aryanbarak", name: "smartflow" },
        enabledEvidenceSourceKinds: [],
      });

      expect(result.repository).toEqual({ provider: "github", owner: "aryanbarak", name: "smartflow" });
    });

    it("maps a unique-violation error to ProjectRecordConflictError", async () => {
      const query = chain(["insert", "select"], { data: null, error: { code: "23505", message: "duplicate key" } });
      fromMock.mockReturnValueOnce(query);

      await expect(
        repository.insert("user-1", {
          type: "software_project",
          name: "SmartFlow",
          repository: { provider: "github", owner: "a", name: "b" },
          enabledEvidenceSourceKinds: [],
        }),
      ).rejects.toBeInstanceOf(ProjectRecordConflictError);
    });

    it("maps any other error to ProjectRecordPersistenceError", async () => {
      const query = chain(["insert", "select"], { data: null, error: { code: "42501", message: "denied" } });
      fromMock.mockReturnValueOnce(query);

      await expect(
        repository.insert("user-1", { type: "software_project", name: "x", enabledEvidenceSourceKinds: [] }),
      ).rejects.toBeInstanceOf(ProjectRecordPersistenceError);
    });
  });

  describe("findById", () => {
    it("filters by id and owner and maps a found row", async () => {
      const query = chain(["select", "eq"], { data: row(), error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.findById("user-1", "record-1");

      expect(query.eq).toHaveBeenCalledWith("id", "record-1");
      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(result?.id).toBe("record-1");
    });

    it("returns null when no owned row matches", async () => {
      const query = chain(["select", "eq"], { data: null, error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.findById("user-1", "does-not-exist");
      expect(result).toBeNull();
    });

    it("wraps a read error", async () => {
      const query = chain(["select", "eq"], { data: null, error: { message: "boom" } });
      fromMock.mockReturnValueOnce(query);

      await expect(repository.findById("user-1", "record-1")).rejects.toBeInstanceOf(ProjectRecordPersistenceError);
    });
  });

  describe("listByOwner", () => {
    it("filters to the owner and active status by default", async () => {
      const query = chain(["select", "eq"], { data: [row()], error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.listByOwner("user-1", { includeArchived: false });

      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(query.eq).toHaveBeenCalledWith("status", "active");
      expect(result).toHaveLength(1);
    });

    it("does not filter by status when archived records are included", async () => {
      const query = chain(["select", "eq"], { data: [row(), row({ id: "record-2", status: "archived" })], error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.listByOwner("user-1", { includeArchived: true });

      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(query.eq).not.toHaveBeenCalledWith("status", "active");
      expect(result).toHaveLength(2);
    });
  });

  describe("updateConfig", () => {
    it("conditions the update on id, owner, and the expected version, and increments version", async () => {
      const query = chain(["update", "eq", "select"], { data: row({ name: "Renamed", version: 2 }), error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.updateConfig("user-1", "record-1", { expectedVersion: 1, name: "Renamed" });

      expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ version: 2, name: "Renamed" }));
      expect(query.eq).toHaveBeenCalledWith("id", "record-1");
      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(query.eq).toHaveBeenCalledWith("version", 1);
      expect(result).not.toBe("not_found_or_stale");
    });

    it("returns not_found_or_stale when zero rows match the conditional update", async () => {
      const query = chain(["update", "eq", "select"], { data: null, error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.updateConfig("user-1", "record-1", { expectedVersion: 5, name: "x" });
      expect(result).toBe("not_found_or_stale");
    });

    it("maps a unique-violation error to ProjectRecordConflictError", async () => {
      const query = chain(["update", "eq", "select"], { data: null, error: { code: "23505", message: "duplicate" } });
      fromMock.mockReturnValueOnce(query);

      await expect(
        repository.updateConfig("user-1", "record-1", {
          expectedVersion: 1,
          repository: { provider: "github", owner: "a", name: "b" },
        }),
      ).rejects.toBeInstanceOf(ProjectRecordConflictError);
    });

    it("also conditions the update on status = active, so a concurrently archived record cannot be mutated", async () => {
      const query = chain(["update", "eq", "select"], { data: row({ name: "Renamed", version: 2 }), error: null });
      fromMock.mockReturnValueOnce(query);

      await repository.updateConfig("user-1", "record-1", { expectedVersion: 1, name: "Renamed" });

      expect(query.eq).toHaveBeenCalledWith("status", "active");
    });

    it("returns not_found_or_stale when the record matched id/owner/version but was archived concurrently", async () => {
      // The active-status condition means an archived row no longer matches
      // the conditional update, even with a correct id/owner/version -- the
      // query reports zero rows the same way a stale version does, and the
      // service disambiguates by re-reading.
      const query = chain(["update", "eq", "select"], { data: null, error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.updateConfig("user-1", "record-1", { expectedVersion: 1, name: "Renamed" });
      expect(result).toBe("not_found_or_stale");
    });
  });

  describe("archiveActive", () => {
    it("conditions the update on id, owner, and status = active", async () => {
      const query = chain(["update", "eq", "select"], { data: row({ status: "archived" }), error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.archiveActive("user-1", "record-1");

      expect(query.update).toHaveBeenCalledWith({ status: "archived" });
      expect(query.eq).toHaveBeenCalledWith("id", "record-1");
      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(query.eq).toHaveBeenCalledWith("status", "active");
      expect(result).not.toBe("not_found");
    });

    it("returns not_found when the record is not active or not owned", async () => {
      const query = chain(["update", "eq", "select"], { data: null, error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.archiveActive("user-1", "record-1");
      expect(result).toBe("not_found");
    });
  });
});
