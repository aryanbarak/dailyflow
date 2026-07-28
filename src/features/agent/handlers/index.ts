import type { AgentToolHandler } from "../executionTypes";
import { calendarListTodayHandler } from "./calendarListTodayHandler";
import { learningGetProgressHandler } from "./learningGetProgressHandler";
import { githubRepositoriesListHandler } from "./githubRepositoriesListHandler";
import { githubIssuesListHandler } from "./githubIssuesListHandler";
import { githubEpicsListHandler } from "./githubEpicsListHandler";
import { githubPullRequestsListHandler } from "./githubPullRequestsListHandler";
import { githubWorkflowRunsListHandler } from "./githubWorkflowRunsListHandler";
import { githubFilesReadHandler } from "./githubFilesReadHandler";
import { tasksListHandler } from "./tasksListHandler";
import { workspaceGetContextHandler } from "./workspaceGetContextHandler";

const registeredHandlers: readonly AgentToolHandler[] = Object.freeze([
  tasksListHandler,
  calendarListTodayHandler,
  learningGetProgressHandler,
  workspaceGetContextHandler,
  githubRepositoriesListHandler,
  githubIssuesListHandler,
  githubEpicsListHandler,
  githubPullRequestsListHandler,
  githubWorkflowRunsListHandler,
  githubFilesReadHandler,
]);

export function getHandlerByToolId(toolId: string): AgentToolHandler | undefined {
  return registeredHandlers.find((handler) => handler.toolId === toolId);
}

export function listRegisteredHandlers(): readonly AgentToolHandler[] {
  return registeredHandlers;
}

export {
  calendarListTodayHandler,
  learningGetProgressHandler,
  githubRepositoriesListHandler,
  githubIssuesListHandler,
  githubEpicsListHandler,
  githubPullRequestsListHandler,
  githubWorkflowRunsListHandler,
  githubFilesReadHandler,
  tasksListHandler,
  workspaceGetContextHandler,
};
