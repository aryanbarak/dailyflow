// CORE audit item 1-3 -- the Daily home view: an infinite vertical scroll
// of calendar-day sections, anchored to today, silently loading older/
// newer days near the scroll edges with no visible jump. Mechanics ported
// from CORE's own reference implementation
// (C:\Projects\core\apps\webapp\app\components\daily\daily-page.client.tsx)
// onto this repo's existing journal data layer -- see DaySection.tsx for
// the per-day content and dateWindow.ts/dailyScrollDecision.ts for the
// pure logic this component only wires up.
//
// All CORE mutable mechanic state below stays in useRef, never useState:
// it's read/written synchronously inside native wheel/touchstart/
// ResizeObserver callbacks and a layout effect, exactly like CORE's own
// implementation -- promoting any of it to state would introduce
// re-render lag and stale reads inside those callbacks.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { useTasks } from "@/hooks/useTasks";
import { DaySection } from "./DaySection";
import { appendDates, buildInitialDates, dateKey, prependDates } from "../dateWindow";
import { shouldAppendNewerDays, shouldPrependOlderDays } from "../dailyScrollDecision";

// How far below the scroll container's top edge today's section should
// rest once snapped -- a small comfortable gap, not flush to the edge.
const TODAY_SCROLL_OFFSET_PX = 24;
// CORE's own delay before the first silent backward-load, so the very
// first paint doesn't visibly jump either.
const INITIAL_PREPEND_DELAY_MS = 150;

export function DailyHomeView() {
  const { user } = useAuth();
  const { tasks, addTask } = useTasks();

  const today = useRef(new Date()).current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const sectionEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const sectionHeights = useRef<Map<string, number>>(new Map());
  const refCallbacks = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());

  const [dates, setDates] = useState<Date[]>(() => buildInitialDates(today));

  // True until the user physically touches the scroll area (wheel or
  // touch) -- NOT the scroll event, which also fires for this
  // component's own programmatic scrollTop writes and would falsely
  // unlock.
  const lockedToToday = useRef(true);
  // Guards against cascading prepends while one is already in flight.
  const prependHeightRef = useRef<number | null>(null);
  const appendTrimHeightRef = useRef<number | null>(null);

  const getRefCallback = useCallback(
    (date: Date) => {
      const key = dateKey(date);
      if (!refCallbacks.current.has(key)) {
        refCallbacks.current.set(key, (el) => {
          if (el) {
            sectionEls.current.set(key, el);
            if (key === dateKey(today)) todayRef.current = el;
          } else {
            sectionEls.current.delete(key);
            refCallbacks.current.delete(key);
            if (key === dateKey(today)) todayRef.current = null;
          }
        });
      }
      return refCallbacks.current.get(key)!;
    },
    [today],
  );

  const snapToToday = useCallback(() => {
    const container = scrollRef.current;
    const todayEl = todayRef.current;
    if (!container || !todayEl) return;
    container.scrollTop = Math.max(0, todayEl.offsetTop - TODAY_SCROLL_OFFSET_PX);
  }, []);

  // Delta compensation after a prepend / append-trim: capture scrollHeight
  // just BEFORE the dates change, then correct scrollTop by the exact
  // delta right after the DOM reflects it -- eliminates the visible jump
  // that prepending content above the viewport would otherwise cause.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (prependHeightRef.current !== null) {
      container.scrollTop += container.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
    }
    if (appendTrimHeightRef.current !== null) {
      container.scrollTop -= appendTrimHeightRef.current - container.scrollHeight;
      appendTrimHeightRef.current = null;
    }
  }, [dates]);

  // ResizeObserver: while locked, snap to today's real offsetTop on any
  // height change (content loading in async); while unlocked,
  // delta-compensate scrollTop for height changes ABOVE the current
  // viewport so loading content in past days doesn't shift the view.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (typeof ResizeObserver === "undefined") return;

    sectionEls.current.forEach((el, key) => {
      if (!sectionHeights.current.has(key)) sectionHeights.current.set(key, el.offsetHeight);
    });

    const observer = new ResizeObserver((entries) => {
      if (lockedToToday.current) {
        snapToToday();
        return;
      }
      let delta = 0;
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement;
        const key = [...sectionEls.current.entries()].find(([, v]) => v === el)?.[0];
        if (!key) continue;
        const prev = sectionHeights.current.get(key) ?? 0;
        const next = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
        sectionHeights.current.set(key, next);
        if (el.offsetTop < container.scrollTop + delta) delta += next - prev;
      }
      if (delta !== 0) container.scrollTop += delta;
    });

    sectionEls.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [dates, snapToToday]);

  // Unlock the today-anchor on first physical user interaction.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const unlock = () => {
      lockedToToday.current = false;
    };
    container.addEventListener("wheel", unlock, { passive: true, once: true });
    container.addEventListener("touchstart", unlock, { passive: true, once: true });
    return () => {
      container.removeEventListener("wheel", unlock);
      container.removeEventListener("touchstart", unlock);
    };
  }, []);

  // Initial silent prepend of past days, so the FIRST paint doesn't jump
  // either (today lands a few days into the window, not at its very top).
  useEffect(() => {
    const id = setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;
      prependHeightRef.current = container.scrollHeight;
      setDates((prev) => prependDates(prev));
    }, INITIAL_PREPEND_DELAY_MS);
    return () => clearTimeout(id);
    // eslint-disable-line react-hooks/exhaustive-deps
  }, []);

  const prependDays = useCallback(() => {
    const container = scrollRef.current;
    if (!container || prependHeightRef.current !== null) return;
    prependHeightRef.current = container.scrollHeight;
    setDates((prev) => prependDates(prev));
  }, []);

  const appendDays = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    setDates((prev) => {
      const grown = prev.length + 7; // LOAD_MORE_DAYS, kept in sync with dateWindow.ts's default
      const next = appendDates(prev);
      if (next.length < grown) {
        // Trimmed from the oldest end -- that shifts content above the
        // viewport, so the scroll position needs the same compensation
        // a prepend gets.
        appendTrimHeightRef.current = container.scrollHeight;
      }
      return next;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const metrics = {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
    if (shouldPrependOlderDays(metrics)) prependDays();
    if (shouldAppendNewerDays(metrics)) appendDays();
  }, [prependDays, appendDays]);

  const handleCreateTask = useCallback(
    (payload: { title: string; notes: string }) => addTask(payload),
    [addTask],
  );

  // Guarded rather than assumed: JournalPage.tsx's own single-day
  // companion wiring guards on `user` the same way (a brief hydration
  // window under ProtectedRoute can still render with no user yet).
  if (!user) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="daily-scroll-container"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="space-y-6 p-2 pb-24">
          {dates.map((date) => (
            <div key={dateKey(date)} ref={getRefCallback(date)}>
              <DaySection date={date} today={today} userId={user.id} tasks={tasks} onCreateTask={handleCreateTask} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
