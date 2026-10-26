import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, ClipboardList, Globe2, HeartPulse, IndianRupee, Pill, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ChartCard, MonthlyInrBars } from '@/components/dashboard/charts';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { useDashboard, useDepartments, useSalesPage, useSyncRuns } from '@/hooks/useData';
import { fyOf } from '@/lib/filters';
import { friendlyError } from '@/lib/errors';
import { formatDate, formatInrShort, formatMoney, formatNumber, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const ICONS: Record<string, typeof Pill> = { npp: Pill, export: Globe2, rare_disease: HeartPulse };

export function OverviewPage() {
  const { profile, isAdmin, setDepartmentCode } = useAuth();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const fy = fyOf(new Date());
  const { data, isLoading, isError, error, refetch } = useDashboard({ fy });
  const { data: all } = useDashboard({});
  const recent = useSalesPage({ filters: {}, sort: 'sale_date', ascending: false, page: 0, pageSize: 6 });
  const runs = useSyncRuns(5);
  const { data: depts } = useDepartments();
  const lastRun = runs.data?.find((r) => r.status !== 'running');
  const name = profile?.full_name?.split(' ')[0] ?? profile?.email?.split('@')[0];

  return (
    <div>
      <PageHeader
        title={`Welcome back${name ? `, ${name}` : ''}`}
        description={`${isAdmin ? 'Administrator overview across departments.' : `${profile?.departments?.name ?? ''} workspace.`} Figures below are for ${fy} (1 Apr – 31 Mar).`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/dashboard')}>
              Open dashboard <ArrowRight className="h-4 w-4" />
            </Button>
            <Button onClick={() => navigate('/sales')}>
              <Plus className="h-4 w-4" /> Add Sales
            </Button>
          </>
        }
      />

      {isError && !data ? (
        <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard index={0} loading={isLoading} icon={IndianRupee} highlight label={`INR value · ${fy}`} numeric={data ? Number(data.totals.inr_value) : null} format={formatInrShort} sub="Source-reported INR Value" />
          <KpiCard index={1} loading={isLoading} icon={ClipboardList} label={`Sales records · ${fy}`} numeric={data ? Number(data.totals.records) : null} format={(v) => formatNumber(Math.round(v))} sub={`${formatNumber(all?.totals.records)} records in total`} />
          <KpiCard
            index={2}
            loading={isLoading}
            icon={Pill}
            label="Sales value"
            value={
              <span className="text-lg leading-snug">
                {(data?.by_currency ?? [])
                  .filter((c) => c.currency !== 'UNSPECIFIED')
                  .map((c) => formatMoney(c.value, c.currency, { compact: true }))
                  .join(' · ') || '—'}
              </span>
            }
            sub="Per currency, never combined"
          />
          <KpiCard
            index={3}
            loading={runs.isLoading}
            icon={RefreshCw}
            label="Last Google Sheets sync"
            value={lastRun ? relativeTime(lastRun.finished_at) : 'Never'}
            sub={lastRun ? `${lastRun.status} · ${lastRun.inserted} new · ${lastRun.updated} updated` : 'Run an import from the Sync page'}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title={`Monthly INR sales · ${fy}`}
          description="Source-reported INR Value"
          loading={isLoading}
          empty={!!data && !data.monthly.length}
        >
          {data && <MonthlyInrBars monthly={data.monthly} />}
        </ChartCard>

        <Card>
          <CardHeader title="Departments" description="Switch workspace from the Department menu" />
          <div className="space-y-3 p-5">
            {(depts ?? []).map((d, i) => {
              const Icon = ICONS[d.code] ?? Pill;
              const active = d.status === 'active';
              const allowed = isAdmin || profile?.departments?.code === d.code;
              return (
                <motion.button
                  key={d.id}
                  type="button"
                  disabled={!allowed}
                  onClick={() => {
                    setDepartmentCode(d.code);
                    navigate(active ? '/dashboard' : `/departments/${d.code}`);
                  }}
                  initial={reduce ? false : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={allowed && !reduce ? { x: 3 } : undefined}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                    active ? 'border-brand/25 hover:border-accent/50 hover:bg-accent-50' : 'border-line',
                    !allowed && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', active ? 'bg-sidebar text-white' : 'bg-surface text-muted')}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-navy">{d.name}</span>
                    <span className="block text-xs text-muted">{d.description}</span>
                  </span>
                  {active ? <Badge tone="success">Active</Badge> : <Badge>Coming soon</Badge>}
                </motion.button>
              );
            })}
            {!depts && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Latest sales"
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('/sales')}>
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <div className="scroll-thin mt-3 overflow-x-auto">
          <table className="data-table w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-line bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 font-medium">Product</th>
                <th className="px-5 py-2.5 font-medium">Hospital</th>
                <th className="px-5 py-2.5 font-medium">Manager</th>
                <th className="px-5 py-2.5 text-right font-medium">Value</th>
                <th className="px-5 py-2.5 text-right font-medium">INR value</th>
              </tr>
            </thead>
            <tbody>
              {recent.isLoading &&
                [0, 1, 2, 3].map((i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-5 py-2">
                      <Skeleton className="h-5" />
                    </td>
                  </tr>
                ))}
              {recent.data?.rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="whitespace-nowrap px-5 py-2.5">{formatDate(r.sale_date)}</td>
                  <td className="px-5 py-2.5">{r.product_name}</td>
                  <td className="px-5 py-2.5 text-muted">{r.hospital_name ?? '—'}</td>
                  <td className="px-5 py-2.5 text-muted">{r.manager ?? '—'}</td>
                  <td className="tabular whitespace-nowrap px-5 py-2.5 text-right">{formatMoney(r.value, r.currency ?? 'UNSPECIFIED')}</td>
                  <td className="tabular whitespace-nowrap px-5 py-2.5 text-right">{formatMoney(r.inr_value, 'INR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
