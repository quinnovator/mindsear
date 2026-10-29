// Light/dark theme. A saved choice wins; otherwise the OS setting is followed, live. index.html runs
// the same rule inline before first paint so the page never flashes the wrong theme.
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'mindsear-theme';
const GROUND: Record<Theme, string> = { light: '#F4F6F9', dark: '#0D1422' };

const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

export function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function resolvedTheme(): Theme {
  return savedTheme() ?? (media.matches ? 'dark' : 'light');
}

function apply() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', GROUND[t]);
  listeners.forEach((f) => f());
}

/** Save an explicit theme, or pass null to follow the OS again. */
export function setTheme(t: Theme | null) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts for this page only.
    if (t) {
      document.documentElement.dataset.theme = t;
      listeners.forEach((f) => f());
      return;
    }
  }
  apply();
}

media.addEventListener('change', apply);
apply();

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const snapshot = () => `${document.documentElement.dataset.theme ?? 'light'}|${savedTheme() ?? ''}`;

export function useTheme(): { theme: Theme; followsSystem: boolean } {
  const [theme, saved] = useSyncExternalStore(subscribe, snapshot).split('|');
  return { theme: theme as Theme, followsSystem: !saved };
}
