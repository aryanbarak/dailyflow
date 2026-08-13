import type { AgentWriteToolHandler } from "./executionTypes";
import { tasksCompleteHandler } from "./handlers/tasksCompleteHandler";
import { tasksCreateHandler } from "./handlers/tasksCreateHandler";
import { tasksUpdateHandler } from "./handlers/tasksUpdateHandler";
import { githubIssuesCommentHandler } from "./handlers/githubIssuesCommentHandler";
import { githubIssuesUpdateHandler } from "./handlers/githubIssuesUpdateHandler";
import { githubFilesUpdateHandler } from "./handlers/githubFilesUpdateHandler";

const registeredWriteHandlers: readonly AgentWriteToolHandler[] = Object.freeze([
  tasksCompleteHandler,
  tasksCreateHandler,
  tasksUpdateHandler,
  githubIssuesCommentHandler,
  githubIssuesUpdateHandler,
  githubFilesUpdateHandler,
]);

export function getWriteHandlerByToolId(toolId: string): AgentWriteToolHandler | undefined {
  return registeredWriteHandlers.find((handler) => handler.toolId === toolId);
}

export function listRegisteredWriteHandlers(): readonly AgentWriteToolHandler[] {
  return registeredWriteHandlers;
}

export { tasksCompleteHandler, tasksCreateHandler, tasksUpdateHandler, githubIssuesCommentHandler, githubIssuesUpdateHandler, githubFilesUpdateHandler };
