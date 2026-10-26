import { toast } from 'react-toastify';

interface MaybeError {
  message?: string;
  code?: string;
  status?: number;
  context?: { status?: number; json?: () => Promise<unknown> };
}

/**
 * Maps Supabase / PostgREST / network errors to safe, helpful messages.
 * Raw messages are never shown when they could leak internals.
 */
export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You appear to be offline. Check your connection and try again.';
  }
  const e = err as MaybeError;
  const msg = e.message ?? '';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Network error — the server could not be reached.';
  if (e.code === '42501' || /permission denied|row-level security/i.test(msg)) {
    return 'Permission denied. Your account is not allowed to perform this action.';
  }
  if (e.code === 'PGRST301' || /JWT expired|invalid JWT/i.test(msg)) return 'Your session has expired. Please sign in again.';
  if (e.code === '23505') return 'A record with the same key already exists.';
  if (e.code === '23514' || e.code === '22023' || e.code === 'P0002' || e.code === '22P02') {
    // Check-constraint / validation messages raised by our own functions are user-safe.
    return msg || fallback;
  }
  if (/Invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email address before signing in.';
  if (/banned|User is banned/i.test(msg)) return 'This account has been deactivated. Contact your administrator.';
  if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a moment and try again.';
  return fallback;
}

export function isAuthError(err: unknown): boolean {
  const e = err as MaybeError;
  return e?.code === 'PGRST301' || e?.status === 401 || /JWT expired|invalid JWT/i.test(e?.message ?? '');
}

/** Extracts `{ error: { message } }` returned by our Edge Functions. */
export async function edgeFunctionError(err: unknown): Promise<string> {
  const e = err as MaybeError;
  try {
    const body = (await e.context?.json?.()) as { error?: { message?: string } } | undefined;
    if (body?.error?.message) return body.error.message;
  } catch {
    /* ignore */
  }
  return friendlyError(err);
}

// Toast helpers — never pass patient names or other personal data into these.
export const notify = {
  success: (m: string) => toast.success(m),
  error: (m: string) => toast.error(m),
  warning: (m: string) => toast.warning(m),
  info: (m: string) => toast.info(m),
};
