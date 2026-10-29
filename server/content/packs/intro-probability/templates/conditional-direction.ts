import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, countDice, DEC3, fixed, fmt, free, numeric, PCT1, pct, predict, retry, spread } from '../lib.ts';

const K = 'conditional-direction';

const CLAIMS = [
  {
    claim:
      'A report says: "Most drivers involved in fatal crashes were sober, so sober drivers are the more dangerous ones."',
    given: 'P(sober | in a fatal crash)',
    needed: 'P(fatal crash | sober) compared with P(fatal crash | drunk)',
    why: 'Almost all drivers on the road are sober, so they make up most crashes even though each sober driver is far less likely to crash than a drunk one.',
  },
  {
    claim:
      'A news story says: "Most car accidents happen within 5 miles of home, so driving near home is especially dangerous."',
    given: 'P(within 5 miles of home | accident)',
    needed: 'P(accident | a mile driven near home) compared with far from home',
    why: 'Most driving happens near home, so most accidents do too, even if each mile near home is no riskier.',
  },
  {
    claim:
      'A mall manager reads that 70% of shoppers treated for food poisoning had eaten at the food court, and concludes that eating at the food court gives you a 70% chance of food poisoning.',
    given: 'P(ate at food court | food poisoning)',
    needed: 'P(food poisoning | ate at food court)',
    why: 'Thousands of shoppers eat at the food court and only a handful get sick, so P(sick | food court) is tiny even if most sick people ate there.',
  },
];

const EVENTS = [
  { d: 'the sum is 8', f: (a: number, b: number) => a + b === 8 },
  { d: 'the sum is at least 10', f: (a: number, b: number) => a + b >= 10 },
  { d: 'at least one die shows a 6', f: (a: number, b: number) => a === 6 || b === 6 },
  { d: 'both dice show the same number', f: (a: number, b: number) => a === b },
  { d: 'the red die shows an even number', f: (a: number) => a % 2 === 0 },
  { d: 'the sum is odd', f: (a: number, b: number) => (a + b) % 2 === 1 },
  { d: 'the blue die shows a 4 or less', f: (_a: number, b: number) => b <= 4 },
];

const NESTED = [
  { setup: 'A family has two children.', sub: 'both children are girls', sup: 'the first child is a girl' },
  { setup: 'A fair coin is flipped twice.', sub: 'both flips are heads', sup: 'the first flip is heads' },
  { setup: 'A fair die is rolled once.', sub: 'the roll is a 6', sup: 'the roll is even' },
  {
    setup: 'One card is drawn from a standard deck.',
    sub: 'the card is the king of hearts',
    sup: 'the card is a heart',
  },
];

const STATEMENTS = [
  { s: '95% of people who have the disease test positive.', x: 'positive', y: 'disease' },
  { s: 'Of all the emails the filter flags, 80% really are spam.', x: 'spam', y: 'flagged' },
  { s: '3% of legitimate transactions get flagged.', x: 'flagged', y: 'legitimate' },
  { s: 'Among parts made by machine B, 4% are defective.', x: 'defective', y: 'machine B' },
  { s: 'Of the defective parts, 60% came from machine B.', x: 'machine B', y: 'defective' },
  { s: 'On days when it rained, the forecast had predicted rain 85% of the time.', x: 'rain predicted', y: 'rained' },
];

const dnaAnswer = (pop: number, r: number) => 100 / (1 + (pop - 1) / r);

const t: ItemTemplate[] = [
  free({
    id: 'cd-recall-relationship',
    kcs: [K],
    capability: 'recall',
    text: () => 'How are P(A | B) and P(B | A) related? When are they equal?',
    expect: {
      diff: 'They are generally different: each divides the overlap P(A and B) by a different group (B or A).',
      relation: 'P(A | B) = P(B | A) × P(A) / P(B).',
      equal: 'They are equal only when P(A) = P(B) (or when the overlap is zero).',
    },
    reference: () =>
      'Both start from the same overlap: P(A | B) = P(A and B) / P(B) and P(B | A) = P(A and B) / P(A). So P(A | B) = P(B | A) × P(A) / P(B). They are equal only when P(A) = P(B) (or both are zero because A and B never happen together).',
    hints: () => [
      'Write each one as P(A and B) divided by something.',
      'What would have to be true of the two denominators for them to match?',
    ],
  }),

  free({
    id: 'cd-explain-misread-statistic',
    kcs: [K],
    capability: 'explain',
    params: (rng) => rng.pick(CLAIMS),
    text: (c) =>
      `${c.claim} Explain which conditional probability the data actually gives, which one the conclusion needs, and why they can be very different.`,
    expect: {
      given: 'Identifies the reported number as P(feature | outcome) — measured inside the group that had the outcome.',
      needed: 'Identifies that the conclusion needs the reverse direction, P(outcome | feature).',
      why: 'Explains that they differ because the groups have very different sizes (base rates).',
    },
    reference: (c) => `The data gives ${c.given}. The conclusion needs ${c.needed}. ${c.why}`,
    hints: () => [
      'The statistic was measured inside which group?',
      'To judge danger, which group would you need to look inside instead?',
    ],
  }),

  predict({
    id: 'cd-predict-clubs',
    kcs: [K],
    params: (rng) => ({
      c: rng.pick([40, 50, 60]),
      frac: rng.pick([0.6, 0.8]),
      m: rng.pick([150, 200, 250]),
      askCgM: rng.next() < 0.5,
      mathGrows: rng.next() < 0.5,
    }),
    text: ({ c, frac, m, askCgM, mathGrows }) => {
      const change = mathGrows
        ? `The math club then doubles to ${2 * m} members, but none of the new members play chess.`
        : `The chess club then doubles to ${2 * c} members, but none of the new members are in the math club.`;
      const ask = askCgM ? 'P(in chess club | in math club)' : 'P(in math club | in chess club)';
      return `A school chess club has ${c} members, and ${fmt(c * frac)} of them are also in the math club, which has ${m} members in total. ${change} What happens to ${ask}?`;
    },
    answer: ({ askCgM, mathGrows }) => (askCgM === mathGrows ? 'down' : 'same'),
    miscon: ({ askCgM, mathGrows }) =>
      askCgM === mathGrows ? { same: 'conditional-inversion' } : { down: 'conditional-inversion' },
    hints: () => [
      'Write the probability as (members of both clubs) ÷ (size of one club).',
      'Which club is in the denominator, and did it change?',
    ],
  }),

  numeric({
    id: 'cd-apply-remote-engineers',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({ na: r.pick([100, 200, 250, 400]), pba: r.pick([0.3, 0.5, 0.6, 0.8]), q: r.pick([0.1, 0.2, 0.3]) }),
        ({ na, pba, q }) => {
          const nr = na * pba + (1000 - na) * q;
          return spread([(100 * na * pba) / nr, 100 * pba, na / 10], 1);
        },
      ),
    text: ({ na, pba, q }) =>
      `A company has 1,000 employees. ${na} are engineers, and ${pct(pba)} of the engineers work remotely. In total, ${fmt(na * pba + (1000 - na) * q)} employees work remotely. If you pick a remote employee at random, what is the probability that they are an engineer? Give a percent, rounded to one decimal place.`,
    solve: ({ na, pba, q }) => (100 * na * pba) / (na * pba + (1000 - na) * q),
    wrong: { 'conditional-inversion': ({ pba }) => 100 * pba, 'ignores-condition': ({ na }) => na / 10 },
    hints: () => [
      'You are told about P(remote | engineer). The question asks for the other direction.',
      'How many employees are remote engineers?',
      'Divide by the group named after "given": all remote employees.',
    ],
    worked: ({ na, pba, q }) => {
      const both = na * pba,
        nr = both + (1000 - na) * q;
      return [
        { text: `Remote engineers: ${na} × ${pct(pba)} = ${fmt(both)}.`, value: both, unit: '' },
        { text: `All remote employees: ${fmt(nr)}.`, value: nr, unit: '' },
        {
          text: `P(engineer | remote) = ${fmt(both)} / ${fmt(nr)} ≈ ${pct(both / nr, 1)}.`,
          value: (100 * both) / nr,
          unit: '%',
        },
      ];
    },
  }),

  numeric({
    id: 'cd-apply-dice-both-ways',
    kcs: [K],
    unit: '',
    tol: DEC3,
    params: (rng) =>
      retry(
        rng,
        (r) => ({ a: r.int(0, EVENTS.length - 1), b: r.int(0, EVENTS.length - 1) }),
        ({ a, b }) => {
          const A = EVENTS[a].f,
            B = EVENTS[b].f,
            ab = countDice((x, y) => A(x, y) && B(x, y));
          return a !== b && ab > 0 && spread([ab / countDice(B), ab / countDice(A), ab / 36], 0.01);
        },
      ),
    text: ({ a, b }) =>
      `Two fair dice, one red and one blue, are rolled. Let A = "${EVENTS[a].d}" and B = "${EVENTS[b].d}". Find **P(A | B)**. Give a decimal rounded to 3 places.`,
    solve: ({ a, b }) => countDice((x, y) => EVENTS[a].f(x, y) && EVENTS[b].f(x, y)) / countDice(EVENTS[b].f),
    wrong: {
      'conditional-inversion': ({ a, b }) =>
        countDice((x, y) => EVENTS[a].f(x, y) && EVENTS[b].f(x, y)) / countDice(EVENTS[a].f),
      'conditional-as-joint': ({ a, b }) => countDice((x, y) => EVENTS[a].f(x, y) && EVENTS[b].f(x, y)) / 36,
    },
    hints: () => [
      'In P(A | B), the event after the bar is the one you know happened.',
      'Count the (red, blue) pairs in B, then how many of those are also in A.',
    ],
    worked: ({ a, b }) => {
      const nb = countDice(EVENTS[b].f),
        ab = countDice((x, y) => EVENTS[a].f(x, y) && EVENTS[b].f(x, y));
      return [
        { text: `Pairs in B (${EVENTS[b].d}): ${nb} of 36.`, value: nb, unit: '' },
        { text: `Pairs in both A and B: ${ab}.`, value: ab, unit: '' },
        { text: `P(A | B) = ${ab}/${nb} ≈ ${fmt(ab / nb, 3)}.`, value: ab / nb, unit: '' },
      ];
    },
  }),

  fixed({
    id: 'cd-disc-which-larger',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => ({ ...rng.pick(NESTED), swap: rng.next() < 0.5 }),
    text: (c) =>
      `${c.setup} Let A = "${c.swap ? c.sub : c.sup}" and B = "${c.swap ? c.sup : c.sub}". Which is larger, P(A | B) or P(B | A)?`,
    options: () => [
      'P(A | B)',
      'P(B | A)',
      ['They are equal', 'conditional-inversion'],
      "Can't tell without more information",
    ],
    correct: (c) => (c.swap ? 1 : 0),
    hints: () => [
      'One event sits entirely inside the other.',
      'If you know the smaller event happened, how likely is the bigger one?',
    ],
  }),

  choice({
    id: 'cd-disc-which-conditional',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => rng.pick(STATEMENTS),
    text: (c) => `Which probability does this statement give? "${c.s}"`,
    right: (c) => `P(${c.x} | ${c.y})`,
    wrong: (c) => [
      [`P(${c.y} | ${c.x})`, 'conditional-inversion'],
      [`P(${c.x} and ${c.y})`, 'conditional-as-joint'],
      [`P(${c.x})`, 'ignores-condition'],
    ],
    hints: () => ['Which group was the percentage measured in?', 'The group you measure inside goes after the bar.'],
  }),

  numeric({
    id: 'cd-transfer-dna-match',
    kcs: [K, 'bayes-rule'],
    transfer: true,
    unit: '%',
    tol: PCT1,
    params: (rng) => ({ r: rng.pick([1000, 10000, 100000]), pop: rng.pick([50000, 200000, 1000000]) }),
    text: ({ r, pop }) =>
      `A crime was committed by one of ${fmt(pop)} people in a city, and before any evidence each is equally likely to be the culprit. A DNA trace from the scene would certainly match the culprit, and matches any given innocent person with probability 1 in ${fmt(r)}. A person chosen at random from the city is tested, and their DNA matches. Based only on this, what is the probability that they are the culprit? Give a percent, rounded to one decimal place.`,
    solve: ({ r, pop }) => dnaAnswer(pop, r),
    wrong: { 'conditional-inversion': ({ r }) => 100 * (1 - 1 / r) },
    hints: () => [
      '"1 in r" is P(match | innocent). The question asks for P(culprit | match).',
      'About how many innocent people in the city would match?',
      'Of everyone who would match, what share is the culprit?',
    ],
    worked: ({ r, pop }) => [
      {
        text: `Innocent people: ${fmt(pop - 1)}. Expected innocent matches: ${fmt(pop - 1)} ÷ ${fmt(r)} ≈ ${fmt((pop - 1) / r, 2)}.`,
        value: (pop - 1) / r,
        unit: '',
      },
      {
        text: `Everyone who would match: 1 culprit + ${fmt((pop - 1) / r, 2)} innocents ≈ ${fmt(1 + (pop - 1) / r, 2)}.`,
        value: 1 + (pop - 1) / r,
        unit: '',
      },
      {
        text: `P(culprit | match) = 1 / ${fmt(1 + (pop - 1) / r, 2)} ≈ ${fmt(dnaAnswer(pop, r), 1)}%.`,
        value: dnaAnswer(pop, r),
        unit: '%',
      },
    ],
  }),
];

export default t;
