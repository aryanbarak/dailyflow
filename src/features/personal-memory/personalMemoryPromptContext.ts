// SmartFlow -- ADR-0011 Confirmed Personal Memory Consumption v1.
//
// Composes the confirmed-only read with the prompt formatter for the Learn
// AI tutor call site (useLearnAI.ts), the same way
// personalMemoryExtractionTriggerClient.ts factors its own async step out of
// a hook -- directly unit-testable with a fake service, no rendering
// required.

import type { PersonalMemoryRecordService } from "./personalMemoryRecordService";
import { buildConfirmedMemoryPromptSection } from "./personalMemoryPromptSerialization";

export async function getConfirmedMemoryPromptContext(
  service: Pick<PersonalMemoryRecordService, "listConfirmed">,
): Promise<string> {
  const records = await service.listConfirmed();
  return buildConfirmedMemoryPromptSection(records);
}
