// SQLite schema. JSON columns are TEXT. Content tables are loaded from packs; learner tables are
// append-only facts (attempt, evidence) plus derived state (kc_state, hypothesis, fsrs_card) that
// pipeline/learner.ts recomputes from evidence by replay.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const SCHEMA = `
create table if not exists app_user (
  id text primary key, email text unique not null, name text, created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists content_pack (
  id text primary key, version text not null, title text not null,
  origin text not null default 'library' check (origin in ('library','generated')),
  objective_id text, loaded_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists kc (
  pack_id text not null, id text not null, title text not null,
  kind text check (kind in ('procedural','conceptual')), depth int not null default 0,
  summary text not null, expectations text not null, confusable_with text not null default '[]',
  prerequisites text not null default '[]',
  source_ids text not null default '[]', library_ref text,
  primary key (pack_id, id)
);
create table if not exists misconception (
  pack_id text not null, id text not null, description text not null, kcs text not null, refutation text not null,
  primary key (pack_id, id)
);
create table if not exists item_template (
  pack_id text not null, id text not null, kc_ids text not null, capability text not null, widget text not null,
  is_transfer int default 0, discriminates text default '[]', module_path text,
  tier text not null default 'unverified' check (tier in ('code_checked','cross_checked','unverified')),
  generated int default 0, spec text, flagged int default 0,
  primary key (pack_id, id)
);

create table if not exists objective (
  id text primary key, user_id text not null references app_user(id),
  kind text check (kind in ('one_liner','bundle','library')), raw_text text not null,
  title text, spec text, target_date text,
  status text not null check (status in ('scoping','compiling','review','active','archived','failed')),
  compile_stage text, compile_detail text, error text,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists objective_file (
  id text primary key, objective_id text not null references objective(id) on delete cascade,
  filename text, mime text, size int, extracted_text text,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists scoping_qa (
  objective_id text not null references objective(id) on delete cascade, seq int not null,
  question text not null, options text not null, slot text, answer text,
  primary key (objective_id, seq)
);
create table if not exists requirement (
  id text primary key, objective_id text not null references objective(id) on delete cascade,
  quote text not null, title text not null, kc_keys text not null default '[]', seq int default 0
);
create table if not exists source (
  id text primary key, objective_id text references objective(id) on delete cascade,
  url text, title text, snippet text not null, fetched int default 0, fetched_at text
);
create table if not exists plan (
  id text primary key, objective_id text unique not null references objective(id) on delete cascade,
  pack_id text not null, title text not null, goal text not null, goal_label text not null,
  tags text not null default '[]', modules text not null, kc_flags text not null default '{}',
  learner_edits text not null default '[]', accepted_at text, updating int default 0,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists verification (
  id text primary key, pack_id text, template_id text, method text, passed int, detail text,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

create table if not exists enrollment (
  id text primary key, user_id text not null references app_user(id),
  objective_id text not null references objective(id) on delete cascade, plan_id text,
  goal text not null check (goal in ('follow','solve','teach')),
  session_minutes int default 20, reminders int default 1, placement_done int default 0,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists session (
  id text primary key, enrollment_id text not null references enrollment(id) on delete cascade,
  kind text not null check (kind in ('placement','learn','review','mock_interview')),
  kc_key text, state text not null default '{}', minutes int default 20,
  started_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')), ended_at text, recap text
);
create table if not exists item_instance (
  id text primary key, pack_id text not null, template_id text not null, kc_key text not null,
  capability text not null, params text not null, answer text not null, wrong_answers text,
  surface_text text not null, verified int not null default 0, tier text not null, is_transfer int default 0,
  widget text not null, created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists turn (
  id text primary key, session_id text not null references session(id) on delete cascade, seq int not null,
  role text check (role in ('tutor','learner')), move text, content text,
  widget text, item_instance_id text, example text, meta text,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists turn_session on turn(session_id, seq);
create table if not exists attempt (
  id text primary key, turn_id text references turn(id), session_id text, item_instance_id text,
  action_id text unique, response text not null, confidence int, ladder_rung int not null, ms_on_item int,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists evidence (
  id text primary key, attempt_id text, user_id text not null, kc_key text not null,
  capability text not null,         -- recall|explain|predict|apply|discriminate|exposure|placement|placement_implied
  correct int, uncertain int default 0, weight real not null, grader text,
  tier text, is_transfer int default 0, is_review int default 0, instance_id text, rung int default 0,
  grader_confidence real default 1, widget text, rubric_scores text, hypotheses text, confidence int, ms int,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists evidence_user_kc on evidence(user_id, kc_key, created_at);
create table if not exists hypothesis (
  user_id text not null, kc_key text not null, hypothesis_id text not null, weight real not null,
  updated_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (user_id, kc_key, hypothesis_id)
);
create table if not exists kc_state (
  user_id text not null, kc_key text not null, p_known real not null, state text not null,
  placed int default 0, capabilities text not null, detail text not null default '{}',
  updated_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (user_id, kc_key)
);
create table if not exists fsrs_card (
  user_id text not null, kc_key text not null, card text not null, due_at text not null,
  primary key (user_id, kc_key)
);
create index if not exists fsrs_due on fsrs_card(user_id, due_at);
create table if not exists llm_call (
  id text primary key, turn_id text, objective_id text, role text, model text, prompt_hash text,
  input text, output text, error text, latency_ms int, tokens_in int, tokens_out int,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists item_flag (
  id text primary key, instance_id text, user_id text, reason text,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create table if not exists stream_event (
  id integer primary key autoincrement, channel text not null, data text not null,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists stream_channel on stream_event(channel, id);
`;

export type Row = Record<string, any>;

export class DB {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }
  all(sql: string, ...params: any[]): Row[] {
    return this.db.prepare(sql).all(...params.map(norm)) as Row[];
  }
  get(sql: string, ...params: any[]): Row | undefined {
    return this.db.prepare(sql).get(...params.map(norm)) as Row | undefined;
  }
  run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params.map(norm));
  }
  tx<T>(fn: () => T): T {
    this.db.exec('begin');
    try {
      const out = fn();
      this.db.exec('commit');
      return out;
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }
  insert(table: string, row: Row) {
    const keys = Object.keys(row);
    this.run(
      `insert into ${table} (${keys.join(',')}) values (${keys.map(() => '?').join(',')})`,
      ...keys.map((k) => row[k]),
    );
  }
  upsert(table: string, row: Row, conflict: string[]) {
    const keys = Object.keys(row);
    const updates = keys.filter((k) => !conflict.includes(k)).map((k) => `${k}=excluded.${k}`);
    this.run(
      `insert into ${table} (${keys.join(',')}) values (${keys.map(() => '?').join(',')}) on conflict (${conflict.join(',')}) do ${updates.length ? 'update set ' + updates.join(',') : 'nothing'}`,
      ...keys.map((k) => row[k]),
    );
  }
}

function norm(v: any): any {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export const uuid = () => randomUUID();
export const nowIso = () => new Date().toISOString();
export const j = <T = any>(s: string | null | undefined, fallback: T): T => {
  if (s === null || s === undefined || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
