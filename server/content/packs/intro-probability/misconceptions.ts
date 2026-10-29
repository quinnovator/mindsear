import type { MisconceptionDef } from '../../../../shared/content.ts';

export const misconceptions: MisconceptionDef[] = [
  {
    id: 'conditional-inversion',
    description:
      'Treats P(A | B) as if it were P(B | A) — e.g. reads "the test catches 90% of cases" as "a positive result means a 90% chance of having it".',
    kcs: ['conditional-direction', 'bayes-rule', 'conditional-probability', 'natural-frequencies-and-trees'],
    refutation:
      'P(A | B) looks inside the B group, while P(B | A) looks inside the A group; when the groups have different sizes, the same overlap is a different share of each. Before reading any conditional number, ask "out of which group?". The two are linked by P(A | B) = P(B | A) × P(A) / P(B), so they match only when P(A) = P(B).',
  },
  {
    id: 'base-rate-neglect',
    description:
      'Judges P(H | evidence) from the accuracy of the evidence alone, ignoring how rare H is to begin with — in effect treating the prior as 50/50.',
    kcs: ['base-rates', 'bayes-rule', 'natural-frequencies-and-trees'],
    refutation:
      "When H is rare, the not-H group is huge, so even a small false-positive rate produces more false alarms than there are true cases. Start from the base rate: picture 1,000 cases, split them by how common H is, then apply the test's rates to each group and compare the two positive branches.",
  },
  {
    id: 'gamblers-fallacy',
    description:
      'Believes that after a streak in independent trials the other outcome becomes "due", or that "random-looking" sequences are more likely than streaky ones.',
    kcs: ['independence'],
    refutation:
      'Independent trials have no memory: the coin or wheel does not know what happened before, so each trial has the same probabilities as always, and every specific sequence of fair flips is equally likely. Long-run frequencies even out because many future trials dilute a streak, not because later trials compensate for it.',
  },
  {
    id: 'exclusive-means-independent',
    description: 'Thinks mutually exclusive events are independent, or uses the two words interchangeably.',
    kcs: ['mutually-exclusive-vs-independent', 'independence'],
    refutation:
      'Mutually exclusive means the events cannot both happen, so learning one happened tells you the other did not — that is strong dependence. Independence requires P(A and B) = P(A) × P(B), which is positive whenever both events are possible, whereas exclusivity forces P(A and B) = 0.',
  },
  {
    id: 'add-non-exclusive',
    description:
      'Adds P(A) + P(B) for "A or B" even when the events can happen together (forgetting to subtract the overlap), including adding chances across repeated trials for "at least one".',
    kcs: ['union-addition-rule', 'complements', 'mutually-exclusive-vs-independent'],
    refutation:
      'Adding counts every outcome where both events happen twice, which is why sums like 6 × 1/6 can reach or pass 100%. Use P(A or B) = P(A) + P(B) − P(A and B); for "at least one" across trials, use 1 − P(none).',
  },
  {
    id: 'multiply-dependent',
    description:
      'Multiplies unconditional probabilities as if events were independent when they are not — e.g. draws without replacement, or failures with a shared cause.',
    kcs: ['multiplication-rule', 'independence', 'binomial'],
    refutation:
      'P(A) × P(B) is only right when A gives no information about B. In general P(A and B) = P(A) × P(B | A): after the first draw or event, update the probability for the next one (one card fewer in the deck, a shared power supply already down).',
  },
  {
    id: 'ev-is-most-likely',
    description:
      'Thinks the expected value is the most likely outcome, or the result you should expect on a single try.',
    kcs: ['expected-value', 'binomial'],
    refutation:
      'Expected value is a probability-weighted average — the long-run mean over many repetitions — and it may not even be a possible outcome (3.5 for a die). The most likely value is the mode, a different summary; a bet can have a positive expected value even though you usually lose it.',
  },
  {
    id: 'outcomes-equally-likely',
    description:
      'Assumes every listed outcome or value is equally likely just because it is on the list (e.g. each sum of two dice is 1/11, or "it either happens or it doesn\'t, so 50/50").',
    kcs: ['sample-spaces', 'probability-axioms', 'random-variables', 'base-rates', 'binomial'],
    refutation:
      '"Favourable ÷ total" only works when the outcomes really are equally likely. Break the experiment into basic outcomes that are (such as the 36 ordered pairs for two dice), then count how many of them produce each result.',
  },
  {
    id: 'ignores-order',
    description:
      'Treats outcomes that differ only in order (HT and TH) as a single outcome when building a sample space.',
    kcs: ['sample-spaces', 'conditional-probability'],
    refutation:
      'Make the items distinguishable — a red die and a blue die, the first flip and the second flip. Then "one of each" covers two basic outcomes (HT and TH), so it is twice as likely as HH.',
  },
  {
    id: 'sum-not-one',
    description:
      'Accepts probabilities for exhaustive, non-overlapping outcomes that do not add to 1, or does not use that fact to adjust or fill in probabilities.',
    kcs: ['probability-axioms', 'random-variables'],
    refutation:
      'Exactly one outcome happens each time, so the probabilities of all the outcomes must total 1 (100%). If one probability goes up, others must go down to compensate, and a missing probability is 1 minus the rest.',
  },
  {
    id: 'wrong-complement',
    description:
      'Uses the wrong opposite event — e.g. treats the complement of "at least one" as "all" or "at least one fails", or the complement of "at least 2" as "at most 2".',
    kcs: ['complements'],
    refutation:
      'The complement is exactly the outcomes where the event fails: together the two must cover everything with no overlap. "At least one success" fails only when there are zero successes, so its complement is "none"; "at least 2" fails when there are 0 or 1.',
  },
  {
    id: 'conditional-as-joint',
    description:
      'Confuses P(A | B) with P(A and B) — divides by the whole population instead of the condition group, or reads a conditional rate as a joint one.',
    kcs: ['conditional-probability', 'natural-frequencies-and-trees', 'multiplication-rule', 'conditional-direction'],
    refutation:
      'P(A and B) is a share of everyone; P(A | B) is a share of just the B group, so P(A | B) = P(A and B) / P(B). Name the denominator before dividing: "given B" means B becomes the new whole.',
  },
  {
    id: 'ignores-condition',
    description:
      'Uses the overall rate P(A) when the question asks for P(A | B), ignoring the information in the condition.',
    kcs: ['conditional-probability', 'conditional-direction'],
    refutation:
      'Conditioning means setting aside every case where B did not happen and recomputing the share of A among what is left. The overall rate mixes in cases the condition has ruled out; it equals P(A | B) only when A and B are independent.',
  },
  {
    id: 'and-or-confusion',
    description: 'Mixes up the rules for "A and B" (multiply) and "A or B" (add, then subtract the overlap).',
    kcs: ['multiplication-rule', 'union-addition-rule'],
    refutation:
      '"A and B" needs both, so it can be no larger than either one, and comes from multiplying (with conditional probabilities when the events are dependent). "A or B" is satisfied by either, so it is at least as large as each, and comes from adding and subtracting the overlap. A quick size check catches most mix-ups.',
  },
  {
    id: 'unweighted-average',
    description:
      'Averages group rates (or possible values) without weighting by how large each group is or how likely each value is.',
    kcs: ['total-probability', 'expected-value'],
    refutation:
      'Each group contributes in proportion to its size: P(B) = Σ P(B | group) × P(group), and likewise E[X] = Σ x × P(X = x). A plain average is right only when the groups or values are equally likely.',
  },
  {
    id: 'ignores-false-positives',
    description:
      'Counts only true positives as "positives", forgetting the cases without the condition that also test positive.',
    kcs: ['natural-frequencies-and-trees', 'total-probability', 'bayes-rule'],
    refutation:
      'Positive results come from two branches of the tree: cases with the condition correctly flagged and cases without it wrongly flagged. Add both branches to get all positives; when the condition is rare, the false-positive branch is often the bigger one.',
  },
  {
    id: 'binomial-no-choose',
    description:
      'Computes p^k (1 − p)^(n − k) for "exactly k successes" without multiplying by the number of arrangements C(n, k).',
    kcs: ['binomial'],
    refutation:
      'p^k (1 − p)^(n − k) is the probability of one particular sequence, such as SSFF. "Exactly k successes" can happen in C(n, k) different orders, each with that same probability, so multiply by C(n, k).',
  },
];
