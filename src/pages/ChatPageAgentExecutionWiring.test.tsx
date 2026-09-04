// @vitest-environment jsdom
//
// Chat V2 Slice 2A / BLOCKER A CORRECTION: the write handlers under
// src/features/agent/handlers/ (tasksCreateHandler.ts etc.) now fail closed
// with no direct-write fallback when context.agentToolExecutionClient is
// absent -- see this slice's own report. That makes ChatPage.tsx's own
// wiring of that client into runWriteTool's executionContext load-bearing
// in production, not cosmetic: if this wiring were ever removed or
// misplaced, every Agent task/calendar write would start failing closed in
// the real app, not just in a test harness. ChatPage.tsx is never mounted
// directly in this test suite (see ChatPageChromeCleanup.test.tsx's own
// header comment for the established reason), so this follows the same
// source-verification convention ChatPageAttachmentWiring.test.tsx already
// uses for a comparable "this wiring must not silently regress" guarantee.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.resolve(process.cwd(), "src", "pages", "ChatPage.tsx"), "utf-8");

describe("ChatPage: agentToolExecutionClient wiring (Chat V2 Slice 2A, Blocker A correction)", () => {
  it("imports createAgentToolExecutionClient from the Slice 2A client module", () => {
    // Chat Runtime Truth V1: the same import line now also carries
    // revokeAgentToolExecution (the frozen Reject -> revoked wiring) --
    // the pin verifies createAgentToolExecutionClient still comes from
    // this exact module, whatever siblings share the statement.
    expect(pageSource).toMatch(/import \{ createAgentToolExecutionClient[^}]*\} from '@\/features\/agent\/agentToolExecutionClient'/);
  });

  it("there is exactly ONE runWriteTool call site, and its executionContext supplies agentToolExecutionClient", () => {
    const callSites = pageSource.match(/runWriteTool\(\{/g) ?? [];
    expect(callSites).toHaveLength(1);

    const callStart = pageSource.indexOf("const writeResult = await runWriteTool({");
    expect(callStart).toBeGreaterThan(-1);
    const callEnd = pageSource.indexOf("\n    })", callStart);
    const callBody = pageSource.slice(callStart, callEnd);

    expect(callBody).toMatch(/agentToolExecutionClient: createAgentToolExecutionClient\(\{/);
    // Same auth wiring as every other Worker client at this call site
    // (githubIssueCommentClient, engineeringTaskClient, etc.) -- a real
    // Supabase session access token, not a placeholder.
    const clientStart = callBody.indexOf("agentToolExecutionClient: createAgentToolExecutionClient({");
    const clientEnd = callBody.indexOf("}),", clientStart);
    const clientBody = callBody.slice(clientStart, clientEnd);
    expect(clientBody).toMatch(/workerBaseUrl: workerUrl/);
    expect(clientBody).toMatch(/const \{ data: \{ session \} \} = await supabase\.auth\.getSession\(\)/);
    expect(clientBody).toMatch(/return session\?\.access_token/);
  });
});

// BLOCKER 1 CORRECTION: the durable approval_pending row must exist BEFORE
// the user approves anything -- see agentToolExecutionClient.ts's own
// header comment and writeRuntime.ts's requestWriteExecution. This proves
// ChatPage.tsx actually fires that pre-approval request (not just that the
// post-approval client wiring above exists) and binds the result back onto
// the exact proposal it came from.
describe("ChatPage: pre-approval requestWriteExecution wiring (Chat V2 Slice 2A, Blocker 1 correction)", () => {
  it("imports requestWriteExecution from the agent feature barrel", () => {
    expect(pageSource).toMatch(/\brequestWriteExecution\b/);
  });

  it("calls requestWriteExecution from inside a useEffect that watches reasoningProposal, not from the approval click handler", () => {
    const effectStart = pageSource.indexOf("const agentExecutionRequestedRef = useRef");
    expect(effectStart).toBeGreaterThan(-1);
    const effectEnd = pageSource.indexOf("}, [reasoningProposal, user?.id, workerUrl, t])", effectStart);
    expect(effectEnd).toBeGreaterThan(effectStart);
    const effectBody = pageSource.slice(effectStart, effectEnd);

    expect(effectBody).toMatch(/void requestWriteExecution\(\{/);
    // FINAL BINDING CORRECTION: eligibility is gated on executionRequestStatus
    // === 'requesting' -- computed synchronously by proposalToState on first
    // render (see BLOCKER A's own test below), not on approval.status/
    // serverExecutionId, which only ever describe the LOCAL decision state.
    expect(effectBody).toMatch(/proposal\.executionRequestStatus !== 'requesting'/);
    expect(effectBody).toMatch(/agentExecutionRequestedRef\.current\.has\(proposal\.requestId\)/);
    // Every outcome branch the Worker's /agent/execution/request call can
    // resolve to is handled explicitly -- approval_pending binds
    // serverExecutionId, a terminal auto status (succeeded/failed/uncertain)
    // marks the proposal terminal without ever binding an approval, and
    // anything else (a blocked request) fails closed to 'failed'.
    expect(effectBody).toMatch(/serverExecutionId: outcome\.executionId/);
    expect(effectBody).toMatch(/executionRequestStatus: 'approval_pending'/);
    expect(effectBody).toMatch(/outcome\.serverStatus === 'succeeded' \|\| outcome\.serverStatus === 'failed' \|\| outcome\.serverStatus === 'uncertain'/);
    expect(effectBody).toMatch(/executionRequestStatus: outcome\.serverStatus/);
    expect(effectBody).toMatch(/executionRequestStatus: 'failed', executionRequestReply: t\('agent_intent_execution_request_failed'\)/);
  });

  it("runWriteProposalWithApproval reuses the proposal's own stable requestId, never a freshly generated one", () => {
    const fnStart = pageSource.indexOf("const runWriteProposalWithApproval = useCallback");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = pageSource.indexOf("const requestId = current.requestId", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    // The old per-click `reasoning:write:${toolId}:${step.id}:${Date.now()}`
    // construction must be gone from this function -- BLOCKER 2 requires
    // reusing WriteRuntimeRequest's own stable id, not minting a new one.
    const fnBodyBeforeRequestId = pageSource.slice(fnStart, fnEnd);
    expect(fnBodyBeforeRequestId).not.toMatch(/reasoning:write:\$\{toolId\}/);
  });
});

// FINAL BINDING / UNCERTAIN CORRECTION, BLOCKER A: the user must not be able
// to approve a server-execution-backed proposal while its pre-approval
// requestWriteExecution() binding is still unresolved. proposalToState
// itself is exercised directly (it's exported and pure), and the gate
// (isExecutionBindingReady) plus every call site that must consult it are
// verified against the real source, following this file's own established
// "prove wiring against ChatPage.tsx's actual source" convention.
describe("ChatPage: approval is gated on the server-execution binding, not just approval.status (Blocker A correction)", () => {
  it("proposalToState puts a gated proposal (one of the five server-execution-backed tools) into 'requesting' synchronously, before any network call", () => {
    expect(pageSource).toMatch(/requiresServerExecutionBinding \? 'requesting' : 'idle'/);
    expect(pageSource).toMatch(/isAgentExecutionToolId\(resolution\.toolId\)/);
  });

  it("isExecutionBindingReady treats only 'idle', undefined, and 'approval_pending' as ready -- 'requesting' and every terminal auto status are not", () => {
    const fnStart = pageSource.indexOf("function isExecutionBindingReady(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = pageSource.indexOf("\n}", fnStart);
    const fnBody = pageSource.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/status === undefined \|\| status === 'idle' \|\| status === 'approval_pending'/);
  });

  it("the one-click confirm button, the Review button, and the post-review Run button are all gated on the execution binding", () => {
    expect(pageSource).toMatch(/const executionBindingReady = isExecutionBindingReady\(proposal\.executionRequestStatus\)/);
    expect(pageSource).toMatch(/disabled=\{isRunning \|\| !executionBindingReady\}/);
    expect(pageSource).toMatch(/onClick=\{onReviewApproval\} disabled=\{!executionBindingReady\}/);
    expect(pageSource).toMatch(/const canRunWrite = isWriteProposal && isApproved && executionBindingReady/);
  });

  it("the Review dialog itself is disabled while the binding is not ready -- an executable approval is never reachable through it either", () => {
    const dialogStart = pageSource.indexOf("<StepApprovalDialog");
    expect(dialogStart).toBeGreaterThan(-1);
    const dialogEnd = pageSource.indexOf("/>", dialogStart);
    const dialogProps = pageSource.slice(dialogStart, dialogEnd);
    expect(dialogProps).toMatch(/disabled=\{!isExecutionBindingReady\(reasoningProposal\?\.\[0\]\?\.executionRequestStatus\)\}/);
  });

  it("handleRunWriteProposal and handleConfirmAndRunWrite both re-check the binding before calling approveWorkspaceStep/runWriteProposalWithApproval -- defense in depth beyond the disabled UI", () => {
    const runFnStart = pageSource.indexOf("const handleRunWriteProposal = useCallback");
    const runFnEnd = pageSource.indexOf("const handleConfirmAndRunWrite", runFnStart);
    expect(pageSource.slice(runFnStart, runFnEnd)).toMatch(/if \(!isExecutionBindingReady\(current\.executionRequestStatus\)\) return/);

    const confirmFnStart = pageSource.indexOf("const handleConfirmAndRunWrite = useCallback");
    const confirmFnEnd = pageSource.indexOf("const approvedApproval = decision.approval", confirmFnStart);
    expect(pageSource.slice(confirmFnStart, confirmFnEnd)).toMatch(/if \(!isExecutionBindingReady\(current\.executionRequestStatus\)\) return/);
  });
});

// Chat Runtime Truth V1, REVIEW BLOCKER FIX: the explicit-rejection
// orchestration for a bound proposal must (a) never run its network side
// effect inside a React setState updater, and (b) never locally declare
// the durable lifecycle result -- the Worker's answer is what the UI
// reconciles to. Verified against the real source, per this file's own
// established convention.
describe("ChatPage: bound rejection orchestration + correlation wiring (Runtime Truth V1 review blocker)", () => {
  const decisionFnStart = pageSource.indexOf("const handleApprovalDecision = useCallback");
  const decisionFnEnd = pageSource.indexOf("}, [reasoningProposal, reportCurrentProposalOutcome, revokeBoundProposalExecution])", decisionFnStart);
  const decisionBody = pageSource.slice(decisionFnStart, decisionFnEnd);

  it("7. the revoke side effect is not executed inside a state updater -- handleApprovalDecision contains no network call, and every setReasoningProposal callback in it is a pure transition", () => {
    expect(decisionFnStart).toBeGreaterThan(-1);
    expect(decisionFnEnd).toBeGreaterThan(decisionFnStart);
    // No network call anywhere in the decision handler itself.
    expect(decisionBody).not.toContain("revokeAgentToolExecution(");
    expect(decisionBody).not.toContain("await ");
    // The bound branch delegates to the pure transition + the separate
    // async orchestration, in the handler body -- outside any updater.
    expect(decisionBody).toMatch(/setReasoningProposal\(prev => prev \? beginBoundProposalRevocation\(prev, rejectedApproval\) : prev\)/);
    expect(decisionBody).toMatch(/void revokeBoundProposalExecution\(serverExecutionId\)/);
  });

  it("1. the bound branch never declares the local terminal 'rejected' -- only the unbound branch (no agent_tool_executions row) keeps the pre-existing local rejection", () => {
    const boundBranchStart = decisionBody.indexOf("if (serverExecutionId && rejectedApproval)");
    expect(boundBranchStart).toBeGreaterThan(-1);
    const boundBranchEnd = decisionBody.indexOf("return", decisionBody.indexOf("void revokeBoundProposalExecution(", boundBranchStart));
    const boundBranch = decisionBody.slice(boundBranchStart, boundBranchEnd);
    expect(boundBranch).not.toContain("runStatus: 'rejected'");
    // 8. Unbound behavior unchanged: the plain local rejection still
    // exists, after (outside) the bound branch.
    expect(decisionBody.slice(boundBranchEnd)).toMatch(/runStatus: 'rejected'/);
  });

  it("revokeBoundProposalExecution awaits the Worker with the executionId only and reconciles via applyBoundRevocationOutcome -- transport failure becomes 'error', never a fabricated revoked", () => {
    const fnStart = pageSource.indexOf("const revokeBoundProposalExecution = useCallback(async");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = pageSource.indexOf("}, [workerUrl])", fnStart);
    const body = pageSource.slice(fnStart, fnEnd);
    expect(body).toMatch(/await revokeAgentToolExecution\(/);
    expect(body).toMatch(/applyBoundRevocationOutcome\(prev, serverExecutionId, result\.status\)/);
    expect(body).toMatch(/applyBoundRevocationOutcome\(prev, serverExecutionId, 'error'\)/);
    // No hardcoded lifecycle claim anywhere in the orchestration -- the
    // only statuses it can ever apply are the Worker's own answer and the
    // explicit transport-failure 'error'.
    expect(body).not.toContain("'revoked'");
    expect(body).not.toContain("'rejected'");
  });

  // Chat Runtime Truth V1 (correlation, tests 22/23): the full client
  // chain /chat userMessageId -> proposal state -> requestWriteExecution.
  // The writeRuntime half (forwarding into client.requestExecution) and
  // the Worker half (storing the columns) are covered by real behavioral
  // tests in writeRuntime.test.ts and agent-tool-execution.test.ts; this
  // pins the ChatPage wiring between them, which is never mounted in
  // tests (this file's own established convention).
  it("correlation: handleSend destructures /chat's userMessageId, stamps it (with sessionId) onto the reasoning states, and the binding effect forwards both into requestWriteExecution", () => {
    expect(pageSource).toMatch(/pendingAction, userMessageId \}, overlayResult\] = await Promise\.all\(\[chatCallPromise, overlayPromise\]\)/);
    expect(pageSource).toMatch(/\{ \.\.\.state, sessionId: sessionId \?\? undefined, chatMessageId: userMessageId \}/);

    const effectCallStart = pageSource.indexOf("void requestWriteExecution({");
    expect(effectCallStart).toBeGreaterThan(-1);
    const effectCallEnd = pageSource.indexOf("executionContext", effectCallStart);
    const effectCall = pageSource.slice(effectCallStart, effectCallEnd);
    expect(effectCall).toMatch(/sessionId: proposal\.sessionId/);
    expect(effectCall).toMatch(/chatMessageId: proposal\.chatMessageId/);
  });
});
