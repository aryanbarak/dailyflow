import { WifiOff, Wifi } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * CORE-W1 (2026-09-06, CORE audit item ۴-۳): app-wide connectivity pill.
 * Renders nothing while online; a fixed bottom-center pill while offline;
 * and a short "back online" confirmation (RECONNECTED_HOLD_MS) once the
 * connection returns. `role="status"` + `aria-live="polite"` so screen
 * readers announce the transition without stealing focus. Data-layer
 * behavior needs no counterpart here: react-query's default
 * networkMode ("online") already pauses queries/mutations while offline.
 */
export function NetworkStatusPill() {
  const { status } = useNetworkStatus();
  const { t } = useT();

  if (status === "online") return null;

  const offline = status === "offline";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4"
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium shadow-lg backdrop-blur",
          offline
            ? "border-amber-500/40 bg-amber-50/95 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/90 dark:text-amber-200"
            : "border-emerald-500/40 bg-emerald-50/95 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950/90 dark:text-emerald-200",
        )}
      >
        {offline ? <WifiOff className="h-4 w-4 shrink-0" /> : <Wifi className="h-4 w-4 shrink-0" />}
        <span>{offline ? t("network_offline_pill") : t("network_back_online")}</span>
      </div>
    </div>
  );
}
