import type { ItemTemplate } from '../../../../../shared/content.ts';
import { fixed, fmt, free, numeric, PCT1, pct, predict, retry, spread } from '../lib.ts';
import { bayesSteps, posterior, SCREENS, scenario } from '../contexts.ts';

const K = 'bayes-rule';

// The app's walkthrough cases (1% fraud / 90% / 10% -> 9/108; 2% / 95% / 5%).
const WALKTHROUGHS = [
  { c: SCREENS[1], p: 0.01, s: 0.9, f: 0.1 },
  { c: SCREENS[0], p: 0.02, s: 0.95, f: 0.05 },
];

const t: ItemTemplate[] = [
  free({
    id: 'br-recall-formula',
    kcs: [K],
    capability: 'recall',
    text: () => "Write Bayes' rule for P(H | E), including how to compute the denominator P(E).",
    expect: {
      formula: 'P(H | E) = P(E | H) × P(H) / P(E).',
      denom: 'P(E) = P(E | H) P(H) + P(E | not H) P(not H) — true positives plus false positives.',
      meaning: 'Interprets the result as the share of all evidence cases that come from H.',
    },
    reference: () =>
      'P(H | E) = P(E | H) P(H) / P(E), where P(E) = P(E | H) P(H) + P(E | not H) P(not H). The numerator is the "true positive" share and the denominator is every way to see the evidence, so the answer is the fraction of evidence cases in which H is true.',
    hints: () => [
      'Start from P(H and E) = P(E | H) × P(H).',
      'The denominator comes from total probability: E can happen with or without H.',
    ],
  }),

  free({
    id: 'br-explain-accuracy-isnt-answer',
    kcs: [K],
    capability: 'explain',
    params: (rng) => ({
      c: rng.pick(SCREENS),
      p: rng.pick([0.005, 0.01, 0.02]),
      s: rng.pick([0.9, 0.95]),
      f: rng.pick([0.05, 0.1]),
    }),
    text: ({ c, p, s, f }) =>
      `${scenario(c, p, s, f)} Someone reasons: "It catches ${pct(s)} of ${c.actualPos}, so a ${c.posOne} means a ${pct(s)} chance it's real." Explain what's wrong with this reasoning and how Bayes' rule fixes it.`,
    expect: {
      inversion: `Points out that the detection rate is P(positive | real), not P(real | positive).`,
      fp: 'Notes that false positives from the much larger negative group must be counted.',
      compute: 'Computes (or sets up) true positives ÷ all positives.',
    },
    reference: ({ c, p, s, f }) =>
      `${pct(s)} is P(${c.Es} | ${c.Hs}) — it describes what happens inside the ${c.actualPos}. The question asks for P(${c.Hs} | ${c.Es}), which looks inside all ${c.posPl}. Those include false positives from the ${c.actualNeg}, a group about ${fmt((1 - p) / p, 0)} times larger. Bayes' rule: ${pct(p)} × ${pct(s)} ÷ (${pct(p)} × ${pct(s)} + ${pct(1 - p)} × ${pct(f)}) ≈ ${pct(posterior(p, s, f), 1)}.`,
    hints: () => ['Which group is the detection rate measured inside?', 'Where else do positive results come from?'],
  }),

  predict({
    id: 'br-predict-posterior',
    kcs: [K],
    params: (rng) => ({
      c: rng.pick(SCREENS),
      p: rng.pick([0.01, 0.02, 0.05]),
      s: rng.pick([0.8, 0.9]),
      f: rng.pick([0.05, 0.1]),
      kind: rng.pick(['fprDown', 'sensUp', 'prevDown', 'more'] as const),
    }),
    text: ({ c, p, s, f, kind }) => {
      const change =
        kind === 'fprDown'
          ? `The false-positive rate (${c.negFlag}) is cut in half; everything else stays the same.`
          : kind === 'sensUp'
            ? `The detection rate (${c.posFlag}) rises to 99%; everything else stays the same.`
            : kind === 'prevDown'
              ? `The base rate (${c.baseQ}) halves; the detection rates stay the same.`
              : `Twice as many ${c.unitPl} are screened, drawn from the same population; all the rates stay the same.`;
      return `${scenario(c, p, s, f)} ${change} What happens to the answer to: "${c.ask}"`;
    },
    answer: ({ kind }) => (kind === 'fprDown' || kind === 'sensUp' ? 'up' : kind === 'prevDown' ? 'down' : 'same'),
    miscon: ({ kind }) => (kind === 'prevDown' ? { same: 'base-rate-neglect' } : {}),
    hints: () => [
      'The answer is true positives ÷ (true positives + false positives).',
      'Which of those two counts does the change affect, and how?',
    ],
  }),

  numeric({
    id: 'base-rate-classifier',
    kcs: [K, 'base-rates'],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      rng.next() < 0.25
        ? rng.pick(WALKTHROUGHS)
        : {
            c: rng.pick(SCREENS),
            p: rng.pick([0.005, 0.01, 0.02, 0.05]),
            s: rng.pick([0.8, 0.9, 0.95]),
            f: rng.pick([0.05, 0.1]),
          },
    text: ({ c, p, s, f }) => `${scenario(c, p, s, f)} ${c.ask} Give a percent, rounded to one decimal place.`,
    solve: ({ p, s, f }) => 100 * posterior(p, s, f),
    wrong: {
      'conditional-inversion': ({ s }) => 100 * s,
      'base-rate-neglect': ({ s, f }) => (100 * s) / (s + f),
    },
    hints: ({ c, s }) => [
      `Which group is the ${pct(s)} taken over?`,
      `Imagine 1,000 ${c.unitPl}. How many of them are ${c.actualPos}, and how many of those are ${c.Es}?`,
      `Of everything ${c.Es}, what share is real?`,
    ],
    worked: ({ c, p, s, f }) => bayesSteps(c, p, s, f),
  }),

  numeric({
    id: 'br-apply-forecast',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({ prior: r.pick([0.1, 0.2, 0.3, 0.4]), s: r.pick([0.7, 0.8, 0.9]), f: r.pick([0.1, 0.15, 0.2]) }),
        ({ prior, s, f }) =>
          spread([100 * posterior(prior, s, f), 100 * s], 0.6) &&
          spread([100 * posterior(prior, s, f), (100 * s) / (s + f)], 0.6),
      ),
    text: ({ prior, s, f }) =>
      `In a city, it rains on ${pct(prior)} of days. On days when it does rain, the evening-before forecast had predicted rain ${pct(s)} of the time. On dry days, the forecast had wrongly predicted rain ${pct(f)} of the time. Tonight's forecast says rain. What is the probability that it rains tomorrow? Give a percent, rounded to one decimal place.`,
    solve: ({ prior, s, f }) => 100 * posterior(prior, s, f),
    wrong: { 'conditional-inversion': ({ s }) => 100 * s, 'base-rate-neglect': ({ s, f }) => (100 * s) / (s + f) },
    hints: () => [
      'The forecast accuracy is P(forecast rain | rain). You want P(rain | forecast rain).',
      'Picture 100 days: how many rainy days with a rain forecast, and how many dry days with one?',
    ],
    worked: ({ prior, s, f }) => [
      {
        text: `Out of 100 days: rainy with a rain forecast = 100 × ${pct(prior)} × ${pct(s)} = ${fmt(100 * prior * s)}.`,
        value: 100 * prior * s,
        unit: '',
      },
      {
        text: `Dry with a rain forecast = 100 × ${pct(1 - prior)} × ${pct(f)} = ${fmt(100 * (1 - prior) * f)}.`,
        value: 100 * (1 - prior) * f,
        unit: '',
      },
      {
        text: `P(rain | forecast rain) = ${fmt(100 * prior * s)} / ${fmt(100 * (prior * s + (1 - prior) * f))} ≈ ${pct(posterior(prior, s, f), 1)}.`,
        value: 100 * posterior(prior, s, f),
        unit: '%',
      },
    ],
  }),

  numeric({
    id: 'br-apply-two-headed-coin',
    kcs: [K],
    unit: '%',
    tol: PCT1,
    params: (rng) => ({ m: rng.pick([2, 3, 4, 9]), k: rng.int(1, 4) }),
    text: ({ m, k }) =>
      `A bag holds ${m} fair coins and 1 coin with heads on both sides. You pick a coin at random and flip it ${k === 1 ? 'once' : `${k} times`}: it lands heads${k === 1 ? '' : ' every time'}. What is the probability that you picked the two-headed coin? Give a percent, rounded to one decimal place.`,
    solve: ({ m, k }) => 100 / (1 + m * 0.5 ** k),
    wrong: { 'conditional-inversion': () => 100, 'base-rate-neglect': ({ k }) => 100 / (1 + 0.5 ** k) },
    hints: ({ m }) => [
      `Before flipping, the chance of the two-headed coin is 1 in ${m + 1}.`,
      'How likely is this run of heads with the two-headed coin? With a fair coin?',
      'Compare the two ways of seeing these heads, weighted by how likely each coin was to be picked.',
    ],
    worked: ({ m, k }) => [
      {
        text: `P(two-headed) = 1/${m + 1}; P(these heads | two-headed) = 1; P(these heads | fair) = (1/2)^${k} = ${fmt(0.5 ** k, 4)}.`,
        value: 0.5 ** k,
        unit: '',
      },
      {
        text: `Weights: two-headed 1 × 1 = 1; fair ${m} × ${fmt(0.5 ** k, 4)} = ${fmt(m * 0.5 ** k, 4)} (both over ${m + 1}, which cancels).`,
        value: m * 0.5 ** k,
        unit: '',
      },
      {
        text: `P(two-headed | heads) = 1 / (1 + ${fmt(m * 0.5 ** k, 4)}) ≈ ${fmt(100 / (1 + m * 0.5 ** k), 1)}%.`,
        value: 100 / (1 + m * 0.5 ** k),
        unit: '%',
      },
    ],
  }),

  fixed({
    id: 'br-disc-enough-info',
    kcs: [K, 'base-rates'],
    capability: 'discriminate',
    params: (rng) => ({
      c: rng.pick(SCREENS),
      p: rng.pick([0.01, 0.02, 0.05]),
      s: rng.pick([0.9, 0.95]),
      f: rng.pick([0.05, 0.1]),
      miss: rng.pick(['none', 'prev', 'fpr'] as const),
    }),
    text: ({ c, p, s, f, miss }) => {
      const facts = [miss === 'prev' ? '' : c.prevS(p), c.sensS(s), miss === 'fpr' ? '' : c.fprS(f)]
        .filter(Boolean)
        .join(' ');
      return `${facts} Question: "${c.ask}" Can this be answered from the information given?`;
    },
    options: ({ c, s, miss }) => {
      const yes = "Yes — Bayes' rule with the numbers given is enough";
      return [
        miss === 'prev' ? [yes, 'base-rate-neglect'] : yes,
        `No — you also need the base rate: ${c.baseQ}`,
        `No — you also need ${c.negFlag}`,
        [`Yes — it's simply the detection rate, ${pct(s)}`, 'conditional-inversion'],
      ];
    },
    correct: ({ miss }) => (miss === 'none' ? 0 : miss === 'prev' ? 1 : 2),
    hints: () => ["Bayes' rule needs three ingredients. List them.", 'Which of the three are in the question?'],
  }),

  numeric({
    id: 'br-transfer-second-test',
    kcs: [K, 'independence'],
    transfer: true,
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({ p: r.pick([0.01, 0.02, 0.05]), s: r.pick([0.9, 0.95]), f: r.pick([0.05, 0.1]) }),
        ({ p, s, f }) => {
          const ans = (100 * p * s * s) / (p * s * s + (1 - p) * f * f);
          return spread([ans, 100 * s], 0.6) && spread([ans, (100 * s * s) / (s * s + f * f)], 0.6);
        },
      ),
    text: ({ p, s, f }) =>
      `A condition affects ${pct(p)} of people. A test comes back positive for ${pct(s)} of people who have it and for ${pct(f)} of people who don't. A person tests positive, then takes the test a second time, and it is positive again. Assume that, given whether someone has the condition, the two results are independent. What is the probability that they have the condition? Give a percent, rounded to one decimal place.`,
    solve: ({ p, s, f }) => (100 * p * s * s) / (p * s * s + (1 - p) * f * f),
    wrong: {
      'conditional-inversion': ({ s }) => 100 * s,
      'base-rate-neglect': ({ s, f }) => (100 * s * s) / (s * s + f * f),
    },
    hints: () => [
      "Do Bayes' rule once for the first positive result.",
      'Use that answer as the new prior for the second result.',
    ],
    worked: ({ p, s, f }) => {
      const p1 = posterior(p, s, f),
        p2 = posterior(p1, s, f);
      return [
        {
          text: `After the first positive: ${pct(p)} × ${pct(s)} ÷ (${pct(p)} × ${pct(s)} + ${pct(1 - p)} × ${pct(f)}) ≈ ${pct(p1, 1)}.`,
          value: 100 * p1,
          unit: '%',
        },
        {
          text: `Use ${pct(p1, 1)} as the new prior: ${pct(p1, 1)} × ${pct(s)} ÷ (${pct(p1, 1)} × ${pct(s)} + ${pct(1 - p1, 1)} × ${pct(f)}) ≈ ${pct(p2, 1)}.`,
          value: 100 * p2,
          unit: '%',
        },
      ];
    },
  }),
];

export default t;
