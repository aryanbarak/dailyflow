// SmartFlow -- ADR-0011 Confirmed Personal Memory Consumption v1.
//
// Composes the confirmed-only read with the prompt formatter for the Learn
// AI tutor call site (useLearnAI.ts), the same way
// personalMemoryExtractionTriggerClient.ts factors its own async step out of
// a hook -- directly unit-testable with a fake service, no rendering
// required.

import type { PersonalMemoryRecordService } from "./personalMemoryRecordService";
import { buildConfirmedMemoryPromptSection, selectBoundedConfirmedMemory } from "./personalMemoryPromptSerialization";

export interface ConfirmedMemoryPromptContext {
  readonly text: string;
  /** The ids actually selected into `text` (post cap/per-kind bounding) -- ADR-0023 SS2, the tutor's recall-log input. */
  readonly recordIds: readonly string[];
}

export async function getConfirmedMemoryPromptContext(
  service: Pick<PersonalMemoryRecordService, "listConfirmed">,
): Promise<ConfirmedMemoryPromptContext> {
  const records = await service.listConfirmed();
  const selected = selectBoundedConfirmedMemory(records);
  return {
    text: buildConfirmedMemoryPromptSection(records),
    recordIds: selected.map((record) => record.id),
  };
}
