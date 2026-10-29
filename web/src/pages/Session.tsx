// Screens 2, 4, 5, 7: the tutoring session (and the placement variant).
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  MASTERY_LABEL,
  MASTERY_SHORT,
  type ItemView,
  type LearnerAction,
  type StreamEvent,
} from '../../../shared/api.ts';
import { api, newActionId } from '../api.ts';
import { showError, useEventSource, useNow, usePrefersReducedMotion } from '../hooks.ts';
import { startSessionAndGo } from '../actions.ts';
import { Link, navigate } from '../router.tsx';
import {
  Brand,
  ErrorBanner,
  Icon,
  Loading,
  PageLoadError,
  SimpleHeader,
  StateGlyph,
  ThemeToggle,
  TutorAvatar,
} from '../ui.tsx';
import { Markdown, inline, monthDay, plural } from '../format.tsx';
import { activeTurn, initialState, itemFor, reducer, type LocalTurn, type SessionState } from '../session/state.ts';
import { AnswerWidget, confidenceText, looksNumeric, type AnswerPayload } from '../session/Widgets.tsx';
import { Rail } from '../session/Rail.tsx';

const SESSION_EVENTS = [
  'ack',
  'learner.turn',
  'assessing',
  'tutor.start',
  'tutor.delta',
  'tutor.done',
  'progress',
  'rail',
  'placement',
  'session.recap',
  'error',
] as const;

type HelpType = 'hint' | 'example' | 'why';

export function Session({ sessionId }: { sessionId: string }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [goalLabel, setGoalLabel] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api.session(sessionId).then(
      (view) => dispatch({ type: 'loaded', view }),
      (e) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, [sessionId]);

  useEffect(load, [load]);

  // Open the stream right away; events that land before the transcript are merged idempotently by turn id.
  useEventSource<StreamEvent>(
    `/api/sessions/${encodeURIComponent(sessionId)}/stream`,
    SESSION_EVENTS,
    (ev) => dispatch({ type: 'event', ev }),
    load,
  );

  const enrollmentId = state.view?.enrollment_id ?? null;
  useEffect(() => {
    if (!enrollmentId) return;
    let alive = true;
    api.home(enrollmentId).then(
      (h) => alive && setGoalLabel(h.goal_label),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [enrollmentId]);

  const post = useCallback(
    async (action: LearnerAction) => {
      dispatch({ type: 'posted', hint: action.type === 'hint' });
      try {
        await api.act(sessionId, { ...action, action_id: newActionId() });
      } catch (e) {
        dispatch({ type: 'post_failed' });
        showError(e);
      }
    },
    [sessionId],
  );

  const end = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    try {
      const recap = await api.endSession(sessionId);
      dispatch({ type: 'recap', recap });
    } catch (e) {
      showError(e);
    } finally {
      setEnding(false);
    }
  }, [ending, sessionId]);

  if (loadError && !state.view) return <PageLoadError message={loadError} onRetry={load} />;
  if (!state.view) return <Loading label="Opening your session…" />;

  if (state.view.kind === 'placement') {
    return <PlacementLayout state={state} post={post} end={end} ending={ending} />;
  }
  return (
    <TutorLayout
      state={state}
      post={post}
      end={end}
      ending={ending}
      goalLabel={goalLabel}
      dismissStreamError={() => dispatch({ type: 'dismiss_stream_error' })}
    />
  );
}

// ---------- shared bits ----------

function useMinutesLeft(startedAt: string, minutesTotal: number): number {
  const now = useNow(15_000);
  const endAt = new Date(startedAt).getTime() + minutesTotal * 60_000;
  if (Number.isNaN(endAt)) return minutesTotal;
  return Math.max(0, Math.ceil((endAt - now) / 60_000));
}

/** Track time on the active item for ms_on_item. */
function useItemTimer(activeId: string | null) {
  const since = useRef<number>(Date.now());
  useEffect(() => {
    since.current = Date.now();
  }, [activeId]);
  return () => Date.now() - since.current;
}

function useAutoScroll(state: SessionState) {
  const endRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const reduced = usePrefersReducedMotion();
  const count = state.turns.length;
  const last = state.turns[state.turns.length - 1];
  const lastLen = last?.content.length ?? 0;
  const prevCount = useRef(count);

  useEffect(() => {
    const onScroll = () => {
      atBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    const added = count > prevCount.current;
    prevCount.current = count;
    if (!endRef.current) return;
    if (added || atBottom.current)
      endRef.current.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
  }, [count, lastLen, state.assessing, state.recap, reduced]);

  // Jump to the newest turn on first render.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, []);
  return endRef;
}

function RecapCard({ state }: { state: SessionState }) {
  const recap = state.recap!;
  const enrollmentId = state.view!.enrollment_id;
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="recap-title" className="card pad-24 stack-16 recap-card">
      <div className="stack-6">
        <span className="eyebrow eyebrow-teal">Session recap</span>
        <h2 id="recap-title" className="h2">
          {state.view!.kind === 'placement' ? 'Your starting point is set' : "Here's where you got to"}
        </h2>
      </div>
      {recap.summary.length ? (
        <ul className="recap-bullets">
          {recap.summary.map((s, i) => (
            <li key={i}>{inline(s)}</li>
          ))}
        </ul>
      ) : null}
      {recap.next_review_at ? (
        <p className="small-body row gap-8 center">
          <Icon name="review" size={18} stroke="var(--accent-text)" />
          Next review: <strong>{monthDay(recap.next_review_at)}</strong>
        </p>
      ) : null}
      <div className="row-wrap gap-12">
        <Link
          to={`/e/${encodeURIComponent(enrollmentId)}`}
          className={`btn ${recap.next_kc ? 'btn-secondary' : 'btn-primary'}`}
        >
          Back to home
        </Link>
        {recap.next_kc ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              if (!(await startSessionAndGo(enrollmentId, 'learn', recap.next_kc!.id))) setBusy(false);
            }}
          >
            {busy ? 'Starting…' : `Continue with ${recap.next_kc.title}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FlagLink({ instanceId }: { instanceId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  if (state === 'sent')
    return (
      <p className="flag-done small muted" role="status">
        Thanks. We'll check this question.
      </p>
    );
  if (!open) {
    return (
      <button type="button" className="flag-link" onClick={() => setOpen(true)}>
        Report a problem with this question
      </button>
    );
  }
  return (
    <form
      className="flag-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setState('sending');
        try {
          await api.flagItem(instanceId, reason.trim() || undefined);
          setState('sent');
        } catch (err) {
          setState('idle');
          showError(err);
        }
      }}
    >
      <label htmlFor={`flag-${instanceId}`} className="small strong">
        What's wrong with it? <span className="muted">(optional)</span>
      </label>
      <div className="row gap-8">
        <input
          id={`flag-${instanceId}`}
          className="input input-sm grow"
          value={reason}
          maxLength={500}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. the numbers don't add up"
        />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={state === 'sending'}>
          Send
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function hintsLabel(n: number): string {
  return n === 0 ? 'No hints used' : `${plural(n, 'hint')} used`;
}

// ---------- Tutor layout ----------

function TutorLayout({
  state,
  post,
  end,
  ending,
  goalLabel,
  dismissStreamError,
}: {
  state: SessionState;
  post: (a: LearnerAction) => Promise<void>;
  end: () => void;
  ending: boolean;
  goalLabel: string | null;
  dismissStreamError: () => void;
}) {
  const view = state.view!;
  const minutesLeft = useMinutesLeft(view.started_at, view.minutes_total);
  const active = activeTurn(state);
  const elapsed = useItemTimer(active?.id ?? null);
  const endRef = useAutoScroll(state);
  const [sideOpen, setSideOpen] = useState(false);
  const [sideText, setSideText] = useState('');
  const disabled = state.waiting;
  const ended = !!state.recap || !!view.ended_at;
  const kc = state.rail?.kc ?? null;
  const helpAllowed =
    !!active && !!active.widget && ['numeric', 'mcq', 'free_text', 'steps'].includes(active.widget.kind) && !ended;

  useEffect(() => {
    setSideOpen(false);
  }, [active?.id]);

  const help = (type: HelpType) => {
    if (!active || disabled) return;
    void post({ type, turn_id: active.id });
  };
  const sendSide = () => {
    const text = sideText.trim();
    if (!active || !text || disabled) return;
    void post({ type: 'side_question', turn_id: active.id, text });
    setSideText('');
    setSideOpen(false);
  };
  const answer = (a: AnswerPayload) => {
    if (!active) return;
    void post({ type: 'answer', turn_id: active.id, ...a, ms_on_item: elapsed() });
  };
  const unsure = () => active && void post({ type: 'unsure', turn_id: active.id });

  const mapHref = `/e/${encodeURIComponent(view.enrollment_id)}/map`;

  return (
    <div className="screen session-screen">
      <header className="app-header session-header">
        <div className="app-header-inner session-header-inner">
          {/* phone: close button on the left */}
          {!ended ? (
            <button
              type="button"
              className="icon-btn mob-only-flex"
              aria-label="End session"
              onClick={end}
              disabled={ending}
            >
              <Icon name="close" size={20} stroke="var(--ink)" />
            </button>
          ) : (
            <Link
              to={`/e/${encodeURIComponent(view.enrollment_id)}`}
              className="icon-btn mob-only-flex"
              aria-label="Back to home"
            >
              <Icon name="close" size={20} stroke="var(--ink)" />
            </Link>
          )}
          <span className="desk-only-flex">
            <Brand to={`/e/${encodeURIComponent(view.enrollment_id)}`} />
          </span>
          <nav aria-label="Breadcrumb" className="breadcrumb desk-only-flex">
            <Link to={`/e/${encodeURIComponent(view.enrollment_id)}`} className="crumb">
              {view.title}
            </Link>
            {view.kc_title ? (
              <>
                <span aria-hidden="true">/</span>
                <span className="crumb-current" aria-current="page">
                  {view.kc_title}
                </span>
              </>
            ) : null}
          </nav>
          <div className="mob-title mob-only-flex">
            <span className="mob-title-main">{view.kc_title ?? view.title}</span>
            <span className="mob-title-sub">{ended ? 'Session ended' : `${minutesLeft} min left`}</span>
          </div>
          <div className="grow desk-only-flex" />
          <span className="desk-only-flex">
            <ThemeToggle />
          </span>
          {!ended ? (
            <div className="time-left desk-only-flex" aria-live="off">
              <Icon name="clock" size={16} />
              <span className="mono">{minutesLeft} min left</span>
            </div>
          ) : null}
          {!ended ? (
            <button type="button" className="btn btn-secondary btn-44 desk-only-flex" onClick={end} disabled={ending}>
              {ending ? 'Ending…' : 'End session'}
            </button>
          ) : null}
          {kc ? (
            <Link
              to={mapHref}
              className={`mastery-chip mob-only-flex st-${kc.state}`}
              aria-label={`Progress: ${MASTERY_LABEL[kc.state].toLowerCase()}. Open map`}
            >
              <StateGlyph state={kc.state} />
              {MASTERY_SHORT[kc.state]}
            </Link>
          ) : null}
        </div>
      </header>

      <main id="main" className={`page session-main${helpAllowed ? ' has-help-bar' : ''}`}>
        <section aria-label="Tutoring conversation" className="conversation">
          {state.turns.map((t, i) => (
            <TurnView
              key={t.id}
              turn={t}
              index={i}
              state={state}
              active={active}
              disabled={disabled}
              onAnswer={answer}
              onUnsure={unsure}
              helpRow={
                active && t.id === active.id && helpAllowed ? (
                  <HelpRow
                    disabled={disabled}
                    sideOpen={sideOpen}
                    setSideOpen={setSideOpen}
                    sideText={sideText}
                    setSideText={setSideText}
                    onHelp={help}
                    onSide={sendSide}
                  />
                ) : null
              }
            />
          ))}
          {state.assessing ? (
            <div className="assessing" role="status">
              <span className="spinner spinner-sm" aria-hidden="true" />
              {state.assessing}
            </div>
          ) : state.waiting && !state.streamingId ? (
            <div className="tutor-row" role="status" aria-label="The tutor is writing">
              <TutorAvatar />
              <div className="bubble typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}
          {state.streamError ? <ErrorBanner message={state.streamError} onDismiss={dismissStreamError} /> : null}
          {state.recap ? <RecapCard state={state} /> : null}
          {!state.recap && view.ended_at ? (
            <div className="card pad-24 stack-12">
              <p className="body">This session has ended.</p>
              <Link to={`/e/${encodeURIComponent(view.enrollment_id)}`} className="btn btn-primary self-start">
                Back to home
              </Link>
            </div>
          ) : null}
          <div ref={endRef} className="scroll-anchor" />
        </section>

        {state.rail ? (
          <div className="rail-wrap desk-only-block">
            <Rail rail={state.rail} enrollmentId={view.enrollment_id} goalLabel={goalLabel} />
          </div>
        ) : null}
      </main>

      {helpAllowed ? (
        <nav aria-label="Help options" className="help-bar mob-only-grid">
          <button type="button" className="help-bar-btn" disabled={disabled} onClick={() => help('hint')}>
            <Icon name="hint" size={20} />
            Hint
          </button>
          <button type="button" className="help-bar-btn" disabled={disabled} onClick={() => help('example')}>
            <Icon name="example" size={20} />
            Example
          </button>
          <button type="button" className="help-bar-btn" disabled={disabled} onClick={() => help('why')}>
            <Icon name="why" size={20} />
            Why this?
          </button>
          <button
            type="button"
            className="help-bar-btn"
            disabled={disabled}
            aria-expanded={sideOpen}
            onClick={() => {
              setSideOpen((o) => !o);
              requestAnimationFrame(() => document.getElementById('side-q')?.focus());
            }}
          >
            <Icon name="ask" size={20} />
            Ask
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function HelpRow({
  disabled,
  sideOpen,
  setSideOpen,
  sideText,
  setSideText,
  onHelp,
  onSide,
}: {
  disabled: boolean;
  sideOpen: boolean;
  setSideOpen: (fn: (o: boolean) => boolean) => void;
  sideText: string;
  setSideText: (s: string) => void;
  onHelp: (t: HelpType) => void;
  onSide: () => void;
}) {
  return (
    <>
      <div className="help-row desk-only-flex">
        <button type="button" className="help-btn" disabled={disabled} onClick={() => onHelp('hint')}>
          <Icon name="hint" />
          Hint
        </button>
        <button type="button" className="help-btn" disabled={disabled} onClick={() => onHelp('example')}>
          <Icon name="example" />
          Show me an example
        </button>
        <button type="button" className="help-btn" disabled={disabled} onClick={() => onHelp('why')}>
          <Icon name="why" />
          Why are we doing this?
        </button>
        <div className="grow" />
        <button
          type="button"
          className="text-link side-link"
          aria-expanded={sideOpen}
          aria-controls="side-q-form"
          disabled={disabled}
          onClick={() => setSideOpen((o) => !o)}
        >
          Ask a side question
        </button>
      </div>
      {sideOpen ? (
        <form
          id="side-q-form"
          className="side-q"
          onSubmit={(e) => {
            e.preventDefault();
            onSide();
          }}
        >
          <label htmlFor="side-q" className="small strong">
            Your side question
          </label>
          <div className="row gap-8">
            <input
              id="side-q"
              className="input grow"
              value={sideText}
              maxLength={500}
              autoFocus
              placeholder="Ask anything. We'll come back to this problem after."
              onChange={(e) => setSideText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSideOpen(() => false);
              }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={disabled || !sideText.trim()}>
              Ask
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}

function ExampleView({ example }: { example: NonNullable<LocalTurn['example']> }) {
  return (
    <div className="example-card">
      <span className="eyebrow">{example.title}</span>
      <ol className="example-steps">
        {example.steps.map((s, i) => (
          <li key={i} className={s.blank ? 'blank' : undefined}>
            <span className="step-num" aria-hidden="true">
              {i + 1}
            </span>
            {s.blank ? (
              <span className="blank-slot">
                <span className="sr-only">Step {i + 1}: left blank for you</span>
              </span>
            ) : (
              <span className="example-text">{inline(s.text)}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ItemHeader({ item, showHints }: { item: ItemView; showHints: boolean }) {
  return (
    <div className="item-label-row">
      <span className="eyebrow">{item.label}</span>
      {item.is_transfer ? <span className="pill pill-teal pill-xs">New situation</span> : null}
      {showHints ? <span className="pill pill-xs">{hintsLabel(item.hints_used)}</span> : null}
    </div>
  );
}

function TurnView({
  turn,
  index,
  state,
  active,
  disabled,
  onAnswer,
  onUnsure,
  helpRow,
}: {
  turn: LocalTurn;
  index: number;
  state: SessionState;
  active: LocalTurn | null;
  disabled: boolean;
  onAnswer: (a: AnswerPayload) => void;
  onUnsure: () => void;
  helpRow: ReactNode;
}) {
  const turns = state.turns;
  if (turn.role === 'learner') {
    const prev = turns[index - 1];
    const sel = turn.meta?.selected;
    // Shown as a highlighted option inside the previous tutor turn instead.
    if (
      prev &&
      prev.role === 'tutor' &&
      prev.widget?.kind === 'mcq' &&
      prev.id !== active?.id &&
      sel != null &&
      prev.widget.options.includes(sel)
    ) {
      return null;
    }
    const numeric = !sel && looksNumeric(turn.content);
    return (
      <div className="learner-row">
        <div className="learner-col">
          <div className={`learner-bubble${numeric ? ' numeric' : ''}`}>
            <span className="sr-only">You: </span>
            {turn.content}
          </div>
          {turn.meta?.confidence ? <span className="small muted">{confidenceText(turn.meta.confidence)}</span> : null}
        </div>
      </div>
    );
  }

  const isActive = active?.id === turn.id;
  const next = turns[index + 1];
  const answeredSel =
    !isActive && turn.widget?.kind === 'mcq' && next?.role === 'learner' ? (next.meta?.selected ?? null) : null;
  const showOptionsGrid =
    answeredSel != null && turn.widget?.kind === 'mcq' && turn.widget.options.includes(answeredSel);
  const item = isActive ? itemFor(state, turn) : turn.item;
  const promptId = `prompt-${turn.id}`;
  const hasBubble = turn.content.trim() !== '' || turn.example || showOptionsGrid || turn.streaming;
  const flaggable = turn.meta?.flaggable !== false;

  return (
    <div className="tutor-row">
      <TutorAvatar />
      <div className="tutor-col">
        {hasBubble ? (
          <div className="bubble" aria-busy={turn.streaming || undefined}>
            {turn.content ? (
              <Markdown text={turn.content} className="bubble-text" />
            ) : turn.streaming ? (
              <span className="typing inline">
                <span />
                <span />
                <span />
              </span>
            ) : null}
            {turn.example ? <ExampleView example={turn.example} /> : null}
            {showOptionsGrid && turn.widget?.kind === 'mcq' ? (
              <div className="answered-grid" role="list" aria-label="Options">
                {turn.widget.options.map((o, i) => {
                  const mine = o === answeredSel;
                  const correct = next?.meta?.correct;
                  return (
                    <div
                      key={i}
                      role="listitem"
                      className={`answered-opt${mine ? (correct === false ? ' mine wrong' : ' mine') : ''}`}
                    >
                      {mine && correct !== false ? (
                        <Icon name="check" size={16} stroke="var(--accent-text)" width={2.6} />
                      ) : null}
                      <span>
                        {inline(o)}
                        {mine ? ' · your answer' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* A past item reads like a settled item card. */}
        {!isActive && turn.item ? (
          <div className="bubble item-past stack-8">
            <ItemHeader item={turn.item} showHints={false} />
            <Markdown text={turn.item.text} className="item-past-text" />
            {flaggable ? <FlagLink instanceId={turn.item.instance_id} /> : null}
          </div>
        ) : null}

        {isActive && turn.widget && turn.widget.kind !== 'none' ? (
          <div className="item-card stack-16" aria-label={item ? `${item.label}: question` : 'Your turn'} role="group">
            {item ? <ItemHeader item={item} showHints /> : null}
            {item ? <Markdown text={item.text} className="item-text" id={promptId} /> : null}
            <AnswerWidget
              key={turn.id}
              widget={turn.widget}
              disabled={disabled}
              onAnswer={onAnswer}
              onUnsure={onUnsure}
              promptId={item ? promptId : undefined}
              autoFocus={index === turns.length - 1}
            />
            {!state.hintNoteShown && turn.widget.kind !== 'continue' ? (
              <p className="hint-note">
                <span className="desk-only">
                  Answer first. Hints are always there, but they lower how much this answer counts toward mastery.
                </span>
                <span className="mob-only">Answer first. Hints lower how much this one counts.</span>
              </p>
            ) : null}
            {item && flaggable ? <FlagLink instanceId={item.instance_id} /> : null}
          </div>
        ) : null}
        {helpRow}
      </div>
    </div>
  );
}

// ---------- Placement layout ----------

function PlacementLayout({
  state,
  post,
  end,
  ending,
}: {
  state: SessionState;
  post: (a: LearnerAction) => Promise<void>;
  end: () => Promise<void> | void;
  ending: boolean;
}) {
  const view = state.view!;
  const active = activeTurn(state);
  const elapsed = useItemTimer(active?.id ?? null);
  const item = active ? itemFor(state, active) : null;
  const pl = state.placement;
  const asked = pl ? Math.max(1, pl.asked) : null;
  const toGo = pl ? Math.max(0, pl.max - pl.asked) : null;
  const promptId = active ? `prompt-${active.id}` : undefined;
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) window.scrollTo({ top: 0 });
  }, [active?.id]);

  async function skip() {
    await end();
    navigate(`/e/${encodeURIComponent(view.enrollment_id)}`);
  }

  return (
    <div className="screen">
      <SimpleHeader brandTo={`/e/${encodeURIComponent(view.enrollment_id)}`}>
        {!state.recap ? (
          <button type="button" className="text-link header-link" onClick={skip} disabled={ending}>
            Skip and start from the beginning
          </button>
        ) : null}
      </SimpleHeader>
      <main id="main" className="page page-placement stack-28">
        <div className="stack-14">
          <div className="row-wrap gap-12 baseline">
            <h1 className="h1 h1-md">Finding your starting point</h1>
            {pl && !state.recap ? (
              <span className="mono-meta">
                Question {asked}
                {toGo ? ` · about ${toGo} to go` : ''}
              </span>
            ) : null}
          </div>
          {pl ? (
            <div
              role="progressbar"
              aria-label="Placement progress"
              aria-valuemin={0}
              aria-valuemax={pl.max}
              aria-valuenow={state.recap ? pl.max : pl.asked}
              className="progress-track"
            >
              <div
                className="progress-fill"
                style={{ width: `${state.recap ? 100 : Math.min(100, (pl.asked / Math.max(1, pl.max)) * 100)}%` }}
              />
            </div>
          ) : null}
          <p className="body-15 text-2">
            This isn't graded. Each answer just tells us which topics you can skip, so there's no teaching and no score
            here.
          </p>
        </div>

        {state.recap ? (
          <RecapCard state={state} />
        ) : active && active.widget && active.widget.kind !== 'none' ? (
          <div ref={cardRef} className="card placement-card stack-22" role="group" aria-labelledby={promptId}>
            <div className="stack-12" id={promptId}>
              {active.content.trim() && (!item || active.content.trim() !== item.text.trim()) ? (
                <Markdown text={active.content} className="placement-text" />
              ) : null}
              {item ? <Markdown text={item.text} className="placement-text" /> : null}
            </div>
            <AnswerWidget
              key={active.id}
              widget={active.widget}
              disabled={state.waiting}
              placement
              submitLabel="Next question"
              promptId={promptId}
              onAnswer={(a) => void post({ type: 'answer', turn_id: active.id, ...a, ms_on_item: elapsed() })}
              onUnsure={() => void post({ type: 'unsure', turn_id: active.id })}
              autoFocus
            />
            {active.widget.kind !== 'mcq' &&
            active.widget.kind !== 'continue' &&
            !(active.widget.kind === 'free_text' && active.widget.allow_unsure) ? (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={state.waiting}
                  onClick={() => void post({ type: 'unsure', turn_id: active.id })}
                >
                  I'm not sure
                </button>
              </div>
            ) : null}
            {item && active.meta?.flaggable !== false ? <FlagLink instanceId={item.instance_id} /> : null}
          </div>
        ) : (
          <div className="card placement-card">
            <Loading label={state.assessing ?? 'Choosing the next question…'} />
          </div>
        )}
        {state.streamError ? <ErrorBanner message={state.streamError} /> : null}

        {!state.recap ? (
          <p className="small muted lh-15">"I'm not sure" is a fine answer. It's more useful to us than a guess.</p>
        ) : null}
      </main>
    </div>
  );
}
