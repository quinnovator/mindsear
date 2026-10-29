// Shared visual building blocks: logo, icons, mastery chips, capability checklist, headers, banners.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  CAPABILITY_LABEL,
  MASTERY_LABEL,
  MASTERY_SHORT,
  type CapStatus,
  type KCNode,
  type MasteryState,
  type Tier,
} from '../../shared/api.ts';
import { clearError, useErrorBanner, useMe } from './hooks.ts';
import { Link, useLocation } from './router.tsx';
import { setTheme, useTheme } from './theme.ts';

// ---------- Logo ----------
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="var(--navy)" />
      <path
        d="M8 18l4-8 4 6 4-5"
        stroke="#5EEAD4"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ to }: { to?: string }) {
  const inner = (
    <>
      <Logo />
      <span className="brand-name">Mind Sear</span>
    </>
  );
  return to ? (
    <Link to={to} className="brand" aria-label="Mind Sear, your objectives">
      {inner}
    </Link>
  ) : (
    <span className="brand">{inner}</span>
  );
}

export function TutorAvatar() {
  return (
    <div className="tutor-avatar" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 28 28">
        <path
          d="M6 18l4-8 4 6 4-5"
          stroke="#5EEAD4"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// ---------- Icons (stroke icons, 24 viewBox) ----------
type IconName =
  | 'hint'
  | 'example'
  | 'why'
  | 'ask'
  | 'clock'
  | 'close'
  | 'check'
  | 'calendar'
  | 'link'
  | 'clip'
  | 'review'
  | 'up'
  | 'down'
  | 'code'
  | 'alert'
  | 'plus'
  | 'user'
  | 'sun'
  | 'moon';

const PATHS: Record<IconName, ReactNode> = {
  hint: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z" />,
  example: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19V5" />
    </>
  ),
  why: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5M12 17h.01" />
    </>
  ),
  ask: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  clip: (
    <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
  ),
  review: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  alert: (
    <>
      <path d="M12 8v5M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  stroke = 'currentColor',
  width = 2,
}: {
  name: IconName;
  size?: number;
  stroke?: string;
  width?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

// ---------- Mastery ----------
export function StateChip({ state }: { state: MasteryState }) {
  return <span className={`state-chip st-${state}`}>{MASTERY_LABEL[state]}</span>;
}

export function StateSwatch({
  state,
  size = 12,
  onDark = false,
}: {
  state: MasteryState;
  size?: number;
  onDark?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`swatch sw-${state}${onDark ? ' on-dark' : ''}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Small icon showing a mastery state (used in the phone header chip). */
export function StateGlyph({ state }: { state: MasteryState }) {
  if (state === 'with_support') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--amber-strong)" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="var(--amber-strong)" />
      </svg>
    );
  }
  const map: Record<MasteryState, { fill: string; stroke: string; dash?: string }> = {
    not_started: { fill: 'none', stroke: 'var(--input-border)', dash: '3 3' },
    introduced: { fill: 'none', stroke: 'var(--input-border)' },
    with_support: { fill: 'none', stroke: 'var(--amber-strong)' },
    independent: { fill: 'var(--teal-tint)', stroke: 'var(--teal)' },
    new_context: { fill: 'var(--m-new-context)', stroke: 'var(--m-new-context)' },
    retained: { fill: 'var(--m-retained)', stroke: 'var(--m-retained)' },
  };
  const s = map[state];
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill={s.fill} stroke={s.stroke} strokeWidth="2" strokeDasharray={s.dash} />
    </svg>
  );
}

export function CapIcon({ status }: { status: CapStatus }) {
  if (status === 'passed') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="var(--teal)" />
        <path
          d="M7.5 12.5l3 3 6-6.5"
          stroke="#FFFFFF"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--amber-strong)" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="var(--amber-strong)" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="var(--input-border)"
        strokeWidth="2"
        strokeDasharray={status === 'after_mastery' ? '3 3' : undefined}
      />
    </svg>
  );
}

type Cap = KCNode['capabilities'][number];

/** The capability checklist shown in sessions and on the map. `withStatus` adds the right-hand status words. */
export function CapList({ caps, withStatus = true }: { caps: Cap[]; withStatus?: boolean }) {
  const anyInProgress = caps.some((c) => c.status === 'in_progress');
  let nextMarked = anyInProgress;
  return (
    <ul className="cap-list">
      {caps.map((c) => {
        let status: ReactNode = null;
        let mono = false;
        let done = false;
        if (c.progress) {
          status = c.progress;
          mono = /\d/.test(c.progress);
        } else if (c.status === 'passed') {
          status = 'Done';
          done = true;
        } else if (c.status === 'in_progress') status = 'In progress';
        else if (c.status === 'after_mastery') status = 'After mastery';
        else if (!nextMarked) {
          status = 'Next';
          nextMarked = true;
        } else status = 'To do';
        const label = c.label || CAPABILITY_LABEL[c.key];
        return (
          <li key={c.key}>
            <CapIcon status={c.status} />
            <span className="grow">{label}</span>
            {withStatus || c.progress ? (
              <span className={`cap-status${mono ? ' mono' : ''}${done ? ' done' : ''}`}>{status}</span>
            ) : (
              <span className="sr-only">{status}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Verification tier ----------
export function TierGlyph({ tier, size = 12 }: { tier: Tier | 'mixed' | 'none'; size?: number }) {
  if (tier === 'code_checked') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="5" fill="var(--ink)" />
      </svg>
    );
  }
  if (tier === 'cross_checked') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.2" fill="none" stroke="var(--ink)" strokeWidth="1.6" />
      </svg>
    );
  }
  if (tier === 'none') {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        <circle
          cx="6"
          cy="6"
          r="4.2"
          fill="none"
          stroke="var(--input-border)"
          strokeWidth="1.6"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="var(--amber-strong)" strokeWidth="1.6" strokeDasharray="2 2" />
    </svg>
  );
}

export const TIER_LABEL: Record<Tier | 'mixed', string> = {
  code_checked: 'Code-checked',
  cross_checked: 'Cross-checked',
  unverified: 'Unverified',
  mixed: 'Partly unverified',
};

export function TierBadge({ tier }: { tier: Tier | 'mixed' }) {
  const warn = tier === 'mixed' || tier === 'unverified';
  return (
    <span className={`tier-badge${warn ? ' warn' : ''}`}>
      <TierGlyph tier={tier} />
      {TIER_LABEL[tier]}
    </span>
  );
}

// ---------- Banners and page states ----------
export function ErrorBanner({
  message,
  onDismiss,
  onRetry,
}: {
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="error-banner" role="alert">
      <Icon name="alert" size={18} stroke="var(--amber-strong)" width={2.4} />
      <span className="grow">{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
      {onDismiss ? (
        <button type="button" className="icon-btn" aria-label="Dismiss message" onClick={onDismiss}>
          <Icon name="close" size={16} stroke="var(--muted)" />
        </button>
      ) : null}
    </div>
  );
}

export function GlobalErrorBanner() {
  const msg = useErrorBanner();
  const { path } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearError();
  }, [path]);
  if (!msg) return null;
  return (
    <div className="global-banner">
      <ErrorBanner message={msg} onDismiss={clearError} />
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function PageLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="page page-narrow">
      <ErrorBanner message={message} onRetry={onRetry} />
      <p className="muted small">
        <Link to="/objectives">Go to your objectives</Link>
      </p>
    </main>
  );
}

// ---------- Account menu ----------
export function AccountMenu() {
  const me = useMe();
  const { followsSystem } = useTheme();
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const initials = me?.name
    ? me.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join('')
    : null;
  return (
    <div className="account" ref={ref}>
      <button
        type="button"
        className="account-btn"
        aria-label="Account"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {initials ? <span aria-hidden="true">{initials}</span> : <Icon name="user" size={18} />}
      </button>
      {open ? (
        <div className="account-pop" id={id}>
          {me ? (
            <>
              <span className="account-name">{me.name}</span>
              <span className="account-email">{me.email}</span>
            </>
          ) : (
            <span className="account-email">Not signed in</span>
          )}
          <Link to="/objectives" className="account-link" onClick={() => setOpen(false)}>
            Your objectives
          </Link>
          <Link to="/new" className="account-link" onClick={() => setOpen(false)}>
            New objective
          </Link>
          {followsSystem ? null : (
            <button type="button" className="account-link account-action" onClick={() => setTheme(null)}>
              Match system theme
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Theme ----------
/** Switches between light and dark; until it's used, the OS setting decides. */
export function ThemeToggle() {
  const { theme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-btn"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

// ---------- Headers ----------
/** Plain header used on intake, onboarding, plan review and placement. */
export function SimpleHeader({ children, brandTo = '/objectives' }: { children?: ReactNode; brandTo?: string }) {
  return (
    <header className="simple-header">
      <Brand to={brandTo} />
      <div className="grow" />
      <ThemeToggle />
      {children}
    </header>
  );
}

export type EnrollmentTab = 'readiness' | 'home' | 'map';

/** White top bar with Home · Map · (Readiness) · Objectives. */
export function EnrollmentHeader({
  enrollmentId,
  hasTargetDate,
  current,
  context,
}: {
  enrollmentId: string;
  hasTargetDate: boolean;
  current: EnrollmentTab;
  context?: string;
}) {
  const base = `/e/${encodeURIComponent(enrollmentId)}`;
  const tabs: { key: EnrollmentTab | 'objectives'; label: string; to: string }[] = hasTargetDate
    ? [
        { key: 'readiness', label: 'Readiness', to: base },
        { key: 'home', label: 'Home', to: `${base}/home` },
        { key: 'map', label: 'Map', to: `${base}/map` },
        { key: 'objectives', label: 'Objectives', to: '/objectives' },
      ]
    : [
        { key: 'home', label: 'Home', to: base },
        { key: 'map', label: 'Map', to: `${base}/map` },
        { key: 'objectives', label: 'Objectives', to: '/objectives' },
      ];
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Brand to="/objectives" />
        <nav aria-label="Main" className="main-nav">
          {tabs.map((t) => (
            <Link key={t.key} to={t.to} className="nav-link" aria-current={t.key === current ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="grow" />
        {context ? <span className="header-context">{context}</span> : null}
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}

// ---------- Session length segmented control ----------
export function SessionLength({
  value,
  onChange,
  legend = 'Session length',
}: {
  value: 10 | 20 | 30;
  onChange: (v: 10 | 20 | 30) => void;
  legend?: string;
}) {
  return (
    <fieldset className="plain-fieldset">
      <legend className="field-legend">{legend}</legend>
      <div className="segmented" role="group">
        {([10, 20, 30] as const).map((m) => (
          <button key={m} type="button" aria-pressed={value === m} className="seg-btn" onClick={() => onChange(m)}>
            {m} min
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export { MASTERY_LABEL, MASTERY_SHORT };
