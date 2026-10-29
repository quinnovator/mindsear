// Teaching policy: a pure function nextMove(ctx) -> Move. The LLM never decides whether to
// advance, how much help to give, or whether an answer was independent.
import type { Capability } from '../../shared/content.ts';
import type { MasteryState, SessionKind } from '../../shared/api.ts';
import { MASTERY_ORDER } from '../../shared/api.ts';
import type { Course, CourseTemplate } from '../content/course.ts';
import { type Hyp, decided, rankProbes, topMisconception, ranked, NON_MISCONCEPTIONS } from './diagnosis.ts';

export type MoveType =
  | 'instruct'
  | 'worked_example'
  | 'completion'
  | 'ask'
  | 'probe'
  | 'pump'
  | 'hint'
  | 'prompt'
  | 'worked_step'
  | 'bottom_out'
  | 'refute'
  | 'contrast_case'
  | 'feedback'
  | 'recap'
  | 'side_answer'
  | 'challenge'
  | 'review_ask'
  | 'relearn'
  | 'placement_ask'
  | 'transfer_ask'
  | 'isolate_step'
  | 'why';

export interface KcView {
  state: MasteryState;
  p_known: number;
  placed: boolean;
  caps: Partial<Record<Capability, boolean>>;
  apply_instances: number;
  transfer_passed: boolean;
}

export interface Pending {
  turn_id: string;
  kind: 'item' | 'continue';
  kc: string;
  move: MoveType;
  instance_id?: string;
  template_key?: string;
  capability?: Capability;
  rung: number; // highest help rung reached on this item
  hints_given: number;
  attempts: number; // wrong attempts on this item
  probe_for?: string[]; // this item is a discriminating probe for these hypotheses
  return_template?: string; // after a probe/refute test, re-ask this template...
  return_instance?: string; // ...or this exact instance (isolate_step)
  is_review?: boolean;
  is_transfer?: boolean;
  challenge?: boolean; // problem-first bounded challenge
  blanks?: number; // completion item
  shown_at: string;
}

export interface PlacementState {
  resolved: Record<string, 'pass' | 'fail' | 'implied_known' | 'implied_unknown'>;
  current: string | null;
  step: 'apply' | 'discriminate';
  asked: number;
  max: number;
  priority: string[]; // KCs the learner marked "I know this": probed first
}

export interface SessionState {
  kind: SessionKind;
  kc: string | null;
  pending: Pending | null;
  fade_step: Record<string, number>; // worked -> faded progress per KC (0 worked example, 1..2 completion, 3 independent)
  pf_step: Record<string, number>; // problem-first progress per KC (0 challenge, 1 instruct, 2 worked, 3 independent)
  last_moves: MoveType[];
  explain_streak: number;
  move_failures: Record<string, number>;
  seen: string[]; // template keys used this session
  items_done: number;
  queue: string[]; // review / mock interview KC keys
  placement: PlacementState | null;
  refuted: string[]; // misconceptions refuted this session
  uncertain?: Record<string, number>; // consecutive ungradeable answers per KC+capability
  skip_caps?: Record<string, Capability[]>;
  skip_kcs?: string[]; // capabilities set aside this session (grader couldn't score them)
  probes_on_item: number;
  prereq_checked: string[];
  taught: string[]; // KC keys touched (recap)
  start_states: Record<string, MasteryState>;
  why: string | null;
  done: boolean;
}

export interface Outcome {
  kind: 'answer' | 'continue' | 'unsure';
  correct: boolean | null;
  uncertain: boolean;
  capability: Capability | null;
  misconception: string | null; // diagnosed from distractor / wrongSolve / assessor
  near: boolean;
  missing: string[]; // rubric expectations not met (free text)
  specific_point: string; // what exactly was right / wrong, computed in code
}

export interface ItemRequest {
  template_key: string;
  capability: Capability;
  blanks?: number; // completion item: blank the last k valued steps
  reuse_instance?: string; // re-ask the same instance
  framing:
    | 'normal'
    | 'challenge'
    | 'probe'
    | 'review'
    | 'transfer'
    | 'placement'
    | 'interview'
    | 'completion'
    | 'test_distinction';
}

export interface Move {
  type: MoveType;
  kc: string;
  reason: string; // shown under "Why are we doing this?"
  feedback?: { correct: boolean; specific_point: string };
  item?: ItemRequest;
  example?: { template_key: string; same_instance?: string }; // worked example card (different instance unless bottom-out)
  instruct?: 'summary' | 'refutation' | 'build_on_attempt' | 'remediation';
  misconception?: string;
  switched_from?: string; // teach_prerequisite / next KC
  end?: boolean;
  pending_patch?: Partial<Pending>;
}

export interface PolicyCtx {
  course: Course;
  kcs: Map<string, KcView>;
  hyps: Map<string, Hyp>;
  s: SessionState;
  outcome: Outcome | null;
  minutesLeft: number;
  pick: <T>(arr: readonly T[]) => T;
}

const rank = (s: MasteryState) => MASTERY_ORDER.indexOf(s);
const isIndependent = (v: KcView | undefined) => !!v && rank(v.state) >= rank('independent');
// Placement showed the learner can use a descendant, so a placed prerequisite doesn't block what builds on it.
const satisfiesPrereq = (v: KcView | undefined) => isIndependent(v) || (!!v && v.placed);
const view = (ctx: PolicyCtx, kc: string): KcView =>
  ctx.kcs.get(kc) ?? {
    state: 'not_started',
    p_known: 0.2,
    placed: false,
    caps: {},
    apply_instances: 0,
    transfer_passed: false,
  };
const title = (ctx: PolicyCtx, kc: string) => ctx.course.byKey.get(kc)?.title ?? kc;

export function templatesFor(
  ctx: PolicyCtx,
  kc: string,
  cap?: Capability,
  opts: { transfer?: boolean; discriminating?: string[]; worked?: boolean } = {},
): CourseTemplate[] {
  return ctx.course.templates.filter(
    (t) =>
      t.kcKeys[0] === kc &&
      !t.flagged &&
      (cap === undefined || t.tpl.meta.capability === cap) &&
      (opts.transfer === undefined || !!t.tpl.meta.is_transfer === opts.transfer) &&
      (opts.worked === undefined || !!t.tpl.worked === opts.worked) &&
      (!opts.discriminating || opts.discriminating.some((d) => (t.tpl.meta.discriminates ?? []).includes(d))),
  );
}

function choose(ctx: PolicyCtx, ts: CourseTemplate[]): CourseTemplate | null {
  if (!ts.length) return null;
  const unseen = ts.filter((t) => !ctx.s.seen.includes(t.key));
  // Prefer verified items so mastery evidence counts more. Code- and cross-checked rank the same, so
  // computable items don't crowd out scenario questions.
  const pool = unseen.length ? unseen : ts;
  const tierRank = { code_checked: 1, cross_checked: 1, unverified: 0 } as const;
  const best = Math.max(...pool.map((t) => tierRank[t.tier]));
  return ctx.pick(pool.filter((t) => tierRank[t.tier] === best));
}

// Capabilities still required by the goal, in teaching order.
export function neededCaps(ctx: PolicyCtx, kc: string): Capability[] {
  const v = view(ctx, kc);
  const order: Capability[] = ['apply', 'explain', 'discriminate', 'predict', 'recall'];
  const skip = ctx.s.skip_caps?.[kc] ?? [];
  const caps = order.filter((c) => ctx.course.goalCaps.includes(c) && !v.caps[c] && !skip.includes(c));
  const need = ctx.course.goalCaps.includes('apply') ? 2 : 0;
  if (v.apply_instances < need && !caps.includes('apply')) caps.unshift('apply');
  return caps.filter((c) => templatesFor(ctx, kc, c, { transfer: false }).length > 0);
}

// Next KC to learn: first in plan order that isn't independent and whose prerequisites are.
export function nextKc(course: Course, kcs: Map<string, KcView>, skip: string[] = []): string | null {
  const st = (k: string) => kcs.get(k);
  // KCs in modules not yet compiled (just-in-time) have no items: skip them.
  const teachable = (key: string) => !skip.includes(key) && course.templates.some((t) => t.kcKeys[0] === key);
  for (const m of course.modules)
    for (const key of m.kc_keys) {
      const k = course.byKey.get(key);
      if (!k || isIndependent(st(key)) || !teachable(key)) continue;
      if (k.prerequisites.every((p) => satisfiesPrereq(st(p)))) return key;
    }
  for (const k of course.kcs) if (!isIndependent(st(k.key)) && teachable(k.key)) return k.key;
  if (course.transferRequired)
    for (const k of course.kcs)
      if (!st(k.key)?.transfer_passed && course.templates.some((t) => t.kcKeys[0] === k.key && t.tpl.meta.is_transfer))
        return k.key;
  return null;
}

// The weakest unmastered prerequisite chain root: the earliest ancestor that is not independent but
// whose own prerequisites are.
export function prerequisiteFirst(course: Course, kcs: Map<string, KcView>, kc: string): string | null {
  const seen = new Set<string>();
  const walk = (key: string): string | null => {
    for (const p of course.byKey.get(key)?.prerequisites ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (satisfiesPrereq(kcs.get(p))) continue;
      return walk(p) ?? p;
    }
    return null;
  };
  return walk(kc);
}

function push(ctx: PolicyCtx, m: Move): Move {
  return m;
}

// ---------- learn sessions ----------

function startKc(ctx: PolicyCtx, kc: string, feedback?: Move['feedback'], switchedFrom?: string): Move {
  const pre = isIndependent(view(ctx, kc)) ? null : prerequisiteFirst(ctx.course, ctx.kcs, kc);
  if (pre && !ctx.s.prereq_checked.includes(`${kc}>${pre}`)) {
    ctx.s.prereq_checked.push(`${kc}>${pre}`);
    ctx.s.kc = pre;
    const m = advance(ctx, pre, feedback);
    return {
      ...m,
      switched_from: kc,
      reason: `${title(ctx, kc)} builds on ${title(ctx, pre)}, which isn't solid yet, so we're starting there.`,
    };
  }
  ctx.s.kc = kc;
  const m = advance(ctx, kc, feedback);
  return switchedFrom ? { ...m, switched_from: switchedFrom } : m;
}

function advance(ctx: PolicyCtx, kc: string, feedback?: Move['feedback']): Move {
  const v = view(ctx, kc);
  const k = ctx.course.byKey.get(kc)!;
  const t = title(ctx, kc);

  if (isIndependent(v)) {
    // Stretch: transfer, then interleaved discrimination against a confusable neighbour.
    if (ctx.course.transferRequired && !v.transfer_passed) {
      const tt = choose(ctx, templatesFor(ctx, kc, undefined, { transfer: true }));
      if (tt && !ctx.s.seen.includes(tt.key)) {
        return {
          type: 'transfer_ask',
          kc,
          feedback,
          reason: `You've shown you can do ${t} on familiar problems. A new context checks that it carries over.`,
          item: { template_key: tt.key, capability: tt.tpl.meta.capability, framing: 'transfer' },
        };
      }
    }
    const conf = k.confusable.find((c) => !ctx.s.seen.some((s) => s.startsWith('interleave:' + c)));
    if (conf && templatesFor(ctx, kc, 'discriminate').length && !ctx.s.seen.includes('interleave:' + conf)) {
      ctx.s.seen.push('interleave:' + conf);
      const dt = choose(ctx, templatesFor(ctx, kc, 'discriminate'));
      if (dt)
        return {
          type: 'contrast_case',
          kc,
          feedback,
          reason: `${t} is easy to mix up with ${title(ctx, conf)}. Telling them apart is part of knowing it.`,
          item: { template_key: dt.key, capability: 'discriminate', framing: 'normal' },
        };
    }
    const next = nextKc(ctx.course, ctx.kcs, ctx.s.skip_kcs);
    if (next && next !== kc) {
      ctx.s.taught.push(next);
      const m = startKc(ctx, next, feedback, kc);
      return {
        ...m,
        reason: m.reason || `${t} now counts as demonstrated independently. Next up: ${title(ctx, next)}.`,
      };
    }
    return {
      type: 'recap',
      kc,
      feedback,
      end: true,
      reason: 'Everything in your plan is demonstrated for now. Reviews will bring things back before you forget them.',
    };
  }

  const fresh = v.state === 'not_started' || v.state === 'introduced';
  if (fresh && k.kind === 'procedural') {
    const step = ctx.s.fade_step[kc] ?? 0;
    const wt = choose(ctx, templatesFor(ctx, kc, 'apply', { worked: true, transfer: false }));
    if (wt && step === 0) {
      ctx.s.fade_step[kc] = 1;
      return {
        type: 'worked_example',
        kc,
        feedback,
        reason: `${t} is a procedure. Seeing one fully worked first, then filling in more of it yourself, is the fastest way in when it's new.`,
        example: { template_key: wt.key },
      };
    }
    if (wt && (step === 1 || step === 2) && hasValuedSteps(wt)) {
      ctx.s.fade_step[kc] = step + 1;
      return {
        type: 'completion',
        kc,
        feedback,
        reason: `Each completion problem leaves a bit more for you to do, until you're solving it on your own.`,
        item: { template_key: wt.key, capability: 'apply', blanks: step, framing: 'completion' },
      };
    }
  }
  if (fresh && k.kind === 'conceptual') {
    const step = ctx.s.pf_step[kc] ?? 0;
    if (step === 0) {
      const ct =
        choose(ctx, templatesFor(ctx, kc, 'apply', { transfer: false })) ??
        choose(ctx, templatesFor(ctx, kc, 'discriminate'));
      if (ct) {
        ctx.s.pf_step[kc] = 1;
        return {
          type: 'challenge',
          kc,
          feedback,
          reason: `Trying ${t} before any explanation makes the explanation land better, even if your first attempt is off.`,
          item: { template_key: ct.key, capability: ct.tpl.meta.capability, framing: 'challenge' },
        };
      }
    }
    if (step === 1) {
      ctx.s.pf_step[kc] = 2;
      return {
        type: 'instruct',
        kc,
        feedback,
        instruct: 'build_on_attempt',
        reason: `Now that you've tried it, here's the idea, connected to what you did.`,
      };
    }
    if (step === 2) {
      ctx.s.pf_step[kc] = 3;
      const wt = choose(ctx, templatesFor(ctx, kc, undefined, { worked: true, transfer: false }));
      if (wt)
        return {
          type: 'worked_example',
          kc,
          feedback,
          reason: `A worked example shows the idea applied step by step.`,
          example: { template_key: wt.key },
        };
    }
  }

  // Fade / practice: independent items for the next capability the goal still needs.
  let caps = neededCaps(ctx, kc);
  if (!caps.length && v.p_known >= 0.95 && v.apply_instances >= 2 && (ctx.s.skip_caps?.[kc]?.length ?? 0) > 0) {
    // Only ungradeable evidence is missing: move on rather than drilling more of the same.
    ctx.s.skip_kcs = [...(ctx.s.skip_kcs ?? []), kc];
    const next = nextKc(ctx.course, ctx.kcs, ctx.s.skip_kcs);
    if (next && next !== kc) return startKc(ctx, next, feedback, kc);
    return { type: 'recap', kc, feedback, end: true, reason: 'That is as far as this session can take it.' };
  }
  if (ctx.s.explain_streak >= 2) caps = caps.filter((c) => c !== 'explain' && c !== 'recall');
  const cap = caps[0] ?? 'apply';
  const tt =
    choose(ctx, templatesFor(ctx, kc, cap, { transfer: false })) ??
    choose(ctx, templatesFor(ctx, kc, undefined, { transfer: false }));
  if (!tt) return { type: 'recap', kc, feedback, end: true, reason: `There are no more questions for ${t} right now.` };
  const reasons: Record<Capability, string> = {
    apply: `Solving a new problem on your own, with no hints, is what counts toward mastering ${t}.`,
    explain: `Explaining it in your own words is one of the best-supported ways to make an idea stick, and it shows whether the reason clicked, not just the steps.`,
    discriminate: `Knowing when ${t} applies, and when a look-alike does instead, is part of knowing it.`,
    predict: `Predicting which way the answer moves before computing checks that you understand how the pieces connect.`,
    recall: `Recalling it cold, without looking, is what lets you use it later.`,
  };
  return {
    type: 'ask',
    kc,
    feedback,
    reason: reasons[tt.tpl.meta.capability],
    item: { template_key: tt.key, capability: tt.tpl.meta.capability, framing: 'normal' },
  };
}

function hasValuedSteps(t: CourseTemplate): boolean {
  try {
    const p = t.tpl.params({
      next: () => 0.5,
      int: (lo: number) => lo,
      pick: (a: readonly any[]) => a[0],
      shuffle: (a: readonly any[]) => a.slice(),
    });
    return (t.tpl.worked?.(p) ?? []).filter((s) => s.value !== undefined).length >= 2;
  } catch {
    return false;
  }
}

function afterWrong(ctx: PolicyCtx, o: Outcome, p: Pending): Move {
  const kc = p.kc;
  const h = ctx.hyps.get(kc) ?? {};
  const t = title(ctx, kc);
  const fb = { correct: false, specific_point: o.specific_point };
  const failedTwice = (m: MoveType) => (ctx.s.move_failures[m] ?? 0) >= 2;

  // A misconception is decided: refute it, then test the distinction.
  const d = decided(h);
  if (d && !NON_MISCONCEPTIONS.includes(d) && !ctx.s.refuted.includes(d) && !failedTwice('refute')) {
    ctx.s.refuted.push(d);
    const test =
      choose(
        ctx,
        templatesFor(ctx, kc, undefined, { discriminating: [d] }).filter((x) => x.tpl.meta.widget === 'mcq'),
      ) ?? choose(ctx, templatesFor(ctx, kc, 'discriminate'));
    const mis = ctx.course.misconceptions.get(d);
    return {
      type: 'refute',
      kc,
      feedback: fb,
      misconception: d,
      instruct: 'refutation',
      reason: `Your answer matched a very common mix-up${mis ? `: ${mis.description.replace(/\.$/, '')}` : ''}. Naming it and seeing why it fails is more effective than just being told the right answer.`,
      item: test
        ? { template_key: test.key, capability: test.tpl.meta.capability, framing: 'test_distinction' }
        : { template_key: p.template_key!, capability: p.capability!, framing: 'normal' },
      pending_patch: { return_template: p.template_key },
    };
  }

  // Several live hypotheses: ask the probe that best splits the top two.
  const live = ranked(h).filter(([k, w]) => !NON_MISCONCEPTIONS.includes(k) && w >= 0.3);
  if (live.length && !p.probe_for && ctx.s.probes_on_item < 1 && !failedTwice('probe')) {
    const cands = ctx.course.templates
      .filter((x) => x.kcKeys.includes(kc) && x.tpl.meta.widget === 'mcq' && !ctx.s.seen.includes(x.key))
      .map((x) => ({ id: x.key, discriminates: x.tpl.meta.discriminates ?? [] }));
    const best = rankProbes(h, cands)[0];
    if (best) {
      ctx.s.probes_on_item++;
      return {
        type: 'probe',
        kc,
        feedback: fb,
        reason: `Before fixing anything, one quick check tells apart the likely reasons for that answer, so the help that follows is the right help.`,
        item: { template_key: best.id, capability: 'discriminate', framing: 'probe' },
        pending_patch: {
          probe_for: live.slice(0, 2).map(([k]) => k),
          return_template: p.template_key,
          return_instance: p.instance_id,
        },
      };
    }
  }

  // Probably an execution slip: point to the step, learner re-does the same item.
  const top = ranked(h)[0];
  if (o.near && top?.[0] === 'slip' && p.attempts <= 1 && !failedTwice('isolate_step')) {
    return {
      type: 'isolate_step',
      kc,
      feedback: fb,
      reason: `Your approach looks right; a slip in one step is the likeliest explanation, so it's worth redoing that step.`,
      item: {
        template_key: p.template_key!,
        capability: p.capability!,
        reuse_instance: p.instance_id,
        framing: 'normal',
      },
      pending_patch: { rung: Math.max(p.rung, 1) },
    };
  }

  // Can't begin and a prerequisite isn't solid: teach the prerequisite.
  if (p.attempts >= 2) {
    const pre = prerequisiteFirst(ctx.course, ctx.kcs, kc);
    if (pre && !ctx.s.prereq_checked.includes(`${kc}>${pre}`)) {
      ctx.s.prereq_checked.push(`${kc}>${pre}`);
      ctx.s.kc = pre;
      const m = advance(ctx, pre, fb);
      return {
        ...m,
        switched_from: kc,
        reason: `This kind of problem leans on ${title(ctx, pre)}. Shoring that up first will make ${t} easier.`,
      };
    }
  }

  // Escalate the help ladder on the same item.
  return ladderStep(ctx, p, fb);
}

// rung: 1 pump · 3 hint · 4 prompt · 5 worked step · 6 bottom-out, then a fresh isomorphic item.
function ladderStep(ctx: PolicyCtx, p: Pending, fb: Move['feedback'] | undefined): Move {
  const kc = p.kc;
  const same: ItemRequest = {
    template_key: p.template_key!,
    capability: p.capability!,
    reuse_instance: p.instance_id,
    framing: 'normal',
  };
  let r = p.rung;
  const next = r < 1 ? 1 : r < 3 ? 3 : r < 4 ? 4 : r < 5 ? 5 : 6;
  const skipPump = next === 1 && (ctx.s.move_failures.pump ?? 0) >= 2;
  const target = skipPump ? 3 : next;
  const reason =
    'Help comes in small steps, so you do as much of the thinking as possible. Each step of help lowers how much this answer counts toward mastery.';
  if (target === 1) return { type: 'pump', kc, feedback: fb, reason, item: same, pending_patch: { rung: 1 } };
  if (target === 3)
    return {
      type: 'hint',
      kc,
      feedback: fb,
      reason,
      item: same,
      pending_patch: { rung: 3, hints_given: p.hints_given + 1 },
    };
  if (target === 4)
    return {
      type: 'prompt',
      kc,
      feedback: fb,
      reason,
      item: same,
      pending_patch: { rung: 4, hints_given: p.hints_given + 1 },
    };
  if (target === 5) return { type: 'worked_step', kc, feedback: fb, reason, item: same, pending_patch: { rung: 5 } };
  // Bottom-out: show the full solution of this item, then a fresh isomorphic item at rung 0.
  const iso = choose(ctx, templatesFor(ctx, kc, p.capability, { transfer: false }));
  return {
    type: 'bottom_out',
    kc,
    feedback: fb,
    reason: `Seeing this one solved, then trying a fresh one with new numbers, is the quickest way past being stuck.`,
    example: { template_key: p.template_key!, same_instance: p.instance_id },
    item: iso ? { template_key: iso.key, capability: iso.tpl.meta.capability, framing: 'normal' } : undefined,
  };
}

function learnMove(ctx: PolicyCtx): Move {
  const s = ctx.s;
  const o = ctx.outcome;
  const p = s.pending;
  if (!s.kc) {
    const k = nextKc(ctx.course, ctx.kcs);
    if (!k) return { type: 'recap', kc: '', end: true, reason: 'Everything in your plan is demonstrated for now.' };
    s.taught.push(k);
    return startKc(ctx, k);
  }
  if (!o || !p) return startKc(ctx, s.kc);
  const kc = p.kc;

  if (o.kind === 'continue') return advance(ctx, kc);
  if (!o.uncertain && p.capability && s.uncertain) delete s.uncertain[`${kc}|${p.capability}`];

  if (o.uncertain) {
    const key = `${kc}|${p.capability}`;
    s.uncertain = { ...(s.uncertain ?? {}), [key]: (s.uncertain?.[key] ?? 0) + 1 };
    if (s.uncertain[key] >= 2 && p.capability) {
      s.skip_caps = { ...(s.skip_caps ?? {}), [kc]: [...(s.skip_caps?.[kc] ?? []), p.capability] };
      return advance(ctx, kc);
    }
    const alt =
      choose(
        ctx,
        templatesFor(ctx, kc, p.capability, { transfer: false }).filter((x) => x.key !== p.template_key),
      ) ?? choose(ctx, templatesFor(ctx, kc, p.capability));
    return {
      type: 'ask',
      kc,
      reason: `I couldn't tell for sure from that answer whether the idea is there, so here's a different question on the same thing.`,
      item: alt ? { template_key: alt.key, capability: alt.tpl.meta.capability, framing: 'normal' } : undefined,
    };
  }

  if (o.kind === 'unsure') {
    if (p.challenge) return advance(ctx, kc); // problem-first: a blank attempt falls back to instruction
    return ladderStep(ctx, { ...p, rung: Math.max(p.rung, 1) }, undefined);
  }

  if (o.correct) {
    const fb = { correct: true, specific_point: o.specific_point };
    if (p.challenge) return advance(ctx, kc, fb);
    // Probe answered correctly: return to the original item (isolate the step) if the slip is the live story.
    if (p.probe_for && p.return_template) {
      const h = ctx.hyps.get(kc) ?? {};
      const tm = topMisconception(h);
      if (!(tm && tm[1] > 0.7)) {
        return {
          type: 'isolate_step',
          kc,
          feedback: fb,
          reason: `You know which group the rate refers to, so the earlier answer was more likely a slip. Try that problem again.`,
          item: p.return_instance
            ? {
                template_key: p.return_template,
                capability: 'apply',
                reuse_instance: p.return_instance,
                framing: 'normal',
              }
            : { template_key: p.return_template, capability: 'apply', framing: 'normal' },
        };
      }
    }
    // Correct answer but the explanation missed key ideas: probe with a prediction or contrast case.
    if ((o.capability === 'explain' || o.capability === 'recall') && o.missing.length) {
      const pt = choose(ctx, templatesFor(ctx, kc, 'predict')) ?? choose(ctx, templatesFor(ctx, kc, 'discriminate'));
      if (pt)
        return {
          type: pt.tpl.meta.capability === 'predict' ? 'ask' : 'contrast_case',
          kc,
          feedback: fb,
          reason: `Your explanation got the main point; this checks the piece it didn't mention.`,
          item: { template_key: pt.key, capability: pt.tpl.meta.capability, framing: 'normal' },
        };
    }
    if (p.return_template && !p.probe_for) {
      // Distinction tested after a refutation: back to a fresh version of the original kind of problem.
      const back = ctx.course.templates.find((x) => x.key === p.return_template);
      if (back)
        return {
          type: 'ask',
          kc,
          feedback: fb,
          reason: `Now that the distinction is clear, back to the original kind of problem, with new numbers.`,
          item: { template_key: back.key, capability: back.tpl.meta.capability, framing: 'normal' },
        };
    }
    return advance(ctx, kc, fb);
  }
  // Problem-first: whatever the attempt, instruction comes next and builds on it.
  if (p.challenge) return advance(ctx, kc, { correct: false, specific_point: o.specific_point });
  return afterWrong(ctx, o, p);
}

// ---------- review sessions ----------

function reviewMove(ctx: PolicyCtx): Move {
  const s = ctx.s;
  const o = ctx.outcome;
  const p = s.pending;
  let fb: Move['feedback'];
  if (o && p && o.kind !== 'continue') {
    if (o.uncertain) {
      const alt = choose(
        ctx,
        templatesFor(ctx, p.kc, p.capability).filter((x) => x.key !== p.template_key),
      );
      if (alt)
        return {
          type: 'review_ask',
          kc: p.kc,
          reason: `I couldn't tell from that answer, so here's another question on the same idea.`,
          item: { template_key: alt.key, capability: alt.tpl.meta.capability, framing: 'review' },
        };
    }
    if (!o.correct && p.is_review) {
      return {
        type: 'relearn',
        kc: p.kc,
        feedback: { correct: false, specific_point: o.specific_point },
        instruct: 'remediation',
        reason: `This one had faded. A short refresher now, and it comes back sooner next time.`,
      };
    }
    fb = { correct: !!o.correct, specific_point: o.specific_point };
  }
  if (s.items_done >= 15 || ctx.minutesLeft <= 0)
    return { type: 'recap', kc: s.kc ?? '', feedback: fb, end: true, reason: 'That covers what was due.' };
  const next = s.queue.shift();
  if (!next) return { type: 'recap', kc: s.kc ?? '', feedback: fb, end: true, reason: 'That covers what was due.' };
  if (next.startsWith('interleave:')) {
    const kc = next.slice('interleave:'.length);
    const dt = choose(ctx, templatesFor(ctx, kc, 'discriminate'));
    if (dt) {
      s.kc = kc;
      return {
        type: 'contrast_case',
        kc,
        feedback: fb,
        reason: `Mixing in a look-alike makes you check which idea applies, instead of running on autopilot.`,
        item: { template_key: dt.key, capability: 'discriminate', framing: 'normal' },
      };
    }
    return reviewMove({ ...ctx, outcome: null });
  }
  s.kc = next;
  // A review is never the same item: rotate the tested capability apply -> explain -> discriminate.
  const rotation: Capability[] = ['apply', 'explain', 'discriminate'];
  const done = s.seen.filter((x) => ctx.course.templates.find((t) => t.key === x)?.kcKeys[0] === next).length;
  let tt: CourseTemplate | null = null;
  for (let i = 0; i < rotation.length && !tt; i++) {
    const cap = rotation[(done + i + ctx.s.items_done) % rotation.length];
    tt = choose(
      ctx,
      templatesFor(ctx, next, cap, { transfer: false }).filter((x) => x.tier !== 'unverified'),
    );
  }
  tt = tt ?? choose(ctx, templatesFor(ctx, next, undefined, { transfer: false }));
  if (!tt) return reviewMove({ ...ctx, outcome: null });
  return {
    type: 'review_ask',
    kc: next,
    feedback: fb,
    reason: `${title(ctx, next)} is due because you're about to forget it. Fresh problems, never ones you've seen.`,
    item: { template_key: tt.key, capability: tt.tpl.meta.capability, framing: 'review' },
  };
}

// ---------- placement ----------

export function placementStart(course: Course, priority: string[]): PlacementState {
  return { resolved: {}, current: null, step: 'apply', asked: 0, max: 12, priority };
}

function medianDepthKc(course: Course, keys: string[]): string | null {
  if (!keys.length) return null;
  const sorted = keys.map((k) => course.byKey.get(k)!).sort((a, b) => a.depth - b.depth);
  return sorted[Math.floor((sorted.length - 1) / 2)].key;
}

function ancestors(course: Course, kc: string, acc = new Set<string>()): Set<string> {
  for (const p of course.byKey.get(kc)?.prerequisites ?? [])
    if (!acc.has(p)) {
      acc.add(p);
      ancestors(course, p, acc);
    }
  return acc;
}
function descendants(course: Course, kc: string): Set<string> {
  const out = new Set<string>();
  let frontier = [kc];
  while (frontier.length) {
    const nxt: string[] = [];
    for (const k of course.kcs)
      if (k.prerequisites.some((p) => frontier.includes(p)) && !out.has(k.key)) {
        out.add(k.key);
        nxt.push(k.key);
      }
    frontier = nxt;
  }
  return out;
}

export interface PlacementResult {
  kc: string;
  result: 'pass' | 'fail';
  implied_known: string[];
  implied_unknown: string[];
}

// Called by the pipeline after both placement items for a KC (or a decisive wrong) are in.
export function resolvePlacement(course: Course, ps: PlacementState, kc: string, pass: boolean): PlacementResult {
  ps.resolved[kc] = pass ? 'pass' : 'fail';
  const implied_known: string[] = [],
    implied_unknown: string[] = [];
  if (pass)
    for (const a of ancestors(course, kc))
      if (!ps.resolved[a]) {
        ps.resolved[a] = 'implied_known';
        implied_known.push(a);
      }
  if (!pass)
    for (const d of descendants(course, kc))
      if (!ps.resolved[d]) {
        ps.resolved[d] = 'implied_unknown';
        implied_unknown.push(d);
      }
  // Where next: up to an unvisited descendant after a pass, down to the nearest unresolved prerequisite after a fail.
  const unresolved = course.kcs.map((k) => k.key).filter((k) => !ps.resolved[k] && hasPlacementItems(course, k));
  let next: string | null = null;
  const pri = ps.priority.filter((k) => unresolved.includes(k));
  if (pri.length) next = pri[0];
  else if (pass) {
    const up = [...descendants(course, kc)]
      .filter((k) => unresolved.includes(k))
      .map((k) => course.byKey.get(k)!)
      .sort((a, b) => a.depth - b.depth);
    next = up[0]?.key ?? null;
  } else {
    const down = (course.byKey.get(kc)?.prerequisites ?? [])
      .filter((k) => unresolved.includes(k))
      .map((k) => course.byKey.get(k)!)
      .sort((a, b) => b.depth - a.depth);
    next = down[0]?.key ?? null;
  }
  ps.current = next ?? medianDepthKc(course, unresolved);
  ps.step = 'apply';
  return { kc, result: pass ? 'pass' : 'fail', implied_known, implied_unknown };
}

function hasPlacementItems(course: Course, kc: string): boolean {
  return course.templates.some(
    (t) =>
      t.kcKeys[0] === kc && !t.tpl.meta.is_transfer && (t.tpl.meta.widget === 'numeric' || t.tpl.meta.widget === 'mcq'),
  );
}

function placementMove(ctx: PolicyCtx): Move {
  const ps = ctx.s.placement!;
  if (ps.current === null && ps.asked === 0) {
    const pri = ps.priority.filter((k) => hasPlacementItems(ctx.course, k));
    ps.current =
      pri[0] ??
      medianDepthKc(
        ctx.course,
        ctx.course.kcs.map((k) => k.key).filter((k) => hasPlacementItems(ctx.course, k)),
      );
  }
  if (!ps.current || ps.asked >= ps.max)
    return { type: 'recap', kc: '', end: true, reason: 'That was enough to place you.' };
  const kc = ps.current;
  const cap: Capability = ps.step === 'apply' ? 'apply' : 'discriminate';
  const verifiable = (x: CourseTemplate) => x.tpl.meta.widget === 'numeric' || x.tpl.meta.widget === 'mcq';
  let tt = choose(ctx, templatesFor(ctx, kc, cap, { transfer: false }).filter(verifiable));
  if (!tt) tt = choose(ctx, templatesFor(ctx, kc, undefined, { transfer: false }).filter(verifiable));
  if (!tt) {
    ps.resolved[kc] = 'implied_unknown';
    ps.current = null;
    return { type: 'recap', kc, end: true, reason: '' };
  }
  return {
    type: 'placement_ask',
    kc,
    reason: `Each answer just tells us which topics you can skip.`,
    item: { template_key: tt.key, capability: tt.tpl.meta.capability, framing: 'placement' },
  };
}

// ---------- mock interview ----------

function interviewMove(ctx: PolicyCtx): Move {
  const s = ctx.s,
    o = ctx.outcome,
    p = s.pending;
  let fb: Move['feedback'];
  if (o && p && o.kind === 'answer') fb = { correct: !!o.correct, specific_point: o.specific_point };
  if (o && p && o.kind === 'unsure')
    fb = { correct: false, specific_point: 'That one is worth revisiting before the interview.' };
  const next = s.queue.shift();
  if (!next || ctx.minutesLeft <= 0)
    return { type: 'recap', kc: s.kc ?? '', feedback: fb, end: true, reason: 'That ends the mock interview.' };
  s.kc = next;
  const tt =
    choose(ctx, templatesFor(ctx, next, undefined, { transfer: true })) ??
    choose(ctx, templatesFor(ctx, next, 'explain')) ??
    choose(ctx, templatesFor(ctx, next, 'apply'));
  if (!tt) return interviewMove({ ...ctx, outcome: null });
  return {
    type: 'ask',
    kc: next,
    feedback: fb,
    reason: `Mock interviews mix questions across every requirement, the way a real interview does.`,
    item: { template_key: tt.key, capability: tt.tpl.meta.capability, framing: 'interview' },
  };
}

export function nextMove(ctx: PolicyCtx): Move {
  if (ctx.minutesLeft <= 0 && ctx.s.kind === 'learn' && ctx.outcome) {
    const fb =
      ctx.outcome.kind === 'answer' && ctx.outcome.correct !== null
        ? { correct: !!ctx.outcome.correct, specific_point: ctx.outcome.specific_point }
        : undefined;
    return {
      type: 'recap',
      kc: ctx.s.kc ?? '',
      feedback: fb,
      end: true,
      reason: "That's the time you set for this session.",
    };
  }
  const m =
    ctx.s.kind === 'review'
      ? reviewMove(ctx)
      : ctx.s.kind === 'placement'
        ? placementMove(ctx)
        : ctx.s.kind === 'mock_interview'
          ? interviewMove(ctx)
          : learnMove(ctx);
  return push(ctx, m);
}
