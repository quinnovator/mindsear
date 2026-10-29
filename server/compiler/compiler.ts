// The objective compiler: the authoring pipeline run by agents at request time, with the
// human reviewer replaced by grounding in sources, reuse of library packs, and verification tiers.
// Output is a generated pack in the same shape the engine already teaches.
import { z } from 'zod';
import type { DB, Row } from '../db.ts';
import { uuid, j, nowIso } from '../db.ts';
import { completeJson, fence, UNTRUSTED_RULE, llmAvailable, type CallMeta } from '../llm.ts';
import { publish } from '../stream.ts';
import { LIBRARY, GENERIC_GOALS, invalidateCourse, type GeneratedItemSpec } from '../content/course.ts';
import { depths } from '../content/validate.ts';
import { withinTolerance } from '../content/validate.ts';
import { evalArithmetic, fetchPage } from './extract.ts';
import type { Capability, GoalLevel, Tier } from '../../shared/content.ts';
import type { PlanModule, Plan, Requirement as ReqView } from '../../shared/api.ts';

const chan = (objectiveId: string) => `objective:${objectiveId}`;
const BUDGET = { initialIn: 400_000, moduleIn: 150_000, lifeIn: 1_200_000 };

function stage(db: DB, oid: string, s: string, detail?: string) {
  db.run('update objective set compile_stage = ?, compile_detail = ? where id = ?', s, detail ?? null, oid);
  publish(db, chan(oid), { event: 'compile.stage', stage: s, detail });
}
function fail(db: DB, oid: string, message: string) {
  db.run("update objective set status = 'failed', error = ? where id = ?", message, oid);
  publish(db, chan(oid), { event: 'error', code: 'compile_failed', message, retryable: true });
}
function tokensUsed(db: DB, oid: string): number {
  return Number(db.get('select coalesce(sum(tokens_in), 0) as n from llm_call where objective_id = ?', oid)!.n);
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'kc';

// ---------- 1. Ingest ----------

const IngestOut = z.object({
  kind: z.enum(['one_liner', 'bundle']),
  requirements: z.array(z.object({ title: z.string(), quote: z.string() })).max(20),
});

function sourceText(db: DB, oid: string): { raw: string; docs: string } {
  const o = db.get('select raw_text from objective where id = ?', oid)!;
  const files = db.all('select filename, extracted_text from objective_file where objective_id = ?', oid);
  const docs = files.map((f) => fence(f.filename, (f.extracted_text ?? '').slice(0, 120_000))).join('\n\n');
  return { raw: o.raw_text, docs };
}

export async function ingestAndScope(db: DB, oid: string): Promise<void> {
  const meta: CallMeta = { db, objective_id: oid };
  try {
    stage(db, oid, 'ingest');
    const { raw, docs } = sourceText(db, oid);
    const all =
      raw +
      '\n' +
      db
        .all('select extracted_text from objective_file where objective_id = ?', oid)
        .map((r) => r.extracted_text ?? '')
        .join('\n');
    let kind: 'one_liner' | 'bundle' = docs || raw.length > 600 ? 'bundle' : 'one_liner';
    let requirements: { title: string; quote: string }[] = [];
    if (kind === 'bundle') {
      const out = await completeJson(
        'ingester',
        IngestOut,
        {
          system: `You read a learner's objective and any attached documents (job postings, résumés, syllabi, notes). If the material states demands the learner must meet (job requirements, syllabus outcomes), extract each as a requirement with a short title and its EXACT verbatim quote from the document (a phrase of 3–25 words copied character for character). Résumés describe the learner and are not requirements. Merge duplicates; at most 12.\n\n${UNTRUSTED_RULE}`,
          messages: [
            {
              role: 'user',
              content: `Learner's request:\n${fence('learner', raw)}\n\nAttached material:\n${docs || '(none)'}\n\nReturn {"kind": "one_liner"|"bundle", "requirements": [{"title","quote"}]}`,
            },
          ],
          maxTokens: 3000,
          timeoutMs: 150_000,
        },
        meta,
      );
      kind = out.kind;
      // A requirement without a verbatim quote is dropped.
      const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
      const hay = norm(all);
      requirements = out.requirements.filter((r) => hay.includes(norm(r.quote)));
    }
    db.run('update objective set kind = ? where id = ?', kind, oid);
    db.run('delete from requirement where objective_id = ?', oid);
    requirements.forEach((r, i) =>
      db.insert('requirement', {
        id: uuid(),
        objective_id: oid,
        quote: r.quote,
        title: r.title,
        kc_keys: '[]',
        seq: i,
      }),
    );
    await scope(db, oid, kind, requirements);
  } catch (e) {
    console.error('ingest failed', e);
    fail(db, oid, `Couldn't read the objective: ${(e as Error).message}`);
  }
}

// ---------- 2. Scope ----------

const ScopeOut = z.object({
  decline: z.string().nullable().optional(),
  title: z.string(),
  purpose: z.string().nullable(),
  goal_level: z.enum(['follow', 'solve', 'teach']).nullable(),
  form: z.enum(['conceptual', 'hands_on', 'both']).nullable(),
  starting_point: z.string().nullable(),
  questions: z
    .array(z.object({ slot: z.string(), question: z.string(), options: z.array(z.string()).min(2).max(4) }))
    .max(3),
});

async function scope(db: DB, oid: string, kind: string, requirements: { title: string; quote: string }[]) {
  stage(db, oid, 'scope');
  const { raw, docs } = sourceText(db, oid);
  const o = db.get('select target_date from objective where id = ?', oid)!;
  const out = await completeJson(
    'scoper',
    ScopeOut,
    {
      system: `You scope a learning objective before a curriculum is built. Fill an ObjectiveSpec: a short plan title (e.g. "RL post-training for small language models"), purpose, goal_level (follow = understand discussions/papers; solve = do it yourself on new problems; teach = deep: also predict and recall cold), form (conceptual, hands_on, both) and starting_point. Leave a slot null when the material doesn't settle it, and ask at most 3 quick-pick questions, one per empty slot that would change the plan (slots: purpose, starting_point, form, kind — "kind" disambiguates what the topic means, e.g. "Which kind of RL?"). Each question has 2–4 short options; the UI adds an "Other" field. Ask nothing the material already answers. If the objective is something the platform must not teach (e.g. weapons or harm to people), set decline to one polite sentence and ask nothing.\n\n${UNTRUSTED_RULE}`,
      messages: [
        {
          role: 'user',
          content: `Objective:\n${fence('learner', raw)}\n\nTarget date: ${o.target_date ?? 'none'}\nExtracted requirements: ${JSON.stringify(requirements)}\nAttached material:\n${docs ? docs.slice(0, 60_000) : '(none)'}\n\nReturn {"decline"?: string|null, "title", "purpose", "goal_level", "form", "starting_point", "questions": [{"slot","question","options"}]}`,
        },
      ],
      maxTokens: 2000,
      timeoutMs: 120_000,
    },
    { db, objective_id: oid },
  );
  if (out.decline) {
    fail(db, oid, out.decline);
    return;
  }
  db.run(
    'update objective set title = ?, spec = ? where id = ?',
    out.title,
    JSON.stringify({ ...out, questions: undefined, kind, requirements }),
    oid,
  );
  db.run('delete from scoping_qa where objective_id = ?', oid);
  out.questions.slice(0, 3).forEach((q, i) => {
    db.insert('scoping_qa', { objective_id: oid, seq: i + 1, question: q.question, options: q.options, slot: q.slot });
    publish(db, chan(oid), { event: 'scoping.question', seq: i + 1, question: q.question, options: q.options });
  });
  publish(db, chan(oid), { event: 'scoping.done' });
}

// ---------- 3. Ground ----------

const ResearchOut = z.object({
  sources: z.array(z.object({ title: z.string(), url: z.string(), why: z.string() })).max(10),
});

async function ground(db: DB, oid: string, spec: any) {
  stage(db, oid, 'ground', 'Matching the library and gathering sources');
  const meta: CallMeta = { db, objective_id: oid };
  const existing = db.all('select url from source where objective_id = ?', oid).map((r) => r.url);
  try {
    const out = await completeJson(
      'researcher',
      ResearchOut,
      {
        system: `You find authoritative public sources for building a curriculum: official documentation, well-known papers (arXiv abs pages), reputable textbook chapters or tutorials. Give up to 8 stable URLs you are confident exist (canonical pages, not search results). Prefer pages that explain the core ideas.\n\n${UNTRUSTED_RULE}`,
        messages: [
          {
            role: 'user',
            content: `Objective spec: ${fence('learner', JSON.stringify(spec))}\n\nReturn {"sources": [{"title","url","why"}]}`,
          },
        ],
        maxTokens: 1500,
        timeoutMs: 120_000,
      },
      meta,
    );
    const fetched = await pool(
      out.sources.filter((s) => !existing.includes(s.url)),
      6,
      async (s) => ({ s, page: await fetchPage(s.url, 12_000) }),
    );
    for (const { s, page } of fetched) {
      if (page && page.text.length > 400)
        db.insert('source', {
          id: uuid(),
          objective_id: oid,
          url: s.url,
          title: page.title || s.title,
          snippet: page.text.slice(0, 12_000),
          fetched: 1,
          fetched_at: nowIso(),
        });
    }
  } catch (e) {
    console.error('research failed', (e as Error).message);
  }
  // Uploaded documents are sources too.
  for (const f of db.all('select filename, extracted_text from objective_file where objective_id = ?', oid)) {
    if (!db.get('select 1 from source where objective_id = ? and title = ?', oid, f.filename))
      db.insert('source', {
        id: uuid(),
        objective_id: oid,
        url: null,
        title: f.filename,
        snippet: (f.extracted_text ?? '').slice(0, 12_000),
        fetched: 1,
        fetched_at: nowIso(),
      });
  }
}

// ---------- 4. Draft the graph ----------

const KcOut = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['procedural', 'conceptual']).default('conceptual'),
  summary: z.string().default(''),
  expectations: z.array(z.string()).max(5).default([]),
  prerequisites: z.array(z.string()).default([]),
  confusable_with: z.array(z.string()).default([]),
  source_ids: z.array(z.number()).default([]),
  library_ref: z.string().nullable().optional(),
});
const GraphOut = z.object({
  title: z.string(),
  goal_level: z.enum(['follow', 'solve', 'teach']),
  goal_label: z.string(),
  tags: z.array(z.string()).max(4),
  modules: z
    .array(z.object({ title: z.string(), hands_on: z.boolean().default(false), kcs: z.array(KcOut).min(1) }))
    .min(1)
    .max(6),
  requirement_map: z.array(z.object({ requirement_index: z.number(), kc_ids: z.array(z.string()) })).default([]),
});
type GraphOut = z.infer<typeof GraphOut>;

function libraryCatalog(): string {
  return Object.values(LIBRARY)
    .flatMap((p) => p.kcs.map((k) => `${p.id}/${k.id}: ${k.title} — ${k.summary.split('. ')[0]}`))
    .join('\n');
}

function validateGraph(g: GraphOut, nReq: number, nSources: number): string[] {
  const errs: string[] = [];
  const all = g.modules.flatMap((m) => m.kcs);
  const total = all.length;
  if (total < 4 || total > 25) errs.push(`plan has ${total} KCs; aim for 8–25`);
  const ids = new Set(all.map((k) => (k.library_ref ? k.library_ref : k.id)));
  const libKeys = new Set(Object.values(LIBRARY).flatMap((p) => p.kcs.map((k) => `${p.id}/${k.id}`)));
  for (const k of all) {
    if (k.library_ref && !libKeys.has(k.library_ref)) errs.push(`${k.id}: library_ref ${k.library_ref} doesn't exist`);
    for (const p of k.prerequisites)
      if (!ids.has(p) && !libKeys.has(p)) errs.push(`${k.id}: prerequisite ${p} is not in the plan`);
    if (!k.library_ref && nSources > 0 && !k.source_ids.some((s) => s >= 0 && s < nSources))
      errs.push(`${k.id}: must cite at least one source id (0..${nSources - 1})`);
    if (!k.library_ref && (!k.summary.trim() || !k.expectations.length))
      errs.push(`${k.id}: needs a summary and expectations`);
  }
  try {
    depths(all.map((k) => ({ id: k.library_ref ?? k.id, prerequisites: k.prerequisites.filter((p) => ids.has(p)) })));
  } catch (e) {
    errs.push((e as Error).message);
  }
  for (let i = 0; i < nReq; i++) {
    const m = g.requirement_map.find((r) => r.requirement_index === i);
    if (!m || !m.kc_ids.some((x) => ids.has(x))) errs.push(`requirement ${i} is not mapped to any KC`);
  }
  return errs;
}

async function draftGraph(
  db: DB,
  oid: string,
  spec: any,
  qa: Row[],
  request: string | null,
  current: GraphOut | null,
): Promise<GraphOut> {
  const sources = db.all('select id, title, url, snippet from source where objective_id = ? order by rowid', oid);
  const reqs = db.all('select title, quote from requirement where objective_id = ? order by seq', oid);
  const o = db.get('select raw_text, target_date from objective where id = ?', oid)!;
  const sys = `You are the Curriculum Drafter. Turn a learning objective into a knowledge-component (KC) graph: 8–25 small, teachable, testable ideas, grouped into 2–5 ordered modules (foundations first). For each KC: id (kebab-case), title (short, plain), kind (procedural = a method you carry out; conceptual = an idea you understand), a 2–4 sentence summary that is accurate and is the only material a tutor may teach from, 2–4 expectations (ideas a complete explanation must contain), prerequisites (ids of other KCs in this plan or library keys), confusable_with (look-alike KCs in the plan), and source_ids (indices of the numbered sources that support the summary; every generated KC must cite at least one).

Reuse the vetted library wherever the objective overlaps it: include a library KC by setting library_ref to its exact key (e.g. "intro-probability/bayes-rule") and id to the same key; don't regenerate library material. Library catalog:
${libraryCatalog()}

Set goal_level from the learner's purpose (follow / solve / teach) and goal_label as "Goal: <phrase>" (e.g. "Goal: run it yourself"). tags: 1–2 short labels for the scope choices (e.g. "Reward-based (GRPO)"). Mark modules with practical, do-it-yourself content as hands_on. If requirements are given, requirement_map must map every requirement index to the KCs that cover it.

${UNTRUSTED_RULE}`;
  const user = [
    `Objective: ${fence('learner', o.raw_text)}`,
    `Spec: ${JSON.stringify(spec)}`,
    `Scoping answers: ${JSON.stringify(qa.map((q) => ({ q: q.question, a: q.answer })))}`,
    `Target date: ${o.target_date ?? 'none'}`,
    `Requirements (index: title — quote):\n${reqs.map((r, i) => `${i}: ${r.title} — "${r.quote}"`).join('\n') || '(none)'}`,
    `Sources:\n${sources.map((s, i) => `[${i}] ${s.title} ${s.url ?? ''}\n${fence('source', s.snippet.slice(0, 2500))}`).join('\n') || '(none)'}`,
    current
      ? `Current plan (revise it):\n${JSON.stringify(current)}\n\nLearner's change request: ${fence('learner', request ?? '')}\nKeep KC ids stable for anything you keep.`
      : '',
    'Return {"title","goal_level","goal_label","tags","modules":[{"title","hands_on","kcs":[{"id","title","kind","summary","expectations","prerequisites","confusable_with","source_ids","library_ref"}]}],"requirement_map":[{"requirement_index","kc_ids"}]}',
  ]
    .filter(Boolean)
    .join('\n\n');
  let messages: any[] = [{ role: 'user', content: user }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const g = await completeJson(
      'curriculum',
      GraphOut,
      { system: sys, messages, maxTokens: 12_000, timeoutMs: 300_000 },
      { db, objective_id: oid },
    );
    const errs = validateGraph(g, reqs.length, sources.length);
    if (!errs.length || attempt === 1) {
      if (errs.length) console.warn('graph validation issues kept after repair:', errs);
      return g;
    }
    messages = [
      ...messages,
      { role: 'assistant', content: JSON.stringify(g) },
      {
        role: 'user',
        content: `Validation failed:\n- ${errs.join('\n- ')}\nFix these and return the full corrected JSON.`,
      },
    ];
  }
  throw new Error('unreachable');
}

// Writes the graph as a generated pack + plan; returns module definitions.
function writeGraph(db: DB, oid: string, g: GraphOut, existingPlan: Row | null): string {
  const packId = `gen-${oid.slice(0, 8)}`;
  const version = existingPlan
    ? `v${Number(j<any>(existingPlan.learner_edits, []).filter((e: any) => e.request).length) + 1}`
    : 'v1';
  db.upsert(
    'content_pack',
    { id: packId, version: `gen/${oid}/${version}`, title: g.title, origin: 'generated', objective_id: oid },
    ['id'],
  );
  const libKeys = new Set(Object.values(LIBRARY).flatMap((p) => p.kcs.map((k) => `${p.id}/${k.id}`)));
  const keyOf = (id: string) => (libKeys.has(id) ? id : `${packId}/${kebab(id)}`);
  const all = g.modules.flatMap((m) => m.kcs);
  const inPlan = new Set(all.map((k) => keyOf(k.library_ref ?? k.id)));
  const d = depths(
    all
      .filter((k) => !k.library_ref)
      .map((k) => ({
        id: keyOf(k.id),
        prerequisites: k.prerequisites.map(keyOf).filter((p) => inPlan.has(p) && !libKeys.has(p)),
      })),
  );
  const sourceIds = db.all('select id from source where objective_id = ? order by rowid', oid).map((r) => r.id);
  for (const k of all) {
    if (k.library_ref && libKeys.has(k.library_ref)) continue;
    db.upsert(
      'kc',
      {
        pack_id: packId,
        id: kebab(k.id),
        title: k.title,
        kind: k.kind,
        depth: d.get(keyOf(k.id)) ?? 0,
        summary: k.summary,
        expectations: k.expectations,
        confusable_with: k.confusable_with.map(keyOf).filter((x) => inPlan.has(x)),
        prerequisites: k.prerequisites.map(keyOf).filter((x) => inPlan.has(x)),
        source_ids: k.source_ids.map((i) => sourceIds[i]).filter(Boolean),
        library_ref: null,
      },
      ['pack_id', 'id'],
    );
  }
  const oldModules = existingPlan ? j<any[]>(existingPlan.modules, []) : [];
  const modules = g.modules.map((m, i) => {
    const kc_keys = m.kcs.map((k) => keyOf(k.library_ref ?? k.id));
    const old = oldModules.find((om) => om.title === m.title);
    const allCompiled = kc_keys.every(
      (k) =>
        libKeys.has(k) ||
        !!db.get(
          "select 1 from item_template where pack_id = ? and json_extract(kc_ids, '$[0]') = ? limit 1",
          packId,
          k.split('/')[1],
        ),
    );
    return {
      id: old?.id ?? `m${i + 1}-${uuid().slice(0, 4)}`,
      title: m.title,
      hands_on: m.hands_on,
      kc_keys,
      compiled: allCompiled,
      minutes: kc_keys.reduce((a, k) => a + (libKeys.has(k) ? 25 : 35), 0),
    };
  });
  const reqs = db.all('select id from requirement where objective_id = ? order by seq', oid);
  for (const rm of g.requirement_map) {
    const r = reqs[rm.requirement_index];
    if (r)
      db.run(
        'update requirement set kc_keys = ? where id = ?',
        JSON.stringify(rm.kc_ids.map(keyOf).filter((k) => inPlan.has(k))),
        r.id,
      );
  }
  if (existingPlan) {
    db.run(
      'update plan set title = ?, goal = ?, goal_label = ?, tags = ?, modules = ?, pack_id = ? where id = ?',
      g.title,
      g.goal_level,
      g.goal_label,
      JSON.stringify(g.tags),
      JSON.stringify(modules),
      packId,
      existingPlan.id,
    );
    return existingPlan.id;
  }
  const planId = uuid();
  db.insert('plan', {
    id: planId,
    objective_id: oid,
    pack_id: packId,
    title: g.title,
    goal: g.goal_level,
    goal_label: g.goal_label,
    tags: g.tags,
    modules,
  });
  db.run('update objective set title = ? where id = ?', g.title, oid);
  return planId;
}

// ---------- 5–6. Items, verifiable first; verification tiers ----------

const ItemOut = z.object({
  id: z.string(),
  capability: z.enum(['recall', 'explain', 'predict', 'apply', 'discriminate']),
  widget: z.enum(['numeric', 'mcq', 'free_text']),
  is_transfer: z.boolean().default(false),
  text: z.string(),
  hints: z.array(z.string()).min(1).max(4),
  discriminates: z.array(z.string()).default([]),
  numeric: z
    .object({
      answer: z.number(),
      answer_expr: z.string(),
      unit: z.enum(['%', '']),
      tolerance_abs: z.number().nonnegative(),
      wrong: z.array(z.object({ misconception: z.string(), value: z.number() })).default([]),
    })
    .nullable()
    .optional(),
  mcq: z
    .object({
      options: z
        .array(z.object({ text: z.string(), misconception: z.string().nullable().optional() }))
        .min(2)
        .max(6),
      correct: z.number().int(),
    })
    .nullable()
    .optional(),
  rubric: z
    .object({
      expectations: z
        .array(z.object({ id: z.string(), text: z.string() }))
        .min(1)
        .max(4),
      reference: z.string(),
    })
    .nullable()
    .optional(),
  worked: z
    .array(z.object({ text: z.string(), value: z.number().nullable().optional() }))
    .nullable()
    .optional(),
});
const ItemsOut = z.object({ items: z.array(z.unknown()).min(1).max(14) });

// Models drift on shape (expectations as strings, "correct" as text, "transfer" as a capability):
// coerce each item, keep the ones that then validate, and drop the rest.
const CAP_ALIASES: Record<string, string> = {
  transfer: 'apply',
  application: 'apply',
  discrimination: 'discriminate',
  prediction: 'predict',
  explanation: 'explain',
  remember: 'recall',
};
export function coerceItem(raw: unknown): z.infer<typeof ItemOut> | null {
  if (!raw || typeof raw !== 'object') return null;
  const it: any = { ...(raw as any) };
  const cap = String(it.capability ?? '')
    .toLowerCase()
    .trim();
  if (cap === 'transfer') it.is_transfer = true;
  it.capability = CAP_ALIASES[cap] ?? cap;
  const WIDGETS: Record<string, string> = {
    multiple_choice: 'mcq',
    'multiple-choice': 'mcq',
    choice: 'mcq',
    'free-text': 'free_text',
    text: 'free_text',
    short_text: 'free_text',
    short_answer: 'free_text',
    number: 'numeric',
  };
  const w = String(it.widget ?? (it.mcq ? 'mcq' : it.numeric ? 'numeric' : 'free_text'))
    .toLowerCase()
    .trim();
  it.widget = WIDGETS[w] ?? w;
  if (typeof it.hints === 'string') it.hints = [it.hints];
  if (it.rubric) {
    if (Array.isArray(it.rubric)) it.rubric = { expectations: it.rubric, reference: it.reference ?? '' };
    it.rubric.expectations = (it.rubric.expectations ?? []).map((e: any, i: number) =>
      typeof e === 'string'
        ? { id: `e${i + 1}`, text: e }
        : { id: String(e.id ?? `e${i + 1}`), text: String(e.text ?? e.description ?? '') },
    );
    it.rubric.reference = String(it.rubric.reference ?? it.reference ?? it.rubric.reference_answer ?? '');
  }
  if (it.mcq) {
    const opts = (it.mcq.options ?? []).map((o: any) => (typeof o === 'string' ? { text: o, misconception: null } : o));
    it.mcq.options = opts;
    let c = it.mcq.correct ?? it.mcq.correct_index ?? it.mcq.answer ?? it.mcq.answer_index;
    if (typeof c === 'string')
      c = /^\d+$/.test(c.trim()) ? Number(c) : opts.findIndex((o: any) => o.text.trim() === c.trim());
    if (typeof c !== 'number' || c < 0) {
      const k = opts.findIndex((o: any) => o.correct === true || o.is_correct === true);
      c = k;
    }
    if (typeof c !== 'number' || c < 0 || c >= opts.length) return null;
    it.mcq.correct = c;
  }
  if (it.numeric && typeof it.numeric.answer === 'string') it.numeric.answer = Number(it.numeric.answer);
  if (it.numeric) it.numeric.unit = it.numeric.unit === '%' ? '%' : '';
  if (it.numeric && it.numeric.tolerance_abs === undefined)
    it.numeric.tolerance_abs = Math.abs(Number(it.numeric.answer) || 0) * 0.01;
  if (Array.isArray(it.worked)) it.worked = it.worked.map((w: any) => (typeof w === 'string' ? { text: w } : w));
  const r = ItemOut.safeParse(it);
  return r.success ? r.data : null;
}
const MisOut = z.object({
  misconceptions: z
    .array(z.object({ id: z.string(), description: z.string(), kcs: z.array(z.string()), refutation: z.string() }))
    .max(30),
});
const CrossOut = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      answer: z.union([z.number(), z.string()]).nullable(),
      rubric_agrees: z.boolean().nullable().optional(),
      note: z.string().optional(),
    }),
  ),
});
const RedOut = z.object({ findings: z.array(z.object({ id: z.string(), problem: z.string() })) });

async function draftMisconceptions(db: DB, oid: string, packId: string, kcs: Row[]): Promise<void> {
  if (!kcs.length) return;
  const out = await completeJson(
    'misconceptions',
    MisOut,
    {
      system: `You are the Misconception Drafter. For the given knowledge components, list recurring wrong mental models learners actually hold (not just "doesn't know it"). For each: kebab-case id, one-sentence description, the KC ids it attaches to, and a refutation (2–3 sentences: why it fails and the correct replacement model). Keep only misconceptions a multiple-choice distractor or a specific wrong numeric answer could reveal.`,
      messages: [
        {
          role: 'user',
          content:
            kcs.map((k) => `${k.id}: ${k.title} — ${k.summary}`).join('\n') +
            '\n\nReturn {"misconceptions":[{"id","description","kcs","refutation"}]}',
        },
      ],
      maxTokens: 6000,
      timeoutMs: 240_000,
    },
    { db, objective_id: oid },
  );
  for (const m of out.misconceptions)
    db.upsert(
      'misconception',
      { pack_id: packId, id: kebab(m.id), description: m.description, kcs: m.kcs.map(kebab), refutation: m.refutation },
      ['pack_id', 'id'],
    );
}

function requiredCaps(goal: GoalLevel): Capability[] {
  return GENERIC_GOALS[goal].capabilities;
}

async function compileKc(
  db: DB,
  oid: string,
  packId: string,
  kc: Row,
  goal: GoalLevel,
  handsOn: boolean,
  onStage: (s: string, d: string) => void,
): Promise<void> {
  const meta: CallMeta = { db, objective_id: oid };
  const mis = db.all(
    'select id, description from misconception where pack_id = ? and kcs like ?',
    packId,
    `%"${kc.id}"%`,
  );
  const sources = j<string[]>(kc.source_ids, [])
    .map((sid) => db.get('select title, snippet from source where id = ?', sid))
    .filter(Boolean) as Row[];
  const caps = requiredCaps(goal);
  const transfer = GENERIC_GOALS[goal].transfer;
  onStage('items', `Writing questions for ${kc.title}`);
  const objective = db.get('select title from objective where id = ?', oid)?.title ?? '';
  const sys = `You are the Template Drafter. Write practice items for one knowledge component. Match each item's form to how the skill is actually used and tested for the learner's objective:
- numeric only when working out a quantity is itself part of this skill (e.g. computing a probability, or a sizing estimate a practitioner genuinely does as part of this topic). Never wrap a conceptual or judgment topic in arithmetic just to make it checkable, and never ask for trivia figures from a paper or product page. If numeric fits: give "answer" and "answer_expr", a plain arithmetic expression using only numbers, + - * / ^, parentheses and sqrt/ln/exp/choose/fact/min/max, that evaluates to the answer, and "wrong" values that specific misconceptions produce.
- mcq with 3–5 options for most apply, predict and discriminate items: a realistic situation the learner could face, asking for the best decision, design, diagnosis or next step. Each distractor is a plausible choice that maps to a misconception id from the list (or null).
- free_text with a rubric (2–3 expectations) and a reference answer for explain and recall.
Required, for this goal: 2 apply items, and one each of: ${caps.filter((c) => c !== 'apply').join(', ')}${transfer ? ', plus 1 transfer item (is_transfer true): the same idea in a new context or combined with another idea' : ''}. predict items are mcq about what happens to an outcome when something in the system changes. discriminate items ask when the idea applies vs a look-alike. ${handsOn ? 'This module is hands-on: set apply items in concrete code, config, trace or deployment situations, still answerable without running code.' : ''}
Every item: unambiguous, self-contained, numeric items state units and rounding ("as a percent, to one decimal place"), 2–3 hints from least to most revealing that never contain the answer, and "worked": the full solution as 2–5 steps (numeric steps carry "value"). Text is plain language for an adult learner. Units: if unit is "%", answer is a percent (8.3 for 8.3%). Teach only what the summary and sources support.
capability must be exactly one of recall, explain, predict, apply, discriminate (a transfer item is capability "apply" with is_transfer true). Shapes:
{"id":"d1","capability":"discriminate","widget":"mcq","text":"...","hints":["..."],"discriminates":["id"],"mcq":{"options":[{"text":"...","misconception":null},{"text":"...","misconception":"id"}],"correct":0}}
{"id":"a2","capability":"apply","widget":"numeric","is_transfer":false,"text":"...","hints":["...","..."],"discriminates":[],"numeric":{"answer":0.25,"answer_expr":"0.5*0.5","unit":"","tolerance_abs":0.01,"wrong":[{"misconception":"id","value":0.5}]},"worked":[{"text":"...","value":0.5},{"text":"...","value":0.25}]}
{"id":"e1","capability":"explain","widget":"free_text","text":"...","hints":["..."],"rubric":{"expectations":[{"id":"e1","text":"..."}],"reference":"..."}}\n\n${UNTRUSTED_RULE}`;
  const user = `Learner's objective: ${objective}\nKC ${kc.id}: ${kc.title} (${kc.kind})\nSummary: ${kc.summary}\nExpectations: ${kc.expectations}\nMisconceptions: ${mis.map((m) => `${m.id}: ${m.description}`).join('; ') || '(none)'}\nSources:\n${sources.map((s) => fence(s.title, s.snippet.slice(0, 3000))).join('\n') || '(none)'}\n\nReturn {"items":[{"id","capability","widget","is_transfer","text","hints","discriminates","numeric"?,"mcq"?,"rubric"?,"worked"?}]}`;
  let items: GeneratedItemSpec[] = [];
  const misIds = new Set(mis.map((m) => m.id));
  for (let attempt = 0; attempt < 2 && items.length < 3; attempt++) {
    const draft = await completeJson(
      'templates',
      ItemsOut,
      { system: sys, messages: [{ role: 'user', content: user }], maxTokens: 12_000, timeoutMs: 300_000 },
      meta,
    );
    const parsed = draft.items.map(coerceItem);
    items = parsed
      .map((it, i) => (it ? normalizeItem(it, kc.id, i, misIds) : null))
      .filter((x): x is GeneratedItemSpec => !!x);
    if (parsed.some((x) => !x)) console.warn(`${kc.id}: dropped ${parsed.filter((x) => !x).length} malformed item(s)`);
  }
  if (!items.length) throw new Error('no valid items drafted');

  onStage('verify', `Checking answers for ${kc.title}`);
  const tiers = await verifyItems(db, oid, packId, kc, items, sources.length > 0);
  for (const it of items) {
    db.upsert(
      'item_template',
      {
        pack_id: packId,
        id: it.id,
        kc_ids: it.kcs,
        capability: it.capability,
        widget: it.widget,
        is_transfer: it.is_transfer ? 1 : 0,
        discriminates: it.discriminates ?? [],
        module_path: null,
        tier: tiers.get(it.id) ?? 'unverified',
        generated: 1,
        spec: it,
        flagged: 0,
      },
      ['pack_id', 'id'],
    );
  }
}

function normalizeItem(
  it: z.infer<typeof ItemOut>,
  kcId: string,
  i: number,
  misIds: Set<string>,
): GeneratedItemSpec | null {
  const id = `${kebab(kcId)}-${kebab(it.id)}-${i}`;
  const base: GeneratedItemSpec = {
    id,
    kcs: [kebab(kcId)],
    capability: it.capability,
    widget: it.widget,
    is_transfer: it.is_transfer,
    text: it.text,
    hints: it.hints,
    discriminates: it.discriminates.map(kebab).filter((d) => misIds.has(d)),
    worked: it.worked?.map((s) => ({ text: s.text, value: s.value ?? undefined })) ?? undefined,
  };
  if (it.widget === 'numeric') {
    if (!it.numeric) return null;
    const tol = { abs: Math.max(it.numeric.tolerance_abs, Math.abs(it.numeric.answer) * 0.005) };
    const wrong: Record<string, number> = {};
    for (const w of it.numeric.wrong) {
      const m = kebab(w.misconception);
      if (misIds.has(m) && !withinTolerance(w.value, it.numeric.answer, tol)) wrong[m] = w.value;
    }
    return {
      ...base,
      numeric: { answer: it.numeric.answer, unit: it.numeric.unit, tolerance: tol, wrong },
      ...({ answer_expr: it.numeric.answer_expr } as any),
    };
  }
  if (it.widget === 'mcq') {
    if (!it.mcq || it.mcq.correct < 0 || it.mcq.correct >= it.mcq.options.length) return null;
    const texts = it.mcq.options.map((o) => o.text.trim());
    if (new Set(texts).size !== texts.length) return null;
    return {
      ...base,
      mcq: {
        correct: it.mcq.correct,
        options: it.mcq.options.map((o, i) => ({
          text: o.text.trim(),
          misconception:
            i !== it.mcq!.correct && o.misconception && misIds.has(kebab(o.misconception))
              ? kebab(o.misconception)
              : undefined,
        })),
      },
    };
  }
  if (!it.rubric) return null;
  return {
    ...base,
    rubric: {
      expectations: it.rubric.expectations.map((e, k) => ({ id: kebab(e.id) || `e${k}`, text: e.text })),
      reference: it.rubric.reference,
    },
  };
}

// Verification tiers. code_checked: code computes the key and an independent solve of the
// rendered text agrees. cross_checked: a different, larger model agrees independently, the KC cites
// sources, and the Red-Teamer finds no ambiguity. Everything else: unverified.
async function verifyItems(
  db: DB,
  oid: string,
  packId: string,
  kc: Row,
  items: GeneratedItemSpec[],
  grounded: boolean,
): Promise<Map<string, Tier>> {
  const meta: CallMeta = { db, objective_id: oid };
  const tiers = new Map<string, Tier>();
  const record = (tid: string, method: string, passed: boolean, detail: unknown) =>
    db.insert('verification', { id: uuid(), pack_id: packId, template_id: tid, method, passed, detail });

  // Independent solve by a different, larger model with its own prompt; it never sees the draft's key or reasoning.
  const blind = items.map((it) => ({
    id: it.id,
    widget: it.widget,
    text: it.text,
    options: it.mcq?.options.map((o, i) => `${i}: ${o.text}`),
    unit: it.numeric?.unit,
    expectations: it.rubric?.expectations.map((e) => e.text),
  }));
  const [cross, red] = await Promise.all([
    completeJson(
      'cross_checker',
      CrossOut,
      {
        system:
          'You independently answer practice items. numeric: give the number (as a percent value if unit is "%"). mcq: give the index of the correct option. free_text: set answer to a one-paragraph model answer and rubric_agrees to true only if every listed expectation is correct and together they capture what a complete answer needs. If an item is ambiguous or has no single correct answer, answer null and explain in note.',
        messages: [
          {
            role: 'user',
            content: `Concept: ${kc.title} — ${kc.summary}\n\nItems:\n${JSON.stringify(blind, null, 1)}\n\nReturn {"answers":[{"id","answer","rubric_agrees"?,"note"?}]}`,
          },
        ],
        maxTokens: 8000,
        timeoutMs: 300_000,
      },
      meta,
    ).catch((e) => {
      console.error('cross-check failed', e.message);
      return { answers: [] };
    }),
    completeJson(
      'red_teamer',
      RedOut,
      {
        system:
          'You red-team practice items: report ambiguities, multiple valid answers, missing assumptions, unit or rounding traps, answers leaked in the text or hints, and factual errors. Report only real problems, one finding per problem, by item id. An empty list is fine.',
        messages: [
          {
            role: 'user',
            content:
              JSON.stringify(
                items.map((i) => ({
                  id: i.id,
                  text: i.text,
                  hints: i.hints,
                  options: i.mcq?.options.map((o) => o.text),
                  correct: i.mcq?.correct,
                  answer: i.numeric?.answer,
                  unit: i.numeric?.unit,
                  rubric: i.rubric,
                })),
              ) + '\n\nReturn {"findings":[{"id","problem"}]}',
          },
        ],
        maxTokens: 4000,
        timeoutMs: 240_000,
      },
      meta,
    ).catch(() => ({ findings: [] as { id: string; problem: string }[] })),
  ]);
  const flagged = new Set(red.findings.map((f) => f.id));
  for (const f of red.findings) record(f.id, 'red_team', false, { problem: f.problem });

  for (const it of items) {
    const c = cross.answers.find((a) => a.id === it.id);
    if (it.widget === 'numeric' && it.numeric) {
      let codeOk = false;
      try {
        const v = evalArithmetic((it as any).answer_expr ?? '');
        codeOk = withinTolerance(v, it.numeric.answer, it.numeric.tolerance);
        record(it.id, 'property_tests', codeOk, { expr: (it as any).answer_expr, value: v, stated: it.numeric.answer });
      } catch (e) {
        record(it.id, 'property_tests', false, { error: (e as Error).message });
      }
      const indep = typeof c?.answer === 'number' ? c.answer : typeof c?.answer === 'string' ? Number(c.answer) : NaN;
      const agree =
        Number.isFinite(indep) && withinTolerance(indep, it.numeric.answer, it.numeric.tolerance ?? { rel: 0.02 });
      record(it.id, 'independent_solve', agree, { independent: c?.answer ?? null });
      tiers.set(
        it.id,
        codeOk && agree && !flagged.has(it.id)
          ? 'code_checked'
          : agree && grounded && !flagged.has(it.id)
            ? 'cross_checked'
            : 'unverified',
      );
    } else if (it.widget === 'mcq' && it.mcq) {
      const idx = typeof c?.answer === 'number' ? c.answer : Number(c?.answer);
      const agree = idx === it.mcq.correct;
      record(it.id, 'cross_model', agree, { independent: c?.answer ?? null, note: c?.note });
      tiers.set(it.id, agree && grounded && !flagged.has(it.id) ? 'cross_checked' : 'unverified');
    } else {
      const agree = c?.rubric_agrees === true;
      record(it.id, 'cross_model', agree, { note: c?.note });
      tiers.set(it.id, agree && grounded && !flagged.has(it.id) ? 'cross_checked' : 'unverified');
    }
  }
  return tiers;
}

// ---------- Orchestration ----------

const inflight = new Map<string, Promise<void>>();

export function startCompile(db: DB, oid: string): void {
  if (inflight.has(oid)) return;
  const p = compileObjective(db, oid)
    .catch((e) => {
      console.error('compile failed', e);
      fail(db, oid, `Building the plan failed: ${(e as Error).message}`);
    })
    .finally(() => inflight.delete(oid));
  inflight.set(oid, p);
}

async function compileObjective(db: DB, oid: string): Promise<void> {
  if (!llmAvailable()) throw new Error('No model credentials are configured on the server.');
  db.run("update objective set status = 'compiling', error = null where id = ?", oid);
  const o = db.get('select * from objective where id = ?', oid)!;
  const spec = j<any>(o.spec, {});
  const qa = db.all('select * from scoping_qa where objective_id = ? order by seq', oid);
  await ground(db, oid, spec);
  stage(db, oid, 'graph', 'Drafting the topic graph');
  const g = await draftGraph(db, oid, spec, qa, null, null);
  const planId = writeGraph(db, oid, g, db.get('select * from plan where objective_id = ?', oid) ?? null);
  const plan = db.get('select * from plan where id = ?', planId)!;
  const packId = plan.pack_id;
  stage(db, oid, 'items', 'Drafting misconceptions');
  await draftMisconceptions(db, oid, packId, db.all('select * from kc where pack_id = ?', packId));
  // Compile just in time: the first two modules up front.
  const modules = j<any[]>(plan.modules, []);
  for (let i = 0; i < Math.min(2, modules.length); i++) {
    if (i > 0 && tokensUsed(db, oid) > BUDGET.initialIn) break; // shrink up-front work rather than fail
    await compileModule(db, oid, planId, i);
  }
  stage(db, oid, 'done');
  db.run("update objective set status = 'review' where id = ?", oid);
  publish(db, chan(oid), { event: 'plan.ready', plan_id: planId });
}

const moduleInflight = new Map<string, Promise<void>>();

export function ensureModuleCompiled(db: DB, planId: string, idx: number): Promise<void> {
  const k = `${planId}:${idx}`;
  if (moduleInflight.has(k)) return moduleInflight.get(k)!;
  const plan = db.get('select * from plan where id = ?', planId);
  const modules = j<any[]>(plan?.modules, []);
  if (!plan || !modules[idx] || modules[idx].compiled) return Promise.resolve();
  if (tokensUsed(db, plan.objective_id) > BUDGET.lifeIn) return Promise.resolve();
  const p = compileModule(db, plan.objective_id, planId, idx)
    .catch((e) => console.error('module compile failed', e))
    .finally(() => moduleInflight.delete(k));
  moduleInflight.set(k, p);
  return p;
}

async function compileModule(db: DB, oid: string, planId: string, idx: number): Promise<void> {
  const plan = db.get('select * from plan where id = ?', planId)!;
  const modules = j<any[]>(plan.modules, []);
  const m = modules[idx];
  const packId = plan.pack_id;
  const todo = m.kc_keys.filter(
    (k: string) =>
      k.startsWith(packId + '/') &&
      !db.get(
        "select 1 from item_template where pack_id = ? and json_extract(kc_ids, '$[0]') = ? limit 1",
        packId,
        k.split('/')[1],
      ),
  );
  await pool(todo, 6, async (key: string) => {
    const kc = db.get('select * from kc where pack_id = ? and id = ?', packId, key.split('/')[1]);
    if (!kc) return;
    try {
      await compileKc(db, oid, packId, kc, plan.goal, !!m.hands_on, (s, d) => stage(db, oid, s, d));
    } catch (e) {
      console.error(`compile ${key} failed`, (e as Error).message);
    }
  });
  const fresh = db.get('select modules from plan where id = ?', planId)!;
  const mods = j<any[]>(fresh.modules, []);
  const mi = mods.findIndex((x) => x.id === m.id);
  const allHave = m.kc_keys.every(
    (k: string) =>
      !k.startsWith(packId + '/') ||
      !!db.get(
        "select 1 from item_template where pack_id = ? and json_extract(kc_ids, '$[0]') = ? limit 1",
        packId,
        k.split('/')[1],
      ),
  );
  if (mi >= 0) {
    mods[mi].compiled = allHave;
    db.run('update plan set modules = ? where id = ?', JSON.stringify(mods), planId);
  }
  invalidateCourse();
  const view = planView(db, planId);
  const pm = view.modules.find((x) => x.id === m.id);
  if (pm) publish(db, chan(oid), { event: 'plan.module', module: pm });
}

// Plain-language change request: re-run graph drafting, then items for affected compiled modules.
export async function revisePlan(db: DB, planId: string, request: string): Promise<void> {
  const plan = db.get('select * from plan where id = ?', planId)!;
  const oid = plan.objective_id;
  db.run('update plan set updating = 1 where id = ?', planId);
  try {
    const current = graphFromPlan(db, planId);
    const o = db.get('select spec from objective where id = ?', oid)!;
    const g = await draftGraph(
      db,
      oid,
      j(o.spec, {}),
      db.all('select * from scoping_qa where objective_id = ? order by seq', oid),
      request,
      current,
    );
    writeGraph(db, oid, g, plan);
    const after = db.get('select * from plan where id = ?', planId)!;
    await draftMisconceptions(
      db,
      oid,
      after.pack_id,
      db.all(
        "select * from kc where pack_id = ? and id not in (select distinct json_extract(kc_ids, '$[0]') from item_template where pack_id = ?)",
        after.pack_id,
        after.pack_id,
      ),
    );
    const mods = j<any[]>(after.modules, []);
    for (let i = 0; i < mods.length; i++) if (!mods[i].compiled && i < 2) await compileModule(db, oid, planId, i);
  } finally {
    db.run('update plan set updating = 0 where id = ?', planId);
    invalidateCourse();
  }
}

function graphFromPlan(db: DB, planId: string): GraphOut {
  const plan = db.get('select * from plan where id = ?', planId)!;
  const mods = j<any[]>(plan.modules, []);
  return {
    title: plan.title,
    goal_level: plan.goal,
    goal_label: plan.goal_label,
    tags: j(plan.tags, []),
    requirement_map: [],
    modules: mods.map((m) => ({
      title: m.title,
      hands_on: !!m.hands_on,
      kcs: m.kc_keys.map((key: string) => {
        const [p, id] = [key.slice(0, key.lastIndexOf('/')), key.slice(key.lastIndexOf('/') + 1)];
        if (LIBRARY[p]) {
          const k = LIBRARY[p].kcs.find((x) => x.id === id)!;
          return {
            id: key,
            library_ref: key,
            title: k.title,
            kind: k.kind,
            summary: k.summary,
            expectations: k.expectations,
            prerequisites: [],
            confusable_with: [],
            source_ids: [],
          };
        }
        const k = db.get('select * from kc where pack_id = ? and id = ?', p, id)!;
        return {
          id,
          title: k.title,
          kind: k.kind,
          summary: k.summary,
          expectations: j(k.expectations, []),
          prerequisites: j<string[]>(k.prerequisites, []).map((x) => x.split('/').pop()!),
          confusable_with: [],
          source_ids: [0],
          library_ref: null,
        };
      }),
    })),
  };
}

// ---------- Plan view ----------

export function planView(db: DB, planId: string): Plan {
  const plan = db.get('select * from plan where id = ?', planId)!;
  const flags = j<Record<string, { known?: boolean; removed?: boolean }>>(plan.kc_flags, {});
  const mods = j<any[]>(plan.modules, []);
  const libKeys = new Set(Object.values(LIBRARY).flatMap((p) => p.kcs.map((k) => `${p.id}/${k.id}`)));
  const mix = { code_checked: 0, cross_checked: 0, unverified: 0 };
  const modules: PlanModule[] = mods.map((m) => ({
    id: m.id,
    title: m.title,
    minutes: m.minutes,
    hands_on: !!m.hands_on,
    kcs: m.kc_keys.map((key: string) => {
      const [p, id] = [key.slice(0, key.lastIndexOf('/')), key.slice(key.lastIndexOf('/') + 1)];
      if (libKeys.has(key)) {
        const k = LIBRARY[p].kcs.find((x) => x.id === id)!;
        const n = LIBRARY[p].templates.filter((t) => t.meta.kcs[0] === id);
        for (const t of n)
          if (t.meta.widget === 'free_text') mix.cross_checked++;
          else mix.code_checked++;
        return {
          id: key,
          title: k.title,
          origin: 'library',
          tier: 'code_checked',
          known: !!flags[key]?.known,
          removed: !!flags[key]?.removed,
          compiled: true,
        };
      }
      const k = db.get('select title from kc where pack_id = ? and id = ?', p, id);
      const ts = db.all("select tier from item_template where pack_id = ? and json_extract(kc_ids, '$[0]') = ?", p, id);
      for (const t of ts) (mix as any)[t.tier]++;
      const tierSet = new Set(ts.map((t) => t.tier as Tier));
      const tier = !ts.length
        ? 'unverified'
        : tierSet.has('unverified')
          ? tierSet.size === 1
            ? 'unverified'
            : 'mixed'
          : tierSet.has('cross_checked')
            ? 'cross_checked'
            : 'code_checked';
      return {
        id: key,
        title: k?.title ?? id,
        origin: 'generated',
        tier,
        known: !!flags[key]?.known,
        removed: !!flags[key]?.removed,
        compiled: ts.length > 0,
      };
    }),
  }));
  const total = mix.code_checked + mix.cross_checked + mix.unverified || 1;
  const reqs: ReqView[] = db
    .all('select * from requirement where objective_id = ? order by seq', plan.objective_id)
    .map((r) => ({ id: r.id, title: r.title, quote: r.quote, kc_ids: j(r.kc_keys, []) }));
  const sources = db.all('select title, url from source where objective_id = ? order by rowid', plan.objective_id);
  const enr = db.get('select id from enrollment where plan_id = ?', planId);
  const active = modules.flatMap((m) => m.kcs).filter((k) => !k.removed);
  return {
    id: plan.id,
    objective_id: plan.objective_id,
    title: plan.title,
    goal_label: plan.goal_label,
    tags: j(plan.tags, []),
    library_topics: active.filter((k) => k.origin === 'library').length,
    source_count: sources.length,
    total_minutes: modules.reduce(
      (a, m) => a + m.kcs.filter((k) => !k.removed).length * (m.minutes / Math.max(1, m.kcs.length)),
      0,
    ),
    modules,
    requirements: reqs,
    verification_mix: {
      code_checked: mix.code_checked / total,
      cross_checked: mix.cross_checked / total,
      unverified: mix.unverified / total,
    },
    sources: sources.map((s) => ({ title: s.title, url: s.url })),
    accepted: !!plan.accepted_at,
    enrollment_id: enr?.id ?? null,
    updating: !!plan.updating,
  };
}
