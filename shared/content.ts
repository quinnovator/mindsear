// Content pack contract. Library packs are TypeScript
// modules that export a PackDef; generated packs are stored as data with the
// same shape minus the functions (see server/content/generated.ts).

export type Capability = 'recall' | 'explain' | 'predict' | 'apply' | 'discriminate';
export const CAPABILITIES: Capability[] = ['recall', 'explain', 'predict', 'apply', 'discriminate'];
export type WidgetKind = 'numeric' | 'mcq' | 'free_text' | 'steps';
export type Tier = 'code_checked' | 'cross_checked' | 'unverified';
export type KcKind = 'procedural' | 'conceptual';
export type GoalLevel = 'follow' | 'solve' | 'teach';

export interface Rng {
  next(): number; // [0, 1)
  int(lo: number, hi: number): number; // inclusive
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
}

export interface KCDef {
  id: string;
  title: string;
  kind: KcKind;
  summary: string; // vetted explanation the tutor must stay within (2–4 sentences)
  expectations: string[]; // ideas a complete explanation must contain (2–4)
  prerequisites: string[];
  confusable_with: string[];
}

export interface MisconceptionDef {
  id: string;
  description: string;
  kcs: string[];
  refutation: string; // why it fails + the replacement model
}

export interface Tolerance {
  abs?: number;
  rel?: number;
}

export interface McqOption {
  text: string;
  misconception?: string;
}

export interface WorkedStep {
  text: string; // the step written out, e.g. "Fraudulent and flagged: 1,000 × 1% × 90% = 9"
  value?: number; // numeric result of the step, if any (completion items blank these)
  unit?: '%' | '';
}

export interface Expectation {
  id: string;
  text: string;
}

export interface TemplateMeta {
  id: string;
  kcs: string[]; // first is the primary KC; >1 = integration item
  capability: Capability;
  widget: WidgetKind;
  is_transfer?: boolean; // new context / representation / combined with another KC
  discriminates?: string[]; // misconception ids this item splits
  tolerance?: Tolerance; // numeric only; accepted if within abs OR rel
  unit?: '%' | ''; // numeric only; '%' = answer is shown and typed as a percent
}

// One parameterized task. Exactly one of solve / mcq / rubric applies, by widget:
//   numeric   -> solve (+ wrongSolve)
//   mcq       -> mcq
//   free_text -> rubric
//   steps     -> worked (all steps with value are answered)
export interface ItemTemplate<P = any> {
  meta: TemplateMeta;
  params(rng: Rng): P;
  text(p: P): string; // canned surface text (also the Item Writer fallback)
  solve?(p: P): number; // ground truth, in the unit the learner types
  wrongSolve?: Record<string, (p: P) => number>; // answer each misconception produces
  mcq?(p: P): { options: McqOption[]; correct: number };
  rubric?: { expectations: Expectation[]; reference(p: P): string };
  hints(p: P): string[]; // ordered, least to most revealing; never the answer
  worked?(p: P): WorkedStep[]; // full worked solution; used for examples and bottom-out
}

export interface PackDef {
  id: string;
  version: string;
  title: string;
  description: string;
  goals: Record<
    GoalLevel,
    { capabilities: Capability[]; transfer: boolean; label: string; blurb: string; hours: number }
  >;
  kcs: KCDef[];
  misconceptions: MisconceptionDef[];
  templates: ItemTemplate[];
}
