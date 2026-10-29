// Small helpers for writing templates compactly: number formatting, a few
// probability utilities, and builders that fill in TemplateMeta for each widget.
import type {
  Capability,
  ItemTemplate,
  McqOption,
  Rng,
  TemplateMeta,
  Tolerance,
  WorkedStep,
} from '../../../../shared/content.ts';
import { makeRng } from '../../rng.ts';

// ---------- formatting ----------

/** Round to `dp` places and format for humans: 1234.5 -> "1,234.5", 8.0 -> "8". */
export function fmt(x: number, dp = 2): string {
  const v = Number(x.toFixed(dp));
  return (Object.is(v, -0) ? 0 : v).toLocaleString('en-US', { maximumFractionDigits: dp });
}
/** Fraction -> percent string: 0.01 -> "1%", 0.0833 -> "8.33%". */
export const pct = (x: number, dp = 2): string => fmt(x * 100, dp) + '%';
/** Dollars: 5 -> "$5", 2.5 -> "$2.50", -1 -> "-$1". */
export function usd(x: number): string {
  const a = Math.round(Math.abs(x) * 100) / 100;
  const s = Number.isInteger(a)
    ? a.toLocaleString('en-US')
    : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (x < 0 && a !== 0 ? '-$' : '$') + s;
}
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Percent answers asked "rounded to one decimal place". */
export const PCT1: Tolerance = { abs: 0.3 };
/** Decimal probabilities asked "rounded to 3 places". */
export const DEC3: Tolerance = { abs: 0.003 };
/** Whole-number counts. */
export const COUNT: Tolerance = { abs: 0.5 };

// ---------- probability utilities ----------

export function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}
export const binomPmf = (n: number, k: number, p: number): number => choose(n, k) * p ** k * (1 - p) ** (n - k);

/** All 36 ordered (red, blue) outcomes of two dice. */
export const DICE: [number, number][] = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) DICE.push([a, b]);
export const countDice = (pred: (a: number, b: number) => boolean): number =>
  DICE.filter(([a, b]) => pred(a, b)).length;

/** True when every pair of finite values differs by more than `gap`. */
export function spread(vals: number[], gap: number): boolean {
  const v = vals.filter(Number.isFinite);
  for (let i = 0; i < v.length; i++)
    for (let j = i + 1; j < v.length; j++) if (Math.abs(v[i] - v[j]) <= gap) return false;
  return true;
}

/** Draw params until `ok` holds (deterministic: only uses the given rng). */
export function retry<P>(rng: Rng, gen: (rng: Rng) => P, ok: (p: P) => boolean): P {
  for (let i = 0; i < 500; i++) {
    const p = gen(rng);
    if (ok(p)) return p;
  }
  throw new Error('params: no valid draw found');
}

/** Smallest round population (>= 1,000) that makes every rate × population a whole number. */
export function freqBase(...rates: number[]): number {
  for (const n of [1000, 10000, 100000, 1000000]) {
    if (rates.every((r) => Math.abs(n * r - Math.round(n * r)) < 1e-6)) return n;
  }
  return 1000000;
}

// ---------- builders ----------

interface Base<P> {
  id: string;
  kcs: string[];
  transfer?: boolean;
  params?: (rng: Rng) => P;
  text: (p: P) => string;
  hints: (p: P) => string[];
  worked?: (p: P) => WorkedStep[];
  discriminates?: string[];
}

/** An option: plain text, or [text, misconception id]. */
export type Opt = string | [string, string];
const toOpt = (o: Opt): McqOption => (typeof o === 'string' ? { text: o } : { text: o[0], misconception: o[1] });

function meta<P>(d: Base<P>, capability: Capability, widget: TemplateMeta['widget']): TemplateMeta {
  return { id: d.id, kcs: d.kcs, capability, widget, is_transfer: d.transfer ?? false, discriminates: d.discriminates };
}

function common<P>(d: Base<P>) {
  return {
    params: d.params ?? ((() => ({})) as unknown as (rng: Rng) => P),
    text: d.text,
    hints: d.hints,
    worked: d.worked,
  };
}

// Collect the misconceptions an mcq's options can diagnose (sampled over params).
function mcqDiscriminates<P>(t: ItemTemplate<P>): ItemTemplate<P> {
  if (t.meta.discriminates?.length) return t;
  const rng = makeRng(2024);
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++)
    for (const o of t.mcq!(t.params(rng)).options) if (o.misconception) seen.add(o.misconception);
  t.meta.discriminates = [...seen];
  return t;
}

export function numeric<P>(
  d: Base<P> & {
    capability?: Capability;
    unit: '%' | '';
    tol: Tolerance;
    solve: (p: P) => number;
    wrong?: Record<string, (p: P) => number>;
  },
): ItemTemplate<P> {
  const m = meta(d, d.capability ?? 'apply', 'numeric');
  m.discriminates = d.discriminates ?? Object.keys(d.wrong ?? {});
  m.tolerance = d.tol;
  m.unit = d.unit;
  return { meta: m, ...common(d), solve: d.solve, wrongSolve: d.wrong };
}

export function free<P>(
  d: Base<P> & { capability: 'recall' | 'explain'; expect: Record<string, string>; reference: (p: P) => string },
): ItemTemplate<P> {
  const expectations = Object.entries(d.expect).map(([id, text]) => ({ id, text }));
  return { meta: meta(d, d.capability, 'free_text'), ...common(d), rubric: { expectations, reference: d.reference } };
}

/** Shuffled mcq: one right answer plus distractors. Shuffle order comes from a seed drawn in params(). */
export function choice<P>(
  d: Base<P> & { capability: Capability; right: (p: P) => string; wrong: (p: P) => Opt[] },
): ItemTemplate<P & { seed: number }> {
  const params = d.params ?? ((() => ({})) as unknown as (rng: Rng) => P);
  return mcqDiscriminates<P & { seed: number }>({
    meta: meta(d, d.capability, 'mcq'),
    params: (rng: Rng) => ({ ...params(rng), seed: rng.int(1, 2 ** 30) }),
    text: d.text,
    hints: d.hints,
    worked: d.worked,
    mcq: (p) => {
      const all = [{ text: d.right(p) }, ...d.wrong(p).map(toOpt)];
      const order = makeRng(p.seed).shuffle(all.map((_, i) => i));
      return { options: order.map((i) => all[i]), correct: order.indexOf(0) };
    },
  });
}

/** Fixed-order mcq (categories that read best in a set order). The correct option never carries a misconception. */
export function fixed<P>(
  d: Base<P> & { capability: Capability; options: (p: P) => Opt[]; correct: (p: P) => number },
): ItemTemplate<P> {
  return mcqDiscriminates({
    meta: meta(d, d.capability, 'mcq'),
    ...common(d),
    mcq: (p) => {
      const correct = d.correct(p);
      return { options: d.options(p).map((o, i) => (i === correct ? { text: toOpt(o).text } : toOpt(o))), correct };
    },
  });
}

export type Dir = 'up' | 'down' | 'same' | 'cant';
const DIRS: Dir[] = ['up', 'down', 'same', 'cant'];
const DIR_LABEL: Record<Dir, string> = {
  up: 'Goes up',
  down: 'Goes down',
  same: 'Stays the same',
  cant: "Can't tell without more information",
};

/** Predict-the-direction mcq with fixed options Goes up / Goes down / Stays the same / Can't tell. */
export function predict<P>(
  d: Base<P> & { answer: (p: P) => Dir; miscon?: (p: P) => Partial<Record<Dir, string>> },
): ItemTemplate<P> {
  return fixed({
    ...d,
    capability: 'predict',
    options: (p) => {
      const m = d.miscon?.(p) ?? {};
      return DIRS.map((k): Opt => (m[k] ? [DIR_LABEL[k], m[k]!] : DIR_LABEL[k]));
    },
    correct: (p) => DIRS.indexOf(d.answer(p)),
  });
}
