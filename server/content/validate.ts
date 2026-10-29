import type { PackDef, ItemTemplate, Tolerance, Capability } from '../../shared/content.ts';
import { makeRng } from './rng.ts';

export function withinTolerance(value: number, target: number, tol: Tolerance | undefined): boolean {
  const t = tol ?? { rel: 0.02, abs: 0.005 };
  const diff = Math.abs(value - target);
  if (t.abs !== undefined && diff <= t.abs) return true;
  if (t.rel !== undefined && diff <= Math.abs(target) * t.rel) return true;
  return false;
}

// Returns the KC ids in topological order, or throws on a cycle / unknown prerequisite.
export function topoSort(kcs: { id: string; prerequisites: string[] }[]): string[] {
  const ids = new Set(kcs.map((k) => k.id));
  const byId = new Map(kcs.map((k) => [k.id, k]));
  for (const k of kcs)
    for (const p of k.prerequisites) {
      if (!ids.has(p)) throw new Error(`KC ${k.id}: unknown prerequisite ${p}`);
    }
  const order: string[] = [];
  const mark = new Map<string, 'temp' | 'done'>();
  const visit = (id: string, path: string[]) => {
    const m = mark.get(id);
    if (m === 'done') return;
    if (m === 'temp') throw new Error(`KC graph has a cycle: ${[...path, id].join(' -> ')}`);
    mark.set(id, 'temp');
    for (const p of byId.get(id)!.prerequisites) visit(p, [...path, id]);
    mark.set(id, 'done');
    order.push(id);
  };
  for (const k of kcs) visit(k.id, []);
  return order;
}

export function depths(kcs: { id: string; prerequisites: string[] }[]): Map<string, number> {
  const byId = new Map(kcs.map((k) => [k.id, k]));
  const d = new Map<string, number>();
  for (const id of topoSort(kcs)) {
    const pre = byId.get(id)!.prerequisites;
    d.set(id, pre.length ? 1 + Math.max(...pre.map((p) => d.get(p)!)) : 0);
  }
  return d;
}

const REQUIRED: { cap: Capability; transfer?: boolean; min: number }[] = [
  { cap: 'apply', min: 1 },
  { cap: 'discriminate', min: 1 },
  { cap: 'explain', min: 1 },
  { cap: 'predict', min: 1 },
  { cap: 'recall', min: 1 },
];

function checkTemplate(t: ItemTemplate, pack: PackDef, samples: number, errors: string[]) {
  const id = t.meta.id;
  const kcIds = new Set(pack.kcs.map((k) => k.id));
  const misIds = new Set(pack.misconceptions.map((m) => m.id));
  for (const k of t.meta.kcs) if (!kcIds.has(k)) errors.push(`${id}: unknown KC ${k}`);
  for (const m of t.meta.discriminates ?? [])
    if (!misIds.has(m)) errors.push(`${id}: discriminates unknown misconception ${m}`);
  for (const m of Object.keys(t.wrongSolve ?? {}))
    if (!misIds.has(m)) errors.push(`${id}: wrongSolve for unknown misconception ${m}`);
  const w = t.meta.widget;
  if (w === 'numeric' && !t.solve) errors.push(`${id}: numeric template needs solve()`);
  if (w === 'mcq' && !t.mcq) errors.push(`${id}: mcq template needs mcq()`);
  if (w === 'free_text' && !t.rubric) errors.push(`${id}: free_text template needs rubric`);
  if (w === 'steps' && !t.worked) errors.push(`${id}: steps template needs worked()`);
  const rng = makeRng(12345);
  for (let i = 0; i < samples; i++) {
    let p: unknown;
    try {
      p = t.params(rng);
      const text = t.text(p);
      if (!text || text.includes('undefined') || text.includes('NaN')) throw new Error(`text renders badly: ${text}`);
      const hints = t.hints(p);
      if (!hints.length) throw new Error('no hints');
      if (w === 'numeric') {
        const ans = t.solve!(p);
        if (!Number.isFinite(ans)) throw new Error(`solve not finite: ${ans}`);
        for (const [mid, f] of Object.entries(t.wrongSolve ?? {})) {
          const wrong = f(p);
          if (Number.isFinite(wrong) && withinTolerance(wrong, ans, t.meta.tolerance)) {
            // Ambiguous diagnosis: the misconception gives the right answer for these params.
            throw new Error(`wrongSolve[${mid}] collides with solve (${wrong} vs ${ans}) for ${JSON.stringify(p)}`);
          }
        }
      }
      if (w === 'mcq') {
        const { options, correct } = t.mcq!(p);
        if (options.length < 2 || correct < 0 || correct >= options.length) throw new Error('bad mcq options/correct');
        if (new Set(options.map((o) => o.text)).size !== options.length)
          throw new Error(`duplicate mcq options: ${options.map((o) => o.text).join(' | ')}`);
        for (const o of options)
          if (o.misconception && !misIds.has(o.misconception))
            throw new Error(`unknown misconception ${o.misconception}`);
      }
      if (w === 'free_text') {
        if (!t.rubric!.expectations.length) throw new Error('rubric has no expectations');
        if (!t.rubric!.reference(p)) throw new Error('empty reference');
      }
      if (t.worked) {
        const steps = t.worked(p);
        if (!steps.length) throw new Error('empty worked steps');
        for (const s of steps)
          if (s.value !== undefined && !Number.isFinite(s.value)) throw new Error('worked step value not finite');
      }
    } catch (e) {
      errors.push(`${id} (sample ${i}, params ${JSON.stringify(p)}): ${(e as Error).message}`);
      return;
    }
  }
}

export function validatePack(pack: PackDef, samples = 1000): string[] {
  const errors: string[] = [];
  try {
    topoSort(pack.kcs);
  } catch (e) {
    errors.push((e as Error).message);
  }
  const kcIds = new Set(pack.kcs.map((k) => k.id));
  if (kcIds.size !== pack.kcs.length) errors.push('duplicate KC ids');
  const tIds = new Set(pack.templates.map((t) => t.meta.id));
  if (tIds.size !== pack.templates.length) errors.push('duplicate template ids');
  for (const k of pack.kcs) {
    for (const c of k.confusable_with) if (!kcIds.has(c)) errors.push(`KC ${k.id}: unknown confusable ${c}`);
    const mine = pack.templates.filter((t) => t.meta.kcs[0] === k.id);
    for (const r of REQUIRED) {
      const n = mine.filter((t) => t.meta.capability === r.cap && !t.meta.is_transfer).length;
      if (n < r.min) errors.push(`KC ${k.id}: needs >= ${r.min} non-transfer ${r.cap} template(s), has ${n}`);
    }
    if (!mine.some((t) => t.meta.is_transfer)) errors.push(`KC ${k.id}: needs a transfer template`);
    if (!mine.some((t) => t.worked)) errors.push(`KC ${k.id}: needs at least one template with worked() for examples`);
  }
  for (const m of pack.misconceptions)
    for (const k of m.kcs) if (!kcIds.has(k)) errors.push(`misconception ${m.id}: unknown KC ${k}`);
  for (const t of pack.templates) checkTemplate(t, pack, samples, errors);
  return errors;
}
