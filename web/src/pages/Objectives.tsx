import { useEffect } from 'react';
import type { ObjectiveStatus, ObjectiveSummary } from '../../../shared/api.ts';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { Link, navigate } from '../router.tsx';
import { AccountMenu, Icon, Loading, PageLoadError, SimpleHeader } from '../ui.tsx';
import { monthDay, plural } from '../format.tsx';
import { Intake } from './Intake.tsx';

const STATUS_LABEL: Record<ObjectiveStatus, string> = {
  scoping: 'Answer a few questions',
  compiling: 'Building your plan',
  review: 'Plan ready to review',
  active: 'In progress',
  archived: 'Archived',
  failed: "Couldn't build a plan",
};

export function objectiveHref(o: Pick<ObjectiveSummary, 'id' | 'status' | 'plan_id' | 'enrollment_id'>): string {
  if (o.enrollment_id && (o.status === 'active' || o.status === 'archived'))
    return `/e/${encodeURIComponent(o.enrollment_id)}`;
  if (o.plan_id && o.status === 'review') return `/plans/${encodeURIComponent(o.plan_id)}`;
  return `/objectives/${encodeURIComponent(o.id)}`;
}

/** "/": no objectives -> intake; exactly one live objective that's active -> its home; else the list. */
export function Root() {
  const q = useAsync(() => api.objectives(), []);
  const live = q.data?.filter((o) => o.status !== 'archived') ?? [];
  const only = live.length === 1 && live[0].status === 'active' && live[0].enrollment_id ? live[0] : null;
  useEffect(() => {
    if (only) navigate(objectiveHref(only), { replace: true });
  }, [only]);
  if (q.loading) return <Loading />;
  if (q.error) return <PageLoadError message={q.error} onRetry={q.reload} />;
  if (!q.data || q.data.length === 0) return <Intake objectiveId={null} />;
  if (only) return <Loading />;
  return <ObjectivesView items={q.data} />;
}

export function ObjectivesList() {
  const q = useAsync(() => api.objectives(), []);
  if (q.loading) return <Loading />;
  if (q.error) return <PageLoadError message={q.error} onRetry={q.reload} />;
  return <ObjectivesView items={q.data ?? []} />;
}

function ObjectivesView({ items }: { items: ObjectiveSummary[] }) {
  const sorted = [...items].sort((a, b) => {
    const rank = (o: ObjectiveSummary) => (o.status === 'archived' ? 1 : 0);
    return rank(a) - rank(b) || b.created_at.localeCompare(a.created_at);
  });
  return (
    <div className="screen">
      <SimpleHeader>
        <AccountMenu />
      </SimpleHeader>
      <main id="main" className="page page-mid stack-28">
        <div className="title-row">
          <div className="stack-6">
            <h1 className="h1">Your objectives</h1>
            <p className="lede">Pick up where you left off, or start something new.</p>
          </div>
          <div className="grow" />
          <Link to="/new" className="btn btn-primary">
            <Icon name="plus" />
            New objective
          </Link>
        </div>
        {sorted.length === 0 ? (
          <div className="card pad-24 stack-12">
            <p className="body">You don't have any objectives yet.</p>
            <Link to="/new" className="btn btn-primary self-start">
              Tell us what you want to learn
            </Link>
          </div>
        ) : (
          <ul className="objective-list">
            {sorted.map((o) => (
              <li key={o.id}>
                <Link to={objectiveHref(o)} className={`objective-card${o.status === 'archived' ? ' archived' : ''}`}>
                  <div className="stack-6 grow min0">
                    <span className="objective-title">{o.title}</span>
                    <span className="objective-meta">
                      {[o.goal_label, o.target_date ? `Target ${monthDay(o.target_date)}` : null]
                        .filter(Boolean)
                        .join(' · ') || ' '}
                    </span>
                  </div>
                  {o.total_kcs > 0 ? (
                    <div className="objective-stat">
                      <span className="mono-num">
                        {o.retained}
                        <span className="of"> / {o.total_kcs}</span>
                      </span>
                      <span className="small muted">retained</span>
                    </div>
                  ) : null}
                  {o.reviews_due > 0 ? (
                    <span className="pill pill-teal">{plural(o.reviews_due, 'review')} due</span>
                  ) : null}
                  <span className={`pill status-${o.status}`}>{STATUS_LABEL[o.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          Or start with a ready-made course: <Link to="/library/intro-probability">Intro probability</Link>
        </p>
      </main>
    </div>
  );
}
