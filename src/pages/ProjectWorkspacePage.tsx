import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  ExternalLink,
  FileText,
  GitBranch,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/contexts/PageTitleContext";
import type { BriefProvenance, ProjectBrief, ProjectBriefSingleValueField, ProjectBriefTextItem } from "@/features/projects/projectBriefTypes";
import { smartflowProjectWorkspaceFixture, type ProjectWorkspaceModel, type ProjectWorkspaceRefreshStatus } from "@/features/projects/projectWorkspaceFixture";
import type { ProjectWorkspaceReadResult } from "@/features/projects/projectWorkspaceReadService";

type SemanticTone = "neutral" | "success" | "warning" | "danger";

const toneClasses: Record<SemanticTone, string> = {
  neutral: "border-border bg-muted/30 text-muted-foreground",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-destructive/35 bg-destructive/10 text-destructive",
};

function formatDateTime(value?: string) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function StateBadge({ children, tone = "neutral" }: Readonly<{ children: string; tone?: SemanticTone }>) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium", toneClasses[tone])}>
      {children}
    </span>
  );
}

function provenanceLabel(provenance: BriefProvenance) {
  return [provenance.sourceReference, provenance.sectionHeading].filter(Boolean).join(" - ");
}

function ProvenanceDetails({
  provenance,
  conflictedWith,
  sample,
}: Readonly<{ provenance: BriefProvenance; conflictedWith?: readonly BriefProvenance[]; sample: boolean }>) {
  return (
    <details className="group mt-3 rounded-md border border-border bg-background/60 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span>{sample ? "Sample provenance" : "Sources / provenance"}</span>
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <dl className="mt-3 grid gap-2 text-foreground sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Source reference</dt>
          <dd className="break-words">{provenance.sourceReference}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Source kind</dt>
          <dd>{provenance.sourceKind}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Section</dt>
          <dd>{provenance.sectionHeading ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Evidence</dt>
          <dd>{provenance.sourceEvidenceId}</dd>
        </div>
      </dl>
      {conflictedWith && conflictedWith.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="font-medium text-destructive">Conflicts with</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {conflictedWith.map((source) => (
              <li key={`${source.sourceEvidenceId}:${source.sourceReference}`}>
                {provenanceLabel(source)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

function SingleValueField({ label, field, sample }: Readonly<{ label: string; field: ProjectBriefSingleValueField<string>; sample: boolean }>) {
  if (field.status === "unknown") {
    return (
      <section className="rounded-lg border border-border bg-card p-4" aria-label={label}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
          <StateBadge>Unknown</StateBadge>
        </div>
        <p className="text-base text-foreground">No supported source declared this yet.</p>
      </section>
    );
  }

  if (field.status === "conflicted") {
    return (
      <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4" aria-label={label}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
          <StateBadge tone="danger">Conflicted</StateBadge>
        </div>
        <ul className="space-y-3">
          {field.candidates.map((candidate) => (
            <li key={`${candidate.value}:${candidate.provenance.sourceEvidenceId}`}>
              <p className="text-base font-medium text-foreground">{candidate.value}</p>
              <ProvenanceDetails provenance={candidate.provenance} sample={sample} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label={label}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
        <StateBadge tone="success">Known</StateBadge>
      </div>
      <p className="text-base font-medium text-foreground">{field.value}</p>
      <ProvenanceDetails provenance={field.provenance} sample={sample} />
    </section>
  );
}

function ItemList({
  title,
  items,
  emptyLabel,
  tone = "neutral",
  sample,
}: Readonly<{ title: string; items: readonly ProjectBriefTextItem[]; emptyLabel: string; tone?: SemanticTone; sample: boolean }>) {
  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby={`${title.replace(/\s+/g, "-").toLowerCase()}-heading`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={`${title.replace(/\s+/g, "-").toLowerCase()}-heading`} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <StateBadge tone={items.length > 0 ? tone : "neutral"}>{items.length > 0 ? `${items.length}` : "Unavailable"}</StateBadge>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((itemValue) => (
            <li key={`${title}:${itemValue.text}:${itemValue.provenance.sourceEvidenceId}`} className="rounded-md border border-border bg-background/55 p-3">
              <div className="flex gap-2">
                {itemValue.conflictedWith && itemValue.conflictedWith.length > 0 ? (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                )}
                <p className="text-sm leading-6 text-foreground">{itemValue.text}</p>
              </div>
              <ProvenanceDetails provenance={itemValue.provenance} conflictedWith={itemValue.conflictedWith} sample={sample} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RefreshPanel({
  refresh,
  cliCommand,
  sample,
  onReload,
}: Readonly<{ refresh: ProjectWorkspaceRefreshStatus; cliCommand: string; sample: boolean; onReload?: () => void }>) {
  const tone: SemanticTone =
    refresh.status === "completed" ? "success" : refresh.status === "failed" || refresh.status === "failed_partial" ? "danger" : "warning";
  const hasCounts = "createdCount" in refresh;

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="refresh-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="refresh-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh state
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Last refresh: {refresh.lastRefreshAt ? formatDateTime(refresh.lastRefreshAt) : "Not refreshed in browser"}</p>
        </div>
        <StateBadge tone={tone}>{refresh.label}</StateBadge>
      </div>
      <p className="mt-3 text-sm leading-6 text-foreground">{refresh.message}</p>
      {hasCounts && (
        <dl className={cn("mt-4 grid gap-2 text-sm", sample ? "grid-cols-3" : "grid-cols-2")}>
          <div className="rounded-md border border-border bg-background/60 p-2">
            <dt className="text-muted-foreground">{sample ? "Created" : "Included evidence"}</dt>
            <dd className="font-semibold">{refresh.createdCount}</dd>
          </div>
          <div className="rounded-md border border-border bg-background/60 p-2">
            <dt className="text-muted-foreground">{sample ? "Unchanged" : "Excluded superseded"}</dt>
            <dd className="font-semibold">{refresh.unchangedCount}</dd>
          </div>
          {/* Live mode has no persisted refresh-run history, so a "Failed"
              count here would be a fabricated claim, not a real observation
              -- this tile is sample/demo-only, never rendered for live data. */}
          {sample && (
            <div className="rounded-md border border-border bg-background/60 p-2">
              <dt className="text-muted-foreground">Failed</dt>
              <dd className="font-semibold">{refresh.failedCount}</dd>
            </div>
          )}
        </dl>
      )}
      {"errorCode" in refresh && <p className="mt-3 text-sm text-destructive">Error: {refresh.errorCode}</p>}
      <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 p-3">
        <p className="text-sm font-medium text-foreground">Run local refresh</p>
        <p className="mt-1 text-sm text-muted-foreground">Browser refresh is not wired. Run the trusted local command outside the browser, then reload persisted data.</p>
        <code className="mt-3 block overflow-x-auto rounded-md bg-background px-3 py-2 text-xs text-foreground">{cliCommand}</code>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" disabled aria-label="Run local refresh is unavailable in the browser">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Run local refresh
          </Button>
          <Button type="button" variant="outline" onClick={onReload ?? (() => window.location.reload())} aria-label={sample ? "Reload sample workspace preview" : "Reload persisted project data"}>
            {sample ? "Reload sample preview" : "Reload data"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function ConflictPanel({ brief }: Readonly<{ brief: ProjectBrief }>) {
  const conflictWarnings = brief.extractionWarnings.filter((warning) => warning.code.includes("CONFLICT"));
  const conflictCount =
    (brief.currentPhase.status === "conflicted" ? brief.currentPhase.candidates.length : 0) +
    (brief.currentFocus.status === "conflicted" ? brief.currentFocus.candidates.length : 0) +
    brief.completedMilestones.filter((itemValue) => itemValue.conflictedWith && itemValue.conflictedWith.length > 0).length +
    conflictWarnings.length;

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="conflicts-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="conflicts-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Conflicts
        </h2>
        <StateBadge tone={conflictCount > 0 ? "danger" : "success"}>{conflictCount > 0 ? `${conflictCount}` : "None"}</StateBadge>
      </div>
      {conflictCount === 0 ? (
        <p className="text-sm text-muted-foreground">No conflicting Project Brief statements are present.</p>
      ) : (
        <ul className="space-y-3 text-sm text-foreground">
          {brief.currentPhase.status === "conflicted" && <li>Current phase has conflicting candidates.</li>}
          {brief.currentFocus.status === "conflicted" && <li>Current focus has conflicting candidates.</li>}
          {brief.completedMilestones
            .filter((itemValue) => itemValue.conflictedWith && itemValue.conflictedWith.length > 0)
            .map((itemValue) => (
              <li key={itemValue.text}>{itemValue.text}</li>
            ))}
          {conflictWarnings.map((warning) => (
            <li key={`${warning.code}:${warning.sourceEvidenceId}`} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="font-medium text-destructive">{warning.code}</p>
              <p className="mt-2 leading-6">{warning.message}</p>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Source reference</dt>
                  <dd className="break-words">{warning.sourceReference}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Section</dt>
                  <dd>{warning.sectionHeading ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Evidence</dt>
                  <dd>{warning.sourceEvidenceId}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConversationPanel({ model, sample }: Readonly<{ model: ProjectWorkspaceModel; sample: boolean }>) {
  return (
    <aside className="rounded-lg border border-border bg-card p-4 lg:sticky lg:top-6" aria-labelledby="conversation-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Conversation</p>
          <h2 id="conversation-heading" className="mt-1 flex items-center gap-2 text-lg font-semibold text-foreground">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
            SmartFlow chat
          </h2>
        </div>
        <StateBadge tone={model.briefAvailable && !sample ? "success" : "warning"}>{sample ? "Sample brief preview" : model.briefAvailable ? "Live brief available" : "No live brief"}</StateBadge>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-background/60 p-3">
        <p className="text-sm font-medium text-foreground">Project: {model.projectName}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This panel reuses the existing SmartFlow chat route. The brief is visible here, but it is not injected into prompts in this slice.
        </p>
      </div>
      <Button asChild className="mt-4 w-full" variant="outline">
        <Link to="/chat" aria-label="Open existing SmartFlow chat">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open conversation
        </Link>
      </Button>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        No semantic memory, RAG, or live Project Brief awareness is claimed by this workspace conversation panel.
      </p>
    </aside>
  );
}

function SourceIndex({ brief, sample }: Readonly<{ brief: ProjectBrief; sample: boolean }>) {
  const sources = useMemo(
    () =>
      [...brief.sourceReferences].sort((a, b) => a.sourceReference.localeCompare(b.sourceReference) || a.sourceEvidenceId.localeCompare(b.sourceEvidenceId)),
    [brief.sourceReferences],
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4" aria-hidden="true" />
        {sample ? "Sample provenance" : "Sources / provenance"}
      </h2>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {sources.map((source) => (
          <li key={`${source.sourceEvidenceId}:${source.sourceReference}`} className="rounded-md border border-border bg-background/60 p-3 text-sm">
            <p className="font-medium text-foreground">{source.sourceReference}</p>
            <p className="mt-1 text-muted-foreground">{source.sourceKind}</p>
            <p className="mt-1 text-muted-foreground">{source.sectionHeading ?? "Section unavailable"}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProjectWorkspaceView({ model = smartflowProjectWorkspaceFixture, onReload }: Readonly<{ model?: ProjectWorkspaceModel; onReload?: () => void }>) {
  const [secondaryOpen, setSecondaryOpen] = useState(true);
  const { setPageTitle } = usePageTitle();
  const topAction = model.brief.explicitNextActions[0];
  const sample = model.integration === "fixture";

  useEffect(() => {
    setPageTitle({ title: "Project Workspace", subtitle: model.projectName });
    return () => setPageTitle(null);
  }, [model.projectName, setPageTitle]);

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]" data-testid="project-workspace-layout">
        <div className="space-y-5">
          <header className="rounded-lg border border-border bg-card p-5">
            {sample && (
              <section className="mb-5 rounded-lg border border-warning/35 bg-warning/10 p-4" aria-label="Demo fixture notice">
                <p className="text-sm font-semibold text-foreground">Demo fixture only - not live or persisted</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  These are sample Project Brief values for UX review. No persisted Evidence or live Project Brief has been loaded by this browser page.
                </p>
              </section>
            )}
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Workspace</p>
                <h1 className="mt-2 text-2xl font-semibold text-foreground">{model.projectName}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {sample
                    ? "Sample project situation first. Conversation stays visible, but this fixture does not represent live persisted project state."
                    : "Project situation first. Conversation stays visible, but the Project Brief is not injected into prompts in this slice."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StateBadge tone={sample ? "warning" : "success"}>{sample ? "Fixture/dev adapter" : "Live persisted data"}</StateBadge>
                <StateBadge tone={sample ? "warning" : "success"}>{sample ? "Sample brief preview" : "Live brief available"}</StateBadge>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <SingleValueField label="Current phase" field={model.brief.currentPhase} sample={sample} />
              <SingleValueField label="Current focus" field={model.brief.currentFocus} sample={sample} />
              <section className="rounded-lg border border-border bg-background/60 p-4" aria-label="Top explicit next action">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-muted-foreground">Top explicit next action</h2>
                  <StateBadge tone={topAction ? "success" : "neutral"}>{topAction ? "Known" : "Unknown"}</StateBadge>
                </div>
                {topAction ? (
                  <>
                    <p className="text-base font-medium text-foreground">{topAction.text}</p>
                    <ProvenanceDetails provenance={topAction.provenance} sample={sample} />
                  </>
                ) : (
                  <p className="text-base text-foreground">No explicit next action exists in the brief.</p>
                )}
              </section>
            </div>
          </header>

          <RefreshPanel refresh={model.refresh} cliCommand={model.cliCommand} sample={sample} onReload={onReload} />

          <section className="grid gap-4 lg:grid-cols-2" aria-label="Primary project brief sections">
            <ItemList title="Explicit next actions" items={model.brief.explicitNextActions} emptyLabel="No explicit next actions were extracted." tone="success" sample={sample} />
            <ItemList title="Completed milestones" items={model.brief.completedMilestones} emptyLabel="No completed milestones were extracted." tone="success" sample={sample} />
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSecondaryOpen((open) => !open)}
              aria-expanded={secondaryOpen}
              aria-controls="secondary-project-brief"
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">Secondary Project Brief</span>
                <span className="block text-sm text-muted-foreground">Decisions, risks, debt, limitations, and scope distinctions.</span>
              </span>
              <ChevronDown className={cn("h-5 w-5 transition-transform", secondaryOpen && "rotate-180")} aria-hidden="true" />
            </button>
            {secondaryOpen && (
              <div id="secondary-project-brief" className="mt-4 grid gap-4 lg:grid-cols-2">
                <ItemList title="Accepted decisions" items={model.brief.acceptedDecisions} emptyLabel="No accepted decisions were extracted." tone="success" sample={sample} />
                <ItemList title="Open decisions" items={model.brief.openDecisions} emptyLabel="No open decisions were extracted." tone="warning" sample={sample} />
                <ItemList title="Risks" items={model.brief.knownRisks} emptyLabel="No known risks were extracted." tone="warning" sample={sample} />
                <ItemList title="Technical debt" items={model.brief.technicalDebt} emptyLabel="No technical debt was extracted." tone="warning" sample={sample} />
                <ItemList title="Limitations" items={model.brief.limitations} emptyLabel="No limitations were extracted." sample={sample} />
                <ItemList title="Decision consequences" items={model.brief.decisionConsequences} emptyLabel="No decision consequences were extracted." sample={sample} />
                <ItemList title="Non-goals" items={model.brief.nonGoals} emptyLabel="No non-goals were extracted." sample={sample} />
                <ItemList title="Deferred items" items={model.brief.deferredItems} emptyLabel="No deferred items were extracted." sample={sample} />
                <ItemList title="Out of scope" items={model.brief.outOfScope} emptyLabel="No out-of-scope items were extracted." sample={sample} />
                <ConflictPanel brief={model.brief} />
              </div>
            )}
          </section>

          <SourceIndex brief={model.brief} sample={sample} />

          <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="honest-states-heading">
            <h2 id="honest-states-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CircleHelp className="h-4 w-4" aria-hidden="true" />
              Honest states
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {["known", "unknown", "conflicted", "unavailable", "not yet refreshed", "refresh failed", "partially refreshed", "stale"].map((state) => (
                <StateBadge key={state}>{state}</StateBadge>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <ConversationPanel model={model} sample={sample} />
          <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="identity-heading">
            <h2 id="identity-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <GitBranch className="h-4 w-4" aria-hidden="true" />
              Project identity
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Brief generated</dt>
                <dd className="text-right text-foreground">{model.generatedAt ? formatDateTime(model.generatedAt) : "Sample only"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Snapshot</dt>
                <dd className="text-right text-foreground">{model.brief.snapshotHash.slice(0, 12)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Evidence items</dt>
                <dd className="text-right text-foreground">{model.brief.evidenceIds.length}</dd>
              </div>
            </dl>
            <div className="mt-4 rounded-md border border-border bg-background/60 p-3">
              <div className="flex gap-2">
                <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-sm leading-6 text-muted-foreground">
                  {sample
                    ? "Sample identifiers are available only inside provenance drill-downs, not as primary page labels."
                    : "Evidence identifiers are available only inside provenance drill-downs, not as primary page labels."}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

const LOCAL_REFRESH_COMMAND = "npm --silent run smartflow:refresh-project -- --project-id <project-id> --repo-root <trusted-local-repo-path> --json";

function liveRefreshFor(result: ProjectWorkspaceReadResult): ProjectWorkspaceRefreshStatus {
  if (result.status === "ready") {
    return {
      status: "completed",
      label: "Last evidence snapshot",
      lastRefreshAt: result.snapshotMetadata?.snapshotCreatedAt ?? new Date(0).toISOString(),
      createdCount: result.snapshotMetadata?.includedEvidenceCount ?? 0,
      unchangedCount: result.snapshotMetadata?.excludedSupersededEvidenceCount ?? 0,
      failedCount: 0,
      message: "Live persisted Project Brief loaded from existing ProjectEvidence. Browser refresh is not implemented.",
    };
  }
  return {
    status: result.status === "unavailable" ? "unavailable" : "not_yet_refreshed",
    label: result.status === "not_refreshed" ? "Not refreshed" : result.status === "no_supported_content" ? "No supported content" : "Unavailable",
    message: result.dataState,
  };
}

function modelFromReadyResult(result: ProjectWorkspaceReadResult): ProjectWorkspaceModel {
  if (!result.project || !result.brief) {
    throw new Error("Project workspace result is not ready.");
  }
  return {
    integration: "live",
    projectId: result.project.id,
    projectName: result.project.name,
    briefAvailable: true,
    generatedAt: result.brief.generatedAt,
    cliCommand: LOCAL_REFRESH_COMMAND,
    refresh: liveRefreshFor(result),
    brief: result.brief,
  };
}

function WorkspaceStatePanel({ result, onReload }: Readonly<{ result: ProjectWorkspaceReadResult; onReload: () => void }>) {
  const projectName = result.project?.name ?? "Project workspace";
  return (
    <main className="mx-auto max-w-[960px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="workspace-state-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Workspace</p>
            <h1 id="workspace-state-heading" className="mt-2 text-2xl font-semibold text-foreground">
              {projectName}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{result.dataState}</p>
          </div>
          <StateBadge tone={result.status === "failed" ? "danger" : "warning"}>{result.status.replace(/_/g, " ")}</StateBadge>
        </div>
        {result.error && <p className="mt-4 text-sm text-muted-foreground">{result.error.message}</p>}
        <div className="mt-5 rounded-md border border-warning/30 bg-warning/10 p-3">
          <p className="text-sm font-medium text-foreground">Run local refresh</p>
          <p className="mt-1 text-sm text-muted-foreground">Browser refresh is not wired. Run the trusted local command outside the browser, then reload persisted data.</p>
          <code className="mt-3 block overflow-x-auto rounded-md bg-background px-3 py-2 text-xs text-foreground">{LOCAL_REFRESH_COMMAND}</code>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled aria-label="Run local refresh is unavailable in the browser">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Run local refresh
            </Button>
            <Button type="button" variant="outline" onClick={onReload} aria-label="Reload persisted project data">
              Reload data
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function ProjectWorkspaceLoading() {
  return (
    <main className="mx-auto max-w-[960px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="rounded-lg border border-border bg-card p-5" aria-live="polite">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Workspace</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Loading project workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">Reading persisted ProjectRecord and ProjectEvidence data.</p>
      </section>
    </main>
  );
}

export function DemoProjectWorkspacePage() {
  return <ProjectWorkspaceView />;
}

export default function ProjectWorkspacePage() {
  const { projectId } = useParams();
  const [result, setResult] = useState<ProjectWorkspaceReadResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    import("@/features/projects/projectWorkspaceBrowserReadService").then(({ browserProjectWorkspaceReadService }) =>
      browserProjectWorkspaceReadService.readProjectWorkspace(projectId ?? ""),
    ).then((nextResult) => {
      if (!cancelled) setResult(nextResult);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  if (!result) return <ProjectWorkspaceLoading />;
  if (result.status !== "ready") return <WorkspaceStatePanel result={result} onReload={reload} />;
  return <ProjectWorkspaceView model={modelFromReadyResult(result)} onReload={reload} />;
}
