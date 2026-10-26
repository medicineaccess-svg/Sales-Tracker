import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { FullPageLoader } from '@/components/ui/feedback';

/** Requires a signed-in, active user. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  if (loading || (session && !profile)) return <FullPageLoader label="Loading your workspace…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** UI-level guard only — the database enforces the same rule independently. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}

/** Requires access to a department (admins: all; department users: their own). */
export function RequireDepartment({ code, children }: { code: string; children: ReactNode }) {
  const { isAdmin, profile } = useAuth();
  if (!isAdmin && profile?.departments?.code !== code) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}
