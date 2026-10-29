// The turn pipeline: persist → assess → update learner model → choose move → materialize item
// → compose tutor message → stream. Actions on one session are processed strictly in order.
import type { DB, Row } from '../db.ts';
import { uuid, j, nowIso } from '../db.ts';
import type {
  LearnerAction,
  Turn,
  SessionRail,
  Recap,
  SessionKind,
  MasteryState,
  SessionView,
  Widget,
  ExampleCard,
} from '../../shared/api.ts';
import { MASTERY_LABEL, MASTERY_SHORT, MASTERY_ORDER } from '../../shared/api.ts';
import { courseForEnrollment, type Course } from '../content/course.ts';
import {
  nextMove,
  nextKc,
  placementStart,
  resolvePlacement,
  type SessionState,
  type Outcome,
  type Move,
  type Pending,
  type KcView,
} from '../engine/policy.ts';
import { evidenceWeight } from '../engine/bkt.ts';
import { gradeNumeric, formatNumber, parseNumber } from '../engine/grading.ts';
import { withinTolerance } from '../content/validate.ts';
import { onWrong, onCorrect, onProbe, ranked, type Hyp } from '../engine/diagnosis.ts';
import { retrievability } from '../engine/scheduler.ts';
import { publish } from '../stream.ts';
import {
  addEvidence,
  refreshKc,
  loadStates,
  getHyp,
  setHyp,
  goalCtx,
  dueKcs,
  type KcStateRow,
  type GoalCtx,
} from './learner.ts';
import {
  buildInstance,
  saveInstance,
  loadInstance,
  itemView,
  exampleCard,
  mustNotReveal,
  findTemplate,
  prefetch,
  takePrepared,
  type Instance,
} from './items.ts';
import { composeTutor, assess, sideAnswer, planProbe, type MoveSpec } from './roles.ts';
import { makeRng, randomSeed } from '../content/rng.ts';

const DAY = 86_400_000;
const chan = (id: string) => `session:${id}`;
const rankOf = (s: MasteryState) => MASTERY_ORDER.indexOf(s);

// ---------- per-session serialization ----------
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    id,
    next.catch(() => {}),
  );
  return next;
}

interface Ctx {
  db: DB;
  user: Row;
  session: Row;
  s: SessionState;
  course: Course;
  g: GoalCtx;
}

function loadCtx(db: DB, sessionId: string): Ctx {
  const session = db.get('select * from session where id = ?', sessionId);
  if (!session) throw new Error('session not found');
  const e = db.get('select * from enrollment where id = ?', session.enrollment_id)!;
  const user = db.get('select * from app_user where id = ?', e.user_id)!;
  const course = courseForEnrollment(db, e.id);
  return {
    db,
    user,
    session,
    s: j<SessionState>(session.state, {} as SessionState),
    course,
    g: goalCtx(db, course, e.id),
  };
}

function saveState(c: Ctx) {
  c.db.run('update session set state = ?, kc_key = ? where id = ?', JSON.stringify(c.s), c.s.kc, c.session.id);
}

function minutesLeft(c: Ctx): number {
  return c.session.minutes - (Date.now() - new Date(c.session.started_at).getTime()) / 60_000;
}

function hypsFor(db: DB, userId: string): Map<string, Hyp> {
  const m = new Map<string, Hyp>();
  for (const r of db.all('select kc_key, hypothesis_id, weight from hypothesis where user_id = ?', userId)) {
    if (!m.has(r.kc_key)) m.set(r.kc_key, {});
    m.get(r.kc_key)![r.hypothesis_id] = r.weight;
  }
  return m;
}

// ---------- session creation ----------

function reviewQueue(course: Course, states: Map<string, KcStateRow>): string[] {
  let due = dueKcs(states, new Date());
  if (!due.length) {
    // Nothing due yet: practice the carded KCs that have decayed most.
    const now = new Date();
    due = [...states.values()]
      .filter((s) => s.card)
      .sort((a, b) => retrievability(a.card!, now) - retrievability(b.card!, now))
      .slice(0, 3)
      .map((s) => s.key);
  }
  const q: string[] = [];
  for (const k of due.slice(0, 10)) {
    q.push(k);
    // Interleave each due KC with a confusable neighbour the learner has met.
    const conf = course.byKey
      .get(k)
      ?.confusable.find(
        (c) =>
          rankOf(states.get(c)?.state ?? 'not_started') >= rankOf('introduced') && !q.includes(c) && !due.includes(c),
      );
    if (conf) q.push('interleave:' + conf);
  }
  return q;
}

export async function createSession(
  db: DB,
  enrollmentId: string,
  kind: SessionKind,
  kcKey: string | null,
): Promise<string> {
  const e = db.get('select * from enrollment where id = ?', enrollmentId);
  if (!e) throw new Error('enrollment not found');
  const course = courseForEnrollment(db, enrollmentId);
  const g = goalCtx(db, course, enrollmentId);
  const states = loadStates(db, e.user_id, course, g);
  const s: SessionState = {
    kind,
    kc: kcKey && course.byKey.has(kcKey) ? kcKey : null,
    pending: null,
    fade_step: {},
    pf_step: {},
    last_moves: [],
    explain_streak: 0,
    move_failures: {},
    seen: [],
    items_done: 0,
    queue: [],
    placement: null,
    refuted: [],
    probes_on_item: 0,
    prereq_checked: [],
    taught: [],
    start_states: Object.fromEntries([...states].map(([k, v]) => [k, v.state])),
    why: null,
    done: false,
  };
  if (kind === 'review') s.queue = reviewQueue(course, states);
  if (kind === 'placement') {
    const plan = e.plan_id ? db.get('select kc_flags from plan where id = ?', e.plan_id) : null;
    const flags = j<Record<string, { known?: boolean }>>(plan?.kc_flags, {});
    s.placement = placementStart(
      course,
      Object.keys(flags).filter((k) => flags[k].known && course.byKey.has(k)),
    );
  }
  if (kind === 'mock_interview') {
    const reqs = db.all('select kc_keys from requirement where objective_id = ? order by seq', e.objective_id);
    const keys = [...new Set(reqs.flatMap((r) => j<string[]>(r.kc_keys, [])))].filter((k) => course.byKey.has(k));
    const pool = keys.length ? keys : course.kcs.map((k) => k.key);
    s.queue = pool.sort((a, b) => (states.get(a)?.p_known ?? 0) - (states.get(b)?.p_known ?? 0)).slice(0, 8);
  }
  const id = uuid();
  const minutes =
    kind === 'placement' ? 10 : kind === 'review' ? 10 : kind === 'mock_interview' ? 15 : e.session_minutes;
  db.insert('session', {
    id,
    enrollment_id: enrollmentId,
    kind,
    kc_key: s.kc,
    state: s,
    minutes,
    started_at: nowIso(),
  });
  const c = loadCtx(db, id);
  await withLock(id, () => runTurn(c, null));
  return id;
}

// ---------- actions ----------

export function handleAction(db: DB, sessionId: string, action: LearnerAction, actionId: string): Promise<void> {
  return withLock(sessionId, async () => {
    const c = loadCtx(db, sessionId);
    if (c.session.ended_at) {
      publish(db, chan(sessionId), {
        event: 'error',
        code: 'session_ended',
        message: 'This session has ended.',
        retryable: false,
      });
      return;
    }
    // Idempotent on action id (and on turn id for answers): a double-tap or reconnect is a no-op.
    const seenActions: string[] = (c.s as any).actions ?? [];
    if (seenActions.includes(actionId) || db.get('select 1 from attempt where action_id = ?', actionId)) {
      publish(db, chan(sessionId), { event: 'ack', action_id: actionId });
      return;
    }
    (c.s as any).actions = [...seenActions.slice(-50), actionId];
    publish(db, chan(sessionId), { event: 'ack', action_id: actionId });
    const p = c.s.pending;
    if (!p || ('turn_id' in action && action.turn_id !== p.turn_id)) {
      publish(db, chan(sessionId), {
        event: 'error',
        code: 'stale_turn',
        message: 'That question was already answered.',
        retryable: false,
      });
      saveState(c);
      return;
    }
    try {
      switch (action.type) {
        case 'answer':
          return await onAnswer(c, action, actionId);
        case 'unsure':
          return await onAnswer(
            c,
            { type: 'answer', turn_id: action.turn_id, response: { kind: 'text', text: "I'm not sure" } },
            actionId,
            true,
          );
        case 'hint':
          return await onHelp(c, 'hint');
        case 'example':
          return await onHelp(c, 'example');
        case 'why': {
          c.s.why = c.s.why ?? 'Each step is chosen from your answers so far, to get you to doing this on your own.';
          saveState(c);
          publish(db, chan(sessionId), { event: 'rail', rail: buildRail(c) });
          return;
        }
        case 'side_question':
          return await onSide(c, action.text);
      }
    } catch (e) {
      console.error('action failed', e);
      publish(db, chan(sessionId), {
        event: 'error',
        code: 'internal',
        message: 'Something went wrong on our side. Try again.',
        retryable: true,
      });
    }
  });
}

function learnerTurn(c: Ctx, content: string, meta: Turn['meta']): Turn {
  const seq = nextSeq(c);
  const id = uuid();
  c.db.insert('turn', { id, session_id: c.session.id, seq, role: 'learner', content, meta });
  const t: Turn = {
    id,
    seq,
    role: 'learner',
    move: null,
    content,
    item: null,
    widget: null,
    example: null,
    meta,
    created_at: nowIso(),
  };
  publish(c.db, chan(c.session.id), { event: 'learner.turn', turn: t });
  return t;
}

function nextSeq(c: Ctx): number {
  return Number(c.db.get('select coalesce(max(seq), 0) + 1 as n from turn where session_id = ?', c.session.id)!.n);
}

interface Graded {
  correct: boolean | null;
  uncertain: boolean;
  misconception: string | null;
  near: boolean;
  missing: string[];
  specific_point: string;
  grader: 'code' | 'llm';
  confidence: number;
  rubric?: unknown;
  assessorHyps?: { id: string; weight: number }[];
  matches?: string[];
  display: string;
  selected?: string;
}

async function grade(
  c: Ctx,
  inst: Instance,
  action: Extract<LearnerAction, { type: 'answer' }>,
  unsure: boolean,
  turnId: string,
): Promise<Graded> {
  const r = action.response;
  const course = c.course;
  const misDesc = (id: string | null) => (id ? course.misconceptions.get(id)?.description.replace(/\.$/, '') : null);
  if (unsure)
    return {
      correct: false,
      uncertain: false,
      misconception: null,
      near: false,
      missing: [],
      specific_point: "That's fine; not knowing yet is useful information.",
      grader: 'code',
      confidence: 1,
      display: "I'm not sure",
    };
  if (r.kind === 'numeric' && inst.answer.numeric !== undefined) {
    const gr = gradeNumeric(r.value, inst.answer.numeric, inst.answer.tolerance, inst.answer.unit, inst.wrong);
    const shown = gr.value !== null ? formatNumber(gr.value, inst.answer.unit) : r.value;
    if (!gr.parsed)
      return {
        correct: null,
        uncertain: true,
        misconception: null,
        near: false,
        missing: [],
        specific_point: `I couldn't read "${r.value}" as a number.`,
        grader: 'code',
        confidence: 0,
        display: r.value,
      };
    const point = gr.correct
      ? `${shown} is right.`
      : gr.misconception
        ? `${shown} is what you get from a common mix-up: ${misDesc(gr.misconception)?.toLowerCase()}.`
        : gr.matches.length > 1
          ? `${shown} is what you get from a common mix-up about which way the conditional goes or how rare the case is.`
          : gr.near
            ? `${shown} is close, but outside rounding, so something in the arithmetic is off.`
            : `${shown} isn't it.`;
    return {
      correct: gr.correct,
      uncertain: false,
      misconception: gr.misconception,
      matches: gr.matches,
      near: gr.near,
      missing: [],
      specific_point: point,
      grader: 'code',
      confidence: 1,
      display: shown,
    };
  }
  if (r.kind === 'mcq' && inst.answer.mcq !== undefined) {
    const opt = inst.answer.options?.[r.index];
    const correct = r.index === inst.answer.mcq;
    const mis = opt?.misconception ?? null;
    const point = correct
      ? `"${opt?.text}" is right.`
      : mis
        ? `"${opt?.text}" fits a common mix-up: ${misDesc(mis)?.toLowerCase()}.`
        : `"${opt?.text}" isn't it.`;
    return {
      correct,
      uncertain: false,
      misconception: correct ? null : mis,
      near: false,
      missing: [],
      specific_point: point,
      grader: 'code',
      confidence: 1,
      display: opt?.text ?? '',
      selected: opt?.text,
    };
  }
  if (r.kind === 'steps' && inst.answer.steps) {
    const blanks = inst.answer.blankIdx ?? [];
    const values =
      r.values.length === (inst.widget.kind === 'steps' ? inst.widget.steps.length : -1)
        ? blanks.map((i) => r.values[i] ?? '')
        : r.values;
    const results = inst.answer.steps.map((target, i) => {
      const v = parseNumber(values[i] ?? '');
      if (!v) return false;
      const val = v.percentSign && inst.answer.unit !== '%' ? v.value / 100 : v.value;
      return withinTolerance(val, target, inst.answer.tolerance ?? { rel: 0.02, abs: 0.01 });
    });
    const wrongAt = results.findIndex((x) => !x);
    const correct = wrongAt < 0;
    return {
      correct,
      uncertain: false,
      misconception: null,
      near: !correct && results.some(Boolean),
      missing: [],
      specific_point: correct
        ? 'Every step checks out.'
        : `The step "${(inst.widget as any).steps?.[blanks[wrongAt]]?.label ?? ''}" is off.`,
      grader: 'code',
      confidence: 1,
      display: values.join(' · '),
    };
  }
  if (r.kind === 'text' && inst.answer.reference) {
    publish(c.db, chan(c.session.id), {
      event: 'assessing',
      label: inst.capability === 'explain' ? 'Reading your explanation…' : 'Reading your answer…',
    });
    const kc = course.byKey.get(inst.kc_key)!;
    try {
      const out = await assess(c.db, turnId, {
        item_text: inst.surface_text,
        kc,
        expectations: inst.answer.expectations ?? [],
        reference: inst.answer.reference,
        misconceptions: [...course.misconceptions.values()]
          .filter((m) => m.kcs.some((k) => inst.kc_key.endsWith('/' + k) || k === inst.kc_key))
          .map((m) => ({ id: m.id, description: m.description })),
        response: r.text,
      });
      const uncertain = out.correct === null || out.grader_confidence < 0.7;
      const met = out.expectations
        .filter((e) => e.met)
        .map((e) => inst.answer.expectations?.find((x) => x.id === e.id)?.text ?? e.id);
      const missing = out.expectations
        .filter((e) => !e.met)
        .map((e) => inst.answer.expectations?.find((x) => x.id === e.id)?.text ?? e.id);
      const topHyp = out.hypotheses.sort((a, b) => b.weight - a.weight)[0];
      const point = out.correct
        ? missing.length
          ? `You got the main idea (${met[0] ?? 'the core point'}), but didn't mention: ${missing[0]}.`
          : `Your explanation covers the key ideas: ${met.slice(0, 2).join('; ')}.`
        : topHyp && topHyp.id !== 'novel' && course.misconceptions.get(topHyp.id)
          ? `Where you wrote "${topHyp.quote}", that reflects a common mix-up: ${misDesc(topHyp.id)?.toLowerCase()}.`
          : missing.length
            ? `The answer is missing a key idea: ${missing[0]}.`
            : `That doesn't quite explain it yet.`;
      return {
        correct: out.correct,
        uncertain,
        misconception: topHyp && topHyp.weight >= 0.5 && topHyp.id !== 'novel' ? topHyp.id : null,
        near: false,
        missing,
        specific_point: point,
        grader: 'llm',
        confidence: out.grader_confidence,
        rubric: out.expectations,
        assessorHyps: out.hypotheses,
        display: r.text,
      };
    } catch (e) {
      console.error('assessor failed', (e as Error).message);
      return {
        correct: null,
        uncertain: true,
        misconception: null,
        near: false,
        missing: [],
        specific_point: "I couldn't grade that one reliably.",
        grader: 'llm',
        confidence: 0,
        display: r.text,
      };
    }
  }
  return {
    correct: null,
    uncertain: true,
    misconception: null,
    near: false,
    missing: [],
    specific_point: "I couldn't read that answer.",
    grader: 'code',
    confidence: 0,
    display: '',
  };
}

async function onAnswer(
  c: Ctx,
  action: Extract<LearnerAction, { type: 'answer' }>,
  actionId: string,
  unsure = false,
): Promise<void> {
  const p = c.s.pending!;
  const db = c.db;
  if (p.kind === 'continue' || action.response.kind === 'continue') {
    addEvidence(db, c.user.id, { kc_key: p.kc, capability: 'exposure', correct: null, weight: 0, grader: 'system' });
    refreshAndPublish(c, [p.kc]);
    return runTurn(c, {
      kind: 'continue',
      correct: null,
      uncertain: false,
      capability: null,
      misconception: null,
      near: false,
      missing: [],
      specific_point: '',
    });
  }
  const inst = loadInstance(db, p.instance_id!)!;
  const t = findTemplate(c.course, inst.template_key);
  const graded = await grade(c, inst, action, unsure, p.turn_id);
  const conf = action.confidence ?? null;
  learnerTurn(c, graded.display, {
    confidence: conf ?? undefined,
    selected: graded.selected,
    correct: c.s.kind === 'placement' ? null : graded.correct,
  });
  const attemptId = uuid();
  db.insert('attempt', {
    id: attemptId,
    turn_id: p.turn_id,
    session_id: c.session.id,
    item_instance_id: inst.id,
    action_id: actionId,
    response: action.response,
    confidence: conf,
    ladder_rung: p.rung,
    ms_on_item: action.ms_on_item ?? Date.now() - new Date(p.shown_at).getTime(),
  });

  // Learner model update (code only).
  const rung = p.blanks ? (p.blanks === 1 ? 4 : 3) : p.rung;
  const weight = graded.uncertain ? 0 : evidenceWeight(rung, graded.confidence, inst.tier);
  const kcKey = inst.kc_key;
  const before = c.course.byKey.has(kcKey) ? loadStates(db, c.user.id, c.course, c.g).get(kcKey) : undefined;
  let h = getHyp(db, c.user.id, kcKey);
  const disc = t.tpl.meta.discriminates ?? [];
  if (!graded.uncertain) {
    if (p.probe_for) h = onProbe(h, graded.misconception, !!graded.correct, disc);
    else if (graded.correct) h = onCorrect(h, disc, rung <= 1);
    else
      h = onWrong(h, {
        distractorMisconception: graded.misconception,
        wrongSolveMatch: graded.misconception,
        ambiguousMatches: graded.matches,
        assessor: graded.assessorHyps,
        near: graded.near,
        previouslyCorrect: !!before && rankOf(before.state) >= rankOf('with_support'),
      });
    setHyp(db, c.user.id, kcKey, h);
  }
  const keys = t.kcKeys.filter((k) => c.course.byKey.has(k));
  for (const k of keys.length ? keys : [kcKey]) {
    addEvidence(db, c.user.id, {
      attempt_id: attemptId,
      kc_key: k,
      capability: inst.capability,
      correct: graded.correct,
      uncertain: graded.uncertain,
      weight,
      grader: graded.grader,
      tier: inst.tier,
      is_transfer: inst.is_transfer,
      is_review: !!p.is_review && k === kcKey,
      instance_id: inst.id,
      rung,
      grader_confidence: graded.confidence,
      widget: t.tpl.meta.widget,
      rubric_scores: graded.rubric ?? null,
      hypotheses: k === kcKey ? h : null,
      confidence: conf,
      ms: action.ms_on_item ?? null,
    });
  }
  refreshAndPublish(c, keys.length ? keys : [kcKey]);

  // Session bookkeeping.
  c.s.items_done++;
  c.s.explain_streak = inst.capability === 'explain' || inst.capability === 'recall' ? c.s.explain_streak + 1 : 0;
  if (graded.correct) c.s.move_failures = {};
  else c.s.move_failures[p.move] = (c.s.move_failures[p.move] ?? 0) + 1;
  if (!p.instance_id || p.attempts === 0) c.s.probes_on_item = p.probe_for ? c.s.probes_on_item : 0;

  if (c.s.kind === 'placement' && c.s.placement) placementStep(c, kcKey, !!graded.correct && !graded.uncertain);

  return runTurn(c, {
    kind: unsure ? 'unsure' : 'answer',
    correct: graded.correct,
    uncertain: graded.uncertain,
    capability: inst.capability,
    misconception: graded.misconception,
    near: graded.near,
    missing: graded.missing,
    specific_point: graded.specific_point,
  });
}

function placementStep(c: Ctx, kc: string, correct: boolean) {
  const ps = c.s.placement!;
  ps.asked++;
  const decide = (pass: boolean) => {
    const res = resolvePlacement(c.course, ps, kc, pass);
    const db = c.db;
    addEvidence(db, c.user.id, {
      kc_key: kc,
      capability: pass ? 'placement' : 'placement_fail',
      correct: pass,
      weight: 0,
      grader: 'placement',
    });
    for (const k of res.implied_known)
      addEvidence(db, c.user.id, {
        kc_key: k,
        capability: 'placement_implied',
        correct: null,
        weight: 0,
        grader: 'placement',
      });
    refreshAndPublish(c, [kc, ...res.implied_known]);
  };
  if (ps.current !== kc) return;
  const hasDisc = c.course.templates.some(
    (t) =>
      t.kcKeys[0] === kc &&
      t.tpl.meta.capability === 'discriminate' &&
      (t.tpl.meta.widget === 'mcq' || t.tpl.meta.widget === 'numeric'),
  );
  if (ps.step === 'apply') {
    if (!correct) decide(false);
    else if (hasDisc) ps.step = 'discriminate';
    else decide(true);
  } else decide(correct);
  publish(c.db, chan(c.session.id), { event: 'placement', asked: ps.asked, max: ps.max });
}

function refreshAndPublish(c: Ctx, keys: string[]) {
  for (const k of new Set(keys)) {
    const d = refreshKc(c.db, c.user.id, k, c.g);
    if (!c.course.byKey.has(k)) continue;
    const st = loadStates(c.db, c.user.id, c.course, c.g).get(k)!;
    publish(c.db, chan(c.session.id), {
      event: 'progress',
      kc_id: k,
      state: d.state,
      capabilities: st.capsView,
      tier: d.best_tier,
    });
  }
}

async function onHelp(c: Ctx, kind: 'hint' | 'example'): Promise<void> {
  const p = c.s.pending!;
  if (p.kind !== 'item' || c.s.kind === 'placement') return;
  const inst = loadInstance(c.db, p.instance_id!)!;
  const t = findTemplate(c.course, inst.template_key);
  if (kind === 'example') {
    const wt = t.tpl.worked
      ? t
      : c.course.templates.find((x) => x.kcKeys[0] === p.kc && x.tpl.worked && x.tpl.meta.capability === 'apply');
    const move: Move = {
      type: 'worked_example',
      kc: p.kc,
      reason: c.s.why ?? '',
      example: wt ? { template_key: wt.key } : undefined,
      item: {
        template_key: inst.template_key,
        capability: inst.capability,
        reuse_instance: inst.id,
        framing: 'normal',
      },
      pending_patch: { rung: Math.max(p.rung, 3) },
    };
    return send(c, move);
  }
  const hints = t.tpl.hints(inst.params);
  const given = p.hints_given;
  const type = given + 1 >= hints.length ? (given >= hints.length ? 'worked_step' : 'prompt') : 'hint';
  const rung = type === 'hint' ? Math.max(p.rung, 3) : type === 'prompt' ? Math.max(p.rung, 4) : Math.max(p.rung, 5);
  return send(c, {
    type,
    kc: p.kc,
    reason: c.s.why ?? '',
    item: { template_key: inst.template_key, capability: inst.capability, reuse_instance: inst.id, framing: 'normal' },
    pending_patch: { rung, hints_given: Math.min(given + 1, hints.length) },
  });
}

async function onSide(c: Ctx, question: string): Promise<void> {
  const p = c.s.pending!;
  learnerTurn(c, question, null);
  const kc = c.course.byKey.get(p.kc)!;
  const inst = p.instance_id ? loadInstance(c.db, p.instance_id) : null;
  const turnId = uuid();
  const text = await sideAnswer(c.db, turnId, kc, question, mustNotReveal(inst));
  return send(
    c,
    {
      type: 'side_answer',
      kc: p.kc,
      reason: c.s.why ?? '',
      item: inst
        ? { template_key: inst.template_key, capability: inst.capability, reuse_instance: inst.id, framing: 'normal' }
        : undefined,
    },
    text,
    turnId,
  );
}

// ---------- producing a tutor turn ----------

async function runTurn(c: Ctx, outcome: Outcome | null): Promise<void> {
  const states = loadStates(c.db, c.user.id, c.course, c.g);
  const kcs = new Map<string, KcView>(states);
  const rng = makeRng(randomSeed());
  let move = nextMove({
    course: c.course,
    kcs,
    hyps: hypsFor(c.db, c.user.id),
    s: c.s,
    outcome,
    minutesLeft: minutesLeft(c),
    pick: rng.pick,
  });
  // Planner (probe choice) only when several probes are equally good.
  if (move.type === 'probe' && move.item) {
    const h = getHyp(c.db, c.user.id, move.kc);
    const cands = c.course.templates.filter(
      (t) =>
        t.kcKeys.includes(move.kc) &&
        t.tpl.meta.widget === 'mcq' &&
        !c.s.seen.includes(t.key) &&
        (t.tpl.meta.discriminates ?? []).some((d) =>
          ranked(h)
            .slice(0, 2)
            .some(([k]) => k === d),
        ),
    );
    if (cands.length > 1) {
      const pick = await planProbe(
        c.db,
        c.s.pending?.turn_id ?? '',
        ranked(h).slice(0, 3),
        cands.slice(0, 6).map((t) => ({
          id: t.key,
          text: t.tpl.text(t.tpl.params(rng)),
          discriminates: t.tpl.meta.discriminates ?? [],
        })),
        '',
      );
      if (pick) move = { ...move, item: { ...move.item, template_key: pick } };
    }
  }
  return send(c, move);
}

async function send(c: Ctx, move: Move, presetText?: string, presetTurnId?: string): Promise<void> {
  const db = c.db;
  const course = c.course;
  const prev = c.s.pending;
  const turnId = presetTurnId ?? uuid();
  const seq = nextSeq(c);
  publish(db, chan(c.session.id), { event: 'tutor.start', turn_id: turnId, seq, move: move.type });

  // Materialize the item.
  let inst: Instance | null = null;
  if (move.item) {
    if (move.item.reuse_instance) inst = loadInstance(db, move.item.reuse_instance);
    if (!inst) {
      const t = findTemplate(course, move.item.template_key);
      inst =
        (!move.item.blanks ? await takePrepared(c.session.id, t.key) : null) ??
        buildInstance(course, t, { blanks: move.item.blanks });
      saveInstance(db, inst);
      c.s.seen.push(t.key);
      const interview = c.s.kind === 'mock_interview' ? `a technical interview for ${course.title}` : null;
      prefetch(db, course, c.session.id, t.key, interview);
    }
  }
  const reuse = !!(move.item?.reuse_instance && prev && prev.instance_id === move.item.reuse_instance);

  // Worked example card.
  let example: ExampleCard | null = null;
  if (move.example) {
    const t = findTemplate(course, move.example.template_key);
    if (move.example.same_instance) {
      const old = loadInstance(db, move.example.same_instance);
      example = old ? exampleCard(course, t, old.params, 'How this one works out') : null;
    } else {
      example = exampleCard(course, t, t.tpl.params(makeRng(randomSeed())));
    }
  }

  // What the Tutor may draw on.
  const kc = course.byKey.get(move.kc);
  const refs: string[] = [];
  let hint: string | undefined;
  const patch = move.pending_patch ?? {};
  if (inst && (move.type === 'hint' || move.type === 'prompt')) {
    const t = findTemplate(course, inst.template_key);
    const hs = t.tpl.hints(inst.params);
    const n = patch.hints_given ?? (prev?.hints_given ?? 0) + 1;
    hint = move.type === 'prompt' ? hs[hs.length - 1] : hs[Math.max(0, Math.min(hs.length - 1, n - 1))];
  }
  if (inst && move.type === 'worked_step') {
    const t = findTemplate(course, inst.template_key);
    const steps = t.tpl.worked?.(inst.params) ?? [];
    const step = steps.length >= 2 ? steps[steps.length - 2] : null;
    if (step) refs.push(`Worked step to show (then hand control back): ${step.text}`);
  }
  if (move.type === 'refute' && move.misconception) {
    const m = course.misconceptions.get(move.misconception);
    if (m) refs.push(`Mix-up: ${m.description}`, `Refutation: ${m.refutation}`);
  }
  if (
    kc &&
    [
      'instruct',
      'relearn',
      'challenge',
      'worked_example',
      'refute',
      'side_answer',
      'feedback',
      'contrast_case',
      'transfer_ask',
    ].includes(move.type)
  )
    refs.push(`Concept summary (${kc.title}): ${kc.summary}`);
  if (move.type === 'instruct' && kc) refs.push(`Key ideas: ${kc.expectations.join('; ')}`);
  let recap: Recap | null = null;
  if (move.end) {
    recap = buildRecap(c);
    refs.push(...recap.summary);
  }
  if (move.switched_from && kc) refs.push(`We're now working on ${kc.title}. ${move.reason}`);

  const forms = mustNotReveal(move.type === 'bottom_out' ? inst : inst);
  const recent = db
    .all('select role, content from turn where session_id = ? order by seq desc limit 6', c.session.id)
    .reverse()
    .map((r) => ({ role: r.role, text: r.content ?? '' }));
  const spec: MoveSpec = {
    type: move.type,
    kc_title: kc?.title ?? course.title,
    feedback: c.s.kind === 'placement' ? undefined : move.feedback,
    content_refs: refs,
    item_present: !!inst,
    item_kind: inst ? inst.widget.kind : undefined,
    example_present: !!example,
    hint,
    must_not_reveal: forms,
    learner_name: (c.user.name ?? '').split(' ')[0],
    framing: move.item?.framing,
    recent,
  };

  let text: string;
  if (presetText !== undefined) {
    text = presetText;
    publish(db, chan(c.session.id), { event: 'tutor.delta', turn_id: turnId, text });
  } else if (c.s.kind === 'placement') {
    text = move.end
      ? 'That gives a clear picture of where to start.'
      : c.s.placement && c.s.placement.asked === 0
        ? "Let's find your starting point. This isn't graded, and there's no teaching here yet."
        : 'Next question.';
    publish(db, chan(c.session.id), { event: 'tutor.delta', turn_id: turnId, text });
  } else {
    text = await composeTutor(db, turnId, spec, (d) =>
      publish(db, chan(c.session.id), { event: 'tutor.delta', turn_id: turnId, text: d }),
    );
  }

  // The pending learner action.
  let pending: Pending | null = null;
  let widget: Widget | null = null;
  if (inst) {
    pending = {
      turn_id: turnId,
      kind: 'item',
      kc: inst.kc_key,
      move: move.type,
      instance_id: inst.id,
      template_key: inst.template_key,
      capability: inst.capability,
      rung: patch.rung ?? (reuse ? prev!.rung : 0),
      hints_given: patch.hints_given ?? (reuse ? prev!.hints_given : 0),
      attempts: reuse
        ? prev!.attempts +
          (['pump', 'hint', 'prompt', 'worked_step', 'isolate_step'].includes(move.type) && move.feedback ? 1 : 0)
        : 0,
      probe_for: patch.probe_for,
      return_template: patch.return_template ?? (reuse ? prev!.return_template : undefined),
      return_instance: patch.return_instance,
      is_review: move.type === 'review_ask' || (reuse && !!prev!.is_review),
      is_transfer: inst.is_transfer,
      challenge: move.type === 'challenge' || (reuse && !!prev!.challenge),
      blanks: move.item?.blanks ?? (reuse ? prev!.blanks : undefined),
      shown_at: reuse ? prev!.shown_at : nowIso(),
    };
    widget = inst.widget;
    if (!reuse) c.s.probes_on_item = move.type === 'probe' ? c.s.probes_on_item : 0;
  } else if (!move.end) {
    pending = {
      turn_id: turnId,
      kind: 'continue',
      kc: move.kc,
      move: move.type,
      rung: 0,
      hints_given: 0,
      attempts: 0,
      shown_at: nowIso(),
    };
    widget = { kind: 'continue', label: example ? "I've read it" : 'Continue' };
  }
  c.s.pending = pending;
  c.s.last_moves = [...c.s.last_moves.slice(-9), move.type];
  if (move.reason && !['hint', 'prompt', 'worked_step', 'side_answer', 'pump'].includes(move.type))
    c.s.why = move.reason;
  if (move.kc && course.byKey.has(move.kc)) c.s.kc = move.kc;

  const meta = inst ? { hints_used: pending?.hints_given ?? 0, flaggable: true } : null;
  db.insert('turn', {
    id: turnId,
    session_id: c.session.id,
    seq,
    role: 'tutor',
    move: move.type,
    content: text,
    widget,
    item_instance_id: inst?.id ?? null,
    example,
    meta,
  });
  saveState(c);
  const turn = toTurn(c, db.get('select * from turn where id = ?', turnId)!, turnId);
  publish(db, chan(c.session.id), { event: 'tutor.done', turn });
  publish(db, chan(c.session.id), { event: 'rail', rail: buildRail(c) });
  if (move.end) endSession(c, recap!);
}

// ---------- recap / end ----------

function buildRecap(c: Ctx): Recap {
  const states = loadStates(c.db, c.user.id, c.course, c.g);
  const summary: string[] = [];
  const moved = new Map<MasteryState, string[]>();
  const slipped: string[] = [];
  for (const k of c.course.kcs) {
    const before = c.s.start_states[k.key] ?? 'not_started';
    const after = states.get(k.key)!.state;
    if (rankOf(after) > rankOf(before)) moved.set(after, [...(moved.get(after) ?? []), k.title]);
    else if (rankOf(after) < rankOf(before)) slipped.push(k.title);
  }
  const list = (xs: string[]) =>
    xs.length > 3
      ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more`
      : xs.join(xs.length === 2 ? ' and ' : ', ');
  // Strongest moves first.
  for (const st of [...MASTERY_ORDER].reverse()) {
    const xs = moved.get(st);
    if (xs)
      summary.push(
        `${list(xs)} ${xs.length === 1 ? 'moved' : 'moved'} to ${MASTERY_LABEL[st].toLowerCase()}${c.s.kind === 'placement' ? ' (placed)' : ''}.`,
      );
  }
  if (slipped.length)
    summary.push(
      `${list(slipped)} slipped back a step, so ${slipped.length === 1 ? 'it comes' : 'they come'} back sooner.`,
    );
  if (c.s.kind === 'placement') {
    const skip = Object.values(c.s.placement?.resolved ?? {}).filter(
      (r) => r === 'pass' || r === 'implied_known',
    ).length;
    summary.unshift(
      skip
        ? `You can skip ahead on ${skip} of ${c.course.kcs.length} topics.`
        : `We'll start from the beginning, so nothing gets skipped.`,
    );
  }
  if (!summary.length)
    summary.push(
      c.s.items_done
        ? `You worked through ${c.s.items_done} question${c.s.items_done === 1 ? '' : 's'}; nothing changed state yet, which is normal early on.`
        : 'Nothing was answered this time.',
    );
  const cards = [...states.values()]
    .filter((s) => s.card)
    .sort((a, b) => a.card!.due.getTime() - b.card!.due.getTime());
  const next = cards[0];
  if (next)
    summary.push(
      `${c.course.byKey.get(next.key)!.title} comes back for review on ${next.card!.due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`,
    );
  const nk = nextKc(c.course, new Map(states));
  return {
    summary: summary.slice(0, 4),
    next_review_at: next ? next.card!.due.toISOString() : null,
    next_kc: nk ? { id: nk, title: c.course.byKey.get(nk)!.title } : null,
  };
}

function endSession(c: Ctx, recap: Recap) {
  c.s.done = true;
  c.s.pending = null;
  c.db.run(
    'update session set ended_at = ?, recap = ?, state = ? where id = ?',
    nowIso(),
    JSON.stringify(recap),
    JSON.stringify(c.s),
    c.session.id,
  );
  if (c.s.kind === 'placement')
    c.db.run('update enrollment set placement_done = 1 where id = ?', c.session.enrollment_id);
  publish(c.db, chan(c.session.id), { event: 'session.recap', recap });
}

export function endSessionNow(db: DB, sessionId: string): Promise<Recap> {
  return withLock(sessionId, async () => {
    const c = loadCtx(db, sessionId);
    if (c.session.ended_at) return j<Recap>(c.session.recap, { summary: [], next_review_at: null, next_kc: null });
    const recap = buildRecap(c);
    endSession(c, recap);
    return recap;
  });
}

// ---------- views ----------

export function buildRail(c: Ctx): SessionRail {
  const states = loadStates(c.db, c.user.id, c.course, c.g);
  const kcKey = c.s.kc && c.course.byKey.has(c.s.kc) ? c.s.kc : null;
  const label = (s: MasteryState) => MASTERY_SHORT[s];
  let path: SessionRail['path'] = [];
  if (kcKey) {
    const anc: string[] = [];
    const walk = (k: string) => {
      for (const p of c.course.byKey.get(k)?.prerequisites ?? [])
        if (!anc.includes(p)) {
          anc.push(p);
          walk(p);
        }
    };
    walk(kcKey);
    const sorted = anc
      .map((k) => c.course.byKey.get(k)!)
      .sort((a, b) => a.depth - b.depth)
      .slice(-5);
    path = sorted.map((k) => ({
      id: k.key,
      title: k.title,
      state: states.get(k.key)!.state,
      current: false,
      label: label(states.get(k.key)!.state),
    }));
    const cur = c.course.byKey.get(kcKey)!;
    path.push({ id: kcKey, title: cur.title, state: states.get(kcKey)!.state, current: true, label: 'Now' });
    const nxt = c.course.kcs.find((k) => k.prerequisites.includes(kcKey));
    if (nxt)
      path.push({ id: nxt.key, title: nxt.title, state: states.get(nxt.key)!.state, current: false, label: 'Next up' });
  }
  const cards = [...states.values()]
    .filter((s) => s.card && s.key !== kcKey)
    .sort((a, b) => a.card!.due.getTime() - b.card!.due.getTime());
  const nr = cards[0];
  return {
    kc: kcKey
      ? {
          id: kcKey,
          title: c.course.byKey.get(kcKey)!.title,
          state: states.get(kcKey)!.state,
          capabilities: states.get(kcKey)!.capsView,
        }
      : null,
    path,
    next_review: nr
      ? {
          kc_title: c.course.byKey.get(nr.key)!.title,
          in_days: Math.max(0, Math.ceil((nr.card!.due.getTime() - Date.now()) / DAY)),
        }
      : null,
    why: c.s.why,
  };
}

function toTurn(c: Ctx, r: Row, latestPendingTurn: string | null): Turn {
  const inst = r.item_instance_id ? loadInstance(c.db, r.item_instance_id) : null;
  const meta = j<any>(r.meta, null);
  return {
    id: r.id,
    seq: r.seq,
    role: r.role,
    move: r.move,
    content: r.content ?? '',
    item: inst ? itemView(c.course, inst, meta?.hints_used ?? 0) : null,
    widget: latestPendingTurn === r.id && c.s.pending?.turn_id === r.id ? j<Widget | null>(r.widget, null) : null,
    example: j(r.example, null),
    meta,
    created_at: r.created_at,
  };
}

export function sessionView(db: DB, sessionId: string): SessionView & { stream_cursor: number } {
  const c = loadCtx(db, sessionId);
  const rows = db.all('select * from turn where session_id = ? order by seq', sessionId);
  const pendingTurn = c.s.pending?.turn_id ?? null;
  const cursor = Number(db.get('select max(id) as m from stream_event where channel = ?', chan(sessionId))?.m ?? 0);
  const kc = c.s.kc ? c.course.byKey.get(c.s.kc) : null;
  return {
    id: sessionId,
    enrollment_id: c.session.enrollment_id,
    kind: c.session.kind,
    title: c.course.title,
    kc_title: kc?.title ?? null,
    minutes_total: c.session.minutes,
    started_at: c.session.started_at,
    ended_at: c.session.ended_at,
    placement: c.s.placement ? { asked: c.s.placement.asked, max: c.s.placement.max } : null,
    turns: rows.map((r) => toTurn(c, r, pendingTurn)),
    rail: buildRail(c),
    hint_note_shown:
      db.get(
        "select 1 from turn t join session s on s.id = t.session_id join enrollment e on e.id = s.enrollment_id where e.user_id = ? and t.move in ('hint','prompt') limit 1",
        c.user.id,
      ) !== undefined,
    recap: j<Recap | null>(c.session.recap, null),
    stream_cursor: cursor,
  };
}

export function sessionOwner(db: DB, sessionId: string): string | null {
  return (
    db.get('select e.user_id from session s join enrollment e on e.id = s.enrollment_id where s.id = ?', sessionId)
      ?.user_id ?? null
  );
}
