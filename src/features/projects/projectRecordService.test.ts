import { beforeEach, describe, expect, it, vi } from "vitest";

// projectRecordService.ts imports the real Supabase client module (for its
// default owner-id resolver). Every test here injects its own
// `resolveOwnerId`, so the real client is never called -- but constructing
// it eagerly at import time still runs createClient(...) with a browser
// `localStorage` that does not exist in the test environment. Mocking the
// module out, exactly as tasksService.test.ts and journalService's tests
// already do, avoids that unrelated import-time side effect.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: vi.fn() } },
}));

import { createProjectRecordService } from "./projectRecordService";
import { ProjectRecordConflictError, type ProjectRecordRepository } from "./projectRecordRepository";
import { ProjectRecordError, type ProjectRecord } from "./projectRecordTypes";

function isSameBinding(a: ProjectRecord["repository"], b: ProjectRecord["repository"]) {
  if (!a || !b) return false;
  return a.provider === b.provider && a.owner === b.owner && a.name === b.name;
}

function createFakeRepository(): ProjectRecordRepository & { rows: Map<string, ProjectRecord> } {
  const rows = new Map<string, ProjectRecord>();
  let nextId = 1;

  function activeBindingConflict(ownerId: string, excludeId: string | null, binding: ProjectRecord["repository"]) {
    if (!binding) return false;
    return [...rows.values()].some(
      (r) => r.id !== excludeId && r.ownerId === ownerId && r.status === "active" && isSameBinding(r.repository, binding),
    );
  }

  return {
    rows,
    async insert(ownerId, input) {
      if (activeBindingConflict(ownerId, null, input.repository)) {
        throw new ProjectRecordConflictError("An active project is already bound to this repository.");
      }
      const now = new Date().toISOString();
      const record: ProjectRecord = {
        id: `record-${nextId++}`,
        ownerId,
        type: input.type,
        name: input.name,
        status: "active",
        enabledEvidenceSourceKinds: input.enabledEvidenceSourceKinds,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      if (input.description) record.description = input.description;
      if (input.repository) record.repository = input.repository;
      rows.set(record.id, record);
      return record;
    },
    async findById(ownerId, id) {
      const record = rows.get(id);
      return record && record.ownerId === ownerId ? record : null;
    },
    async listByOwner(ownerId, options) {
      return [...rows.values()].filter((r) => r.ownerId === ownerId && (options.includeArchived || r.status === "active"));
    },
    async updateConfig(ownerId, id, changes) {
      const record = rows.get(id);
      if (!record || record.ownerId !== ownerId || record.version !== changes.expectedVersion) {
        return "not_found_or_stale";
      }
      if (changes.repository && activeBindingConflict(ownerId, id, changes.repository)) {
        throw new ProjectRecordConflictError("An active project is already bound to this repository.");
      }
      const updated: ProjectRecord = { ...record, version: record.version + 1, updatedAt: new Date().toISOString() };
      if (changes.name !== undefined) updated.name = changes.name;
      if (changes.description !== undefined) {
        if (changes.description === null) delete updated.description;
        else updated.description = changes.description;
      }
      if (changes.repository !== undefined) {
        if (changes.repository === null) delete updated.repository;
        else updated.repository = changes.repository;
      }
      if (changes.enabledEvidenceSourceKinds !== undefined) {
        updated.enabledEvidenceSourceKinds = changes.enabledEvidenceSourceKinds;
      }
      rows.set(id, updated);
      return updated;
    },
    async archiveActive(ownerId, id) {
      const record = rows.get(id);
      if (!record || record.ownerId !== ownerId || record.status !== "active") return "not_found";
      const updated: ProjectRecord = { ...record, status: "archived", updatedAt: new Date().toISOString() };
      rows.set(id, updated);
      return updated;
    },
  };
}

const FORBIDDEN_RECORD_KEYS = [
  "accessToken",
  "credential",
  "token",
  "approvalState",
  "executionIntent",
  "runtimeResult",
  "policyDecision",
  "currentObjective",
  "milestones",
  "acceptedDecisions",
  "risks",
  "candidateActions",
];

describe("projectRecordService", () => {
  let repository: ReturnType<typeof createFakeRepository>;

  beforeEach(() => {
    repository = createFakeRepository();
  });

  function serviceFor(ownerId: string | null) {
    return createProjectRecordService({ repository, resolveOwnerId: async () => ownerId });
  }

  describe("create", () => {
    it("assigns the trusted resolved owner, never a caller-supplied one", async () => {
      const service = serviceFor("user-1");
      const record = await service.create({ type: "software_project", name: "SmartFlow" });
      expect(record.ownerId).toBe("user-1");
    });

    it("rejects an attempt to smuggle an owner id in the input rather than silently dropping it", async () => {
      const service = serviceFor("user-1");
      await expect(
        service.create({ type: "software_project", name: "SmartFlow", ownerId: "attacker" } as never),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(repository.rows.size).toBe(0);
    });

    it("rejects when unauthenticated, before touching the repository", async () => {
      const service = serviceFor(null);
      await expect(service.create({ type: "software_project", name: "x" })).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      expect(repository.rows.size).toBe(0);
    });

    it("rejects an invalid project type", async () => {
      const service = serviceFor("user-1");
      await expect(service.create({ type: "personal_project", name: "x" } as never)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    });

    it("rejects an invalid name", async () => {
      const service = serviceFor("user-1");
      await expect(service.create({ type: "software_project", name: "" })).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    });

    it("rejects an unsafe repository configuration", async () => {
      const service = serviceFor("user-1");
      await expect(
        service.create({
          type: "software_project",
          name: "x",
          repository: { provider: "gitlab", owner: "a", name: "b" },
        } as never),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("rejects a second active project bound to the same repository for the same owner", async () => {
      const service = serviceFor("user-1");
      const repositoryBinding = { provider: "github" as const, owner: "aryanbarak", name: "smartflow" };
      await service.create({ type: "software_project", name: "First", repository: repositoryBinding });
      await expect(
        service.create({ type: "software_project", name: "Second", repository: repositoryBinding }),
      ).rejects.toMatchObject({ code: "DUPLICATE_REPOSITORY_BINDING" });
    });
  });

  describe("read and list", () => {
    it("lets an owner read their own record", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "SmartFlow" });
      const read = await service.getById(created.id);
      expect(read).toEqual(created);
    });

    it("never returns another user's record, and does not distinguish it from not-found", async () => {
      const ownerService = serviceFor("user-1");
      const created = await ownerService.create({ type: "software_project", name: "SmartFlow" });

      const otherService = serviceFor("user-2");
      await expect(otherService.getById(created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("list returns only the resolved owner's records", async () => {
      const serviceA = serviceFor("user-1");
      const serviceB = serviceFor("user-2");
      await serviceA.create({ type: "software_project", name: "A1" });
      await serviceA.create({ type: "software_project", name: "A2" });
      await serviceB.create({ type: "software_project", name: "B1" });

      const listA = await serviceA.list();
      expect(listA.map((r) => r.name).sort()).toEqual(["A1", "A2"]);
    });

    it("excludes archived records by default and includes them only when requested", async () => {
      const service = serviceFor("user-1");
      const active = await service.create({ type: "software_project", name: "Active" });
      const archived = await service.create({ type: "software_project", name: "Archived" });
      await service.archive(archived.id);

      const defaultList = await service.list();
      expect(defaultList.map((r) => r.id)).toEqual([active.id]);

      const fullList = await service.list({ includeArchived: true });
      expect(fullList.map((r) => r.id).sort()).toEqual([active.id, archived.id].sort());
    });
  });

  describe("update", () => {
    it("updates editable fields and increments the version", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "Original" });
      const updated = await service.update(created.id, { expectedVersion: created.version, name: "Renamed" });
      expect(updated.name).toBe("Renamed");
      expect(updated.version).toBe(created.version + 1);
      expect(updated.id).toBe(created.id);
      expect(updated.ownerId).toBe(created.ownerId);
      expect(updated.type).toBe(created.type);
    });

    it("cannot change identity fields because they are not part of the update shape", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "Original" });
      await expect(
        service.update(created.id, { expectedVersion: created.version, id: "other-id", name: "x" } as never),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        service.update(created.id, { expectedVersion: created.version, ownerId: "attacker", name: "x" } as never),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("rejects updates targeting another user's record without confirming it exists", async () => {
      const ownerService = serviceFor("user-1");
      const created = await ownerService.create({ type: "software_project", name: "Original" });

      const otherService = serviceFor("user-2");
      await expect(
        otherService.update(created.id, { expectedVersion: created.version, name: "Hijacked" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rejects a stale version", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "Original" });
      await service.update(created.id, { expectedVersion: created.version, name: "First edit" });

      await expect(
        service.update(created.id, { expectedVersion: created.version, name: "Second edit" }),
      ).rejects.toMatchObject({ code: "STALE_VERSION" });
    });

    it("rejects unknown fields", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "Original" });
      await expect(
        service.update(created.id, { expectedVersion: created.version, unknownField: true } as never),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("rejects configuration updates on an archived record", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "Original" });
      const archived = await service.archive(created.id);
      await expect(
        service.update(created.id, { expectedVersion: archived.version, name: "Should not apply" }),
      ).rejects.toMatchObject({ code: "RECORD_ARCHIVED" });
    });
  });

  describe("archive", () => {
    it("archives an active record", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "Original" });
      const archived = await service.archive(created.id);
      expect(archived.status).toBe("archived");
    });

    it("is idempotent for an already-archived record", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "Original" });
      const first = await service.archive(created.id);
      const second = await service.archive(created.id);
      expect(second).toEqual(first);
    });

    it("rejects archiving another user's record without confirming it exists", async () => {
      const ownerService = serviceFor("user-1");
      const created = await ownerService.create({ type: "software_project", name: "Original" });

      const otherService = serviceFor("user-2");
      await expect(otherService.archive(created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("provides no reactivation operation", () => {
      const service = serviceFor("user-1");
      expect((service as unknown as Record<string, unknown>).reactivate).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).restore).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).activate).toBeUndefined();
    });
  });

  describe("hostile input safety", () => {
    function objectWithThrowingGetter(key: string, otherProps: Record<string, unknown> = {}) {
      const value: Record<string, unknown> = { ...otherProps };
      Object.defineProperty(value, key, {
        enumerable: true,
        get() {
          throw new Error("boom from a hostile getter");
        },
      });
      return value;
    }

    it("converts a throwing getter during create into a typed INVALID_INPUT error, not a raw exception", async () => {
      const service = serviceFor("user-1");
      const hostileInput = objectWithThrowingGetter("type", { name: "SmartFlow" });

      let caught: unknown;
      try {
        await service.create(hostileInput as never);
        throw new Error("expected create to reject");
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProjectRecordError);
      expect((caught as ProjectRecordError).code).toBe("INVALID_INPUT");
      expect((caught as Error).message).not.toMatch(/boom from a hostile getter/);
      expect(repository.rows.size).toBe(0);
    });

    it("converts a throwing getter during update into a typed INVALID_INPUT error, not a raw exception", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({ type: "software_project", name: "Original" });
      const hostileInput = objectWithThrowingGetter("name", { expectedVersion: created.version });

      let caught: unknown;
      try {
        await service.update(created.id, hostileInput as never);
        throw new Error("expected update to reject");
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProjectRecordError);
      expect((caught as ProjectRecordError).code).toBe("INVALID_INPUT");
      expect((caught as Error).message).not.toMatch(/boom from a hostile getter/);
    });
  });

  describe("persistence and security shape", () => {
    it("never returns a credential, execution, or ProjectContext-derived field", async () => {
      const service = serviceFor("user-1");
      const created = await service.create({
        type: "software_project",
        name: "SmartFlow",
        repository: { provider: "github", owner: "a", name: "b" },
      });
      const updated = await service.update(created.id, { expectedVersion: created.version, name: "Renamed" });
      const archived = await service.archive(updated.id);

      for (const record of [created, updated, archived]) {
        const keys = Object.keys(record);
        for (const forbidden of FORBIDDEN_RECORD_KEYS) {
          expect(keys).not.toContain(forbidden);
        }
      }
    });

    it("every failure is a typed ProjectRecordError with a stable code", async () => {
      const service = serviceFor("user-1");
      try {
        await service.getById("does-not-exist");
        throw new Error("expected getById to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectRecordError);
        expect((error as ProjectRecordError).code).toBe("NOT_FOUND");
      }
    });
  });
});
