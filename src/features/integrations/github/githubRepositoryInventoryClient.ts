export type GitHubRepositoryInventory =
  | { status: "unknown" }
  | { status: "known"; names: string[] };

export interface GitHubRepositoryInventoryClient {
  getInventory(): Promise<GitHubRepositoryInventory>;
}

interface GitHubRepositoryInventoryClientOptions {
  workerBaseUrl: string;
  getAccessToken(): Promise<string | undefined>;
  fetcher?: typeof fetch;
}

const MAX_NAMES = 12;

function safeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function inventoryEndpoint(workerBaseUrl: string): string | undefined {
  try {
    const base = new URL(workerBaseUrl);
    if (
      base.username || base.password ||
      (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")
    ) {
      return undefined;
    }
    base.pathname = `${base.pathname.replace(/\/$/, "")}/github/repository-inventory`;
    base.search = "";
    base.hash = "";
    return base.toString();
  } catch {
    return undefined;
  }
}

// This is a disambiguation hint for prompt assembly, not a tool the user
// explicitly ran -- unlike the other github*Client modules, this one never
// throws. Any failure (missing auth, network error, malformed response,
// non-200) degrades to { status: "unknown" }, the same value a genuinely
// never-refreshed cache produces. A missing hint should never block sending
// a chat message or surface an error the user didn't ask for; it should
// just mean today's evidence-based behavior, unchanged.
export function createGitHubRepositoryInventoryClient(
  options: GitHubRepositoryInventoryClientOptions,
): GitHubRepositoryInventoryClient {
  const endpoint = inventoryEndpoint(options.workerBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async getInventory(): Promise<GitHubRepositoryInventory> {
      if (!endpoint) return { status: "unknown" };

      const accessToken = await options.getAccessToken().catch(() => undefined);
      if (!accessToken) return { status: "unknown" };

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        return { status: "unknown" };
      }
      if (!response.ok) return { status: "unknown" };

      let body: Record<string, unknown>;
      try {
        body = await response.json() as Record<string, unknown>;
      } catch {
        return { status: "unknown" };
      }

      if (body.status === "known" && Array.isArray(body.names)) {
        const names = body.names
          .filter((item): item is string => typeof item === "string")
          .map((item) => safeString(item, 200))
          .filter((item): item is string => Boolean(item))
          .slice(0, MAX_NAMES);
        return { status: "known", names };
      }
      return { status: "unknown" };
    },
  });
}
