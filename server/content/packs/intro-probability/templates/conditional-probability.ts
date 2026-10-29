import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, countDice, DEC3, fmt, free, numeric, PCT1, pct, predict, retry, spread } from '../lib.ts';

const K = 'conditional-probability';

// Two-way count tables. Cells are A&B, notA&B, A&notB, notA&notB (A = target, B = condition).
const TABLES = [
  {
    org: 'A bank',
    pop: 'card transactions',
    cells: [
      'flagged and fraudulent',
      'flagged but legitimate',
      'not flagged but fraudulent',
      'not flagged and legitimate',
    ],
    q: 'a transaction is fraudulent, given that it was flagged',
    bGroup: 'flagged transactions',
    aWord: 'fraudulent',
  },
  {
    org: 'An email provider',
    pop: 'emails',
    cells: [
      'contain a link and are spam',
      'contain a link but are not spam',
      'have no link but are spam',
      'have no link and are not spam',
    ],
    q: 'an email is spam, given that it contains a link',
    bGroup: 'emails that contain a link',
    aWord: 'spam',
  },
  {
    org: 'A factory',
    pop: 'parts',
    cells: [
      'made on the night shift and defective',
      'made on the night shift and fine',
      'made on the day shift and defective',
      'made on the day shift and fine',
    ],
    q: 'a part is defective, given that it was made on the night shift',
    bGroup: 'night-shift parts',
    aWord: 'defective',
  },
  {
    org: 'A clinic',
    pop: 'patients',
    cells: [
      'have a fever and the flu',
      'have a fever but not the flu',
      'have the flu but no fever',
      'have neither a fever nor the flu',
    ],
    q: 'a patient has the flu, given that they have a fever',
    bGroup: 'patients with a fever',
    aWord: 'the flu',
  },
];

const DICE_A = [
  { d: 'at least one die shows a 6', f: (a: number, b: number) => a === 6 || b === 6 },
  { d: 'the two dice show the same number', f: (a: number, b: number) => a === b },
  { d: 'the red die shows 5 or more', f: (a: number) => a >= 5 },
  { d: 'at least one die shows a 1', f: (a: number, b: number) => a === 1 || b === 1 },
];
const DICE_B = [
  ...[8, 9, 10].map((t) => ({ d: `the sum is at least ${t}`, f: (a: number, b: number) => a + b >= t })),
  ...[6, 7, 8].map((t) => ({ d: `the sum is exactly ${t}`, f: (a: number, b: number) => a + b === t })),
  { d: 'the sum is even', f: (a: number, b: number) => (a + b) % 2 === 0 },
];

const AT_LEAST_ONE = [
  {
    setup:
      'A family has two children; each child is equally likely to be a boy or a girl, independently. You learn that at least one of them is a girl.',
    q: 'both are girls',
    ans: 1 / 3,
    naive: 1 / 2,
    list: 'GG, GB, BG (BB is ruled out)',
    hits: 1,
    of: 3,
  },
  {
    setup: 'A fair coin is flipped twice. You are told at least one flip came up heads.',
    q: 'both flips are heads',
    ans: 1 / 3,
    naive: 1 / 2,
    list: 'HH, HT, TH (TT is ruled out)',
    hits: 1,
    of: 3,
  },
  {
    setup: 'Two fair dice are rolled. You are told at least one die shows a 6.',
    q: 'both dice show a 6',
    ans: 1 / 11,
    naive: 1 / 6,
    list: 'the 11 ordered pairs containing a 6: (6,1)…(6,6) and (1,6)…(5,6)',
    hits: 1,
    of: 11,
  },
  {
    setup: 'A fair coin is flipped three times. You are told at least one flip came up heads.',
    q: 'all three flips are heads',
    ans: 1 / 7,
    naive: 1 / 3,
    list: 'the 7 sequences other than TTT',
    hits: 1,
    of: 7,
  },
];

const t: ItemTemplate[] = [
  free({
    id: 'cp-recall-formula',
    kcs: [K],
    capability: 'recall',
    text: () => 'Write the formula for P(A | B), and say in words what conditioning on B does.',
    expect: {
      formula: 'P(A | B) = P(A and B) / P(B).',
      restrict: 'Conditioning restricts attention to the cases where B happened — B becomes the new whole.',
      denom: 'The denominator is P(B), not the whole population.',
    },
    reference: () =>
      'P(A | B) = P(A and B) / P(B). Conditioning on B means you only look at the cases where B happened, and ask what fraction of those also have A — so you divide by the size of the B group, not by everyone.',
    hints: () => ['Which group do you look inside when you are told B happened?', 'What goes in the denominator?'],
  }),

  free({
    id: 'cp-explain-joint-vs-conditional',
    kcs: [K],
    capability: 'explain',
    params: (rng) => ({ w: rng.pick(['free', 'winner', 'invoice']) }),
    text: ({ w }) =>
      `Explain the difference between P(spam **and** contains "${w}") and P(spam **given** contains "${w}"). Which one is usually bigger, and why?`,
    expect: {
      joint: `P(spam and word) is a fraction of all emails.`,
      cond: 'P(spam | word) is a fraction of only the emails that contain the word.',
      bigger: 'The conditional is at least as big, because it divides the same overlap by a smaller group, P(word).',
    },
    reference: ({ w }) =>
      `P(spam and contains "${w}") is the share of *all* emails that are both spam and contain the word. P(spam | contains "${w}") is the share of just the emails containing "${w}" that are spam. They have the same numerator but the conditional divides by P(contains "${w}"), which is at most 1, so P(spam | word) = P(spam and word) / P(word) is at least as large — usually much larger.`,
    hints: () => [
      'For each one, what is the denominator — all emails, or some of them?',
      'P(A | B) = P(A and B) / P(B). What happens when you divide by a number less than 1?',
    ],
  }),

  predict({
    id: 'cp-predict-counts',
    kcs: [K],
    params: (rng) => ({
      kind: rng.pick(['moreHam', 'moreSpam', 'moreOther'] as const),
      s: rng.pick([30, 40, 60]),
      h: rng.pick([20, 50, 90]),
    }),
    text: ({ kind, s, h }) => {
      const change =
        kind === 'moreHam'
          ? `This month the spam count stays at ${s}, but the number of non-spam emails containing "invoice" doubles.`
          : kind === 'moreSpam'
            ? `This month the non-spam count stays at ${h}, but the number of spam emails containing "invoice" doubles.`
            : 'This month both of those counts stay the same, but the number of emails that do **not** contain "invoice" doubles.';
      return `Last month, ${s} emails containing the word "invoice" were spam and ${h} were not. ${change} What happens to P(spam | contains "invoice")?`;
    },
    answer: ({ kind }) => (kind === 'moreHam' ? 'down' : kind === 'moreSpam' ? 'up' : 'same'),
    miscon: ({ kind }) => (kind === 'moreOther' ? { down: 'ignores-condition' } : {}),
    hints: () => [
      'Which emails matter once you condition on "contains invoice"?',
      'Write P(spam | invoice) as a fraction of counts.',
    ],
  }),

  numeric({
    id: 'cp-apply-two-way-table',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => {
          const c = r.pick(TABLES);
          const n = r.pick([500, 1000, 2000]);
          const b = n * r.pick([0.1, 0.15, 0.2, 0.25, 0.3]);
          const ab = Math.round(b * r.pick([0.2, 0.3, 0.4, 0.6, 0.75]));
          const anb = Math.round((n - b) * r.pick([0.01, 0.02, 0.05, 0.1]));
          return { c, n, ab, nab: b - ab, anb, rest: n - b - anb, order: r.shuffle([0, 1, 2, 3]) };
        },
        (p) =>
          spread(
            [p.ab / (p.ab + p.nab), p.ab / (p.ab + p.anb), p.ab / p.n, (p.ab + p.anb) / p.n].map((x) => 100 * x),
            1,
          ),
      ),
    text: (p) => {
      const counts = [p.ab, p.nab, p.anb, p.rest];
      const lines = p.order.map((i) => `- ${p.c.cells[i]}: ${fmt(counts[i])}`).join('\n');
      return `${p.c.org} sorted ${fmt(p.n)} ${p.c.pop} into four groups:\n${lines}\n\nWhat is the probability that ${p.c.q}? Give a percent, rounded to one decimal place.`;
    },
    solve: (p) => (100 * p.ab) / (p.ab + p.nab),
    wrong: {
      'conditional-inversion': (p) => (100 * p.ab) / (p.ab + p.anb),
      'conditional-as-joint': (p) => (100 * p.ab) / p.n,
      'ignores-condition': (p) => (100 * (p.ab + p.anb)) / p.n,
    },
    hints: (p) => [
      'The word "given" tells you which group to look inside.',
      `Count only the ${p.c.bGroup}. How many are there?`,
      `Of those, what share are ${p.c.aWord}?`,
    ],
    worked: (p) => [
      {
        text: `Restrict to the ${p.c.bGroup}: ${fmt(p.ab)} + ${fmt(p.nab)} = ${fmt(p.ab + p.nab)}.`,
        value: p.ab + p.nab,
        unit: '',
      },
      { text: `Of those, ${p.c.aWord}: ${fmt(p.ab)}.`, value: p.ab, unit: '' },
      {
        text: `P = ${fmt(p.ab)} / ${fmt(p.ab + p.nab)} ≈ ${pct(p.ab / (p.ab + p.nab), 1)}.`,
        value: (100 * p.ab) / (p.ab + p.nab),
        unit: '%',
      },
    ],
  }),

  numeric({
    id: 'cp-apply-weather-formula',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({
          pr: r.pick([0.2, 0.25, 0.3, 0.4]),
          pw: r.pick([0.15, 0.2, 0.3, 0.35]),
          pb: r.pick([0.05, 0.08, 0.1, 0.12]),
        }),
        ({ pr, pw, pb }) =>
          pb < Math.min(pr, pw) &&
          pr + pw - pb <= 1 &&
          spread(
            [pb / pw, pb / pr, pb, pr].map((x) => 100 * x),
            1,
          ),
      ),
    text: ({ pr, pw, pb }) =>
      `In a coastal town, it is windy on ${pct(pw)} of days, rainy on ${pct(pr)} of days, and both windy and rainy on ${pct(pb)} of days. On a day that is windy, what is the probability that it is also rainy? Give a percent, rounded to one decimal place.`,
    solve: ({ pw, pb }) => (100 * pb) / pw,
    wrong: {
      'conditional-inversion': ({ pr, pb }) => (100 * pb) / pr,
      'conditional-as-joint': ({ pb }) => 100 * pb,
      'ignores-condition': ({ pr }) => 100 * pr,
    },
    hints: () => ['Which days are you restricting to?', 'P(rainy | windy) = P(rainy and windy) / P(windy).'],
    worked: ({ pw, pb }) => [
      { text: `Restrict to windy days: P(windy) = ${pct(pw)}.`, value: 100 * pw, unit: '%' },
      { text: `P(rainy | windy) = ${pct(pb)} / ${pct(pw)} ≈ ${pct(pb / pw, 1)}.`, value: (100 * pb) / pw, unit: '%' },
    ],
  }),

  numeric({
    id: 'cp-apply-dice-given',
    kcs: [K],
    unit: '',
    tol: DEC3,
    params: (rng) =>
      retry(
        rng,
        (r) => ({ a: r.int(0, DICE_A.length - 1), b: r.int(0, DICE_B.length - 1) }),
        ({ a, b }) => {
          const A = DICE_A[a].f,
            B = DICE_B[b].f;
          const nb = countDice(B),
            nab = countDice((x, y) => A(x, y) && B(x, y)),
            na = countDice(A);
          return nab > 0 && nab < nb && spread([nab / nb, na / 36, nab / 36, nab / na], 0.01);
        },
      ),
    text: ({ a, b }) =>
      `Two fair dice, one red and one blue, are rolled. You are told that ${DICE_B[b].d}. Given that, what is the probability that ${DICE_A[a].d}? Give a decimal rounded to 3 places.`,
    solve: ({ a, b }) => countDice((x, y) => DICE_A[a].f(x, y) && DICE_B[b].f(x, y)) / countDice(DICE_B[b].f),
    wrong: {
      'ignores-condition': ({ a }) => countDice(DICE_A[a].f) / 36,
      'conditional-as-joint': ({ a, b }) => countDice((x, y) => DICE_A[a].f(x, y) && DICE_B[b].f(x, y)) / 36,
      'conditional-inversion': ({ a, b }) =>
        countDice((x, y) => DICE_A[a].f(x, y) && DICE_B[b].f(x, y)) / countDice(DICE_A[a].f),
    },
    hints: ({ b }) => [
      'There are 36 equally likely (red, blue) pairs to start with.',
      `Keep only the pairs where ${DICE_B[b].d}. How many are left?`,
      'Of those, how many also satisfy the second condition?',
    ],
    worked: ({ a, b }) => {
      const nb = countDice(DICE_B[b].f),
        nab = countDice((x, y) => DICE_A[a].f(x, y) && DICE_B[b].f(x, y));
      return [
        { text: `Pairs where ${DICE_B[b].d}: ${nb} of the 36.`, value: nb, unit: '' },
        { text: `Of those, pairs where ${DICE_A[a].d}: ${nab}.`, value: nab, unit: '' },
        { text: `P = ${nab}/${nb} ≈ ${fmt(nab / nb, 3)}.`, value: nab / nb, unit: '' },
      ];
    },
  }),

  choice({
    id: 'cp-disc-which-number',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => ({
      pA: rng.pick([0.05, 0.1, 0.2]),
      pBgA: rng.pick([0.6, 0.7, 0.8, 0.9]),
      pB: rng.pick([0.25, 0.3, 0.4]),
      ask: rng.pick(['BgA', 'B', 'AB'] as const),
    }),
    text: ({ pA, pBgA, pB, ask }) => {
      const q =
        ask === 'BgA'
          ? 'that a patient who has condition X has a cough'
          : ask === 'B'
            ? 'that a randomly chosen patient has a cough'
            : 'that a randomly chosen patient both has condition X and has a cough';
      return `In a clinic, ${pct(pA)} of patients have condition X. Among patients with X, ${pct(pBgA)} have a cough. Overall, ${pct(pB)} of all patients have a cough. What is the probability ${q}?`;
    },
    right: ({ pA, pBgA, pB, ask }) => pct(ask === 'BgA' ? pBgA : ask === 'B' ? pB : pA * pBgA),
    wrong: ({ pA, pBgA, pB, ask }) =>
      ask === 'BgA'
        ? [[pct(pA * pBgA), 'conditional-as-joint'], [pct(pB), 'ignores-condition'], pct(pA)]
        : ask === 'B'
          ? [pct(pBgA), pct(pA * pBgA), pct(pA)]
          : [[pct(pBgA), 'conditional-as-joint'], pct(pB), pct(pA)],
    hints: () => [
      'Is the question about everyone, or about one group?',
      'A "both" probability is a share of everyone: P(X) × P(cough | X).',
    ],
  }),

  numeric({
    id: 'cp-transfer-at-least-one',
    kcs: [K, 'sample-spaces'],
    transfer: true,
    unit: '',
    tol: DEC3,
    params: (rng) => rng.pick(AT_LEAST_ONE),
    text: (c) => `${c.setup} What is the probability that ${c.q}? Give a decimal rounded to 3 places.`,
    solve: (c) => c.ans,
    wrong: { 'ignores-order': (c) => c.naive },
    hints: () => [
      'List the equally likely outcomes before you were told anything, keeping track of order.',
      'Cross out the outcomes the information rules out. What share of the rest fit?',
    ],
    worked: (c) => [
      { text: `Equally likely outcomes still possible: ${c.list} — ${c.of} in all.`, value: c.of, unit: '' },
      { text: `Exactly ${c.hits} of them fits, so P = ${c.hits}/${c.of} ≈ ${fmt(c.ans, 3)}.`, value: c.ans, unit: '' },
    ],
  }),
];

export default t;
