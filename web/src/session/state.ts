// Session state. Every update is idempotent by turn id so replays and refetches are harmless.
import type { Recap, SessionRail, SessionView, StreamEvent, Turn } from '../../../shared/api.ts';

export type LocalTurn = Turn & { streaming?: boolean };

export interface SessionState {
  view: SessionView | null;
  turns: LocalTurn[];
  rail: SessionRail | null;
  placement: { asked: number; max: number } | null;
  hintNoteShown: boolean;
  recap: Recap | null;
  assessing: string | null;
  waiting: boolean; // an action is in flight / the tutor is working
  streamingId: string | null;
  streamError: string | null;
}

export const initialState: SessionState = {
  view: null,
  turns: [],
  rail: null,
  placement: null,
  hintNoteShown: false,
  recap: null,
  assessing: null,
  waiting: false,
  streamingId: null,
  streamError: null,
};

export type SessionAction =
  | { type: 'loaded'; view: SessionView }
  | { type: 'event'; ev: StreamEvent }
  | { type: 'posted'; hint?: boolean }
  | { type: 'post_failed' }
  | { type: 'recap'; recap: Recap }
  | { type: 'dismiss_stream_error' };

function upsert(turns: LocalTurn[], t: LocalTurn): LocalTurn[] {
  const i = turns.findIndex((x) => x.id === t.id);
  let next: LocalTurn[];
  if (i === -1) next = [...turns, t];
  else {
    next = [...turns];
    // Keep a widget we already know about if the server version omits it on an older turn
    // (lets us show past multiple-choice options read-only).
    const prev = turns[i];
    next[i] = { ...t, widget: t.widget ?? (t.streaming ? null : prev.widget) };
  }
  return next.sort((a, b) => a.seq - b.seq);
}

function mergeTurns(local: LocalTurn[], server: Turn[]): LocalTurn[] {
  let out = local.filter((t) => !server.some((s) => s.id === t.id));
  for (const s of server) out = upsert(out, s);
  // Merge known widgets back for read-only display.
  return out.map((t) => {
    if (t.widget) return t;
    const old = local.find((l) => l.id === t.id);
    return old?.widget ? { ...t, widget: old.widget } : t;
  });
}

export function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'loaded': {
      const v = action.view;
      const turns = mergeTurns(state.turns, v.turns);
      const last = turns[turns.length - 1];
      const stillStreaming = state.streamingId != null && turns.some((t) => t.id === state.streamingId && t.streaming);
      return {
        ...state,
        view: v,
        turns,
        rail: v.rail,
        placement: v.placement ?? state.placement,
        hintNoteShown: state.hintNoteShown || v.hint_note_shown,
        recap: v.recap ?? state.recap,
        waiting: !v.ended_at && !v.recap && (stillStreaming || last?.role === 'learner'),
        streamingId: stillStreaming ? state.streamingId : null,
      };
    }
    case 'posted':
      return { ...state, waiting: true, hintNoteShown: state.hintNoteShown || !!action.hint };
    case 'post_failed':
      return { ...state, waiting: false };
    case 'recap':
      return { ...state, recap: action.recap, waiting: false, assessing: null };
    case 'dismiss_stream_error':
      return { ...state, streamError: null };
    case 'event':
      return applyEvent(state, action.ev);
  }
}

function applyEvent(state: SessionState, ev: StreamEvent): SessionState {
  switch (ev.event) {
    case 'ack':
      return state;
    case 'learner.turn':
      return { ...state, turns: upsert(state.turns, ev.turn), waiting: true };
    case 'assessing':
      return { ...state, assessing: ev.label, waiting: true };
    case 'tutor.start': {
      if (state.turns.some((t) => t.id === ev.turn_id && !t.streaming)) return state; // already final
      const placeholder: LocalTurn = {
        id: ev.turn_id,
        seq: ev.seq,
        role: 'tutor',
        move: ev.move,
        content: '',
        item: null,
        widget: null,
        example: null,
        meta: null,
        created_at: new Date().toISOString(),
        streaming: true,
      };
      return {
        ...state,
        turns: upsert(state.turns, placeholder),
        streamingId: ev.turn_id,
        assessing: null,
        waiting: true,
      };
    }
    case 'tutor.delta': {
      const i = state.turns.findIndex((t) => t.id === ev.turn_id);
      if (i === -1) {
        const seq = (state.turns[state.turns.length - 1]?.seq ?? 0) + 1;
        const t: LocalTurn = {
          id: ev.turn_id,
          seq,
          role: 'tutor',
          move: null,
          content: ev.text,
          item: null,
          widget: null,
          example: null,
          meta: null,
          created_at: new Date().toISOString(),
          streaming: true,
        };
        return { ...state, turns: upsert(state.turns, t), streamingId: ev.turn_id, assessing: null, waiting: true };
      }
      if (!state.turns[i].streaming) return state;
      const turns = [...state.turns];
      turns[i] = { ...turns[i], content: turns[i].content + ev.text };
      return { ...state, turns, assessing: null };
    }
    case 'tutor.done': {
      let turns = state.turns;
      if (state.streamingId && state.streamingId !== ev.turn.id)
        turns = turns.filter((t) => t.id !== state.streamingId);
      turns = upsert(turns, { ...ev.turn, streaming: false });
      return { ...state, turns, streamingId: null, assessing: null, waiting: false };
    }
    case 'progress': {
      if (!state.rail?.kc || state.rail.kc.id !== ev.kc_id) {
        if (!state.rail) return state;
        return {
          ...state,
          rail: {
            ...state.rail,
            path: state.rail.path.map((p) => (p.id === ev.kc_id ? { ...p, state: ev.state } : p)),
          },
        };
      }
      return {
        ...state,
        rail: {
          ...state.rail,
          kc: { ...state.rail.kc, state: ev.state, capabilities: ev.capabilities },
          path: state.rail.path.map((p) => (p.id === ev.kc_id ? { ...p, state: ev.state } : p)),
        },
      };
    }
    case 'rail':
      return { ...state, rail: ev.rail };
    case 'placement':
      return { ...state, placement: { asked: ev.asked, max: ev.max } };
    case 'session.recap':
      return { ...state, recap: ev.recap, waiting: false, assessing: null };
    case 'error':
      return { ...state, streamError: ev.message, waiting: false, assessing: null };
  }
}

/** The tutor turn whose widget is the pending action, if any. */
export function activeTurn(state: SessionState): LocalTurn | null {
  if (state.recap || state.view?.ended_at) return null;
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const t = state.turns[i];
    if (t.role !== 'tutor') continue;
    if (t.streaming) return null;
    // Only the latest tutor turn carries a live widget.
    return t.widget && t.widget.kind !== 'none' ? t : null;
  }
  return null;
}

/** The most recent item shown at or before the given turn (a hint turn may carry the widget without repeating the item). */
export function itemFor(state: SessionState, turn: LocalTurn) {
  if (turn.item) return turn.item;
  const idx = state.turns.indexOf(turn);
  for (let i = idx - 1; i >= 0; i--) {
    const t = state.turns[i];
    if (t.role === 'tutor' && t.item) return t.item;
  }
  return null;
}
