// admin-users — privileged user management (admin only).
//
// POST { action: 'list' }
// POST { action: 'create', email, full_name, role, department_code, password? }
//        password given → account created with that temporary password (email confirmed)
//        no password    → Supabase sends an invitation email
// POST { action: 'update_access', user_id, role, department_code, is_active, full_name? }
// POST { action: 'set_password', user_id, password }
// POST { action: 'send_reset', user_id }
//
// Role / department changes always go through the database function
// admin_set_user_access(), executed with the caller's own JWT, so the database
// re-checks that the caller is an active admin.

import { corsHeaders, handleError, HttpError, json, requireAdmin, serviceClient, userClient } from '../_shared/http.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES = ['admin', 'department_user'] as const;

function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new HttpError(400, 'weak_password', 'Password must be at least 10 characters and include letters and numbers');
  }
  return pw;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: { code: 'method', message: 'POST only' } }, 405);

  const admin = serviceClient();
  try {
    const caller = await requireAdmin(req, admin);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '');

    const audit = (action: string, entityId: string | null, summary: string, metadata: Record<string, unknown> = {}) =>
      admin.rpc('write_audit_for', {
        p_actor: caller.user.id,
        p_action: action,
        p_entity_type: 'profile',
        p_entity_id: entityId,
        p_department_code: (metadata.department_code as string) ?? null,
        p_summary: summary,
        p_metadata: metadata,
      });

    switch (action) {
      case 'list': {
        const { data: profiles, error } = await admin
          .from('profiles')
          .select('id, email, full_name, role, is_active, created_at, departments(code, name)')
          .order('created_at');
        if (error) throw error;
        const { data: authUsers, error: authErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
        if (authErr) throw authErr;
        const lastSignIn = new Map(authUsers.users.map((u) => [u.id, u.last_sign_in_at]));
        const confirmed = new Map(authUsers.users.map((u) => [u.id, !!u.email_confirmed_at]));
        return json(req, {
          users: (profiles ?? []).map((p) => ({
            ...p,
            last_sign_in_at: lastSignIn.get(p.id) ?? null,
            email_confirmed: confirmed.get(p.id) ?? false,
          })),
        });
      }

      case 'create': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const fullName = String(body.full_name ?? '').trim().slice(0, 120);
        const role = String(body.role ?? 'department_user');
        const dept = body.department_code ? String(body.department_code) : null;
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid email address');
        if (!ROLES.includes(role as (typeof ROLES)[number])) throw new HttpError(400, 'invalid_role', 'Invalid role');
        if (role === 'department_user' && !dept) {
          throw new HttpError(400, 'department_required', 'Choose a department for this user');
        }
        if (dept) {
          const { data: d } = await admin.from('departments').select('code').eq('code', dept).maybeSingle();
          if (!d) throw new HttpError(400, 'invalid_department', 'Unknown department');
        }

        const appMeta = { role, department: dept };
        const userMeta = { full_name: fullName || null };
        let userId: string;
        if (body.password) {
          const { data, error } = await admin.auth.admin.createUser({
            email,
            password: validatePassword(body.password),
            email_confirm: true,
            app_metadata: appMeta,
            user_metadata: userMeta,
          });
          if (error) throw new HttpError(400, 'create_failed', error.message);
          userId = data.user.id;
        } else {
          const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
            data: userMeta,
            redirectTo: Deno.env.get('APP_URL') ? `${Deno.env.get('APP_URL')}/reset-password` : undefined,
          });
          if (error) throw new HttpError(400, 'invite_failed', error.message);
          userId = data.user.id;
          // invite API cannot set app_metadata; apply access explicitly
          await admin.auth.admin.updateUserById(userId, { app_metadata: appMeta });
          await admin.from('profiles').update({
            role,
            department_id: dept ? (await admin.from('departments').select('id').eq('code', dept).single()).data?.id : null,
            is_active: true,
          }).eq('id', userId);
        }
        await audit('user.created', userId, `User ${email} created`, { role, department_code: dept, invited: !body.password });
        return json(req, { user_id: userId });
      }

      case 'update_access': {
        const userId = String(body.user_id ?? '');
        if (!userId) throw new HttpError(400, 'user_required', 'user_id is required');
        if (userId === caller.user.id && body.is_active === false) {
          throw new HttpError(400, 'self_deactivate', 'You cannot deactivate your own account');
        }
        // Executed as the caller: the database enforces admin-only access and audits the change.
        const { data, error } = await userClient(req).rpc('admin_set_user_access', {
          p_user_id: userId,
          p_role: body.role,
          p_department_code: body.department_code ?? null,
          p_is_active: body.is_active !== false,
          p_full_name: body.full_name ?? null,
        });
        if (error) throw new HttpError(400, 'update_failed', error.message);
        // Block or unblock sign-in at the auth layer as well
        await admin.auth.admin.updateUserById(userId, {
          ban_duration: body.is_active === false ? '876000h' : 'none',
          app_metadata: { role: body.role, department: body.department_code ?? null },
        });
        return json(req, { profile: data });
      }

      case 'set_password': {
        const userId = String(body.user_id ?? '');
        const { error } = await admin.auth.admin.updateUserById(userId, { password: validatePassword(body.password) });
        if (error) throw new HttpError(400, 'password_failed', error.message);
        await audit('user.password_reset', userId, 'Temporary password set by administrator');
        return json(req, { ok: true });
      }

      case 'send_reset': {
        const userId = String(body.user_id ?? '');
        const { data: u, error } = await admin.auth.admin.getUserById(userId);
        if (error || !u.user?.email) throw new HttpError(404, 'not_found', 'User not found');
        const { error: rErr } = await userClient(req).auth.resetPasswordForEmail(u.user.email, {
          redirectTo: Deno.env.get('APP_URL') ? `${Deno.env.get('APP_URL')}/reset-password` : undefined,
        });
        if (rErr) throw new HttpError(400, 'reset_failed', rErr.message);
        await audit('user.password_reset_sent', userId, 'Password reset email sent');
        return json(req, { ok: true });
      }

      default:
        throw new HttpError(400, 'unknown_action', 'Unknown action');
    }
  } catch (err) {
    return handleError(req, err);
  }
});
