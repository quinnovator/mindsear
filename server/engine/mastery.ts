// Mastery state transitions as a pure replay over a KC's evidence, so kc_state and
// fsrs_card can always be rebuilt from the append-only evidence table.
import type { Capability, Tier, WidgetKind } from '../../shared/content.ts';
import type { MasteryState, CapStatus } from '../../shared/api.ts';
import { MASTERY_ORDER, CAPABILITY_LABEL } from '../../shared/api.ts';
import { BKT, bktUpdate } from './bkt.ts';
import { newCard, review, ratingFor, capToDeadline } from './scheduler.ts';
import { Rating, type Card } from 'ts-fsrs';

export type EvidenceKind = Capability | 'exposure' | 'placement' | 'placement_implied' | 'placement_fail';

export interface Ev {
  capability: EvidenceKind;
  correct: boolean | null;
  uncertain: boolean;
  weight: number;
  grader_confidence: number;
  tier: Tier | null;
  is_transfer: boolean;
  is_review: boolean;
  instance_id: string | null;
  rung: number;
  widget: WidgetKind | null;
  confidence: number | null;
  ms: number | null;
  created_at: string;
}

export interface GateOptions {
  goalCaps: Capability[];
  transferRequired: boolean;
  maxHypothesis: number; // current highest misconception weight on this KC
  targetDate: Date | null;
  requiredIndependentApplies?: number; // default 2
}

export interface KcDerived {
  p_known: number;
  state: MasteryState;
  placed: boolean;
  caps: Partial<Record<Capability, boolean>>;
  apply_instances: number;
  transfer_passed: boolean;
  review_passed: boolean;
  reached_independent_at: string | null;
  demoted_at: string | null;
  card: Card | null;
  best_tier: Tier | null;
}

const RETAIN_DELAY_MS = 3 * 86_400_000;
const rank = (s: MasteryState) => MASTERY_ORDER.indexOf(s);
const TIER_RANK: Record<Tier, number> = { unverified: 0, cross_checked: 1, code_checked: 2 };

export function replay(evs: Ev[], o: GateOptions): KcDerived {
  const need = o.requiredIndependentApplies ?? 2;
  const d: KcDerived = {
    p_known: BKT.p_init,
    state: 'not_started',
    placed: false,
    caps: {},
    apply_instances: 0,
    transfer_passed: false,
    review_passed: false,
    reached_independent_at: null,
    demoted_at: null,
    card: null,
    best_tier: null,
  };
  let applySet = new Set<string>();
  let independentSet = new Set<string>();
  const promote = (to: MasteryState) => {
    if (rank(to) > rank(d.state)) d.state = to;
  };

  for (const ev of evs) {
    const at = new Date(ev.created_at);
    if (ev.capability === 'exposure') {
      promote('introduced');
      continue;
    }
    if (ev.capability === 'placement_implied') {
      d.placed = true;
      d.p_known = Math.max(d.p_known, BKT.p_init_placed_introduced);
      promote('introduced');
      continue;
    }
    if (ev.capability === 'placement_fail') continue;
    if (ev.capability === 'placement') {
      d.placed = true;
      d.p_known = Math.max(d.p_known, 0.95);
      d.caps.apply = true;
      d.caps.discriminate = true;
      if (rank(d.state) < rank('independent')) {
        d.state = 'independent';
        d.reached_independent_at = ev.created_at;
        d.card = d.card ?? review(newCard(at), at, Rating.Good, o.targetDate);
      }
      continue;
    }
    if (ev.correct === null || ev.uncertain) continue;
    const cap = ev.capability as Capability;
    const wasIndependent = rank(d.state) >= rank('independent');
    d.p_known = bktUpdate(d.p_known, ev.correct, ev.weight, ev.widget ?? 'free_text');
    promote('introduced');
    if (ev.correct && ev.weight >= 0.3) promote('with_support');
    const unassisted = ev.rung <= 1;

    if (ev.correct && unassisted) {
      if (cap !== 'explain' || ev.grader_confidence >= 0.8) d.caps[cap] = true;
      if (ev.instance_id) independentSet.add(ev.instance_id);
      if (cap === 'apply' && ev.instance_id) applySet.add(ev.instance_id);
      if (ev.is_transfer && wasIndependent) d.transfer_passed = true;
      if (
        ev.is_review &&
        ev.tier &&
        ev.tier !== 'unverified' &&
        d.reached_independent_at &&
        at.getTime() - new Date(d.reached_independent_at).getTime() >= RETAIN_DELAY_MS
      )
        d.review_passed = true;
      if (ev.tier && (d.best_tier === null || TIER_RANK[ev.tier] > TIER_RANK[d.best_tier])) d.best_tier = ev.tier;
    }

    // Reviews update the card whatever the outcome.
    if (ev.is_review && d.card) {
      d.card = review(
        d.card,
        at,
        ratingFor({ correct: ev.correct, rung: ev.rung, confidence: ev.confidence, ms: ev.ms }),
        o.targetDate,
      );
    }

    // Demotion: failed review or failed transfer -> Can use with support, P capped at 0.6.
    if (!ev.correct && ev.weight > 0 && wasIndependent && (ev.is_review || ev.is_transfer)) {
      d.state = 'with_support';
      d.p_known = Math.min(d.p_known, 0.6);
      d.placed = false;
      d.reached_independent_at = null;
      d.transfer_passed = false;
      d.review_passed = false;
      d.demoted_at = ev.created_at;
      applySet = new Set();
      independentSet = new Set();
      d.caps = {};
      continue;
    }

    // Promotion to Demonstrated independently: the multi-check gate.
    if (!wasIndependent) {
      const distinct = o.goalCaps.includes('apply') ? applySet.size : independentSet.size;
      const allCaps = o.goalCaps.every((c) => d.caps[c]);
      if (d.p_known >= 0.95 && distinct >= need && allCaps && o.maxHypothesis <= 0.5) {
        d.state = 'independent';
        d.reached_independent_at = ev.created_at;
        if (!d.card) d.card = review(newCard(at), at, Rating.Good, o.targetDate);
        else d.card = capToDeadline(d.card, at, o.targetDate);
      }
    }
    if (rank(d.state) >= rank('independent')) {
      if (o.transferRequired && d.transfer_passed) promote('new_context');
      if (d.review_passed && (!o.transferRequired || d.transfer_passed)) promote('retained');
    }
  }
  d.apply_instances = applySet.size;
  return d;
}

export interface CapView {
  key: Capability | 'transfer';
  label: string;
  status: CapStatus;
  progress?: string;
}

export function capabilityView(
  d: KcDerived,
  o: Pick<GateOptions, 'goalCaps' | 'transferRequired' | 'requiredIndependentApplies'>,
): CapView[] {
  const need = o.requiredIndependentApplies ?? 2;
  const order: Capability[] = ['explain', 'apply', 'predict', 'discriminate', 'recall'];
  const out: CapView[] = [];
  const independent = rank(d.state) >= rank('independent');
  for (const c of order) {
    if (!o.goalCaps.includes(c)) continue;
    if (c === 'apply') {
      const done = independent || d.apply_instances >= need;
      out.push({
        key: c,
        label: CAPABILITY_LABEL[c],
        status: done ? 'passed' : d.apply_instances > 0 ? 'in_progress' : 'pending',
        progress: done ? undefined : `${d.apply_instances} of ${need}`,
      });
    } else {
      out.push({
        key: c,
        label: c === 'discriminate' ? CAPABILITY_LABEL.discriminate : CAPABILITY_LABEL[c],
        status: d.caps[c] || (independent && d.placed) ? 'passed' : 'pending',
      });
    }
  }
  if (o.transferRequired) {
    out.push({
      key: 'transfer',
      label: CAPABILITY_LABEL.transfer,
      status: d.transfer_passed ? 'passed' : independent ? 'pending' : 'after_mastery',
    });
  }
  return out;
}

// State score used by readiness.
export const STATE_SCORE: Record<MasteryState, number> = {
  not_started: 0,
  introduced: 0.15,
  with_support: 0.4,
  independent: 0.7,
  new_context: 0.85,
  retained: 1.0,
};
