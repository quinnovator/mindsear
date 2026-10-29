// The session's right rail.
import type { SessionRail } from '../../../shared/api.ts';
import { Markdown, inDays } from '../format.tsx';
import { Link } from '../router.tsx';
import { CapList, Icon, StateChip, StateSwatch } from '../ui.tsx';

export function Rail({
  rail,
  enrollmentId,
  goalLabel,
}: {
  rail: SessionRail;
  enrollmentId: string;
  goalLabel: string | null;
}) {
  const goal = goalLabel ? goalLabel.replace(/^goal:\s*/i, '').trim() : null;
  return (
    <aside aria-label={rail.why ? 'About this question' : 'Your progress'} className="rail stack-16">
      {rail.why ? (
        <section className="card pad-rail stack-12">
          <div className="row gap-10 center">
            <Icon name="why" size={20} stroke="var(--accent-text)" />
            <h2 className="h2-sm">Why are we doing this?</h2>
          </div>
          <Markdown text={rail.why} className="rail-why" />
        </section>
      ) : null}

      {rail.kc ? (
        <section className="card pad-rail stack-14">
          <div className="row between gap-8 center">
            <h2 className="h2-sm">{rail.kc.title}</h2>
            <StateChip state={rail.kc.state} />
          </div>
          {!rail.why ? (
            <p className="small muted">
              {goal ? `Your goal: ${goal.charAt(0).toLowerCase()}${goal.slice(1)}. ` : ''}Here's what's left before this
              counts as mastered.
            </p>
          ) : null}
          {rail.kc.capabilities.length ? <CapList caps={rail.kc.capabilities} /> : null}
        </section>
      ) : null}

      {rail.path.length && !rail.why ? (
        <section className="card pad-rail stack-12">
          <div className="row between center">
            <h2 className="h2-sm">Your path here</h2>
            <Link to={`/e/${encodeURIComponent(enrollmentId)}/map`} className="text-link small-link">
              Full map
            </Link>
          </div>
          <ol className="path-list">
            {rail.path.map((p) => (
              <li
                key={p.id}
                className={p.current ? 'current' : undefined}
                aria-current={p.current ? 'step' : undefined}
              >
                <StateSwatch state={p.state} />
                <span
                  className={`grow${p.current ? ' strong' : ''}${p.state === 'not_started' && !p.current ? ' muted' : ''}`}
                >
                  {p.title}
                </span>
                <span className="path-label">{p.label}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {rail.next_review && !rail.why ? (
        <section className="card pad-rail-sm row gap-12 center">
          <Icon name="review" size={20} stroke="var(--accent-text)" />
          <p className="small-body lh-145">
            <strong>{rail.next_review.kc_title}</strong> comes back for a review {inDays(rail.next_review.in_days)}.
          </p>
        </section>
      ) : null}
    </aside>
  );
}
