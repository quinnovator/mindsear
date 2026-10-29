import type { ItemTemplate } from '../../../../../shared/content.ts';
import { cap, choice, COUNT, fmt, free, numeric, PCT1, pct, predict, retry, spread } from '../lib.ts';
import { SCREENS, scenario } from '../contexts.ts';

const K = 'natural-frequencies-and-trees';

const BRANCH = [
  {
    change: 'The false-positive rate rises (prevalence and detection rate unchanged).',
    target: 'healthy people who test positive',
    ans: 'up' as const,
  },
  {
    change: 'The false-positive rate rises (prevalence and detection rate unchanged).',
    target: 'sick people who test positive',
    ans: 'same' as const,
  },
  {
    change: "The condition becomes more common (the test's rates unchanged).",
    target: 'healthy people who test positive',
    ans: 'down' as const,
  },
  {
    change: 'The test gets better at detecting the condition (prevalence and false-positive rate unchanged).',
    target: 'sick people who test positive',
    ans: 'up' as const,
  },
  {
    change: 'The test gets better at detecting the condition (prevalence and false-positive rate unchanged).',
    target: 'healthy people who test positive',
    ans: 'same' as const,
  },
];

const t: ItemTemplate[] = [
  free({
    id: 'nf-recall-steps',
    kcs: [K],
    capability: 'recall',
    text: () =>
      'List the steps for turning a percentages problem (like a screening test) into natural frequencies, and say how you then read off P(condition | positive).',
    expect: {
      pop: 'Start with a round number of cases (e.g. 1,000 or 10,000).',
      split:
        'Split first by the base rate, then split each group by its own rate (true positives from the sick, false positives from the healthy).',
      read: 'P(condition | positive) = true positives ÷ all positives.',
    },
    reference: () =>
      'Pick a round population, such as 10,000 people. Use the base rate to split them into those with and without the condition. Split the "with" group by the detection rate (true positives) and the "without" group by the false-positive rate (false positives). Then P(condition | positive) is true positives divided by all positives (true + false).',
    hints: () => ['What do you split by first?', 'Which two branches contain positive results?'],
  }),

  free({
    id: 'nf-explain-counts',
    kcs: [K],
    capability: 'explain',
    params: (rng) => ({ p: rng.pick([0.01, 0.02, 0.05]), s: rng.pick([0.8, 0.9, 0.95]), f: rng.pick([0.05, 0.1]) }),
    text: ({ p, s, f }) =>
      `${scenario(SCREENS[0], p, s, f)} Explain, using "out of 10,000 people", how you'd find the chance that someone who tests positive has the condition — and why counts make this easier than juggling percentages.`,
    expect: {
      counts: 'Converts to counts: people with the condition, true positives, people without it, false positives.',
      denom: 'Divides true positives by all positives (true + false).',
      why: 'Explains that counts make the groups visible, so it is hard to mix up P(positive | sick) with P(sick | positive).',
    },
    reference: ({ p, s, f }) => {
      const sick = 10000 * p,
        tp = sick * s,
        fp = (10000 - sick) * f;
      return `Out of 10,000 people, ${fmt(sick)} have the condition and ${fmt(tp)} of them test positive. Of the ${fmt(10000 - sick)} without it, ${fmt(fp)} also test positive. So ${fmt(tp + fp)} test positive in all, of whom ${fmt(tp)} are sick: about ${pct(tp / (tp + fp), 1)}. Counts make the two positive groups and the right denominator visible, whereas with percentages it's easy to grab the ${pct(s)} and forget the much larger healthy group.`;
    },
    hints: () => ['How many of the 10,000 have the condition?', 'Positives come from two groups. What are they?'],
  }),

  predict({
    id: 'nf-predict-branches',
    kcs: [K],
    params: (rng) => rng.pick(BRANCH),
    text: (b) =>
      `Picture a tree for 1,000 people: first split by whether they have a condition, then split each group by test result. ${b.change} What happens to the number of ${b.target}?`,
    answer: (b) => b.ans,
    hints: () => [
      "Each branch count is (group size) × (that group's rate).",
      'Which numbers feed into this particular branch?',
    ],
  }),

  numeric({
    id: 'nf-apply-total-positives',
    kcs: [K],
    unit: '',
    tol: COUNT,
    params: (rng) => ({
      c: rng.pick(SCREENS),
      p: rng.pick([0.01, 0.02, 0.05, 0.1]),
      s: rng.pick([0.8, 0.9, 0.95]),
      f: rng.pick([0.02, 0.05, 0.1]),
    }),
    text: ({ c, p, s, f }) =>
      `${scenario(c, p, s, f)} Imagine 10,000 ${c.unitPl}. In total, how many ${c.posPl} would you expect?`,
    solve: ({ p, s, f }) => 10000 * (p * s + (1 - p) * f),
    wrong: { 'ignores-false-positives': ({ p, s }) => 10000 * p * s },
    hints: ({ c }) => [
      `How many of the 10,000 are ${c.actualPos}?`,
      'Positives come from two branches of the tree.',
      `Don't forget the ${c.actualNeg} that are also ${c.Es}.`,
    ],
    worked: ({ c, p, s, f }) => {
      const pos = 10000 * p,
        tp = pos * s,
        fp = (10000 - pos) * f;
      return [
        {
          text: `${cap(c.actualPos)}: 10,000 × ${pct(p)} = ${fmt(pos)}; of those ${c.Es}: ${fmt(pos)} × ${pct(s)} = ${fmt(tp)}.`,
          value: tp,
          unit: '',
        },
        {
          text: `${cap(c.actualNeg)}: ${fmt(10000 - pos)}; of those ${c.Es}: ${fmt(10000 - pos)} × ${pct(f)} = ${fmt(fp)}.`,
          value: fp,
          unit: '',
        },
        { text: `All ${c.posPl}: ${fmt(tp)} + ${fmt(fp)} = ${fmt(tp + fp)}.`, value: tp + fp, unit: '' },
      ];
    },
  }),

  numeric({
    id: 'nf-apply-defect-count',
    kcs: [K, 'total-probability'],
    unit: '',
    tol: COUNT,
    params: (rng) => ({
      wa: rng.pick([0.3, 0.4, 0.6, 0.7]),
      da: rng.pick([0.01, 0.02, 0.03]),
      db: rng.pick([0.04, 0.05, 0.08]),
    }),
    text: ({ wa, da, db }) =>
      `Machine A makes ${pct(wa)} of a factory's parts and machine B makes the rest. ${pct(da)} of A's parts are defective, and ${pct(db)} of B's parts are. Out of 1,000 parts, how many would you expect to be defective?`,
    solve: ({ wa, da, db }) => 1000 * (wa * da + (1 - wa) * db),
    wrong: { 'unweighted-average': ({ da, db }) => (1000 * (da + db)) / 2 },
    hints: () => [
      'How many of the 1,000 parts come from each machine?',
      "Apply each machine's own defect rate to its own parts, then add.",
    ],
    worked: ({ wa, da, db }) => [
      {
        text: `From A: ${fmt(1000 * wa)} parts × ${pct(da)} = ${fmt(1000 * wa * da)} defective.`,
        value: 1000 * wa * da,
        unit: '',
      },
      {
        text: `From B: ${fmt(1000 * (1 - wa))} parts × ${pct(db)} = ${fmt(1000 * (1 - wa) * db)} defective.`,
        value: 1000 * (1 - wa) * db,
        unit: '',
      },
      {
        text: `Total defective: ${fmt(1000 * wa * da)} + ${fmt(1000 * (1 - wa) * db)} = ${fmt(1000 * (wa * da + (1 - wa) * db))}.`,
        value: 1000 * (wa * da + (1 - wa) * db),
        unit: '',
      },
    ],
  }),

  numeric({
    id: 'nf-apply-which-machine',
    kcs: [K, 'bayes-rule'],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({
          wa: r.pick([0.3, 0.4, 0.6, 0.7, 0.8]),
          da: r.pick([0.01, 0.02, 0.03]),
          db: r.pick([0.04, 0.05, 0.08]),
        }),
        ({ wa, da, db }) =>
          spread([(100 * (1 - wa) * db) / (wa * da + (1 - wa) * db), 100 * db, (100 * db) / (da + db)], 1),
      ),
    text: ({ wa, da, db }) =>
      `Machine A makes ${pct(wa)} of a factory's parts and machine B makes the rest. ${pct(da)} of A's parts are defective, and ${pct(db)} of B's parts are. A part is picked at random and turns out to be defective. What is the probability that it came from machine B? (Tip: imagine 1,000 parts.) Give a percent, rounded to one decimal place.`,
    solve: ({ wa, da, db }) => (100 * (1 - wa) * db) / (wa * da + (1 - wa) * db),
    wrong: {
      'conditional-inversion': ({ db }) => 100 * db,
      'base-rate-neglect': ({ da, db }) => (100 * db) / (da + db),
    },
    hints: () => [
      'Of 1,000 parts, how many come from each machine?',
      'How many defective parts does each machine contribute?',
      'Of all the defective parts, what share came from B?',
    ],
    worked: ({ wa, da, db }) => {
      const a = 1000 * wa * da,
        b = 1000 * (1 - wa) * db;
      return [
        { text: `Defective from A: ${fmt(1000 * wa)} × ${pct(da)} = ${fmt(a)}.`, value: a, unit: '' },
        { text: `Defective from B: ${fmt(1000 * (1 - wa))} × ${pct(db)} = ${fmt(b)}.`, value: b, unit: '' },
        { text: `All defective: ${fmt(a + b)}.`, value: a + b, unit: '' },
        {
          text: `P(B | defective) = ${fmt(b)} / ${fmt(a + b)} ≈ ${pct(b / (a + b), 1)}.`,
          value: (100 * b) / (a + b),
          unit: '%',
        },
      ];
    },
  }),

  choice({
    id: 'nf-disc-denominator',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => ({
      c: rng.pick(SCREENS),
      p: rng.pick([0.01, 0.02, 0.05]),
      s: rng.pick([0.9, 0.95]),
      f: rng.pick([0.05, 0.1]),
      ask: rng.pick(['HgE', 'EgH', 'HandE'] as const),
    }),
    text: ({ c, p, s, f, ask }) => {
      const q =
        ask === 'HgE' ? `P(${c.Hs} | ${c.Es})` : ask === 'EgH' ? `P(${c.Es} | ${c.Hs})` : `P(${c.Hs} and ${c.Es})`;
      return `${scenario(c, p, s, f)} You picture 10,000 ${c.unitPl} in a tree. To get **${q}** as a fraction of counts, which group's count goes in the denominator?`;
    },
    right: ({ c, ask }) =>
      ask === 'HgE'
        ? `All ${c.posPl} (true and false positives together)`
        : ask === 'EgH'
          ? `All ${c.actualPos}`
          : `All 10,000 ${c.unitPl}`,
    wrong: ({ c, ask }) => {
      const allE = `All ${c.posPl} (true and false positives together)`,
        allH = `All ${c.actualPos}`,
        all = `All 10,000 ${c.unitPl}`,
        notH = `All ${c.actualNeg}`;
      return ask === 'HgE'
        ? [[allH, 'conditional-inversion'], [all, 'conditional-as-joint'], notH]
        : ask === 'EgH'
          ? [[allE, 'conditional-inversion'], [all, 'conditional-as-joint'], notH]
          : [[allE, 'conditional-as-joint'], [allH, 'conditional-as-joint'], notH];
    },
    hints: () => [
      'In P(X | Y), the group after the bar is the one you divide by.',
      'A probability with "and" is a share of everyone.',
    ],
  }),

  numeric({
    id: 'nf-transfer-read-tree-backwards',
    kcs: [K, 'conditional-direction'],
    transfer: true,
    unit: '%',
    tol: PCT1,
    params: (rng) => {
      const n = 2000,
        spam = n * rng.pick([0.2, 0.25, 0.4]);
      return { n, spam, caught: spam * rng.pick([0.8, 0.9]), fp: (n - spam) * rng.pick([0.02, 0.05, 0.1]) };
    },
    text: ({ n, spam, caught, fp }) =>
      `An email team audited ${fmt(n)} emails: ${fmt(spam)} were spam, and the filter flagged ${fmt(caught)} of those. Of the ${fmt(n - spam)} legitimate emails, the filter flagged ${fmt(fp)}. When a legitimate email arrives, what is the probability that the filter flags it? Give a percent, rounded to one decimal place.`,
    solve: ({ n, spam, fp }) => (100 * fp) / (n - spam),
    wrong: {
      'conditional-inversion': ({ caught, fp }) => (100 * fp) / (caught + fp),
      'conditional-as-joint': ({ n, fp }) => (100 * fp) / n,
    },
    hints: () => [
      'The question is "given legitimate", so look only inside the legitimate branch.',
      'How many legitimate emails were there, and how many of them were flagged?',
    ],
    worked: ({ n, spam, fp }) => [
      { text: `Legitimate emails: ${fmt(n - spam)}; flagged among them: ${fmt(fp)}.`, value: fp, unit: '' },
      {
        text: `P(flagged | legitimate) = ${fmt(fp)} / ${fmt(n - spam)} = ${pct(fp / (n - spam), 1)}.`,
        value: (100 * fp) / (n - spam),
        unit: '%',
      },
    ],
  }),
];

export default t;
