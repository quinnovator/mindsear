// Diagnosis with competing hypotheses. Pure functions over a weight map.
export type Hyp = Record<string, number>;
export const NON_MISCONCEPTIONS = ['slip', 'misread', 'retrieval_failure'];

export interface WrongSignal {
  distractorMisconception?: string | null; // chosen MCQ option's mapped misconception
  wrongSolveMatch?: string | null; // numeric answer equals a misconception's wrongSolve()
  ambiguousMatches?: string[]; // several misconceptions give the same value: seed each below the decision line
  assessor?: { id: string; weight: number }[];
  near?: boolean; // numeric answer close to correct: likely slip
  previouslyCorrect?: boolean; // KC had independent successes before
}

export function onWrong(h: Hyp, s: WrongSignal): Hyp {
  const out = { ...h };
  const raise = (id: string, w: number) => {
    out[id] = Math.max(out[id] ?? 0, w);
  };
  if (s.distractorMisconception) raise(s.distractorMisconception, 0.8);
  if (s.wrongSolveMatch) raise(s.wrongSolveMatch, 0.8);
  if ((s.ambiguousMatches?.length ?? 0) > 1) for (const m of s.ambiguousMatches!) raise(m, 0.55);
  for (const a of s.assessor ?? []) if (a.id !== 'novel') raise(a.id, Math.min(0.9, a.weight));
  const hasMis = Object.keys(out).some((k) => !NON_MISCONCEPTIONS.includes(k) && out[k] >= 0.3);
  raise('slip', s.near ? 0.6 : hasMis ? 0.1 : 0.25);
  raise('misread', hasMis ? 0.05 : 0.15);
  if (s.previouslyCorrect) raise('retrieval_failure', 0.3);
  return prune(out);
}

// A correct answer on an item that discriminates some hypotheses lowers them; any independent
// correct answer decays slips and misreads.
export function onCorrect(h: Hyp, discriminates: string[], independent: boolean): Hyp {
  const out: Hyp = {};
  for (const [k, w] of Object.entries(h)) {
    let nw = w;
    if (discriminates.includes(k)) nw *= 0.3;
    else if (independent) nw *= NON_MISCONCEPTIONS.includes(k) ? 0.2 : 0.7;
    out[k] = nw;
  }
  return prune(out);
}

// The learner's response to a probe: choosing the option tied to a hypothesis confirms it.
export function onProbe(h: Hyp, chosenMisconception: string | null, correct: boolean, discriminates: string[]): Hyp {
  const out = { ...h };
  if (chosenMisconception) out[chosenMisconception] = Math.max(out[chosenMisconception] ?? 0, 0.85);
  if (correct) for (const d of discriminates) if (out[d] !== undefined) out[d] *= 0.3;
  if (correct && chosenMisconception === null) {
    // Understands the distinction the probe tested: the error was more likely a slip or misread.
    out.slip = Math.max(out.slip ?? 0, 0.4);
  }
  return prune(out);
}

export function prune(h: Hyp): Hyp {
  const out: Hyp = {};
  for (const [k, w] of Object.entries(h)) if (w >= 0.05) out[k] = Math.round(w * 1000) / 1000;
  return out;
}

export function ranked(h: Hyp): [string, number][] {
  return Object.entries(h).sort((a, b) => b[1] - a[1]);
}

export function topMisconception(h: Hyp): [string, number] | null {
  const r = ranked(h).filter(([k]) => !NON_MISCONCEPTIONS.includes(k));
  return r[0] ?? null;
}

export function maxMisconceptionWeight(h: Hyp): number {
  return topMisconception(h)?.[1] ?? 0;
}

// Diagnose only to the grain that changes the next move: act once one hypothesis exceeds 0.7.
export function decided(h: Hyp): string | null {
  const top = ranked(h)[0];
  return top && top[1] > 0.7 ? top[0] : null;
}

// Pick the probe that best splits the top two live hypotheses. Returns candidate template ids, best first.
export function rankProbes(
  h: Hyp,
  candidates: { id: string; discriminates: string[] }[],
): { id: string; score: number }[] {
  const live = ranked(h)
    .filter(([k]) => !NON_MISCONCEPTIONS.includes(k))
    .slice(0, 2)
    .map(([k]) => k);
  if (!live.length) return [];
  return candidates
    .map((c) => ({
      id: c.id,
      score: live.filter((l) => c.discriminates.includes(l)).length + (c.discriminates.length > 0 ? 0.1 : 0),
    }))
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score);
}
