// A "course" is what the engine teaches for one enrollment: the plan's KCs (library and generated
// mixed), their prerequisite edges restricted to the course, templates and misconceptions.
// KC keys are global: `${pack_id}/${kc_id}`, so evidence on a library KC carries across objectives.
import type {
  Capability,
  GoalLevel,
  ItemTemplate,
  KCDef,
  MisconceptionDef,
  PackDef,
  Tier,
  WorkedStep,
  McqOption,
  Expectation,
  Tolerance,
} from '../../shared/content.ts';
import { depths } from './validate.ts';
import type { DB } from '../db.ts';
import { j } from '../db.ts';
import { LIBRARY } from './registry.ts';

export { LIBRARY };

export const GENERIC_GOALS: Record<GoalLevel, { capabilities: Capability[]; transfer: boolean; label: string }> = {
  follow: { capabilities: ['explain', 'discriminate'], transfer: false, label: 'follow a discussion' },
  solve: { capabilities: ['explain', 'discriminate', 'apply'], transfer: true, label: 'solve problems' },
  teach: { capabilities: ['recall', 'explain', 'predict', 'apply', 'discriminate'], transfer: true, label: 'teach it' },
};

export interface CourseKC {
  key: string;
  pack_id: string;
  id: string;
  title: string;
  kind: 'procedural' | 'conceptual';
  summary: string;
  expectations: string[];
  prerequisites: string[];
  confusable: string[];
  depth: number;
  origin: 'library' | 'generated';
}
export interface CourseTemplate {
  key: string;
  pack_id: string;
  tier: Tier;
  generated: boolean;
  flagged: boolean;
  kcKeys: string[];
  tpl: ItemTemplate;
}
export interface Course {
  id: string;
  title: string;
  kcs: CourseKC[]; // plan order
  byKey: Map<string, CourseKC>;
  templates: CourseTemplate[];
  misconceptions: Map<string, MisconceptionDef & { pack_id: string }>;
  goal: GoalLevel;
  goalCaps: Capability[];
  transferRequired: boolean;
  modules: { id: string; title: string; kc_keys: string[] }[];
}

// Data form of a template (generated content has fixed instances; no code from the model ever runs).
export interface GeneratedItemSpec {
  id: string;
  kcs: string[];
  capability: Capability;
  widget: 'numeric' | 'mcq' | 'free_text';
  is_transfer?: boolean;
  discriminates?: string[];
  text: string;
  hints: string[];
  numeric?: { answer: number; unit: '%' | ''; tolerance?: Tolerance; wrong?: Record<string, number> };
  mcq?: { options: McqOption[]; correct: number };
  rubric?: { expectations: Expectation[]; reference: string };
  worked?: WorkedStep[];
}

export function specToTemplate(s: GeneratedItemSpec): ItemTemplate {
  return {
    meta: {
      id: s.id,
      kcs: s.kcs,
      capability: s.capability,
      widget: s.widget,
      is_transfer: s.is_transfer,
      discriminates: s.discriminates ?? [],
      tolerance: s.numeric?.tolerance,
      unit: s.numeric?.unit,
    },
    params: () => ({}),
    text: () => s.text,
    hints: () => s.hints,
    solve: s.numeric ? () => s.numeric!.answer : undefined,
    wrongSolve: s.numeric?.wrong
      ? Object.fromEntries(Object.entries(s.numeric.wrong).map(([k, v]) => [k, () => v]))
      : undefined,
    mcq: s.mcq ? () => s.mcq! : undefined,
    rubric: s.rubric ? { expectations: s.rubric.expectations, reference: () => s.rubric!.reference } : undefined,
    worked: s.worked ? () => s.worked! : undefined,
  };
}

function libraryTier(t: ItemTemplate): Tier {
  // Code computes numeric/mcq keys; library free-text rubrics are human-reviewed (counts as cross-checked).
  return t.meta.widget === 'free_text' ? 'cross_checked' : 'code_checked';
}

function libKc(pack: PackDef, k: KCDef, d: Map<string, number>): CourseKC {
  return {
    key: `${pack.id}/${k.id}`,
    pack_id: pack.id,
    id: k.id,
    title: k.title,
    kind: k.kind,
    summary: k.summary,
    expectations: k.expectations,
    prerequisites: k.prerequisites.map((p) => `${pack.id}/${p}`),
    confusable: k.confusable_with.map((c) => `${pack.id}/${c}`),
    depth: d.get(k.id) ?? 0,
    origin: 'library',
  };
}

export function libraryCourse(packId: string, goal: GoalLevel): Course {
  const pack = LIBRARY[packId];
  if (!pack) throw new Error(`unknown library pack ${packId}`);
  const d = depths(pack.kcs);
  const kcs = pack.kcs.map((k) => libKc(pack, k, d)).sort((a, b) => a.depth - b.depth);
  const g = pack.goals[goal];
  return finish({
    id: pack.id,
    title: pack.title,
    kcs,
    templates: pack.templates.map((t) => ({
      key: `${pack.id}/${t.meta.id}`,
      pack_id: pack.id,
      tier: libraryTier(t),
      generated: false,
      flagged: false,
      kcKeys: t.meta.kcs.map((k) => `${pack.id}/${k}`),
      tpl: t,
    })),
    misconceptions: new Map(pack.misconceptions.map((m) => [m.id, { ...m, pack_id: pack.id }])),
    goal,
    goalCaps: g.capabilities,
    transferRequired: g.transfer,
    modules: [{ id: 'all', title: pack.title, kc_keys: kcs.map((k) => k.key) }],
  });
}

function finish(c: Omit<Course, 'byKey'>): Course {
  const byKey = new Map(c.kcs.map((k) => [k.key, k]));
  // Restrict edges to the course, then recompute depth over the restricted graph.
  for (const k of c.kcs) {
    k.prerequisites = k.prerequisites.filter((p) => byKey.has(p));
    k.confusable = k.confusable.filter((p) => byKey.has(p));
  }
  const d = depths(c.kcs.map((k) => ({ id: k.key, prerequisites: k.prerequisites })));
  for (const k of c.kcs) k.depth = d.get(k.key) ?? 0;
  return { ...c, byKey, templates: c.templates.filter((t) => byKey.has(t.kcKeys[0])) };
}

// Course for a compiled plan: generated KCs from the DB plus reused library KCs.
export function planCourse(db: DB, planId: string): Course {
  const plan = db.get('select * from plan where id = ?', planId);
  if (!plan) throw new Error('plan not found');
  const modules = j<{ id: string; title: string; kc_keys: string[] }[]>(plan.modules, []);
  const flags = j<Record<string, { removed?: boolean; known?: boolean }>>(plan.kc_flags, {});
  const keys = modules.flatMap((m) => m.kc_keys).filter((k) => !flags[k]?.removed);
  const kcs: CourseKC[] = [];
  const templates: CourseTemplate[] = [];
  const misconceptions = new Map<string, MisconceptionDef & { pack_id: string }>();
  const libDepths = new Map<string, Map<string, number>>();
  for (const key of keys) {
    const [packId, kcId] = splitKey(key);
    const lib = LIBRARY[packId];
    if (lib) {
      const k = lib.kcs.find((x) => x.id === kcId);
      if (!k) continue;
      if (!libDepths.has(packId)) libDepths.set(packId, depths(lib.kcs));
      kcs.push(libKc(lib, k, libDepths.get(packId)!));
      for (const t of lib.templates)
        if (t.meta.kcs[0] === kcId) {
          templates.push({
            key: `${packId}/${t.meta.id}`,
            pack_id: packId,
            tier: libraryTier(t),
            generated: false,
            flagged: false,
            kcKeys: t.meta.kcs.map((x) => `${packId}/${x}`),
            tpl: t,
          });
        }
      for (const m of lib.misconceptions) if (m.kcs.includes(kcId)) misconceptions.set(m.id, { ...m, pack_id: packId });
      continue;
    }
    const row = db.get('select * from kc where pack_id = ? and id = ?', packId, kcId);
    if (!row) continue;
    kcs.push({
      key,
      pack_id: packId,
      id: kcId,
      title: row.title,
      kind: row.kind,
      summary: row.summary,
      expectations: j(row.expectations, []),
      prerequisites: j<string[]>(row.prerequisites, []),
      confusable: j<string[]>(row.confusable_with, []),
      depth: row.depth,
      origin: 'generated',
    });
  }
  const genPacks = [...new Set(kcs.filter((k) => k.origin === 'generated').map((k) => k.pack_id))];
  for (const p of genPacks) {
    for (const r of db.all('select * from item_template where pack_id = ?', p)) {
      const spec = j<GeneratedItemSpec | null>(r.spec, null);
      if (!spec) continue;
      templates.push({
        key: `${p}/${r.id}`,
        pack_id: p,
        tier: r.tier,
        generated: true,
        flagged: !!r.flagged,
        kcKeys: spec.kcs.map((k) => (k.includes('/') ? k : `${p}/${k}`)),
        tpl: specToTemplate(spec),
      });
    }
    for (const m of db.all('select * from misconception where pack_id = ?', p)) {
      misconceptions.set(m.id, {
        id: m.id,
        description: m.description,
        kcs: j(m.kcs, []),
        refutation: m.refutation,
        pack_id: p,
      });
    }
  }
  const goal = plan.goal as GoalLevel;
  const g = GENERIC_GOALS[goal];
  const objective = db.get('select title from objective where id = ?', plan.objective_id);
  return finish({
    id: plan.pack_id,
    title: objective?.title ?? plan.title,
    kcs,
    templates,
    misconceptions,
    goal,
    goalCaps: g.capabilities,
    transferRequired: g.transfer,
    modules: modules.map((m) => ({ ...m, kc_keys: m.kc_keys.filter((k) => !flags[k]?.removed) })),
  });
}

export function splitKey(key: string): [string, string] {
  const i = key.lastIndexOf('/');
  return [key.slice(0, i), key.slice(i + 1)];
}

const cache = new Map<string, Course>();
export function courseForEnrollment(db: DB, enrollmentId: string): Course {
  const hit = cache.get(enrollmentId);
  if (hit) return hit;
  const e = db.get(
    'select e.*, o.kind as okind, o.spec as ospec from enrollment e join objective o on o.id = e.objective_id where e.id = ?',
    enrollmentId,
  );
  if (!e) throw new Error('enrollment not found');
  const course =
    e.okind === 'library'
      ? libraryCourse(j<{ pack_id: string }>(e.ospec, { pack_id: 'intro-probability' }).pack_id, e.goal)
      : planCourse(db, e.plan_id);
  cache.set(enrollmentId, course);
  return course;
}
export function invalidateCourse(enrollmentId?: string) {
  if (enrollmentId) cache.delete(enrollmentId);
  else cache.clear();
}
