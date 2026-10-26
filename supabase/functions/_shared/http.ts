// Shared HTTP helpers for Edge Functions (Deno).
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** CORS: echo the request origin only when it is on the ALLOWED_ORIGINS list (comma separated). */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow =
    allowedOrigins.length === 0
      ? '*' // not configured yet — JWT auth still protects every call
      : allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client that acts as the calling user (RLS + auth.uid() apply). */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface CallerProfile {
  user: User;
  role: 'admin' | 'department_user';
  department_code: string | null;
  email: string;
}

/** Validates the caller's JWT and loads their profile. Throws 401/403. */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<CallerProfile> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthenticated', 'Session expired. Please sign in again.');

  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('role, is_active, email, departments(code)')
    .eq('id', data.user.id)
    .maybeSingle();
  if (pErr) throw new HttpError(500, 'profile_lookup_failed', 'Could not load your profile');
  if (!profile || !profile.is_active) throw new HttpError(403, 'inactive', 'Your account is not active');
  // deno-lint-ignore no-explicit-any
  const dept = (profile as any).departments?.code ?? null;
  return { user: data.user, role: profile.role, department_code: dept, email: profile.email };
}

export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<CallerProfile> {
  const caller = await requireUser(req, admin);
  if (caller.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
  return caller;
}

export function handleError(req: Request, err: unknown): Response {
  if (err instanceof HttpError) {
    return json(req, { error: { code: err.code, message: err.message } }, err.status);
  }
  // Log details server-side only; never echo internals to the browser.
  console.error('[edge-function] unexpected error', err);
  return json(req, { error: { code: 'internal', message: 'Unexpected server error. Please try again.' } }, 500);
}
