import type { ItemTemplate } from '../../../../../shared/content.ts';
import { binomPmf, choose, fixed, fmt, free, numeric, PCT1, pct, predict, retry, spread, usd } from '../lib.ts';

const K = 'binomial';

const TRIALS = [
  {
    text: (n: number, k: number, p: number) =>
      `A basketball player makes each free throw with probability ${fmt(p)}, independently of her other shots. She takes ${n} free throws. What is the probability that she makes exactly ${k}?`,
  },
  {
    text: (n: number, k: number, p: number) =>
      `Each visitor to a landing page signs up with probability ${fmt(p)}, independently of the others. Out of ${n} visitors, what is the probability that exactly ${k} sign up?`,
  },
  {
    text: (n: number, k: number, p: number) =>
      `Each chip from a production line is defective with probability ${fmt(p)}, independently. In a sample of ${n} chips, what is the probability that exactly ${k} are defective?`,
  },
];

const MODELS = [
  "Yes, it's binomial",
  "No — the trials aren't independent (the chance changes from trial to trial)",
  "No — the number of trials isn't fixed in advance",
  "No — it isn't a count of successes in two-outcome trials",
];
const SITUATIONS = [
  { s: 'Count the heads in 10 flips of a fair coin.', a: 0 },
  {
    s: 'Phone 20 numbers chosen at random from a huge national list, and count how many people answer (each answers with the same chance).',
    a: 0,
  },
  { s: 'Deal 5 cards from one deck and count the hearts.', a: 1 },
  { s: 'Pick 4 people, without replacement, from a committee of 10 (6 women and 4 men), and count the women.', a: 1 },
  { s: 'Roll a die until you get a 6, and count the rolls.', a: 2 },
  { s: 'Roll a die 10 times and record how many times each face comes up.', a: 3 },
];

const atMostOne = (n: number, p: number) => (1 - p) ** n + n * p * (1 - p) ** (n - 1);

const t: ItemTemplate[] = [
  free({
    id: 'bin-recall-formula',
    kcs: [K],
    capability: 'recall',
    text: () => 'Write the binomial formula for P(X = k), and list the conditions needed to use it.',
    expect: {
      formula: 'P(X = k) = C(n, k) p^k (1 − p)^(n − k).',
      conditions:
        'A fixed number n of trials, each a success or failure, independent, with the same success probability p.',
      choose: 'C(n, k) counts the ways to choose which trials are the successes.',
    },
    reference: () =>
      'P(X = k) = C(n, k) p^k (1 − p)^(n − k). It applies when there is a fixed number n of trials, each one either a success or a failure, the trials are independent, and every trial has the same success probability p. p^k (1 − p)^(n − k) is the chance of one particular sequence; C(n, k) counts the sequences with exactly k successes.',
    hints: () => [
      'What is the chance of one particular sequence with k successes?',
      'How many such sequences are there?',
    ],
  }),

  free({
    id: 'bin-explain-arrangements',
    kcs: [K],
    capability: 'explain',
    params: (rng) => {
      const n = rng.pick([4, 5]);
      return { n, k: rng.int(2, n - 2) };
    },
    text: ({ n, k }) =>
      `Explain why the probability of exactly ${k} heads in ${n} fair coin flips is ${choose(n, k)}/${2 ** n}, not 1/${2 ** n}.`,
    expect: {
      one: 'Any one specific sequence (such as HHTT) has probability (1/2)^n.',
      many: 'There are C(n, k) different sequences with exactly k heads.',
      add: 'Those sequences are mutually exclusive, so their probabilities add.',
    },
    reference: ({ n, k }) =>
      `A specific sequence such as ${'H'.repeat(k)}${'T'.repeat(n - k)} has probability (1/2)^${n} = 1/${2 ** n}. But exactly ${k} heads can happen in C(${n}, ${k}) = ${choose(n, k)} different orders — any choice of which ${k} flips are heads. These sequences can't happen together, so their probabilities add: ${choose(n, k)}/${2 ** n}.`,
    hints: () => [
      'What is the probability of one particular sequence of heads and tails?',
      'Write out a few different sequences that have the right number of heads. How many are there?',
    ],
  }),

  predict({
    id: 'bin-predict-parameters',
    kcs: [K],
    params: (rng) => ({
      n: rng.pick([10, 20, 30]),
      p: rng.pick([0.1, 0.2, 0.3]),
      kind: rng.pick(['pUp', 'nUp', 'nDoubleHalf'] as const),
    }),
    text: ({ n, p, kind }) => {
      const [change, ask] =
        kind === 'pUp'
          ? [`p rises to ${fmt(p + 0.2)} (n unchanged)`, 'P(X = 0)']
          : kind === 'nUp'
            ? [`n rises to ${n + 10} (p unchanged)`, 'the expected count E[X]']
            : [`n doubles to ${2 * n} and p halves to ${fmt(p / 2)}`, 'the expected count E[X]'];
      return `X counts successes in n = ${n} independent trials, each with success probability p = ${fmt(p)}. Suppose ${change}. What happens to ${ask}?`;
    },
    answer: ({ kind }) => (kind === 'pUp' ? 'down' : kind === 'nUp' ? 'up' : 'same'),
    hints: () => ['P(X = 0) = (1 − p)^n, and E[X] = n × p.', 'Plug in the change and compare.'],
  }),

  numeric({
    id: 'bin-apply-exactly-k',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => {
          const n = r.int(4, 10);
          return { c: r.int(0, TRIALS.length - 1), n, k: r.int(1, n - 1), p: r.pick([0.1, 0.2, 0.3, 0.5, 0.7, 0.8]) };
        },
        ({ n, k, p }) =>
          binomPmf(n, k, p) >= 0.03 &&
          spread([100 * binomPmf(n, k, p), 100 * p ** k * (1 - p) ** (n - k), 100 / (n + 1)], 1),
      ),
    text: ({ c, n, k, p }) => `${TRIALS[c].text(n, k, p)} Give a percent, rounded to one decimal place.`,
    solve: ({ n, k, p }) => 100 * binomPmf(n, k, p),
    wrong: {
      'binomial-no-choose': ({ n, k, p }) => 100 * p ** k * (1 - p) ** (n - k),
      'outcomes-equally-likely': ({ n }) => 100 / (n + 1),
    },
    hints: () => [
      'What is the chance of one particular order of successes and failures?',
      'How many different orders give exactly this many successes?',
    ],
    worked: ({ n, k, p }) => [
      {
        text: `One particular order: ${fmt(p)}^${k} × ${fmt(1 - p)}^${n - k} ≈ ${fmt(p ** k * (1 - p) ** (n - k), 5)}.`,
        value: p ** k * (1 - p) ** (n - k),
        unit: '',
      },
      { text: `Number of orders: C(${n}, ${k}) = ${choose(n, k)}.`, value: choose(n, k), unit: '' },
      {
        text: `P(X = ${k}) = ${choose(n, k)} × ${fmt(p ** k * (1 - p) ** (n - k), 5)} ≈ ${pct(binomPmf(n, k, p), 1)}.`,
        value: 100 * binomPmf(n, k, p),
        unit: '%',
      },
    ],
  }),

  numeric({
    id: 'bin-apply-at-most-one',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) => ({ n: rng.int(5, 12), p: rng.pick([0.05, 0.1, 0.15, 0.2]) }),
    text: ({ n, p }) =>
      `A courier delivers ${n} parcels a day, and each one independently ends up late with probability ${pct(p)}. What is the probability that **at most one** parcel is late on a given day? Give a percent, rounded to one decimal place.`,
    solve: ({ n, p }) => 100 * atMostOne(n, p),
    wrong: { 'binomial-no-choose': ({ n, p }) => 100 * ((1 - p) ** n + p * (1 - p) ** (n - 1)) },
    hints: () => [
      '"At most one" means zero late or exactly one late.',
      'Exactly one late can happen in several ways — which parcel is the late one?',
    ],
    worked: ({ n, p }) => [
      { text: `P(0 late) = ${fmt(1 - p)}^${n} ≈ ${fmt((1 - p) ** n, 4)}.`, value: (1 - p) ** n, unit: '' },
      {
        text: `P(1 late) = ${n} × ${fmt(p)} × ${fmt(1 - p)}^${n - 1} ≈ ${fmt(n * p * (1 - p) ** (n - 1), 4)}.`,
        value: n * p * (1 - p) ** (n - 1),
        unit: '',
      },
      {
        text: `P(at most 1) ≈ ${fmt((1 - p) ** n, 4)} + ${fmt(n * p * (1 - p) ** (n - 1), 4)} ≈ ${pct(atMostOne(n, p), 1)}.`,
        value: 100 * atMostOne(n, p),
        unit: '%',
      },
    ],
  }),

  fixed({
    id: 'bin-disc-is-it-binomial',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => rng.pick(SITUATIONS),
    text: ({ s }) => `${s} Is the count binomial?`,
    options: ({ a }) =>
      MODELS.map((m, i) => (a === 1 && i === 0 ? ([m, 'multiply-dependent'] as [string, string]) : m)),
    correct: ({ a }) => a,
    hints: () => [
      'Check the four conditions: fixed n, two outcomes per trial, independence, same p every time.',
      'Does anything get "used up" from one trial to the next?',
    ],
  }),

  numeric({
    id: 'bin-transfer-expected-cost',
    kcs: [K, 'expected-value'],
    transfer: true,
    unit: '',
    tol: { abs: 0.01 },
    params: (rng) =>
      retry(
        rng,
        (r) => ({ n: r.pick([12, 15, 25, 30, 40]), p: r.pick([0.02, 0.05, 0.1, 0.15]), c: r.pick([20, 30, 50]) }),
        ({ n, p, c }) => Math.abs(n * p - Math.floor((n + 1) * p)) * c > 0.5,
      ),
    text: ({ n, p, c }) =>
      `A shop ships ${n} parcels, and each is lost independently with probability ${pct(p)}. Every lost parcel costs the shop ${usd(c)} to replace. What is the expected replacement cost, in dollars?`,
    solve: ({ n, p, c }) => n * p * c,
    wrong: { 'ev-is-most-likely': ({ n, p, c }) => Math.floor((n + 1) * p) * c },
    hints: () => [
      'First find the expected number of lost parcels.',
      'Each lost parcel costs the same, so scale the expected count.',
    ],
    worked: ({ n, p, c }) => [
      { text: `Expected number lost: n × p = ${n} × ${fmt(p)} = ${fmt(n * p)}.`, value: n * p, unit: '' },
      { text: `Expected cost: ${fmt(n * p)} × ${usd(c)} = ${usd(n * p * c)}.`, value: n * p * c, unit: '' },
    ],
  }),
];

export default t;
