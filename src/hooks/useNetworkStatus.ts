import { useEffect, useRef, useState } from "react";

/**
 * CORE-W1 (2026-09-06, CORE audit item ۴-۳): the boolean hook grew a
 * three-phase `status` so UI can flash a short "back online" confirmation
 * instead of silently disappearing the offline notice. `isOnline` is kept
 * unchanged for the existing consumer (MicroBreakOverlay).
 *
 * Phases: "online" -> "offline" (browser offline event) -> "reconnected"
 * (online event after an offline period, held for RECONNECTED_HOLD_MS)
 * -> "online". A page that loads offline starts in "offline"; a page that
 * loads online starts in "online" (never "reconnected").
 */
export type NetworkStatusPhase = "online" | "offline" | "reconnected";

export const RECONNECTED_HOLD_MS = 2500;

export function useNetworkStatus() {
  const initiallyOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const [isOnline, setIsOnline] = useState(initiallyOnline);
  const [status, setStatus] = useState<NetworkStatusPhase>(
    initiallyOnline ? "online" : "offline",
  );
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearHold = () => {
      if (holdTimer.current !== null) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
    };
    const handleOnline = () => {
      setIsOnline(true);
      setStatus((previous) => {
        if (previous !== "offline") return previous;
        clearHold();
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          setStatus("online");
        }, RECONNECTED_HOLD_MS);
        return "reconnected";
      });
    };
    const handleOffline = () => {
      setIsOnline(false);
      clearHold();
      setStatus("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearHold();
    };
  }, []);

  return { isOnline, status };
}
