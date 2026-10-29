import type { PackDef } from '../../../../shared/content.ts';
import { kcs } from './kcs.ts';
import { misconceptions } from './misconceptions.ts';
import sampleSpaces from './templates/sample-spaces.ts';
import probabilityAxioms from './templates/probability-axioms.ts';
import complements from './templates/complements.ts';
import unionAddition from './templates/union-addition-rule.ts';
import exclusiveVsIndependent from './templates/mutually-exclusive-vs-independent.ts';
import independence from './templates/independence.ts';
import multiplication from './templates/multiplication-rule.ts';
import conditional from './templates/conditional-probability.ts';
import conditionalDirection from './templates/conditional-direction.ts';
import naturalFrequencies from './templates/natural-frequencies-and-trees.ts';
import totalProbability from './templates/total-probability.ts';
import bayes from './templates/bayes-rule.ts';
import baseRates from './templates/base-rates.ts';
import randomVariables from './templates/random-variables.ts';
import expectedValue from './templates/expected-value.ts';
import binomial from './templates/binomial.ts';

const pack: PackDef = {
  id: 'intro-probability',
  version: '1.0.0',
  title: 'Intro probability',
  description:
    "The core ideas of probability — from sample spaces and conditional probability to Bayes' rule, base rates and expected value — taught through real-world risk, screening and decision problems.",
  goals: {
    follow: {
      label: 'Follow a discussion',
      blurb: 'Understand the ideas well enough to read a paper or a news story about risk without getting fooled.',
      capabilities: ['explain', 'discriminate'],
      transfer: false,
      hours: 3,
    },
    solve: {
      label: 'Solve problems',
      blurb: "Work out real probabilities on your own, including in situations you haven't seen before.",
      capabilities: ['explain', 'discriminate', 'apply'],
      transfer: true,
      hours: 6,
    },
    teach: {
      label: 'Teach it',
      blurb: 'Everything above, plus predicting outcomes and recalling the formulas cold.',
      capabilities: ['recall', 'explain', 'predict', 'apply', 'discriminate'],
      transfer: true,
      hours: 9,
    },
  },
  kcs,
  misconceptions,
  templates: [
    ...sampleSpaces,
    ...probabilityAxioms,
    ...complements,
    ...unionAddition,
    ...exclusiveVsIndependent,
    ...independence,
    ...multiplication,
    ...conditional,
    ...conditionalDirection,
    ...naturalFrequencies,
    ...totalProbability,
    ...bayes,
    ...baseRates,
    ...randomVariables,
    ...expectedValue,
    ...binomial,
  ],
};

export default pack;
