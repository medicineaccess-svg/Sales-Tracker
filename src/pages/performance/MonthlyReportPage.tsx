import { useMemo } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import {
  ExportMenu,
  filterPreamble,
  fmtInr,
  fmtPct,
  LastRefresh,
  monthLabel,
  PerfFilterBar,
  PerfNav,
  usePerfModel,
  usePerfParams,
} from '@/components/performance/PerfUi';
import { buildMonthRows, type MonthRow } from '@/components/performance/series';
import { headlineScope } from '@/components/performance/scorecards';
import { NoTargetsNote, TargetFilterWarning } from './PerformancePage';
import { friendlyError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import {
  fyLabel,
  fyMonths,
  inZone,
  isManager,
  monthlySeries,
  NO_ZONE,
  projectFy,
  projectMonth,
  salesManagers,
  THIRD_PARTY,
  zoneBucket,
  type PerfFact,
} from '@/lib/performance';
import { cn } from '@/lib/utils';

interface ReportRow extends MonthRow {
  prevFyActual: number | null;
  vsPrevFy: number | null;
  projected: number | null;
}

const COLUMNS: ExportColumn<ReportRow>[] = [
  { header: 'Month', value: (r) => r.label },
  { header: 'Target (INR)', value: (r) => r.target, numFmt: '#,##0.00' },
  { header: 'Actual (INR)', value: (r) => r.actual, numFmt: '#,##0.00' },
  { header: 'Achievement %', value: (r) => (r.achievement === null ? null : Number(r.achievement.toFixed(2))) },
  { header: 'Variance (INR)', value: (r) => r.variance, numFmt: '#,##0.00' },
  { header: 'Growth % vs previous month', value: (r) => (r.growth === null ? null : Number(r.growth.toFixed(2))) },
  { header: 'Cumulative actual (INR)', value: (r) => r.cumActual, numFmt: '#,##0.00' },
  { header: 'Cumulative target (INR)', value: (r) => r.cumTarget, numFmt: '#,##0.00' },
  { header: 'Same month previous FY (INR)', value: (r) => r.prevFyActual, numFmt: '#,##0.00' },
  { header: 'Run-rate projection (INR)', value: (r) => r.projected, numFmt: '#,##0.00' },
];

export function MonthlyReportPage() {
  const { params, update, reset } = usePerfParams();
  const { model, isLoading, error, refetch, isFetching } = usePerfModel(params);

  const d = useMemo(() => {
    if (!model) return null;
    const scope = headlineScope(model, params);
    const upTo = model.today.slice(0, 7) + '-01';
    const base = buildMonthRows(model.facts, model.months, scope.pred, scope.target, upTo);
    const prevMonths = fyMonths(model.fy - 1);
    const prev = monthlySeries(model.facts, prevMonths, scope.pred);
    const hasPrev = prev.some((p) => p.records > 0);
    const rows: ReportRow[] = base.map((r, i) => ({
      ...r,
      prevFyActual: hasPrev ? prev[i].actual : null,
      vsPrevFy: hasPrev && prev[i].actual > 0 && r.month <= upTo ? ((r.actual - prev[i].actual) / prev[i].actual) * 100 : null,
      projected: r.month === upTo ? projectMonth(r.actual, r.month, model.today) : null,
    }));
    const fyActual = rows.reduce((s, r) => s + r.actual, 0);
    const fyTarget = rows.some((r) => r.target !== null) ? rows.reduce((s, r) => s + (r.target ?? 0), 0) : null;
    const projection = projectFy(rows.map((r) => ({ month: r.month, actual: r.actual })), model.today);

    const visible = model.months.filter((m) => m <= upTo);
    const zoneKeys = [...model.zones, THIRD_PARTY, NO_ZONE].filter((z) => model.facts.some((f) => zoneBucket(f) === z));
    const zoneRows = zoneKeys.map((z) => {
      const pred = model.zones.includes(z) ? inZone(z) : (f: PerfFact) => zoneBucket(f) === z;
      const s = monthlySeries(model.facts, visible, pred);
      return { key: z, values: s.map((x) => x.actual), total: s.reduce((a, b) => a + b.actual, 0) };
    });
    const mgrRows = salesManagers(model.data.managers)
      .filter((m) => !params.zone || m.zone === params.zone)
      .map((m) => {
        const r = buildMonthRows(model.facts, visible, isManager(m.manager_key), (mo) => model.book.manager(m.manager_key, mo), upTo);
        return { key: m.manager_key, label: m.display_name, zone: m.zone, rows: r, total: r.reduce((a, b) => a + b.actual, 0) };
      });
    return { scope, rows, fyActual, fyTarget, projection, hasPrev, visible, zoneRows, mgrRows };
  }, [model, params]);

  return (
    <div>
      <PageHeader
        title="Monthly performance report"
        description="April–March company report: targets, actuals, achievement, variance, growth and cumulative figures."
        actions={
          model && d ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="no-print" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" aria-hidden /> Print
              </Button>
              <ExportMenu name="monthly-report" rows={d.rows} columns={COLUMNS} preamble={filterPreamble(model, params, `Monthly report — ${d.scope.label}`)} print={false} />
            </div>
          ) : null
        }
      />
      <PerfNav />
      <PerfFilterBar params={params} update={update} reset={reset} model={model} fields={['fy', 'zone', 'manager', 'channel', 'product', 'place']} />
      {error && !model ? (
        <Card>
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !model || !d ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <>
          <div className="mb-4">
            <LastRefresh model={model} isFetching={isFetching} onRefresh={() => refetch()} />
          </div>
          <NoTargetsNote model={model} />
          <TargetFilterWarning params={params} />

          <Card className="mb-6">
            <CardHeader
              title={`${d.scope.label} — ${fyLabel(model.fy)}`}
              description={
                <>
                  Total {fmtInr(d.fyActual)}
                  {d.fyTarget !== null && ` of ${fmtInr(d.fyTarget)} entered target (${fmtPct((d.fyActual / d.fyTarget) * 100)})`}.{' '}
                  {d.projection !== null && `Run-rate projection for the full year: ${fmtInr(d.projection)} — an estimate, not recorded sales.`}
                </>
              }
            />
            <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
              <table className="data-table w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-2 py-2 font-medium">Month</th>
                    <th className="px-2 py-2 text-right font-medium">Target</th>
                    <th className="px-2 py-2 text-right font-medium">Actual</th>
                    <th className="px-2 py-2 text-right font-medium">Ach. %</th>
                    <th className="px-2 py-2 text-right font-medium">Variance</th>
                    <th className="px-2 py-2 text-right font-medium">Growth %</th>
                    <th className="px-2 py-2 text-right font-medium">Cumulative actual</th>
                    <th className="px-2 py-2 text-right font-medium">Cumulative target</th>
                    {d.hasPrev && <th className="px-2 py-2 text-right font-medium">Previous FY</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => {
                    const future = r.month > model.today.slice(0, 7) + '-01';
                    return (
                      <tr key={r.month} className={cn('border-b border-line/60', future && 'text-muted')}>
                        <td className="px-2 py-1.5">{monthLabel(r.month, true)}</td>
                        <td className="tabular px-2 py-1.5 text-right">{r.target === null ? 'Not set' : fmtInr(r.target)}</td>
                        <td className="tabular px-2 py-1.5 text-right">
                          {future ? '—' : fmtInr(r.actual)}
                          {r.projected !== null && r.projected !== r.actual && <span className="block text-[11px] text-muted">projected {fmtInr(r.projected)}</span>}
                        </td>
                        <td className="tabular px-2 py-1.5 text-right">{fmtPct(r.achievement)}</td>
                        <td className={cn('tabular px-2 py-1.5 text-right', r.variance !== null && (r.variance >= 0 ? 'text-success' : 'text-danger'))}>
                          {r.variance === null ? '—' : `${r.variance >= 0 ? '+' : '−'}${fmtInr(Math.abs(r.variance))}`}
                        </td>
                        <td className="tabular px-2 py-1.5 text-right">{r.growth === null ? '—' : `${r.growth >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(r.growth))}`}</td>
                        <td className="tabular px-2 py-1.5 text-right">{future ? '—' : fmtInr(r.cumActual)}</td>
                        <td className="tabular px-2 py-1.5 text-right">{r.cumTarget === null ? '—' : fmtInr(r.cumTarget)}</td>
                        {d.hasPrev && <td className="tabular px-2 py-1.5 text-right">{fmtInr(r.prevFyActual)}</td>}
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-line font-semibold text-navy">
                    <td className="px-2 py-2">Total</td>
                    <td className="tabular px-2 py-2 text-right">{d.fyTarget === null ? 'Not set' : fmtInr(d.fyTarget)}</td>
                    <td className="tabular px-2 py-2 text-right">{fmtInr(d.fyActual)}</td>
                    <td className="tabular px-2 py-2 text-right">{d.fyTarget ? fmtPct((d.fyActual / d.fyTarget) * 100) : '—'}</td>
                    <td colSpan={d.hasPrev ? 5 : 4} />
                  </tr>
                </tbody>
              </table>
              {!d.hasPrev && <p className="mt-2 text-xs text-muted">No sales are recorded for {fyLabel(model.fy - 1)}, so a previous-year comparison is not available.</p>}
            </div>
          </Card>

          <Card className="print-break mb-6">
            <CardHeader title="Zone breakdown" description="Actual sales by month. HO zone sales are included in their zone; third-party sales are shown separately." />
            <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
              <table className="data-table w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="px-2 py-2 font-medium">Zone</th>
                    {d.visible.map((m) => (
                      <th key={m} className="px-2 py-2 text-right font-medium">
                        {monthLabel(m)}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.zoneRows.map((z) => (
                    <tr key={z.key} className="border-b border-line/60">
                      <td className="px-2 py-1.5 font-medium">{z.key}</td>
                      {z.values.map((v, i) => (
                        <td key={i} className="tabular px-2 py-1.5 text-right">
                          {fmtInr(v)}
                        </td>
                      ))}
                      <td className="tabular px-2 py-1.5 text-right font-semibold">{fmtInr(z.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Manager breakdown" description="Actual sales by month, with achievement where a monthly target exists." />
            <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
              <table className="data-table w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="px-2 py-2 font-medium">Manager</th>
                    {d.visible.map((m) => (
                      <th key={m} className="px-2 py-2 text-right font-medium">
                        {monthLabel(m)}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.mgrRows.map((mg) => (
                    <tr key={mg.key} className="border-b border-line/60">
                      <td className="px-2 py-1.5 font-medium">
                        {mg.label}
                        {mg.zone && <span className="block text-[11px] font-normal text-muted">{mg.zone}</span>}
                      </td>
                      {mg.rows.map((r) => (
                        <td key={r.month} className="tabular px-2 py-1.5 text-right">
                          {fmtInr(r.actual)}
                          {r.achievement !== null && <span className="block text-[11px] text-muted">{fmtPct(r.achievement, 0)}</span>}
                        </td>
                      ))}
                      <td className="tabular px-2 py-1.5 text-right font-semibold">{fmtInr(mg.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
