import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, DEC3, fmt, free, numeric, predict } from '../lib.ts';

const K = 'probability-axioms';

const FORECASTS = [
  [50, 40, 30],
  [60, 30, 20],
  [40, 30, 20],
  [30, 30, 20],
  [50, 30, 10],
  [45, 35, 30],
];
const MODELS = [
  {
    what: 'which phone plan a new customer chooses (each customer picks exactly one)',
    labels: ['Basic', 'Plus', 'Pro'],
  },
  { what: 'the colour of a traffic light when you arrive at it', labels: ['red', 'amber', 'green'] },
  { what: 'how many contacts it takes to resolve a support ticket', labels: ['one', 'two', 'three or more'] },
];
const show = (labels: string[], ps: number[]) => labels.map((l, i) => `${l}: ${fmt(ps[i])}`).join('; ');

const t: ItemTemplate[] = [
  free({
    id: 'pa-recall-rules',
    kcs: [K],
    capability: 'recall',
    text: () => 'State the basic rules that any set of probabilities must follow.',
    expect: {
      range: 'Every probability is between 0 and 1 (0% and 100%).',
      total: 'The probabilities of all the outcomes in the sample space add up to 1.',
      additive: "For events that can't happen together, P(A or B) = P(A) + P(B).",
    },
    reference: () =>
      'Each probability is between 0 and 1. The probabilities of all the outcomes in the sample space add up to exactly 1, since exactly one of them happens. And if two events cannot happen at the same time, the probability that one or the other happens is the sum of their probabilities.',
    hints: () => [
      'What is the smallest and largest a probability can be?',
      'If you add up the probabilities of every possible outcome, what must you get?',
    ],
  }),

  free({
    id: 'pa-explain-forecast',
    kcs: [K],
    capability: 'explain',
    params: (rng) => rng.pick(FORECASTS),
    text: ([a, b, c]) =>
      `A forecast says tomorrow will be sunny (${a}%), cloudy (${b}%) or rainy (${c}%), and treats these as the only possibilities, with exactly one of them happening. Explain why these numbers can't all be right, and what any valid set of numbers would have to satisfy.`,
    expect: {
      sum: "Notes that the three percentages don't add to 100%.",
      rule: 'States that probabilities of exhaustive, non-overlapping outcomes must add to exactly 100%.',
      fix: 'Says the numbers must be adjusted (or the categories allowed to overlap) to be consistent.',
    },
    reference: ([a, b, c]) =>
      `The three outcomes are presented as covering everything with no overlap, so exactly one happens and their probabilities must add to 100%. These add to ${a + b + c}%, so at least one number is wrong. Either the numbers must be rescaled to total 100%, or the categories must be redefined (for example, if "cloudy" and "rainy" can both happen, they are not exclusive and needn't add to 100%).`,
    hints: () => [
      'Add the three numbers.',
      'If exactly one of the outcomes must happen, what must their probabilities total?',
    ],
  }),

  predict({
    id: 'pa-predict-loaded-die',
    kcs: [K],
    params: (rng) => {
      const [f, g] = rng.shuffle([1, 2, 3, 4, 5, 6]);
      return { f, g, more: rng.next() < 0.5 };
    },
    text: ({ f, g, more }) =>
      `A die is altered so that ${f} comes up ${more ? 'more' : 'less'} often than 1/6 of the time. The other five faces stay equally likely to each other. Compared with a fair die, what happens to the probability of rolling a ${g}?`,
    answer: ({ more }) => (more ? 'down' : 'up'),
    miscon: () => ({ same: 'sum-not-one' }),
    hints: () => [
      'All six probabilities must still add up to 1.',
      'If one face takes a bigger (or smaller) share, what is left for the other five?',
    ],
  }),

  numeric({
    id: 'pa-apply-loaded-die',
    kcs: [K],
    unit: '',
    tol: DEC3,
    params: (rng) => ({ a: rng.pick([0.3, 0.35, 0.4, 0.5]), b: rng.pick([0.1, 0.15, 0.2]) }),
    text: ({ a, b }) =>
      `A loaded die has P(6) = ${fmt(a)} and P(5) = ${fmt(b)}. Faces 1, 2, 3 and 4 are equally likely to each other. What is P(1)? Give a decimal rounded to 3 places.`,
    solve: ({ a, b }) => (1 - a - b) / 4,
    wrong: { 'outcomes-equally-likely': () => 1 / 6 },
    hints: () => [
      'All six probabilities must add to 1.',
      'How much probability is left over for faces 1–4 together? Then share it equally.',
    ],
    worked: ({ a, b }) => [
      {
        text: `The six probabilities add to 1, so faces 1–4 share 1 − ${fmt(a)} − ${fmt(b)} = ${fmt(1 - a - b)}.`,
        value: 1 - a - b,
        unit: '',
      },
      {
        text: `They are equally likely, so P(1) = ${fmt(1 - a - b)} ÷ 4 = ${fmt((1 - a - b) / 4, 4)}.`,
        value: (1 - a - b) / 4,
        unit: '',
      },
    ],
  }),

  choice({
    id: 'pa-disc-valid-model',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => ({
      m: rng.pick(MODELS),
      ok: rng.pick([
        [0.5, 0.3, 0.2],
        [0.45, 0.1, 0.45],
        [0.6, 0.15, 0.25],
      ]),
      over: rng.pick([
        [0.5, 0.4, 0.3],
        [0.6, 0.3, 0.2],
      ]),
      under: rng.pick([
        [0.4, 0.3, 0.2],
        [0.3, 0.3, 0.2],
      ]),
      neg: rng.pick([
        [0.7, 0.4, -0.1],
        [1.2, -0.1, -0.1],
      ]),
    }),
    text: ({ m }) => `Which of these could be a valid probability model for ${m.what}?`,
    right: ({ m, ok }) => show(m.labels, ok),
    wrong: ({ m, over, under, neg }) => [
      [show(m.labels, over), 'sum-not-one'],
      [show(m.labels, under), 'sum-not-one'],
      show(m.labels, neg),
    ],
    hints: () => [
      'Check each list against two rules: every number between 0 and 1, and a total of exactly 1.',
      'Add up each list.',
    ],
  }),

  numeric({
    id: 'pa-transfer-survey',
    kcs: [K],
    transfer: true,
    unit: '%',
    tol: { abs: 0.2 },
    params: (rng) => ({ a: rng.pick([30, 35, 40, 45]), b: rng.pick([15, 20, 25]), r: rng.pick([2, 3, 4]) }),
    text: ({ a, b, r }) =>
      `In a survey, every respondent chose exactly one of four options. ${a}% chose A, ${b}% chose B, and option C was chosen ${r} times as often as option D. What percent chose D? Round to one decimal place.`,
    solve: ({ a, b, r }) => (100 - a - b) / (1 + r),
    hints: ({ r }) => [
      'The four percentages must add to 100%.',
      `If D gets x%, then C gets ${r}x%. How much do C and D share between them?`,
    ],
    worked: ({ a, b, r }) => [
      { text: `C and D together: 100% − ${a}% − ${b}% = ${100 - a - b}%.`, value: 100 - a - b, unit: '%' },
      {
        text: `If D = x, then C = ${r}x, so ${r + 1}x = ${100 - a - b}% and x = ${fmt((100 - a - b) / (1 + r), 2)}%.`,
        value: (100 - a - b) / (1 + r),
        unit: '%',
      },
    ],
  }),
];

export default t;
