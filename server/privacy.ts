// Deleting an objective removes everything derived from it.
import type { DB } from './db.ts';
import { invalidateCourse } from './content/course.ts';

function deleteSessions(db: DB, where: string, arg: string) {
  const ids = db.all(`select id from session where ${where}`, arg).map((r) => r.id as string);
  for (const id of ids) {
    db.run('delete from attempt where session_id = ? or turn_id in (select id from turn where session_id = ?)', id, id);
    db.run('delete from turn where session_id = ?', id);
    db.run('delete from stream_event where channel = ?', `session:${id}`);
    db.run('delete from session where id = ?', id);
  }
}

export function deleteObjective(db: DB, oid: string): void {
  db.tx(() => {
    const o = db.get('select user_id from objective where id = ?', oid);
    if (!o) return;
    for (const e of db.all('select id from enrollment where objective_id = ?', oid))
      deleteSessions(db, 'enrollment_id = ?', e.id);
    db.run('delete from enrollment where objective_id = ?', oid);
    // The generated pack and the learner's evidence on its KCs (library KC evidence is shared and kept).
    for (const p of db.all("select id from content_pack where origin = 'generated' and objective_id = ?", oid)) {
      const like = `${p.id}/%`;
      for (const t of ['evidence', 'hypothesis', 'kc_state', 'fsrs_card'])
        db.run(`delete from ${t} where user_id = ? and kc_key like ?`, o.user_id, like);
      for (const t of ['item_template', 'kc', 'misconception', 'verification'])
        db.run(`delete from ${t} where pack_id = ?`, p.id);
      db.run('delete from item_instance where pack_id = ?', p.id);
      db.run('delete from content_pack where id = ?', p.id);
    }
    db.run('delete from llm_call where objective_id = ?', oid);
    db.run('delete from stream_event where channel = ?', `objective:${oid}`);
    db.run('delete from objective where id = ?', oid); // cascades plan, files, scoping, requirements, sources
  });
  invalidateCourse();
}

export function deleteAccount(db: DB, userId: string): void {
  for (const o of db.all('select id from objective where user_id = ?', userId)) deleteObjective(db, o.id);
  db.tx(() => {
    for (const t of ['evidence', 'hypothesis', 'kc_state', 'fsrs_card', 'item_flag'])
      db.run(`delete from ${t} where user_id = ?`, userId);
    db.run('delete from app_user where id = ?', userId);
  });
  invalidateCourse();
}
