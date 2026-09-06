// CORE-W1 (2026-09-06, CORE audit item ۲-۱): Settings > Integrations card
// for the Telegram capture channel. Mirrors GitHubIntegrationCard's shape:
// a pure view fed by a small container with an injectable service so tests
// never touch Supabase.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Send, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/i18n";
import {
  TELEGRAM_LINK_CODE_TTL_MINUTES,
  telegramLinkService,
} from "./telegramLinkService";

interface TelegramLinkServiceLike {
  createLinkCode(userId: string): Promise<string>;
  getStatus(userId: string): Promise<{ linked: boolean }>;
  unlink(userId: string): Promise<void>;
}

interface TelegramIntegrationCardProps {
  service?: TelegramLinkServiceLike;
}

type ViewState = "loading" | "unlinked" | "linked" | "working";

export function TelegramIntegrationCard({
  service = telegramLinkService,
}: TelegramIntegrationCardProps) {
  const { user } = useAuth();
  // Depend on the stable id, not the user object -- auth providers may
  // hand out a fresh object per render, and an object dep would re-run
  // the status effect after every local state change (re-fetching and
  // clobbering an optimistic unlink).
  const userId = user?.id ?? null;
  const { t } = useT();
  const [state, setState] = useState<ViewState>("loading");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const status = await service.getStatus(userId);
      setState(status.linked ? "linked" : "unlinked");
    } catch {
      // Status read failing (e.g. offline) should not brick the card --
      // fall back to the unlinked affordance.
      setState("unlinked");
    }
  }, [service, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleGenerate = async () => {
    if (!userId) return;
    setError(null);
    setState("working");
    try {
      const freshCode = await service.createLinkCode(userId);
      setCode(freshCode);
      setState("unlinked");
    } catch {
      setError(t("telegram_link_error"));
      setState("unlinked");
    }
  };

  const handleUnlink = async () => {
    if (!userId) return;
    setError(null);
    setState("working");
    try {
      await service.unlink(userId);
      setCode(null);
      setState("unlinked");
    } catch {
      setError(t("telegram_unlink_error"));
      setState("linked");
    }
  };

  return (
    <Card className="glass-card">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="icon-tile w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
            <Send className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">{t("telegram_card_title")}</h3>
            <p className="text-sm text-muted-foreground">{t("telegram_card_desc")}</p>
          </div>
        </div>

        {state === "loading" ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("telegram_card_title")} />
        ) : state === "linked" ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {t("telegram_status_linked")}
            </span>
            <Button variant="outline" size="sm" onClick={handleUnlink} className="gap-1.5">
              <Unplug className="h-4 w-4" />
              {t("telegram_unlink")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("telegram_status_unlinked")}</p>
            <Button
              onClick={handleGenerate}
              disabled={state === "working"}
              size="sm"
              className="gap-1.5"
            >
              {state === "working" && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("telegram_generate_code")}
            </Button>
            {code && (
              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">
                  {t("telegram_code_hint")}{" "}
                  <span className="text-xs opacity-80">({TELEGRAM_LINK_CODE_TTL_MINUTES}′)</span>
                </p>
                <code dir="ltr" className="inline-block rounded-md bg-secondary px-3 py-1.5 font-mono text-sm tracking-wider select-all">
                  /link {code}
                </code>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
