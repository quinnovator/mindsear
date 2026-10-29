import type { KCDef } from '../../../../shared/content.ts';

export const kcs: KCDef[] = [
  {
    id: 'sample-spaces',
    title: 'Sample spaces',
    kind: 'conceptual',
    prerequisites: [],
    summary:
      'A sample space is the full list of outcomes an experiment can produce, written so that exactly one of them happens each time. An event is a set of those outcomes, like "roll an even number" = {2, 4, 6}. When the outcomes are equally likely, P(event) = outcomes in the event ÷ total outcomes — but listing outcomes does not make them equally likely. Treat items as distinguishable: with two coins, HT and TH are different outcomes.',
    expectations: [
      'The sample space lists every possible outcome, with no overlaps (exactly one occurs).',
      'An event is a set of outcomes from the sample space.',
      'Counting "favourable ÷ total" only works when the outcomes are equally likely.',
      'Order matters for distinguishable items (HT and TH are separate outcomes).',
    ],
    confusable_with: ['probability-axioms', 'random-variables'],
  },
  {
    id: 'probability-axioms',
    title: 'Basic probability rules',
    kind: 'conceptual',
    prerequisites: ['sample-spaces'],
    summary:
      'Every probability is between 0 and 1 (0% to 100%). The probabilities of all the outcomes in a sample space add up to exactly 1, because exactly one of them happens. If two events cannot happen together, the probability that one or the other happens is the sum of their probabilities. The other rules in this course (complements, the addition rule) follow from these three facts.',
    expectations: [
      'Every probability lies between 0 and 1.',
      'The probabilities of all outcomes add to 1.',
      'For events that cannot happen together, P(A or B) = P(A) + P(B).',
    ],
    confusable_with: ['sample-spaces'],
  },
  {
    id: 'complements',
    title: 'Complements',
    kind: 'procedural',
    prerequisites: ['probability-axioms'],
    summary:
      'The complement of A, "not A", is every outcome where A does not happen, so P(not A) = 1 − P(A). It is most useful for "at least one" questions: the complement of "at least one success" is "no successes at all", which is often easy to compute — for independent trials, multiply the chances that each one fails. Get the opposite event right first: the opposite of "at least one" is "none", not "all" or "at least one failure".',
    expectations: [
      'P(not A) = 1 − P(A).',
      'The complement contains exactly the outcomes where A fails.',
      'The complement of "at least one" is "none".',
      'For independent trials, P(none) is the product of the individual failure chances.',
    ],
    confusable_with: ['union-addition-rule'],
  },
  {
    id: 'union-addition-rule',
    title: 'Union and addition',
    kind: 'procedural',
    prerequisites: ['probability-axioms'],
    summary:
      'P(A or B) = P(A) + P(B) − P(A and B). Adding P(A) and P(B) counts the outcomes where both happen twice, so you subtract that overlap once. Only when A and B cannot happen together (P(A and B) = 0) does the rule reduce to plain addition. In probability, "or" means at least one of them, including both.',
    expectations: [
      'P(A or B) = P(A) + P(B) − P(A and B).',
      'Subtracting the overlap fixes double counting of outcomes where both happen.',
      'Plain addition is only valid when A and B are mutually exclusive.',
    ],
    confusable_with: ['total-probability', 'multiplication-rule', 'mutually-exclusive-vs-independent'],
  },
  {
    id: 'mutually-exclusive-vs-independent',
    title: 'Exclusive vs independent',
    kind: 'conceptual',
    prerequisites: ['union-addition-rule', 'independence'],
    summary:
      'Mutually exclusive means A and B cannot happen together: P(A and B) = 0. Independent means knowing one happened does not change the chance of the other: P(A and B) = P(A) × P(B). The two are nearly opposites: if both events have positive probability and are mutually exclusive, they are strongly dependent, because learning A happened tells you B definitely did not.',
    expectations: [
      'Mutually exclusive: P(A and B) = 0 — they cannot both happen.',
      'Independent: P(A and B) = P(A) × P(B) — one gives no information about the other.',
      'Mutually exclusive events with positive probabilities are dependent, never independent.',
    ],
    confusable_with: ['independence', 'union-addition-rule'],
  },
  {
    id: 'independence',
    title: 'Independence',
    kind: 'conceptual',
    prerequisites: ['probability-axioms'],
    summary:
      'A and B are independent if learning that one happened does not change the probability of the other: P(A | B) = P(A), or equivalently P(A and B) = P(A) × P(B). Separate flips of a fair coin are independent — the coin has no memory, so a streak never makes the other side "due". Independence is something you justify from how the situation works (separate dice, drawing with replacement) or check from data; it is not a default.',
    expectations: [
      'Independence means P(A | B) = P(A): knowing B tells you nothing about A.',
      'Equivalently P(A and B) = P(A) × P(B).',
      'Independent trials have no memory, so past streaks do not change future chances.',
      'Independence must be justified (e.g. with vs without replacement), not assumed.',
    ],
    confusable_with: ['mutually-exclusive-vs-independent', 'conditional-probability'],
  },
  {
    id: 'multiplication-rule',
    title: 'Multiplication rule',
    kind: 'procedural',
    prerequisites: ['independence', 'conditional-probability'],
    summary:
      'P(A and B) = P(A) × P(B | A): the chance of A, times the chance of B once A has happened. If A and B are independent, P(B | A) = P(B) and the rule simplifies to P(A) × P(B). For events in sequence that affect each other — like drawing without replacement — use the updated probability at each later step rather than the original one.',
    expectations: [
      'General rule: P(A and B) = P(A) × P(B | A).',
      'Only for independent events does it simplify to P(A) × P(B).',
      'For dependent steps (e.g. without replacement), update the probability after each step.',
    ],
    confusable_with: ['union-addition-rule', 'independence'],
  },
  {
    id: 'conditional-probability',
    title: 'Conditional probability',
    kind: 'conceptual',
    prerequisites: ['probability-axioms'],
    summary:
      'P(A | B), "the probability of A given B", is the chance of A once you restrict attention to the cases where B happened. The formula is P(A | B) = P(A and B) / P(B). In counts: among the cases where B happened, what fraction also have A? The condition changes the denominator — you divide by the size of the B group, not by everyone.',
    expectations: [
      'Conditioning on B restricts attention to the cases where B happened.',
      'P(A | B) = P(A and B) / P(B).',
      'The denominator is the B group, not the whole population.',
      'P(A | B) is different from the joint probability P(A and B).',
    ],
    confusable_with: ['conditional-direction', 'multiplication-rule'],
  },
  {
    id: 'conditional-direction',
    title: 'P(A|B) vs P(B|A)',
    kind: 'conceptual',
    prerequisites: ['conditional-probability'],
    summary:
      'P(A | B) and P(B | A) are usually different numbers: P(A | B) looks inside the B group, P(B | A) looks inside the A group, and the shared overlap is a different share of each. They are linked by P(A | B) = P(B | A) × P(A) / P(B), so they are equal only when P(A) = P(B). Swapping them is a classic error (the "prosecutor\'s fallacy"): a tiny P(match | innocent) does not make P(innocent | match) tiny.',
    expectations: [
      'P(A | B) and P(B | A) divide the same overlap by different groups.',
      'They are related by P(A | B) = P(B | A) × P(A) / P(B).',
      'They are equal only when P(A) = P(B).',
    ],
    confusable_with: ['conditional-probability', 'bayes-rule'],
  },
  {
    id: 'natural-frequencies-and-trees',
    title: 'Natural frequencies',
    kind: 'procedural',
    prerequisites: ['conditional-probability'],
    summary:
      "Turn percentages into counts out of a round number (say 1,000 people). Split them first by the base rate (how many have the condition), then split each group by its own conditional rate (how many test positive). Each branch count is the group size times its rate, and a conditional question becomes a simple fraction of counts — such as true positives out of all positives — which is the same answer Bayes' rule gives, but much harder to get wrong.",
    expectations: [
      'Start from a round number of cases.',
      'Split first by the base rate, then split each group by its own conditional rate.',
      'Answer conditional questions as count ÷ count, dividing by the group named after "given".',
    ],
    confusable_with: ['total-probability', 'bayes-rule'],
  },
  {
    id: 'total-probability',
    title: 'Total probability',
    kind: 'procedural',
    prerequisites: ['natural-frequencies-and-trees'],
    summary:
      "To get the overall chance of B when the population splits into non-overlapping groups, weight each group's rate by the group's share and add: P(B) = P(B | A) P(A) + P(B | not A) P(not A). It is a weighted average, so the answer always lies between the group rates and sits closer to the rate of the bigger group. It is also the denominator in Bayes' rule.",
    expectations: [
      'Split into groups that do not overlap and cover everyone.',
      "Weight each group's rate by that group's probability, then add.",
      'The result is a weighted average lying between the group rates.',
    ],
    confusable_with: ['union-addition-rule', 'bayes-rule'],
  },
  {
    id: 'bayes-rule',
    title: "Bayes' rule",
    kind: 'procedural',
    prerequisites: ['total-probability', 'conditional-direction'],
    summary:
      "Bayes' rule turns P(evidence | hypothesis) into P(hypothesis | evidence): P(H | E) = P(E | H) P(H) / P(E), where P(E) = P(E | H) P(H) + P(E | not H) P(not H). In words: of all the ways the evidence can show up, what share come from H being true? The prior P(H) matters as much as the accuracy of the evidence.",
    expectations: [
      'P(H | E) = P(E | H) × P(H) / P(E).',
      'P(E) comes from total probability: true positives plus false positives.',
      'The answer is the share of all evidence cases that come from H.',
      'The prior P(H) strongly affects the answer.',
    ],
    confusable_with: ['base-rates', 'conditional-direction', 'total-probability'],
  },
  {
    id: 'base-rates',
    title: 'Base rates',
    kind: 'conceptual',
    prerequisites: ['bayes-rule'],
    summary:
      'The base rate is how common something is before you see any evidence — the prior. When the base rate is low, even an accurate test produces many false positives, simply because there are so many more negatives for it to make mistakes on, so a positive result can still mean "probably not". Ignoring the base rate (base-rate neglect) makes rare things look far likelier than they are, and the same test result means different things in different populations.',
    expectations: [
      'The base rate is the prior: how common the condition is before any evidence.',
      'With a low base rate, false positives can outnumber true positives.',
      'The same test result means different things in populations with different base rates.',
    ],
    confusable_with: ['bayes-rule'],
  },
  {
    id: 'random-variables',
    title: 'Random variables',
    kind: 'conceptual',
    prerequisites: ['probability-axioms'],
    summary:
      'A random variable assigns a number to each outcome of a random experiment — like the number of heads in three flips, or the profit from a bet. Its distribution lists each possible value together with its probability, and those probabilities add to 1. Several outcomes can give the same value, so the values are usually not equally likely.',
    expectations: [
      'A random variable is a number determined by the outcome of a random experiment.',
      'Its distribution gives each possible value with its probability, totalling 1.',
      'Several outcomes can map to the same value, so values need not be equally likely.',
    ],
    confusable_with: ['sample-spaces', 'expected-value'],
  },
  {
    id: 'expected-value',
    title: 'Expected value',
    kind: 'procedural',
    prerequisites: ['random-variables'],
    summary:
      'The expected value E[X] is the long-run average of X over many repetitions: multiply each value by its probability and add, E[X] = Σ x × P(X = x). It does not have to be a value X can actually take, and it is not the most likely value — it is a balance point. Expected values add: E[X + Y] = E[X] + E[Y], and E[aX + b] = a E[X] + b.',
    expectations: [
      'E[X] = sum of each value times its probability.',
      'It is the long-run average over many repetitions.',
      'It need not be a possible value, and it is not the most likely value.',
    ],
    confusable_with: ['random-variables', 'binomial'],
  },
  {
    id: 'binomial',
    title: 'Binomial counts',
    kind: 'procedural',
    prerequisites: ['multiplication-rule', 'expected-value'],
    summary:
      'A binomial count X is the number of successes in n independent trials that each succeed with the same probability p. P(X = k) = C(n, k) p^k (1 − p)^(n − k): p^k (1 − p)^(n − k) is the chance of one particular sequence, and C(n, k) counts how many sequences have exactly k successes. Its mean is n × p. Check the conditions — fixed n, two outcomes per trial, independence, constant p — before using it.',
    expectations: [
      'Conditions: fixed number of trials, success/failure, independent, same p each time.',
      'P(X = k) = C(n, k) p^k (1 − p)^(n − k).',
      'C(n, k) counts the arrangements of which trials are successes.',
      'The expected count is n × p.',
    ],
    confusable_with: ['multiplication-rule', 'expected-value'],
  },
];
