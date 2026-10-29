// Objective intake, inline scoping questions, then live plan compilation.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type {
  CompileStage,
  ObjectiveDetail,
  ObjectiveEvent,
  PlanModule,
  ScopingQuestion,
} from '../../../shared/api.ts';
import { api, errorMessage } from '../api.ts';
import { showError, useEventSource } from '../hooks.ts';
import { Link, navigate } from '../router.tsx';
import { ErrorBanner, Icon, Loading, SessionLength, SimpleHeader } from '../ui.tsx';
import { monthDay, numberWord, plural } from '../format.tsx';

const EXAMPLES: { label: string; fill: string }[] = [
  { label: 'Prep me for this job (attach the posting)', fill: 'Prep me for this job' },
  { label: 'How does Postgres MVCC work?', fill: 'How does Postgres MVCC work?' },
  { label: 'Get solid at Bayesian A/B testing', fill: 'Get solid at Bayesian A/B testing' },
];

const ALLOWED_EXT = ['pdf', 'docx', 'md', 'txt'];
const MAX_FILES = 10;

const STAGES: { key: Exclude<CompileStage, 'done'>; label: string }[] = [
  { key: 'ingest', label: 'Reading what you sent' },
  { key: 'scope', label: 'Pinning down the scope' },
  { key: 'ground', label: 'Finding trustworthy sources' },
  { key: 'graph', label: 'Mapping the topics and what builds on what' },
  { key: 'items', label: 'Writing practice questions' },
  { key: 'verify', label: 'Checking the answers' },
];

const OTHER = '__other__';
const OBJECTIVE_EVENTS = [
  'scoping.question',
  'scoping.done',
  'compile.stage',
  'plan.module',
  'plan.ready',
  'error',
] as const;

interface AnswerDraft {
  choice: string | null; // option text or OTHER
  other: string;
}

function answerValue(a: AnswerDraft | undefined): string | null {
  if (!a || a.choice == null) return null;
  if (a.choice === OTHER) return a.other.trim() || null;
  return a.choice;
}

export function Intake({ objectiveId }: { objectiveId: string | null }) {
  // Compose
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [targetDate, setTargetDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // After sending
  const [detail, setDetail] = useState<ObjectiveDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ScopingQuestion[]>([]);
  const [scopingDone, setScopingDone] = useState(false);
  const [answers, setAnswers] = useState<Record<number, AnswerDraft>>({});
  const [minutes, setMinutes] = useState<10 | 20 | 30>(20);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<{ stage: CompileStage; detail?: string } | null>(null);
  const [modules, setModules] = useState<PlanModule[]>([]);
  const [streamError, setStreamError] = useState<{ message: string; retryable: boolean } | null>(null);
  const autoSubmitted = useRef(false);

  const sent = objectiveId != null;

  function applyDetail(d: ObjectiveDetail) {
    setDetail(d);
    setText((t) => t || d.raw_text);
    if (d.target_date) setTargetDate(d.target_date);
    setQuestions((prev) => mergeQuestions(prev, d.questions));
    setAnswers((prev) => {
      const next = { ...prev };
      for (const q of d.questions) {
        if (q.answer != null && !next[q.seq]) {
          next[q.seq] = q.options.includes(q.answer)
            ? { choice: q.answer, other: '' }
            : { choice: OTHER, other: q.answer };
        }
      }
      return next;
    });
    // The detail has no explicit "scoping finished" flag; once questions exist (or we're past scoping) treat them as complete.
    if (d.status !== 'scoping' || d.questions.length > 0) setScopingDone(true);
    if (d.status === 'compiling') {
      setSubmitted(true);
      if (d.compile) setStage(d.compile);
    }
    if (d.status === 'review' && d.plan_id) navigate(`/plans/${encodeURIComponent(d.plan_id)}`, { replace: true });
    else if (d.status === 'active' && d.enrollment_id)
      navigate(`/e/${encodeURIComponent(d.enrollment_id)}`, { replace: true });
  }

  function loadDetail() {
    if (!objectiveId) return;
    setLoadError(null);
    api.objective(objectiveId).then(applyDetail, (e) => setLoadError(errorMessage(e)));
  }

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectiveId]);

  const streamOpen =
    objectiveId != null && (detail == null || detail.status === 'scoping' || detail.status === 'compiling');

  useEventSource<ObjectiveEvent>(
    streamOpen ? `/api/objectives/${encodeURIComponent(objectiveId!)}/stream` : null,
    OBJECTIVE_EVENTS,
    (ev) => {
      switch (ev.event) {
        case 'scoping.question':
          setQuestions((prev) =>
            mergeQuestions(prev, [{ seq: ev.seq, question: ev.question, options: ev.options, answer: null }]),
          );
          break;
        case 'scoping.done':
          setScopingDone(true);
          break;
        case 'compile.stage':
          setSubmitted(true);
          setStage({ stage: ev.stage, detail: ev.detail });
          break;
        case 'plan.module':
          setModules((prev) => {
            const i = prev.findIndex((m) => m.id === ev.module.id);
            if (i === -1) return [...prev, ev.module];
            const next = [...prev];
            next[i] = ev.module;
            return next;
          });
          break;
        case 'plan.ready':
          navigate(`/plans/${encodeURIComponent(ev.plan_id)}`);
          break;
        case 'error':
          setStreamError({ message: ev.message, retryable: ev.retryable });
          break;
      }
    },
    loadDetail,
  );

  // ---------- compose handlers ----------
  function addFiles(list: FileList | null) {
    if (!list) return;
    setFormError(null);
    const incoming = Array.from(list);
    const bad = incoming.filter((f) => !ALLOWED_EXT.includes(f.name.split('.').pop()?.toLowerCase() ?? ''));
    const ok = incoming.filter((f) => !bad.includes(f));
    const merged = [...files];
    for (const f of ok) if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
    if (merged.length > MAX_FILES) {
      setFormError(`You can attach up to ${MAX_FILES} files.`);
      merged.length = MAX_FILES;
    } else if (bad.length) {
      setFormError(`${bad.map((f) => f.name).join(', ')}: only PDF, Word (.docx), Markdown and text files work here.`);
    }
    setFiles(merged);
    if (fileInput.current) fileInput.current.value = '';
  }

  function addLink() {
    const raw = linkDraft.trim();
    if (!raw) return;
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      new URL(url);
    } catch {
      setFormError("That link doesn't look right. Paste the full address, like https://example.com/post.");
      return;
    }
    setFormError(null);
    if (!links.includes(url)) setLinks([...links, url]);
    setLinkDraft('');
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (sent || sending) return;
    if (!text.trim() && files.length === 0) {
      setFormError('Write a sentence about what you want to learn, or attach a file.');
      textRef.current?.focus();
      return;
    }
    setFormError(null);
    setSending(true);
    const fd = new FormData();
    fd.append('text', text.trim());
    for (const f of files) fd.append('files', f, f.name);
    if (links.length) fd.append('links', links.join('\n'));
    if (targetDate) fd.append('target_date', targetDate);
    try {
      const { id } = await api.createObjective(fd);
      navigate(`/objectives/${encodeURIComponent(id)}`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function onTextKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
  }

  // ---------- scoping ----------
  const unanswered = questions.filter((q) => answerValue(answers[q.seq]) == null).length;
  const canBuild = sent && scopingDone && unanswered === 0 && !submitted && !submitting;

  async function build() {
    if (!objectiveId || !canBuild) return;
    setSubmitting(true);
    try {
      await api.answerScoping(objectiveId, {
        answers: questions.map((q) => ({ seq: q.seq, answer: answerValue(answers[q.seq])! })),
        session_minutes: minutes,
      });
      setSubmitted(true);
      setStage((s) => s ?? { stage: 'ingest' });
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  // No questions needed: start building straight away.
  useEffect(() => {
    if (scopingDone && questions.length === 0 && detail?.status === 'scoping' && !submitted && !autoSubmitted.current) {
      autoSubmitted.current = true;
      void build();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopingDone, questions.length, detail?.status, submitted]);

  // ---------- status line ----------
  let status: string | null = null;
  if (sent) {
    if (submitted) status = 'Sent · building your plan';
    else if (questions.length > 0)
      status = `Sent · ${numberWord(questions.length).toLowerCase()} quick ${questions.length === 1 ? 'question' : 'questions'} below`;
    else status = 'Sent · reading it now';
  }

  const failed = detail?.status === 'failed';
  const sentFiles = detail?.files ?? [];

  return (
    <div className="screen">
      <SimpleHeader>
        <Link to="/objectives" className="header-link">
          Your objectives
        </Link>
      </SimpleHeader>
      <main id="main" className="page page-intake stack-28">
        <div className="stack-10">
          <h1 className="h1 h1-xl">What do you want to learn?</h1>
          <p className="lede">
            A sentence is enough. Or attach the material that explains why, like a job posting, a syllabus, or your
            notes.
          </p>
        </div>

        <form className="intake-box" onSubmit={send}>
          <label htmlFor="objective" className="sr-only">
            Your learning objective
          </label>
          <textarea
            id="objective"
            ref={textRef}
            rows={3}
            className="intake-text"
            value={text}
            readOnly={sent}
            placeholder="e.g. Teach me how to perform RL on a model"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextKey}
          />
          {(files.length > 0 || links.length > 0 || targetDate || sentFiles.length > 0) && (
            <ul className="attach-list" aria-label="Attached">
              {(sent
                ? sentFiles.map((f) => ({ name: f.name, key: f.name }))
                : files.map((f) => ({ name: f.name, key: `${f.name}-${f.size}` }))
              ).map((f) => (
                <li key={f.key} className="attach-chip">
                  <Icon name="clip" size={14} />
                  <span className="truncate">{f.name}</span>
                  {!sent ? (
                    <button
                      type="button"
                      className="chip-x"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles(files.filter((x) => `${x.name}-${x.size}` !== f.key))}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  ) : null}
                </li>
              ))}
              {!sent &&
                links.map((l) => (
                  <li key={l} className="attach-chip">
                    <Icon name="link" size={14} />
                    <span className="truncate">{l.replace(/^https?:\/\//, '')}</span>
                    <button
                      type="button"
                      className="chip-x"
                      aria-label={`Remove link ${l}`}
                      onClick={() => setLinks(links.filter((x) => x !== l))}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              {targetDate ? (
                <li className="attach-chip">
                  <Icon name="calendar" size={14} />
                  <span>Target {monthDay(targetDate)}</span>
                  {!sent ? (
                    <button
                      type="button"
                      className="chip-x"
                      aria-label="Remove target date"
                      onClick={() => setTargetDate('')}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  ) : null}
                </li>
              ) : null}
            </ul>
          )}
          {!sent && linkOpen ? (
            <div className="intake-inline">
              <label htmlFor="link-input" className="small strong">
                Link
              </label>
              <input
                id="link-input"
                type="url"
                inputMode="url"
                className="input"
                placeholder="https://"
                value={linkDraft}
                autoFocus
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addLink();
                  }
                }}
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={addLink}>
                Add
              </button>
            </div>
          ) : null}
          {!sent && dateOpen ? (
            <div className="intake-inline">
              <label htmlFor="date-input" className="small strong">
                Target date <span className="muted">(optional)</span>
              </label>
              <input
                id="date-input"
                type="date"
                className="input input-date"
                value={targetDate}
                min={todayIso()}
                onChange={(e) => setTargetDate(e.target.value)}
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDateOpen(false)}>
                Done
              </button>
            </div>
          ) : null}
          <div className="intake-toolbar">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => addFiles(e.target.files)}
            />
            <button type="button" className="tool-btn" disabled={sent} onClick={() => fileInput.current?.click()}>
              <Icon name="clip" />
              Attach files
            </button>
            <button
              type="button"
              className="tool-btn"
              disabled={sent}
              aria-expanded={linkOpen}
              onClick={() => setLinkOpen((o) => !o)}
            >
              <Icon name="link" />
              Add a link
            </button>
            <button
              type="button"
              className="tool-btn"
              disabled={sent}
              aria-expanded={dateOpen}
              onClick={() => setDateOpen((o) => !o)}
            >
              <Icon name="calendar" />
              Target date
            </button>
            <div className="grow" />
            {status ? (
              <span className="sent-status" role="status">
                {status}
              </span>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={sending}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            )}
          </div>
        </form>
        {formError ? <ErrorBanner message={formError} onDismiss={() => setFormError(null)} /> : null}

        {!sent ? (
          <>
            <div className="try-row">
              <span className="small muted">Or try:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  className="try-chip"
                  onClick={() => {
                    setText(ex.fill);
                    textRef.current?.focus();
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
            <Link to="/library/intro-probability" className="library-card">
              <span className="eyebrow">Or start with a ready-made course</span>
              <span className="library-title">Intro probability</span>
              <span className="small muted">
                Checked problems, a 5-minute placement, and reviews timed to when you'd forget.
              </span>
            </Link>
          </>
        ) : null}

        {sent && loadError ? <ErrorBanner message={loadError} onRetry={loadDetail} /> : null}
        {failed ? (
          <div className="stack-12">
            <ErrorBanner
              message={
                detail?.error ?? "We couldn't build a plan from this. Try rewording it, or attach different material."
              }
            />
            <Link to="/new" className="btn btn-secondary self-start">
              Start over
            </Link>
          </div>
        ) : null}
        {streamError ? (
          <ErrorBanner
            message={streamError.message}
            onRetry={streamError.retryable ? () => (setStreamError(null), loadDetail()) : undefined}
            onDismiss={() => setStreamError(null)}
          />
        ) : null}

        {sent && !submitted && !failed && detail ? (
          !scopingDone && questions.length === 0 ? (
            <section className="card pad-28">
              <Loading label="Reading your request. A few quick questions may follow." />
            </section>
          ) : (
            <ScopingCard
              questions={questions}
              answers={answers}
              setAnswer={(seq, a) => setAnswers((prev) => ({ ...prev, [seq]: a }))}
              minutes={minutes}
              setMinutes={setMinutes}
              unanswered={unanswered}
              waitingForMore={!scopingDone}
              canBuild={canBuild}
              building={submitting}
              onBuild={build}
              rawText={detail.raw_text}
            />
          )
        ) : null}

        {sent && submitted && !failed ? <CompileProgress stage={stage} modules={modules} /> : null}
        {sent && !detail && !loadError ? <Loading /> : null}
      </main>
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mergeQuestions(prev: ScopingQuestion[], incoming: ScopingQuestion[]): ScopingQuestion[] {
  const map = new Map(prev.map((q) => [q.seq, q]));
  for (const q of incoming)
    map.set(q.seq, { ...map.get(q.seq), ...q, answer: q.answer ?? map.get(q.seq)?.answer ?? null });
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

function ScopingCard(props: {
  questions: ScopingQuestion[];
  answers: Record<number, AnswerDraft>;
  setAnswer: (seq: number, a: AnswerDraft) => void;
  minutes: 10 | 20 | 30;
  setMinutes: (m: 10 | 20 | 30) => void;
  unanswered: number;
  waitingForMore: boolean;
  canBuild: boolean;
  building: boolean;
  onBuild: () => void;
  rawText: string;
}) {
  const { questions, answers, setAnswer, unanswered } = props;
  const n = questions.length;
  const short = props.rawText.length > 40 ? null : props.rawText;
  return (
    <section aria-labelledby="scoping" className="card pad-28 stack-26">
      <div className="stack-6">
        <h2 id="scoping" className="h2">
          {n === 0 ? 'One last thing' : `${numberWord(n)} quick ${n === 1 ? 'question' : 'questions'} so the plan fits`}
        </h2>
        <p className="small muted">
          {n === 0
            ? 'Pick how long a session should be.'
            : short
              ? `"${short}" can mean a few different things. Pick what's closest, or type your own.`
              : "Pick what's closest, or type your own."}
        </p>
      </div>

      {questions.map((q, qi) => {
        const a = answers[q.seq] ?? { choice: null, other: '' };
        const name = `q${q.seq}`;
        return (
          <fieldset key={q.seq} className="plain-fieldset">
            <legend className="field-legend">
              {qi + 1}. {q.question}
            </legend>
            <div className="chip-group">
              {q.options.map((opt) => (
                <ChipRadio
                  key={opt}
                  name={name}
                  checked={a.choice === opt}
                  onChange={() => setAnswer(q.seq, { choice: opt, other: a.other })}
                >
                  {opt}
                </ChipRadio>
              ))}
              <ChipRadio
                name={name}
                dashed
                checked={a.choice === OTHER}
                onChange={() => setAnswer(q.seq, { choice: OTHER, other: a.other })}
              >
                Other…
              </ChipRadio>
            </div>
            {a.choice === OTHER ? (
              <div className="other-row">
                <label htmlFor={`${name}-other`} className="sr-only">
                  Your own answer to question {qi + 1}
                </label>
                <input
                  id={`${name}-other`}
                  className="input"
                  placeholder="Type your answer"
                  value={a.other}
                  autoFocus
                  maxLength={300}
                  onChange={(e) => setAnswer(q.seq, { choice: OTHER, other: e.target.value })}
                />
              </div>
            ) : null}
          </fieldset>
        );
      })}

      <SessionLength value={props.minutes} onChange={props.setMinutes} legend="How long should a session be?" />

      <div className="card-footer">
        <span className="small muted" aria-live="polite">
          {props.waitingForMore
            ? 'More questions on the way.'
            : unanswered > 0
              ? `${unanswered} left. You'll see the plan before anything starts.`
              : "You'll see the plan before anything starts."}
        </span>
        <div className="grow" />
        <button type="button" className="btn btn-primary" disabled={!props.canBuild} onClick={props.onBuild}>
          {props.building ? 'Starting…' : 'Build my plan'}
        </button>
      </div>
    </section>
  );
}

export function ChipRadio({
  name,
  checked,
  onChange,
  dashed,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  dashed?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`chip-radio${checked ? ' checked' : ''}${dashed && !checked ? ' dashed' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="visually-hidden-input" />
      {checked ? <Icon name="check" size={14} stroke="#5EEAD4" width={3} /> : null}
      {children}
    </label>
  );
}

function CompileProgress({
  stage,
  modules,
}: {
  stage: { stage: CompileStage; detail?: string } | null;
  modules: PlanModule[];
}) {
  const current = stage?.stage ?? 'ingest';
  const idx = current === 'done' ? STAGES.length : STAGES.findIndex((s) => s.key === current);
  return (
    <section aria-labelledby="compile" className="card pad-28 stack-20">
      <div className="stack-6">
        <h2 id="compile" className="h2">
          Building your plan
        </h2>
        <p className="small muted">
          This usually takes a minute or two. You can leave this page and come back; it keeps going.
        </p>
      </div>
      <ol className="stage-list" aria-live="polite">
        {STAGES.map((s, i) => {
          const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
          return (
            <li key={s.key} className={`stage stage-${state}`}>
              <span className="stage-dot" aria-hidden="true">
                {state === 'done' ? (
                  <Icon name="check" size={14} stroke="#FFFFFF" width={3} />
                ) : state === 'active' ? (
                  <span className="spinner spinner-sm" />
                ) : null}
              </span>
              <span className="stage-text">
                <span className={state === 'todo' ? 'muted' : undefined}>{s.label}</span>
                <span className="sr-only">
                  {state === 'done' ? ', done' : state === 'active' ? ', in progress' : ''}
                </span>
                {state === 'active' && stage?.detail ? (
                  <span className="small muted stage-detail">{stage.detail}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {modules.length > 0 ? (
        <div className="stack-10">
          <h3 className="h3">Topics so far</h3>
          <ul className="module-stream">
            {modules.map((m, i) => (
              <li key={m.id}>
                <span className="mono muted">{String(i + 1).padStart(2, '0')}</span>
                <span className="grow strong">{m.title}</span>
                <span className="small muted">{plural(m.kcs.length, 'topic')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
