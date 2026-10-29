// BKT with assistance weighting.
import type { WidgetKind, Tier } from '../../shared/content.ts';

export const BKT = {
  p_init: 0.2,
  p_init_placed_introduced: 0.6,
  p_learn: 0.15,
  p_slip: 0.1,
  p_guess: { mcq: 0.25, numeric: 0.05, free_text: 0.15, steps: 0.05 } as Record<WidgetKind, number>,
};

// Help ladder: evidence weight of the next answer by the highest rung reached.
export const LADDER_WEIGHT = [1.0, 1.0, 0.8, 0.5, 0.3, 0, 0];
export const TIER_MULTIPLIER: Record<Tier, number> = { code_checked: 1.0, cross_checked: 0.8, unverified: 0.4 };

export function evidenceWeight(rung: number, graderConfidence: number, tier: Tier): number {
  const ladder = LADDER_WEIGHT[Math.max(0, Math.min(6, rung))];
  return ladder * graderConfidence * TIER_MULTIPLIER[tier];
}

export function bktUpdate(p: number, correct: boolean, w: number, widget: WidgetKind): number {
  const s = BKT.p_slip,
    g = BKT.p_guess[widget] ?? 0.15;
  const posterior = correct ? (p * (1 - s)) / (p * (1 - s) + (1 - p) * g) : (p * s) / (p * s + (1 - p) * (1 - g));
  const blended = w * posterior + (1 - w) * p;
  return blended + (1 - blended) * BKT.p_learn * w;
}
