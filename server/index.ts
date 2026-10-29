// HTTP API: JSON routes, SSE streams and the built web client.
//
// Identity: with AUTH_HEADER set, the app trusts that request header (set by an authenticating
// reverse proxy such as Tailscale Serve or oauth2-proxy) as the user's email. Without it, the app
// runs single-user as LOCAL_USER, which is only safe when nothing else can reach the port.
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import './content/library.ts';
import { DB, uuid, j, nowIso, type Row } from './db.ts';
import { sseResponse } from './stream.ts';
import { deleteObjective, deleteAccount } from './privacy.ts';
import { LIBRARY, courseForEnrollment, invalidateCourse } from './content/course.ts';
import { createSession, handleAction, endSessionNow, sessionView, sessionOwner } from './pipeline/session.ts';
import { progressView, homeView, readinessView, objectiveSummaries, objectiveDetail } from './views.ts';
import { ingestAndScope, startCompile, planView, revisePlan, ensureModuleCompiled } from './compiler/compiler.ts';
import { fileToText, fetchPage, LIMITS } from './compiler/extract.ts';
import { loadStates, goalCtx, dueKcs } from './pipeline/learner.ts';
import { nextKc } from './engine/policy.ts';
import { llmAvailable, llmProvider } from './llm.ts';
import type { LearnerAction, PlanEdit, GoalLevel, SessionKind } from '../shared/api.ts';

const db = new DB(process.env.DB_PATH ?? './data/mindsear.db');
const app = new Hono<{ Variables: { user: Row } }>();

app.get('/api/health', (c) => c.json({ ok: true, llm: llmProvider() }));

const AUTH_HEADER = process.env.AUTH_HEADER || null;
const AUTH_NAME_HEADER = process.env.AUTH_NAME_HEADER || null;
const LOCAL_USER = process.env.LOCAL_USER || 'learner@localhost';

app.use('/api/*', async (c, next) => {
  const login = AUTH_HEADER ? c.req.header(AUTH_HEADER) : LOCAL_USER;
  if (!login) return c.json({ code: 'unauthenticated', message: 'Sign in through your proxy to use this app.' }, 401);
  const name = (AUTH_NAME_HEADER && c.req.header(AUTH_NAME_HEADER)) || login.split('@')[0];
  let user = db.get('select * from app_user where email = ?', login);
  if (!user) {
    db.insert('app_user', { id: uuid(), email: login, name });
    user = db.get('select * from app_user where email = ?', login)!;
  }
  c.set('user', user);
  await next();
});

const err = (c: Context, status: number, code: string, message: string) => c.json({ code, message }, status as any);
const own = (row: Row | undefined, c: Context) => row && row.user_id === (c.get('user') as Row).id;

app.get('/api/me', (c) => c.json({ email: c.get('user').email, name: c.get('user').name }));

// ---------- library ----------
app.get('/api/library', (c) =>
  c.json(
    Object.values(LIBRARY).map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      kcs: p.kcs.length,
      goals: (['follow', 'solve', 'teach'] as GoalLevel[]).map((g) => ({
        id: g,
        label: p.goals[g].label,
        blurb: p.goals[g].blurb,
        hours: p.goals[g].hours,
        capabilities: [
          ...p.goals[g].capabilities.map(capName),
          ...(p.goals[g].transfer ? ['Use it somewhere new'] : []),
        ],
      })),
    })),
  ),
);
const capName = (c: string) =>
  (
    ({
      explain: 'Explain',
      discriminate: 'Tell look-alikes apart',
      apply: 'Solve on your own',
      predict: 'Predict',
      recall: 'Recall cold',
    }) as Record<string, string>
  )[c] ?? c;

app.post('/api/library/enroll', async (c) => {
  const b = await c.req.json<{ pack_id: string; goal: GoalLevel; session_minutes?: number; reminders?: boolean }>();
  const pack = LIBRARY[b.pack_id];
  if (!pack || !['follow', 'solve', 'teach'].includes(b.goal))
    return err(c, 400, 'invalid_request', 'Unknown course or goal.');
  const user = c.get('user');
  const oid = uuid(),
    eid = uuid();
  db.insert('objective', {
    id: oid,
    user_id: user.id,
    kind: 'library',
    raw_text: pack.title,
    title: pack.title,
    spec: { pack_id: pack.id },
    status: 'active',
  });
  db.insert('enrollment', {
    id: eid,
    user_id: user.id,
    objective_id: oid,
    goal: b.goal,
    session_minutes: [10, 20, 30].includes(b.session_minutes ?? 0) ? b.session_minutes : 20,
    reminders: b.reminders !== false,
  });
  return c.json({ objective_id: oid, enrollment_id: eid });
});

// ---------- objectives ----------
app.get('/api/objectives', (c) => c.json(objectiveSummaries(db, c.get('user').id)));

app.post('/api/objectives', async (c) => {
  const user = c.get('user');
  const form = await c.req.parseBody({ all: true });
  const text = String(form.text ?? '').trim();
  const target = String(form.target_date ?? '').trim() || null;
  if (!text) return err(c, 400, 'invalid_request', 'Tell us what you want to learn.');
  if (target && !/^\d{4}-\d{2}-\d{2}$/.test(target))
    return err(c, 400, 'invalid_request', 'Target date must be YYYY-MM-DD.');
  const files = ([] as unknown[])
    .concat(form['files[]'] ?? form.files ?? [])
    .filter((f): f is File => f instanceof File);
  if (files.length > LIMITS.files) return err(c, 400, 'invalid_request', `Attach at most ${LIMITS.files} files.`);
  const oid = uuid();
  db.insert('objective', {
    id: oid,
    user_id: user.id,
    kind: files.length ? 'bundle' : 'one_liner',
    raw_text: text.slice(0, 20_000),
    target_date: target,
    status: 'scoping',
  });
  let chars = 0;
  for (const f of files) {
    if (f.size > LIMITS.fileBytes) {
      db.run('delete from objective where id = ?', oid);
      return err(c, 400, 'invalid_request', `${f.name} is over 20 MB.`);
    }
    try {
      const t = (await fileToText(f.name, f.type, Buffer.from(await f.arrayBuffer()))).slice(
        0,
        Math.max(0, LIMITS.totalChars - chars),
      );
      chars += t.length;
      db.insert('objective_file', {
        id: uuid(),
        objective_id: oid,
        filename: f.name,
        mime: f.type,
        size: f.size,
        extracted_text: t,
      });
    } catch (e) {
      db.run('delete from objective where id = ?', oid);
      return err(c, 400, 'invalid_request', (e as Error).message);
    }
  }
  const links = String(form.links ?? '')
    .split(/\s+/)
    .filter((l) => /^https?:\/\//.test(l))
    .slice(0, 10);
  for (const l of links) {
    const page = await fetchPage(l);
    if (page) {
      db.insert('objective_file', {
        id: uuid(),
        objective_id: oid,
        filename: page.title || l,
        mime: 'text/html',
        size: page.text.length,
        extracted_text: page.text.slice(0, 60_000),
      });
      db.insert('source', {
        id: uuid(),
        objective_id: oid,
        url: l,
        title: page.title || l,
        snippet: page.text.slice(0, 12_000),
        fetched: 1,
        fetched_at: nowIso(),
      });
    }
  }
  if (!llmAvailable()) {
    db.run(
      "update objective set status = 'failed', error = ? where id = ?",
      'No model credentials are configured on the server, so new objectives can’t be compiled. The Intro probability course works without them.',
      oid,
    );
  } else void ingestAndScope(db, oid);
  return c.json({ id: oid });
});

const objectiveFor = (c: Context) => {
  const o = db.get('select * from objective where id = ?', c.req.param('id'));
  return own(o, c) ? o! : null;
};

app.get('/api/objectives/:id', (c) => {
  const o = objectiveFor(c);
  return o ? c.json(objectiveDetail(db, o.id)) : err(c, 404, 'not_found', 'Objective not found.');
});
app.delete('/api/objectives/:id', (c) => {
  const o = objectiveFor(c);
  if (!o) return err(c, 404, 'not_found', 'Objective not found.');
  deleteObjective(db, o.id);
  return c.json({ ok: true });
});
app.get('/api/objectives/:id/stream', (c) => {
  const o = objectiveFor(c);
  if (!o) return err(c, 404, 'not_found', 'Objective not found.');
  // Objective channels are small: a fresh connection replays everything so nothing is missed.
  return sseResponse(
    db,
    `objective:${o.id}`,
    c.req.header('Last-Event-ID') ?? c.req.query('after') ?? '0',
    c.req.raw.signal,
  );
});
app.post('/api/objectives/:id/answers', async (c) => {
  const o = objectiveFor(c);
  if (!o) return err(c, 404, 'not_found', 'Objective not found.');
  const b = await c.req.json<{ answers: { seq: number; answer: string }[]; session_minutes?: number }>();
  for (const a of b.answers ?? [])
    db.run(
      'update scoping_qa set answer = ? where objective_id = ? and seq = ?',
      String(a.answer).slice(0, 500),
      o.id,
      a.seq,
    );
  const spec = j<any>(o.spec, {});
  if (b.session_minutes) spec.session_minutes = b.session_minutes;
  db.run('update objective set spec = ? where id = ?', JSON.stringify(spec), o.id);
  startCompile(db, o.id);
  return c.json({ ok: true });
});

// ---------- plans ----------
const planFor = (c: Context) => {
  const p = db.get(
    'select p.*, o.user_id from plan p join objective o on o.id = p.objective_id where p.id = ?',
    c.req.param('id'),
  );
  return own(p, c) ? p! : null;
};
app.get('/api/plans/:id', (c) => {
  const p = planFor(c);
  return p ? c.json(planView(db, p.id)) : err(c, 404, 'not_found', 'Plan not found.');
});
app.post('/api/plans/:id/edits', async (c) => {
  const p = planFor(c);
  if (!p) return err(c, 404, 'not_found', 'Plan not found.');
  const e = await c.req.json<PlanEdit>();
  const flags = j<Record<string, { known?: boolean; removed?: boolean }>>(p.kc_flags, {});
  const edits = j<unknown[]>(p.learner_edits, []);
  edits.push({ ...e, at: nowIso() }); // logged as feedback on the compiler
  if ('remove_kc' in e) flags[e.remove_kc] = { ...flags[e.remove_kc], removed: true };
  else if ('restore_kc' in e) flags[e.restore_kc] = { ...flags[e.restore_kc], removed: false };
  else if ('known_kc' in e) flags[e.known_kc] = { ...flags[e.known_kc], known: !!e.known };
  else if ('reorder' in e) {
    const mods = j<any[]>(p.modules, []);
    const sorted = e.reorder.map((id) => mods.find((m) => m.id === id)).filter(Boolean);
    if (sorted.length === mods.length) db.run('update plan set modules = ? where id = ?', JSON.stringify(sorted), p.id);
  } else if ('request' in e && e.request.trim()) {
    db.run(
      'update plan set learner_edits = ?, kc_flags = ? where id = ?',
      JSON.stringify(edits),
      JSON.stringify(flags),
      p.id,
    );
    void revisePlan(db, p.id, e.request.trim().slice(0, 1000)).catch((x) => console.error('revise failed', x));
    db.run('update plan set updating = 1 where id = ?', p.id);
    return c.json(planView(db, p.id));
  }
  db.run(
    'update plan set learner_edits = ?, kc_flags = ? where id = ?',
    JSON.stringify(edits),
    JSON.stringify(flags),
    p.id,
  );
  invalidateCourse();
  return c.json(planView(db, p.id));
});
app.post('/api/plans/:id/accept', (c) => {
  const p = planFor(c);
  if (!p) return err(c, 404, 'not_found', 'Plan not found.');
  const existing = db.get('select id from enrollment where plan_id = ?', p.id);
  if (existing) return c.json({ enrollment_id: existing.id });
  const o = db.get('select * from objective where id = ?', p.objective_id)!;
  const minutes = j<any>(o.spec, {}).session_minutes ?? 20;
  const eid = uuid();
  db.insert('enrollment', {
    id: eid,
    user_id: c.get('user').id,
    objective_id: o.id,
    plan_id: p.id,
    goal: p.goal,
    session_minutes: [10, 20, 30].includes(minutes) ? minutes : 20,
  });
  db.run('update plan set accepted_at = ? where id = ?', nowIso(), p.id);
  db.run("update objective set status = 'active' where id = ?", o.id);
  // Just in time: the next module now. With a deadline the readiness view spans every requirement,
  // so the rest compile in the background too (still under the per-plan token budget).
  void (async () => {
    const n = j<any[]>(p.modules, []).length;
    for (let i = 2; i < (o.target_date ? n : 3); i++) await ensureModuleCompiled(db, p.id, i);
  })();
  return c.json({ enrollment_id: eid });
});

// ---------- enrollments ----------
const enrollmentFor = (c: Context) => {
  const e = db.get('select * from enrollment where id = ?', c.req.param('id'));
  return own(e, c) ? e! : null;
};
app.get('/api/enrollments/:id/progress', (c) => {
  const e = enrollmentFor(c);
  return e ? c.json(progressView(db, e.id)) : err(c, 404, 'not_found', 'Not found.');
});
app.get('/api/enrollments/:id/home', (c) => {
  const e = enrollmentFor(c);
  return e ? c.json(homeView(db, e.id)) : err(c, 404, 'not_found', 'Not found.');
});
app.get('/api/enrollments/:id/readiness', (c) => {
  const e = enrollmentFor(c);
  if (!e) return err(c, 404, 'not_found', 'Not found.');
  const r = readinessView(db, e.id);
  return r ? c.json(r) : err(c, 404, 'not_found', 'This objective has no target date.');
});
app.get('/api/enrollments/:id/reviews/due', (c) => {
  const e = enrollmentFor(c);
  if (!e) return err(c, 404, 'not_found', 'Not found.');
  const course = courseForEnrollment(db, e.id);
  const states = loadStates(db, e.user_id, course, goalCtx(db, course, e.id));
  const cards = [...states.values()]
    .filter((s) => s.card)
    .sort((a, b) => a.card!.due.getTime() - b.card!.due.getTime());
  return c.json({ due: dueKcs(states, new Date()), next_due_at: cards[0]?.card?.due.toISOString() ?? null });
});
app.post('/api/enrollments/:id/sessions', async (c) => {
  const e = enrollmentFor(c);
  if (!e) return err(c, 404, 'not_found', 'Not found.');
  const b = await c.req.json<{ kind: SessionKind; kc_id?: string }>();
  if (!['placement', 'learn', 'review', 'mock_interview'].includes(b.kind))
    return err(c, 400, 'invalid_request', 'Unknown session kind.');
  // Compile just in time: make sure the module being learned and the next one have items.
  if (e.plan_id) {
    const course = courseForEnrollment(db, e.id);
    const states = loadStates(db, e.user_id, course, goalCtx(db, course, e.id));
    const target = b.kc_id ?? nextKc(course, new Map(states));
    const mods = j<any[]>(db.get('select modules from plan where id = ?', e.plan_id)!.modules, []);
    const idx = Math.max(
      0,
      mods.findIndex((m) => target && m.kc_keys.includes(target)),
    );
    if (mods[idx] && !mods[idx].compiled) await ensureModuleCompiled(db, e.plan_id, idx);
    void ensureModuleCompiled(db, e.plan_id, idx + 1);
  }
  try {
    const id = await createSession(db, e.id, b.kind, b.kc_id ?? null);
    return c.json({ session_id: id });
  } catch (x) {
    console.error('create session failed', x);
    return err(c, 500, 'internal', 'Could not start the session.');
  }
});

// ---------- sessions ----------
const sessionFor = (c: Context) =>
  sessionOwner(db, c.req.param('id')!) === c.get('user').id ? c.req.param('id')! : null;
app.get('/api/sessions/:id', (c) => {
  const s = sessionFor(c);
  return s ? c.json(sessionView(db, s)) : err(c, 404, 'not_found', 'Session not found.');
});
app.get('/api/sessions/:id/turns', (c) => {
  const s = sessionFor(c);
  return s ? c.json(sessionView(db, s).turns) : err(c, 404, 'not_found', 'Session not found.');
});
app.get('/api/sessions/:id/stream', (c) => {
  const s = sessionFor(c);
  if (!s) return err(c, 404, 'not_found', 'Session not found.');
  return sseResponse(
    db,
    `session:${s}`,
    c.req.header('Last-Event-ID') ?? c.req.query('after') ?? null,
    c.req.raw.signal,
  );
});
app.post('/api/sessions/:id/actions', async (c) => {
  const s = sessionFor(c);
  if (!s) return err(c, 404, 'not_found', 'Session not found.');
  const b = await c.req.json<LearnerAction & { action_id?: string }>();
  const actionId = b.action_id || uuid();
  void handleAction(db, s, b, actionId).catch((e) => console.error('action', e));
  return c.json({ action_id: actionId }, 202);
});
app.post('/api/sessions/:id/end', async (c) => {
  const s = sessionFor(c);
  return s ? c.json(await endSessionNow(db, s)) : err(c, 404, 'not_found', 'Session not found.');
});

app.post('/api/items/:id/flag', async (c) => {
  const inst = db.get('select * from item_instance where id = ?', c.req.param('id'));
  if (!inst) return err(c, 404, 'not_found', 'Item not found.');
  const b = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  db.insert('item_flag', {
    id: uuid(),
    instance_id: inst.id,
    user_id: c.get('user').id,
    reason: (b.reason ?? '').slice(0, 1000),
  });
  // A flagged generated item is demoted to unverified pending review (library items are queued for review only).
  db.run(
    "update item_template set tier = 'unverified', flagged = 1 where pack_id = ? and id = ?",
    inst.pack_id,
    inst.template_id.slice(inst.template_id.lastIndexOf('/') + 1),
  );
  invalidateCourse();
  return c.json({ ok: true });
});

// ---------- privacy: export and delete account ----------
app.get('/api/account/export', (c) => {
  const u = c.get('user');
  return c.json({
    user: { email: u.email, name: u.name },
    objectives: db.all(
      'select id, raw_text, title, target_date, status, created_at from objective where user_id = ?',
      u.id,
    ),
    evidence: db.all(
      'select kc_key, capability, correct, weight, tier, created_at from evidence where user_id = ?',
      u.id,
    ),
    states: db.all('select kc_key, state, p_known from kc_state where user_id = ?', u.id),
  });
});
app.delete('/api/account', (c) => {
  const u = c.get('user');
  deleteAccount(db, u.id);
  return c.json({ ok: true });
});

// ---------- web client ----------
const WEB = process.env.WEB_DIST ?? './web/dist';
app.use('/assets/*', serveStatic({ root: WEB }));
app.get('*', serveStatic({ root: WEB }));
app.get('*', (c) => {
  const index = `${WEB}/index.html`;
  return existsSync(index)
    ? c.html(readFileSync(index, 'utf8'))
    : c.text('Web client not built. Run npm run build:web.', 404);
});

const port = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname: HOST }, () =>
  console.log(`mindsear on ${HOST}:${port} (llm: ${llmProvider()})`),
);

// PID 1 in a container: exit promptly on stop so recreate deploys are quick.
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    try {
      db.db.close();
    } catch {
      /* */
    }
    process.exit(0);
  });
