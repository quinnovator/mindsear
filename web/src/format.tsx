// Date/number formatting and the "markdown-lite" renderer for tutor text.
import { Fragment, type ReactNode } from 'react';

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** Parse "YYYY-MM-DD" as a local date; anything else via Date. */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(s);
}

export function monthDay(s: string): string {
  const d = parseDate(s);
  return Number.isNaN(d.getTime()) ? s : MONTH_DAY.format(d);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `s` to today (positive = in the past). */
export function daysAgo(s: string): number {
  const d = parseDate(s);
  return Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
}

/** "today", "yesterday", "6 days ago", or "Oct 3" beyond a month. */
export function relativeDay(s: string): string {
  const n = daysAgo(s);
  if (Number.isNaN(n)) return '';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 30) return `${n} days ago`;
  return monthDay(s);
}

export function inDays(n: number): string {
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Minutes to "~1.5 h" / "~45 min". */
export function approxHours(minutes: number): string {
  if (minutes < 60) return `~${Math.max(5, Math.round(minutes / 5) * 5)} min`;
  const h = Math.round((minutes / 60) * 2) / 2;
  return `~${h} h`;
}

/** Minutes to "about 9 hours" / "about 40 minutes". */
export function aboutHours(minutes: number): string {
  if (minutes < 60) return `about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const h = Math.round((minutes / 60) * 2) / 2;
  return `about ${h} ${h === 1 ? 'hour' : 'hours'}`;
}

export function pct(x: number): string {
  return `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

// ---------- markdown-lite ----------
// Supports paragraphs (blank line), line breaks, **bold** and `code`. Everything else is plain text,
// which React escapes. No HTML is ever injected.

const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+?`)/g;

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={i++}>{inlineCode(tok.slice(2, -2))}</strong>);
    else out.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inlineCode(text: string): ReactNode[] {
  const parts = text.split(/(`[^`\n]+?`)/g);
  return parts.map((p, i) =>
    p.startsWith('`') && p.endsWith('`') && p.length > 1 ? <code key={i}>{p.slice(1, -1)}</code> : p,
  );
}

function lines(text: string): ReactNode[] {
  const ls = text.split('\n');
  return ls.map((l, i) => (
    <Fragment key={i}>
      {inline(l)}
      {i < ls.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

export function Markdown({ text, className, id }: { text: string; className?: string; id?: string }) {
  const paras = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return null;
  if (paras.length === 1) {
    return (
      <p className={className} id={id}>
        {lines(paras[0])}
      </p>
    );
  }
  return (
    <div className={`md ${className ?? ''}`} id={id}>
      {paras.map((p, i) => (
        <p key={i}>{lines(p)}</p>
      ))}
    </div>
  );
}
