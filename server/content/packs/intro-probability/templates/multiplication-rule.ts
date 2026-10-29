import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, fmt, free, numeric, PCT1, pct, predict } from '../lib.ts';

const K = 'multiplication-rule';

const KINDS = [
  { name: 'aces', k: 4 },
  { name: 'kings', k: 4 },
  { name: 'hearts', k: 13 },
  { name: 'spades', k: 13 },
];

const t: ItemTemplate[] = [
  free({
    id: 'mul-recall-rule',
    kcs: [K],
    capability: 'recall',
    text: () =>
      'State the general multiplication rule for P(A and B), and its simpler form when A and B are independent.',
    expect: {
      general: 'P(A and B) = P(A) × P(B | A).',
      indep: 'If A and B are independent, P(A and B) = P(A) × P(B).',
    },
    reference: () =>
      'In general P(A and B) = P(A) × P(B | A): the chance of A, times the chance of B once A has happened. When A and B are independent, P(B | A) = P(B), so P(A and B) = P(A) × P(B).',
    hints: () => [
      'The second factor is a conditional probability.',
      'What does independence let you replace P(B | A) with?',
    ],
  }),

  free({
    id: 'mul-explain-without-replacement',
    kcs: [K],
    capability: 'explain',
    params: (rng) => rng.pick(KINDS),
    text: ({ name, k }) =>
      `Explain why the probability of drawing two ${name} in a row from a standard 52-card deck, **without** putting the first card back, is not (${k}/52) × (${k}/52). What is the correct calculation?`,
    expect: {
      update:
        'After the first draw there is one fewer of that kind and 51 cards left, so the second probability changes.',
      rule: 'Uses P(A and B) = P(A) × P(B | A).',
      indep: 'Notes that the squared version is only right with replacement (independent draws).',
    },
    reference: ({ name, k }) =>
      `The draws are not independent: once the first card is one of the ${name}, only ${k - 1} of them remain among 51 cards. So P(both) = P(first) × P(second | first) = ${k}/52 × ${k - 1}/51 ≈ ${fmt((k / 52) * ((k - 1) / 51), 4)}. (${k}/52)² would be right only if the first card were put back and the deck reshuffled.`,
    hints: () => [
      'After the first card is drawn, what is in the deck?',
      'Which probability changes for the second draw?',
    ],
  }),

  predict({
    id: 'mul-predict-dependence',
    kcs: [K],
    params: (rng) => ({ kind: rng.pick(['noReplace', 'sharedPower', 'condUp'] as const) }),
    text: ({ kind }) =>
      kind === 'noReplace'
        ? 'A bag has 5 red and 5 blue balls, and you draw two. Switch from drawing with replacement to drawing without replacement. What happens to P(both red)?'
        : kind === 'sharedPower'
          ? 'Two servers each fail on 2% of days. An engineer first assumes they fail independently, then learns they share a power supply, so when one fails the other is more likely to fail too. Compared with the independent estimate, what happens to P(both fail on the same day)?'
          : 'For two events, P(A) stays fixed but P(B | A) increases. What happens to P(A and B)?',
    answer: ({ kind }) => (kind === 'noReplace' ? 'down' : 'up'),
    miscon: ({ kind }) => (kind === 'condUp' ? {} : { same: 'multiply-dependent' }),
    hints: () => ['Write P(both) as P(first) × P(second | first).', 'Which factor changes, and in which direction?'],
  }),

  numeric({
    id: 'mul-apply-two-dead-batteries',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) => ({ n: rng.pick([10, 12, 15, 20]), d: rng.int(3, 6) }),
    text: ({ n, d }) =>
      `A box contains ${n} batteries, ${d} of which are dead. You take two at random, one after the other, without putting the first back. What is the probability that **both** are dead? Give a percent, rounded to one decimal place.`,
    solve: ({ n, d }) => (100 * d * (d - 1)) / (n * (n - 1)),
    wrong: { 'multiply-dependent': ({ n, d }) => 100 * (d / n) ** 2 },
    hints: () => [
      'What is the chance the first battery is dead?',
      'Given the first was dead, how many dead batteries and how many batteries are left?',
    ],
    worked: ({ n, d }) => [
      { text: `P(first dead) = ${d}/${n}.`, value: d / n, unit: '' },
      { text: `P(second dead | first dead) = ${d - 1}/${n - 1}.`, value: (d - 1) / (n - 1), unit: '' },
      {
        text: `P(both) = ${d}/${n} × ${d - 1}/${n - 1} = ${d * (d - 1)}/${n * (n - 1)} ≈ ${pct((d * (d - 1)) / (n * (n - 1)), 1)}.`,
        value: (100 * d * (d - 1)) / (n * (n - 1)),
        unit: '%',
      },
    ],
  }),

  numeric({
    id: 'mul-apply-funnel',
    kcs: [K, 'conditional-probability'],
    unit: '%',
    tol: PCT1,
    params: (rng) => ({ a: rng.pick([20, 25, 30, 40, 50, 60]), b: rng.pick([10, 20, 25, 30, 40, 50]) }),
    text: ({ a, b }) =>
      `In an online shop, ${a}% of visitors add something to their cart. Of the visitors who add something, ${b}% go on to buy. Every buyer adds something to their cart first. What percent of all visitors buy? Round to one decimal place.`,
    solve: ({ a, b }) => (a * b) / 100,
    wrong: { 'conditional-as-joint': ({ b }) => b },
    hints: () => [
      'Is the second percentage a share of all visitors, or of a smaller group?',
      'P(cart and buy) = P(cart) × P(buy | cart).',
    ],
    worked: ({ a, b }) => [
      { text: `P(cart) = ${a}%, and P(buy | cart) = ${b}%.`, value: b, unit: '%' },
      { text: `P(buy) = P(cart and buy) = ${a}% × ${b}% = ${fmt((a * b) / 100)}%.`, value: (a * b) / 100, unit: '%' },
    ],
  }),

  choice({
    id: 'mul-disc-which-calculation',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => ({ ...rng.pick(KINDS), repl: rng.next() < 0.5 }),
    text: ({ name, repl }) =>
      `Two cards are drawn from a standard 52-card deck, ${repl ? 'putting the first card back and reshuffling before the second draw' : 'without putting the first card back'}. Which calculation gives P(both cards are ${name})?`,
    right: ({ k, repl }) => (repl ? `${k}/52 × ${k}/52` : `${k}/52 × ${k - 1}/51`),
    wrong: ({ k, repl }) => [
      repl ? `${k}/52 × ${k - 1}/51` : [`${k}/52 × ${k}/52`, 'multiply-dependent'],
      [`${k}/52 + ${k}/52`, 'and-or-confusion'],
      [`${k}/52 + ${k - 1}/51`, 'and-or-confusion'],
    ],
    hints: () => [
      '"Both" means A and B: add or multiply?',
      'Does the first draw change what is in the deck for the second?',
    ],
  }),

  numeric({
    id: 'mul-transfer-keys',
    kcs: [K, 'complements'],
    transfer: true,
    unit: '%',
    tol: PCT1,
    params: (rng) => {
      const n = rng.pick([5, 6, 8, 10, 12]);
      return { n, k: rng.int(2, Math.min(4, n - 2)) };
    },
    text: ({ n, k }) =>
      `A key ring holds ${n} similar-looking keys, and exactly one of them opens the door. You try keys in random order, never retrying a key that failed. What is the probability that the door opens within your first ${k} tries? Give a percent, rounded to one decimal place.`,
    solve: ({ n, k }) => (100 * k) / n,
    wrong: { 'multiply-dependent': ({ n, k }) => 100 * (1 - (1 - 1 / n) ** k) },
    hints: () => [
      'Find the chance that all of the first tries fail, then use the complement.',
      'Each failed key is set aside, so the number of keys left shrinks by one every try.',
    ],
    worked: ({ n, k }) => [
      {
        text: `P(first ${k} all fail) = ${Array.from({ length: k }, (_, i) => `${n - 1 - i}/${n - i}`).join(' × ')} = ${n - k}/${n}.`,
        value: (n - k) / n,
        unit: '',
      },
      {
        text: `P(opens within ${k}) = 1 − ${n - k}/${n} = ${k}/${n} ≈ ${pct(k / n, 1)}.`,
        value: (100 * k) / n,
        unit: '%',
      },
    ],
  }),
];

export default t;
