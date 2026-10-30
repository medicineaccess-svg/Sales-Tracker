import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Building, CalendarRange, ClipboardList, Download, FileSpreadsheet, IndianRupee, MapPin, Package, Pill, RefreshCw, Search, Stethoscope, Users } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ManagerCards } from '@/components/performance/hierPanels';
import { useHierModel } from '@/components/performance/hierUi';
import { fyRange } from '@/lib/filters';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import {
  BreakdownBars,
  ChartCard,
  ContributionDonut,
  MetricSwitch,
  MonthlyInrBars,
  TrendLine,
  breakdownTable,
  useMonthlyInr,
  type BreakdownMetric,
} from '@/components/dashboard/charts';
import { ErrorState, StaleBanner } from '@/components/ui/feedback';
import { useDashboard, useReport, useSyncRuns } from '@/hooks/useData';
import { exportDashboard } from '@/lib/dashboardExport';
import { stamp } from '@/lib/export';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/hooks/useFilters';
import { describeFilters, toRpcFilters, type SalesFilters } from '@/lib/filters';
import { friendlyError, notify } from '@/lib/errors';
import { formatDate, formatDateTime, formatInrShort, formatMoney, formatMonth, formatNumber, relativeTime } from '@/lib/format';

const BREAKDOWN_OPTIONS: { value: BreakdownMetric; label: string }[] = [
  { value: 'inr_value', label: 'INR' },
  { value: 'records', label: 'Records' },
];

function dateRangeLabel(filters: SalesFilters): string {
  const r = toRpcFilters(filters);
  if (filters.month) return formatMonth(filters.month);
  if (filters.fy) return `${filters.fy} (1 Apr – 31 Mar)`;
  if (r.date_from || r.date_to) {
    return `${r.date_from ? formatDate(String(r.date_from)) : 'Start'} – ${r.date_to ? formatDate(String(r.date_to)) : 'Latest'}`;
  }
  return 'All dates';
}

/** Searchable list of every hospital in the current filter (not only the top 10 shown in the chart). */
function HospitalDetails({ filters }: { filters: SalesFilters }) {
  const [q, setQ] = useState('');
  const { data, isLoading, isError, error, refetch } = useReport('hospital', filters);
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; records: number; inr: number }>();
    for (const r of data ?? []) {
      const cur = map.get(r.group_key) ?? { key: r.group_key, records: 0, inr: 0 };
      cur.records += Number(r.records);
      cur.inr += Number(r.inr_value);
      map.set(r.group_key, cur);
    }
    return [...map.values()].sort((a, b) => b.inr - a.inr);
  }, [data]);
  const term = q.trim().toLowerCase();
  const visible = term ? rows.filter((r) => r.key.toLowerCase().includes(term)) : rows;

  return (
    <div className="mt-3 border-t border-line/70 pt-3">
      <label className="relative block">
        <span className="sr-only">Search hospitals</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${rows.length || ''} hospitals…`} className="h-9 pl-9" />
      </label>
      {isError ? (
        <p className="mt-3 text-xs text-danger">
          {friendlyError(error)}{' '}
          <button type="button" className="font-semibold underline" onClick={() => refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <div className="scroll-thin mt-2 max-h-56 overflow-auto rounded-xl border border-line/70">
          <table className="data-table w-full text-xs">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="text-left text-muted">
                <th className="px-3 py-2 font-medium">Hospital</th>
                <th className="px-3 py-2 text-right font-medium">Records</th>
                <th className="px-3 py-2 text-right font-medium">INR Value</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                [0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td colSpan={3} className="px-3 py-2">
                      <div className="h-4 animate-pulse rounded bg-line/70" />
                    </td>
                  </tr>
                ))}
              {!isLoading && !visible.length && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-muted">
                    {term ? 'No hospital matches your search.' : 'No hospitals in this view.'}
                  </td>
                </tr>
              )}
              {visible.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-1.5">
                    <Link to={`/sales?hospital=${encodeURIComponent(r.key)}`} className="font-medium text-navy hover:text-accent-700 hover:underline">
                      {r.key}
                    </Link>
                  </td>
                  <td className="tabular px-3 py-1.5 text-right">{formatNumber(r.records)}</td>
                  <td className="tabular px-3 py-1.5 text-right">{formatMoney(r.inr, 'INR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { filters, update, reset } = useFilters();
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboard(filters, 10);
  const [productMetric, setProductMetric] = useState<BreakdownMetric>('inr_value');
  const [managerMetric, setManagerMetric] = useState<BreakdownMetric>('inr_value');
  const [hospitalMetric, setHospitalMetric] = useState<BreakdownMetric>('inr_value');
  const [trendMetric, setTrendMetric] = useState<'inr' | 'records'>('inr');
  const [contribBy, setContribBy] = useState<'product' | 'manager'>('product');
  const [contribMetric, setContribMetric] = useState<'inr_value' | 'records'>('inr_value');
  const inrMonthly = useMonthlyInr(data?.monthly);
  // Manager cards follow the dashboard's FY / month filter
  const hierParams = {
    fy: filters.fy ? Number(fyRange(filters.fy)?.from.slice(0, 4)) || undefined : undefined,
    month: filters.month ? `${filters.month}-01` : undefined,
  };
  const hier = useHierModel(hierParams);
  const { profile, departmentCode } = useAuth();
  const runs = useSyncRuns(5);
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const lastRun = runs.data?.find((r) => r.status !== 'running');
  const firstName = profile?.full_name?.split(' ')[0] ?? profile?.email?.split('@')[0];

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['npp', 'report'] }),
        queryClient.invalidateQueries({ queryKey: ['npp', 'filter-options'] }),
        runs.refetch(),
      ]);
      const res = await refetch();
      if (res.isError) throw res.error;
      notify.success('Dashboard refreshed');
    } catch (e) {
      notify.error(friendlyError(e, 'Could not refresh the dashboard.'));
    } finally {
      setRefreshing(false);
    }
  };

  const onExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await exportDashboard(data, `npp-dashboard-${stamp()}.xlsx`, [
        'Ikris Pharma Network — NPP Sales Dashboard report',
        `Generated ${new Date().toLocaleString('en-IN')}`,
        `Filters: ${describeFilters(filters).join(' · ')}`,
        'INR Value is the figure in the sheet (no conversion applied).',
      ]);
      void supabase.rpc('log_client_event', {
        p_action: 'report.export',
        p_department_code: 'npp',
        p_metadata: { report: 'dashboard', format: 'xlsx', filter_keys: Object.keys(filters) },
      });
      notify.success('Dashboard report exported');
    } catch (e) {
      notify.error(friendlyError(e, 'Export failed.'));
    } finally {
      setExporting(false);
    }
  };

  const t = data?.totals;
  const loading = isLoading && !data;
  const empty = !!data && t?.records === 0;

  return (
    <div>
      <motion.section
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative mb-6 overflow-hidden rounded-3xl bg-sidebar px-5 py-6 text-white shadow-lift sm:px-7"
      >
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-sidebar-light/70 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-accent/25 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-sm text-white/75">Welcome back{firstName ? `, ${firstName}` : ''}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">NPP Sales Dashboard</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-semibold text-accent-ink">
                <Pill className="h-3.5 w-3.5" aria-hidden /> {departmentCode === 'npp' || !departmentCode ? 'Named Patient Program' : 'NPP'}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 ring-1 ring-inset ring-white/15">
                <CalendarRange className="h-3.5 w-3.5" aria-hidden /> {dateRangeLabel(filters)}
              </span>
              <Link
                to="/sync"
                className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/20"
                title={lastRun ? `Last sync ${formatDateTime(lastRun.finished_at)} — ${lastRun.status}` : 'No sync has run yet'}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                {runs.isLoading ? 'Checking sync…' : lastRun ? `Sheets synced ${relativeTime(lastRun.finished_at)}` : 'Never synced'}
              </Link>
              {isFetching && !loading && (
                <span className="inline-flex items-center gap-1 text-white/80" role="status">
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden /> Updating…
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={onRefresh}
              loading={refreshing}
              className="border-white/25 bg-white/10 text-white hover:border-white/40 hover:bg-white/20"
            >
              {!refreshing && <RefreshCw className="h-4 w-4" aria-hidden />} Refresh
            </Button>
            <Button onClick={onExport} loading={exporting} disabled={!data || empty}>
              {!exporting && <Download className="h-4 w-4" aria-hidden />} Export report
            </Button>
          </div>
        </div>
        <p className="relative mt-4 max-w-3xl text-xs text-white/70">
          Figures come only from the sheet’s columns. INR Value is the figure reported in the sheet and is never recalculated.
        </p>
      </motion.section>
      <FilterBar filters={filters} onChange={update} onReset={reset} fields={['fy', 'month', 'dates', 'product', 'manager', 'hospital', 'doctor', 'place']} />

      {isError && data && <StaleBanner message={friendlyError(error)} onRetry={() => refetch()} />}
      {isError && !data ? (
        <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
      ) : (
        <>
          {!!t?.needs_review && (
            <Link
              to="/sales?needs_review=true"
              className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-[#6b3f0a] hover:bg-amber-100"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {t.needs_review} record(s) in this view have data-quality flags from the sheet (e.g. missing date or quantity). Review them →
            </Link>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              index={0}
              loading={loading}
              icon={IndianRupee}
              label="Total INR value"
              highlight
              numeric={t ? Number(t.inr_value) : null}
              format={formatInrShort}
              sub={`${formatMoney(t?.inr_value, 'INR')} · sheet INR Value`}
            />
            <KpiCard
              index={1}
              loading={loading}
              icon={ClipboardList}
              label="Sales records"
              numeric={t ? Number(t.records) : null}
              format={(v) => formatNumber(Math.round(v))}
              sub={t?.undated ? `${t.undated} without a date in the sheet` : t?.first_date ? `${t.first_date} → ${t.last_date}` : undefined}
            />
            <KpiCard
              index={2}
              loading={loading}
              icon={Package}
              label="Quantity sold"
              value={
                data?.quantity_by_unit.length ? (
                  <span className="text-lg leading-snug">
                    {data.quantity_by_unit.slice(0, 3).map((q) => `${formatNumber(q.quantity)} ${q.unit}`).join(' · ')}
                  </span>
                ) : (
                  '—'
                )
              }
              sub="Summed per unit — packs, vials and pens are not added together"
            />
            <KpiCard index={3} loading={loading} icon={Pill} label="Products" numeric={t ? Number(t.products) : null} format={(v) => formatNumber(Math.round(v))} sub="Distinct product names" />
            <KpiCard index={4} loading={!hier.model} icon={Users} label="Managers with sales" numeric={hier.model ? hier.model.tree.managers.length : null} format={(v) => formatNumber(Math.round(v))} sub={hier.model?.tree.managers[0] ? `Top: ${hier.model.tree.managers[0].label}` : undefined} />
            <KpiCard index={5} loading={!hier.model} icon={MapPin} label="Zones" numeric={hier.model ? new Set(hier.model.tree.managers.flatMap((m) => m.zones)).size : null} format={(v) => formatNumber(Math.round(v))} sub="From the sheet’s Zone column" />
            <KpiCard index={6} loading={loading} icon={Building} label="Unique hospitals" numeric={t ? Number(t.hospitals) : null} format={(v) => formatNumber(Math.round(v))} sub="Distinct hospital names" />
            <KpiCard index={7} loading={loading} icon={Stethoscope} label="Unique doctors" numeric={t ? Number(t.doctors) : null} format={(v) => formatNumber(Math.round(v))} sub="Distinct names (spelling variants count separately)" />
          </div>

          <section className="mt-6" aria-labelledby="mgr-perf">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <h2 id="mgr-perf" className="text-sm font-semibold text-navy">
                Manager performance{hierParams.month ? ` · ${formatMonth(hierParams.month.slice(0, 7))}` : hier.model ? ` · FY ${hier.model.fy}-${String((hier.model.fy + 1) % 100).padStart(2, '0')}` : ''}
              </h2>
              <Link to="/performance/drill" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                Open drill-down <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </div>
            {hier.model ? (
              <ManagerCards
                tree={hier.model.tree}
                fyTree={hier.model.fyTree}
                months={hier.model.months}
                upTo={hier.model.upTo}
                hrefFor={(k) => `/performance/drill?${new URLSearchParams({ m: k, fy: String(hier.model!.fy), ...(hierParams.month ? { month: hierParams.month } : {}) })}`}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-40 animate-pulse rounded-2xl bg-line/60" />
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-muted">Each card is the manager’s individual achievement: own sales + HO sales named for them in the Zone column (e.g. “HO North Zone (Firoz)”). Click a card to drill down.</p>
          </section>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <ChartCard
              className="xl:col-span-2"
              title="Monthly INR sales"
              description="Sheet INR Value per month"
              loading={loading}
              empty={empty || !inrMonthly.length}
              table={{
                columns: ['Month', 'INR Value', 'Records'],
                rows: inrMonthly.map((m) => [formatMonth(m.month), formatMoney(m.inr, 'INR'), m.records]),
              }}
            >
              {data && <MonthlyInrBars monthly={data.monthly} />}
            </ChartCard>

            <ChartCard
              title="Product-wise sales"
              description={`Top 10 products`}
              loading={loading}
              empty={empty}
              height={340}
              actions={<MetricSwitch label="Metric" value={productMetric} onChange={setProductMetric} options={BREAKDOWN_OPTIONS} />}
              table={data ? breakdownTable(data.by_product, productMetric, 'Product') : undefined}
            >
              {data && <BreakdownBars rows={data.by_product} metric={productMetric} />}
            </ChartCard>
            <ChartCard
              title="Sales by manager"
              description="Ikris Manager Involved"
              loading={loading}
              empty={empty}
              height={340}
              actions={<MetricSwitch label="Metric" value={managerMetric} onChange={setManagerMetric} options={BREAKDOWN_OPTIONS} />}
              table={data ? breakdownTable(data.by_manager, managerMetric, 'Manager') : undefined}
            >
              {data && <BreakdownBars rows={data.by_manager} metric={managerMetric} color="#ef8557" />}
            </ChartCard>

            <ChartCard
              title="Hospital-wise sales"
              description="Top 10 hospitals · search all hospitals below"
              footer={<HospitalDetails filters={filters} />}
              loading={loading}
              empty={empty}
              height={340}
              actions={<MetricSwitch label="Metric" value={hospitalMetric} onChange={setHospitalMetric} options={BREAKDOWN_OPTIONS} />}
              table={data ? breakdownTable(data.by_hospital, hospitalMetric, 'Hospital') : undefined}
            >
              {data && <BreakdownBars rows={data.by_hospital} metric={hospitalMetric} color="#1f9e86" />}
            </ChartCard>
            <ChartCard
              title="Sales trend"
              description={trendMetric === 'inr' ? 'INR Value over time' : 'Number of sales records over time'}
              loading={loading}
              empty={empty || !inrMonthly.length}
              actions={
                <MetricSwitch
                  label="Trend metric"
                  value={trendMetric}
                  onChange={setTrendMetric}
                  options={[
                    { value: 'inr', label: 'INR' },
                    { value: 'records', label: 'Records' },
                  ]}
                />
              }
            >
              {data && <TrendLine monthly={data.monthly} metric={trendMetric} />}
            </ChartCard>

            <ChartCard
              title="Sales contribution"
              description={`Share of ${contribMetric === 'inr_value' ? 'INR Value' : 'records'} by ${contribBy} (top 7 + other)`}
              loading={loading}
              empty={empty}
              height={300}
              actions={
                <>
                  <MetricSwitch
                    label="Group by"
                    value={contribBy}
                    onChange={setContribBy}
                    options={[
                      { value: 'product', label: 'Product' },
                      { value: 'manager', label: 'Manager' },
                    ]}
                  />
                  <MetricSwitch
                    label="Contribution metric"
                    value={contribMetric}
                    onChange={setContribMetric}
                    options={[
                      { value: 'inr_value', label: 'INR' },
                      { value: 'records', label: 'Records' },
                    ]}
                  />
                </>
              }
              table={data ? breakdownTable(contribBy === 'product' ? data.by_product : data.by_manager, contribMetric, contribBy === 'product' ? 'Product' : 'Manager') : undefined}
            >
              {data && <ContributionDonut rows={contribBy === 'product' ? data.by_product : data.by_manager} metric={contribMetric} />}
            </ChartCard>
          </div>

          <p className="mt-6 text-xs text-muted">Applied filters: {describeFilters(filters).join(' · ')}.</p>
        </>
      )}
    </div>
  );
}
