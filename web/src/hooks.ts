import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Me } from '../../shared/api.ts';
import { api, errorMessage } from './api.ts';

// ---------- Global error banner ----------
let bannerMessage: string | null = null;
const bannerListeners = new Set<() => void>();

export function showError(err: unknown) {
  bannerMessage = typeof err === 'string' ? err : errorMessage(err);
  for (const l of bannerListeners) l();
}

export function clearError() {
  bannerMessage = null;
  for (const l of bannerListeners) l();
}

export function useErrorBanner(): string | null {
  return useSyncExternalStore(
    (cb) => {
      bannerListeners.add(cb);
      return () => bannerListeners.delete(cb);
    },
    () => bannerMessage,
    () => null,
  );
}

// ---------- Data loading ----------
export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (fn: T | ((prev: T | null) => T | null)) => void;
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef.current().then(
      (d) => {
        if (!alive) return;
        setDataState(d);
        setLoading(false);
      },
      (e) => {
        if (!alive) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn: T | ((prev: T | null) => T | null)) => {
    setDataState((prev) => (typeof fn === 'function' ? (fn as (p: T | null) => T | null)(prev) : fn));
  }, []);
  return { data, error, loading, reload, setData };
}

// ---------- Current user (cached for the page lifetime) ----------
let mePromise: Promise<Me | null> | null = null;

export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (!mePromise) mePromise = api.me().catch(() => null);
    let alive = true;
    mePromise.then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);
  return me;
}

// ---------- Server-sent events ----------
// Opens an EventSource on `url` (null = closed). Each named event's JSON payload is passed to onEvent.
// The browser reconnects on its own (with Last-Event-ID); if the source closes for good we reopen it
// after a short delay and call onReopen so the caller can refetch state it may have missed.
export function useEventSource<E extends { event: string }>(
  url: string | null,
  eventNames: readonly E['event'][],
  onEvent: (e: E) => void,
  onReopen?: () => void,
) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const reopen = useRef(onReopen);
  reopen.current = onReopen;
  const namesKey = eventNames.join(',');

  useEffect(() => {
    if (!url || typeof EventSource === 'undefined') return;
    let closed = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const dispatch = (name: string) => (ev: Event) => {
      if (!(ev instanceof MessageEvent) || typeof ev.data !== 'string' || ev.data === '') return;
      let payload: unknown;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!payload || typeof payload !== 'object') return;
      const obj = payload as Record<string, unknown>;
      handler.current({ ...obj, event: typeof obj.event === 'string' ? obj.event : name } as E);
    };

    const open = (isReopen: boolean) => {
      es = new EventSource(url, { withCredentials: false });
      for (const name of namesKey.split(',')) es.addEventListener(name, dispatch(name));
      es.onmessage = dispatch('message');
      es.onopen = () => {
        attempts = 0;
      };
      // A named server "error" event arrives as a MessageEvent and is handled above;
      // a plain Event means the connection itself failed.
      es.addEventListener('error', (ev) => {
        if (ev instanceof MessageEvent) return;
        if (es && es.readyState === EventSource.CLOSED && !closed) {
          es.close();
          attempts += 1;
          timer = setTimeout(() => open(true), Math.min(15000, 1000 * 2 ** Math.min(attempts, 4)));
        }
      });
      if (isReopen) reopen.current?.();
    };
    open(false);

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [url, namesKey]);
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Re-render every `ms` milliseconds (for countdowns). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
