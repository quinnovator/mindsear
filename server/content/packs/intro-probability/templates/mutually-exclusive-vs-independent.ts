import type { ItemTemplate } from '../../../../../shared/content.ts';
import { fixed, fmt, free, numeric, PCT1, pct, predict, retry } from '../lib.ts';

const K = 'mutually-exclusive-vs-independent';

const CLAIMS = [
  { setup: 'a single coin flip', a: 'getting heads', b: 'getting tails' },
  { setup: 'drawing one card from a deck', a: 'the card is a heart', b: 'the card is a spade' },
  { setup: 'a single medical test result', a: 'the result is positive', b: 'the result is negative' },
];

const CATS = ['Mutually exclusive', 'Independent', 'Neither', 'Both mutually exclusive and independent'];
type Cat = 'me' | 'ind' | 'neither';
const IDX: Record<Cat, number> = { me: 0, ind: 1, neither: 2 };
const catOptions = (kind: Cat) => [
  CATS[0],
  kind === 'me'
    ? ([CATS[1], 'exclusive-means-independent'] as [string, string])
    : kind === 'neither'
      ? ([CATS[1], 'multiply-dependent'] as [string, string])
      : CATS[1],
  CATS[2],
  [CATS[3], 'exclusive-means-independent'] as [string, string],
];

const PAIRS: { s: string; kind: Cat }[] = [
  { s: 'Roll one die. A = "the roll is a 1", B = "the roll is a 6".', kind: 'me' },
  { s: 'Flip a coin and roll a die. A = "the coin shows heads", B = "the die shows a 6".', kind: 'ind' },
  { s: 'Draw one card from a standard deck. A = "it is a heart", B = "it is a king".', kind: 'ind' },
  { s: 'Draw one card from a standard deck. A = "it is a heart", B = "it is a spade".', kind: 'me' },
  {
    s: 'Draw two cards from a standard deck without replacement. A = "the first card is an ace", B = "the second card is an ace".',
    kind: 'neither',
  },
  { s: 'Roll one die. A = "the roll is even", B = "the roll is 1 or 2".', kind: 'ind' },
  { s: 'Roll one die. A = "the roll is even", B = "the roll is greater than 3".', kind: 'neither' },
  { s: 'Roll one die. A = "the roll is odd", B = "the roll is 4 or 6".', kind: 'me' },
];

const t: ItemTemplate[] = [
  free({
    id: 'mei-recall-definitions',
    kcs: [K],
    capability: 'recall',
    text: () =>
      'Define "mutually exclusive" and "independent" for two events A and B, giving the formula that goes with each.',
    expect: {
      me: 'Mutually exclusive: A and B cannot both happen, so P(A and B) = 0.',
      ind: "Independent: knowing one happened doesn't change the other's probability, so P(A and B) = P(A) × P(B) (or P(A | B) = P(A)).",
    },
    reference: () =>
      'A and B are mutually exclusive if they cannot happen together: P(A and B) = 0. They are independent if knowing that one happened does not change the probability of the other: P(A | B) = P(A), equivalently P(A and B) = P(A) × P(B).',
    hints: () => [
      'One idea is about overlap; the other is about information.',
      'Which one makes P(A and B) zero, and which one makes it a product?',
    ],
  }),

  free({
    id: 'mei-explain-exclusive-dependent',
    kcs: [K],
    capability: 'explain',
    params: (rng) => rng.pick(CLAIMS),
    text: (c) =>
      `A student says: "In ${c.setup}, the events '${c.a}' and '${c.b}' are mutually exclusive, so they must be independent." Explain why this is wrong.`,
    expect: {
      info: "If one happens the other definitely can't, so learning one changes the other's probability to 0 — they are dependent.",
      formula: 'Independence would need P(A and B) = P(A) × P(B) > 0, but here P(A and B) = 0.',
      general: 'Mutually exclusive events with positive probabilities are never independent.',
    },
    reference: (c) =>
      `Mutually exclusive means they can't both happen. So once you know "${c.a}" happened, the probability of "${c.b}" drops to 0 — the events carry information about each other, which is the opposite of independence. Formally, independence needs P(A and B) = P(A) × P(B), which is positive here, but exclusivity makes P(A and B) = 0. Exclusive events with nonzero probabilities are always dependent.`,
    hints: () => [
      'Suppose you learn that the first event happened. What is the chance of the second now?',
      'Independence means that knowledge changes nothing. Does it?',
    ],
  }),

  predict({
    id: 'mei-predict-learn-a',
    kcs: [K],
    params: (rng) => ({
      kind: rng.pick(['meA', 'indA', 'meNotA'] as const),
      a: rng.pick([0.2, 0.3, 0.4]),
      b: rng.pick([0.1, 0.2, 0.3]),
    }),
    text: ({ kind, a, b }) =>
      `Events A and B have P(A) = ${pct(a)} and P(B) = ${pct(b)}. They are ${kind === 'indA' ? 'independent' : 'mutually exclusive'}. You learn that A ${kind === 'meNotA' ? 'did **not** happen' : 'happened'}. What happens to your probability for B?`,
    answer: ({ kind }) => (kind === 'meA' ? 'down' : kind === 'indA' ? 'same' : 'up'),
    miscon: ({ kind }) =>
      kind === 'indA' ? { down: 'exclusive-means-independent' } : { same: 'exclusive-means-independent' },
    hints: () => [
      'Can A and B happen together?',
      'Once you know about A, which outcomes are still possible, and how much of that is B?',
    ],
  }),

  fixed({
    id: 'mei-apply-classify-numbers',
    kcs: [K],
    capability: 'apply',
    params: (rng) =>
      retry(
        rng,
        (r) => {
          const a = r.pick([0.2, 0.3, 0.4, 0.5]),
            b = r.pick([0.1, 0.2, 0.3, 0.6]);
          const kind = r.pick(['me', 'ind', 'neither'] as const);
          const ab = kind === 'me' ? 0 : kind === 'ind' ? a * b : r.pick([0.05, 0.1, 0.15]);
          return { a, b, kind, ab };
        },
        ({ a, b, kind, ab }) =>
          ab <= Math.min(a, b) && a + b - ab <= 1 && (kind !== 'neither' || Math.abs(ab - a * b) > 0.01),
      ),
    text: ({ a, b, ab }) => `P(A) = ${pct(a)}, P(B) = ${pct(b)} and P(A and B) = ${pct(ab)}. Which describes A and B?`,
    options: ({ kind }) => catOptions(kind),
    correct: ({ kind }) => IDX[kind],
    hints: () => [
      'Mutually exclusive is a test on P(A and B) alone.',
      'Independent means P(A and B) equals P(A) × P(B). Compute the product and compare.',
    ],
    worked: ({ a, b, ab }) => [
      {
        text: `Is P(A and B) zero? It is ${pct(ab)}, so they ${ab === 0 ? 'are' : 'are not'} mutually exclusive.`,
        value: ab,
        unit: '',
      },
      {
        text: `P(A) × P(B) = ${fmt(a)} × ${fmt(b)} = ${fmt(a * b, 4)}, which ${Math.abs(a * b - ab) < 1e-9 ? 'equals' : 'does not equal'} P(A and B) = ${fmt(ab, 4)}, so they ${Math.abs(a * b - ab) < 1e-9 ? 'are' : 'are not'} independent.`,
        value: a * b,
        unit: '',
      },
    ],
  }),

  fixed({
    id: 'mei-disc-scenarios',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => rng.pick(PAIRS),
    text: ({ s }) => `${s} Which describes A and B?`,
    options: ({ kind }) => catOptions(kind),
    correct: ({ kind }) => IDX[kind],
    hints: () => [
      'First ask: can A and B both happen on the same occasion?',
      'Then ask: if you learn A happened, does the chance of B change?',
    ],
  }),

  numeric({
    id: 'mei-transfer-sensors',
    kcs: [K, 'union-addition-rule', 'independence'],
    transfer: true,
    unit: '%',
    tol: PCT1,
    params: (rng) => ({ a: 5 * rng.int(2, 12), b: 5 * rng.int(2, 12) }),
    text: ({ a, b }) =>
      `Two motion sensors guard a door. During an intrusion, sensor 1 triggers with probability ${a}% and sensor 2 with probability ${b}%, independently of each other. What is the probability that at least one of them triggers? Give a percent, rounded to one decimal place.`,
    solve: ({ a, b }) => a + b - (a * b) / 100,
    wrong: { 'add-non-exclusive': ({ a, b }) => a + b },
    hints: () => [
      'Independent is not the same as mutually exclusive: can both sensors trigger?',
      'Use the addition rule, with P(both) from independence.',
    ],
    worked: ({ a, b }) => [
      { text: `P(both) = ${a}% × ${b}% = ${fmt((a * b) / 100)}% (independent).`, value: (a * b) / 100, unit: '%' },
      {
        text: `P(at least one) = ${a}% + ${b}% − ${fmt((a * b) / 100)}% = ${fmt(a + b - (a * b) / 100)}%.`,
        value: a + b - (a * b) / 100,
        unit: '%',
      },
    ],
  }),
];

export default t;
