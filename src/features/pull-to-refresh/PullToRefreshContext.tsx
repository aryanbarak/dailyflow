import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';

// Task 38, point 8: the refresh CONTRACT. A route registers what "refresh"
// means for it (usually its own data hook's existing `refresh()`, e.g.
// useTasks()/useFinance() already expose one); the gesture container
// (MobilePullToRefreshMain) never knows about any specific route -- it only
// ever calls "the currently registered handler, if any." A route that never
// calls usePullToRefreshHandler leaves the registry empty, which is the
// documented safe default: no handler registered means the gesture container
// treats pull-to-refresh as disabled for that route (see
// usePullToRefreshRegistry's `hasHandler`) -- nothing visible happens, the
// touch sequence completes via ordinary, unintercepted browser scrolling.
export type PullToRefreshHandler = () => Promise<void> | void;

interface PullToRefreshContextValue {
  setHandler: (handler: PullToRefreshHandler | null) => void;
  getHandler: () => PullToRefreshHandler | null;
  subscribe: (listener: () => void) => () => void;
}

const PullToRefreshContext = createContext<PullToRefreshContextValue | null>(null);

export function PullToRefreshProvider({ children }: Readonly<{ children: ReactNode }>) {
  const handlerRef = useRef<PullToRefreshHandler | null>(null);
  const listenersRef = useRef(new Set<() => void>());

  const setHandler = useCallback((handler: PullToRefreshHandler | null) => {
    handlerRef.current = handler;
    listenersRef.current.forEach(listener => listener());
  }, []);

  const getHandler = useCallback(() => handlerRef.current, []);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ setHandler, getHandler, subscribe }), [setHandler, getHandler, subscribe]);

  return <PullToRefreshContext.Provider value={value}>{children}</PullToRefreshContext.Provider>;
}

// For PAGES: registers `handler` as this route's refresh callback while
// mounted, and unregisters it on unmount / navigation away -- a route
// change always leaves the registry either empty or holding the NEW route's
// own handler, never a stale one from the page that just left (task 38,
// point 9's guarantee starts here: the registry can only ever hold a
// callback the CURRENTLY MOUNTED route itself provided).
export function usePullToRefreshHandler(handler: PullToRefreshHandler | undefined | null) {
  const ctx = useContext(PullToRefreshContext);
  useEffect(() => {
    if (!ctx || !handler) return undefined;
    ctx.setHandler(handler);
    return () => ctx.setHandler(null);
  }, [ctx, handler]);
}

// For the GESTURE CONTAINER only: exposes whether a handler is currently
// registered (so it knows whether to arm the gesture at all) and a stable
// `triggerRefresh` that calls whatever is currently registered, or is a
// silent no-op if nothing is (the container is never route-aware itself).
export function usePullToRefreshRegistry() {
  const ctx = useContext(PullToRefreshContext);

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!ctx) return () => {};
      return ctx.subscribe(listener);
    },
    [ctx],
  );
  const getSnapshot = useCallback(() => !!ctx?.getHandler(), [ctx]);
  const getServerSnapshot = useCallback(() => false, []);

  const hasHandler = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const triggerRefresh = useCallback(async () => {
    const handler = ctx?.getHandler();
    if (handler) await handler();
  }, [ctx]);

  return { hasHandler, triggerRefresh };
}
