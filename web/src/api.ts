// Thin typed client for the /api contract in shared/api.ts. Every call is JSON over same-origin fetch.
import type {
  GoalLevel,
  Home,
  LearnerAction,
  LibraryPack,
  Me,
  ObjectiveDetail,
  ObjectiveSummary,
  Plan,
  PlanEdit,
  Progress,
  Readiness,
  Recap,
  SessionKind,
  SessionView,
} from '../../shared/api.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function friendlyMessage(status: number, serverMessage: string | null): string {
  if (status === 404) return serverMessage ?? "We couldn't find that. It may have been deleted.";
  if (status === 401 || status === 403) return serverMessage ?? 'You need to sign in again to continue.';
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  return serverMessage ?? "That didn't work. Try again.";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "We couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    let serverMessage: string | null = null;
    try {
      const data = (await res.json()) as { message?: unknown; error?: unknown };
      const m = typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : null;
      serverMessage = m && m.length < 300 ? m : null;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, friendlyMessage(res.status, serverMessage));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  me: () => request<Me>('GET', '/me'),

  objectives: () => request<ObjectiveSummary[]>('GET', '/objectives'),
  createObjective: (form: FormData) => request<{ id: string }>('POST', '/objectives', form),
  objective: (id: string) => request<ObjectiveDetail>('GET', `/objectives/${enc(id)}`),
  answerScoping: (id: string, body: { answers: { seq: number; answer: string }[]; session_minutes?: number }) =>
    request<{ ok: true }>('POST', `/objectives/${enc(id)}/answers`, body),
  deleteObjective: (id: string) => request<{ ok: true }>('DELETE', `/objectives/${enc(id)}`),

  library: () => request<LibraryPack[]>('GET', '/library'),
  enroll: (body: { pack_id: string; goal: GoalLevel; session_minutes: 10 | 20 | 30; reminders: boolean }) =>
    request<{ objective_id: string; enrollment_id: string }>('POST', '/library/enroll', body),

  plan: (id: string) => request<Plan>('GET', `/plans/${enc(id)}`),
  editPlan: (id: string, edit: PlanEdit) => request<Plan>('POST', `/plans/${enc(id)}/edits`, edit),
  acceptPlan: (id: string) => request<{ enrollment_id: string }>('POST', `/plans/${enc(id)}/accept`),

  home: (enrollmentId: string) => request<Home>('GET', `/enrollments/${enc(enrollmentId)}/home`),
  progress: (enrollmentId: string) => request<Progress>('GET', `/enrollments/${enc(enrollmentId)}/progress`),
  readiness: (enrollmentId: string) => request<Readiness>('GET', `/enrollments/${enc(enrollmentId)}/readiness`),

  startSession: (enrollmentId: string, kind: SessionKind, kcId?: string | null) =>
    request<{ session_id: string }>(
      'POST',
      `/enrollments/${enc(enrollmentId)}/sessions`,
      kcId ? { kind, kc_id: kcId } : { kind },
    ),
  session: (id: string) => request<SessionView>('GET', `/sessions/${enc(id)}`),
  act: (id: string, action: LearnerAction & { action_id: string }) =>
    request<{ action_id: string }>('POST', `/sessions/${enc(id)}/actions`, action),
  endSession: (id: string) => request<Recap>('POST', `/sessions/${enc(id)}/end`),
  flagItem: (instanceId: string, reason?: string) =>
    request<{ ok: true }>('POST', `/items/${enc(instanceId)}/flag`, reason ? { reason } : {}),
};

export function newActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Try again.';
}
