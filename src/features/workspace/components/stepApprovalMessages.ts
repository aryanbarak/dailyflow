import type { ApprovalInteractionResult } from "@/features/agent/approvalInteraction";

export function approvalFailureMessage(result: ApprovalInteractionResult) {
  if (result.ok) return "";
  if (!("errorCode" in result)) return "Approval could not be completed. Try again.";
  switch (result.errorCode) {
    case "MISSING_STEP":
    case "MISSING_APPROVAL":
    case "STEP_MISMATCH":
    case "TARGET_MISMATCH":
    case "TOOL_MISMATCH":
    case "UNSUPPORTED_SCOPE":
    case "SCOPE_ESCALATION":
    case "RISK_UNDERSTATEMENT":
      return "Approval failed because this action request is no longer valid. Review the action and try again.";
    case "POLICY_DENIED":
      return result.reason.includes("authenticated")
        ? "Authentication is required before this action can be approved."
        : "Approval is not permitted for this action.";
    default:
      return "Approval could not be completed. Try again.";
  }
}
