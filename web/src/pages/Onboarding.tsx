// Choose a goal for a library course, then go straight into placement.
import { useEffect, useState } from 'react';
import type { GoalLevel } from '../../../shared/api.ts';
import { api } from '../api.ts';
import { showError, useAsync } from '../hooks.ts';
import { startSessionAndGo } from '../actions.ts';
import { Link } from '../router.tsx';
import { Loading, PageLoadError, SessionLength, SimpleHeader } from '../ui.tsx';

export function Onboarding({ packId }: { packId: string }) {
  const q = useAsync(() => api.library(), []);
  const pack = q.data?.find((p) => p.id === packId) ?? null;
  const [goal, setGoal] = useState<GoalLevel | null>(null);
  const [minutes, setMinutes] = useState<10 | 20 | 30>(20);
  const [reminders, setReminders] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pack && goal == null) setGoal(pack.goals.find((g) => g.id === 'solve')?.id ?? pack.goals[0]?.id ?? null);
  }, [pack, goal]);

  if (q.loading) return <Loading />;
  if (q.error) return <PageLoadError message={q.error} onRetry={q.reload} />;
  if (!pack) {
    return (
      <div className="screen">
        <SimpleHeader />
        <main id="main" className="page page-narrow stack-12">
          <h1 className="h1">We couldn't find that course</h1>
          <p className="lede">
            It may have been renamed. <Link to="/new">Tell us what you want to learn instead</Link>
          </p>
        </main>
      </div>
    );
  }

  async function onContinue() {
    if (!pack || !goal || busy) return;
    setBusy(true);
    try {
      const { enrollment_id } = await api.enroll({ pack_id: pack.id, goal, session_minutes: minutes, reminders });
      const ok = await startSessionAndGo(enrollment_id, 'placement');
      if (!ok) setBusy(false);
    } catch (e) {
      showError(e);
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <SimpleHeader>
        <span className="step-count">Step 2 of 3</span>
      </SimpleHeader>
      <main id="main" className="page page-onboard stack-32">
        <div className="stack-10">
          <span className="eyebrow eyebrow-teal">{pack.title}</span>
          <h1 className="h1 h1-xl">What do you want to be able to do?</h1>
          <p className="lede max-640">
            Your goal decides what we check before calling a concept mastered. You can change it any time.
          </p>
        </div>

        <fieldset className="plain-fieldset stack-12">
          <legend className="sr-only">Goal level</legend>
          {pack.goals.map((g) => {
            const checked = goal === g.id;
            return (
              <label key={g.id} className={`goal-card${checked ? ' checked' : ''}`}>
                <input
                  type="radio"
                  name="goal"
                  value={g.id}
                  checked={checked}
                  onChange={() => setGoal(g.id)}
                  className="radio"
                />
                <div className="stack-8 grow min0">
                  <div className="row-wrap gap-10">
                    <span className="goal-title">{g.label}</span>
                    {g.id === 'solve' ? <span className="badge-teal">Most people pick this</span> : null}
                  </div>
                  <span className="goal-blurb">{g.blurb}</span>
                  {g.capabilities.length ? (
                    <div className="row-wrap gap-6">
                      {g.capabilities.map((c) => (
                        <span key={c} className="tag">
                          {c}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="mono-meta">~{g.hours} h</span>
              </label>
            );
          })}
        </fieldset>

        <div className="row-wrap gap-32">
          <SessionLength value={minutes} onChange={setMinutes} />
          <div className="stack-10 flex-280">
            <span className="field-legend">Review reminders</span>
            <label className="check-card">
              <input
                type="checkbox"
                className="checkbox"
                checked={reminders}
                onChange={(e) => setReminders(e.target.checked)}
              />
              <span className="small-body">
                Email me when reviews are due, at most once a day. No streaks, no guilt.
              </span>
            </label>
          </div>
        </div>

        <div className="footer-row">
          <Link
            to="/new"
            className="text-link"
            onClick={(e) => {
              if (window.history.length > 1) {
                e.preventDefault();
                window.history.back();
              }
            }}
          >
            Back
          </Link>
          <div className="grow" />
          <span className="small muted">Next: a 5-minute check to find your starting point</span>
          <button type="button" className="btn btn-primary" disabled={!goal || busy} onClick={onContinue}>
            {busy ? 'Setting up…' : 'Continue'}
          </button>
        </div>
      </main>
    </div>
  );
}
