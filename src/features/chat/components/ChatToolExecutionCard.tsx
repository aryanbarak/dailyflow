// Chat Runtime Truth / Tool Timeline V1 -- the ONE renderer for a
// consequential Task/Calendar execution card in Chat, used identically for
// (a) newly created live execution state (ChatPage's transient
// TwoActionPendingState machinery, adapted through a view model) and
// (b) execution state reconstructed after reload from the authoritative
// agent_tool_executions rows (chatToolExecutionProjection.ts). One
// renderer for the same runtime truth -- no separate "live" vs "history"
// card implementations to drift apart.
//
// TRUTH RULES this component enforces visually (slice sections 11-13):
//   - argumentLines render under a "Requested" label -- they are the bound
//     INPUTS, never proof of what was persisted;
//   - a success claim appears ONLY for status 'succeeded' (the durable
//     row's own word, or the Worker's own approve response) -- never
//     inferred from anything else;
//   - 'uncertain' is presented as exactly that -- neither success nor
//     failure, no retry affordance;
//   - approve/reject affordances exist ONLY in 'approval_pending';
//     approved/executing/terminal states render with no execution buttons.

import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/date";
import { findWriteIntentDescriptorByToolId } from "../../../../shared/writeIntentRegistry";
import type { ChatToolExecutionViewModel } from "@/features/agent/chatToolExecutionProjection";

function toolLabelKey(toolId: string): TranslationKey {
  if (toolId === "tasks.complete") return "agent_intent_title_complete_task";
  const entry = findWriteIntentDescriptorByToolId(toolId);
  return (entry?.i18n.titleKey ?? "agent_intent_title_unsupported") as TranslationKey;
}

export function ChatToolExecutionCard({
  execution,
  onApprove,
  onReject,
}: Readonly<{
  execution: ChatToolExecutionViewModel;
  // Present only when the hosting page can actually perform the action for
  // THIS card (a bound executionId exists). Rendered only in
  // 'approval_pending' regardless.
  onApprove?: () => void;
  onReject?: () => void;
}>) {
  const { t } = useT();
  const status = execution.status;
  const showApprovalActions = status === "approval_pending";

  return (
    <div className="chat-message-enter rounded-lg border border-border bg-card p-3 text-sm" data-execution-status={status}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">
            {t(toolLabelKey(execution.toolId))}
          </p>
          {execution.title && (
            <p className="mt-1 break-words font-medium" dir="auto">{execution.title}</p>
          )}
        </div>
      </div>

      {execution.argumentLines.length > 0 && (
        <div className="mt-2 rounded-lg border border-border/25 bg-background/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("chat_exec_requested_label")}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90" dir="auto">
            {execution.argumentLines.join("\n")}
          </p>
        </div>
      )}

      <div className="mt-2">
        {status === "requesting" && <div className="text-muted-foreground">{t("agent_intent_preparing")}</div>}
        {status === "approval_pending" && (
          <div className="text-muted-foreground">{t("chat_exec_status_approval_pending")}</div>
        )}
        {status === "approving" && <div className="text-muted-foreground">{t("chat_exec_approving")}</div>}
        {status === "revoking" && <div className="text-muted-foreground">{t("chat_exec_revoking")}</div>}
        {status === "approved" && <div className="text-muted-foreground">{t("chat_exec_status_approved")}</div>}
        {status === "executing" && <div className="text-muted-foreground">{t("chat_exec_status_executing")}</div>}
        {status === "succeeded" && (
          <div className="text-muted-foreground">
            <div className="text-emerald-500">{t("chat_exec_status_succeeded")}</div>
            {execution.resultReply && <div className="mt-1" dir="auto">{execution.resultReply}</div>}
            {(execution.targetType ?? execution.completedAt) && (
              <div className="mt-1 text-xs">
                {execution.targetType && <span>{execution.targetType}</span>}
                {execution.targetId && <span className="ms-1 font-mono text-[11px]">{execution.targetId}</span>}
                {execution.completedAt && <span className="ms-1">· {formatDateTime(execution.completedAt)}</span>}
              </div>
            )}
          </div>
        )}
        {status === "failed" && (
          <div className="text-muted-foreground">
            <div>{t("chat_exec_status_failed")}</div>
            {execution.resultReply && <div className="mt-1" dir="auto">{execution.resultReply}</div>}
            {execution.errorCode && <div className="mt-1 font-mono text-[11px]">{execution.errorCode}</div>}
          </div>
        )}
        {status === "denied" && <div className="text-muted-foreground">{t("chat_exec_status_denied")}</div>}
        {status === "expired" && <div className="text-muted-foreground">{t("chat_exec_status_expired")}</div>}
        {status === "revoked" && <div className="text-muted-foreground">{t("agent_intent_rejected")}</div>}
        {status === "uncertain" && (
          <div className="text-muted-foreground">
            <div>{t("chat_exec_status_uncertain")}</div>
            {execution.resultReply && <div className="mt-1" dir="auto">{execution.resultReply}</div>}
          </div>
        )}
        {status === "error" && <div className="text-destructive">{t("chat_exec_error")}</div>}
      </div>

      {showApprovalActions && (onApprove ?? onReject) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {onApprove && (
            <Button type="button" size="sm" onClick={onApprove}>
              {t("approval_approve")}
            </Button>
          )}
          {onReject && (
            <Button type="button" size="sm" variant="outline" onClick={onReject}>
              {t("approval_reject")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
