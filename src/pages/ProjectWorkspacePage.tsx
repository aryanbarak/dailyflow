import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
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

/** Renders one situation fact as a full-width row (no card chrome of its own) -- used inside SituationSection so Phase/Focus/Next-action each get the section's full reading width instead of being squeezed into a narrow column. */
function SituationField({ label, field, sample }: Readonly<{ label: string; field: ProjectBriefSingleValueField<string>; sample: boolean }>) {
  if (field.status === "unknown") {
    return (
      <div aria-label={label}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
          <StateBadge>Unknown</StateBadge>
        </div>
        <p className="mt-1 text-base text-foreground">No supported source declared this yet.</p>
      </div>
    );
  }

  if (field.status === "conflicted") {
    return (
      <div aria-label={label}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
          <StateBadge tone="danger">Conflicted</StateBadge>
        </div>
        <ul className="mt-1 space-y-3">
          {field.candidates.map((candidate) => (
            <li key={`${candidate.value}:${candidate.provenance.sourceEvidenceId}`}>
              <p className="text-base font-medium text-foreground">{candidate.value}</p>
              <ProvenanceDetails provenance={candidate.provenance} sample={sample} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div aria-label={label}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
        <StateBadge tone="success">Known</StateBadge>
      </div>
      <p className="mt-1 text-base font-medium text-foreground">{field.value}</p>
      <ProvenanceDetails provenance={field.provenance} sample={sample} />
    </div>
  );
}

function NextActionField({ action, sample }: Readonly<{ action?: ProjectBriefTextItem; sample: boolean }>) {
  return (
    <div aria-label="Next explicit action">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Next explicit action</h3>
        <StateBadge tone={action ? "success" : "neutral"}>{action ? "Known" : "Unknown"}</StateBadge>
      </div>
      {action ? (
        <>
          <p className="mt-1 text-base font-medium text-foreground">{action.text}</p>
          <ProvenanceDetails provenance={action.provenance} sample={sample} />
        </>
      ) : (
        <p className="mt-1 text-base text-foreground">No explicit next action exists in the brief.</p>
      )}
    </div>
  );
}

/** One coherent, full-width situation section -- current phase, current focus, next explicit action -- replacing the former three-narrow-card grid so none of the three is squeezed into a fraction of the page width. */
function SituationSection({
  brief,
  sample,
  topAction,
}: Readonly<{ brief: ProjectBrief; sample: boolean; topAction?: ProjectBriefTextItem }>) {
  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="situation-heading">
      <h2 id="situation-heading" className="text-sm font-semibold text-foreground">
        Current situation
      </h2>
      <div className="mt-4 divide-y divide-border">
        <div className="pb-4">
          <SituationField label="Current phase" field={brief.currentPhase} sample={sample} />
        </div>
        <div className="py-4">
          <SituationField label="Current focus" field={brief.currentFocus} sample={sample} />
        </div>
        <div className="pt-4">
          <NextActionField action={topAction} sample={sample} />
        </div>
      </div>
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
        <h3 id={`${title.replace(/\s+/g, "-").toLowerCase()}-heading`} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
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

function computeConflictCount(brief: ProjectBrief): number {
  const conflictWarnings = brief.extractionWarnings.filter((warning) => warning.code.includes("CONFLICT"));
  return (
    (brief.currentPhase.status === "conflicted" ? brief.currentPhase.candidates.length : 0) +
    (brief.currentFocus.status === "conflicted" ? brief.currentFocus.candidates.length : 0) +
    brief.completedMilestones.filter((itemValue) => itemValue.conflictedWith && itemValue.conflictedWith.length > 0).length +
    conflictWarnings.length
  );
}

function ConflictPanel({ brief }: Readonly<{ brief: ProjectBrief }>) {
  const conflictWarnings = brief.extractionWarnings.filter((warning) => warning.code.includes("CONFLICT"));
  const conflictCount = computeConflictCount(brief);

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="conflicts-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id="conflicts-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Conflicts
        </h3>
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
      <h3 id="sources-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText className="h-4 w-4" aria-hidden="true" />
        {sample ? "Sample provenance" : "Sources / provenance"}
      </h3>
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

/** Every semantic category not part of the primary situation, kept as its own distinct, clearly labeled section, tucked behind one accessible disclosure so a project with a lot of history does not overwhelm the page by default. Opens by default only when a real conflict exists, so conflicts stay visible without forcing every other category open too. */
function SecondarySection({
  brief,
  sample,
  open,
  onToggle,
  conflictCount,
}: Readonly<{ brief: ProjectBrief; sample: boolean; open: boolean; onToggle: () => void; conflictCount: number }>) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="secondary-project-brief"
      >
        <span>
          <span className="block text-sm font-semibold text-foreground">More project details</span>
          <span className="block text-sm text-muted-foreground">
            Next actions, milestones, decisions, risks, debt, limitations, scope, and sources
            {conflictCount > 0 ? ` -- includes ${conflictCount} conflict${conflictCount === 1 ? "" : "s"}` : ""}.
          </span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div id="secondary-project-brief" className="mt-4 grid gap-4 lg:grid-cols-2">
          <ItemList title="Explicit next actions" items={brief.explicitNextActions} emptyLabel="No explicit next actions were extracted." tone="success" sample={sample} />
          <ItemList title="Completed milestones" items={brief.completedMilestones} emptyLabel="No completed milestones were extracted." tone="success" sample={sample} />
          <ItemList title="Accepted decisions" items={brief.acceptedDecisions} emptyLabel="No accepted decisions were extracted." tone="success" sample={sample} />
          <ItemList title="Open decisions" items={brief.openDecisions} emptyLabel="No open decisions were extracted." tone="warning" sample={sample} />
          <ItemList title="Risks" items={brief.knownRisks} emptyLabel="No known risks were extracted." tone="warning" sample={sample} />
          <ItemList title="Technical debt" items={brief.technicalDebt} emptyLabel="No technical debt was extracted." tone="warning" sample={sample} />
          <ItemList title="Limitations" items={brief.limitations} emptyLabel="No limitations were extracted." sample={sample} />
          <ItemList title="Decision consequences" items={brief.decisionConsequences} emptyLabel="No decision consequences were extracted." sample={sample} />
          <ItemList title="Non-goals" items={brief.nonGoals} emptyLabel="No non-goals were extracted." sample={sample} />
          <ItemList title="Deferred items" items={brief.deferredItems} emptyLabel="No deferred items were extracted." sample={sample} />
          <ItemList title="Out of scope" items={brief.outOfScope} emptyLabel="No out-of-scope items were extracted." sample={sample} />
          <ConflictPanel brief={brief} />
          <SourceIndex brief={brief} sample={sample} />
        </div>
      )}
    </section>
  );
}

const LOCAL_REFRESH_COMMAND = "npm --silent run smartflow:refresh-project -- --project-id <project-id> --repo-root <trusted-local-repo-path> --json";

/** Refresh state, counts, and the local-refresh CLI instructions -- tucked behind one accessible disclosure under the compact header rather than a permanently visible card, so it never competes with the primary situation for attention. */
function RefreshDetails({
  refresh,
  cliCommand,
  sample,
}: Readonly<{ refresh: ProjectWorkspaceRefreshStatus; cliCommand: string; sample: boolean }>) {
  const hasCounts = "createdCount" in refresh;
  const tone: SemanticTone =
    refresh.status === "completed" ? "success" : refresh.status === "failed" || refresh.status === "failed_partial" ? "danger" : "warning";

  return (
    <details className="mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Refresh details &amp; local refresh instructions
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge tone={tone}>{refresh.label}</StateBadge>
          <span className="text-xs text-muted-foreground">Last refresh: {refresh.lastRefreshAt ? formatDateTime(refresh.lastRefreshAt) : "Not refreshed in browser"}</span>
        </div>
        <p className="text-sm leading-6 text-foreground">{refresh.message}</p>
        {hasCounts && (
          <dl className={cn("grid gap-2 text-sm", sample ? "grid-cols-3" : "grid-cols-2")}>
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
        {"errorCode" in refresh && <p className="text-sm text-destructive">Error: {refresh.errorCode}</p>}
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
          <p className="text-sm font-medium text-foreground">Run local refresh</p>
          <p className="mt-1 text-sm text-muted-foreground">Browser refresh is not wired. Run the trusted local command outside the browser, then reload persisted data.</p>
          <code className="mt-3 block overflow-x-auto rounded-md bg-background px-3 py-2 text-xs text-foreground">{cliCommand}</code>
          <Button type="button" disabled size="sm" className="mt-3" aria-label="Run local refresh is unavailable in the browser">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Run local refresh
          </Button>
        </div>
      </div>
    </details>
  );
}

/** Compact header: project name, live/demo state, last evidence snapshot metadata at a glance, and the Reload data action. No large banner in live mode -- refresh detail and local-refresh instructions live behind one disclosure instead of a permanently visible card. */
function WorkspaceHeader({
  model,
  sample,
  onReload,
}: Readonly<{ model: ProjectWorkspaceModel; sample: boolean; onReload?: () => void }>) {
  const snapshotSummary = model.refresh.lastRefreshAt
    ? `Last evidence snapshot ${formatDateTime(model.refresh.lastRefreshAt)}`
    : sample
      ? "Sample fixture data - not live or persisted"
      : "Not refreshed yet";

  return (
    <header className="rounded-lg border border-border bg-card px-4 py-3 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Workspace</p>
          <h1 className="mt-1 truncate text-xl font-semibold text-foreground sm:text-2xl">{model.projectName}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{snapshotSummary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge tone={sample ? "warning" : "success"}>{sample ? "Fixture/dev adapter" : "Live persisted data"}</StateBadge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReload ?? (() => window.location.reload())}
            aria-label={sample ? "Reload sample workspace preview" : "Reload persisted project data"}
          >
            {sample ? "Reload sample preview" : "Reload data"}
          </Button>
        </div>
      </div>
      <RefreshDetails refresh={model.refresh} cliCommand={model.cliCommand} sample={sample} />
    </header>
  );
}

function DemoBanner() {
  return (
    <section className="rounded-lg border border-warning/35 bg-warning/10 p-4" aria-label="Demo fixture notice">
      <p className="text-sm font-semibold text-foreground">Demo fixture only - not live or persisted</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        These are sample Project Brief values for UX review. No persisted Evidence or live Project Brief has been loaded by this browser page.
      </p>
    </section>
  );
}

export function ProjectWorkspaceView({ model = smartflowProjectWorkspaceFixture, onReload }: Readonly<{ model?: ProjectWorkspaceModel; onReload?: () => void }>) {
  const { setPageTitle } = usePageTitle();
  const sample = model.integration === "fixture";
  const topAction = model.brief.explicitNextActions[0];
  const conflictCount = useMemo(() => computeConflictCount(model.brief), [model.brief]);
  const [secondaryOpen, setSecondaryOpen] = useState(() => conflictCount > 0);

  useEffect(() => {
    setPageTitle({ title: "Project Workspace", subtitle: model.projectName });
    return () => setPageTitle(null);
  }, [model.projectName, setPageTitle]);

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]" data-testid="project-workspace-layout">
        <div className="space-y-5">
          <WorkspaceHeader model={model} sample={sample} onReload={onReload} />
          {sample && <DemoBanner />}
          <SituationSection brief={model.brief} sample={sample} topAction={topAction} />
          <SecondarySection
            brief={model.brief}
            sample={sample}
            open={secondaryOpen}
            onToggle={() => setSecondaryOpen((current) => !current)}
            conflictCount={conflictCount}
          />
        </div>

        <div className="space-y-5">
          <ConversationPanel model={model} sample={sample} />
        </div>
      </div>
    </main>
  );
}

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
