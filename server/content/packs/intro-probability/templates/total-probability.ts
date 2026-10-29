import type { ItemTemplate } from '../../../../../shared/content.ts';
import { cap, fixed, fmt, free, numeric, PCT1, pct, predict, retry, spread } from '../lib.ts';
import { SCREENS, scenario } from '../contexts.ts';

const K = 'total-probability';

const RULES = [
  'Law of total probability (weighted sum over groups)',
  'Addition rule for "A or B"',
  "Bayes' rule",
  'Multiplication rule for "A and B"',
];
const WHICH_RULE = [
  {
    s: 'A factory has two machines with different shares of the output and different defect rates. Find the chance that a randomly chosen part is defective.',
    r: 0,
  },
  {
    s: 'You know what share of emails are spam, and how often spam and legitimate emails each get flagged. Find the overall share of emails that get flagged.',
    r: 0,
  },
  {
    s: 'You know what share of customers use the app, the share who use the website, and the share who use both. Find the chance a customer uses the app or the website.',
    r: 1,
  },
  {
    s: "You know each machine's share of output and its defect rate. A part is found to be defective: find the chance it came from machine B.",
    r: 2,
  },
  { s: 'Two backup drives fail independently, each with a known probability. Find the chance that both fail.', r: 3 },
];

const t: ItemTemplate[] = [
  free({
    id: 'tp-recall-law',
    kcs: [K],
    capability: 'recall',
    text: () => 'State the law of total probability for an event B, using a split of the population into A and not A.',
    expect: {
      formula: 'P(B) = P(B | A) × P(A) + P(B | not A) × P(not A).',
      partition: 'The groups must not overlap and must cover everyone.',
      weighted: 'It is a weighted average of the group rates, weighted by group size.',
    },
    reference: () =>
      "P(B) = P(B | A) P(A) + P(B | not A) P(not A). A and not A split everyone into two non-overlapping groups, so the overall rate is each group's rate weighted by that group's share — a weighted average.",
    hints: () => [
      "Split everyone into two groups that don't overlap.",
      'How much does each group contribute to the overall rate?',
    ],
  }),

  free({
    id: 'tp-explain-not-average',
    kcs: [K],
    capability: 'explain',
    params: (rng) => ({ wa: rng.pick([0.7, 0.8, 0.9]), da: rng.pick([1, 2]), db: rng.pick([6, 8, 10]) }),
    text: ({ wa, da, db }) =>
      `Machine A makes ${pct(wa)} of a factory's output and has a defect rate of ${da}%; machine B makes the rest and has a defect rate of ${db}%. A colleague says the overall defect rate is the average, (${da}% + ${db}%) / 2 = ${fmt((da + db) / 2)}%. Explain why that's wrong and what the right approach is.`,
    expect: {
      weight: "Each machine's rate must be weighted by its share of the output.",
      result: 'Computes the weighted sum (the correct overall rate).',
      between: "Notes the answer lies between the two rates, closer to the bigger machine's rate.",
    },
    reference: ({ wa, da, db }) =>
      `A plain average treats the two machines as if they made equal amounts, but A makes ${pct(wa)} of the parts. Weight each rate by its share: ${pct(wa)} × ${da}% + ${pct(1 - wa)} × ${db}% = ${fmt(wa * da + (1 - wa) * db)}%. The result lies between ${da}% and ${db}%, close to A's rate because A makes most of the parts.`,
    hints: () => [
      'Do the two machines make the same number of parts?',
      'Out of 100 parts, how many defective ones come from each machine?',
    ],
  }),

  predict({
    id: 'tp-predict-shift-production',
    kcs: [K],
    params: (rng) => ({
      kind: rng.pick(['towardB', 'towardA', 'scale'] as const),
      da: rng.pick([1, 2, 3]),
      db: rng.pick([5, 6, 8]),
    }),
    text: ({ kind, da, db }) => {
      const change =
        kind === 'towardB'
          ? "The factory shifts production so that machine B makes a larger share of the parts (each machine's defect rate unchanged)."
          : kind === 'towardA'
            ? "The factory shifts production so that machine A makes a larger share of the parts (each machine's defect rate unchanged)."
            : "The factory doubles its total output, keeping each machine's share and defect rate the same.";
      return `A factory has two machines: A has a defect rate of ${da}% and B a defect rate of ${db}%. ${change} What happens to the overall defect rate?`;
    },
    answer: ({ kind }) => (kind === 'towardB' ? 'up' : kind === 'towardA' ? 'down' : 'same'),
    miscon: ({ kind }) => (kind === 'scale' ? {} : { same: 'unweighted-average' }),
    hints: () => [
      "The overall rate is a weighted average of the two machines' rates.",
      'Which weights change, and toward which rate?',
    ],
  }),

  numeric({
    id: 'tp-apply-two-machines',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({
          wa: r.pick([0.2, 0.3, 0.4, 0.6, 0.7, 0.8]),
          da: r.pick([0.01, 0.02, 0.03, 0.04]),
          db: r.pick([0.05, 0.06, 0.08, 0.1]),
        }),
        ({ wa, da, db }) => Math.abs(100 * (wa - 0.5) * (da - db)) > 0.6,
      ),
    text: ({ wa, da, db }) =>
      `Machine A makes ${pct(wa)} of a factory's parts, and machine B makes the rest. ${pct(da)} of A's parts are defective, and ${pct(db)} of B's parts are. What percent of all the factory's parts are defective? Round to one decimal place.`,
    solve: ({ wa, da, db }) => 100 * (wa * da + (1 - wa) * db),
    wrong: { 'unweighted-average': ({ da, db }) => (100 * (da + db)) / 2 },
    hints: () => ['Each machine contributes (its share of parts) × (its defect rate).', 'Add the two contributions.'],
    worked: ({ wa, da, db }) => [
      { text: `A contributes ${pct(wa)} × ${pct(da)} = ${pct(wa * da)}.`, value: 100 * wa * da, unit: '%' },
      {
        text: `B contributes ${pct(1 - wa)} × ${pct(db)} = ${pct((1 - wa) * db)}.`,
        value: 100 * (1 - wa) * db,
        unit: '%',
      },
      {
        text: `Overall: ${pct(wa * da)} + ${pct((1 - wa) * db)} = ${pct(wa * da + (1 - wa) * db)}.`,
        value: 100 * (wa * da + (1 - wa) * db),
        unit: '%',
      },
    ],
  }),

  numeric({
    id: 'tp-apply-share-flagged',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) => ({
      c: rng.pick(SCREENS),
      p: rng.pick([0.01, 0.02, 0.05, 0.1, 0.2]),
      s: rng.pick([0.8, 0.9, 0.95]),
      f: rng.pick([0.02, 0.05, 0.1]),
    }),
    text: ({ c, p, s, f }) =>
      `${scenario(c, p, s, f)} What percent of all ${c.unitPl} are ${c.Es}? Round to one decimal place.`,
    solve: ({ p, s, f }) => 100 * (p * s + (1 - p) * f),
    wrong: {
      'ignores-false-positives': ({ p, s }) => 100 * p * s,
      'unweighted-average': ({ s, f }) => (100 * (s + f)) / 2,
    },
    hints: ({ c }) => [
      `Split everything into ${c.actualPos} and ${c.actualNeg}.`,
      'Each group contributes (its share) × (its rate of being flagged).',
    ],
    worked: ({ c, p, s, f }) => [
      {
        text: `${cap(c.actualPos)}: ${pct(p)} × ${pct(s)} = ${pct(p * s)} of everything.`,
        value: 100 * p * s,
        unit: '%',
      },
      {
        text: `${cap(c.actualNeg)}: ${pct(1 - p)} × ${pct(f)} = ${pct((1 - p) * f)} of everything.`,
        value: 100 * (1 - p) * f,
        unit: '%',
      },
      { text: `Total ${c.Es}: ${pct(p * s + (1 - p) * f)}.`, value: 100 * (p * s + (1 - p) * f), unit: '%' },
    ],
  }),

  numeric({
    id: 'tp-apply-three-groups',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({
          w: r.pick([
            [0.2, 0.5, 0.3],
            [0.15, 0.6, 0.25],
            [0.3, 0.45, 0.25],
            [0.1, 0.7, 0.2],
          ]),
          rt: [r.pick([0.08, 0.1, 0.12]), r.pick([0.03, 0.04, 0.05]), r.pick([0.05, 0.06, 0.07])],
        }),
        ({ w, rt }) =>
          spread([100 * (w[0] * rt[0] + w[1] * rt[1] + w[2] * rt[2]), (100 * (rt[0] + rt[1] + rt[2])) / 3], 0.6),
      ),
    text: ({ w, rt }) =>
      `An insurer's customers fall into three groups. Young drivers (${pct(w[0])} of customers) have an accident in a given year with probability ${pct(rt[0])}; middle-aged drivers (${pct(w[1])}) with probability ${pct(rt[1])}; and older drivers (${pct(w[2])}) with probability ${pct(rt[2])}. What is the probability that a randomly chosen customer has an accident this year? Give a percent, rounded to one decimal place.`,
    solve: ({ w, rt }) => 100 * (w[0] * rt[0] + w[1] * rt[1] + w[2] * rt[2]),
    wrong: { 'unweighted-average': ({ rt }) => (100 * (rt[0] + rt[1] + rt[2])) / 3 },
    hints: () => [
      "The three groups don't overlap and cover every customer.",
      "Weight each group's accident rate by the group's share of customers, then add.",
    ],
    worked: ({ w, rt }) => [
      {
        text: `Contributions: ${[0, 1, 2].map((i) => `${pct(w[i])} × ${pct(rt[i])} = ${pct(w[i] * rt[i])}`).join('; ')}.`,
        value: 100 * w[0] * rt[0],
        unit: '%',
      },
      {
        text: `Total: ${pct(w[0] * rt[0] + w[1] * rt[1] + w[2] * rt[2])}.`,
        value: 100 * (w[0] * rt[0] + w[1] * rt[1] + w[2] * rt[2]),
        unit: '%',
      },
    ],
  }),

  fixed({
    id: 'tp-disc-which-rule',
    kcs: [K, 'union-addition-rule'],
    capability: 'discriminate',
    params: (rng) => rng.pick(WHICH_RULE),
    text: ({ s }) => `${s} Which rule do you need?`,
    options: () => RULES,
    correct: ({ r }) => r,
    hints: () => [
      'Is the question about "or", "and", an overall rate across groups, or reversing a conditional?',
      '"Or" → addition; "both" → multiplication; an overall rate built from group rates → total probability; "given the result, which group did it come from?" → Bayes.',
    ],
  }),

  numeric({
    id: 'tp-transfer-solve-backwards',
    kcs: [K],
    transfer: true,
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({
          overall: r.pick([0.6, 0.7, 0.75, 0.8]),
          wa: r.pick([0.3, 0.4, 0.6]),
          pa: r.pick([0.5, 0.85, 0.9, 0.95]),
        }),
        ({ overall, wa, pa }) => {
          const pb = (overall - wa * pa) / (1 - wa);
          return (
            pb > 0.05 && pb < 0.98 && Math.abs(pb - pa) > 0.05 && spread([100 * pb, 100 * (2 * overall - pa)], 0.6)
          );
        },
      ),
    text: ({ overall, wa, pa }) =>
      `At a driving school, ${pct(overall)} of all students pass their test first time. Students who took the intensive course make up ${pct(wa)} of all students, and ${pct(pa)} of them pass first time. What percent of the other students pass first time? Round to one decimal place.`,
    solve: ({ overall, wa, pa }) => (100 * (overall - wa * pa)) / (1 - wa),
    wrong: { 'unweighted-average': ({ overall, pa }) => 100 * (2 * overall - pa) },
    hints: () => [
      "Write the overall pass rate as a weighted sum of the two groups' rates.",
      'You know everything in that equation except one rate. Solve for it.',
    ],
    worked: ({ overall, wa, pa }) => [
      { text: `${pct(overall)} = ${pct(wa)} × ${pct(pa)} + ${pct(1 - wa)} × x.`, value: 100 * overall, unit: '%' },
      {
        text: `Intensive students contribute ${pct(wa * pa)}, leaving ${pct(overall - wa * pa)} for the others.`,
        value: 100 * (overall - wa * pa),
        unit: '%',
      },
      {
        text: `x = ${pct(overall - wa * pa)} ÷ ${pct(1 - wa)} ≈ ${pct((overall - wa * pa) / (1 - wa), 1)}.`,
        value: (100 * (overall - wa * pa)) / (1 - wa),
        unit: '%',
      },
    ],
  }),
];

export default t;
