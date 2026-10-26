import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { friendlyError, notify } from '@/lib/errors';
import type { Profile } from '@/types/database';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  departmentCode: string | null; // department the user is working in
  setDepartmentCode: (code: string) => void;
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  signOut: (reason?: 'manual' | 'expired' | 'inactive') => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const DEPT_KEY = 'ikris.department';

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, department_id, is_active, departments(code, name)')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DEPT_KEY);
    } catch {
      return null;
    }
  });
  const manualSignOut = useRef(false);

  const clearSensitiveState = useCallback(() => {
    queryClient.clear(); // drop every cached sales/report/audit query
    setProfile(null);
    try {
      sessionStorage.removeItem(DEPT_KEY);
    } catch {
      /* ignore */
    }
    setSelectedDept(null);
  }, [queryClient]);

  const signOut = useCallback(
    async (reason: 'manual' | 'expired' | 'inactive' = 'manual') => {
      manualSignOut.current = true;
      if (reason === 'manual') {
        await supabase.rpc('log_client_event', { p_action: 'auth.logout' }).then(() => undefined, () => undefined);
      }
      await supabase.auth.signOut().catch(() => undefined);
      clearSensitiveState();
      setSession(null);
      if (reason === 'expired') notify.warning('Your session has expired. Please sign in again.');
      if (reason === 'inactive') notify.error('This account is not active. Contact your administrator.');
      if (reason === 'manual') notify.info('You have been signed out.');
    },
    [clearSensitiveState],
  );

  const applySession = useCallback(
    async (s: Session | null) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        return;
      }
      try {
        const p = await loadProfile(s.user.id);
        if (!p || !p.is_active) {
          await signOut('inactive');
          return;
        }
        setProfile(p);
      } catch (e) {
        notify.error(friendlyError(e, 'Could not load your profile.'));
      }
    },
    [signOut],
  );

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      await applySession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') {
        if (!manualSignOut.current) {
          // Token refresh failed or the session was revoked elsewhere
          clearSensitiveState();
          notify.warning('Your session has expired. Please sign in again.');
        }
        manualSignOut.current = false;
        setSession(null);
        setProfile(null);
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setSession(s);
        return;
      }
      if (event === 'SIGNED_IN') {
        // Defer DB calls out of the auth callback (supabase-js recommendation)
        setTimeout(() => void applySession(s), 0);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [applySession, clearSensitiveState]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.session) return { ok: false as const, message: friendlyError(error, 'Sign-in failed.') };
    const p = await loadProfile(data.session.user.id).catch(() => null);
    if (!p || !p.is_active) {
      manualSignOut.current = true;
      await supabase.auth.signOut();
      return { ok: false as const, message: 'This account is not active or has no department assigned. Contact your administrator.' };
    }
    setProfile(p);
    setSession(data.session);
    void supabase.rpc('log_client_event', { p_action: 'auth.login' });
    return { ok: true as const };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session) return;
    const p = await loadProfile(session.user.id);
    setProfile(p);
  }, [session]);

  const isAdmin = profile?.role === 'admin';
  const ownDept = profile?.departments?.code ?? null;
  const departmentCode = isAdmin ? (selectedDept ?? 'npp') : ownDept;

  const setDepartmentCode = useCallback(
    (code: string) => {
      if (!isAdmin) return; // department users are pinned to their own department
      setSelectedDept(code);
      try {
        sessionStorage.setItem(DEPT_KEY, code);
      } catch {
        /* ignore */
      }
    },
    [isAdmin],
  );

  const value = useMemo<AuthState>(
    () => ({ session, profile, loading, isAdmin, departmentCode, setDepartmentCode, signIn, signOut, refreshProfile }),
    [session, profile, loading, isAdmin, departmentCode, setDepartmentCode, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
