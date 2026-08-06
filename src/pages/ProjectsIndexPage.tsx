import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArrowRight, CircleDot } from "lucide-react";
import { StatePanel } from "@/components/common/StatePanel";
import { SkeletonListItem } from "@/components/common/Skeletons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/contexts/PageTitleContext";
import type { ProjectRecord } from "@/features/projects/projectRecordTypes";

type ProjectsIndexState =
  | { status: "loading" }
  | { status: "ready"; projects: readonly ProjectRecord[] }
  | { status: "error"; message: string };

/** Active projects first, then most-recently-created first, then id -- a total, deterministic order regardless of table scan order. */
function sortProjects(projects: readonly ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
}

function ProjectRow({ project }: Readonly<{ project: ProjectRecord }>) {
  const isArchived = project.status === "archived";
  const sourceCount = project.enabledEvidenceSourceKinds.length;

  return (
    <li>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
          isArchived ? "border-border/60 bg-muted/20" : "border-border bg-card",
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-foreground">{project.name}</h2>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
                isArchived ? "border-border text-muted-foreground" : "border-success/30 bg-success/10 text-success",
              )}
            >
              {isArchived ? <Archive className="h-3 w-3" aria-hidden="true" /> : <CircleDot className="h-3 w-3" aria-hidden="true" />}
              {isArchived ? "Archived" : "Active"}
            </span>
          </div>
          {project.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{project.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {sourceCount} evidence source{sourceCount === 1 ? "" : "s"} enabled
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to={`/projects/${project.id}`} aria-label={`Open workspace for ${project.name}`}>
            Open workspace
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </li>
  );
}

export default function ProjectsIndexPage() {
  const { setPageTitle } = usePageTitle();
  const [state, setState] = useState<ProjectsIndexState>({ status: "loading" });

  useEffect(() => {
    setPageTitle({ title: "Projects", subtitle: "Owned project workspaces" });
    return () => setPageTitle(null);
  }, [setPageTitle]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    import("@/features/projects/projectRecordBrowserReadService")
      .then(({ browserProjectRecordReadService }) => browserProjectRecordReadService.list({ includeArchived: true }))
      .then((projects) => {
        if (!cancelled) setState({ status: "ready", projects: sortProjects(projects) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // ProjectRecordError (and everything it wraps) always carries a
        // pre-sanitized message -- see projectRecordService.ts's
        // toProjectRecordError, which never lets a raw persistence error
        // escape. Safe to surface directly.
        const message = error instanceof Error ? error.message : "Projects could not be loaded.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="mb-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Projects</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Your projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">Open a project's live workspace, built from its persisted evidence.</p>
      </header>

      {state.status === "loading" && (
        <ul className="space-y-2" aria-label="Loading projects">
          {Array.from({ length: 3 }).map((_, idx) => (
            <SkeletonListItem key={idx} />
          ))}
        </ul>
      )}

      {state.status === "error" && <StatePanel variant="error" title="Projects could not be loaded" description={state.message} />}

      {state.status === "ready" && state.projects.length === 0 && (
        <StatePanel variant="empty" title="No projects yet" description="No project workspaces exist for your account yet." />
      )}

      {state.status === "ready" && state.projects.length > 0 && (
        <ul className="space-y-2" aria-label="Your projects">
          {state.projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}
    </main>
  );
}
