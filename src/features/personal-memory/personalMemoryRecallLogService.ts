// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS2).
//
// Orchestration layer, mirroring personalMemoryRecordService.ts: resolves
// the trusted authenticated owner, never accepts one from caller input,
// delegates to the persistence boundary.

import type { PersonalMemoryRecallLogEntry } from "./personalMemoryRecallLogTypes";
import type { PersonalMemoryRecallLogRepository } from "./personalMemoryRecallLogRepository";
import { PersonalMemoryRecordError } from "./personalMemoryRecordTypes";

export type OwnerIdResolver = () => Promise<string | null>;

export interface PersonalMemoryRecallLogServiceDependencies {
  repository: PersonalMemoryRecallLogRepository;
  resolveOwnerId: OwnerIdResolver;
}

export interface PersonalMemoryRecallLogService {
  listByOwner(limit?: number): Promise<readonly PersonalMemoryRecallLogEntry[]>;
  logTutorRecall(recordIds: readonly string[]): Promise<{ readonly recallBatchId: string }>;
}

export function createPersonalMemoryRecallLogService(
  dependencies: PersonalMemoryRecallLogServiceDependencies,
): PersonalMemoryRecallLogService {
  const { repository, resolveOwnerId } = dependencies;

  async function requireOwnerId(): Promise<string> {
    const ownerId = await resolveOwnerId();
    if (!ownerId) throw new PersonalMemoryRecordError("UNAUTHENTICATED", "You must be signed in to view the recall log.");
    return ownerId;
  }

  return {
    async listByOwner(limit) {
      const ownerId = await requireOwnerId();
      return repository.listByOwner(ownerId, limit);
    },

    async logTutorRecall(recordIds) {
      await requireOwnerId();
      if (recordIds.length === 0) {
        throw new PersonalMemoryRecordError("INVALID_INPUT", "At least one record id is required to log a recall.");
      }
      return repository.logTutorRecall(recordIds);
    },
  };
}
