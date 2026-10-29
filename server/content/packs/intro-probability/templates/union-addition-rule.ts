import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, COUNT, DEC3, fmt, free, numeric, predict, retry } from '../lib.ts';

const K = 'union-addition-rule';

const CARDS = [
  { a: 'a heart', b: 'a king', na: 13, nb: 4, nab: 1, both: 'the king of hearts' },
  {
    a: 'a face card (jack, queen or king)',
    b: 'a spade',
    na: 12,
    nb: 13,
    nab: 3,
    both: 'the jack, queen and king of spades',
  },
  { a: 'a red card', b: 'an ace', na: 26, nb: 4, nab: 2, both: 'the two red aces' },
  { a: 'a club', b: 'a number card (2 to 10)', na: 13, nb: 36, nab: 9, both: 'the nine number cards in clubs' },
  { a: 'a diamond', b: 'a queen or a king', na: 13, nb: 8, nab: 2, both: 'the queen and king of diamonds' },
  {
    a: 'a black card',
    b: 'a face card (jack, queen or king)',
    na: 26,
    nb: 12,
    nab: 6,
    both: 'the six black face cards',
  },
];

const SCENARIOS = [
  { s: 'One roll of a die. A = "roll a 1", B = "roll a 6".', excl: true },
  { s: 'One card from a standard deck. A = "a heart", B = "a club".', excl: true },
  { s: 'A randomly chosen adult. A = "under 30 years old", B = "over 60 years old".', excl: true },
  { s: 'One roll of a die. A = "an even number", B = "a number greater than 3".', excl: false },
  { s: 'One card from a standard deck. A = "a heart", B = "a face card".', excl: false },
  { s: 'A randomly chosen patient. A = "has high blood pressure", B = "has diabetes".', excl: false },
];
const Y_EX = "Yes — A and B can't both happen, so nothing is counted twice";
const N_OV = 'No — A and B can happen together, so adding would count the overlap twice';
const Y_OR = 'Yes — "or" always means add';
const N_MUL = 'No — for "or" you multiply: P(A) × P(B)';

const t: ItemTemplate[] = [
  free({
    id: 'un-recall-rule',
    kcs: [K],
    capability: 'recall',
    text: () => 'Write the general addition rule for P(A or B). When can you leave out the last term?',
    expect: {
      formula: 'P(A or B) = P(A) + P(B) − P(A and B).',
      overlap: 'The subtracted term removes the double-counted overlap.',
      exclusive: 'The last term is zero (and can be dropped) only when A and B are mutually exclusive.',
    },
    reference: () =>
      'P(A or B) = P(A) + P(B) − P(A and B). Adding P(A) and P(B) counts the outcomes where both happen twice, so you subtract them once. If A and B cannot happen together, P(A and B) = 0 and the rule becomes plain addition.',
    hints: () => ['What goes wrong if you just add P(A) and P(B) when they overlap?', 'When is the overlap empty?'],
  }),

  free({
    id: 'un-explain-cards',
    kcs: [K],
    capability: 'explain',
    params: (rng) => rng.pick(CARDS),
    text: (c) =>
      `One card is drawn from a standard 52-card deck. Explain why P(${c.a} or ${c.b}) is not ${c.na}/52 + ${c.nb}/52, and give the correct value.`,
    expect: {
      double: 'Points out that some cards are both, and adding counts them twice.',
      subtract: 'Subtracts the overlap once: P(A) + P(B) − P(A and B).',
      value: 'Gets the right count of cards out of 52.',
    },
    reference: (c) =>
      `Some cards are both ${c.a} and ${c.b} — ${c.both} — so adding ${c.na} + ${c.nb} counts ${c.nab === 1 ? 'that card' : `those ${c.nab} cards`} twice. Subtract them once: (${c.na} + ${c.nb} − ${c.nab})/52 = ${c.na + c.nb - c.nab}/52 ≈ ${fmt((c.na + c.nb - c.nab) / 52, 3)}.`,
    hints: () => [
      'Are there any cards that fit both descriptions?',
      'How many times does such a card get counted if you just add?',
    ],
  }),

  predict({
    id: 'un-predict-overlap',
    kcs: [K],
    params: (rng) => ({
      kind: rng.pick(['overlapUp', 'overlapDown', 'aUp'] as const),
      a: rng.pick([40, 50, 60]),
      b: rng.pick([30, 35, 45]),
    }),
    text: ({ kind, a, b }) => {
      const change =
        kind === 'overlapUp'
          ? 'Next year both percentages stay the same, but more customers turn out to use both.'
          : kind === 'overlapDown'
            ? 'Next year both percentages stay the same, but fewer customers use both.'
            : 'Next year the app percentage rises, while the percentage who use both stays the same.';
      return `In a customer survey, ${a}% use a company's app and ${b}% use its website; some use both. ${change} What happens to the percentage who use at least one of the two?`;
    },
    answer: ({ kind }) => (kind === 'overlapUp' ? 'down' : 'up'),
    miscon: ({ kind }) => (kind === 'aUp' ? {} : { same: 'add-non-exclusive' }),
    hints: () => [
      'Write P(app or website) with the addition rule.',
      'Which term in the rule is changing, and with what sign?',
    ],
  }),

  numeric({
    id: 'un-apply-survey',
    kcs: [K],
    unit: '%',
    tol: COUNT,
    params: (rng) =>
      retry(
        rng,
        (r) => {
          const a = 5 * r.int(6, 14),
            b = 5 * r.int(4, 12);
          return { a, b, c: 5 * r.int(1, Math.min(a, b) / 5 - 1) };
        },
        ({ a, b, c }) => a + b - c <= 95,
      ),
    text: ({ a, b, c }) =>
      `In a customer survey, ${a}% use the company's app, ${b}% use its website, and ${c}% use both. What percent use the app or the website (at least one of them)?`,
    solve: ({ a, b, c }) => a + b - c,
    wrong: { 'add-non-exclusive': ({ a, b }) => a + b, 'and-or-confusion': ({ c }) => c },
    hints: () => [
      'Customers who use both appear in both percentages.',
      'Add the two percentages, then remove what was counted twice.',
    ],
    worked: ({ a, b, c }) => [
      {
        text: `Add the two groups: ${a}% + ${b}% = ${a + b}% (this counts the "both" group twice).`,
        value: a + b,
        unit: '%',
      },
      { text: `Subtract the overlap once: ${a + b}% − ${c}% = ${a + b - c}%.`, value: a + b - c, unit: '%' },
    ],
  }),

  numeric({
    id: 'un-apply-cards',
    kcs: [K],
    unit: '',
    tol: DEC3,
    params: (rng) => rng.pick(CARDS),
    text: (c) =>
      `One card is drawn from a well-shuffled standard 52-card deck. What is the probability that it is ${c.a} or ${c.b} (or both)? Give a decimal rounded to 3 places.`,
    solve: (c) => (c.na + c.nb - c.nab) / 52,
    wrong: { 'add-non-exclusive': (c) => (c.na + c.nb) / 52, 'and-or-confusion': (c) => (c.na / 52) * (c.nb / 52) },
    hints: () => ['Count the cards in each group.', 'Some cards belong to both groups. How many?'],
    worked: (c) => [
      { text: `Cards that are ${c.a}: ${c.na}. Cards that are ${c.b}: ${c.nb}.`, value: c.na + c.nb, unit: '' },
      {
        text: `Counted twice: ${c.both} (${c.nab}). Cards in the union: ${c.na} + ${c.nb} − ${c.nab} = ${c.na + c.nb - c.nab}.`,
        value: c.na + c.nb - c.nab,
        unit: '',
      },
      {
        text: `P = ${c.na + c.nb - c.nab}/52 ≈ ${fmt((c.na + c.nb - c.nab) / 52, 3)}.`,
        value: (c.na + c.nb - c.nab) / 52,
        unit: '',
      },
    ],
  }),

  choice({
    id: 'un-disc-can-you-add',
    kcs: [K, 'mutually-exclusive-vs-independent'],
    capability: 'discriminate',
    params: (rng) => rng.pick(SCENARIOS),
    text: ({ s }) => `${s} Can you find P(A or B) by simply adding P(A) + P(B)?`,
    right: ({ excl }) => (excl ? Y_EX : N_OV),
    wrong: ({ excl }) =>
      excl
        ? [N_OV, [Y_OR, 'add-non-exclusive'], [N_MUL, 'and-or-confusion']]
        : [
            [Y_EX, 'add-non-exclusive'],
            [Y_OR, 'add-non-exclusive'],
            [N_MUL, 'and-or-confusion'],
          ],
    hints: () => ['Can a single outcome satisfy both A and B here?', 'If one can, what happens to it when you add?'],
  }),

  numeric({
    id: 'un-transfer-bug-tags',
    kcs: [K, 'complements'],
    transfer: true,
    unit: '%',
    tol: COUNT,
    params: (rng) => {
      const total = rng.pick([200, 400, 500]);
      return {
        total,
        ui: total * rng.pick([0.3, 0.35, 0.4]),
        perf: total * rng.pick([0.2, 0.25]),
        both: total * rng.pick([0.05, 0.1]),
      };
    },
    text: ({ total, ui, perf, both }) =>
      `A team triaged ${total} bug reports: ${ui} were tagged "UI", ${perf} were tagged "performance", and ${both} of those had both tags. If you pick one of the ${total} reports at random, what is the probability that it has **neither** tag? Give a percent.`,
    solve: ({ total, ui, perf, both }) => (100 * (total - ui - perf + both)) / total,
    wrong: { 'add-non-exclusive': ({ total, ui, perf }) => (100 * (total - ui - perf)) / total },
    hints: () => [
      '"Neither" is the complement of "UI or performance".',
      'How many reports have at least one tag? Remember the reports with both tags.',
    ],
    worked: ({ total, ui, perf, both }) => [
      {
        text: `Reports with at least one tag: ${ui} + ${perf} − ${both} = ${ui + perf - both}.`,
        value: ui + perf - both,
        unit: '',
      },
      {
        text: `Reports with neither: ${total} − ${ui + perf - both} = ${total - ui - perf + both}.`,
        value: total - ui - perf + both,
        unit: '',
      },
      {
        text: `P(neither) = ${total - ui - perf + both}/${total} = ${fmt((100 * (total - ui - perf + both)) / total)}%.`,
        value: (100 * (total - ui - perf + both)) / total,
        unit: '%',
      },
    ],
  }),
];

export default t;
