// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS5).
//
// A two-tier visual over the EXISTING single-hop provenance links --
// memory-record nodes on one side, their resolved source nodes on the
// other, connecting lines. Deliberately not a general knowledge graph: no
// multi-hop entity relationships exist anywhere in this data model to
// visualize (see ADR-0023 SS5). Plain inline SVG over two flex columns, no
// new graph/charting dependency.
//
// Navigation is honest about what actually exists in this app: a
// document-sourced node links to /documents (a real destination). A
// chat_turn/briefing-sourced node has no per-item deep view anywhere in
// this codebase to link to -- its resolved label (an excerpt of the
// actual source text) is shown directly instead of a fake navigation
// affordance.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, FileText, MessageSquare, Newspaper } from "lucide-react";
import { useT, type TranslationKey } from "@/i18n";
import { personalMemoryKindLabel } from "../personalMemoryRecordPresentation";
import type { PersonalMemoryRecordService } from "../personalMemoryRecordService";
import type { ResolveDocumentChunkSources } from "@/features/documents/documentChunkSourceResolver";
import type { ResolveChatTurnSources, ResolveBriefingSources } from "../personalMemoryProvenanceSourceResolvers";
import { buildProvenanceGraphData, type ProvenanceGraphData, type ProvenanceSourceNode } from "../personalMemoryProvenanceGraphData";

export interface PersonalMemoryProvenanceGraphProps {
  readonly service: Pick<PersonalMemoryRecordService, "listByOwner">;
  /** Any resolver omitted degrades gracefully: that source kind's records simply render with no edge, exactly like an unresolvable reference. */
  readonly resolveDocumentSources?: ResolveDocumentChunkSources;
  readonly resolveChatTurnSources?: ResolveChatTurnSources;
  readonly resolveBriefingSources?: ResolveBriefingSources;
}

const SOURCE_KIND_ICON: Record<ProvenanceSourceNode["sourceKind"], typeof FileText> = {
  document: FileText,
  chat_turn: MessageSquare,
  briefing: Newspaper,
};

// TranslationKey is a closed union of literal keys -- a dynamically built
// template-string key would not type-check against it, so the mapping is
// spelled out explicitly rather than interpolated.
const SOURCE_KIND_LABEL_KEY: Record<ProvenanceSourceNode["sourceKind"], TranslationKey> = {
  document: "personal_memory_provenance_graph_node_document",
  chat_turn: "personal_memory_provenance_graph_node_chat_turn",
  briefing: "personal_memory_provenance_graph_node_briefing",
};

export function PersonalMemoryProvenanceGraph({
  service,
  resolveDocumentSources,
  resolveChatTurnSources,
  resolveBriefingSources,
}: Readonly<PersonalMemoryProvenanceGraphProps>) {
  const { t } = useT();
  const navigate = useNavigate();
  const [graph, setGraph] = useState<ProvenanceGraphData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<readonly { x1: number; y1: number; x2: number; y2: number }[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const memoryNodeRefs = useRef(new Map<string, HTMLLIElement>());
  const sourceNodeRefs = useRef(new Map<string, HTMLLIElement>());

  const load = useCallback(async () => {
    try {
      const records = (await service.listByOwner()).filter((record) => record.status !== "user_rejected");

      const documentChunkIds = records.flatMap((r) => (r.provenance.sourceKind === "document" ? r.provenance.sourceReferenceIds : []));
      const chatTurnIds = records.flatMap((r) => (r.provenance.sourceKind === "chat_turn" ? r.provenance.sourceReferenceIds : []));
      const briefingIds = records.flatMap((r) => (r.provenance.sourceKind === "briefing" ? r.provenance.sourceReferenceIds : []));

      const [documentChunks, chatTurns, briefings] = await Promise.all([
        resolveDocumentSources ? resolveDocumentSources(documentChunkIds) : Promise.resolve({}),
        resolveChatTurnSources ? resolveChatTurnSources(chatTurnIds) : Promise.resolve({}),
        resolveBriefingSources ? resolveBriefingSources(briefingIds) : Promise.resolve({}),
      ]);

      setGraph(buildProvenanceGraphData(records, { documentChunks, chatTurns, briefings }));
      setLoadError(null);
    } catch (error) {
      // Plain, untranslated fallback -- see PersonalMemoryExtractionRunHistory.tsx's
      // identical comment: `t` must not be a dependency of a callback the
      // mount-time useEffect depends on, since useT() returns a new
      // closure every render.
      setLoadError(error instanceof Error ? error.message : "Memory provenance could not be loaded.");
    }
  }, [service, resolveDocumentSources, resolveChatTurnSources, resolveBriefingSources]);

  useEffect(() => {
    void load();
  }, [load]);

  const edges = useMemo(() => graph?.edges ?? [], [graph]);

  const measureLines = useCallback(() => {
    const container = containerRef.current;
    if (!container || edges.length === 0) {
      setLines([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const next: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const edge of edges) {
      const fromEl = memoryNodeRefs.current.get(edge.recordId);
      const toEl = sourceNodeRefs.current.get(edge.sourceNodeId);
      if (!fromEl || !toEl) continue;
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      next.push({
        x1: fromRect.right - containerRect.left,
        y1: fromRect.top + fromRect.height / 2 - containerRect.top,
        x2: toRect.left - containerRect.left,
        y2: toRect.top + toRect.height / 2 - containerRect.top,
      });
    }
    setLines(next);
  }, [edges]);

  useLayoutEffect(() => {
    measureLines();
    window.addEventListener("resize", measureLines);
    return () => window.removeEventListener("resize", measureLines);
  }, [measureLines]);

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="personal-memory-provenance-graph-heading">
      <h3 id="personal-memory-provenance-graph-heading" className="text-sm font-semibold text-foreground">
        {t("personal_memory_provenance_graph_title")}
      </h3>

      {loadError && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {loadError}
        </p>
      )}
      {graph === null && !loadError && (
        <p className="mt-3 text-sm text-muted-foreground">{t("personal_memory_provenance_graph_loading")}</p>
      )}
      {graph !== null && graph.memoryNodes.length === 0 && !loadError && (
        <p className="mt-3 text-sm text-muted-foreground">{t("personal_memory_provenance_graph_empty")}</p>
      )}

      {graph !== null && graph.memoryNodes.length > 0 && (
        <div ref={containerRef} className="relative mt-3 flex items-start justify-between gap-6">
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            {lines.map((line) => (
              <line
                key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}`}
                x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.5}
                className="text-muted-foreground"
              />
            ))}
          </svg>

          <ul className="relative z-10 flex-1 space-y-2">
            {graph.memoryNodes.map((node) => (
              <li
                key={node.recordId}
                ref={(el) => {
                  if (el) memoryNodeRefs.current.set(node.recordId, el);
                  else memoryNodeRefs.current.delete(node.recordId);
                }}
                className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs"
              >
                <span className="font-medium uppercase tracking-wide text-muted-foreground">{personalMemoryKindLabel(node.kind)}</span>
                <p className="mt-0.5 truncate text-foreground">{node.primaryText}</p>
              </li>
            ))}
          </ul>

          <ul className="relative z-10 flex-1 space-y-2">
            {graph.sourceNodes.map((node) => {
              const Icon = SOURCE_KIND_ICON[node.sourceKind];
              return (
                <li
                  key={node.id}
                  ref={(el) => {
                    if (el) sourceNodeRefs.current.set(node.id, el);
                    else sourceNodeRefs.current.delete(node.id);
                  }}
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="uppercase tracking-wide">{t(SOURCE_KIND_LABEL_KEY[node.sourceKind])}</span>
                  </div>
                  <p className="mt-0.5 truncate text-foreground">{node.label}</p>
                  {node.sourceKind === "document" && (
                    <button
                      type="button"
                      onClick={() => navigate("/documents")}
                      className="mt-1 text-primary underline-offset-2 hover:underline"
                    >
                      {t("personal_memory_provenance_graph_view_source")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
