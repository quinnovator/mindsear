import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, countDice, DEC3, fmt, free, numeric, predict, retry, spread } from '../lib.ts';

const K = 'random-variables';

const THIRDS = [
  {
    exp: 'flip two fair coins',
    x: 'the number of heads',
    probs: 'P(0) = 1/4, P(1) = 1/2, P(2) = 1/4',
    why: 'one head happens two ways (HT, TH) out of four equally likely outcomes',
  },
  {
    exp: 'roll two fair dice',
    x: 'the number of sixes',
    probs: 'P(0) = 25/36, P(1) = 10/36, P(2) = 1/36',
    why: 'no sixes covers 5 × 5 = 25 of the 36 equally likely pairs, exactly one six covers 10, and two sixes just 1',
  },
];

const RV_CHOICES = [
  {
    right: 'The number of defective items in a randomly chosen batch of 20',
    wrong: [
      'The event "the batch contains a defective item"',
      'The probability that a batch contains a defective item',
      'The list of all possible batches',
    ],
  },
  {
    right: 'The number of customers who arrive between 9 and 10 a.m. tomorrow',
    wrong: [
      'The event "more than 10 customers arrive"',
      'The probability that no customers arrive',
      'The list of customers who might arrive',
    ],
  },
  {
    right: 'The sum of two dice you are about to roll',
    wrong: ['The event "the sum is 7"', 'The probability that the sum is 7', 'The set of possible sums {2, 3, …, 12}'],
  },
];

const t: ItemTemplate[] = [
  free({
    id: 'rv-recall-definition',
    kcs: [K],
    capability: 'recall',
    text: () => 'What is a random variable, and what is its probability distribution?',
    expect: {
      num: 'A random variable assigns a number to each outcome of a random experiment.',
      dist: 'Its distribution lists each possible value together with its probability.',
      sum: 'Those probabilities add up to 1.',
    },
    reference: () =>
      'A random variable is a number determined by the outcome of a random experiment — for example, the number of heads in three flips. Its distribution lists each value it can take along with the probability of that value, and those probabilities add up to 1.',
    hints: () => [
      'Is a random variable an outcome, an event, or a number?',
      'What do you need to list to describe how it behaves?',
    ],
  }),

  free({
    id: 'rv-explain-not-uniform',
    kcs: [K],
    capability: 'explain',
    params: (rng) => rng.pick(THIRDS),
    text: (c) =>
      `You ${c.exp}, and X = ${c.x}. A classmate says X's distribution is 1/3 each for the values 0, 1 and 2. Explain the mistake and give the correct distribution.`,
    expect: {
      outcomes: 'Goes back to the equally likely basic outcomes of the experiment.',
      many: 'Notes that different outcomes give the same value, so the values get different probabilities.',
      correct: 'Gives the correct probabilities, which sum to 1.',
    },
    reference: (c) =>
      `The three values are not equally likely, because they come from different numbers of the equally likely basic outcomes: ${c.why}. So ${c.probs}.`,
    hints: () => [
      'List the equally likely basic outcomes of the experiment first.',
      'For each value of X, how many basic outcomes produce it?',
    ],
  }),

  predict({
    id: 'rv-predict-more-dice',
    kcs: [K],
    params: (rng) => ({ kind: rng.pick(['zeroSixes', 'maxSix', 'sumEven'] as const), n: rng.int(2, 4) }),
    text: ({ kind, n }) => {
      const [x, ev] =
        kind === 'zeroSixes'
          ? ['the number of sixes', 'P(X = 0)']
          : kind === 'maxSix'
            ? ['the largest number rolled', 'P(X = 6)']
            : ['the total of the dice', 'P(X is even)'];
      return `You roll ${n} fair dice, and X = ${x}. If you roll ${n + 1} dice instead, what happens to ${ev}?`;
    },
    answer: ({ kind }) => (kind === 'zeroSixes' ? 'down' : kind === 'maxSix' ? 'up' : 'same'),
    hints: () => ['Think about which outcomes give that value of X.', 'What does one more die do to those outcomes?'],
  }),

  numeric({
    id: 'rv-apply-missing-probability',
    kcs: [K],
    unit: '',
    tol: DEC3,
    params: (rng) =>
      retry(
        rng,
        (r) => ({ a: r.pick([0.3, 0.35, 0.4]), b: r.pick([0.25, 0.3]), d: r.pick([0.05, 0.1]), ge: r.next() < 0.5 }),
        ({ a, b, d, ge }) => {
          const two = 1 - a - b - d;
          return two >= 0.1 && spread([ge ? two + d : two, ge ? 0.5 : 0.25], 0.01);
        },
      ),
    text: ({ a, b, d, ge }) =>
      `A help desk records X = the number of complaints it receives in a day; it never gets more than 3. P(X = 0) = ${fmt(a)}, P(X = 1) = ${fmt(b)} and P(X = 3) = ${fmt(d)}. ${ge ? 'What is P(X ≥ 2)?' : 'What is P(X = 2)?'} Give a decimal.`,
    solve: ({ a, b, d, ge }) => (ge ? 1 - a - b : 1 - a - b - d),
    wrong: { 'outcomes-equally-likely': ({ ge }) => (ge ? 0.5 : 0.25) },
    hints: () => [
      'The probabilities of all the possible values must add to 1.',
      'Which values are possible? Which one is missing from the list?',
    ],
    worked: ({ a, b, d, ge }) => [
      {
        text: `P(X = 2) = 1 − (${fmt(a)} + ${fmt(b)} + ${fmt(d)}) = ${fmt(1 - a - b - d)}.`,
        value: 1 - a - b - d,
        unit: '',
      },
      ...(ge
        ? [
            {
              text: `P(X ≥ 2) = P(X = 2) + P(X = 3) = ${fmt(1 - a - b - d)} + ${fmt(d)} = ${fmt(1 - a - b)}.`,
              value: 1 - a - b,
              unit: '' as const,
            },
          ]
        : []),
    ],
  }),

  choice({
    id: 'rv-disc-which-is-rv',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => rng.pick(RV_CHOICES),
    text: () => 'Which of these is a random variable?',
    right: (c) => c.right,
    wrong: (c) => c.wrong,
    hints: () => [
      'A random variable is a number — but not a fixed one.',
      'Which option takes a numerical value that depends on how things turn out?',
    ],
  }),

  numeric({
    id: 'rv-transfer-max-min',
    kcs: [K, 'sample-spaces'],
    transfer: true,
    unit: '',
    tol: DEC3,
    params: (rng) => ({ max: rng.next() < 0.5, k: rng.int(1, 6) }),
    text: ({ max, k }) =>
      `Two fair dice are rolled, and X = the ${max ? 'larger' : 'smaller'} of the two numbers (if they are equal, X is that number). What is P(X = ${k})? Give a decimal rounded to 3 places.`,
    solve: ({ max, k }) => countDice((a, b) => (max ? Math.max(a, b) : Math.min(a, b)) === k) / 36,
    wrong: { 'outcomes-equally-likely': () => 1 / 6 },
    hints: () => [
      'There are 36 equally likely (first, second) pairs.',
      'Count the pairs whose larger (or smaller) number is exactly the value asked about.',
    ],
    worked: ({ max, k }) => {
      const n = countDice((a, b) => (max ? Math.max(a, b) : Math.min(a, b)) === k);
      return [
        {
          text: `Pairs with ${max ? 'larger' : 'smaller'} number exactly ${k}: ${n} of the 36 (${max ? `both ≤ ${k}, minus both ≤ ${k - 1}: ${k * k} − ${(k - 1) ** 2}` : `both ≥ ${k}, minus both ≥ ${k + 1}: ${(7 - k) ** 2} − ${(6 - k) ** 2}`}).`,
          value: n,
          unit: '',
        },
        { text: `P(X = ${k}) = ${n}/36 ≈ ${fmt(n / 36, 3)}.`, value: n / 36, unit: '' },
      ];
    },
  }),
];

export default t;
