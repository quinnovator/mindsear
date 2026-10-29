# Architecture

Mind Sear separates **judgment** from **language**. Code decides what counts as evidence, what you know, and what
happens next. Models compile objectives into course material, write the tutor's words, and grade explanations, and
every model output is schema-validated before anything uses it.

```
              ┌──────────── objective compiler (models) ────────────┐
 goal + docs ─▶ ingest → scope → research → graph → items → verify ─▶ generated pack ─┐
              └──────────────────────────────────────────────────────┘                │
 library packs (TypeScript, code-checked) ──────────────────────────────────────────── ▶ course
                                                                                       │
 learner action ─▶ persist → assess → evidence log → replay learner model → policy ─▶ move
                                                                                       │
                                     item (code) + tutor message (model, streamed) ◀─┘
```

## Content

A **course** is a graph of knowledge components (KCs, or topics), each with:

- a **kind** (`procedural` or `conceptual`) and prerequisites;
- **misconceptions**: named wrong ideas, each with the wrong answer it produces where that is computable;
- **item templates**: parameterized problems, each tagged with a capability (`recall`, `explain`, `predict`, `apply`,
  `discriminate`), a widget (`numeric`, `mcq`, `free_text`, `steps`), ordered hints that never reveal the answer, and
  either a `solve()` function, an MCQ key, or a rubric.

The contract lives in [`shared/content.ts`](../shared/content.ts). Library packs implement it in TypeScript, and
`npm run pack:check` validates each one. It rejects prerequisite cycles and missing capability coverage, and it renders
1,000 random instances of every template. Each instance must render clean text, produce a finite answer, give each
misconception a wrong answer that differs from the key, and offer distinct MCQ options.

Generated packs use the same tables, so the engine can't tell a compiled objective from a library course. The only
difference is each item's **verification tier**:

| Tier            | Meaning                                                                                               | Evidence weight |
| --------------- | ----------------------------------------------------------------------------------------------------- | --------------- |
| `code_checked`  | Code computes the key, and an independent solve of the rendered text agrees.                          | 1.0             |
| `cross_checked` | A different, larger model solves it independently and agrees, and a red-team pass finds no ambiguity. | 0.8             |
| `unverified`    | Neither check passed. The item can still teach but barely moves the learner model.                    | 0.4             |

Learners can flag an item. A flagged generated item drops to `unverified` and leaves rotation.

## The objective compiler

[`server/compiler/compiler.ts`](../server/compiler/compiler.ts) runs when someone submits their own objective.

1. **Ingest.** Uploads (PDF, DOCX, text) and URLs become plain text before any model sees them. URL fetching refuses
   private address ranges. Requirements are extracted only with a verbatim quote from the source; any without one are
   dropped.
2. **Scope.** The model asks up to a few multiple-choice questions about background, focus and depth. The answers
   shape the goal level (`follow`, `solve` or `teach`) and which topics are in scope.
3. **Research.** The Researcher proposes canonical references, and the server fetches them. Pages that don't load are
   dropped, so every cited source actually exists.
4. **Graph.** The Curriculum Drafter proposes modules and topics, reusing library topics by key where they fit. Each
   requirement maps to the topics that cover it.
5. **Items.** For each topic, misconceptions are drafted first and then item templates, with verifiable forms
   preferred where the skill is genuinely computational.
6. **Verify.** Each item is assigned a tier (above).

The first two modules compile up front, and the rest compile in the background or just in time when the learner
reaches them. The plan streams to the client over SSE as each module finishes. A learner can request changes in plain language,
which re-drafts the graph and recompiles the affected modules.

## The learner model

Every graded answer appends a row to `evidence` with its capability, correctness, help rung, tier, grader confidence
and timing. Nothing derived is authoritative. `kc_state`, `hypothesis` and `fsrs_card` are rebuilt by replaying the
evidence for a topic ([`server/engine/mastery.ts`](../server/engine/mastery.ts)).

**Knowledge tracing.** BKT updates `P(known)` after each answer, blended by the answer's evidence weight:

```
weight = ladder weight (help rung) × grader confidence × tier multiplier
```

The help ladder runs 0 (no help) → 1 pump → 3 hint → 4 prompt → 5 worked step → 6 bottom-out. Weights fall from 1.0 to
0, so an answer given after seeing a worked step teaches the model nothing about what you know.

**Mastery states**, in order: _not started_ → _introduced_ → _can use with support_ → _demonstrated independently_ →
_applied in a new context_ → _retained_.

The gate to **demonstrated independently** requires all of:

- `P(known) ≥ 0.95`;
- two correct, unassisted (rung ≤ 1) answers on **distinct** problem instances;
- every capability the goal level calls for;
- no misconception hypothesis above 0.5.

**Applied in a new context** needs a passed transfer item. **Retained** needs a passed review on a verified item at
least three days after reaching independence. A failed review or transfer demotes the topic to _can use with support_
and caps `P(known)` at 0.6.

**Diagnosis** ([`server/engine/diagnosis.ts`](../server/engine/diagnosis.ts)) keeps competing hypotheses for each
wrong answer: a specific misconception, a slip, a misread, or a retrieval failure. Answers that match a misconception's
predicted wrong answer shift weight toward it. Probes are ranked by how well they would separate the leading
hypotheses.

**Scheduling** ([`server/engine/scheduler.ts`](../server/engine/scheduler.ts)) uses FSRS. A card is created when a
topic first reaches independence, and each review is rated from correctness, help, confidence and response time. Due
dates are capped so the last review lands before the objective's target date.

## The teaching policy

[`server/engine/policy.ts`](../server/engine/policy.ts) is a pure function, `nextMove(ctx) → Move`, with separate
strategies for placement, learn, review and mock-interview sessions. Learn sessions are problem-first: you attempt a
problem, then get instruction that builds on your attempt. From there the policy moves through worked examples,
completion problems and independent practice, then transfer.

A wrong answer climbs the help ladder on the same item. A live misconception gets a probe, a refutation, or a contrast
case against the idea it's confused with. After a bottom-out, the next item is a fresh isomorphic instance, so the gate
always sees an unassisted solve of something new.

The model never decides whether to advance, how much help to give, or whether an answer was independent.

## The turn pipeline

[`server/pipeline/session.ts`](../server/pipeline/session.ts) processes each session's actions strictly in order:

1. **Persist** the learner's action.
2. **Assess.** Code grades numeric, MCQ and step answers. The Assessor grades explanations against the rubric and
   names likely misconceptions with a confidence.
3. **Update** the evidence log and replay the learner model.
4. **Choose** the next move with the policy.
5. **Materialize** the item: pick parameters, compute the key, render text, build the widget. The Item Writer may
   reword the surface text, and the Verifier must confirm the meaning is unchanged, or the canned text is used.
6. **Compose** the tutor message for the chosen move. The Tutor gets the move, the facts it may state and the values it
   must not reveal before bottom-out. Streamed text is checked for leaks as it arrives. A leaking message is regenerated
   once, then replaced with scripted text.
7. **Stream** tokens to the client over SSE.

## Models

[`server/llm.ts`](../server/llm.ts) defines each role with its own system prompt, a Zod output schema, a timeout and a
model tier. Untrusted text (uploads, fetched pages, learner answers) is fenced and labelled as data in every prompt.
Every call is logged with its role, model, latency and token counts in `llm_call`.

Latency-sensitive roles (tutor, planner, item writer, verifier) run with as little thinking as the model allows. The
assessor, scoper and ingester run at low effort, and the other compiler roles at the model's default. When a model rejects a role's thinking settings, the call is retried without them
and a warning is logged.

## Storage

One SQLite database ([`server/db.ts`](../server/db.ts)) holds content, learner facts, derived state and the LLM call
log. `GET /api/account/export` returns everything stored about a user. Deleting an objective removes everything derived
from it, and deleting the account removes the user's data.
