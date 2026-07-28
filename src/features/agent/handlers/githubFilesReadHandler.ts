// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
import type { AgentToolHandler } from "../executionTypes";
import { validateInputAgainstSchema } from "./inputValidation";

export const githubFilesReadHandler: AgentToolHandler = {
  toolId: "github.files.read",
  timeoutMs: 10_000,
  readOnly: true,
  validateInput: validateInputAgainstSchema,
  async execute(input, context) {
    if (!context.githubFileContentClient) {
      return { connectionStatus: "not_connected" as const, file: null };
    }
    const repo = typeof input.repo === "string" ? input.repo : "";
    const path = typeof input.path === "string" ? input.path : "";
    return context.githubFileContentClient.readFile({ repo, path });
  },
};
