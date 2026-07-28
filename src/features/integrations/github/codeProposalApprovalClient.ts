// EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
// Calls the Worker route that records a server-verifiable approval. This
// client never sends baseBlobSha/baseCommitSha/proposedContentDigest/
// riskLevel/expiresAt -- the Worker derives every one of those itself
// (ADR-0005 Decision 7); the request carries only enough for the Worker to
// re-read the real repository state.

export interface CodeProposalApprovalInput {
  proposalId: string;
  repo: string;
  path: string;
  proposedContent: string;
}

export interface CodeProposalApprovalRecord {
  proposalId: string;
  expiresAt: string;
}

export interface CodeProposalApprovalError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface CodeProposalApprovalClient {
  recordApproval(input: CodeProposalApprovalInput): Promise<CodeProposalApprovalRecord>;
}

interface CodeProposalApprovalClientOptions {
  workerBaseUrl: string;
  getAccessToken(): Promise<string | undefined>;
  fetcher?: typeof fetch;
}

function safeError(code: string, message: string): CodeProposalApprovalError {
  return { code, message, retryable: false };
}

function safeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function approveEndpoint(workerBaseUrl: string) {
  const base = new URL(workerBaseUrl);
  if (base.username || base.password || (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")) {
    throw safeError("GITHUB_CONFIGURATION_INVALID", "GitHub integration endpoint is invalid.");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/github/code-proposals/approve`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function createCodeProposalApprovalClient(
  options: CodeProposalApprovalClientOptions,
): CodeProposalApprovalClient {
  const endpoint = approveEndpoint(options.workerBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async recordApproval(input: CodeProposalApprovalInput): Promise<CodeProposalApprovalRecord> {
      const accessToken = await options.getAccessToken();
      if (!accessToken) throw safeError("AUTH_REQUIRED", "Authentication is required.");

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            proposalId: input.proposalId,
            repo: input.repo,
            path: input.path,
            proposedContent: input.proposedContent,
          }),
        });
      } catch {
        throw safeError("GITHUB_INTEGRATION_UNAVAILABLE", "GitHub approval recording is unavailable.");
      }

      if (!response.ok) {
        let code = "APPROVAL_RECORD_FAILED";
        try {
          const errorBody = await response.json() as { error?: { code?: unknown } };
          const providerCode = safeString(errorBody.error?.code, 64);
          if (providerCode) code = providerCode;
        } catch {
          // Fall back to the generic code below.
        }
        throw safeError(code, "The proposal could not be approved safely.");
      }

      const body = await response.json() as Partial<CodeProposalApprovalRecord>;
      const proposalId = safeString(body.proposalId, 200);
      const expiresAt = safeString(body.expiresAt, 64);
      if (!proposalId || !expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
        throw safeError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid approval response.");
      }
      return { proposalId, expiresAt };
    },
  });
}
