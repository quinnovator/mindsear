import type { ItemTemplate } from '../../../../../shared/content.ts';
import { choice, fmt, freqBase, free, numeric, PCT1, pct, predict, retry, spread } from '../lib.ts';
import { posterior, SCREENS, scenario } from '../contexts.ts';

const K = 'base-rates';

const t: ItemTemplate[] = [
  free({
    id: 'bas-recall-definitions',
    kcs: [K],
    capability: 'recall',
    text: () => 'What is a base rate, and what is "base-rate neglect"?',
    expect: {
      def: 'The base rate is how common something is in the population before any evidence — the prior.',
      neglect:
        'Base-rate neglect is judging P(H | evidence) from the accuracy of the evidence alone, ignoring how rare H is.',
      effect: 'With a rare condition, even an accurate test produces many false positives.',
    },
    reference: () =>
      'The base rate is how common a condition or event is before you see any evidence — the prior probability. Base-rate neglect means judging how likely something is from the evidence\'s accuracy alone (e.g. "the test is 95% accurate, so a positive means 95%"), ignoring that when the condition is rare, false positives from the large unaffected group can outnumber the true positives.',
    hints: () => [
      '"Base" as in starting point: what do you know before the evidence?',
      'What goes wrong if you skip that starting point?',
    ],
  }),

  free({
    id: 'bas-explain-two-populations',
    kcs: [K],
    capability: 'explain',
    params: (rng) => ({
      s: rng.pick([0.9, 0.95]),
      f: rng.pick([0.05, 0.1]),
      p1: rng.pick([0.005, 0.01]),
      p2: rng.pick([0.2, 0.3]),
    }),
    text: ({ s, f, p1, p2 }) =>
      `The same test — positive for ${pct(s)} of people who have a condition and for ${pct(f)} of people who don't — is used in two places: general screening, where ${pct(p1)} of people have the condition, and a specialist clinic, where ${pct(p2)} do. Explain why a positive result means something very different in the two places.`,
    expect: {
      fp: 'In general screening the healthy group is huge, so false positives outnumber true positives.',
      clinic: 'In the clinic, true positives make up most of the positives.',
      prior: 'The test is identical; the difference comes entirely from the base rate.',
    },
    reference: ({ s, f, p1, p2 }) => {
      const n = freqBase(p1, p1 * s, (1 - p1) * f, p2 * s, (1 - p2) * f);
      return `Out of ${fmt(n)} screened people, ${fmt(n * p1)} have the condition and ${fmt(n * p1 * s)} of them test positive, but ${fmt(n * (1 - p1) * f)} of the healthy people do too — so only about ${pct(posterior(p1, s, f), 1)} of positives are real. In the clinic, out of ${fmt(n)} patients, ${fmt(n * p2 * s)} true positives face ${fmt(n * (1 - p2) * f)} false ones, so about ${pct(posterior(p2, s, f), 1)} of positives are real. The test is the same; only the base rate differs.`;
    },
    hints: () => [
      'Picture 10,000 people in each place. How many have the condition?',
      'In each place, compare the true positives with the false positives.',
    ],
  }),

  predict({
    id: 'bas-predict-population',
    kcs: [K],
    params: (rng) => ({
      c: rng.pick(SCREENS),
      p: rng.pick([0.01, 0.02, 0.05]),
      s: rng.pick([0.9, 0.95]),
      f: rng.pick([0.05, 0.1]),
      kind: rng.pick(['rarer', 'common', 'more'] as const),
    }),
    text: ({ c, p, s, f, kind }) => {
      const change =
        kind === 'rarer'
          ? `The same detector is moved to a setting where only ${pct(p / 5)} are ${c.actualPos}.`
          : kind === 'common'
            ? `The same detector is moved to a setting where ${pct(p * 4)} are ${c.actualPos}.`
            : `Ten times as many ${c.unitPl}, from the same population, go through the detector.`;
      return `${scenario(c, p, s, f)} ${change} What happens to the share of ${c.posPl} that are really ${c.Hs === 'condition' ? 'cases of the condition' : c.Hs}?`;
    },
    answer: ({ kind }) => (kind === 'rarer' ? 'down' : kind === 'common' ? 'up' : 'same'),
    miscon: ({ kind }) => (kind === 'more' ? {} : { same: 'base-rate-neglect' }),
    hints: () => [
      "The detector's rates don't change. What does?",
      'Compare the size of the true-positive branch with the false-positive branch.',
    ],
  }),

  numeric({
    id: 'bas-apply-false-per-true',
    kcs: [K],
    unit: '',
    tol: { abs: 0.1, rel: 0.01 },
    params: (rng) => ({
      c: rng.pick(SCREENS),
      p: rng.pick([0.001, 0.005, 0.01, 0.02]),
      s: rng.pick([0.8, 0.9, 0.99]),
      f: rng.pick([0.01, 0.02, 0.05]),
    }),
    text: ({ c, p, s, f }) =>
      `${scenario(c, p, s, f)} Among all the ${c.posPl}, how many false positives are there for each true positive? Round to one decimal place.`,
    solve: ({ p, s, f }) => ((1 - p) * f) / (p * s),
    wrong: { 'base-rate-neglect': ({ s, f }) => f / s },
    hints: ({ c }) => [
      'Pick a large round population, such as 100,000.',
      `How many true positives come from the ${c.actualPos}? How many false positives from the ${c.actualNeg}?`,
      'Divide false positives by true positives.',
    ],
    worked: ({ c, p, s, f }) => [
      {
        text: `Out of 100,000: ${c.actualPos} = ${fmt(100000 * p)}, of which ${c.Es} = ${fmt(100000 * p * s, 1)} (true positives).`,
        value: 100000 * p * s,
        unit: '',
      },
      {
        text: `${c.actualNeg[0].toUpperCase() + c.actualNeg.slice(1)} = ${fmt(100000 * (1 - p))}, of which ${c.Es} = ${fmt(100000 * (1 - p) * f, 1)} (false positives).`,
        value: 100000 * (1 - p) * f,
        unit: '',
      },
      {
        text: `False per true: ${fmt(100000 * (1 - p) * f, 1)} ÷ ${fmt(100000 * p * s, 1)} ≈ ${fmt(((1 - p) * f) / (p * s), 1)}.`,
        value: ((1 - p) * f) / (p * s),
        unit: '',
      },
    ],
  }),

  numeric({
    id: 'bas-apply-clinic',
    kcs: [K, 'bayes-rule'],
    unit: '%',
    tol: PCT1,
    params: (rng) =>
      retry(
        rng,
        (r) => ({
          p1: r.pick([0.005, 0.01]),
          p2: r.pick([0.1, 0.2, 0.3]),
          s: r.pick([0.85, 0.9, 0.95]),
          f: r.pick([0.05, 0.1]),
        }),
        ({ p2, s, f }) =>
          spread([100 * posterior(p2, s, f), 100 * s], 0.6) &&
          spread([100 * posterior(p2, s, f), (100 * s) / (s + f)], 0.6),
      ),
    text: ({ p1, p2, s, f }) =>
      `A test comes back positive for ${pct(s)} of people who have a condition and for ${pct(f)} of people who don't. In the general population ${pct(p1)} of people have the condition, but this test is being used in a clinic for people with symptoms, where ${pct(p2)} have it. A clinic patient tests positive. What is the probability that they have the condition? Give a percent, rounded to one decimal place.`,
    solve: ({ p2, s, f }) => 100 * posterior(p2, s, f),
    wrong: { 'base-rate-neglect': ({ s, f }) => (100 * s) / (s + f), 'conditional-inversion': ({ s }) => 100 * s },
    hints: () => [
      'Which base rate applies to this patient — the general population, or the clinic?',
      "Imagine 1,000 clinic patients and split them by the clinic's base rate.",
    ],
    worked: ({ p2, s, f }) => [
      {
        text: `Out of 1,000 clinic patients: ${fmt(1000 * p2)} have it; true positives = ${fmt(1000 * p2 * s)}.`,
        value: 1000 * p2 * s,
        unit: '',
      },
      {
        text: `${fmt(1000 * (1 - p2))} don't; false positives = ${fmt(1000 * (1 - p2) * f)}.`,
        value: 1000 * (1 - p2) * f,
        unit: '',
      },
      {
        text: `P(condition | positive) = ${fmt(1000 * p2 * s)} / ${fmt(1000 * (p2 * s + (1 - p2) * f))} ≈ ${pct(posterior(p2, s, f), 1)}.`,
        value: 100 * posterior(p2, s, f),
        unit: '%',
      },
    ],
  }),

  choice({
    id: 'bas-disc-justified-conclusion',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) =>
      retry(
        rng,
        (r) => ({
          p: r.pick([0.001, 0.005, 0.01, 0.02, 0.2, 0.3, 0.5]),
          s: r.pick([0.9, 0.95, 0.99]),
          f: r.pick([0.01, 0.05, 0.1]),
        }),
        ({ p, s, f }) => Math.abs(posterior(p, s, f) - 0.5) > 0.1 && Math.abs(posterior(p, s, f) - s) > 0.02,
      ),
    text: ({ p, s, f }) => `${scenario(SCREENS[0], p, s, f)} A patient tests positive. Which conclusion is justified?`,
    right: ({ p, s, f }) =>
      posterior(p, s, f) > 0.5
        ? 'More likely than not they have it: true positives outnumber false positives here'
        : "More likely than not they don't have it: false positives outnumber true positives here",
    wrong: ({ p, s, f }) => [
      // When the posterior is high, "they probably have it" is true, so the misconception distractor becomes a wrong exact number instead.
      posterior(p, s, f) > 0.5
        ? [`The chance they have it is exactly ${pct(s)}, the test's detection rate`, 'conditional-inversion']
        : [`They very probably have it: the test catches ${pct(s)} of cases`, 'base-rate-neglect'],
      posterior(p, s, f) > 0.5
        ? "More likely than not they don't have it: false positives outnumber true positives here"
        : 'More likely than not they have it: true positives outnumber false positives here',
      ["It's 50/50: either they have it or they don't", 'outcomes-equally-likely'],
    ],
    hints: () => [
      'Picture 10,000 people and split them by the base rate first.',
      'Compare the number of true positives with the number of false positives.',
    ],
  }),

  numeric({
    id: 'bas-transfer-break-even-prevalence',
    kcs: [K, 'bayes-rule'],
    transfer: true,
    unit: '%',
    tol: { abs: 0.1 },
    params: (rng) => ({ s: rng.pick([0.8, 0.9, 0.95, 0.99]), f: rng.pick([0.01, 0.02, 0.05, 0.1]) }),
    text: ({ s, f }) =>
      `A test comes back positive for ${pct(s)} of people who have a condition and for ${pct(f)} of people who don't. How common would the condition have to be (what base rate) for a positive result to mean exactly a 50% chance of having it? Give a percent, rounded to one decimal place.`,
    solve: ({ s, f }) => (100 * f) / (s + f),
    hints: () => [
      'A 50% chance means true positives and false positives are equal in number.',
      'Call the base rate p. Write true positives and false positives in terms of p, and set them equal.',
    ],
    worked: ({ s, f }) => [
      { text: `Set true positives = false positives: p × ${fmt(s)} = (1 − p) × ${fmt(f)}.`, value: s, unit: '' },
      {
        text: `So p × (${fmt(s)} + ${fmt(f)}) = ${fmt(f)}, giving p = ${fmt(f)} ÷ ${fmt(s + f)} ≈ ${pct(f / (s + f), 1)}.`,
        value: (100 * f) / (s + f),
        unit: '%',
      },
    ],
  }),
];

export default t;
