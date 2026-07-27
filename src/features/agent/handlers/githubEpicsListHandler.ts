import type { AgentToolHandler } from "../executionTypes";
import { validateInputAgainstSchema } from "./inputValidation";

export const githubEpicsListHandler: AgentToolHandler = {
  toolId: "github.epics.list",
  timeoutMs: 10_000,
  readOnly: true,
  validateInput: validateInputAgainstSchema,
  async execute(_input, context) {
    if (!context.githubEpicsClient) {
      return { connectionStatus: "not_connected", epics: [] };
    }
    return context.githubEpicsClient.listEpics();
  },
};
