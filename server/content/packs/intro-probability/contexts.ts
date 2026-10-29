// Screening-style contexts (a hidden condition H and an imperfect detector E), shared by the
// natural-frequency, total-probability, Bayes and base-rate templates.
import type { WorkedStep } from '../../../../shared/content.ts';
import { cap, fmt, freqBase, pct } from './lib.ts';

export interface Screen {
  key: string;
  unitPl: string; // "transactions"
  prevS(p: number): string; // base-rate sentence
  sensS(s: number): string; // detection-rate sentence
  fprS(f: number): string; // false-positive sentence
  ask: string; // the P(H | E) question
  posPl: string; // "flagged transactions"
  posOne: string; // "flag"
  actualPos: string; // "fraudulent transactions"
  actualNeg: string; // "legitimate transactions"
  posFlag: string; // "how often fraudulent transactions get flagged"
  negFlag: string; // "how often legitimate transactions get flagged"
  Hs: string; // short label for H in P(H | E)
  Es: string; // short label for E
  baseQ: string; // "how common fraud is"
}

export const SCREENS: Screen[] = [
  {
    key: 'disease',
    unitPl: 'people',
    prevS: (p) => `A condition affects ${pct(p)} of people.`,
    sensS: (s) => `A screening test comes back positive for ${pct(s)} of people who have the condition.`,
    fprS: (f) => `It also comes back positive for ${pct(f)} of people who don't have it.`,
    ask: 'Someone tests positive. What is the probability that they actually have the condition?',
    posPl: 'people who test positive',
    posOne: 'positive result',
    actualPos: 'people with the condition',
    actualNeg: 'people without the condition',
    posFlag: 'how often people with the condition test positive',
    negFlag: 'how often people without the condition test positive',
    Hs: 'condition',
    Es: 'positive',
    baseQ: 'how common the condition is',
  },
  {
    key: 'fraud',
    unitPl: 'transactions',
    prevS: (p) => `${pct(p)} of card transactions are fraudulent.`,
    sensS: (s) => `A fraud detector flags ${pct(s)} of fraudulent transactions.`,
    fprS: (f) => `It also flags ${pct(f)} of legitimate transactions.`,
    ask: 'A transaction is flagged. What is the probability that it is actually fraudulent?',
    posPl: 'flagged transactions',
    posOne: 'flag',
    actualPos: 'fraudulent transactions',
    actualNeg: 'legitimate transactions',
    posFlag: 'how often fraudulent transactions get flagged',
    negFlag: 'how often legitimate transactions get flagged',
    Hs: 'fraud',
    Es: 'flagged',
    baseQ: 'how common fraud is',
  },
  {
    key: 'spam',
    unitPl: 'emails',
    prevS: (p) => `${pct(p)} of incoming emails are spam.`,
    sensS: (s) => `A spam filter flags ${pct(s)} of spam emails.`,
    fprS: (f) => `It also flags ${pct(f)} of legitimate emails.`,
    ask: 'An email is flagged. What is the probability that it is actually spam?',
    posPl: 'flagged emails',
    posOne: 'flag',
    actualPos: 'spam emails',
    actualNeg: 'legitimate emails',
    posFlag: 'how often spam emails get flagged',
    negFlag: 'how often legitimate emails get flagged',
    Hs: 'spam',
    Es: 'flagged',
    baseQ: 'how common spam is',
  },
  {
    key: 'defect',
    unitPl: 'parts',
    prevS: (p) => `${pct(p)} of parts from a production line are defective.`,
    sensS: (s) => `An automated scanner rejects ${pct(s)} of defective parts.`,
    fprS: (f) => `It also rejects ${pct(f)} of good parts.`,
    ask: 'A part is rejected. What is the probability that it is actually defective?',
    posPl: 'rejected parts',
    posOne: 'rejection',
    actualPos: 'defective parts',
    actualNeg: 'good parts',
    posFlag: 'how often defective parts get rejected',
    negFlag: 'how often good parts get rejected',
    Hs: 'defective',
    Es: 'rejected',
    baseQ: 'how common defective parts are',
  },
];

export const scenario = (c: Screen, p: number, s: number, f: number): string =>
  `${c.prevS(p)} ${c.sensS(s)} ${c.fprS(f)}`;

/** P(H | E) as a fraction. */
export const posterior = (p: number, s: number, f: number): number => (p * s) / (p * s + (1 - p) * f);

/** Natural-frequency counts for a screening tree. */
export function tree(p: number, s: number, f: number) {
  const n = freqBase(p, p * s, (1 - p) * f);
  const pos = n * p,
    tp = pos * s,
    neg = n - pos,
    fp = neg * f;
  return { n, pos, tp, neg, fp, flagged: tp + fp };
}

/** Worked natural-frequency solution of P(H | E), ending in a percent. */
export function bayesSteps(c: Screen, p: number, s: number, f: number): WorkedStep[] {
  const t = tree(p, s, f);
  return [
    {
      text: `Picture ${fmt(t.n)} ${c.unitPl}. ${cap(c.actualPos)}: ${fmt(t.n)} × ${pct(p)} = ${fmt(t.pos)}.`,
      value: t.pos,
      unit: '',
    },
    { text: `Of those, ${c.Es}: ${fmt(t.pos)} × ${pct(s)} = ${fmt(t.tp)} (true positives).`, value: t.tp, unit: '' },
    {
      text: `${cap(c.actualNeg)}: ${fmt(t.neg)}. Of those, ${c.Es}: ${fmt(t.neg)} × ${pct(f)} = ${fmt(t.fp)} (false positives).`,
      value: t.fp,
      unit: '',
    },
    { text: `All ${c.posPl}: ${fmt(t.tp)} + ${fmt(t.fp)} = ${fmt(t.flagged)}.`, value: t.flagged, unit: '' },
    {
      text: `Share of them that are real: ${fmt(t.tp)} / ${fmt(t.flagged)} ≈ ${pct(t.tp / t.flagged, 1)}.`,
      value: (100 * t.tp) / t.flagged,
      unit: '%',
    },
  ];
}
