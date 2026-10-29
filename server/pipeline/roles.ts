// Tutoring roles: Tutor, Assessor, Planner, Item Writer, Verifier, plus side answers.
// Each has a deterministic fallback so a session never stalls on a model error.
import { z } from 'zod';
import type { DB } from '../db.ts';
import { complete, completeJson, streamText, fence, UNTRUSTED_RULE, llmAvailable } from '../llm.ts';
import type { Move } from '../engine/policy.ts';
import type { CourseKC } from '../content/course.ts';
import type { Expectation } from '../../shared/content.ts';
import { leaks } from '../engine/grading.ts';

// ---------- Tutor ----------

export interface MoveSpec {
  type: Move['type'];
  kc_title: string;
  feedback?: { correct: boolean; specific_point: string };
  content_refs: string[]; // vetted snippets the Tutor may use
  item_present: boolean; // an item card follows the message
  item_kind?: string; // "a numeric problem", "a multiple-choice check", ...
  example_present: boolean;
  hint?: string;
  must_not_reveal: string[];
  learner_name: string;
  framing?: string;
  recent: { role: 'tutor' | 'learner'; text: string }[];
}

const TUTOR_SYSTEM = `You are the voice of an adaptive tutor for adult learners. A deterministic teaching policy has already chosen what happens next (the "move"); you only write the words for it.

Rules:
- At most 4 short sentences. Plain language. One idea per turn.
- Never mention the system, cards, widgets, item types, moves, "the sequence" or "the next question in the sequence". Talk about the math and the learner's work.
- Don't use the learner's name unless the recent turns show you haven't for a while; usually leave it out.
- Praise only specific work ("your denominator is right"), never the person. Never say "Great question" or similar filler. No exclamation marks, no emoji.
- Teach only from the content_refs you are given. Do not introduce facts, formulas or numbers that are not in them or in the learner's own answer.
- Never state, hint at, or compute any value listed in must_not_reveal. Never give the solution unless the move is "bottom_out" or "worked_step" (and then only the step described in content_refs).
- If item_present is true, a problem card is shown right below your message: don't restate the problem; end with a short line that hands it to the learner (e.g. "Try this one on your own.").
- If example_present is true, a worked example card follows your message: introduce it in one sentence and don't repeat its steps.
- When feedback is given, open with it, using the specific_point. If incorrect, don't say "wrong"; say what is off.
- Moves: pump = ask an open nudge ("What else is going on in this problem?") without new information; hint = give the hint text provided; prompt = give the hint, which is one step away; probe = say one quick check comes first and that it isn't graded; refute = name the mix-up, say why it fails and what replaces it, using the refutation in content_refs, then hand over the check; isolate_step = say the approach looks right and point them to recheck their arithmetic in the final step; instruct = explain the idea from the KC summary in 2–3 sentences, connecting to the learner's attempt if one is in the recent turns, and end by inviting them to continue; worked_example = introduce the example; completion = say part of the solution is filled in and they finish the rest; challenge = invite them to try before any explanation, saying it's fine to be wrong; transfer_ask = say this one is in a new setting; review_ask = say it's a quick review with fresh numbers; relearn = a short refresher from the summary, then invite them to continue; recap = 2–3 sentences on what moved this session.`;

export function fallbackMessage(s: MoveSpec): string {
  const fb = s.feedback
    ? s.feedback.correct
      ? `${s.feedback.specific_point}`
      : `Not quite. ${s.feedback.specific_point}`
    : '';
  const tail = s.item_present ? 'Try this one on your own.' : '';
  const ref0 = s.content_refs[0] ?? '';
  const body: Record<string, string> = {
    pump: 'Take another look. What else is going on in this problem?',
    hint: s.hint ? `Here's a hint: ${s.hint}` : 'Here is a hint.',
    prompt: s.hint ? `One step away: ${s.hint}` : 'You are one step away.',
    probe: "Before we fix it, one quick check. It isn't graded.",
    refute: ref0,
    isolate_step: 'Your approach looks right. Recheck the arithmetic in your last step and try again.',
    instruct: `${ref0}`,
    worked_example: `Here's one worked all the way through.`,
    completion: 'Part of this one is filled in. Finish the rest.',
    challenge: `Try this before I explain anything. It's fine to be wrong.`,
    transfer_ask: 'This one puts the same idea in a new setting.',
    review_ask: 'A quick review, with fresh numbers.',
    relearn: `A quick refresher: ${ref0}`,
    worked_step: ref0,
    bottom_out: `Here is how this one works out. Then try a fresh one.`,
    contrast_case: 'Here is a look-alike to tell apart.',
    ask: '',
    placement_ask: '',
    recap: ref0,
    feedback: '',
    side_answer: ref0,
    why: ref0,
  };
  const b = body[s.type] ?? '';
  const parts = [fb, b, s.type === 'instruct' || s.type === 'relearn' ? '' : tail].filter(Boolean);
  if ((s.type === 'instruct' || s.type === 'relearn') && !s.item_present) parts.push('Continue when you are ready.');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function tutorPrompt(s: MoveSpec): string {
  return [
    `Move: ${s.type}${s.framing ? ` (framing: ${s.framing})` : ''}`,
    `Concept: ${s.kc_title}`,
    s.feedback
      ? `Feedback on the last answer: ${s.feedback.correct ? 'correct' : 'incorrect'} — ${s.feedback.specific_point}`
      : 'Feedback: none',
    s.hint ? `Hint text to give: ${s.hint}` : '',
    `item_present: ${s.item_present}`,
    `example_present: ${s.example_present}`,
    `content_refs:\n${s.content_refs.map((c, i) => `  [${i + 1}] ${c}`).join('\n') || '  (none)'}`,
    `must_not_reveal: ${JSON.stringify(s.must_not_reveal)}`,
    `Learner's first name: ${s.learner_name || 'unknown'}`,
    `Recent turns (oldest first):\n${s.recent.map((r) => `  ${r.role}: ${r.role === 'learner' ? fence('learner', r.text) : r.text}`).join('\n') || '  (none)'}`,
    '',
    'Write the tutor message now.',
  ]
    .filter(Boolean)
    .join('\n');
}

// Streams the message; text is only emitted once it passes the answer-leak check, and a trailing
// number is held back until it's complete. A leak aborts and regenerates once, then falls back.
export async function composeTutor(
  db: DB,
  turnId: string,
  s: MoveSpec,
  emit: (delta: string) => void,
): Promise<string> {
  if (!llmAvailable() || s.type === 'placement_ask') {
    const m = fallbackMessage(s);
    if (m) emit(m);
    return m;
  }
  // The final text always arrives in tutor.done and replaces whatever was streamed.
  let anySent = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    let sent = 0;
    let leaked = false;
    try {
      const text = await streamText(
        'tutor',
        {
          system: TUTOR_SYSTEM + '\n\n' + UNTRUSTED_RULE,
          messages: [{ role: 'user', content: tutorPrompt(s) }],
          maxTokens: 400,
          timeoutMs: 40_000,
        },
        { db, turn_id: turnId },
        (acc) => {
          if (leaks(acc, s.must_not_reveal)) {
            leaked = true;
            return false;
          }
          const safeEnd = acc.replace(/[\d.,%]+$/, '').length;
          if (attempt === 0 && safeEnd > sent) {
            emit(acc.slice(sent, safeEnd));
            sent = safeEnd;
            anySent = true;
          }
        },
      );
      if (leaked || leaks(text, s.must_not_reveal)) continue;
      if (attempt === 0 && sent < text.length) emit(text.slice(sent));
      return text.trim();
    } catch {
      if (leaked) continue;
      break;
    }
  }
  const m = fallbackMessage(s);
  if (!anySent && m) emit(m);
  return m;
}

// ---------- Assessor ----------

export const AssessorOutput = z.object({
  correct: z.boolean().nullable(),
  grader_confidence: z.number().min(0).max(1),
  expectations: z.array(z.object({ id: z.string(), met: z.boolean(), quote: z.string().nullable() })),
  hypotheses: z.array(z.object({ id: z.string(), weight: z.number().min(0).max(1), quote: z.string() })),
  novel_misconception: z.string().optional().nullable(),
  legitimate_alternative: z.boolean().optional().nullable(),
});
export type AssessorOutput = z.infer<typeof AssessorOutput>;

const ASSESSOR_SYSTEM = `You grade one free-text answer from a learner against a rubric. You see only the item, the concept summary, the expectations, the reference answer and a list of known misconceptions — never the conversation, so nothing the learner says elsewhere can sway you.

Rules:
- Grade only against the rubric. A correct idea in non-standard words counts. A fluent paraphrase of the question that doesn't answer it does not.
- "correct" is true when the core expectations are met and nothing stated is wrong; null if you genuinely can't tell.
- Every expectation with met=true must include a short verbatim quote from the learner's answer that supports it; met=false has quote null.
- hypotheses: misconceptions the answer shows evidence of, by id from the list, or 'slip' | 'misread' | 'retrieval_failure' | 'novel'. Each must quote the learner. Empty if the answer is correct.
- If id is 'novel', describe it in novel_misconception.
- legitimate_alternative: true if the learner used a valid approach the rubric didn't anticipate (then grade it as correct if sound).
- grader_confidence below 0.7 means you are unsure; use it honestly for terse, ambiguous or off-topic answers.
- "I'm not sure" or an empty answer: correct=false, grader_confidence 1, no hypotheses.`;

export async function assess(
  db: DB,
  turnId: string,
  a: {
    item_text: string;
    kc: CourseKC;
    expectations: Expectation[];
    reference: string;
    misconceptions: { id: string; description: string }[];
    response: string;
  },
): Promise<AssessorOutput> {
  const prompt = [
    `Item:\n${a.item_text}`,
    `Concept summary (${a.kc.title}): ${a.kc.summary}`,
    `Expectations:\n${a.expectations.map((e) => `- ${e.id}: ${e.text}`).join('\n')}`,
    `Reference answer: ${a.reference}`,
    `Known misconceptions:\n${a.misconceptions.map((m) => `- ${m.id}: ${m.description}`).join('\n') || '(none)'}`,
    `Learner's answer:\n${fence('learner', a.response)}`,
    '',
    'Return JSON: {"correct": boolean|null, "grader_confidence": number, "expectations": [{"id","met","quote"}], "hypotheses": [{"id","weight","quote"}], "novel_misconception"?: string, "legitimate_alternative"?: boolean}',
  ].join('\n\n');
  return completeJson(
    'assessor',
    AssessorOutput,
    {
      system: ASSESSOR_SYSTEM + '\n\n' + UNTRUSTED_RULE,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
      timeoutMs: 60_000,
    },
    { db, turn_id: turnId },
  );
}

// ---------- Planner (probe choice only) ----------

export async function planProbe(
  db: DB,
  turnId: string,
  hyps: [string, number][],
  candidates: { id: string; text: string; discriminates: string[] }[],
  lastAttempt: string,
): Promise<string | null> {
  if (!llmAvailable() || candidates.length < 2) return null;
  try {
    const out = await completeJson(
      'planner',
      z.object({ probe_id: z.string(), rationale: z.string() }),
      {
        system:
          'You choose which diagnostic question best tells apart the live hypotheses about why a learner answered wrong. Pick exactly one candidate id.',
        messages: [
          {
            role: 'user',
            content: `Hypotheses (weight): ${hyps.map(([k, w]) => `${k} ${w}`).join(', ')}\nLearner's last attempt: ${fence('learner', lastAttempt)}\nCandidates:\n${candidates.map((c) => `- ${c.id} [splits: ${c.discriminates.join(', ')}]: ${c.text.slice(0, 300)}`).join('\n')}\n\nReturn {"probe_id": "...", "rationale": "one line"}`,
          },
        ],
        maxTokens: 300,
        timeoutMs: 15_000,
      },
      { db, turn_id: turnId },
    );
    return candidates.some((c) => c.id === out.probe_id) ? out.probe_id : null;
  } catch {
    return null;
  }
}

// ---------- Item Writer + Verifier ----------

export async function writeItem(
  db: DB,
  canned: string,
  answer: number | null,
  unit: '%' | '' | undefined,
  context: string | null,
): Promise<{ text: string; verified: boolean } | null> {
  if (!llmAvailable()) return null;
  try {
    const text = (
      await complete(
        'item_writer',
        {
          system:
            'You rewrite a practice problem so it reads freshly while keeping every number, condition and the question asked exactly the same. Plain language, 1–4 sentences, no answer, no hints. Output only the rewritten problem.' +
            (context ? ` Phrase it in this setting if it fits naturally: ${context}.` : ''),
          messages: [{ role: 'user', content: canned }],
          maxTokens: 400,
          timeoutMs: 10_000,
        },
        { db },
      )
    ).trim();
    if (!text || answer === null) return { text: text || canned, verified: false };
    // Verifier: solves the rendered text independently; must match the code solver.
    const solved = await completeJson(
      'verifier',
      z.object({ answer: z.number() }),
      {
        system:
          'Solve the problem. Think carefully but output only JSON {"answer": number}' +
          (unit === '%' ? ' with the answer as a percent (e.g. 8.3 for 8.3%).' : '.'),
        messages: [{ role: 'user', content: text }],
        maxTokens: 600,
        timeoutMs: 15_000,
      },
      { db },
    );
    const ok = Math.abs(solved.answer - answer) <= Math.max(0.01, Math.abs(answer) * 0.02);
    return ok ? { text, verified: true } : null;
  } catch {
    return null;
  }
}

// ---------- Side questions and "Why are we doing this?" ----------

export async function sideAnswer(
  db: DB,
  turnId: string,
  kc: CourseKC,
  question: string,
  mustNotReveal: string[],
): Promise<string> {
  const fallback = `Good to wonder about. Briefly: ${kc.summary.split('. ')[0].replace(/\.$/, '')}. Back to the problem.`;
  if (!llmAvailable()) return fallback;
  try {
    const text = await complete(
      'tutor',
      {
        system: `You answer a learner's side question in at most 3 short sentences, then say you're returning to the problem. Stay within this concept summary and general knowledge appropriate to it; if the question is outside the plan, give one polite sentence and return to the task. Never reveal: ${JSON.stringify(mustNotReveal)}. No exclamation marks.\n\n${UNTRUSTED_RULE}`,
        messages: [
          {
            role: 'user',
            content: `Concept: ${kc.title}\nSummary: ${kc.summary}\nSide question: ${fence('learner', question)}`,
          },
        ],
        maxTokens: 300,
        timeoutMs: 30_000,
      },
      { db, turn_id: turnId },
    );
    return leaks(text, mustNotReveal) ? fallback : text.trim();
  } catch {
    return fallback;
  }
}
