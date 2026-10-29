// Review and adjust a compiled plan before starting.
import { useEffect, useRef, useState } from 'react';
import type { Plan, PlanEdit, PlanKC, PlanModule } from '../../../shared/api.ts';
import { api, errorMessage } from '../api.ts';
import { showError, useAsync } from '../hooks.ts';
import { startSessionAndGo } from '../actions.ts';
import { Link, navigate } from '../router.tsx';
import { Icon, Loading, PageLoadError, SimpleHeader, TierBadge } from '../ui.tsx';
import { aboutHours, approxHours, pct, plural } from '../format.tsx';

export function PlanReview({ planId }: { planId: string }) {
  const q = useAsync(() => api.plan(planId), [planId]);
  const plan = q.data;
  const [request, setRequest] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [lastRemoved, setLastRemoved] = useState<PlanKC | null>(null);
  const pending = useRef(0);
  const setPlan = q.setData;

  // Poll while a change request is being applied.
  useEffect(() => {
    if (!plan?.updating) return;
    const t = setInterval(() => {
      if (pending.current > 0) return;
      api.plan(planId).then(
        (p) => setPlan(p),
        () => {},
      );
    }, 2000);
    return () => clearInterval(t);
  }, [plan?.updating, planId, setPlan]);

  useEffect(() => {
    if (plan && !plan.updating) setRequestSent(false);
  }, [plan?.updating]);

  if (q.loading) return <Loading />;
  if (q.error || !plan) return <PageLoadError message={q.error ?? "We couldn't load this plan."} onRetry={q.reload} />;

  async function edit(e: PlanEdit, optimistic?: (p: Plan) => Plan) {
    const before = q.data;
    if (optimistic && before) q.setData(optimistic(before));
    pending.current += 1;
    try {
      const next = await api.editPlan(planId, e);
      q.setData(next);
    } catch (err) {
      if (before) q.setData(before);
      showError(err);
    } finally {
      pending.current -= 1;
    }
  }

  const mapKC = (p: Plan, id: string, fn: (k: PlanKC) => PlanKC): Plan => ({
    ...p,
    modules: p.modules.map((m) => ({ ...m, kcs: m.kcs.map((k) => (k.id === id ? fn(k) : k)) })),
  });

  const actions: KCActions = {
    toggleKnown: (k) =>
      edit({ known_kc: k.id, known: !k.known }, (p) => mapKC(p, k.id, (x) => ({ ...x, known: !k.known }))),
    remove: (k) => {
      setLastRemoved(k);
      void edit({ remove_kc: k.id }, (p) => mapKC(p, k.id, (x) => ({ ...x, removed: true })));
    },
    restore: (k) => {
      if (lastRemoved?.id === k.id) setLastRemoved(null);
      void edit({ restore_kc: k.id }, (p) => mapKC(p, k.id, (x) => ({ ...x, removed: false })));
    },
  };

  function move(index: number, dir: -1 | 1) {
    if (!plan) return;
    const j = index + dir;
    if (j < 0 || j >= plan.modules.length) return;
    const order = plan.modules.map((m) => m.id);
    [order[index], order[j]] = [order[j], order[index]];
    void edit({ reorder: order }, (p) => ({ ...p, modules: order.map((id) => p.modules.find((m) => m.id === id)!) }));
    // keep focus on the moved module's button
    requestAnimationFrame(() => {
      document.getElementById(`move-${order[j]}-${dir === -1 ? 'up' : 'down'}`)?.focus();
    });
  }

  async function sendRequest() {
    const text = request.trim();
    if (!text || !plan) return;
    setRequestSent(true);
    try {
      const next = await api.editPlan(planId, { request: text });
      q.setData(next);
      setRequest('');
    } catch (err) {
      setRequestSent(false);
      showError(err);
    }
  }

  async function start() {
    if (!plan || starting) return;
    setStarting(true);
    try {
      const enrollmentId =
        plan.accepted && plan.enrollment_id ? plan.enrollment_id : (await api.acceptPlan(plan.id)).enrollment_id;
      const ok = await startSessionAndGo(enrollmentId, 'placement');
      if (!ok) setStarting(false);
    } catch (err) {
      showError(errorMessage(err));
      setStarting(false);
    }
  }

  const allKcs = plan.modules.flatMap((m) => m.kcs);
  const activeCount = allKcs.filter((k) => !k.removed).length;
  const mix = plan.verification_mix;
  const mixTotal = mix.code_checked + mix.cross_checked + mix.unverified || 1;
  const share = (x: number) => x / mixTotal;
  const updating = plan.updating || requestSent;

  return (
    <div className="screen">
      <SimpleHeader>
        <Link to="/objectives" className="header-link">
          Your objectives
        </Link>
      </SimpleHeader>
      <main id="main" className="page stack-24 pt-8">
        <div className="stack-12">
          <span className="eyebrow eyebrow-teal">
            {plan.accepted ? 'Your plan' : 'Your plan is ready'} · built from{' '}
            {plural(plan.library_topics, 'library topic')} and {plural(plan.source_count, 'source')}
          </span>
          <h1 className="h1 h1-lg">{plan.title}</h1>
          <div className="row-wrap gap-8">
            {[plan.goal_label, ...plan.tags, `${plural(activeCount, 'topic')} · ${aboutHours(plan.total_minutes)}`].map(
              (t) => (
                <span key={t} className="tag-outline">
                  {t}
                </span>
              ),
            )}
          </div>
        </div>

        <div className="two-col">
          <section aria-label="Syllabus" className="col-main stack-16" aria-busy={updating}>
            {updating ? (
              <div className="updating-note" role="status">
                <span className="spinner spinner-sm" aria-hidden="true" />
                Updating your plan. Topics may change in a moment.
              </div>
            ) : null}
            {plan.requirements.length > 0 ? (
              <RequirementGroups plan={plan} actions={actions} />
            ) : (
              plan.modules.map((m, i) => (
                <ModuleCard
                  key={m.id}
                  module={m}
                  index={i}
                  count={plan.modules.length}
                  onMove={move}
                  actions={actions}
                  disabled={updating}
                />
              ))
            )}
            {lastRemoved && allKcs.find((k) => k.id === lastRemoved.id)?.removed ? (
              <div className="undo-bar" role="status">
                <span className="grow">
                  Removed <strong>{lastRemoved.title}</strong>.
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => actions.restore(lastRemoved)}>
                  Undo
                </button>
              </div>
            ) : null}
          </section>

          <aside aria-label="Plan summary" className="col-side stack-16">
            <section className="card pad-22 stack-16">
              <h2 className="h2-sm">How much you can trust it</h2>
              <div
                role="img"
                aria-label={`Items: ${pct(share(mix.code_checked))} code-checked, ${pct(share(mix.cross_checked))} cross-checked, ${pct(share(mix.unverified))} unverified`}
                className="stacked-bar stacked-bar-14"
              >
                {mix.code_checked > 0 ? <span style={{ flex: mix.code_checked, background: 'var(--ink)' }} /> : null}
                {mix.cross_checked > 0 ? (
                  <span style={{ flex: mix.cross_checked, background: 'var(--slate)' }} />
                ) : null}
                {mix.unverified > 0 ? <span className="seg-unverified" style={{ flex: mix.unverified }} /> : null}
              </div>
              <ul className="legend-list">
                <li>
                  <span aria-hidden="true" className="legend-sq" style={{ background: 'var(--ink)' }} />
                  <span className="grow">Code-checked: answers computed or tests run</span>
                  <span className="mono">{pct(share(mix.code_checked))}</span>
                </li>
                <li>
                  <span aria-hidden="true" className="legend-sq" style={{ background: 'var(--slate)' }} />
                  <span className="grow">Cross-checked by a second model</span>
                  <span className="mono">{pct(share(mix.cross_checked))}</span>
                </li>
                <li>
                  <span aria-hidden="true" className="legend-sq seg-unverified" />
                  <span className="grow">Unverified: teaches, counts less</span>
                  <span className="mono">{pct(share(mix.unverified))}</span>
                </li>
              </ul>
              <p className="small muted lh-15">
                {plan.modules.some((m) => m.hands_on)
                  ? 'Hands-on topics use problems about real code, configs and training runs. '
                  : null}
                Every topic cites its sources.{' '}
                {plan.sources.length > 0 ? (
                  <button
                    type="button"
                    className="inline-link"
                    aria-expanded={showSources}
                    aria-controls="sources"
                    onClick={() => setShowSources((s) => !s)}
                  >
                    {showSources ? 'Hide sources' : `See all ${plan.sources.length}`}
                  </button>
                ) : null}
              </p>
              {showSources ? (
                <ul id="sources" className="source-list">
                  {plan.sources.map((s, i) => (
                    <li key={i}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="card pad-22 stack-12">
              <label htmlFor="plan-request" className="h2-sm">
                Want something different?
              </label>
              <textarea
                id="plan-request"
                rows={3}
                className="textarea textarea-sm"
                placeholder="e.g. less theory, more code"
                value={request}
                maxLength={1000}
                onChange={(e) => setRequest(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary self-start"
                disabled={!request.trim() || updating}
                onClick={sendRequest}
              >
                {updating ? 'Updating…' : 'Update plan'}
              </button>
            </section>

            <section className="card-navy pad-22 stack-14">
              <p className="body-15">
                Next, a 5-minute check finds what you already know, so you skip ahead where you can.
              </p>
              <button
                type="button"
                className="btn btn-on-dark btn-block"
                disabled={starting || updating || activeCount === 0}
                onClick={start}
              >
                {starting ? 'Starting…' : 'Start: find my starting point'}
              </button>
              {plan.accepted && plan.enrollment_id ? (
                <button
                  type="button"
                  className="inline-link on-dark self-start"
                  onClick={() => navigate(`/e/${encodeURIComponent(plan.enrollment_id!)}`)}
                >
                  Skip to this objective's home
                </button>
              ) : null}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

interface KCActions {
  toggleKnown: (k: PlanKC) => void;
  remove: (k: PlanKC) => void;
  restore: (k: PlanKC) => void;
}

function ModuleCard({
  module: m,
  index,
  count,
  onMove,
  actions,
  disabled,
}: {
  module: PlanModule;
  index: number;
  count: number;
  onMove: (i: number, dir: -1 | 1) => void;
  actions: KCActions;
  disabled: boolean;
}) {
  const titleId = `mod-${m.id}`;
  return (
    <div className="card module-card" role="group" aria-labelledby={titleId}>
      <div className="module-head">
        <span className="mono-meta">{String(index + 1).padStart(2, '0')}</span>
        <h2 id={titleId} className="module-title">
          {m.title}
        </h2>
        {m.hands_on ? (
          <span className="badge-teal with-icon">
            <Icon name="code" size={12} width={2.4} />
            Hands-on
          </span>
        ) : null}
        <span className="mono-meta">{approxHours(m.minutes)}</span>
        <div className="move-btns">
          <button
            type="button"
            id={`move-${m.id}-up`}
            className="icon-btn"
            aria-label={`Move ${m.title} up`}
            disabled={disabled || index === 0}
            onClick={() => onMove(index, -1)}
          >
            <Icon name="up" size={16} stroke="var(--muted)" />
          </button>
          <button
            type="button"
            id={`move-${m.id}-down`}
            className="icon-btn"
            aria-label={`Move ${m.title} down`}
            disabled={disabled || index === count - 1}
            onClick={() => onMove(index, 1)}
          >
            <Icon name="down" size={16} stroke="var(--muted)" />
          </button>
        </div>
      </div>
      <ul className="kc-rows">
        {m.kcs.map((k) => (
          <KCRow key={k.id} kc={k} actions={actions} />
        ))}
      </ul>
    </div>
  );
}

function KCRow({ kc, actions }: { kc: PlanKC; actions: KCActions }) {
  return (
    <li className={`kc-row${kc.removed ? ' removed' : ''}`}>
      <span className="kc-title">
        {kc.title}
        {kc.removed ? <span className="sr-only"> (removed)</span> : null}
      </span>
      {kc.removed ? (
        <>
          <span className="small muted">Removed from the plan</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => actions.restore(kc)}>
            Restore
          </button>
        </>
      ) : (
        <>
          <span className={kc.origin === 'library' ? 'origin-badge library' : 'origin-badge generated'}>
            {kc.origin === 'library' ? 'Library' : 'Generated'}
          </span>
          <span className="tier-cell">
            {kc.compiled || kc.origin === 'library' ? (
              <TierBadge tier={kc.tier} />
            ) : (
              <span className="small muted">Built just in time</span>
            )}
          </span>
          <label className="know-label">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={kc.known}
              onChange={() => actions.toggleKnown(kc)}
            />
            I know this
          </label>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove ${kc.title}`}
            onClick={() => actions.remove(kc)}
          >
            <Icon name="close" size={16} stroke="var(--muted)" />
          </button>
        </>
      )}
    </li>
  );
}

function RequirementGroups({ plan, actions }: { plan: Plan; actions: KCActions }) {
  const byId = new Map(plan.modules.flatMap((m) => m.kcs.map((k) => [k.id, k] as const)));
  const covered = new Set(plan.requirements.flatMap((r) => r.kc_ids));
  const rest = [...byId.values()].filter((k) => !covered.has(k.id));
  return (
    <>
      {plan.requirements.map((r, i) => {
        const kcs = r.kc_ids.map((id) => byId.get(id)).filter((k): k is PlanKC => !!k);
        const titleId = `req-${r.id}`;
        return (
          <div key={r.id} className="card module-card" role="group" aria-labelledby={titleId}>
            <div className="module-head">
              <span className="mono-meta">{String(i + 1).padStart(2, '0')}</span>
              <div className="stack-4 grow min0">
                <h2 id={titleId} className="module-title">
                  {r.title}
                </h2>
                {r.quote ? <span className="quote">"{r.quote}"</span> : null}
              </div>
            </div>
            <ul className="kc-rows">
              {kcs.length ? (
                kcs.map((k) => <KCRow key={k.id} kc={k} actions={actions} />)
              ) : (
                <li className="kc-row muted small">No topics map to this yet.</li>
              )}
            </ul>
          </div>
        );
      })}
      {rest.length > 0 ? (
        <div className="card module-card" role="group" aria-labelledby="req-rest">
          <div className="module-head">
            <h2 id="req-rest" className="module-title">
              Foundations these build on
            </h2>
          </div>
          <ul className="kc-rows">
            {rest.map((k) => (
              <KCRow key={k.id} kc={k} actions={actions} />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
