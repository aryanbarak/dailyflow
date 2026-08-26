import type { AgentWriteToolHandler } from "./executionTypes";
import { tasksCompleteHandler } from "./handlers/tasksCompleteHandler";
import { tasksCreateHandler } from "./handlers/tasksCreateHandler";
import { tasksUpdateHandler } from "./handlers/tasksUpdateHandler";
import { calendarCreateEventHandler } from "./handlers/calendarCreateEventHandler";
import { calendarUpdateEventHandler } from "./handlers/calendarUpdateEventHandler";
import { financeCreateTransactionHandler } from "./handlers/financeCreateTransactionHandler";
import { githubIssuesCommentHandler } from "./handlers/githubIssuesCommentHandler";
import { githubIssuesUpdateHandler } from "./handlers/githubIssuesUpdateHandler";
import { githubFilesUpdateHandler } from "./handlers/githubFilesUpdateHandler";
import { engineeringTaskProposeHandler } from "./handlers/engineeringTaskProposeHandler";

const registeredWriteHandlers: readonly AgentWriteToolHandler[] = Object.freeze([
  tasksCompleteHandler,
  tasksCreateHandler,
  tasksUpdateHandler,
  calendarCreateEventHandler,
  calendarUpdateEventHandler,
  financeCreateTransactionHandler,
  githubIssuesCommentHandler,
  githubIssuesUpdateHandler,
  githubFilesUpdateHandler,
  engineeringTaskProposeHandler,
]);

export function getWriteHandlerByToolId(toolId: string): AgentWriteToolHandler | undefined {
  return registeredWriteHandlers.find((handler) => handler.toolId === toolId);
}

export function listRegisteredWriteHandlers(): readonly AgentWriteToolHandler[] {
  return registeredWriteHandlers;
}

export { tasksCompleteHandler, tasksCreateHandler, tasksUpdateHandler, calendarCreateEventHandler, calendarUpdateEventHandler, financeCreateTransactionHandler, githubIssuesCommentHandler, githubIssuesUpdateHandler, githubFilesUpdateHandler, engineeringTaskProposeHandler };
