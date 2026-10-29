import type { SessionKind } from '../../shared/api.ts';
import { api } from './api.ts';
import { showError } from './hooks.ts';
import { navigate } from './router.tsx';

/** Create a session and open it. Returns false (and shows the banner) on failure. */
export async function startSessionAndGo(
  enrollmentId: string,
  kind: SessionKind,
  kcId?: string | null,
): Promise<boolean> {
  try {
    const { session_id } = await api.startSession(enrollmentId, kind, kcId);
    navigate(`/s/${encodeURIComponent(session_id)}`);
    return true;
  } catch (e) {
    showError(e);
    return false;
  }
}
