// Code grading for verifiable answers. No LLM.
import type { Tolerance } from '../../shared/content.ts';
import { withinTolerance } from '../content/validate.ts';

// Parses "8.3", "8.3%", "1/12", "0.083", "1,000", "≈ 8", "about 8.3 percent". Returns null if unparseable.
export function parseNumber(raw: string): { value: number; percentSign: boolean; fraction: boolean } | null {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/[≈~]|about|approximately|approx\.?|roughly|around/g, '')
    .replace(/percent/g, '%')
    .trim();
  const percentSign = s.endsWith('%');
  s = s
    .replace(/%$/, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/\s+/g, '');
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (frac) {
    const d = Number(frac[2]);
    if (d === 0) return null;
    return { value: Number(frac[1]) / d, percentSign, fraction: true };
  }
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/.test(s)) return null;
  return { value: Number(s), percentSign, fraction: false };
}

// Candidate readings of the learner's input in the item's unit. For a '%' item we accept the typed
// percent, and also a probability (0.083 or 1/12) converted to percent; for a '' item, a typed "8.3%"
// is converted to 0.083.
export function readings(raw: string, unit: '%' | '' | undefined): number[] {
  const p = parseNumber(raw);
  if (!p) return [];
  if (unit === '%') {
    if (p.fraction) return [p.value * 100];
    if (p.percentSign) return [p.value];
    return p.value <= 1 ? [p.value, p.value * 100] : [p.value];
  }
  if (p.percentSign) return [p.value / 100];
  return [p.value];
}

export interface NumericGrade {
  parsed: boolean;
  correct: boolean;
  value: number | null; // the reading used
  misconception: string | null; // exact wrongSolve match (null when several misconceptions give this value)
  matches: string[]; // every misconception whose wrongSolve gives this value
  near: boolean; // within 15% of the answer but outside tolerance: likely a slip
}

export function gradeNumeric(
  raw: string,
  answer: number,
  tol: Tolerance | undefined,
  unit: '%' | '' | undefined,
  wrong: Record<string, number> = {},
): NumericGrade {
  const rs = readings(raw, unit);
  if (!rs.length) return { parsed: false, correct: false, value: null, misconception: null, matches: [], near: false };
  for (const r of rs)
    if (withinTolerance(r, answer, tol))
      return { parsed: true, correct: true, value: r, misconception: null, matches: [], near: false };
  for (const r of rs) {
    const matches = Object.entries(wrong)
      .filter(([, w]) => Number.isFinite(w) && withinTolerance(r, w, tol))
      .map(([mid]) => mid);
    if (matches.length)
      return {
        parsed: true,
        correct: false,
        value: r,
        misconception: matches.length === 1 ? matches[0] : null,
        matches,
        near: false,
      };
  }
  const r = rs[rs.length - 1];
  const near = answer !== 0 && Math.abs(r - answer) / Math.abs(answer) <= 0.15;
  return { parsed: true, correct: false, value: r, misconception: null, matches: [], near };
}

export function formatNumber(v: number, unit: '%' | '' | undefined): string {
  const s =
    Math.abs(v) >= 100
      ? Math.round(v).toLocaleString('en-US')
      : Math.abs(v) < 1 && v !== 0
        ? Number(v.toPrecision(3)).toString()
        : (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return unit === '%' ? `${s}%` : s;
}

// Strings that must not appear in a tutor message before rung 6: the answer in common renderings.
export function revealForms(answer: number, unit: '%' | '' | undefined): string[] {
  const forms = new Set<string>();
  // Only renderings that actually state the answer (within 1%), so ordinary numbers in a hint don't trip the check.
  const add = (x: number) => {
    for (const d of [0, 1, 2, 3]) {
      const f = x.toFixed(d);
      if (Math.abs(Number(f) - x) <= Math.max(Math.abs(x) * 0.01, 1e-9)) forms.add(String(Number(f)));
    }
  };
  add(answer);
  if (unit === '%') add(answer / 100);
  else if (Math.abs(answer) <= 1) add(answer * 100);
  // Ignore trivially short tokens like "0", "1" or "2" that appear in ordinary prose.
  return [...forms].filter((f) => f.replace(/[^0-9]/g, '').length >= 2 && !['10', '100'].includes(f));
}

// Numbers normalized: true if the message contains any of the forms as a standalone number.
export function leaks(message: string, forms: string[]): string | null {
  const nums = message.replace(/,(?=\d{3}\b)/g, '').match(/-?\d+(?:\.\d+)?/g) ?? [];
  for (const n of nums) {
    for (const f of forms) {
      if (Number(n) === Number(f) && n.replace(/[^0-9]/g, '').length >= 2) return f;
    }
  }
  return null;
}
