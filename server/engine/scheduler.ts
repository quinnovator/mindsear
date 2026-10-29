// Spaced review with FSRS, via ts-fsrs. One card per (learner, KC), created on reaching
// Demonstrated independently. Deadline mode raises desired retention and caps intervals.
import { fsrs, generatorParameters, createEmptyCard, Rating, type Card, type Grade } from 'ts-fsrs';

const DAY = 86_400_000;

export function desiredRetention(at: Date, target: Date | null): number {
  if (!target) return 0.9;
  const daysLeft = (target.getTime() - at.getTime()) / DAY;
  if (daysLeft >= 14) return 0.9;
  if (daysLeft <= 0) return 0.95;
  return 0.9 + 0.05 * (1 - daysLeft / 14);
}

function scheduler(retention: number) {
  return fsrs(generatorParameters({ request_retention: retention, enable_fuzz: false, enable_short_term: false }));
}

export function newCard(at: Date): Card {
  return createEmptyCard(at);
}

export interface ReviewOutcome {
  correct: boolean;
  rung: number;
  confidence: number | null;
  ms: number | null;
}

export function ratingFor(o: ReviewOutcome): Grade {
  if (!o.correct || o.rung >= 5) return Rating.Again;
  if (o.rung >= 2) return Rating.Hard;
  if (o.confidence !== null && o.confidence <= 2) return Rating.Hard;
  if ((o.confidence === null || o.confidence >= 5) && o.ms !== null && o.ms < 20_000) return Rating.Easy;
  return Rating.Good;
}

// Applies one review (or the initial "learned" step) and the deadline cap.
export function review(card: Card, at: Date, rating: Grade, target: Date | null): Card {
  const next = scheduler(desiredRetention(at, target)).next(card, at, rating).card;
  return capToDeadline(next, at, target);
}

// Any interval that would push the next review past the target date lands in the 48 h before it.
export function capToDeadline(card: Card, at: Date, target: Date | null): Card {
  if (!target) return card;
  const latest = new Date(target.getTime() - 12 * 3600_000);
  if (card.due.getTime() > latest.getTime() && latest.getTime() > at.getTime()) {
    const earliest = new Date(Math.max(at.getTime() + 3600_000, target.getTime() - 48 * 3600_000));
    return { ...card, due: earliest.getTime() < latest.getTime() ? earliest : latest };
  }
  return card;
}

export function retrievability(card: Card, at: Date): number {
  return Number(scheduler(0.9).retrievability(card, at));
}

export function serializeCard(c: Card): string {
  return JSON.stringify(c);
}
export function parseCard(s: string): Card {
  const o = JSON.parse(s);
  return { ...o, due: new Date(o.due), last_review: o.last_review ? new Date(o.last_review) : undefined };
}
