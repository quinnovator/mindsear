import type { ItemTemplate } from '../../../../../shared/content.ts';
import { fixed, fmt, free, numeric, pct, predict, retry, spread, usd } from '../lib.ts';

const K = 'expected-value';
const CENTS = { abs: 0.01 };

const DISTS = [
  [0.1, 0.4, 0.3, 0.2],
  [0.2, 0.5, 0.2, 0.1],
  [0.4, 0.3, 0.2, 0.1],
  [0.1, 0.2, 0.3, 0.4],
  [0.15, 0.25, 0.45, 0.15],
  [0.05, 0.35, 0.4, 0.2],
];
const XS = [
  "the number of items in a customer's online order",
  'the number of goals a team scores in a match',
  'the number of support tickets a customer opens in a month',
];

const QUANTITY = [
  'The expected value of the distribution',
  'The most likely value (the mode)',
  'A probability from the distribution',
];
const QUESTIONS = [
  {
    s: 'A bakery wants to know how many loaves it sells on an average day, to plan a whole month of flour orders.',
    a: 0,
  },
  {
    s: 'An insurer wants the average claim cost per policy, to set a break-even price across thousands of policies.',
    a: 0,
  },
  { s: 'A bakery wants to know which daily sales number comes up most often.', a: 1 },
  { s: 'A bakery wants the chance that it sells more than 200 loaves tomorrow.', a: 2 },
];

const ev = (vals: number[], ps: number[]) => vals.reduce((s, v, i) => s + v * ps[i], 0);

const t: ItemTemplate[] = [
  free({
    id: 'ev-recall-formula',
    kcs: [K],
    capability: 'recall',
    text: () =>
      'Give the formula for the expected value of a discrete random variable X, and say what it means in the long run.',
    expect: {
      formula: 'E[X] = the sum of each value times its probability, Σ x × P(X = x).',
      longrun: 'It is the long-run average of X over many repetitions.',
      notMode: 'It need not be a possible value, and it is not the same as the most likely value.',
    },
    reference: () =>
      'E[X] = Σ x × P(X = x): multiply each possible value by its probability and add. It is the average you would get over many repetitions — for a die it is 3.5, which is not even a possible roll, and in general it is not the most likely value.',
    hints: () => [
      'Each value contributes in proportion to how likely it is.',
      'If you repeated the experiment many times, what would the average approach?',
    ],
  }),

  free({
    id: 'ev-explain-raffle',
    kcs: [K],
    capability: 'explain',
    params: (rng) => ({
      c: rng.pick([2, 5, 10]),
      prize: rng.pick([100, 500, 1000]),
      n: rng.pick([100, 200, 500, 1000]),
    }),
    text: ({ c, prize, n }) =>
      `A raffle ticket costs ${usd(c)}, and there is a 1 in ${fmt(n)} chance of winning ${usd(prize)} (no other prizes). Explain how to use expected value to judge whether the ticket is a good deal on average, and name one thing expected value doesn't tell you.`,
    expect: {
      compute:
        'Computes expected winnings as prize × probability and compares with the price (or computes the expected profit).',
      longrun: 'Interprets the expected value as the average result per ticket over many tickets.',
      limits: "Notes it doesn't describe a single ticket (you usually just lose the price) or how risky it is.",
    },
    reference: ({ c, prize, n }) =>
      `Expected winnings per ticket are ${usd(prize)} × 1/${fmt(n)} = ${usd(prize / n)}, so the expected profit is ${usd(prize / n)} − ${usd(c)} = ${usd(prize / n - c)} per ticket. That is the average over many tickets: ${prize / n > c ? 'on average you come out ahead' : prize / n < c ? 'on average you lose money' : 'on average you break even'}. It doesn't tell you what happens on one ticket — almost always you simply lose ${usd(c)} — nor how much the results vary.`,
    hints: () => [
      'What is the prize worth on average, per ticket?',
      'Compare that with the price. What does that average actually describe?',
    ],
  }),

  predict({
    id: 'ev-predict-game',
    kcs: [K],
    params: (rng) => ({
      w: rng.pick([10, 20, 50]),
      q: rng.pick([0.1, 0.2, 0.3]),
      l: rng.pick([1, 2, 5]),
      kind: rng.pick(['prizeUp', 'probDown', 'moreGames', 'lossUp'] as const),
    }),
    text: ({ w, q, l, kind }) => {
      const change =
        kind === 'prizeUp'
          ? `The prize rises to ${usd(2 * w)}.`
          : kind === 'probDown'
            ? `The chance of winning drops to ${pct(q / 2)}.`
            : kind === 'moreGames'
              ? 'You decide to play 100 times instead of 10.'
              : `The loss rises to ${usd(2 * l)}.`;
      return `In a game you win ${usd(w)} with probability ${pct(q)} and otherwise lose ${usd(l)}. ${change} What happens to the expected value of a single play?`;
    },
    answer: ({ kind }) => (kind === 'prizeUp' ? 'up' : kind === 'moreGames' ? 'same' : 'down'),
    hints: () => [
      'Expected value per play = (win × its probability) − (loss × its probability).',
      'Which term changes, and in which direction?',
    ],
  }),

  numeric({
    id: 'ev-apply-distribution',
    kcs: [K],
    unit: '',
    tol: CENTS,
    params: (rng) =>
      retry(
        rng,
        (r) => ({ x: r.pick(XS), v0: r.pick([0, 1]), ps: r.pick(DISTS) }),
        ({ v0, ps }) => {
          const vals = [0, 1, 2, 3].map((i) => v0 + i);
          const mode = vals[ps.indexOf(Math.max(...ps))];
          return spread([ev(vals, ps), mode, v0 + 1.5], 0.05);
        },
      ),
    text: ({ x, v0, ps }) =>
      `Let X = ${x}. Its distribution is: ${ps.map((p, i) => `P(X = ${v0 + i}) = ${fmt(p)}`).join(', ')}. What is the expected value E[X]? Give a decimal to two places.`,
    solve: ({ v0, ps }) =>
      ev(
        [0, 1, 2, 3].map((i) => v0 + i),
        ps,
      ),
    wrong: {
      'ev-is-most-likely': ({ v0, ps }) => v0 + ps.indexOf(Math.max(...ps)),
      'unweighted-average': ({ v0 }) => v0 + 1.5,
    },
    hints: () => [
      'Each value counts in proportion to its probability.',
      'Multiply each value by its probability, then add the results.',
    ],
    worked: ({ v0, ps }) => {
      const parts = ps.map((p, i) => (v0 + i) * p);
      return [
        {
          text: `Products: ${ps.map((p, i) => `${v0 + i} × ${fmt(p)} = ${fmt(parts[i])}`).join('; ')}.`,
          value: parts[parts.length - 1],
          unit: '',
        },
        {
          text: `E[X] = ${parts.map((v) => fmt(v)).join(' + ')} = ${fmt(
            ev(
              [0, 1, 2, 3].map((i) => v0 + i),
              ps,
            ),
          )}.`,
          value: ev(
            [0, 1, 2, 3].map((i) => v0 + i),
            ps,
          ),
          unit: '',
        },
      ];
    },
  }),

  numeric({
    id: 'ev-apply-carnival',
    kcs: [K],
    unit: '',
    tol: CENTS,
    params: (rng) => ({ c: rng.pick([1, 2, 5]), w: rng.pick([5, 10, 20, 50]), q: rng.pick([0.05, 0.1, 0.2, 0.25]) }),
    text: ({ c, w, q }) =>
      `A carnival game costs ${usd(c)} to play. With probability ${pct(q)} you receive ${usd(w)}; otherwise you receive nothing. What is your expected profit per play, in dollars? (Use a negative number if you lose money on average; round to the nearest cent.)`,
    solve: ({ c, w, q }) => q * w - c,
    wrong: { 'ev-is-most-likely': ({ c }) => -c, 'unweighted-average': ({ c, w }) => w / 2 - c },
    hints: () => ['Profit is what you receive minus what you paid.', 'What do you receive on average per play?'],
    worked: ({ c, w, q }) => [
      { text: `Expected payout: ${pct(q)} × ${usd(w)} = ${usd(q * w)}.`, value: q * w, unit: '' },
      { text: `Expected profit: ${usd(q * w)} − ${usd(c)} = ${usd(q * w - c)}.`, value: q * w - c, unit: '' },
    ],
  }),

  fixed({
    id: 'ev-disc-which-summary',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => rng.pick(QUESTIONS),
    text: ({ s }) => `${s} Which quantity answers this question?`,
    options: ({ a }) =>
      QUANTITY.map((q, i) =>
        (a === 0 && i === 1) || (a === 1 && i === 0) ? ([q, 'ev-is-most-likely'] as [string, string]) : q,
      ),
    correct: ({ a }) => a,
    hints: () => [
      'Is the question about an average, about the most common outcome, or about the chance of something?',
      'Planning over many days or policies uses the long-run average.',
    ],
  }),

  numeric({
    id: 'ev-transfer-guessing-penalty',
    kcs: [K, 'random-variables'],
    transfer: true,
    unit: '',
    tol: CENTS,
    params: (rng) => ({ k: rng.pick([4, 5]), pen: rng.pick([0.25, 0.5]), n: rng.pick([20, 40]) }),
    text: ({ k, pen, n }) =>
      `On a multiple-choice test, each question has ${k} options. A correct answer scores +1 and a wrong answer scores −${fmt(pen)}. If you guess completely at random on ${n} questions, what is your expected total score from those questions? Give a decimal.`,
    solve: ({ k, pen, n }) => n * (1 / k - (1 - 1 / k) * pen),
    wrong: { 'unweighted-average': ({ pen, n }) => (n * (1 - pen)) / 2 },
    hints: () => [
      'Start with one question: what are the two possible scores, and how likely is each?',
      'Expected values add up, so multiply the per-question expectation by the number of questions.',
    ],
    worked: ({ k, pen, n }) => [
      {
        text: `One question: E = (1/${k}) × 1 + (${k - 1}/${k}) × (−${fmt(pen)}) = ${fmt(1 / k - (1 - 1 / k) * pen, 4)}.`,
        value: 1 / k - (1 - 1 / k) * pen,
        unit: '',
      },
      {
        text: `${n} questions: ${n} × ${fmt(1 / k - (1 - 1 / k) * pen, 4)} = ${fmt(n * (1 / k - (1 - 1 / k) * pen), 2)}.`,
        value: n * (1 / k - (1 - 1 / k) * pen),
        unit: '',
      },
    ],
  }),
];

export default t;
