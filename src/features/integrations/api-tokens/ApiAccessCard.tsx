// CORE-W3 (2026-09-06, CORE audit item ۲-۳): Settings > Integrations card
// for MCP/API access. Mints personal tokens (shown once), lists them with
// revoke, and shows the MCP endpoint URL to paste into Claude/Cursor.
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/i18n";
import { apiTokenService, type ApiTokenSummary } from "./apiTokenService";

const WORKER_URL = (import.meta.env.VITE_AGENT_WORKER_URL as string | undefined) ?? "";

interface ApiTokenServiceLike {
  createToken(userId: string, name: string): Promise<string>;
  listTokens(userId: string): Promise<ApiTokenSummary[]>;
  revokeToken(tokenId: string): Promise<void>;
}

interface ApiAccessCardProps {
  service?: ApiTokenServiceLike;
}

export function ApiAccessCard({ service = apiTokenService }: ApiAccessCardProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { t } = useT();
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [name, setName] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      setTokens(await service.listTokens(userId));
    } catch {
      setTokens([]);
    }
  }, [service, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    if (!userId || name.trim().length === 0) return;
    setWorking(true);
    setError(null);
    try {
      const token = await service.createToken(userId, name.trim());
      setFreshToken(token);
      setName("");
      await refresh();
    } catch {
      setError(t("api_tokens_create_error"));
    } finally {
      setWorking(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    setError(null);
    try {
      await service.revokeToken(tokenId);
      await refresh();
    } catch {
      setError(t("api_tokens_revoke_error"));
    }
  };

  const activeTokens = tokens.filter((token) => token.revokedAt === null);
  const mcpUrl = WORKER_URL ? `${WORKER_URL}/mcp` : null;

  return (
    <Card className="glass-card">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="icon-tile w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">{t("api_tokens_card_title")}</h3>
            <p className="text-sm text-muted-foreground">{t("api_tokens_card_desc")}</p>
          </div>
        </div>

        {mcpUrl && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("api_tokens_mcp_url_label")}
            </p>
            <code dir="ltr" className="block w-fit max-w-full overflow-x-auto rounded-md bg-secondary px-3 py-1.5 font-mono text-xs select-all">
              {mcpUrl}
            </code>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("api_tokens_name_placeholder")}
            aria-label={t("api_tokens_name_placeholder")}
            maxLength={100}
            className="max-w-56"
          />
          <Button size="sm" className="gap-1.5" disabled={working || name.trim().length === 0} onClick={handleCreate}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("api_tokens_create")}
          </Button>
        </div>

        {freshToken && (
          <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-medium">{t("api_tokens_shown_once")}</p>
            <code dir="ltr" className="block w-fit max-w-full overflow-x-auto rounded-md bg-secondary px-3 py-1.5 font-mono text-sm select-all">
              {freshToken}
            </code>
          </div>
        )}

        {activeTokens.length > 0 && (
          <ul className="space-y-1.5">
            {activeTokens.map((token) => (
              <li key={token.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {token.lastUsedAt
                      ? t("api_tokens_last_used", { date: token.lastUsedAt.slice(0, 10) })
                      : t("api_tokens_never_used")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  onClick={() => void handleRevoke(token.id)}
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  {t("api_tokens_revoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-destructive" role="status">{error}</p>}
      </CardContent>
    </Card>
  );
}
