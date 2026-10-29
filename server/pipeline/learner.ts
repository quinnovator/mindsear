// Learner model store: append evidence, then re-derive kc_state / fsrs_card by replay.
import type { DB } from '../db.ts';
import { uuid, j, nowIso } from '../db.ts';
import type { Capability, Tier, WidgetKind } from '../../shared/content.ts';
import type { MasteryState } from '../../shared/api.ts';
import { replay, capabilityView, type Ev, type KcDerived, type EvidenceKind, type CapView } from '../engine/mastery.ts';
import { maxMisconceptionWeight, type Hyp } from '../engine/diagnosis.ts';
import { parseCard, serializeCard, retrievability } from '../engine/scheduler.ts';
import type { Course } from '../content/course.ts';
import type { KcView } from '../engine/policy.ts';
import type { Card } from 'ts-fsrs';

export interface EvidenceInput {
  attempt_id?: string | null;
  kc_key: string;
  capability: EvidenceKind;
  correct: boolean | null;
  uncertain?: boolean;
  weight: number;
  grader: 'code' | 'llm' | 'placement' | 'system';
  tier?: Tier | null;
  is_transfer?: boolean;
  is_review?: boolean;
  instance_id?: string | null;
  rung?: number;
  grader_confidence?: number;
  widget?: WidgetKind | null;
  rubric_scores?: unknown;
  hypotheses?: unknown;
  confidence?: number | null;
  ms?: number | null;
  created_at?: string;
}

export function addEvidence(db: DB, userId: string, e: EvidenceInput): void {
  db.insert('evidence', {
    id: uuid(),
    attempt_id: e.attempt_id ?? null,
    user_id: userId,
    kc_key: e.kc_key,
    capability: e.capability,
    correct: e.correct === null ? null : e.correct ? 1 : 0,
    uncertain: e.uncertain ? 1 : 0,
    weight: e.weight,
    grader: e.grader,
    tier: e.tier ?? null,
    is_transfer: e.is_transfer ? 1 : 0,
    is_review: e.is_review ? 1 : 0,
    instance_id: e.instance_id ?? null,
    rung: e.rung ?? 0,
    grader_confidence: e.grader_confidence ?? 1,
    widget: e.widget ?? null,
    rubric_scores: e.rubric_scores ?? null,
    hypotheses: e.hypotheses ?? null,
    confidence: e.confidence ?? null,
    ms: e.ms ?? null,
    created_at: e.created_at ?? nowIso(),
  });
}

export function loadEvidence(db: DB, userId: string, kcKey: string): Ev[] {
  return db
    .all('select * from evidence where user_id = ? and kc_key = ? order by created_at, rowid', userId, kcKey)
    .map((r) => ({
      capability: r.capability,
      correct: r.correct === null ? null : !!r.correct,
      uncertain: !!r.uncertain,
      weight: r.weight,
      grader_confidence: r.grader_confidence ?? 1,
      tier: r.tier,
      is_transfer: !!r.is_transfer,
      is_review: !!r.is_review,
      instance_id: r.instance_id,
      rung: r.rung ?? 0,
      widget: r.widget,
      confidence: r.confidence,
      ms: r.ms,
      created_at: r.created_at,
    }));
}

export function getHyp(db: DB, userId: string, kcKey: string): Hyp {
  const out: Hyp = {};
  for (const r of db.all(
    'select hypothesis_id, weight from hypothesis where user_id = ? and kc_key = ?',
    userId,
    kcKey,
  ))
    out[r.hypothesis_id] = r.weight;
  return out;
}
export function setHyp(db: DB, userId: string, kcKey: string, h: Hyp): void {
  db.run('delete from hypothesis where user_id = ? and kc_key = ?', userId, kcKey);
  for (const [k, w] of Object.entries(h))
    db.insert('hypothesis', { user_id: userId, kc_key: kcKey, hypothesis_id: k, weight: w, updated_at: nowIso() });
}

export interface GoalCtx {
  goalCaps: Capability[];
  transferRequired: boolean;
  targetDate: Date | null;
  requiredApplies?: number;
}

export function goalCtx(db: DB, course: Course, enrollmentId: string): GoalCtx {
  const e = db.get(
    'select o.target_date from enrollment e join objective o on o.id = e.objective_id where e.id = ?',
    enrollmentId,
  );
  return {
    goalCaps: course.goalCaps,
    transferRequired: course.transferRequired,
    targetDate: e?.target_date ? new Date(e.target_date + 'T09:00:00Z') : null,
  };
}

// Recompute and store derived state for one KC from its evidence.
export function refreshKc(db: DB, userId: string, kcKey: string, g: GoalCtx): KcDerived {
  const evs = loadEvidence(db, userId, kcKey);
  const d = replay(evs, {
    goalCaps: g.goalCaps,
    transferRequired: g.transferRequired,
    maxHypothesis: maxMisconceptionWeight(getHyp(db, userId, kcKey)),
    targetDate: g.targetDate,
    requiredIndependentApplies: g.requiredApplies,
  });
  db.upsert(
    'kc_state',
    {
      user_id: userId,
      kc_key: kcKey,
      p_known: d.p_known,
      state: d.state,
      placed: d.placed ? 1 : 0,
      capabilities: JSON.stringify(capabilityView(d, { goalCaps: g.goalCaps, transferRequired: g.transferRequired })),
      detail: JSON.stringify({ ...d, card: undefined }),
      updated_at: nowIso(),
    },
    ['user_id', 'kc_key'],
  );
  if (d.card)
    db.upsert(
      'fsrs_card',
      { user_id: userId, kc_key: kcKey, card: serializeCard(d.card), due_at: d.card.due.toISOString() },
      ['user_id', 'kc_key'],
    );
  else db.run('delete from fsrs_card where user_id = ? and kc_key = ?', userId, kcKey);
  return d;
}

export interface KcStateRow extends KcView {
  key: string;
  capsView: CapView[];
  card: Card | null;
  detail: Partial<KcDerived>;
}

export function loadStates(db: DB, userId: string, course: Course, g: GoalCtx): Map<string, KcStateRow> {
  const out = new Map<string, KcStateRow>();
  const rows = new Map(db.all('select * from kc_state where user_id = ?', userId).map((r) => [r.kc_key, r]));
  const cards = new Map(db.all('select * from fsrs_card where user_id = ?', userId).map((r) => [r.kc_key, r]));
  for (const k of course.kcs) {
    const r = rows.get(k.key);
    const detail = j<Partial<KcDerived>>(r?.detail, {});
    // Capability views depend on the goal of this enrollment, so recompute them from detail.
    const d: KcDerived = {
      p_known: r?.p_known ?? 0.2,
      state: (r?.state ?? 'not_started') as MasteryState,
      placed: !!r?.placed,
      caps: detail.caps ?? {},
      apply_instances: detail.apply_instances ?? 0,
      transfer_passed: !!detail.transfer_passed,
      review_passed: !!detail.review_passed,
      reached_independent_at: detail.reached_independent_at ?? null,
      demoted_at: detail.demoted_at ?? null,
      card: null,
      best_tier: detail.best_tier ?? null,
    };
    out.set(k.key, {
      key: k.key,
      state: d.state,
      p_known: d.p_known,
      placed: d.placed,
      caps: d.caps,
      apply_instances: d.apply_instances,
      transfer_passed: d.transfer_passed,
      capsView: capabilityView(d, g),
      card: cards.get(k.key) ? parseCard(cards.get(k.key)!.card) : null,
      detail: d,
    });
  }
  return out;
}

export function dueKcs(states: Map<string, KcStateRow>, at: Date): string[] {
  return [...states.values()]
    .filter((s) => s.card && s.card.due.getTime() <= at.getTime())
    .sort((a, b) => retrievability(a.card!, at) - retrievability(b.card!, at))
    .map((s) => s.key);
}

// Rebuild everything for a user from evidence (model upgrades are a recompute, not a migration).
export function rebuildAll(db: DB, userId: string, g: GoalCtx): number {
  const keys = db.all('select distinct kc_key from evidence where user_id = ?', userId).map((r) => r.kc_key as string);
  db.tx(() => {
    for (const k of keys) {
      // Hypotheses: each graded evidence row stores the weights after its update; the latest wins.
      const last = db.get(
        'select hypotheses from evidence where user_id = ? and kc_key = ? and hypotheses is not null order by created_at desc, rowid desc limit 1',
        userId,
        k,
      );
      if (last) setHyp(db, userId, k, j<Hyp>(last.hypotheses, {}));
      refreshKc(db, userId, k, g);
    }
  });
  return keys.length;
}
