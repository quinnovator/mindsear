// The concept map, columns by depth, with a selected-node panel.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { MASTERY_ORDER, MASTERY_SHORT, type KCNode } from '../../../shared/api.ts';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { startSessionAndGo } from '../actions.ts';
import { CapList, EnrollmentHeader, Loading, PageLoadError, StateChip } from '../ui.tsx';
import { plural, relativeDay } from '../format.tsx';

const LEGEND: { state: (typeof MASTERY_ORDER)[number]; label: string }[] = [
  { state: 'retained', label: 'Retained after a delay' },
  { state: 'new_context', label: 'Applied in a new context' },
  { state: 'independent', label: 'Demonstrated independently' },
  { state: 'with_support', label: 'Can use with support' },
  { state: 'introduced', label: 'Introduced' },
  { state: 'not_started', label: 'Not started' },
];

export function ProgressMap({ enrollmentId }: { enrollmentId: string }) {
  const q = useAsync(() => api.progress(enrollmentId), [enrollmentId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const p = q.data;

  const columns = useMemo(() => {
    if (!p) return [] as KCNode[][];
    const depths = [...new Set(p.kcs.map((k) => k.depth))].sort((a, b) => a - b);
    return depths.map((d) => p.kcs.filter((k) => k.depth === d));
  }, [p]);

  useEffect(() => {
    if (p && !selected) setSelected(p.current_kc ?? p.kcs[0]?.id ?? null);
  }, [p, selected]);

  if (q.loading) return <Loading />;
  if (q.error || !p) return <PageLoadError message={q.error ?? "We couldn't load your map."} onRetry={q.reload} />;

  const byId = new Map(p.kcs.map((k) => [k.id, k]));
  const sel = selected ? (byId.get(selected) ?? null) : null;
  const names = (ids: string[]) =>
    ids
      .map((id) => byId.get(id)?.title)
      .filter(Boolean)
      .join(', ');

  // Arrow keys move between nodes: up/down within a column, left/right across columns.
  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const id = target.dataset.kc;
    if (!id) return;
    let ci = -1;
    let ri = -1;
    columns.forEach((col, c) => {
      const r = col.findIndex((k) => k.id === id);
      if (r !== -1) {
        ci = c;
        ri = r;
      }
    });
    if (ci === -1) return;
    let next: KCNode | undefined;
    if (e.key === 'ArrowDown') next = columns[ci][ri + 1];
    else if (e.key === 'ArrowUp') next = columns[ci][ri - 1];
    else if (e.key === 'ArrowRight') next = columns[ci + 1]?.[Math.min(ri, (columns[ci + 1]?.length ?? 1) - 1)];
    else if (e.key === 'ArrowLeft') next = columns[ci - 1]?.[Math.min(ri, (columns[ci - 1]?.length ?? 1) - 1)];
    else return;
    e.preventDefault();
    if (next) gridRef.current?.querySelector<HTMLButtonElement>(`[data-kc="${CSS.escape(next.id)}"]`)?.focus();
  }

  async function start() {
    if (!sel || busy) return;
    setBusy(true);
    if (!(await startSessionAndGo(enrollmentId, 'learn', sel.id))) setBusy(false);
  }

  return (
    <div className="screen">
      <EnrollmentHeader
        enrollmentId={enrollmentId}
        hasTargetDate={p.has_target_date}
        current="map"
        context={`${p.title} · ${p.goal_label}`}
      />
      <main id="main" className="page stack-24 pt-32">
        <div className="title-row end">
          <div className="stack-6">
            <h1 className="h1">Your map</h1>
            <p className="body-15 text-2">Left to right, each column builds on the ones before it.</p>
          </div>
          <div className="grow" />
          <div className="row gap-8 baseline">
            <span className="big-num">{p.retained}</span>
            <span className="small muted">of {p.total} retained after a delay</span>
          </div>
        </div>

        <section aria-label="Concept map" className="card pad-24 map-scroll">
          <div
            ref={gridRef}
            className="map-grid"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(140px, 1fr))`,
              minWidth: columns.length * 152,
            }}
            onKeyDown={onGridKey}
          >
            {columns.map((col, i) => (
              <div key={i} className="map-col" role="group" aria-label={`Column ${i + 1}`}>
                <span className="mono-meta small-12">{String(i + 1).padStart(2, '0')}</span>
                {col.map((k) => {
                  const isSel = k.id === selected;
                  const notes = [
                    MASTERY_SHORT[k.state],
                    k.review_due ? 'review due' : null,
                    k.needed_for_next ? 'needed' : null,
                    isSel ? 'selected' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <button
                      key={k.id}
                      type="button"
                      data-kc={k.id}
                      className={`map-node node-${k.state}${isSel ? ' selected' : ''}`}
                      aria-pressed={isSel}
                      onClick={() => setSelected(k.id)}
                    >
                      {k.title}
                      <span className="node-sub">{notes}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <div className="row-wrap gap-24 start">
          {sel ? (
            <section aria-label="Selected concept" className="card pad-24 sel-panel" aria-live="polite">
              <div className="stack-12 flex-260">
                <div className="row-wrap gap-10 center">
                  <h2 className="h2-lg">{sel.title}</h2>
                  <StateChip state={sel.state} />
                </div>
                {sel.summary ? <p className="small-body text-2 lh-155">{sel.summary}</p> : null}
                <dl className="dl-grid">
                  <dt>Builds on</dt>
                  <dd>{names(sel.prerequisites) || 'Nothing. This is a starting point.'}</dd>
                  <dt>Unlocks</dt>
                  <dd>{names(sel.unlocks) || 'Nothing further in this plan'}</dd>
                  <dt>Practiced</dt>
                  <dd>
                    {sel.sessions > 0
                      ? `${plural(sel.sessions, 'session')}${sel.last_practiced_at ? ` · last ${relativeDay(sel.last_practiced_at)}` : ''}`
                      : 'Not yet'}
                  </dd>
                  {sel.review_due_at ? (
                    <>
                      <dt>Review</dt>
                      <dd>{sel.review_due ? 'Due now' : `Next ${relativeDayFuture(sel.review_due_at)}`}</dd>
                    </>
                  ) : null}
                </dl>
                <button
                  type="button"
                  className="btn btn-primary btn-44 self-start mt-4"
                  disabled={busy}
                  onClick={start}
                >
                  {busy ? 'Starting…' : 'Start a session on this'}
                </button>
              </div>
              <div className="stack-10 flex-240">
                <h3 className="h3">What you can do with it</h3>
                {sel.capabilities.length ? (
                  <CapList caps={sel.capabilities} withStatus={false} />
                ) : (
                  <p className="small muted">Nothing checked yet.</p>
                )}
              </div>
            </section>
          ) : null}

          <section aria-label="Legend" className="card pad-24 stack-12 legend-card">
            <h2 className="h3">What the colors mean</h2>
            <ul className="legend-big">
              {LEGEND.map((l) => (
                <li key={l.state}>
                  <span aria-hidden="true" className={`legend-node node-${l.state}`} />
                  {l.label}
                </li>
              ))}
            </ul>
            <p className="small muted lh-15 mt-4">
              A concept can slip back a step if a review goes badly. That's normal: it just comes back sooner.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

function relativeDayFuture(iso: string): string {
  const d = new Date(iso);
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}
