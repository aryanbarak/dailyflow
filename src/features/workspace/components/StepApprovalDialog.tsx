import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  approveWorkspaceStep,
  closeWorkspaceStepApproval,
  rejectWorkspaceStep,
  type ApprovalInteractionResult,
} from "@/features/agent/approvalInteraction";
import type { AgentToolDefinition } from "@/features/agent/toolTypes";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type {
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspaceTypes";

export interface StepApprovalDialogProps {
  open: boolean;
  step: WorkspacePlanStep | null;
  stepApproval: WorkspaceStepApproval | null;
  tool?: AgentToolDefinition | null;
  disabled?: boolean;
  onClose: () => void;
  onDecision: (result: ApprovalInteractionResult) => void;
}

export function StepApprovalDialog({
  open,
  step,
  stepApproval,
  tool,
  disabled = false,
  onClose,
  onDecision,
}: Readonly<StepApprovalDialogProps>) {
  const { t, isRTL } = useT();
  const [isDeciding, setIsDeciding] = useState(false);
  const titleId = "workspace-step-approval-title";
  const descriptionId = "workspace-step-approval-description";
  const displayValue = (value: string | boolean | undefined) => {
    if (typeof value === "boolean") return value ? t("yes") : t("no");
    return value || t("approval_not_declared");
  };

  const canDecide = Boolean(step && stepApproval && !disabled && !isDeciding);
  const diagnosticRows = useMemo(
    () => [
      [t("approval_step_id"), step?.id],
      [t("approval_tool_id"), tool?.id ?? stepApproval?.toolId],
      [t("approval_tool_domain"), tool?.domain ?? step?.domain],
      [t("approval_tool_capability"), tool?.capability ?? stepApproval?.toolCapability ?? step?.actionType],
      [t("approval_risk_level"), stepApproval?.riskLevel],
      [t("approval_scope"), stepApproval?.approvalScope],
      [t("approval_read_only"), tool ? tool.mode === "read" : stepApproval?.toolMode ? stepApproval.toolMode === "read" : undefined],
      [t("approval_external_effect"), tool?.externalEffect ?? stepApproval?.externalEffect],
      [t("approval_irreversible"), tool ? !tool.reversible : stepApproval ? !stepApproval.reversible : undefined],
    ],
    [step, stepApproval, t, tool],
  );

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDecision(closeWorkspaceStepApproval());
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onDecision, open]);

  if (!open) return null;

  const handleClose = () => {
    onDecision(closeWorkspaceStepApproval());
    onClose();
  };

  const handleApprove = () => {
    if (!canDecide) return;
    setIsDeciding(true);
    onDecision(approveWorkspaceStep({ step, stepApproval, tool }));
    onClose();
    setIsDeciding(false);
  };

  const handleReject = () => {
    if (!canDecide) return;
    setIsDeciding(true);
    onDecision(rejectWorkspaceStep({ step, stepApproval, tool }));
    onClose();
    setIsDeciding(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        dir={isRTL ? "rtl" : "ltr"}
        className="w-full max-w-xl rounded-2xl border border-primary/20 bg-card p-5 shadow-2xl shadow-black/40"
      >
        <div className="flex items-start gap-3">
          <div className="icon-tile h-10 w-10 shrink-0 rounded-xl bg-primary/10">
            <AlertTriangle className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary/75">
              {t("approval_boundary_label")}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold tracking-tight">
              {t("approval_dialog_title")}
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-muted-foreground">
              {t("approval_dialog_description")}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border/35 bg-background/25 p-3">
          <p className="text-sm font-semibold">{step?.title ?? t("approval_unknown_action")}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {step?.description ?? t("approval_unknown_description")}
          </p>
          {stepApproval?.approvalReason && (
            <p className="mt-3 rounded-lg border border-primary/15 bg-primary/10 px-3 py-2 text-xs leading-5 text-foreground/90">
              {stepApproval.approvalReason}
            </p>
          )}
          {stepApproval?.previewText && (
            <div className="mt-3 rounded-lg border border-border/35 bg-background/40 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("approval_preview_label")}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/90">
                {stepApproval.previewText}
              </p>
            </div>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {diagnosticRows.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border/25 bg-secondary/[0.07] px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-1 break-words text-xs font-medium text-foreground">
                {displayValue(value)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={handleClose} disabled={disabled || isDeciding}>
            {t("approval_cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={handleReject} disabled={!canDecide}>
            <XCircle className="mr-2 h-4 w-4" />
            {t("approval_reject")}
          </Button>
          <Button type="button" onClick={handleApprove} disabled={!canDecide}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {t("approval_approve")}
          </Button>
        </div>
      </section>
    </div>
  );
}
