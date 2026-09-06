import { useEffect } from "react";
import { RefreshCw, WifiOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useT } from "@/i18n";

/**
 * CORE-W1 (2026-09-06, CORE audit item ۴-۳): app-level fallback passed to
 * the existing generic ErrorBoundary (components/common/ErrorBoundary) in
 * App.tsx. The recovery for both "we are offline and something threw" and
 * "a lazy chunk failed after a deploy" is the same -- reload; if the
 * network is down, reload automatically the moment it returns
 * ({ once: true } so a flapping connection can't reload-loop the app).
 */
export function CrashFallback() {
  const { isOnline } = useNetworkStatus();
  const { t } = useT();

  useEffect(() => {
    if (isOnline) return;
    const reload = () => window.location.reload();
    window.addEventListener("online", reload, { once: true });
    return () => window.removeEventListener("online", reload);
  }, [isOnline]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex items-center gap-2 text-amber-500">
        {isOnline ? <AlertTriangle className="h-6 w-6" /> : <WifiOff className="h-6 w-6" />}
        <h1 className="text-xl font-semibold text-foreground">{t("app_crash_title")}</h1>
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">
        {isOnline ? t("app_crash_body") : t("app_crash_body_offline")}
      </p>
      <Button onClick={() => window.location.reload()} className="gap-2">
        <RefreshCw className="h-4 w-4" />
        {t("app_crash_reload")}
      </Button>
    </div>
  );
}
