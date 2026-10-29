import type { ItemTemplate } from '../../../../../shared/content.ts';
import { COUNT, fixed, fmt, free, numeric, pct, predict, retry } from '../lib.ts';

const K = 'independence';

const REASONABLE = [
  { s: 'two flips of the same fair coin', ok: true },
  { s: 'the results of two separate dice rolled together', ok: true },
  { s: 'whether two strangers, picked at random in different countries, are left-handed', ok: true },
  { s: "a fair die's result today and its result tomorrow", ok: true },
  { s: 'the first and second cards drawn from one deck, without putting the first back', ok: false },
  { s: 'whether two people who share a flat both catch the flu this winter', ok: false },
  { s: 'whether it rains today and whether it rains tomorrow in the same town', ok: false },
  { s: 'whether two servers in the same rack, sharing one power supply, both go down tonight', ok: false },
];
const YES = 'Reasonable — one result gives no information about the other';
const NO = 'Not reasonable — one result changes the chances of the other';

const SEQS = [
  { kind: 'coin', run: 'HHHHHH', mixed: 'HTHHTT', n: 6 },
  { kind: 'coin', run: 'TTTTT', mixed: 'THHTH', n: 5 },
  { kind: 'lottery', run: '1, 2, 3, 4, 5, 6', mixed: '4, 17, 23, 31, 38, 45', n: 6 },
];

const t: ItemTemplate[] = [
  free({
    id: 'ind-recall-definition',
    kcs: [K],
    capability: 'recall',
    text: () => 'Give two equivalent ways to say that events A and B are independent.',
    expect: {
      cond: 'P(A | B) = P(A): learning that B happened does not change the chance of A.',
      prod: 'P(A and B) = P(A) × P(B).',
    },
    reference: () =>
      'A and B are independent if P(A | B) = P(A) — knowing B happened tells you nothing about A. Equivalently, P(A and B) = P(A) × P(B).',
    hints: () => ['One version uses a conditional probability.', 'The other version is about P(A and B).'],
  }),

  free({
    id: 'ind-explain-due',
    kcs: [K],
    capability: 'explain',
    params: (rng) => ({ n: rng.pick([5, 6, 7, 8]), roulette: rng.next() < 0.5 }),
    text: ({ n, roulette }) =>
      roulette
        ? `A roulette wheel has landed on red ${n} times in a row. A gambler says black is now "due". Explain whether that's right.`
        : `A fair coin has landed heads ${n} times in a row. Someone says tails is now "due" on the next flip. Explain whether that's right.`,
    expect: {
      nomem: 'Each spin or flip is independent: the wheel or coin has no memory of past results.',
      same: 'The probability on the next trial is exactly the same as it always is.',
      longrun: 'Long-run frequencies even out by dilution over many future trials, not by correcting a streak.',
    },
    reference: ({ roulette }) =>
      `It's not right. Each ${roulette ? 'spin' : 'flip'} is independent of the previous ones — the ${roulette ? 'wheel' : 'coin'} has no memory — so the chance of ${roulette ? 'black' : 'tails'} on the next one is exactly what it always is. The long-run proportion still heads toward its usual value, but only because the streak gets swamped by many future results, not because future results make up for it.`,
    hints: () => [
      'Does the coin or wheel "know" what happened before?',
      'What does independence say about P(next result | the streak)?',
    ],
  }),

  predict({
    id: 'ind-predict-replacement',
    kcs: [K],
    params: (rng) => ({ kind: rng.pick(['heart', 'notHeart', 'coin'] as const), n: rng.pick([5, 6, 8]) }),
    text: ({ kind, n }) =>
      kind === 'coin'
        ? `A fair coin has come up heads ${n} times in a row. Compared with the probability of heads on a fair coin's very first flip, what happens to the probability of heads on the next flip?`
        : `You draw two cards from a standard 52-card deck, and the first card is ${kind === 'heart' ? 'a heart' : 'not a heart'}. Compare drawing the second card with the first card put back (and reshuffled) versus without putting it back. Going from "put back" to "not put back", what happens to the probability that the second card is a heart?`,
    answer: ({ kind }) => (kind === 'heart' ? 'down' : kind === 'notHeart' ? 'up' : 'same'),
    miscon: ({ kind }) => (kind === 'coin' ? { down: 'gamblers-fallacy' } : { same: 'multiply-dependent' }),
    hints: () => [
      'Which cases have memory, and which do not?',
      'Without replacement, how many hearts and how many cards remain for the second draw?',
    ],
  }),

  numeric({
    id: 'ind-apply-expected-both',
    kcs: [K],
    unit: '',
    tol: COUNT,
    params: (rng) => ({
      n: rng.pick([200, 400, 1000]),
      pa: rng.pick([0.1, 0.2, 0.25, 0.3, 0.4, 0.5]),
      pb: rng.pick([0.1, 0.2, 0.3, 0.4, 0.5]),
    }),
    text: ({ n, pa, pb }) =>
      `A website had ${fmt(n)} visitors. ${fmt(n * pa)} of them clicked a banner, and ${fmt(n * pb)} signed up for the newsletter. If clicking the banner and signing up were **independent**, how many visitors would you expect to have done both?`,
    solve: ({ n, pa, pb }) => n * pa * pb,
    hints: () => [
      'Turn each count into a probability.',
      'For independent events, P(both) = P(A) × P(B). Then convert back to a count.',
    ],
    worked: ({ n, pa, pb }) => [
      {
        text: `P(click) = ${fmt(n * pa)}/${fmt(n)} = ${fmt(pa)}; P(sign up) = ${fmt(n * pb)}/${fmt(n)} = ${fmt(pb)}.`,
        value: pa,
        unit: '',
      },
      { text: `If independent, P(both) = ${fmt(pa)} × ${fmt(pb)} = ${fmt(pa * pb, 4)}.`, value: pa * pb, unit: '' },
      { text: `Expected count: ${fmt(n)} × ${fmt(pa * pb, 4)} = ${fmt(n * pa * pb)}.`, value: n * pa * pb, unit: '' },
    ],
  }),

  fixed({
    id: 'ind-apply-check-table',
    kcs: [K],
    capability: 'apply',
    params: (rng) =>
      retry(
        rng,
        (r) => ({
          nA: r.pick([200, 400, 500, 600]),
          rA: r.pick([0.1, 0.2, 0.3, 0.4, 0.5]),
          rN: r.pick([0.1, 0.2, 0.3, 0.4, 0.5]),
          same: r.next() < 0.34,
        }),
        (p) => (p.same ? p.rA === p.rN : p.rA !== p.rN),
      ),
    text: ({ nA, rA, rN }) =>
      `Of 1,000 restaurant customers, ${nA} paid by card, and ${fmt(nA * rA)} of the card payers left a tip. Of the other ${fmt(1000 - nA)} customers, ${fmt((1000 - nA) * rN)} left a tip. Is leaving a tip independent of paying by card?`,
    options: () => [
      'Yes — card payers tip at the same rate as other customers',
      'No — card payers are more likely to tip',
      'No — card payers are less likely to tip',
    ],
    correct: ({ rA, rN }) => (rA === rN ? 0 : rA > rN ? 1 : 2),
    hints: () => [
      'Raw counts can mislead because the groups are different sizes.',
      'Compare P(tip | card) with P(tip | not card).',
    ],
    worked: ({ nA, rA, rN }) => [
      { text: `P(tip | card) = ${fmt(nA * rA)}/${nA} = ${pct(rA)}.`, value: 100 * rA, unit: '%' },
      { text: `P(tip | not card) = ${fmt((1000 - nA) * rN)}/${1000 - nA} = ${pct(rN)}.`, value: 100 * rN, unit: '%' },
      {
        text:
          rA === rN
            ? 'The rates match, so tipping is independent of paying by card.'
            : `The rates differ, so they are not independent: card payers are ${rA > rN ? 'more' : 'less'} likely to tip.`,
      },
    ],
  }),

  fixed({
    id: 'ind-disc-reasonable',
    kcs: [K],
    capability: 'discriminate',
    params: (rng) => rng.pick(REASONABLE),
    text: ({ s }) => `Is it reasonable to treat these two events as independent: ${s}?`,
    options: ({ ok }) => (ok ? [YES, [NO, 'gamblers-fallacy']] : [[YES, 'multiply-dependent'], NO]),
    correct: ({ ok }) => (ok ? 0 : 1),
    hints: () => [
      'Is there any physical link, shared cause, or "used-up" item connecting the two?',
      'If you knew the first result, would you change your guess about the second?',
    ],
  }),

  fixed({
    id: 'ind-transfer-sequences',
    kcs: [K],
    capability: 'discriminate',
    transfer: true,
    params: (rng) => rng.pick(SEQS),
    text: (c) =>
      c.kind === 'lottery'
        ? `A lottery draws 6 different numbers from 1 to 49, with every set of 6 equally likely. Which set is more likely to come up: ${c.run} or ${c.mixed}?`
        : `A fair coin is flipped ${c.n} times. Which exact sequence is more likely: ${c.run} or ${c.mixed}?`,
    options: (c) => [
      c.run,
      [c.mixed, 'gamblers-fallacy'],
      'They are equally likely',
      ['It depends on the results that came before', 'gamblers-fallacy'],
    ],
    correct: () => 2,
    hints: () => [
      'Work out the probability of each specific sequence or set.',
      'Does looking "random" make a particular result more likely?',
    ],
  }),
];

export default t;
