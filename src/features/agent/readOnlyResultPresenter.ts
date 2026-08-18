import type { ExecutionResult } from "./executionTypes";

export interface ReadOnlyResultPresentation {
  safeSummary: string;
  safePreviewItems: string[];
}

// Task 33-fix: exported (not a private literal repeated 5 times below) so
// responseComposer.ts's belt-and-braces not-connected check (summaryFor)
// can match against this exact string instead of hand-copying it a second
// time -- the English-leak bug this fixes existed BECAUSE this string used
// to be phrased differently from its sibling "No ... found." summaries,
// which broke responseComposer.ts's only detection heuristic. A single
// shared constant means the two files cannot drift apart the same way again.
export const GITHUB_NOT_CONNECTED_SUMMARY = "No GitHub connection is available.";

interface TasksListData {
  tasks?: Array<{
    title?: string;
    status?: string;
  }>;
}

interface CalendarListTodayData {
  events?: Array<{
    title?: string;
  }>;
}

interface LearningGetProgressData {
  lessons?: Array<{
    title?: string;
  }>;
}

interface GitHubRepositoriesData {
  connectionStatus?: string;
  repositories?: Array<{ name?: string; owner?: string }>;
}

interface GitHubIssuesData {
  connectionStatus?: string;
  issues?: Array<{ repo?: string; number?: number; title?: string }>;
}

interface GitHubEpicsData {
  connectionStatus?: string;
  epics?: Array<{ repo?: string; number?: number; title?: string; epic?: string; status?: string }>;
}

interface GitHubPullRequestsData {
  connectionStatus?: string;
  pullRequests?: Array<{ repo?: string; number?: number; title?: string; draft?: boolean }>;
}

interface GitHubWorkflowRunsData {
  connectionStatus?: string;
  workflowRuns?: Array<{ repo?: string; workflowName?: string; status?: string; conclusion?: string }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function countSummary(count: number, zero: string, one: string, many: (count: number) => string) {
  if (count === 0) return zero;
  if (count === 1) return one;
  return many(count);
}

function tasksPresentation(data: unknown): ReadOnlyResultPresentation {
  const tasks = isObject(data) && Array.isArray((data as TasksListData).tasks)
    ? (data as TasksListData).tasks ?? []
    : [];
  const activeTasks = tasks.filter((task) => task.status !== "completed");

  return {
    safeSummary: countSummary(
      activeTasks.length,
      "No active tasks found.",
      "1 active task found.",
      (count) => `${count} active tasks found.`,
    ),
    safePreviewItems: activeTasks
      .map((task) => task.title)
      .filter((title): title is string => Boolean(title))
      .slice(0, 3),
  };
}

function calendarPresentation(data: unknown): ReadOnlyResultPresentation {
  const events = isObject(data) && Array.isArray((data as CalendarListTodayData).events)
    ? (data as CalendarListTodayData).events ?? []
    : [];

  return {
    safeSummary: countSummary(
      events.length,
      "No events today.",
      "1 event found today.",
      (count) => `${count} events found today.`,
    ),
    safePreviewItems: events
      .map((event) => event.title)
      .filter((title): title is string => Boolean(title))
      .slice(0, 3),
  };
}

function learningPresentation(data: unknown): ReadOnlyResultPresentation {
  const lessons = isObject(data) && Array.isArray((data as LearningGetProgressData).lessons)
    ? (data as LearningGetProgressData).lessons ?? []
    : [];

  return {
    safeSummary: countSummary(
      lessons.length,
      "No learning progress found.",
      "1 learning item found.",
      (count) => `${count} learning items found.`,
    ),
    safePreviewItems: lessons
      .map((lesson) => lesson.title)
      .filter((title): title is string => Boolean(title))
      .slice(0, 3),
  };
}

function githubPresentation(data: unknown): ReadOnlyResultPresentation {
  const value = isObject(data) ? data as GitHubRepositoriesData : {};
  if (value.connectionStatus === "not_connected") {
    return { safeSummary: GITHUB_NOT_CONNECTED_SUMMARY, safePreviewItems: [] };
  }
  const repositories = Array.isArray(value.repositories) ? value.repositories.slice(0, 20) : [];
  return {
    safeSummary: countSummary(
      repositories.length,
      "No connected GitHub repositories found.",
      "1 connected GitHub repository found.",
      (count) => `${count} connected GitHub repositories found.`,
    ),
    safePreviewItems: repositories
      .map((item) => item.owner && item.name ? `${item.owner}/${item.name}` : undefined)
      .filter((item): item is string => Boolean(item))
      .slice(0, 6),
  };
}

function githubIssuesPresentation(data: unknown): ReadOnlyResultPresentation {
  const value = isObject(data) ? data as GitHubIssuesData : {};
  if (value.connectionStatus === "not_connected") {
    return { safeSummary: GITHUB_NOT_CONNECTED_SUMMARY, safePreviewItems: [] };
  }
  const issues = Array.isArray(value.issues) ? value.issues.slice(0, 20) : [];
  return {
    safeSummary: countSummary(
      issues.length,
      "No open GitHub issues found.",
      "1 open GitHub issue found.",
      (count) => `${count} open GitHub issues found.`,
    ),
    safePreviewItems: issues
      .map((item) => item.repo && item.number && item.title ? `${item.repo}#${item.number} ${item.title}` : undefined)
      .filter((item): item is string => Boolean(item))
      .slice(0, 6),
  };
}

function githubEpicsPresentation(data: unknown): ReadOnlyResultPresentation {
  const value = isObject(data) ? data as GitHubEpicsData : {};
  if (value.connectionStatus === "not_connected") {
    return { safeSummary: GITHUB_NOT_CONNECTED_SUMMARY, safePreviewItems: [] };
  }
  const epics = Array.isArray(value.epics) ? value.epics.slice(0, 20) : [];
  return {
    safeSummary: countSummary(
      epics.length,
      "No GitHub epics found.",
      "1 GitHub epic found.",
      (count) => `${count} GitHub epics found.`,
    ),
    safePreviewItems: epics
      .map((item) => {
        if (!item.repo || !item.number || !item.title) return undefined;
        const statusSuffix = item.status ? ` (${item.status})` : "";
        return `${item.repo}#${item.number} ${item.title}${statusSuffix}`;
      })
      .filter((item): item is string => Boolean(item))
      .slice(0, 6),
  };
}

function githubPullRequestsPresentation(data: unknown): ReadOnlyResultPresentation {
  const value = isObject(data) ? data as GitHubPullRequestsData : {};
  if (value.connectionStatus === "not_connected") {
    return { safeSummary: GITHUB_NOT_CONNECTED_SUMMARY, safePreviewItems: [] };
  }
  const pullRequests = Array.isArray(value.pullRequests) ? value.pullRequests.slice(0, 20) : [];
  return {
    safeSummary: countSummary(
      pullRequests.length,
      "No open GitHub pull requests found.",
      "1 open GitHub pull request found.",
      (count) => `${count} open GitHub pull requests found.`,
    ),
    safePreviewItems: pullRequests
      .map((item) => item.repo && item.number && item.title
        ? `${item.repo}#${item.number} ${item.title}${item.draft ? " (draft)" : ""}`
        : undefined)
      .filter((item): item is string => Boolean(item))
      .slice(0, 6),
  };
}

function githubWorkflowRunsPresentation(data: unknown): ReadOnlyResultPresentation {
  const value = isObject(data) ? data as GitHubWorkflowRunsData : {};
  if (value.connectionStatus === "not_connected") {
    return { safeSummary: GITHUB_NOT_CONNECTED_SUMMARY, safePreviewItems: [] };
  }
  const workflowRuns = Array.isArray(value.workflowRuns) ? value.workflowRuns.slice(0, 10) : [];
  return {
    safeSummary: countSummary(
      workflowRuns.length,
      "No recent GitHub workflow runs found.",
      "1 recent GitHub workflow run found.",
      (count) => `${count} recent GitHub workflow runs found.`,
    ),
    safePreviewItems: workflowRuns
      .map((item) => item.repo && item.workflowName
        ? `${item.repo}: ${item.workflowName} (${item.conclusion ?? item.status ?? "unknown"})`
        : undefined)
      .filter((item): item is string => Boolean(item))
      .slice(0, 6),
  };
}

export function presentReadOnlyResult(result: ExecutionResult): ReadOnlyResultPresentation {
  if (result.status !== "success") {
    if (result.status === "policy_denied") {
      return {
        safeSummary: "Run blocked by safety policy.",
        safePreviewItems: [],
      };
    }

    return {
      safeSummary: "The read-only action could not run.",
      safePreviewItems: [],
    };
  }

  switch (result.toolId) {
    case "tasks.list":
      return tasksPresentation(result.data);
    case "calendar.list_today":
      return calendarPresentation(result.data);
    case "learning.get_progress":
      return learningPresentation(result.data);
    case "workspace.get_context":
      return {
        safeSummary: "Workspace context loaded.",
        safePreviewItems: [],
      };
    case "github.repositories.list":
      return githubPresentation(result.data);
    case "github.issues.list":
      return githubIssuesPresentation(result.data);
    case "github.epics.list":
      return githubEpicsPresentation(result.data);
    case "github.pulls.list":
      return githubPullRequestsPresentation(result.data);
    case "github.workflow_runs.list":
      return githubWorkflowRunsPresentation(result.data);
    default:
      return {
        safeSummary: "The read-only action completed.",
        safePreviewItems: [],
      };
  }
}
