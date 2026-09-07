// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS5).
//
// Pure logic, no DOM, no I/O: given a list of PersonalMemoryRecords plus
// already-resolved source lookups (documentChunks/chatTurns/briefings, one
// call each to the respective resolver), produces the node/edge data a
// two-tier provenance graph renders. Deliberately NOT a general knowledge
// graph -- there is only ever one source per record's own
// sourceReferenceIds in practice (see PersonalMemorySection.tsx's own
// documentSourceLine, which likewise only ever shows the first resolvable
// citation), so this stays a simple bipartite structure: memory-record
// nodes on one side, their resolved source nodes on the other.

import type { PersonalMemoryRecord, PersonalMemoryRecordKind } from "./personalMemoryRecordTypes";
import { personalMemoryRecordPrimaryText } from "./personalMemoryRecordPresentation";
import type { DocumentChunkSource } from "@/features/documents/documentChunkSourceResolver";
import type { ProvenanceTextSource } from "./personalMemoryProvenanceSourceResolvers";

export interface ProvenanceMemoryNode {
  readonly recordId: string;
  readonly kind: PersonalMemoryRecordKind;
  readonly primaryText: string;
}

export type ProvenanceSourceKind = "chat_turn" | "briefing" | "document";

export interface ProvenanceSourceNode {
  /** `${sourceKind}:${refId}` -- unique across all three source kinds without needing a shared id space. */
  readonly id: string;
  readonly sourceKind: ProvenanceSourceKind;
  readonly refId: string;
  readonly label: string;
}

export interface ProvenanceEdge {
  readonly recordId: string;
  readonly sourceNodeId: string;
}

export interface ProvenanceGraphData {
  readonly memoryNodes: readonly ProvenanceMemoryNode[];
  readonly sourceNodes: readonly ProvenanceSourceNode[];
  readonly edges: readonly ProvenanceEdge[];
}

export interface ResolvedProvenanceSources {
  readonly documentChunks: Readonly<Record<string, DocumentChunkSource>>;
  readonly chatTurns: Readonly<Record<string, ProvenanceTextSource>>;
  readonly briefings: Readonly<Record<string, ProvenanceTextSource>>;
}

/**
 * Resolves ONE source node for a record, live-first with the same
 * snapshot fallback PersonalMemorySection.tsx's own documentSourceLine
 * uses for a document-sourced record whose cited chunk was later deleted.
 * A record with no resolvable source (a pruned chat_turn/briefing
 * reference, or `explicit_user_statement`, which has no separate source to
 * resolve at all) returns null -- rendered as a memory node with zero
 * edges, not a crash.
 */
function resolveSourceNode(
  record: PersonalMemoryRecord,
  resolved: ResolvedProvenanceSources,
): ProvenanceSourceNode | null {
  const { sourceKind, sourceReferenceIds } = record.provenance;

  if (sourceKind === "document") {
    for (const chunkId of sourceReferenceIds) {
      const live = resolved.documentChunks[chunkId];
      if (live) {
        return { id: `document:${chunkId}`, sourceKind: "document", refId: chunkId, label: `${live.fileName} — ${live.sectionLabel}` };
      }
      const snapshot = record.provenanceSnapshot?.find((entry) => entry.chunkId === chunkId);
      if (snapshot) {
        return { id: `document:${chunkId}`, sourceKind: "document", refId: chunkId, label: `${snapshot.fileName} — ${snapshot.sectionLabel}` };
      }
    }
    return null;
  }

  if (sourceKind === "chat_turn") {
    for (const messageId of sourceReferenceIds) {
      const resolvedTurn = resolved.chatTurns[messageId];
      if (resolvedTurn) return { id: `chat_turn:${messageId}`, sourceKind: "chat_turn", refId: messageId, label: resolvedTurn.label };
    }
    return null;
  }

  if (sourceKind === "briefing") {
    for (const briefingId of sourceReferenceIds) {
      const resolvedBriefing = resolved.briefings[briefingId];
      if (resolvedBriefing) return { id: `briefing:${briefingId}`, sourceKind: "briefing", refId: briefingId, label: resolvedBriefing.label };
    }
    return null;
  }

  // explicit_user_statement: the "source" is the statement itself (ADR-0010
  // section 2.b) -- there is no separate source item to resolve.
  return null;
}

export function buildProvenanceGraphData(
  records: readonly PersonalMemoryRecord[],
  resolved: ResolvedProvenanceSources,
): ProvenanceGraphData {
  const memoryNodes: ProvenanceMemoryNode[] = [];
  const sourceNodesById = new Map<string, ProvenanceSourceNode>();
  const edges: ProvenanceEdge[] = [];

  for (const record of records) {
    memoryNodes.push({
      recordId: record.id,
      kind: record.kind,
      primaryText: personalMemoryRecordPrimaryText(record.content),
    });

    const sourceNode = resolveSourceNode(record, resolved);
    if (!sourceNode) continue;

    if (!sourceNodesById.has(sourceNode.id)) sourceNodesById.set(sourceNode.id, sourceNode);
    edges.push({ recordId: record.id, sourceNodeId: sourceNode.id });
  }

  return { memoryNodes, sourceNodes: [...sourceNodesById.values()], edges };
}
