// Read models for the home, map, readiness and objectives screens.
import type { DB, Row } from './db.ts';
import { j } from './db.ts';
import type {
  Home,
  Progress,
  Readiness,
  ReadinessRow,
  KCNode,
  ObjectiveSummary,
  MasteryState,
  ObjectiveDetail,
} from '../shared/api.ts';
import { MASTERY_ORDER } from '../shared/api.ts';
import { courseForEnrollment, LIBRARY, type Course } from './content/course.ts';
import { loadStates, goalCtx, dueKcs, type KcStateRow } from './pipeline/learner.ts';
import { nextKc } from './engine/policy.ts';
import { STATE_SCORE } from './engine/mastery.ts';
import { retrievability } from './engine/scheduler.ts';

const DAY = 86_400_000;
const rank = (s: MasteryState) => MASTERY_ORDER.indexOf(s);

function counts(course: Course, states: Map<string, KcStateRow>) {
  const c = Object.fromEntries(MASTERY_ORDER.map((s) => [s, 0])) as Record<MasteryState, number>;
  for (const k of course.kcs) c[states.get(k.key)!.state]++;
  return {
    counts: c,
    total: course.kcs.length,
    retained: c.retained,
    independent_or_better: c.independent + c.new_context + c.retained,
  };
}

function goalLabel(db: DB, e: Row, course: Course): string {
  if (e.plan_id) return db.get('select goal_label from plan where id = ?', e.plan_id)?.goal_label ?? '';
  const pack = Object.values(LIBRARY).find((p) => p.id === course.id);
  return pack ? `Goal: ${pack.goals[e.goal as 'solve'].label.toLowerCase()}` : '';
}

function lastPracticed(db: DB, userId: string): Map<string, { at: string; sessions: number }> {
  const out = new Map<string, { at: string; sessions: number }>();
  for (const r of db.all(
    `select ev.kc_key, max(ev.created_at) as at, count(distinct a.session_id) as n
    from evidence ev left join attempt a on a.id = ev.attempt_id where ev.user_id = ? and ev.capability not in ('exposure','placement','placement_implied','placement_fail') group by ev.kc_key`,
    userId,
  )) {
    out.set(r.kc_key, { at: r.at, sessions: r.n });
  }
  return out;
}

export function progressView(db: DB, enrollmentId: string): Progress {
  const e = db.get('select * from enrollment where id = ?', enrollmentId)!;
  const course = courseForEnrollment(db, enrollmentId);
  const g = goalCtx(db, course, enrollmentId);
  const states = loadStates(db, e.user_id, course, g);
  const now = new Date();
  const current = nextKc(course, new Map(states));
  const needed = new Set(current ? course.byKey.get(current)!.prerequisites : []);
  const lp = lastPracticed(db, e.user_id);
  const kcs: KCNode[] = course.kcs.map((k) => {
    const s = states.get(k.key)!;
    return {
      id: k.key,
      title: k.title,
      depth: k.depth,
      state: s.state,
      placed: s.placed,
      p_known: s.p_known,
      summary: k.summary,
      prerequisites: k.prerequisites,
      unlocks: course.kcs.filter((x) => x.prerequisites.includes(k.key)).map((x) => x.key),
      capabilities: s.capsView,
      review_due_at: s.card ? s.card.due.toISOString() : null,
      review_due: !!s.card && s.card.due <= now,
      needed_for_next: needed.has(k.key) && rank(s.state) < rank('independent'),
      sessions: lp.get(k.key)?.sessions ?? 0,
      last_practiced_at: lp.get(k.key)?.at ?? null,
      evidence_tier: s.detail.best_tier ?? null,
      origin: k.origin,
    };
  });
  const objective = db.get('select target_date from objective where id = ?', e.objective_id)!;
  return {
    enrollment_id: enrollmentId,
    title: course.title,
    goal_label: goalLabel(db, e, course),
    kcs,
    ...counts(course, states),
    reviews_due: dueKcs(states, now).length,
    current_kc: current,
    has_target_date: !!objective.target_date,
  };
}

export function homeView(db: DB, enrollmentId: string): Home {
  const e = db.get('select * from enrollment where id = ?', enrollmentId)!;
  const course = courseForEnrollment(db, enrollmentId);
  const g = goalCtx(db, course, enrollmentId);
  const states = loadStates(db, e.user_id, course, g);
  const due = dueKcs(states, new Date());
  const lp = lastPracticed(db, e.user_id);
  const cur = nextKc(course, new Map(states));
  const curState = cur ? states.get(cur)! : null;
  let blurb = '';
  if (cur && curState) {
    const pending = curState.capsView
      .filter((c) => c.status !== 'passed' && c.status !== 'after_mastery')
      .map((c) => c.label.toLowerCase());
    blurb =
      curState.state === 'not_started'
        ? `New topic. ${course.byKey.get(cur)!.summary.split('. ')[0].replace(/\.$/, '')}.`
        : pending.length
          ? `Still to show: ${pending.slice(0, 3).join(', ')}.`
          : 'Almost there: a transfer problem and a delayed review are left.';
  }
  const last = db.get(
    `select s.ended_at, s.recap from session s where s.enrollment_id = ? and s.ended_at is not null and s.recap is not null order by s.ended_at desc limit 1`,
    enrollmentId,
  );
  const objective = db.get('select target_date from objective where id = ?', e.objective_id)!;
  return {
    enrollment_id: enrollmentId,
    objective_id: e.objective_id,
    title: course.title,
    goal_label: goalLabel(db, e, course),
    needs_placement:
      !e.placement_done &&
      !db.get("select 1 from session where enrollment_id = ? and kind <> 'placement' limit 1", enrollmentId),
    reviews: due.map((k) => ({
      kc_id: k,
      title: course.byKey.get(k)!.title,
      state: states.get(k)!.state,
      last_practiced_at: lp.get(k)?.at ?? null,
    })),
    review_minutes: Math.max(3, Math.round(due.length * 2)),
    continue:
      cur && curState
        ? { kc_id: cur, title: course.byKey.get(cur)!.title, state: curState.state, blurb, minutes: e.session_minutes }
        : null,
    last_session: last
      ? { ended_at: last.ended_at, summary: j<{ summary: string[] }>(last.recap, { summary: [] }).summary }
      : null,
    progress: counts(course, states),
    has_target_date: !!objective.target_date,
  };
}

export function readinessView(db: DB, enrollmentId: string): Readiness | null {
  const e = db.get('select * from enrollment where id = ?', enrollmentId)!;
  const o = db.get('select * from objective where id = ?', e.objective_id)!;
  if (!o.target_date) return null;
  const course = courseForEnrollment(db, enrollmentId);
  const g = goalCtx(db, course, enrollmentId);
  const states = loadStates(db, e.user_id, course, g);
  const target = new Date(o.target_date + 'T09:00:00Z');
  const daysLeft = Math.max(0, Math.ceil((target.getTime() - Date.now()) / DAY));
  let reqs = db.all('select * from requirement where objective_id = ? order by seq', o.id);
  if (!reqs.length)
    reqs = course.modules.map((m, i) => ({
      id: m.id,
      title: m.title,
      quote: '',
      kc_keys: JSON.stringify(m.kc_keys),
      seq: i,
    }));
  const rows: ReadinessRow[] = reqs
    .map((r) => {
      const keys = j<string[]>(r.kc_keys, []).filter((k) => course.byKey.has(k));
      let score = 0,
        verified = 0;
      let weakest: { key: string; s: number } | null = null;
      for (const k of keys) {
        const st = states.get(k)!;
        // State score × predicted recall on the target date.
        const recall = st.card ? retrievability(st.card, target) : 1;
        const s = STATE_SCORE[st.state] * (rank(st.state) >= rank('independent') ? recall : 1);
        score += s;
        if (st.detail.best_tier && st.detail.best_tier !== 'unverified') verified += s;
        if (!weakest || s < weakest.s) weakest = { key: k, s };
      }
      const readiness = keys.length ? score / keys.length : 0;
      const share = score > 0 ? verified / score : 0;
      const tiers = keys.map((k) => states.get(k)!.detail.best_tier).filter(Boolean);
      const allCode = tiers.length > 0 && tiers.every((t) => t === 'code_checked');
      const label =
        score === 0
          ? 'Not enough evidence yet'
          : allCode
            ? 'Code-checked'
            : share >= 0.6
              ? tiers.filter((t) => t === 'code_checked').length >= tiers.length / 2
                ? 'Mostly code-checked'
                : 'Mostly cross-checked'
              : 'Rubric-graded';
      const atRisk =
        readiness < 0.4 || (daysLeft <= 7 && keys.some((k) => rank(states.get(k)!.state) < rank('independent')));
      return {
        id: r.id,
        title: r.title,
        quote: r.quote,
        readiness,
        evidence_label: label,
        verified_share: share,
        at_risk: atRisk,
        weakest_kc: weakest ? { id: weakest.key, title: course.byKey.get(weakest.key)!.title } : null,
      };
    })
    .sort((a, b) => a.readiness - b.readiness);
  const due = dueKcs(states, new Date());
  const worst = rows.find((r) => r.weakest_kc)?.weakest_kc ?? null;
  const files = db.all('select filename from objective_file where objective_id = ?', o.id).map((f) => f.filename);
  const today = [
    due.length ? `${due.length} quick review${due.length === 1 ? '' : 's'}` : '',
    worst ? `${due.length ? 'then work' : 'Work'} on "${worst.title}", your most at-risk topic` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    enrollment_id: enrollmentId,
    title: o.title ?? course.title,
    source_label: files.length ? `From: ${files.join(', ')}` : 'From: your objective',
    target_date: o.target_date,
    days_left: daysLeft,
    requirements: rows,
    today: {
      minutes: e.session_minutes,
      text: today
        ? today.charAt(0).toUpperCase() + today.slice(1) + '.'
        : 'Everything is on track. A short review keeps it that way.',
      kc_id: worst?.id ?? null,
    },
  };
}

export function objectiveSummaries(db: DB, userId: string): ObjectiveSummary[] {
  return db
    .all("select * from objective where user_id = ? and status <> 'archived' order by created_at desc", userId)
    .map((o) => {
      const plan = db.get('select id, goal_label from plan where objective_id = ?', o.id);
      const e = db.get('select * from enrollment where objective_id = ? order by created_at desc limit 1', o.id);
      let stats = { retained: 0, independent_or_better: 0, total_kcs: 0, reviews_due: 0 };
      let goal: string | null = plan?.goal_label ?? null;
      if (e) {
        try {
          const course = courseForEnrollment(db, e.id);
          const states = loadStates(db, userId, course, goalCtx(db, course, e.id));
          const c = counts(course, states);
          stats = {
            retained: c.retained,
            independent_or_better: c.independent_or_better,
            total_kcs: c.total,
            reviews_due: dueKcs(states, new Date()).length,
          };
          goal = goalLabel(db, e, course);
        } catch {
          /* plan not ready */
        }
      }
      return {
        id: o.id,
        title: o.title ?? o.raw_text.slice(0, 80),
        kind: o.kind,
        status: o.status,
        target_date: o.target_date,
        plan_id: plan?.id ?? null,
        enrollment_id: e?.id ?? null,
        goal_label: goal,
        ...stats,
        created_at: o.created_at,
      };
    });
}

export function objectiveDetail(db: DB, oid: string): ObjectiveDetail {
  const o = db.get('select * from objective where id = ?', oid)!;
  const plan = db.get('select id from plan where objective_id = ?', oid);
  const e = db.get('select id from enrollment where objective_id = ?', oid);
  return {
    id: o.id,
    raw_text: o.raw_text,
    kind: o.kind,
    status: o.status,
    target_date: o.target_date,
    title: o.title,
    questions: db
      .all('select * from scoping_qa where objective_id = ? order by seq', oid)
      .map((q) => ({ seq: q.seq, question: q.question, options: j(q.options, []), answer: q.answer })),
    compile: o.compile_stage ? { stage: o.compile_stage, detail: o.compile_detail ?? undefined } : null,
    plan_id: plan?.id ?? null,
    enrollment_id: e?.id ?? null,
    error: o.error,
    files: db
      .all('select filename, length(extracted_text) as n from objective_file where objective_id = ?', oid)
      .map((f) => ({ name: f.filename, chars: f.n ?? 0 })),
  };
}
