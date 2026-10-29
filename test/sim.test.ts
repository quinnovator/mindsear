// Simulated learners playing real sessions against the engine, with the LLM disabled
// (deterministic tutor fallbacks). Personas answer by reading the pending item instance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB, j } from '../server/db.ts';
import { LIBRARY, invalidateCourse } from '../server/content/course.ts';
import { createSession, handleAction, sessionView } from '../server/pipeline/session.ts';
import { loadInstance } from '../server/pipeline/items.ts';
import { fixture } from './fixture.ts';
import type { LearnerAction } from '../shared/api.ts';

delete process.env.OPENROUTER_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
LIBRARY[fixture.id] = fixture;

function setup() {
  const db = new DB(':memory:');
  db.insert('app_user', { id: 'u', email: 'sim@test', name: 'Sim' });
  db.insert('objective', {
    id: 'o',
    user_id: 'u',
    kind: 'library',
    raw_text: 'fx',
    title: 'Fixture',
    spec: { pack_id: 'fx' },
    status: 'active',
  });
  db.insert('enrollment', { id: 'e', user_id: 'u', objective_id: 'o', goal: 'solve', session_minutes: 30 });
  invalidateCourse();
  return db;
}

type Persona = (inst: ReturnType<typeof loadInstance>) => LearnerAction['type'] extends never ? never : any;

async function play(db: DB, sid: string, answer: (inst: any) => any, maxTurns = 30) {
  const moves: string[] = [];
  for (let i = 0; i < maxTurns; i++) {
    const v = sessionView(db, sid);
    const last = [...v.turns].reverse().find((t) => t.role === 'tutor');
    if (!last) break;
    moves.push(last.move ?? '');
    if (v.ended_at || !last.widget) break;
    let response: any;
    if (last.widget.kind === 'continue') response = { kind: 'continue' };
    else response = answer(loadInstance(db, last.item!.instance_id));
    await handleAction(db, sid, { type: 'answer', turn_id: last.id, response }, `a${i}-${Math.random()}`);
  }
  return moves;
}

const right = (inst: any) => {
  if (inst.answer.numeric !== undefined) return { kind: 'numeric', value: String(inst.answer.numeric) };
  if (inst.answer.mcq !== undefined) return { kind: 'mcq', index: inst.answer.mcq };
  if (inst.answer.steps) return { kind: 'steps', values: inst.answer.steps.map(String) };
  return { kind: 'text', text: 'Because the legit group is far larger.' };
};

test('conditional-inversion persona is diagnosed and refuted within 4 items', async () => {
  const db = setup();
  // Prerequisite already solid so the session goes straight to Bayes' rule.
  db.insert('evidence', {
    id: 'x',
    user_id: 'u',
    kc_key: 'fx/cond',
    capability: 'placement',
    correct: 1,
    weight: 0,
    grader: 'placement',
    created_at: new Date().toISOString(),
  });
  const { refreshKc, goalCtx } = await import('../server/pipeline/learner.ts');
  const { courseForEnrollment } = await import('../server/content/course.ts');
  refreshKc(db, 'u', 'fx/cond', goalCtx(db, courseForEnrollment(db, 'e'), 'e'));
  const sid = await createSession(db, 'e', 'learn', 'fx/bayes');
  const invert = (inst: any) => {
    if (inst.answer.numeric !== undefined && inst.wrong['conditional-inversion'] !== undefined)
      return { kind: 'numeric', value: String(inst.wrong['conditional-inversion']) };
    if (inst.answer.options) {
      const i = inst.answer.options.findIndex((o: any) => o.misconception === 'conditional-inversion');
      if (i >= 0) return { kind: 'mcq', index: i };
    }
    return right(inst);
  };
  const moves = await play(db, sid, invert, 12);
  const firstRefute = moves.indexOf('refute');
  assert.ok(firstRefute > 0, `expected a refute, got ${moves.join(' > ')}`);
  const itemsBefore = moves.slice(0, firstRefute).filter((m) => !['worked_example', 'instruct'].includes(m)).length;
  assert.ok(itemsBefore <= 4, `refuted after ${itemsBefore} items: ${moves.join(' > ')}`);
  const h = db.get(
    "select weight from hypothesis where kc_key = 'fx/bayes' and hypothesis_id = 'conditional-inversion'",
  );
  assert.ok(h && h.weight > 0.7);
});

test('expert persona: placement skips the graph', async () => {
  const db = setup();
  const sid = await createSession(db, 'e', 'placement', null);
  await play(db, sid, right, 20);
  const v = sessionView(db, sid);
  assert.ok(v.ended_at, 'placement ends');
  const states = db.all('select kc_key, state, placed from kc_state');
  assert.ok(
    states.some((s) => s.state === 'independent' && s.placed),
    JSON.stringify(states),
  );
  assert.ok((v.placement?.asked ?? 99) <= 12);
  // Placement shows no score: learner turns carry no correctness.
  assert.ok(v.turns.filter((t) => t.role === 'learner').every((t) => t.meta?.correct === null));
});

test('idempotent actions: a double-tap creates one attempt', async () => {
  const db = setup();
  const sid = await createSession(db, 'e', 'learn', 'fx/cond');
  const v = sessionView(db, sid);
  const last = [...v.turns].reverse().find((t) => t.role === 'tutor')!;
  const inst = last.item ? loadInstance(db, last.item.instance_id) : null;
  const response = last.widget?.kind === 'continue' || !inst ? { kind: 'continue' } : right(inst);
  await Promise.all([
    handleAction(db, sid, { type: 'answer', turn_id: last.id, response } as LearnerAction, 'same-id'),
    handleAction(db, sid, { type: 'answer', turn_id: last.id, response } as LearnerAction, 'same-id'),
  ]);
  const n = db.get('select count(*) as n from attempt where action_id = ?', 'same-id')!.n;
  assert.ok(n <= 1);
  assert.equal(
    j<any>(db.get('select state from session where id = ?', sid)!.state, {}).actions.filter(
      (a: string) => a === 'same-id',
    ).length,
    1,
  );
});

test('deleting an objective with sessions, attempts and evidence succeeds', async () => {
  const db = setup();
  const sid = await createSession(db, 'e', 'learn', 'fx/cond');
  const last = [...sessionView(db, sid).turns].reverse().find((t) => t.role === 'tutor')!;
  const inst = last.item ? loadInstance(db, last.item.instance_id) : null;
  await handleAction(
    db,
    sid,
    { type: 'answer', turn_id: last.id, response: inst ? right(inst) : { kind: 'continue' } } as LearnerAction,
    'del-1',
  );
  const { deleteObjective } = await import('../server/privacy.ts');
  deleteObjective(db, 'o');
  assert.equal(db.get('select count(*) as n from session')!.n, 0);
  assert.equal(db.get('select count(*) as n from objective')!.n, 0);
});
