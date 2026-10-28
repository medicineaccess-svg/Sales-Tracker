import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info } from 'lucide-react';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { ChartCard } from '@/components/dashboard/charts';
import {
  ExportMenu,
  filterPreamble,
  fmtInr,
  fmtInrShort,
  fmtPct,
  GrowthText,
  LastRefresh,
  monthLabel,
  PerfFilterBar,
  PerfNav,
  StatTile,
  StatusBadge,
  usePerfModel,
  usePerfParams,
  type PerfModel,
  type PerfParams,
} from '@/components/performance/PerfUi';
import { ContributionChart, CumulativeChart, TargetVsActualChart } from '@/components/performance/perfCharts';
import { buildMonthRows } from '@/components/performance/series';
import { headlineScope, managerScorecards, zoneScorecards, type ManagerCard } from '@/components/performance/scorecards';
import { useAuth } from '@/auth/AuthProvider';
import { friendlyError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { consolidateBranch, fyLabel, projectFy, rankScorecards, scorecard, STATUS_LABEL, zoneBucket, type BranchRule } from '@/lib/performance';

export function TargetFilterWarning({ params }: { params: PerfParams }) {
  if (!params.product && !params.channel && !params.place && !params.date_from && !params.date_to) return null;
  return (
    <div role="note" className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-[#6b3f0a]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      Targets are set per month for a manager, zone or the company — not per product, channel, place or date range. With these
      filters, achievement compares the filtered sales with the full monthly target.
    </div>
  );
}

export function NoTargetsNote({ model }: { model: PerfModel }) {
  const { isAdmin } = useAuth();
  if (model.data.targets.length > 0) return null;
  return (
    <div role="note" className="mb-4 flex items-start gap-2 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm text-navy">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        No monthly targets have been entered yet, so achievement, remaining and status show <strong>Target Not Set</strong>. Sales
        figures come straight from the sheet.{' '}
        {isAdmin ? (
          <Link className="font-semibold underline" to="/performance/targets">
            Enter targets
          </Link>
        ) : (
          'Ask an administrator to enter monthly targets.'
        )}
      </span>
    </div>
  );
}

export const MANAGER_COLUMNS: ExportColumn<ManagerCard>[] = [
  { header: 'Manager', value: (r) => r.label, width: 22 },
  { header: 'Zone', value: (r) => r.zone ?? '' },
  { header: 'Month', value: (r) => monthLabel(r.month, true) },
  { header: 'Actual (INR)', value: (r) => r.actual, numFmt: '#,##0.00' },
  { header: 'Target (INR)', value: (r) => r.target, numFmt: '#,##0.00' },
  { header: 'Achievement %', value: (r) => (r.achievement === null ? null : Number(r.achievement.toFixed(2))) },
  { header: 'Remaining (INR)', value: (r) => r.remaining, numFmt: '#,##0.00' },
  { header: 'Variance (INR)', value: (r) => r.variance, numFmt: '#,##0.00' },
  { header: 'Growth % vs previous month', value: (r) => (r.growth === null ? null : Number(r.growth.toFixed(2))) },
  { header: 'Status', value: (r) => STATUS_LABEL[r.status], width: 20 },
  { header: 'FY to date actual (INR)', value: (r) => r.ytdActual, numFmt: '#,##0.00' },
  { header: 'FY to date target (INR)', value: (r) => r.ytdTarget, numFmt: '#,##0.00' },
  { header: 'FY to date achievement %', value: (r) => (r.ytdAchievement === null ? null : Number(r.ytdAchievement.toFixed(2))) },
];

export function BranchCard({ model, rule }: { model: PerfModel; rule: BranchRule }) {
  const monthFacts = model.allFacts.filter((f) => f.month === model.month);
  const ytdFacts = model.allFacts.filter((f) => model.months.includes(f.month) && f.month <= model.month);
  const m = consolidateBranch(monthFacts, rule, model.data.managers);
  const y = consolidateBranch(ytdFacts, rule, model.data.managers);
  const warnings = [...new Set([...m.warnings, ...y.warnings])];
  const row = (label: string, a: number, b: number, strong?: boolean) => (
    <tr key={label} className={strong ? 'border-t border-line font-semibold text-navy' : ''}>
      <td className="py-1.5 pr-3">{label}</td>
      <td className="tabular py-1.5 text-right">{fmtInr(a)}</td>
      <td className="tabular py-1.5 pl-3 text-right">{fmtInr(b)}</td>
    </tr>
  );
  return (
    <Card>
      <CardHeader
        title={`Consolidated ${rule.name}`}
        description={rule.description ?? `${rule.name} = HO sales + individual managers' sales at ${rule.places.join(' / ')}`}
      />
      <CardBody>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-1 font-medium">Component</th>
              <th className="pb-1 text-right font-medium">{monthLabel(model.month, true)}</th>
              <th className="pb-1 pl-3 text-right font-medium">{fyLabel(model.fy)} to date</th>
            </tr>
          </thead>
          <tbody>
            {row(`HO ${rule.name} only`, m.hoOnly.actual, y.hoOnly.actual)}
            {y.byManager.map((bm) =>
              row(`${bm.label} (manager)`, m.byManager.find((x) => x.manager_key === bm.manager_key)?.totals.actual ?? 0, bm.totals.actual),
            )}
            {row('Individual managers subtotal', m.managersOnly.actual, y.managersOnly.actual)}
            {row(`Consolidated ${rule.name}`, m.consolidated.actual, y.consolidated.actual, true)}
            {y.excluded.records > 0 && row('Not included (e.g. third party)', m.excluded.actual, y.excluded.actual)}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Each sheet row is counted once. {y.consolidated.records} record(s) this FY to date.
        </p>
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-[#6b3f0a]">
            {warnings.map((w) => (
              <li key={w} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {w}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function PerformancePage() {
  const { params, update, reset } = usePerfParams();
  const { model, isLoading, error, refetch, isFetching } = usePerfModel(params);

  const derived = useMemo(() => {
    if (!model) return null;
    const scope = headlineScope(model, params);
    const head = scorecard({ key: 'scope', label: scope.label, facts: model.facts, pred: scope.pred, target: scope.target, month: model.month, today: model.today });
    const rows = buildMonthRows(model.facts, model.months, scope.pred, scope.target, model.month);
    const managers = managerScorecards(model, params);
    const zones = zoneScorecards(model, params);
    const rankedMgr = rankScorecards(managers);
    const rankedZone = rankScorecards(zones.filter((z) => z.key !== 'HO (Third Party)' && z.key !== 'Zone not assigned'));
    const withTarget = managers.filter((m) => m.target !== null);
    const below = withTarget.filter((m) => m.status === 'behind' || m.status === 'no_sales');
    const achieved = withTarget.filter((m) => m.status === 'achieved' || m.status === 'exceeded');
    const bySales = [...managers].sort((a, b) => b.actual - a.actual);
    const zoneTotals = new Map<string, number>();
    for (const f of model.facts) if (model.months.includes(f.month) && f.month <= model.month) zoneTotals.set(zoneBucket(f), (zoneTotals.get(zoneBucket(f)) ?? 0) + Number(f.inr ?? 0));
    const projection = projectFy(rows.map((r) => ({ month: r.month, actual: r.actual })), model.today);
    return { head, rows, managers, rankedMgr, rankedZone, below, achieved, bySales, zoneTotals, projection, scope };
  }, [model, params]);

  const rules = model?.data.settings['reporting.consolidation']?.branches ?? [];

  return (
    <div>
      <PageHeader
        title="Performance"
        description="Monthly sales against targets for managers, zones and the company."
        actions={
          model && derived ? (
            <ExportMenu
              name="manager-performance"
              rows={derived.managers}
              columns={MANAGER_COLUMNS}
              preamble={filterPreamble(model, params, 'Manager performance')}
            />
          ) : null
        }
      />
      <PerfNav />
      <PerfFilterBar params={params} update={update} reset={reset} model={model} />
      {error && !model ? (
        <Card>
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !model || !derived ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-4">
            <LastRefresh model={model} isFetching={isFetching} onRefresh={() => refetch()} />
          </div>
          <NoTargetsNote model={model} />
          <TargetFilterWarning params={params} />

          <h2 className="mb-2 text-sm font-semibold text-navy">
            {derived.scope.label} · {monthLabel(model.month, true)} <StatusBadge status={derived.head.status} />
          </h2>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <StatTile label="Month sales" value={fmtInrShort(derived.head.actual)} sub={`${derived.head.records} record(s)`} title={fmtInr(derived.head.actual)} />
            <StatTile label={`${fyLabel(model.fy)} sales to date`} value={fmtInrShort(derived.head.ytdActual)} title={fmtInr(derived.head.ytdActual)} />
            <StatTile
              label="Month target"
              value={derived.head.target === null ? 'Not set' : fmtInrShort(derived.head.target)}
              sub={derived.head.targetSource === 'sum_of_managers' ? 'Sum of manager targets' : derived.head.targetSource === 'sum_of_zones' ? 'Sum of zone targets' : undefined}
            />
            <StatTile
              label="Achievement"
              value={fmtPct(derived.head.achievement)}
              tone={derived.head.achievement === null ? undefined : derived.head.achievement >= 100 ? 'good' : 'bad'}
              sub={derived.head.expectedToDate !== null && derived.head.expectedToDate !== derived.head.target ? `Expected by today ${fmtInrShort(derived.head.expectedToDate)}` : undefined}
            />
            <StatTile label="Remaining to target" value={derived.head.remaining === null ? '—' : fmtInrShort(derived.head.remaining)} />
            <StatTile label="Month-on-month" value={derived.head.growth === null ? '—' : fmtPct(derived.head.growth)} sub={<GrowthText value={derived.head.growth} />} />
            <StatTile
              label={`${fyLabel(model.fy)} target`}
              value={derived.head.fyTarget === null ? 'Not set' : fmtInrShort(derived.head.fyTarget)}
              sub={derived.head.fyTarget === null ? undefined : `${derived.head.fyMonthsWithTarget} of 12 months entered`}
            />
            <StatTile
              label="FY to date achievement"
              value={fmtPct(derived.head.ytdAchievement)}
              sub={derived.head.ytdTarget === null ? 'No targets yet' : `vs ${fmtInrShort(derived.head.ytdTarget)} target to date`}
            />
            <StatTile
              label="Best manager"
              value={derived.rankedMgr[0]?.rank ? derived.rankedMgr[0].item.label : derived.bySales[0]?.actual ? derived.bySales[0].label : '—'}
              sub={
                derived.rankedMgr[0]?.rank
                  ? `${fmtPct(derived.rankedMgr[0].item.achievement)} of target`
                  : derived.bySales[0]?.actual
                    ? `Highest sales ${fmtInrShort(derived.bySales[0].actual)} (no targets to rank by)`
                    : undefined
              }
            />
            <StatTile
              label="Best zone"
              value={
                derived.rankedZone[0]?.rank
                  ? derived.rankedZone[0].item.label
                  : [...derived.zoneTotals.entries()].filter(([k]) => model.zones.includes(k)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
              }
              sub={derived.rankedZone[0]?.rank ? `${fmtPct(derived.rankedZone[0].item.achievement)} of target` : 'By FY-to-date sales (no zone targets)'}
            />
            <StatTile label="Managers below target" value={derived.below.length} sub={`of ${derived.managers.filter((m) => m.target !== null).length} with a target`} tone={derived.below.length ? 'bad' : undefined} />
            <StatTile label="Achieved or exceeded" value={derived.achieved.length} sub={`${derived.managers.filter((m) => m.target === null).length} manager(s) without a target`} tone={derived.achieved.length ? 'good' : undefined} />
          </div>

          <div className="mb-6 grid gap-4 xl:grid-cols-3">
            <ChartCard
              className="xl:col-span-2"
              title={`Target vs actual — ${fyLabel(model.fy)}`}
              description={`${derived.scope.label}. Bars are actual sales, the dashed line is the monthly target.`}
              table={{
                columns: ['Month', 'Actual', 'Target', 'Achievement'],
                rows: derived.rows.map((r) => [r.label, fmtInr(r.actual), r.target === null ? 'Not set' : fmtInr(r.target), fmtPct(r.achievement)]),
              }}
            >
              <TargetVsActualChart data={derived.rows} />
            </ChartCard>
            <ChartCard
              title="Zone contribution"
              description={`${fyLabel(model.fy)} to ${monthLabel(model.month, true)}. HO zone sales are included in their zone.`}
              table={{ columns: ['Zone', 'INR'], rows: [...derived.zoneTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, fmtInr(v)]) }}
            >
              <ContributionChart slices={[...derived.zoneTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))} />
            </ChartCard>
          </div>

          <div className="mb-6 grid gap-4 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader
                title={`Managers — ${monthLabel(model.month, true)}`}
                description="Individual sales managers only. HO and HO (Third Party) are company channels and are not ranked."
              />
              <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
                <table className="data-table w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="px-2 py-2 font-medium">Manager</th>
                      <th className="px-2 py-2 font-medium">Zone</th>
                      <th className="px-2 py-2 text-right font-medium">Actual</th>
                      <th className="px-2 py-2 text-right font-medium">Target</th>
                      <th className="px-2 py-2 text-right font-medium">Achievement</th>
                      <th className="px-2 py-2 text-right font-medium">Remaining</th>
                      <th className="px-2 py-2 text-right font-medium">Growth</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {derived.bySales.map((m) => (
                      <tr key={m.key} className="border-b border-line/60">
                        <td className="px-2 py-2">
                          <Link className="font-medium text-brand hover:underline" to={`/performance/managers/${encodeURIComponent(m.key)}?${new URLSearchParams({ fy: String(model.fy), month: model.month })}`}>
                            {m.label}
                          </Link>
                          {!m.inMaster && <span className="ml-1 text-xs text-muted">(not in master data)</span>}
                        </td>
                        <td className="px-2 py-2 text-muted">{m.zone ?? '—'}</td>
                        <td className="tabular px-2 py-2 text-right">{fmtInr(m.actual)}</td>
                        <td className="tabular px-2 py-2 text-right">{m.target === null ? 'Not set' : fmtInr(m.target)}</td>
                        <td className="tabular px-2 py-2 text-right">{fmtPct(m.achievement)}</td>
                        <td className="tabular px-2 py-2 text-right">{m.remaining === null ? '—' : fmtInr(m.remaining)}</td>
                        <td className="tabular px-2 py-2 text-right">{m.growth === null ? '—' : `${m.growth >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(m.growth))}`}</td>
                        <td className="px-2 py-2">
                          <StatusBadge status={m.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <ChartCard
              title="Cumulative actual vs target"
              description={derived.projection !== null ? `Run-rate projection for the FY: ${fmtInrShort(derived.projection)} (estimate, not actual sales).` : undefined}
            >
              <CumulativeChart data={derived.rows} />
            </ChartCard>
          </div>

          {rules.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {rules.map((r) => (
                <BranchCard key={r.name} model={model} rule={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
