import { test } from 'node:test';
import type { Capability } from '../shared/content.ts';
import assert from 'node:assert/strict';
import { bktUpdate, evidenceWeight } from '../server/engine/bkt.ts';
import { gradeNumeric, readings, revealForms, leaks } from '../server/engine/grading.ts';
import { replay, type Ev } from '../server/engine/mastery.ts';
import { onWrong, onCorrect, decided, rankProbes } from '../server/engine/diagnosis.ts';
import { review, newCard, capToDeadline } from '../server/engine/scheduler.ts';
import { evalArithmetic, isFetchableUrl } from '../server/compiler/extract.ts';
import { validatePack } from '../server/content/validate.ts';
import { LIBRARY, libraryCourse } from '../server/content/course.ts';
import { nextMove, type SessionState, type PolicyCtx, type KcView } from '../server/engine/policy.ts';
import { DB } from '../server/db.ts';
import { addEvidence, refreshKc } from '../server/pipeline/learner.ts';
import { Rating } from 'ts-fsrs';
import { fixture } from './fixture.ts';

LIBRARY[fixture.id] = fixture;
const DAY = 86_400_000;

const ev = (o: Partial<Ev> & { at: number }): Ev => ({
  capability: 'apply',
  correct: true,
  uncertain: false,
  weight: 1,
  grader_confidence: 1,
  tier: 'code_checked',
  is_transfer: false,
  is_review: false,
  instance_id: 'i' + Math.random(),
  rung: 0,
  widget: 'numeric',
  confidence: null,
  ms: null,
  created_at: new Date(o.at).toISOString(),
  ...o,
});
const gate = {
  goalCaps: ['explain', 'discriminate', 'apply'] as Capability[],
  transferRequired: true,
  maxHypothesis: 0,
  targetDate: null,
};

test('fixture templates pass property tests (coverage rules apply to real packs only)', () =>
  assert.deepEqual(
    validatePack(fixture, 200).filter((e) => !e.includes('needs')),
    [],
  ));

test('BKT: hinted success moves little, bottom-out not at all', () => {
  const p = 0.2;
  const indep = bktUpdate(p, true, evidenceWeight(0, 1, 'code_checked'), 'numeric');
  const hinted = bktUpdate(p, true, evidenceWeight(3, 1, 'code_checked'), 'numeric');
  const bottom = bktUpdate(p, true, evidenceWeight(6, 1, 'code_checked'), 'numeric');
  assert.ok(indep > 0.8 && hinted < indep && hinted > p);
  assert.equal(bottom, p);
  assert.equal(evidenceWeight(0, 1, 'unverified'), 0.4);
});

test('grading accepts percent, probability and fraction forms; spots wrongSolve', () => {
  assert.deepEqual(readings('8.3', '%'), [8.3]);
  assert.ok(gradeNumeric('1/12', 8.33, { abs: 0.5 }, '%').correct);
  assert.ok(gradeNumeric('0.083', 8.33, { abs: 0.5 }, '%').correct);
  assert.ok(gradeNumeric('≈ 8.3%', 8.33, { abs: 0.5 }, '%').correct);
  const g = gradeNumeric('90', 8.33, { abs: 0.5 }, '%', { 'conditional-inversion': 90 });
  assert.equal(g.misconception, 'conditional-inversion');
  assert.equal(gradeNumeric('9.2', 8.33, { abs: 0.5 }, '%').near, true);
  assert.equal(gradeNumeric('abc', 8.33, { abs: 0.5 }, '%').parsed, false);
});

test('answer-leak check finds normalized numbers', () => {
  const forms = revealForms(8.333, '%');
  assert.ok(leaks('That works out to about 8.3% overall.', forms));
  assert.equal(leaks('Imagine 1,000 transactions and 10 frauds.', forms), null);
});

test('mastery gate: with support -> independent -> new context -> retained', () => {
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  let evs: Ev[] = [ev({ at: t0, rung: 3, weight: 0.5 })];
  assert.equal(replay(evs, gate).state, 'with_support');
  evs = [...evs, ev({ at: t0 + 1000 }), ev({ at: t0 + 2000 })];
  assert.equal(replay(evs, gate).state, 'with_support', 'needs explain and discriminate too');
  evs = [
    ...evs,
    ev({ at: t0 + 3000, capability: 'explain', widget: 'free_text', grader_confidence: 0.9, weight: 0.72 }),
    ev({ at: t0 + 4000, capability: 'discriminate', widget: 'mcq' }),
  ];
  const d = replay(evs, gate);
  assert.equal(d.state, 'independent');
  assert.ok(d.card, 'FSRS card created on reaching independent');
  evs = [...evs, ev({ at: t0 + 5000, is_transfer: true })];
  assert.equal(replay(evs, gate).state, 'new_context');
  evs = [...evs, ev({ at: t0 + 1 * DAY, is_review: true })];
  assert.equal(replay(evs, gate).state, 'new_context', 'review must be >= 3 days after independent');
  evs = [...evs, ev({ at: t0 + 4 * DAY, is_review: true })];
  assert.equal(replay(evs, gate).state, 'retained');
});

test('unverified review cannot confirm Retained; failed review demotes and caps P', () => {
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  const base = [
    ev({ at: t0 }),
    ev({ at: t0 + 1 }),
    ev({ at: t0 + 2, capability: 'explain', widget: 'free_text' }),
    ev({ at: t0 + 3, capability: 'discriminate', widget: 'mcq' }),
    ev({ at: t0 + 4, is_transfer: true }),
  ];
  assert.equal(
    replay([...base, ev({ at: t0 + 5 * DAY, is_review: true, tier: 'unverified', weight: 0.4 })], gate).state,
    'new_context',
  );
  const d = replay([...base, ev({ at: t0 + 5 * DAY, is_review: true, correct: false })], gate);
  assert.equal(d.state, 'with_support');
  assert.ok(d.p_known <= 0.6);
});

test('a live misconception above 0.5 blocks the gate', () => {
  const t0 = Date.now();
  const evs = [
    ev({ at: t0 }),
    ev({ at: t0 + 1 }),
    ev({ at: t0 + 2, capability: 'explain', widget: 'free_text' }),
    ev({ at: t0 + 3, capability: 'discriminate', widget: 'mcq' }),
  ];
  assert.equal(replay(evs, { ...gate, maxHypothesis: 0.8 }).state, 'with_support');
});

test('guessers and hint-farmers never reach independent', () => {
  const t0 = Date.now();
  const farmer = Array.from({ length: 20 }, (_, i) => ev({ at: t0 + i, rung: 3, weight: 0.5 }));
  assert.notEqual(replay(farmer, gate).state, 'independent');
  const guesser = Array.from({ length: 20 }, (_, i) =>
    ev({ at: t0 + i, widget: 'mcq', capability: 'discriminate', correct: i % 4 === 0 }),
  );
  assert.notEqual(replay(guesser, gate).state, 'independent');
});

test('diagnosis: distractor seeds 0.8 and a discriminating correct answer lowers it', () => {
  let h = onWrong({}, { distractorMisconception: 'conditional-inversion' });
  assert.equal(decided(h), 'conditional-inversion');
  h = onCorrect(h, ['conditional-inversion'], true);
  assert.ok((h['conditional-inversion'] ?? 0) < 0.3);
  const probes = rankProbes({ a: 0.5, b: 0.5 }, [
    { id: 'x', discriminates: ['a', 'b'] },
    { id: 'y', discriminates: ['a'] },
  ]);
  assert.equal(probes[0].id, 'x');
});

test('deadline mode lands the last review inside the 48 h before the target', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const target = new Date('2026-11-07T09:00:00Z');
  let card = review(newCard(now), now, Rating.Good, target);
  for (let i = 0; i < 6; i++) card = review(card, card.due, Rating.Good, target);
  assert.ok(card.due.getTime() <= target.getTime(), 'never past the target date');
  const capped = capToDeadline({ ...card, due: new Date('2026-12-01T00:00:00Z') }, now, target);
  const hoursBefore = (target.getTime() - capped.due.getTime()) / 3600_000;
  assert.ok(hoursBefore >= 12 && hoursBefore <= 48, `review ${hoursBefore}h before target`);
});

test('rebuild invariant: replaying evidence reproduces kc_state and fsrs_card', () => {
  const db = new DB(':memory:');
  db.insert('app_user', { id: 'u1', email: 'a@b.c', name: 'A' });
  const g = { goalCaps: ['explain', 'discriminate', 'apply'] as any, transferRequired: true, targetDate: null };
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  const rows = [
    { capability: 'apply', correct: true, weight: 1, rung: 0 },
    { capability: 'apply', correct: true, weight: 1, rung: 0 },
    { capability: 'explain', correct: true, weight: 0.8, rung: 0 },
    { capability: 'discriminate', correct: true, weight: 1, rung: 0 },
    { capability: 'apply', correct: true, weight: 1, rung: 0, is_review: true },
  ];
  rows.forEach((r, i) =>
    addEvidence(db, 'u1', {
      kc_key: 'fx/bayes',
      grader: 'code',
      tier: 'code_checked',
      instance_id: 'i' + i,
      widget: 'numeric',
      created_at: new Date(t0 + i * 4 * DAY).toISOString(),
      ...(r as any),
    }),
  );
  refreshKc(db, 'u1', 'fx/bayes', g);
  const a = db.get('select p_known, state, capabilities from kc_state'),
    ca = db.get('select card, due_at from fsrs_card');
  db.run('delete from kc_state');
  db.run('delete from fsrs_card');
  refreshKc(db, 'u1', 'fx/bayes', g);
  assert.deepEqual(db.get('select p_known, state, capabilities from kc_state'), a);
  assert.deepEqual(db.get('select card, due_at from fsrs_card'), ca);
});

function ctxFor(
  s: Partial<SessionState>,
  kcs: Record<string, Partial<KcView>> = {},
  hyps: Record<string, Record<string, number>> = {},
): PolicyCtx {
  const course = libraryCourse('fx', 'solve');
  const state: SessionState = {
    kind: 'learn',
    kc: null,
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
    start_states: {},
    why: null,
    done: false,
    ...s,
  };
  const m = new Map<string, KcView>();
  for (const [k, v] of Object.entries(kcs))
    m.set(k, {
      state: 'not_started',
      p_known: 0.2,
      placed: false,
      caps: {},
      apply_instances: 0,
      transfer_passed: false,
      ...v,
    });
  return {
    course,
    kcs: m,
    hyps: new Map(Object.entries(hyps)),
    s: state,
    outcome: null,
    minutesLeft: 20,
    pick: (a) => a[0],
  };
}

test('policy: prerequisite first, then worked -> faded for a procedural KC', () => {
  const c = ctxFor({ kc: 'fx/bayes' });
  const m = nextMove(c);
  assert.equal(m.kc, 'fx/cond', 'starts with the unmastered prerequisite');
  const c2 = ctxFor({ kc: 'fx/bayes', prereq_checked: ['fx/bayes>fx/cond'] }, { 'fx/cond': { state: 'independent' } });
  assert.equal(nextMove(c2).type, 'worked_example');
  assert.equal(nextMove(c2).type, 'completion');
});

test('policy: a decided misconception is refuted, then the distinction is tested', () => {
  const c = ctxFor(
    {
      kc: 'fx/bayes',
      pending: {
        turn_id: 't',
        kind: 'item',
        kc: 'fx/bayes',
        move: 'ask',
        instance_id: 'i',
        template_key: 'fx/bayes-apply',
        capability: 'apply',
        rung: 0,
        hints_given: 0,
        attempts: 0,
        shown_at: '',
      },
    },
    { 'fx/cond': { state: 'independent' }, 'fx/bayes': { state: 'with_support' } },
    { 'fx/bayes': { 'conditional-inversion': 0.8 } },
  );
  c.outcome = {
    kind: 'answer',
    correct: false,
    uncertain: false,
    capability: 'apply',
    misconception: 'conditional-inversion',
    near: false,
    missing: [],
    specific_point: '90% is P(flag|fraud)',
  };
  const m = nextMove(c);
  assert.equal(m.type, 'refute');
  assert.equal(m.item?.template_key, 'fx/bayes-disc');
});

test('policy: a near-miss slip gets isolate_step, not refute', () => {
  const c = ctxFor(
    {
      kc: 'fx/bayes',
      pending: {
        turn_id: 't',
        kind: 'item',
        kc: 'fx/bayes',
        move: 'ask',
        instance_id: 'i',
        template_key: 'fx/bayes-apply',
        capability: 'apply',
        rung: 0,
        hints_given: 0,
        attempts: 0,
        shown_at: '',
      },
    },
    { 'fx/cond': { state: 'independent' }, 'fx/bayes': { state: 'with_support' } },
    { 'fx/bayes': { slip: 0.6, misread: 0.05 } },
  );
  c.outcome = {
    kind: 'answer',
    correct: false,
    uncertain: false,
    capability: 'apply',
    misconception: null,
    near: true,
    missing: [],
    specific_point: '',
  };
  assert.equal(nextMove(c).type, 'isolate_step');
});

test('policy: help ladder escalates pump -> hint -> prompt -> worked step -> bottom-out', () => {
  const types: string[] = [];
  let rung = 0;
  for (let i = 0; i < 5; i++) {
    const c = ctxFor(
      {
        kc: 'fx/bayes',
        probes_on_item: 1,
        pending: {
          turn_id: 't',
          kind: 'item',
          kc: 'fx/bayes',
          move: 'ask',
          instance_id: 'i',
          template_key: 'fx/bayes-apply-2',
          capability: 'apply',
          rung,
          hints_given: 0,
          attempts: 0,
          shown_at: '',
        },
      },
      { 'fx/cond': { state: 'independent' }, 'fx/bayes': { state: 'with_support' } },
    );
    c.outcome = {
      kind: 'answer',
      correct: false,
      uncertain: false,
      capability: 'apply',
      misconception: null,
      near: false,
      missing: [],
      specific_point: '',
    };
    const m = nextMove(c);
    types.push(m.type);
    rung = m.pending_patch?.rung ?? 6;
  }
  assert.deepEqual(types, ['pump', 'hint', 'prompt', 'worked_step', 'bottom_out']);
});

test('safe arithmetic evaluator and URL guard', () => {
  assert.equal(evalArithmetic('0.01*0.9/(0.01*0.9+0.99*0.1)').toFixed(4), '0.0833');
  assert.equal(evalArithmetic('choose(5,2)*0.5^5'), 10 / 32);
  assert.throws(() => evalArithmetic('process.exit()'));
  assert.equal(isFetchableUrl('http://169.254.169.254/latest'), false);
  assert.equal(isFetchableUrl('https://foo.ts.net/'), false);
  assert.equal(isFetchableUrl('https://arxiv.org/abs/2402.03300'), true);
});
