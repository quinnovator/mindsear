// Item materialization: pick params, run solve(), render text, build the widget.
import type { DB, Row } from '../db.ts';
import { uuid, j } from '../db.ts';
import type { Course, CourseTemplate } from '../content/course.ts';
import type { Capability, WorkedStep, McqOption, Tolerance } from '../../shared/content.ts';
import type { ItemView, Widget, ExampleCard } from '../../shared/api.ts';
import { makeRng, randomSeed } from '../content/rng.ts';
import { formatNumber, revealForms } from '../engine/grading.ts';
import { writeItem } from './roles.ts';
import { llmAvailable } from '../llm.ts';

export interface Instance {
  id: string;
  template_key: string;
  kc_key: string;
  capability: Capability;
  tier: CourseTemplate['tier'];
  is_transfer: boolean;
  params: any;
  surface_text: string;
  widget: Widget;
  answer: {
    numeric?: number;
    unit?: '%' | '';
    tolerance?: Tolerance;
    mcq?: number;
    options?: McqOption[];
    reference?: string;
    expectations?: { id: string; text: string }[];
    steps?: number[];
    blankIdx?: number[];
  };
  wrong: Record<string, number>;
  verified: boolean;
}

const CAP_WORD: Record<Capability, string> = {
  apply: 'Apply',
  explain: 'Explain',
  predict: 'Predict',
  discriminate: 'Tell apart',
  recall: 'Recall',
};

export function findTemplate(course: Course, key: string): CourseTemplate {
  const t = course.templates.find((x) => x.key === key);
  if (!t) throw new Error(`template ${key} not in course`);
  return t;
}

function stepLabel(s: WorkedStep, blank: boolean): string {
  if (!blank) return s.text;
  const i = s.text.lastIndexOf('=');
  return i >= 0 ? s.text.slice(0, i).trim() + ' = ?' : s.text + ' = ?';
}

export function buildInstance(
  course: Course,
  t: CourseTemplate,
  opts: { blanks?: number; seed?: number } = {},
): Instance {
  const rng = makeRng(opts.seed ?? randomSeed());
  const p = t.tpl.params(rng);
  const m = t.tpl.meta;
  const base = {
    id: uuid(),
    template_key: t.key,
    kc_key: t.kcKeys[0],
    capability: m.capability,
    tier: t.tier,
    is_transfer: !!m.is_transfer,
    params: p,
    surface_text: t.tpl.text(p),
    verified: t.tier !== 'unverified',
    wrong: {} as Record<string, number>,
  };
  if (opts.blanks && t.tpl.worked) {
    const steps = t.tpl.worked(p);
    const valued = steps.map((s, i) => (s.value !== undefined ? i : -1)).filter((i) => i >= 0);
    const blankIdx = valued.slice(-opts.blanks);
    return {
      ...base,
      capability: 'apply',
      widget: {
        kind: 'steps',
        steps: steps.map((s, i) => ({
          label: stepLabel(s, blankIdx.includes(i)),
          given: blankIdx.includes(i) ? null : s.value !== undefined ? formatNumber(s.value, s.unit) : '',
          unit: s.unit ?? '',
        })),
      },
      answer: {
        steps: blankIdx.map((i) => steps[i].value!),
        blankIdx,
        unit: steps[blankIdx[0]]?.unit ?? '',
        tolerance: m.tolerance,
      },
    };
  }
  switch (m.widget) {
    case 'numeric': {
      const ans = t.tpl.solve!(p);
      const wrong: Record<string, number> = {};
      for (const [k, f] of Object.entries(t.tpl.wrongSolve ?? {})) {
        try {
          wrong[k] = f(p);
        } catch {
          /* skip */
        }
      }
      return {
        ...base,
        wrong,
        widget: { kind: 'numeric', unit: m.unit ?? '', placeholder: m.unit === '%' ? 'e.g. 12.5' : 'e.g. 0.25' },
        answer: { numeric: ans, unit: m.unit ?? '', tolerance: m.tolerance },
      };
    }
    case 'mcq': {
      const q = t.tpl.mcq!(p);
      return {
        ...base,
        widget: { kind: 'mcq', options: q.options.map((o) => o.text), allow_unsure: true },
        answer: { mcq: q.correct, options: q.options },
      };
    }
    case 'free_text':
      return {
        ...base,
        widget: { kind: 'free_text', max_chars: 400, allow_unsure: true, ask_confidence: true },
        answer: { reference: t.tpl.rubric!.reference(p), expectations: t.tpl.rubric!.expectations },
      };
    case 'steps': {
      const steps = t.tpl.worked!(p);
      const blankIdx = steps.map((s, i) => (s.value !== undefined ? i : -1)).filter((i) => i >= 0);
      return {
        ...base,
        widget: {
          kind: 'steps',
          steps: steps.map((s, i) => ({
            label: stepLabel(s, blankIdx.includes(i)),
            given: blankIdx.includes(i) ? null : '',
            unit: s.unit ?? '',
          })),
        },
        answer: { steps: blankIdx.map((i) => steps[i].value!), blankIdx, unit: '', tolerance: m.tolerance },
      };
    }
  }
}

export function saveInstance(db: DB, inst: Instance): void {
  db.insert('item_instance', {
    id: inst.id,
    pack_id: inst.template_key.slice(0, inst.template_key.lastIndexOf('/')),
    template_id: inst.template_key,
    kc_key: inst.kc_key,
    capability: inst.capability,
    params: inst.params,
    answer: inst.answer,
    wrong_answers: inst.wrong,
    surface_text: inst.surface_text,
    verified: inst.verified,
    tier: inst.tier,
    is_transfer: inst.is_transfer,
    widget: inst.widget,
  });
}

export function loadInstance(db: DB, id: string): Instance | null {
  const r = db.get('select * from item_instance where id = ?', id);
  return r ? rowToInstance(r) : null;
}
export function rowToInstance(r: Row): Instance {
  return {
    id: r.id,
    template_key: r.template_id,
    kc_key: r.kc_key,
    capability: r.capability,
    tier: r.tier,
    is_transfer: !!r.is_transfer,
    params: j(r.params, {}),
    surface_text: r.surface_text,
    widget: j(r.widget, { kind: 'none' }),
    answer: j(r.answer, {}),
    wrong: j(r.wrong_answers, {}),
    verified: !!r.verified,
  };
}

export function itemView(course: Course, inst: Instance, hintsUsed: number): ItemView {
  const kcTitle = course.byKey.get(inst.kc_key)?.title ?? '';
  return {
    instance_id: inst.id,
    capability: inst.capability,
    kc_id: inst.kc_key,
    label: `${inst.is_transfer ? 'Apply · new context' : CAP_WORD[inst.capability]} · ${kcTitle}`,
    text: inst.surface_text,
    is_transfer: inst.is_transfer,
    hints_used: hintsUsed,
  };
}

export function exampleCard(
  course: Course,
  t: CourseTemplate,
  params: any,
  title = 'Worked example',
): ExampleCard | null {
  if (!t.tpl.worked) return null;
  const steps = t.tpl.worked(params);
  return { title, steps: [{ text: t.tpl.text(params) }, ...steps.map((s) => ({ text: s.text }))] };
}

// Answer values the Tutor must never state before rung 6.
export function mustNotReveal(inst: Instance | null): string[] {
  if (!inst) return [];
  const a = inst.answer;
  if (a.numeric !== undefined) return revealForms(a.numeric, a.unit);
  if (a.steps) return a.steps.flatMap((v) => revealForms(v, a.unit));
  if (a.mcq !== undefined && a.options) return [];
  return [];
}

export function correctOptionText(inst: Instance): string | null {
  return inst.answer.mcq !== undefined && inst.answer.options ? inst.answer.options[inst.answer.mcq].text : null;
}

// Item Writer prefetch ("branch pre-generation" for items): while one instance is on screen, prepare
// a fresh instance of the same template with rewritten, independently verified surface text.
const prepared = new Map<string, Promise<Instance | null>>();

export function prefetch(db: DB, course: Course, sessionId: string, templateKey: string, context: string | null): void {
  const k = `${sessionId}|${templateKey}`;
  if (prepared.has(k) || !llmAvailable() || prepared.size > 500) return;
  const t = course.templates.find((x) => x.key === templateKey);
  if (!t || t.generated || t.tpl.meta.widget !== 'numeric') return;
  prepared.set(
    k,
    (async () => {
      const inst = buildInstance(course, t);
      const w = await writeItem(db, inst.surface_text, inst.answer.numeric ?? null, inst.answer.unit, context);
      if (w?.verified) {
        inst.surface_text = w.text;
        return inst;
      }
      return inst; // writer failed or verifier disagreed: canned text
    })().catch(() => null),
  );
}

export async function takePrepared(sessionId: string, templateKey: string): Promise<Instance | null> {
  const k = `${sessionId}|${templateKey}`;
  const p = prepared.get(k);
  if (!p) return null;
  // Only use it if it's already done: never make the learner wait for the writer.
  const done = await Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), 5))]);
  if (done === 'pending') return null;
  prepared.delete(k);
  return done ? { ...done, id: uuid() } : null;
}
