// Readiness for a dated objective (e.g. a job interview).
import { useState } from 'react';
import type { Home, SessionKind } from '../../../shared/api.ts';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { startSessionAndGo } from '../actions.ts';
import { EnrollmentHeader, Icon, Loading, PageLoadError, TierGlyph } from '../ui.tsx';
import { inline, monthDay, pct } from '../format.tsx';

export function ReadinessPage({ enrollmentId }: { enrollmentId: string }) {
  return <ReadinessView enrollmentId={enrollmentId} />;
}

function evidenceGlyph(label: string): 'code_checked' | 'cross_checked' | 'none' {
  const l = label.toLowerCase();
  if (l.includes('code')) return 'code_checked';
  if (l.includes('not enough')) return 'none';
  return 'cross_checked';
}

export function ReadinessView({ enrollmentId }: { enrollmentId: string; home?: Home }) {
  const q = useAsync(() => api.readiness(enrollmentId), [enrollmentId]);
  const [busy, setBusy] = useState<string | null>(null);
  if (q.loading) return <Loading />;
  if (q.error || !q.data)
    return <PageLoadError message={q.error ?? "We couldn't load your readiness."} onRetry={q.reload} />;
  const r = q.data;
  const date = monthDay(r.target_date);

  const go = async (key: string, kind: SessionKind, kcId?: string | null) => {
    if (busy) return;
    setBusy(key);
    if (!(await startSessionAndGo(enrollmentId, kind, kcId))) setBusy(null);
  };

  return (
    <div className="screen">
      <EnrollmentHeader enrollmentId={enrollmentId} hasTargetDate current="readiness" context={r.source_label} />
      <main id="main" className="page stack-24 pt-32">
        <div className="title-row">
          <div className="stack-6 min0">
            <span className="eyebrow">Readiness</span>
            <h1 className="h1">{r.title}</h1>
          </div>
          <div className="grow" />
          <div className="date-pill">
            <Icon name="calendar" size={18} stroke="var(--ink)" />
            <span className="small-body">
              Target <strong>{date}</strong>
            </span>
            <span className="mono-meta">
              {r.days_left <= 0 ? 'Today' : r.days_left === 1 ? '1 day' : `${r.days_left} days`}
            </span>
          </div>
        </div>

        <div className="row-wrap gap-24 stretch">
          <section className="card-navy today-card">
            <div className="stack-8 flex-280">
              <span className="eyebrow eyebrow-bright">Today's plan · {r.today.minutes} min</span>
              <p className="today-text">{inline(r.today.text)}</p>
            </div>
            <button
              type="button"
              className="btn btn-on-dark"
              disabled={!!busy}
              onClick={() => go('today', 'learn', r.today.kc_id)}
            >
              {busy === 'today' ? 'Starting…' : "Start today's session"}
            </button>
          </section>
          <section className="card pad-24 stack-10 mock-card">
            <h2 className="h2-sm">Mock interview</h2>
            <p className="small-body text-2">
              Mixed questions across every requirement, asked the way the real thing would ask them. Best from 5 days
              out.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-44 self-start"
              disabled={!!busy}
              onClick={() => go('mock', 'mock_interview')}
            >
              {busy === 'mock' ? 'Starting…' : 'Try a 15-minute one now'}
            </button>
          </section>
        </div>

        <section aria-labelledby="reqs" className="card flush">
          <div className="list-head">
            <h2 id="reqs" className="h2-md">
              What it asks for
            </h2>
            <span className="small muted">
              {r.requirements.length} {r.requirements.length === 1 ? 'requirement' : 'requirements'} · readiness is
              projected to {date}
            </span>
          </div>
          <ul className="req-list">
            {r.requirements.map((row, i) => {
              const v = Math.round(Math.max(0, Math.min(1, row.readiness)) * 100);
              return (
                <li key={row.id} className="req-row">
                  <div className="req-title">
                    <span className="strong body-15">{row.title}</span>
                    {row.quote ? <span className="quote">"{row.quote}"</span> : null}
                  </div>
                  <div className="req-meter">
                    <div
                      className="meter"
                      role="meter"
                      aria-label={`${row.title} readiness`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={v}
                      aria-valuetext={`${v}% by ${date}, ${pct(row.verified_share)} of it from checked questions`}
                    >
                      <div
                        className="meter-fill"
                        style={{ width: `${v}%`, background: row.at_risk ? 'var(--amber-strong)' : 'var(--ink)' }}
                      />
                    </div>
                    <span className="meter-num">{v}%</span>
                  </div>
                  {row.at_risk ? (
                    <span className="req-evidence risk" title={row.evidence_label}>
                      <Icon name="alert" size={14} stroke="var(--amber-strong)" width={2.4} />
                      At risk by {date}
                    </span>
                  ) : (
                    <span className="req-evidence">
                      <TierGlyph tier={evidenceGlyph(row.evidence_label)} />
                      {row.evidence_label}
                    </span>
                  )}
                  <div className="req-action">
                    <span className="small text-2 grow">
                      {row.weakest_kc ? `Weakest: ${row.weakest_kc.title}` : 'Nothing weak yet'}
                    </span>
                    {row.weakest_kc ? (
                      <button
                        type="button"
                        className={`btn btn-40 ${i === 0 ? 'btn-primary' : 'btn-secondary'}`}
                        aria-label={`Practice ${row.weakest_kc.title}`}
                        disabled={!!busy}
                        onClick={() => go(`kc-${row.id}`, 'learn', row.weakest_kc!.id)}
                      >
                        {busy === `kc-${row.id}` ? 'Starting…' : 'Practice'}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="small muted lh-15">
          Readiness counts what you've shown you can do on your own, discounted by how much you're likely to forget by{' '}
          {date}. Evidence from unverified questions counts for less.
        </p>
      </main>
    </div>
  );
}
