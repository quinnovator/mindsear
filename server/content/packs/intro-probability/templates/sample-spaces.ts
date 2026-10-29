import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, choose, countDice, DEC3, DICE, fmt, free, numeric, predict } from '../lib.ts';

const K = 'sample-spaces';

const unorderedSum = (s: number): number => {
  let c = 0;
  for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) if (a + b === s) c++;
  return c;
};

const PAIRS = [
  {
    exp: 'flip two fair coins',
    a: 'two heads',
    b: 'two tails',
    mixed: 'one head and one tail',
    list: 'HH, HT, TH, TT',
  },
  {
    exp: 'have two children (each equally likely to be a boy or a girl, independently)',
    a: 'two boys',
    b: 'two girls',
    mixed: 'one boy and one girl',
    list: 'BB, BG, GB, GG (oldest child first)',
  },
];

const SPACES = [
  {
    exp: 'flipping a fair coin twice',
    ok: '{HH, HT, TH, TT}',
    unordered: '{HH, HT, TT}',
    overlap: '{HH, TT, at least one head}',
    short: '{H, T}',
  },
  {
    exp: "the sexes of a family's two children, oldest first (each child equally likely to be a boy or a girl, independently)",
    ok: '{BB, BG, GB, GG}',
    unordered: '{BB, BG, GG}',
    overlap: '{BB, GG, at least one girl}',
    short: '{B, G}',
  },
  {
    exp: 'testing two light bulbs that each pass (P) or fail (F) with probability 1/2, independently',
    ok: '{PP, PF, FP, FF}',
    unordered: '{PP, PF, FF}',
    overlap: '{PP, FF, at least one pass}',
    short: '{PP, FF}',
  },
];

const t: ItemTemplate[] = [
  free({
    id: 'ss-recall-definitions',
    kcs: [K],
    capability: 'recall',
    text: () =>
      'In your own words: what is a **sample space**, and what is an **event**? Give a small example of each for a single roll of a die.',
    expect: {
      exhaustive: 'A sample space lists every possible outcome of the experiment.',
      exclusive: 'The outcomes do not overlap: exactly one of them happens each time.',
      event: 'An event is a set (subset) of outcomes from the sample space, e.g. "even" = {2, 4, 6}.',
    },
    reference: () =>
      'The sample space is the complete list of possible outcomes, arranged so exactly one occurs each time; for one die roll it is {1, 2, 3, 4, 5, 6}. An event is any collection of those outcomes, such as "roll an even number" = {2, 4, 6}.',
    hints: () => [
      'Before rolling, what could you write down that covers every possible result?',
      'An event either happens or not on a given roll. Which outcomes make "even" happen?',
    ],
  }),

  free({
    id: 'ss-explain-three-cases',
    kcs: [K],
    capability: 'explain',
    params: (rng) => rng.pick(PAIRS),
    text: (c) =>
      `A friend says: "When you ${c.exp}, there are three possibilities — ${c.a}, ${c.b}, or ${c.mixed} — so the chance of ${c.mixed} is 1/3." Explain what is wrong, and give the correct probability.`,
    expect: {
      ordered: 'Lists the four equally likely ordered outcomes.',
      unequal: 'Explains the three listed cases are not equally likely: the mixed result can happen in two ways.',
      answer: 'Gives the correct probability, 2/4 = 1/2.',
    },
    reference: (c) =>
      `The three cases are a valid list, but they are not equally likely, so you cannot just count them. The equally likely outcomes are ${c.list}. ${c.mixed[0].toUpperCase() + c.mixed.slice(1)} happens in two of the four (in either order), so its probability is 2/4 = 1/2, while ${c.a} and ${c.b} are 1/4 each.`,
    hints: () => [
      'Label the two items "first" and "second". How many different results can you write down?',
      'Is "one of each" a single outcome, or does it happen in more than one way?',
    ],
  }),

  predict({
    id: 'ss-predict-bigger-die',
    kcs: [K],
    params: (rng) => ({
      ev: rng.pick(['even', 'atLeast', 'atMost', 'exactly'] as const),
      k: rng.int(2, 5),
      n: rng.pick([8, 10, 12, 20]),
    }),
    text: ({ ev, k, n }) => {
      const desc =
        ev === 'even'
          ? 'the roll is an even number'
          : ev === 'atLeast'
            ? `the roll is ${k} or higher`
            : ev === 'atMost'
              ? `the roll is ${k} or lower`
              : `the roll is exactly ${k}`;
      return `You roll a fair six-sided die and consider the event "${desc}". Now you switch to a fair ${n}-sided die (faces 1 to ${n}) and consider the same event. Without working it out exactly: what happens to the probability of the event?`;
    },
    answer: ({ ev }) => (ev === 'even' ? 'same' : ev === 'atLeast' ? 'up' : 'down'),
    hints: () => [
      'With equally likely faces, P(event) = faces in the event ÷ total faces.',
      'For each die, how many faces are in the event, and how many faces are there altogether?',
    ],
  }),

  numeric({
    id: 'ss-apply-dice-sum',
    kcs: [K],
    unit: '',
    tol: DEC3,
    params: (rng) => ({ s: rng.int(2, 12) }),
    text: ({ s }) =>
      `Two fair six-sided dice are rolled. What is the probability that the two numbers add up to **${s}**? Give your answer as a decimal rounded to 3 places.`,
    solve: ({ s }) => countDice((a, b) => a + b === s) / 36,
    wrong: {
      'outcomes-equally-likely': () => 1 / 11,
      'ignores-order': ({ s }) => unorderedSum(s) / 21,
    },
    hints: ({ s }) => [
      'Imagine one die is red and the other blue: (red 2, blue 5) and (red 5, blue 2) are different outcomes.',
      'How many equally likely (red, blue) pairs are there in total?',
      `List the (red, blue) pairs that add to ${s} and count them.`,
    ],
    worked: ({ s }) => {
      const pairs = DICE.filter(([a, b]) => a + b === s);
      return [
        {
          text: 'Treat the dice as distinguishable (red and blue). Each has 6 faces, so there are 6 × 6 = 36 equally likely ordered outcomes.',
          value: 36,
          unit: '',
        },
        {
          text: `Pairs adding to ${s}: ${pairs.map(([a, b]) => `(${a}, ${b})`).join(', ')} — ${pairs.length} in all.`,
          value: pairs.length,
          unit: '',
        },
        {
          text: `P(sum = ${s}) = ${pairs.length}/36 ≈ ${fmt(pairs.length / 36, 3)}.`,
          value: pairs.length / 36,
          unit: '',
        },
      ];
    },
  }),

  choice({
    id: 'ss-disc-spinner',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => {
      const [c1, c2, c3] = rng.shuffle(['red', 'blue', 'green', 'yellow']);
      const share = rng.pick([
        { big: 'half', val: '1/2', small: 'a quarter' },
        { big: 'two-thirds', val: '2/3', small: 'a sixth' },
      ]);
      return { c1, c2, c3, ...share };
    },
    text: (p) =>
      `A spinner has three coloured regions: ${p.c1} covers ${p.big} of the circle, and ${p.c2} and ${p.c3} cover ${p.small} each. Someone writes the sample space as {${p.c1}, ${p.c2}, ${p.c3}} and concludes that P(${p.c1}) = 1/3. Which statement is correct?`,
    right: (p) => `The list is a valid sample space, but its outcomes are not equally likely: P(${p.c1}) = ${p.val}`,
    wrong: (p) => [
      ['The conclusion is right: there are three outcomes, so each has probability 1/3', 'outcomes-equally-likely'],
      'The list is not a valid sample space, because the regions have different sizes',
      `P(${p.c1}) cannot be known without spinning it many times`,
    ],
    hints: () => [
      'Does the list include every result, with no overlaps?',
      'Counting outcomes gives probabilities only if every outcome is equally likely. Is that true here?',
    ],
  }),

  choice({
    id: 'ss-disc-valid-space',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => rng.pick(SPACES),
    text: (c) =>
      `You want a sample space for ${c.exp} in which every outcome is **equally likely**, so you can find probabilities by counting. Which list works?`,
    right: (c) => c.ok,
    wrong: (c) => [[c.unordered, 'ignores-order'], c.overlap, c.short],
    hints: () => [
      'A sample space needs every outcome, listed once, with no overlaps.',
      'Keep track of which item is first and which is second.',
    ],
  }),

  numeric({
    id: 'ss-transfer-guessing-quiz',
    kcs: [K],
    transfer: true,
    unit: '',
    tol: DEC3,
    params: (rng) => {
      const n = rng.pick([3, 4]);
      return { n, k: rng.int(1, n - 1) };
    },
    text: ({ n, k }) =>
      `A quiz has ${n} true/false questions. You guess every answer by flipping a fair coin, so each guess is right with probability 1/2, independently of the others. What is the probability that you get **exactly ${k}** right? Give a decimal rounded to 3 places.`,
    solve: ({ n, k }) => choose(n, k) / 2 ** n,
    wrong: { 'outcomes-equally-likely': ({ n }) => 1 / (n + 1) },
    hints: ({ n }) => [
      `Write each outcome as a string of R (right) and W (wrong), one letter per question. How many strings of length ${n} are there?`,
      "Each string is equally likely. How many of them have exactly the number of R's you need?",
    ],
    worked: ({ n, k }) => [
      {
        text: `Each question is R or W, so there are 2^${n} = ${2 ** n} equally likely strings.`,
        value: 2 ** n,
        unit: '',
      },
      {
        text: `Strings with exactly ${k} R's: choose which ${k} of the ${n} questions are right, C(${n}, ${k}) = ${choose(n, k)}.`,
        value: choose(n, k),
        unit: '',
      },
      {
        text: `P = ${choose(n, k)}/${2 ** n} = ${fmt(choose(n, k) / 2 ** n, 3)}.`,
        value: choose(n, k) / 2 ** n,
        unit: '',
      },
    ],
  }),
];

export default t;
