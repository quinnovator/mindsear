// A tiny two-KC pack used by engine tests (independent of the real library pack).
import type { PackDef, ItemTemplate } from '../shared/content.ts';

const base = (id: string, kc: string, extra: Partial<ItemTemplate>): ItemTemplate => ({
  meta: { id, kcs: [kc], capability: 'apply', widget: 'numeric', unit: '%', tolerance: { abs: 0.5 } },
  params: (r) => ({ prev: r.pick([0.01, 0.02]), sens: r.pick([0.9, 0.95]), fpr: r.pick([0.05, 0.1]) }),
  text: (p) =>
    `Prevalence ${p.prev * 100}%, sensitivity ${p.sens * 100}%, FPR ${p.fpr * 100}%. P(condition | positive)?`,
  hints: () => [
    'Which group is the rate taken over?',
    'Imagine 1,000 cases.',
    'Of everything flagged, what share is truly positive?',
  ],
  ...extra,
});
const solve = (p: any) => (100 * p.prev * p.sens) / (p.prev * p.sens + (1 - p.prev) * p.fpr);

export const fixture: PackDef = {
  id: 'fx',
  version: '0.0.1',
  title: 'Fixture',
  description: 'test pack',
  goals: {
    follow: { capabilities: ['explain', 'discriminate'], transfer: false, label: 'Follow', blurb: '', hours: 1 },
    solve: { capabilities: ['explain', 'discriminate', 'apply'], transfer: true, label: 'Solve', blurb: '', hours: 2 },
    teach: {
      capabilities: ['recall', 'explain', 'predict', 'apply', 'discriminate'],
      transfer: true,
      label: 'Teach',
      blurb: '',
      hours: 3,
    },
  },
  kcs: [
    {
      id: 'cond',
      title: 'Conditional probability',
      kind: 'conceptual',
      summary: 'P(A|B) is the share of B where A also holds.',
      expectations: ['restricts to B'],
      prerequisites: [],
      confusable_with: [],
    },
    {
      id: 'bayes',
      title: "Bayes' rule",
      kind: 'procedural',
      summary: 'Flip a conditional using base rates.',
      expectations: ['base rate matters', 'flagged group is mostly false positives'],
      prerequisites: ['cond'],
      confusable_with: ['cond'],
    },
  ],
  misconceptions: [
    {
      id: 'conditional-inversion',
      description: 'Treats P(A|B) as P(B|A)',
      kcs: ['bayes', 'cond'],
      refutation: 'The 90% is taken over the sick, not over the positives.',
    },
    {
      id: 'base-rate-neglect',
      description: 'Ignores how rare the condition is',
      kcs: ['bayes'],
      refutation: 'Rare conditions make most positives false.',
    },
  ],
  templates: [
    base('bayes-apply', 'bayes', {
      meta: {
        id: 'bayes-apply',
        kcs: ['bayes'],
        capability: 'apply',
        widget: 'numeric',
        unit: '%',
        tolerance: { abs: 0.5 },
        discriminates: ['conditional-inversion', 'base-rate-neglect'],
      },
      solve,
      wrongSolve: {
        'conditional-inversion': (p) => 100 * p.sens,
        'base-rate-neglect': (p) => (100 * p.sens) / (p.sens + p.fpr),
      },
      worked: (p) => [
        { text: `Of 1,000 people, sick: ${1000 * p.prev}`, value: 1000 * p.prev },
        { text: `True positives = ${1000 * p.prev * p.sens}`, value: 1000 * p.prev * p.sens },
        { text: `False positives = ${(1000 * (1 - p.prev) * p.fpr).toFixed(1)}`, value: 1000 * (1 - p.prev) * p.fpr },
        { text: `P = ${solve(p).toFixed(1)}%`, value: solve(p), unit: '%' },
      ],
    }),
    base('bayes-apply-2', 'bayes', {
      meta: {
        id: 'bayes-apply-2',
        kcs: ['bayes'],
        capability: 'apply',
        widget: 'numeric',
        unit: '%',
        tolerance: { abs: 0.5 },
      },
      solve,
      wrongSolve: { 'conditional-inversion': (p) => 100 * p.sens },
    }),
    base('bayes-transfer', 'bayes', {
      meta: {
        id: 'bayes-transfer',
        kcs: ['bayes'],
        capability: 'apply',
        widget: 'numeric',
        unit: '%',
        tolerance: { abs: 0.5 },
        is_transfer: true,
      },
      solve,
    }),
    base('bayes-disc', 'bayes', {
      meta: {
        id: 'bayes-disc',
        kcs: ['bayes'],
        capability: 'discriminate',
        widget: 'mcq',
        discriminates: ['conditional-inversion'],
      },
      params: () => ({}),
      text: () => 'Is 90% P(flag|fraud) or P(fraud|flag)?',
      mcq: () => ({
        options: [{ text: 'P(flag | fraud)' }, { text: 'P(fraud | flag)', misconception: 'conditional-inversion' }],
        correct: 0,
      }),
    }),
    base('bayes-explain', 'bayes', {
      meta: { id: 'bayes-explain', kcs: ['bayes'], capability: 'explain', widget: 'free_text' },
      params: () => ({}),
      text: () => 'Why are most flags false alarms?',
      rubric: {
        expectations: [{ id: 'size', text: 'legit group is much larger' }],
        reference: () => 'Because legit transactions vastly outnumber fraud.',
      },
    }),
    base('bayes-predict', 'bayes', {
      meta: { id: 'bayes-predict', kcs: ['bayes'], capability: 'predict', widget: 'mcq' },
      params: () => ({}),
      text: () => 'Prevalence goes up. P(sick|pos)?',
      mcq: () => ({
        options: [
          { text: 'Goes up' },
          { text: 'Goes down', misconception: 'base-rate-neglect' },
          { text: 'Stays the same', misconception: 'base-rate-neglect' },
        ],
        correct: 0,
      }),
    }),
    base('cond-disc', 'cond', {
      meta: {
        id: 'cond-disc',
        kcs: ['cond'],
        capability: 'discriminate',
        widget: 'mcq',
        discriminates: ['conditional-inversion'],
      },
      params: () => ({}),
      text: () => 'Which is larger?',
      mcq: () => ({
        options: [{ text: 'P(A|B)' }, { text: 'P(B|A)', misconception: 'conditional-inversion' }],
        correct: 0,
      }),
    }),
    base('cond-apply', 'cond', {
      meta: { id: 'cond-apply', kcs: ['cond'], capability: 'apply', widget: 'mcq' },
      params: () => ({}),
      text: () => 'Pick the conditional.',
      mcq: () => ({
        options: [{ text: 'right' }, { text: 'wrong', misconception: 'conditional-inversion' }],
        correct: 0,
      }),
    }),
  ],
};
