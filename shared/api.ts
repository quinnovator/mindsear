// HTTP + SSE contract between server and web client.
// All routes are under /api. The client never computes learning state; it renders what these return.
import type { Capability, Tier, GoalLevel } from './content.ts';

export type { Capability, Tier, GoalLevel };

export type MasteryState = 'not_started' | 'introduced' | 'with_support' | 'independent' | 'new_context' | 'retained';

export const MASTERY_ORDER: MasteryState[] = [
  'not_started',
  'introduced',
  'with_support',
  'independent',
  'new_context',
  'retained',
];

export const MASTERY_LABEL: Record<MasteryState, string> = {
  not_started: 'Not started',
  introduced: 'Introduced',
  with_support: 'Can use with support',
  independent: 'Demonstrated independently',
  new_context: 'Applied in a new context',
  retained: 'Retained',
};

// Short labels used in the map nodes and the session rail.
export const MASTERY_SHORT: Record<MasteryState, string> = {
  not_started: 'Not started',
  introduced: 'Introduced',
  with_support: 'With support',
  independent: 'Independent',
  new_context: 'Applied somewhere new',
  retained: 'Retained',
};

// User-facing capability labels.
export const CAPABILITY_LABEL: Record<Capability | 'transfer', string> = {
  recall: 'Recall it cold',
  explain: 'Explain why it works',
  predict: 'Predict which way it moves',
  apply: 'Solve on your own',
  discriminate: 'Tell it from look-alikes',
  transfer: 'Use it somewhere new',
};

export type CapStatus = 'passed' | 'pending' | 'in_progress' | 'after_mastery';

// ---------- GET /api/me ----------
export interface Me {
  email: string;
  name: string;
}

// ---------- Objectives ----------
export type ObjectiveStatus = 'scoping' | 'compiling' | 'review' | 'active' | 'archived' | 'failed';

export interface ObjectiveSummary {
  id: string;
  title: string; // spec title once scoped, else the raw text truncated
  kind: 'one_liner' | 'bundle' | 'library';
  status: ObjectiveStatus;
  target_date: string | null; // YYYY-MM-DD
  plan_id: string | null;
  enrollment_id: string | null;
  goal_label: string | null; // e.g. "Goal: solve problems"
  retained: number; // KC counts, 0 until enrolled
  independent_or_better: number;
  total_kcs: number;
  reviews_due: number;
  created_at: string;
}
// GET /api/objectives -> ObjectiveSummary[]

// POST /api/objectives  (multipart/form-data: text, files[] (pdf/docx/md/txt), links (newline separated), target_date?)
//   -> { id }  then open GET /api/objectives/:id/stream
// POST /api/library/enroll  { pack_id: 'intro-probability', goal: GoalLevel, session_minutes: 10|20|30, reminders: boolean }
//   -> { objective_id, enrollment_id }   (library entry point; placement comes next)
export interface LibraryPack {
  id: string;
  title: string;
  description: string;
  kcs: number;
  goals: { id: GoalLevel; label: string; blurb: string; hours: number; capabilities: string[] }[];
}
// GET /api/library -> LibraryPack[]

export interface ScopingQuestion {
  seq: number;
  question: string;
  options: string[];
  answer: string | null;
}

export interface ObjectiveDetail {
  id: string;
  raw_text: string;
  kind: 'one_liner' | 'bundle' | 'library';
  status: ObjectiveStatus;
  target_date: string | null;
  title: string | null;
  questions: ScopingQuestion[];
  compile: { stage: CompileStage; detail?: string } | null;
  plan_id: string | null;
  enrollment_id: string | null;
  error: string | null;
  files: { name: string; chars: number }[];
}
// GET /api/objectives/:id -> ObjectiveDetail
// POST /api/objectives/:id/answers { answers: { seq: number; answer: string }[], session_minutes?: number } -> { ok: true }
//   (starts compiling; progress arrives on the objective stream)
// DELETE /api/objectives/:id -> { ok: true }   (deletes the objective, its files and learning data)

export type CompileStage = 'ingest' | 'scope' | 'ground' | 'graph' | 'items' | 'verify' | 'done';

export type ObjectiveEvent =
  // SSE on GET /api/objectives/:id/stream (event name = .event)
  | { event: 'scoping.question'; seq: number; question: string; options: string[] }
  | { event: 'scoping.done' } // no (more) questions needed
  | { event: 'compile.stage'; stage: CompileStage; detail?: string }
  | { event: 'plan.module'; module: PlanModule }
  | { event: 'plan.ready'; plan_id: string }
  | { event: 'error'; code: string; message: string; retryable: boolean };

// ---------- Plans ----------
export interface PlanKC {
  id: string;
  title: string;
  origin: 'library' | 'generated';
  tier: Tier | 'mixed'; // weakest tier among its items; 'mixed' = some unverified
  known: boolean; // learner marked "I know this"
  removed: boolean;
  compiled: boolean; // items built yet (just-in-time compile)
}
export interface PlanModule {
  id: string;
  title: string;
  minutes: number;
  hands_on: boolean;
  kcs: PlanKC[];
}
export interface Requirement {
  id: string;
  title: string;
  quote: string;
  kc_ids: string[];
}
export interface Plan {
  id: string;
  objective_id: string;
  title: string;
  goal_label: string; // "Goal: run it yourself"
  tags: string[]; // e.g. ["Reward-based (GRPO)"]
  library_topics: number;
  source_count: number;
  total_minutes: number;
  modules: PlanModule[];
  requirements: Requirement[]; // non-empty for bundle objectives; UI groups by requirement then
  verification_mix: { code_checked: number; cross_checked: number; unverified: number }; // fractions summing to 1
  sources: { title: string; url: string | null }[];
  accepted: boolean;
  enrollment_id: string | null;
  updating: boolean; // a change request is being applied
}
// GET /api/plans/:id -> Plan
export type PlanEdit =
  | { remove_kc: string }
  | { restore_kc: string }
  | { known_kc: string; known: boolean }
  | { reorder: string[] } // module ids in the new order
  | { request: string }; // plain-language change; recompiles affected modules (async; poll or use the objective stream)
// POST /api/plans/:id/edits PlanEdit -> Plan
// POST /api/plans/:id/accept -> { enrollment_id }

// ---------- Enrollment views ----------
export interface KCNode {
  id: string;
  title: string;
  depth: number; // column on the map
  state: MasteryState;
  placed: boolean;
  p_known: number;
  summary: string;
  prerequisites: string[];
  unlocks: string[];
  capabilities: { key: Capability | 'transfer'; label: string; status: CapStatus; progress?: string }[]; // required by goal only
  review_due_at: string | null;
  review_due: boolean;
  needed_for_next: boolean; // prerequisite of the KC the learner is working on
  sessions: number;
  last_practiced_at: string | null;
  evidence_tier: Tier | null; // best tier among its passing evidence
  origin: 'library' | 'generated';
}
export interface Progress {
  enrollment_id: string;
  title: string; // "Intro probability"
  goal_label: string; // "Goal: solve problems"
  kcs: KCNode[];
  counts: Record<MasteryState, number>;
  retained: number;
  independent_or_better: number;
  total: number;
  reviews_due: number;
  current_kc: string | null; // what "Continue" would teach next
  has_target_date: boolean;
}
// GET /api/enrollments/:id/progress -> Progress

export interface Home {
  enrollment_id: string;
  objective_id: string;
  title: string;
  goal_label: string;
  needs_placement: boolean; // placement not done yet -> primary CTA is placement
  reviews: { kc_id: string; title: string; state: MasteryState; last_practiced_at: string | null }[];
  review_minutes: number;
  continue: { kc_id: string; title: string; state: MasteryState; blurb: string; minutes: number } | null;
  last_session: { ended_at: string; summary: string[] } | null;
  progress: Pick<Progress, 'counts' | 'retained' | 'independent_or_better' | 'total'>;
  has_target_date: boolean;
}
// GET /api/enrollments/:id/home -> Home

export interface ReadinessRow {
  id: string;
  title: string;
  quote: string;
  readiness: number; // 0..1 projected to the target date
  evidence_label: string; // "Mostly code-checked" | "Mostly cross-checked" | "Rubric-graded" | "Code-checked" | "Not enough evidence"
  verified_share: number; // share of the score backed by code/cross-checked items
  at_risk: boolean;
  weakest_kc: { id: string; title: string } | null;
}
export interface Readiness {
  enrollment_id: string;
  title: string; // "Senior ML Engineer at [Company]"
  source_label: string; // "From: job posting, résumé"
  target_date: string;
  days_left: number;
  requirements: ReadinessRow[]; // sorted weakest first
  today: { minutes: number; text: string; kc_id: string | null };
}
// GET /api/enrollments/:id/readiness -> Readiness (404 if no target date)

// ---------- Sessions ----------
export type SessionKind = 'placement' | 'learn' | 'review' | 'mock_interview';
// POST /api/enrollments/:id/sessions { kind: SessionKind, kc_id?: string } -> { session_id }

export type Widget =
  | { kind: 'numeric'; unit: '%' | ''; placeholder: string }
  | { kind: 'mcq'; options: string[]; allow_unsure: boolean }
  | { kind: 'free_text'; max_chars: number; allow_unsure: boolean; ask_confidence: boolean }
  | { kind: 'steps'; steps: { label: string; given: string | null; unit: '%' | '' }[] } // given != null = prefilled step
  | { kind: 'continue'; label: string } // e.g. after a worked example: "I've read it"
  | { kind: 'none' };

export interface ItemView {
  instance_id: string;
  capability: Capability;
  kc_id: string;
  label: string; // "Apply · Bayes' rule"
  text: string; // the problem statement (may contain simple markdown: **bold**, `code`)
  is_transfer: boolean;
  hints_used: number;
}

export interface ExampleCard {
  // rendered inside a tutor turn (worked example / natural-frequency grid)
  title: string;
  steps: { text: string; blank?: boolean }[];
}

export interface Turn {
  id: string;
  seq: number;
  role: 'tutor' | 'learner';
  move: string | null;
  content: string; // tutor: message text (markdown-lite); learner: what they answered, display form
  item: ItemView | null; // tutor turn that presents an item
  widget: Widget | null; // the pending action, only on the latest tutor turn
  example: ExampleCard | null;
  meta: { confidence?: number; selected?: string; correct?: boolean | null; flaggable?: boolean } | null;
  created_at: string;
}

export interface SessionRail {
  kc: { id: string; title: string; state: MasteryState; capabilities: KCNode['capabilities'] } | null;
  path: { id: string; title: string; state: MasteryState; current: boolean; label: string }[]; // prerequisites → current → next up
  next_review: { kc_title: string; in_days: number } | null;
  why: string | null; // latest "Why are we doing this?" answer, shown in the rail
}

export interface SessionView {
  id: string;
  enrollment_id: string;
  kind: SessionKind;
  title: string; // objective title for the breadcrumb
  kc_title: string | null;
  minutes_total: number;
  started_at: string;
  ended_at: string | null;
  placement: { asked: number; max: number } | null;
  turns: Turn[];
  rail: SessionRail;
  hint_note_shown: boolean; // show "hints lower how much this counts" only until first hint
  recap: Recap | null;
}
// GET /api/sessions/:id -> SessionView  (also used for resume)

export type LearnerAction =
  | {
      type: 'answer';
      turn_id: string;
      response: NumericResp | McqResp | TextResp | StepsResp | ContinueResp;
      confidence?: 1 | 2 | 3 | 4 | 5;
      ms_on_item?: number;
    }
  | { type: 'hint'; turn_id: string }
  | { type: 'example'; turn_id: string }
  | { type: 'why'; turn_id: string }
  | { type: 'side_question'; turn_id: string; text: string }
  | { type: 'unsure'; turn_id: string };
export type NumericResp = { kind: 'numeric'; value: string }; // raw text: "8.3", "1/12", "0.083"
export type McqResp = { kind: 'mcq'; index: number };
export type TextResp = { kind: 'text'; text: string };
export type StepsResp = { kind: 'steps'; values: string[] };
export type ContinueResp = { kind: 'continue' };
// POST /api/sessions/:id/actions LearnerAction (+ action_id: string, client-generated uuid) -> 202 { action_id }
// POST /api/sessions/:id/end -> Recap
// POST /api/items/:instance_id/flag { reason?: string } -> { ok: true }

export interface Recap {
  summary: string[];
  next_review_at: string | null;
  next_kc: { id: string; title: string } | null;
}

export type StreamEvent =
  // SSE on GET /api/sessions/:id/stream (event name = .event)
  | { event: 'ack'; action_id: string }
  | { event: 'learner.turn'; turn: Turn } // the learner's action, as persisted
  | { event: 'assessing'; label: string } // "Reading your explanation…"
  | { event: 'tutor.start'; turn_id: string; seq: number; move: string }
  | { event: 'tutor.delta'; turn_id: string; text: string }
  | { event: 'tutor.done'; turn: Turn } // final turn incl. item/widget/example; replaces streamed text
  | { event: 'progress'; kc_id: string; state: MasteryState; capabilities: KCNode['capabilities']; tier: Tier | null }
  | { event: 'rail'; rail: SessionRail }
  | { event: 'placement'; asked: number; max: number }
  | { event: 'session.recap'; recap: Recap }
  | { event: 'error'; code: string; message: string; retryable: boolean };
// The stream sends every event with an SSE id; reconnect with Last-Event-ID to replay missed events.
// On connect without Last-Event-ID the server sends nothing historical: fetch GET /api/sessions/:id first.
