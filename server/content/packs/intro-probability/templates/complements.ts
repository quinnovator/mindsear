import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, choose, fmt, free, numeric, PCT1, pct, predict } from '../lib.ts';

const K = 'complements';

const AT_LEAST = [
  { noun: 'emails', clause: 'is a phishing attempt' },
  { noun: 'parts from the line', clause: 'is defective' },
  { noun: 'website visitors', clause: 'reports a bug' },
];

const COMPLEMENTS = [
  {
    e: 'at least one of the 5 parts is defective',
    right: 'none of the 5 parts is defective',
    wc: ['all 5 parts are defective', 'at least one of the 5 parts is not defective'],
    other: 'exactly one of the 5 parts is defective',
  },
  {
    e: 'at least 2 heads in 5 flips',
    right: 'at most 1 head in 5 flips',
    wc: ['at most 2 heads in 5 flips', 'at least 2 tails in 5 flips'],
    other: 'exactly 1 head in 5 flips',
  },
  {
    e: 'it rains on every day of the week',
    right: 'at least one day of the week is dry',
    wc: ['it rains on no day of the week', 'it rains on exactly six days of the week'],
    other: 'it rains on at least one day of the week',
  },
  {
    e: 'the password is guessed within 3 attempts',
    right: 'all of the first 3 attempts fail',
    wc: ['all of the first 3 attempts succeed', 'at least one of the first 3 attempts fails'],
    other: 'the password is guessed on the 4th attempt',
  },
];

const allDifferent = (n: number) => {
  let q = 1;
  for (let i = 0; i < n; i++) q *= (12 - i) / 12;
  return q;
};

const t: ItemTemplate[] = [
  free({
    id: 'co-recall-rule',
    kcs: [K],
    capability: 'recall',
    text: () =>
      'Write the complement rule for P(not A). Then describe the complement of the event "at least one of the parts is defective".',
    expect: {
      rule: 'P(not A) = 1 − P(A).',
      meaning: 'The complement is every outcome where A does not happen.',
      atleast: 'The complement of "at least one defective" is "no parts defective".',
    },
    reference: () =>
      'P(not A) = 1 − P(A), because A and "not A" cover every outcome without overlapping. The complement of "at least one part is defective" is "none of the parts is defective".',
    hints: () => [
      'A and "not A" together cover everything. What do their probabilities add to?',
      'When does "at least one defective" fail to happen?',
    ],
  }),

  free({
    id: 'co-explain-at-least-one-six',
    kcs: [K],
    capability: 'explain',
    params: (rng) => ({ n: rng.pick([3, 4, 5, 6]) }),
    text: ({ n }) =>
      `Explain how to find the probability of rolling **at least one six** in ${n} rolls of a fair die, and why working with the complement is easier than adding up cases. Also say why ${n} × 1/6 is wrong.`,
    expect: {
      complement: 'Uses the complement: "at least one six" fails only if there are no sixes at all.',
      product: 'Computes P(no sixes) as (5/6) multiplied once per roll, using independence of the rolls.',
      why: 'Explains that adding 1/6 per roll double-counts outcomes with more than one six (and can exceed 1).',
    },
    reference: ({ n }) =>
      `The complement of "at least one six" is "no sixes". Rolls are independent, so P(no sixes) = (5/6)^${n} ≈ ${fmt((5 / 6) ** n, 3)}, and P(at least one six) = 1 − (5/6)^${n} ≈ ${fmt(1 - (5 / 6) ** n, 3)}. Adding 1/6 for each roll gives ${n}/6, which counts outcomes with two or more sixes several times; with 6 or more rolls it would even reach 1 or more, which is impossible.`,
    hints: () => [
      'What is the only way to get no six at all?',
      'How do you combine the chances of independent rolls each missing a six?',
    ],
  }),

  predict({
    id: 'co-predict-servers',
    kcs: [K],
    params: (rng) => ({
      kind: rng.pick(['add', 'remove', 'worse', 'better'] as const),
      n: rng.pick([2, 3, 4]),
      q: rng.pick([10, 20, 30]),
    }),
    text: ({ kind, n, q }) => {
      const change =
        kind === 'add'
          ? 'You add one more server of the same kind.'
          : kind === 'remove'
            ? 'You remove one of the servers.'
            : kind === 'worse'
              ? `Each server's daily failure probability rises to ${q + 10}%.`
              : `Each server's daily failure probability drops to ${q - 5}%.`;
      return `A website runs on ${n} servers. Each fails on a given day with probability ${q}%, independently of the others, and the site stays up as long as **at least one** server works. ${change} What happens to the probability that the site stays up all day?`;
    },
    answer: ({ kind }) => (kind === 'add' || kind === 'better' ? 'up' : 'down'),
    hints: () => [
      'The site goes down only if every server fails.',
      'How does the chance that all servers fail change?',
    ],
  }),

  numeric({
    id: 'co-apply-at-least-one',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) => ({ c: rng.pick(AT_LEAST), n: rng.int(3, 8), p: rng.pick([0.05, 0.1, 0.15, 0.2]) }),
    text: ({ c, n, p }) =>
      `Each of ${n} ${c.noun} independently has a ${pct(p)} chance that it ${c.clause}. What is the probability that **at least one** of them ${c.clause}? Give a percent, rounded to one decimal place.`,
    solve: ({ n, p }) => 100 * (1 - (1 - p) ** n),
    wrong: {
      'add-non-exclusive': ({ n, p }) => 100 * n * p,
      'wrong-complement': ({ n, p }) => 100 * (1 - p ** n),
    },
    hints: () => [
      'What is the opposite of "at least one"?',
      'Find the chance that none of them do it, using independence.',
      'Then subtract that from 100%.',
    ],
    worked: ({ n, p }) => [
      { text: `P(a single one does not) = 1 − ${fmt(p)} = ${fmt(1 - p)}.`, value: 1 - p, unit: '' },
      {
        text: `P(none of the ${n}) = ${fmt(1 - p)}^${n} ≈ ${fmt((1 - p) ** n, 4)} (independence).`,
        value: (1 - p) ** n,
        unit: '',
      },
      {
        text: `P(at least one) = 1 − ${fmt((1 - p) ** n, 4)} ≈ ${pct(1 - (1 - p) ** n, 1)}.`,
        value: 100 * (1 - (1 - p) ** n),
        unit: '%',
      },
    ],
  }),

  choice({
    id: 'co-disc-which-complement',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => rng.pick(COMPLEMENTS),
    text: (c) => `What is the complement of the event "${c.e}"?`,
    right: (c) => c.right,
    wrong: (c) => [[c.wc[0], 'wrong-complement'], [c.wc[1], 'wrong-complement'], c.other],
    hints: () => [
      'The complement must contain every outcome where the event fails — and nothing else.',
      'Check: the event and its complement together must cover everything, with no overlap.',
    ],
  }),

  numeric({
    id: 'co-transfer-birth-months',
    kcs: [K, 'multiplication-rule'],
    transfer: true,
    unit: '%',
    tol: PCT1,
    params: (rng) => ({ n: rng.pick([3, 4, 5, 6]) }),
    text: ({ n }) =>
      `${n} people are chosen at random. Assume each person's birth month is equally likely to be any of the 12 months, independently of the others. What is the probability that **at least two** of them share a birth month? Give a percent, rounded to one decimal place.`,
    solve: ({ n }) => 100 * (1 - allDifferent(n)),
    wrong: { 'add-non-exclusive': ({ n }) => (100 * choose(n, 2)) / 12 },
    hints: () => [
      'What is the complement of "at least two share a month"?',
      'Find the chance that all the months are different, one person at a time.',
    ],
    worked: ({ n }) => [
      {
        text: `P(all different) = ${Array.from({ length: n }, (_, i) => `${12 - i}/12`).join(' × ')} ≈ ${fmt(allDifferent(n), 4)}.`,
        value: allDifferent(n),
        unit: '',
      },
      {
        text: `P(at least two share) = 1 − ${fmt(allDifferent(n), 4)} ≈ ${pct(1 - allDifferent(n), 1)}.`,
        value: 100 * (1 - allDifferent(n)),
        unit: '%',
      },
    ],
  }),
];

export default t;
