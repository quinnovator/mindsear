// Home and reviews. "/e/:id" shows readiness instead when the objective has a target date.
import { useState } from 'react';
import { MASTERY_ORDER, type Home, type MasteryState, type SessionKind } from '../../../shared/api.ts';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { startSessionAndGo } from '../actions.ts';
import { EnrollmentHeader, Loading, PageLoadError, StateChip, StateSwatch } from '../ui.tsx';
import { inline, plural, relativeDay } from '../format.tsx';
import { ReadinessView } from './Readiness.tsx';

export function EnrollmentIndex({ enrollmentId }: { enrollmentId: string }) {
  const q = useAsync(() => api.home(enrollmentId), [enrollmentId]);
  if (q.loading) return <Loading />;
  if (q.error || !q.data)
    return <PageLoadError message={q.error ?? "We couldn't load your home page."} onRetry={q.reload} />;
  if (q.data.has_target_date) return <ReadinessView enrollmentId={enrollmentId} home={q.data} />;
  return <HomeView home={q.data} current="home" />;
}

export function HomePage({ enrollmentId }: { enrollmentId: string }) {
  const q = useAsync(() => api.home(enrollmentId), [enrollmentId]);
  if (q.loading) return <Loading />;
  if (q.error || !q.data)
    return <PageLoadError message={q.error ?? "We couldn't load your home page."} onRetry={q.reload} />;
  return <HomeView home={q.data} current="home" />;
}

const BAR_ORDER: MasteryState[] = [...MASTERY_ORDER].reverse(); // retained first
const BAR_LABEL: Record<MasteryState, string> = {
  retained: 'Retained',
  new_context: 'New context',
  independent: 'Independent',
  with_support: 'With support',
  introduced: 'Introduced',
  not_started: 'Not started',
};
const BAR_ARIA: Record<MasteryState, string> = {
  retained: 'retained',
  new_context: 'applied in a new context',
  independent: 'demonstrated independently',
  with_support: 'with support',
  introduced: 'introduced',
  not_started: 'not started',
};

function HomeView({ home, current }: { home: Home; current: 'home' }) {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (key: string, kind: SessionKind, kcId?: string | null) => {
    if (busy) return;
    setBusy(key);
    if (!(await startSessionAndGo(home.enrollment_id, kind, kcId))) setBusy(null);
  };
  const p = home.progress;
  const total = p.total || 1;
  const reviewCount = home.reviews.length;

  return (
    <div className="screen">
      <EnrollmentHeader
        enrollmentId={home.enrollment_id}
        hasTargetDate={home.has_target_date}
        current={current}
        context={`${home.title} · ${home.goal_label}`}
      />
      <main id="main" className="page stack-24 pt-32">
        <h1 className="h1">Welcome back</h1>

        <div className="row-wrap gap-24 stretch">
          {home.needs_placement ? (
            <section className="card-navy hero">
              <div className="stack-6">
                <span className="eyebrow eyebrow-bright">Start here</span>
                <h2 className="h2-hero">Find your starting point</h2>
                <p className="on-dark-muted body-15 max-520">
                  A 5-minute check finds what you already know, so you skip ahead where you can. It isn't graded.
                </p>
              </div>
              <div className="row-wrap gap-16 center">
                <button
                  type="button"
                  className="btn btn-on-dark"
                  disabled={!!busy}
                  onClick={() => go('placement', 'placement')}
                >
                  {busy === 'placement' ? 'Starting…' : 'Find your starting point'}
                </button>
                <span className="mono-meta on-dark-muted">about 5 min</span>
              </div>
            </section>
          ) : reviewCount > 0 ? (
            <section className="card-navy hero">
              <div className="stack-6">
                <span className="eyebrow eyebrow-bright">Reviews due</span>
                <h2 className="h2-hero">
                  {reviewCount === 1 ? '1 concept is fading' : `${reviewCount} concepts are fading`}
                </h2>
                <p className="on-dark-muted body-15 max-520">
                  {reviewCount === 1 ? "It's due" : "They're due"} because you're about to forget{' '}
                  {reviewCount === 1 ? 'it' : 'them'}. Each review uses fresh problems, never the ones you've seen.
                </p>
              </div>
              <ul className="review-list">
                {home.reviews.map((r) => (
                  <li key={r.kc_id}>
                    <StateSwatch state={r.state} onDark />
                    <span className="grow">{r.title}</span>
                    {r.last_practiced_at ? (
                      <span className="small on-dark-muted">last practiced {relativeDay(r.last_practiced_at)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="row-wrap gap-16 center">
                <button
                  type="button"
                  className="btn btn-on-dark"
                  disabled={!!busy}
                  onClick={() => go('review', 'review')}
                >
                  {busy === 'review' ? 'Starting…' : 'Start review'}
                </button>
                <span className="mono-meta on-dark-muted">about {home.review_minutes} min</span>
              </div>
            </section>
          ) : (
            <section className="card-navy hero">
              <div className="stack-6">
                <span className="eyebrow eyebrow-bright">Reviews</span>
                <h2 className="h2-hero">Nothing is due today</h2>
                <p className="on-dark-muted body-15 max-520">
                  Each concept comes back for review right before you're likely to forget it. When one is due, it shows
                  up here.
                </p>
              </div>
            </section>
          )}

          <div className="home-side stack-24">
            <section className="card pad-24 stack-14">
              <span className="eyebrow">Continue learning</span>
              {home.continue ? (
                <>
                  <div className="row-wrap gap-10 center">
                    <h2 className="h2">{home.continue.title}</h2>
                    <StateChip state={home.continue.state} />
                  </div>
                  <p className="small-body text-2">{home.continue.blurb}</p>
                  <button
                    type="button"
                    className="btn btn-primary btn-44 self-start"
                    disabled={!!busy || home.needs_placement}
                    onClick={() => go('learn', 'learn', home.continue!.kc_id)}
                  >
                    {busy === 'learn' ? 'Starting…' : `Continue · ${home.continue.minutes} min`}
                  </button>
                  {home.needs_placement ? (
                    <span className="small muted">Available after the starting-point check.</span>
                  ) : null}
                </>
              ) : (
                <p className="small-body text-2">
                  You've worked through every topic in this plan. Reviews will keep it fresh.
                </p>
              )}
            </section>

            {home.last_session ? (
              <section className="card pad-24 stack-12">
                <span className="eyebrow">Last session · {relativeDay(home.last_session.ended_at)}</span>
                <ul className="recap-bullets">
                  {home.last_session.summary.map((s, i) => (
                    <li key={i}>{inline(s)}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>

        <section aria-label="Overall progress" className="card pad-24 progress-row">
          <div className="stat">
            <span className="small muted">Retained after a delay</span>
            <span className="stat-num">
              {p.retained}
              <span className="stat-of"> / {p.total}</span>
            </span>
          </div>
          <div className="stat stat-wide">
            <span className="small muted">Demonstrated on your own</span>
            <span className="stat-num">
              {p.independent_or_better}
              <span className="stat-of"> / {p.total}</span>
            </span>
          </div>
          <div className="progress-bar-col">
            <div
              role="img"
              aria-label={`${plural(p.total, 'concept')}: ${BAR_ORDER.map((s) => `${p.counts[s] ?? 0} ${BAR_ARIA[s]}`).join(', ')}`}
              className="stacked-bar stacked-bar-16"
            >
              {BAR_ORDER.map((s) =>
                (p.counts[s] ?? 0) > 0 ? (
                  <span key={s} className={`bar-${s}`} style={{ flex: (p.counts[s] ?? 0) / total }} />
                ) : null,
              )}
            </div>
            <div className="bar-legend">
              {BAR_ORDER.map((s) => (
                <span key={s}>
                  <span aria-hidden="true" className={`legend-sq bar-${s}`} />
                  {BAR_LABEL[s]} {p.counts[s] ?? 0}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
