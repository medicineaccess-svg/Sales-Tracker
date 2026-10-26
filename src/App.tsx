import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { RequireAdmin, RequireAuth, RequireDepartment } from '@/auth/guards';
import { AppLayout } from '@/components/layout/AppLayout';
import { FullPageLoader, Skeleton } from '@/components/ui/feedback';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/auth/PasswordPages';
import { NotFoundPage, UnauthorizedPage } from '@/pages/StatusPages';

// Route-level code splitting for non-essential pages
const OverviewPage = lazy(() => import('@/pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SalesPage = lazy(() => import('@/pages/SalesPage').then((m) => ({ default: m.SalesPage })));
const SyncPage = lazy(() => import('@/pages/SyncPage').then((m) => ({ default: m.SyncPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const AuditPage = lazy(() => import('@/pages/AuditPage').then((m) => ({ default: m.AuditPage })));
const UsersPage = lazy(() => import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const DepartmentPage = lazy(() => import('@/pages/DepartmentPage').then((m) => ({ default: m.DepartmentPage })));

function PageFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}

const page = (el: ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>;
const npp = (el: ReactNode) => <RequireDepartment code="npp">{page(el)}</RequireDepartment>;

function HomeRedirect() {
  const { isAdmin, profile, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (isAdmin) return <Navigate to="/overview" replace />;
  const dept = profile?.departments?.code;
  return <Navigate to={dept === 'npp' ? '/dashboard' : dept ? `/departments/${dept}` : '/unauthorized'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="overview" element={page(<OverviewPage />)} />
        <Route path="dashboard" element={npp(<DashboardPage />)} />
        <Route path="sales" element={npp(<SalesPage />)} />
        <Route path="sync" element={npp(<SyncPage />)} />
        <Route path="reports" element={npp(<ReportsPage />)} />
        <Route path="analytics" element={npp(<AnalyticsPage />)} />
        <Route path="departments" element={<Navigate to="/overview" replace />} />
        <Route path="departments/:code" element={page(<DepartmentPage />)} />
        <Route path="audit" element={page(<AuditPage />)} />
        <Route path="users" element={<RequireAdmin>{page(<UsersPage />)}</RequireAdmin>} />
        <Route path="settings" element={page(<SettingsPage />)} />
        <Route path="profile" element={page(<ProfilePage />)} />
        <Route path="unauthorized" element={<UnauthorizedPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
