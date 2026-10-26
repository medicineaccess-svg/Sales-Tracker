import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  CircleAlert,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Logo } from '@/components/ui/logo';
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { useDashboard, useDepartments, useSyncRuns } from '@/hooks/useData';
import { formatDateTime, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DepartmentSelector } from './DepartmentSelector';
import { NAV_ITEMS, PAGE_TITLES } from './nav';

const COLLAPSE_KEY = 'ikris.sidebar.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function Sidebar({
  onNavigate,
  onDepartments,
  collapsed = false,
  onToggleCollapsed,
}: {
  onNavigate?: () => void;
  onDepartments: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const { isAdmin, signOut, profile, departmentCode } = useAuth();
  const { data: departments } = useDepartments();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const dept = departments?.find((d) => d.code === departmentCode);
  const initials = (profile?.full_name || profile?.email || '?')
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  const nudge = reduce ? undefined : { x: 2 };
  const label = (text: string) =>
    collapsed ? <span className="sr-only">{text}</span> : <span className="truncate">{text}</span>;

  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col text-white">
      <div className={cn('flex h-16 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        {collapsed ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-bold text-sidebar shadow-sm">IK</span>
        ) : (
          <Logo variant="light" className="h-9" />
        )}
        {onToggleCollapsed && !collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="h-4.5 w-4.5" />
          </button>
        )}
      </div>
      {onToggleCollapsed && collapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="mx-auto mb-1 rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeftOpen className="h-4.5 w-4.5" />
        </button>
      )}

      <div className="scroll-thin flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-2">
        {NAV_ITEMS.filter((n) => !n.adminOnly || isAdmin).map((item) => {
          const Icon = item.icon;
          const base = cn(
            'group relative flex w-full items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors',
            collapsed ? 'justify-center px-0' : 'px-3',
          );
          if (item.action === 'departments') {
            return (
              <button
                key={item.label}
                type="button"
                title={collapsed ? `Department: ${dept?.name ?? 'Select'}` : undefined}
                onClick={() => {
                  onDepartments();
                  onNavigate?.();
                }}
                className={cn(
                  base,
                  'my-2 border border-white/15 bg-white/[0.07] text-white hover:border-accent/60 hover:bg-white/[0.12]',
                )}
              >
                <motion.span whileHover={nudge} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink">
                  <Icon className="h-4 w-4" aria-hidden />
                </motion.span>
                {collapsed ? (
                  <span className="sr-only">Department: {dept?.name ?? 'Select'}</span>
                ) : (
                  <span className="min-w-0 flex-1 text-left leading-tight">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-white/60">Department</span>
                    <span className="block truncate text-sm font-semibold">{dept?.name ?? 'Select department'}</span>
                  </span>
                )}
                {!collapsed && <ChevronsUpDown className="h-4 w-4 shrink-0 text-white/60 transition-transform group-hover:scale-110" aria-hidden />}
              </button>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to!}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(base, isActive ? 'text-white' : 'text-white/80 hover:bg-white/[0.08] hover:text-white')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId={collapsed ? 'nav-active-c' : 'nav-active'}
                      className="absolute inset-0 rounded-xl bg-sidebar-light shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }}
                    >
                      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-accent" />
                    </motion.span>
                  )}
                  <motion.span className="relative flex shrink-0" whileHover={nudge} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
                    <Icon className={cn('h-4.5 w-4.5', isActive && 'text-accent-100')} aria-hidden />
                  </motion.span>
                  <span className="relative min-w-0">{label(item.label)}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>

      <div className="space-y-1 border-t border-white/10 p-3">
        <button
          type="button"
          onClick={() => {
            navigate('/profile');
            onNavigate?.();
          }}
          title={collapsed ? 'Profile' : undefined}
          className={cn(
            'group flex w-full items-center gap-3 rounded-xl p-2 text-left transition-all duration-200 hover:bg-white/[0.08] hover:shadow-[0_6px_20px_-10px_rgba(0,0,0,0.5)]',
            collapsed && 'justify-center',
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-ink ring-2 ring-white/20 transition-transform duration-200 group-hover:scale-105">
            {initials}
          </span>
          {collapsed ? (
            <span className="sr-only">Profile</span>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{profile?.full_name || profile?.email}</span>
              <span className="block truncate text-[11px] text-white/65">{isAdmin ? 'Administrator' : `${profile?.departments?.name ?? ''} user`}</span>
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => void signOut('manual')}
          title={collapsed ? 'Logout' : undefined}
          className={cn(
            'group flex w-full items-center gap-3 rounded-xl py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white',
            collapsed ? 'justify-center' : 'px-3',
          )}
        >
          <motion.span whileHover={nudge} className="flex">
            <LogOut className="h-4.5 w-4.5" aria-hidden />
          </motion.span>
          {label('Logout')}
        </button>
      </div>
    </nav>
  );
}

function SyncStatus() {
  const { data } = useSyncRuns(5);
  const last = data?.find((r) => r.status !== 'running') ?? null;
  const running = data?.some((r) => r.status === 'running');
  if (running) {
    return (
      <span className="hidden items-center gap-1.5 text-xs text-brand lg:inline-flex">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> Syncing…
      </span>
    );
  }
  if (!last) return null;
  const ok = last.status === 'succeeded';
  return (
    <NavLink
      to="/sync"
      className="hidden items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-xs text-muted hover:border-brand/40 lg:inline-flex"
      title={`Last sync: ${formatDateTime(last.finished_at)} — ${last.status}`}
    >
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-[#8a5410]" aria-hidden />
      )}
      Synced {relativeTime(last.finished_at)}
    </NavLink>
  );
}

function Notifications() {
  const { data: runs } = useSyncRuns(5);
  const { data: dash } = useDashboard({});
  const navigate = useNavigate();
  const items: { id: string; icon: typeof Bell; tone: string; text: string; to: string }[] = [];
  if (dash?.totals.conflicts) {
    items.push({ id: 'conflicts', icon: CircleAlert, tone: 'text-danger', text: `${dash.totals.conflicts} record(s) have sync conflicts`, to: '/sync' });
  }
  if (dash?.totals.needs_review) {
    items.push({ id: 'review', icon: AlertTriangle, tone: 'text-[#8a5410]', text: `${dash.totals.needs_review} record(s) need data review`, to: '/sales?needs_review=true' });
  }
  if (dash?.totals.missing_from_source) {
    items.push({ id: 'missing', icon: AlertTriangle, tone: 'text-[#8a5410]', text: `${dash.totals.missing_from_source} record(s) no longer in the sheet`, to: '/sync' });
  }
  for (const r of runs ?? []) {
    items.push({
      id: r.id,
      icon: r.status === 'succeeded' ? CheckCircle2 : r.status === 'running' ? RefreshCw : AlertTriangle,
      tone: r.status === 'succeeded' ? 'text-success' : r.status === 'running' ? 'text-brand' : 'text-[#8a5410]',
      text: `Sync ${r.status} · ${r.inserted} new, ${r.updated} updated · ${relativeTime(r.started_at)}`,
      to: '/sync',
    });
  }
  const alerts = (dash?.totals.conflicts ?? 0) + (dash?.totals.missing_from_source ?? 0);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-brand-50 hover:text-navy"
          aria-label={`Notifications${alerts ? ` (${alerts} alerts)` : ''}`}
        >
          <Bell className="h-4.5 w-4.5" />
          {alerts > 0 && <span className="absolute right-1.5 top-1.5 flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-card" /></span>}
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-80">
        <DropdownLabel>Notifications</DropdownLabel>
        {items.length === 0 && <p className="px-2.5 py-3 text-sm text-muted">You're all caught up.</p>}
        {items.slice(0, 8).map((n) => (
          <DropdownItem key={n.id} onSelect={() => navigate(n.to)} icon={<n.icon className={cn('h-4 w-4', n.tone)} />}>
            <span className="text-xs leading-snug">{n.text}</span>
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

function ProfileMenu() {
  const { profile, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const initials = (profile?.full_name || profile?.email || '?')
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-brand-50"
          aria-label="Open profile menu"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar text-xs font-semibold text-white">
            {initials}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block max-w-36 truncate text-xs font-semibold text-ink">{profile?.full_name || profile?.email}</span>
            <span className="block text-[11px] text-muted">{isAdmin ? 'Administrator' : `${profile?.departments?.name ?? ''} user`}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
        </button>
      </DropdownTrigger>
      <DropdownContent>
        <DropdownLabel>{profile?.email}</DropdownLabel>
        <DropdownItem icon={<User className="h-4 w-4" />} onSelect={() => navigate('/profile')}>
          Profile
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<LogOut className="h-4 w-4" />} onSelect={() => void signOut('manual')} className="text-danger">
          Log out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { departmentCode } = useAuth();
  const { data: departments } = useDepartments();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable — keep in memory */
      }
      return !c;
    });

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const section = '/' + (location.pathname.split('/')[1] ?? '');
  const title = PAGE_TITLES[section] ?? 'Sales Tracker';
  const dept = departments?.find((d) => d.code === departmentCode);

  useEffect(() => {
    document.title = `${title} · Ikris Sales Tracker`;
  }, [title]);

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/sales?search=${encodeURIComponent(term)}` : '/sales');
  };

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <motion.aside
        className="fixed inset-y-0 left-0 z-30 hidden overflow-hidden bg-sidebar shadow-[4px_0_24px_-12px_rgba(19,58,88,0.45)] lg:block"
        initial={false}
        animate={{ width: collapsed ? 80 : 256 }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 38 }}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} onDepartments={() => setDeptOpen(true)} />
      </motion.aside>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-navy-900/50 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-72 bg-sidebar lg:hidden"
              initial={{ x: reduce ? 0 : -288 }}
              animate={{ x: 0 }}
              exit={{ x: reduce ? 0 : -288 }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            >
              <button
                type="button"
                className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-white/80 hover:bg-white/10"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
              <Sidebar onNavigate={() => setMobileOpen(false)} onDepartments={() => setDeptOpen(true)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className={cn('transition-[padding] duration-300 ease-out motion-reduce:transition-none', collapsed ? 'lg:pl-20' : 'lg:pl-64')}>
        <header className="sticky top-0 z-20 border-b border-line/80 bg-card/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              className="rounded-lg p-2 text-ink hover:bg-brand-50 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="lg:hidden">
              <Logo className="h-7" />
            </div>
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <button
                type="button"
                onClick={() => setDeptOpen(true)}
                className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-700 ring-1 ring-inset ring-accent-100 transition-colors hover:bg-accent-100"
                title="Switch department"
              >
                {dept?.name ?? 'Department'}
              </button>
              <span className="text-line">/</span>
              <h2 className="truncate text-sm font-semibold text-navy">{title}</h2>
            </div>
            <form onSubmit={onSearch} className="ml-auto hidden max-w-sm flex-1 md:block" role="search">
              <label className="relative block">
                <span className="sr-only">Search sales</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search customer, product, voucher…"
                  className="h-9 w-full rounded-xl border border-line bg-canvas/70 pl-9 pr-3 text-sm focus:border-brand focus:bg-card focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
            </form>
            <div className="ml-auto flex items-center gap-1 md:ml-2">
              <SyncStatus />
              <Notifications />
              <ProfileMenu />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <DepartmentSelector open={deptOpen} onOpenChange={setDeptOpen} />
    </div>
  );
}
