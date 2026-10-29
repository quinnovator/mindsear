// SSE hub. Every event is persisted with an id so a client reconnecting with Last-Event-ID gets
// the events it missed.
import type { DB } from './db.ts';

type Listener = (id: number, data: string) => void;
const listeners = new Map<string, Set<Listener>>();

export function publish(db: DB, channel: string, event: { event: string } & Record<string, unknown>): void {
  const data = JSON.stringify(event);
  const r = db.run('insert into stream_event (channel, data) values (?, ?)', channel, data);
  const id = Number(r.lastInsertRowid);
  for (const l of listeners.get(channel) ?? []) l(id, data);
}

export function subscribe(channel: string, l: Listener): () => void {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel)!.add(l);
  return () => listeners.get(channel)?.delete(l);
}

export function replay(db: DB, channel: string, afterId: number): { id: number; data: string }[] {
  return db.all('select id, data from stream_event where channel = ? and id > ? order by id', channel, afterId) as {
    id: number;
    data: string;
  }[];
}

export function sseResponse(db: DB, channel: string, lastEventId: string | null, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  let unsub = () => {};
  let ping: ReturnType<typeof setInterval> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (id: number, data: string) => {
        const ev = (JSON.parse(data) as { event: string }).event;
        try {
          ctrl.enqueue(enc.encode(`id: ${id}\nevent: ${ev}\ndata: ${data}\n\n`));
        } catch {
          /* closed */
        }
      };
      ctrl.enqueue(enc.encode('retry: 2000\n\n'));
      const after = lastEventId ? Number(lastEventId) : NaN;
      if (Number.isFinite(after)) for (const r of replay(db, channel, after)) send(r.id, r.data);
      unsub = subscribe(channel, send);
      ping = setInterval(() => {
        try {
          ctrl.enqueue(enc.encode(': ping\n\n'));
        } catch {
          /* closed */
        }
      }, 15_000);
      signal.addEventListener('abort', () => {
        unsub();
        if (ping) clearInterval(ping);
        try {
          ctrl.close();
        } catch {
          /* */
        }
      });
    },
    cancel() {
      unsub();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

// Latest event id on a channel: clients that load a snapshot first pass this as the stream cursor.
export function cursor(db: DB, channel: string): number {
  return Number(db.get('select max(id) as m from stream_event where channel = ?', channel)?.m ?? 0);
}
