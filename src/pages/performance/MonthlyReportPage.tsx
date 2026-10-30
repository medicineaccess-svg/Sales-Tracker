import { useMemo } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import {
  ExportMenu,
  fmtInr,
  fmtInrShort,
  growthText,
  HierFilterBar,
  LastRefresh,
  monthLabel,
  PerfNav,
  preamble,
  useHierModel,
  useHierParams,
} from '@/components/performance/hierUi';
import { friendlyError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { fyLabel } from '@/lib/performance';
import { monthlyStats, type HierNode } from '@/lib/salesHierarchy';
import { cn } from '@/lib/utils';

interface Row {
  month: string;
  sales: number;
  records: number;
  growth: number | null;
  cumulative: number;
}

const COLUMNS: ExportColumn<Row>[] = [
  { header: 'Month', value: (r) => monthLabel(r.month, true) },
  { header: 'Sales (INR)', value: (r) => r.sales, numFmt: '#,##0' },
  { header: 'Records', value: (r) => r.records },
  { header: 'Growth % vs previous month', value: (r) => (r.growth === null ? null : Number(r.growth.toFixed(2))) },
  { header: 'Cumulative FY sales (INR)', value: (r) => r.cumulative, numFmt: '#,##0' },
];

function MatrixTable({ title, description, months, upTo, rows }: { title: string; description?: string; months: string[]; upTo: string | null; rows: (HierNode & { sub?: string })[] }) {
  const visible = months.filter((m) => !upTo || m <= upTo);
  return (
    <Card className="print-break mb-6">
      <CardHeader title={title} description={description} />
      <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
        <table className="data-table w-full min-w-[900px] text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-2 py-2 font-medium">{title.split(' ')[0]}</th>
              {visible.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-medium">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key + (r.sub ?? '')} className="border-b border-line/60">
                <td className="px-2 py-1.5 font-medium">
                  {r.label}
                  {r.sub && <span className="block text-[11px] font-normal text-muted">{r.sub}</span>}
                </td>
                {visible.map((m) => (
                  <td key={m} className="tabular px-2 py-1.5 text-right">
                    {fmtInrShort(r.monthly[months.indexOf(m)])}
                  </td>
                ))}
                <td className="tabular px-2 py-1.5 text-right font-semibold">{fmtInr(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function MonthlyReportPage() {
  const { params, update, reset } = useHierParams();
  const { model, isLoading, error, refetch, isFetching } = useHierModel({ ...params, month: undefined });

  const d = useMemo(() => {
    if (!model) return null;
    const t = model.fyTree;
    const st = monthlyStats(model.months, t.monthly, model.upTo);
    const recordsByMonth = model.months.map((m) => model.fyFacts.filter((f) => f.month === m).reduce((s, f) => s + Number(f.records ?? 0), 0));
    let cum = 0;
    const rows: Row[] = model.months.map((m, i) => {
      cum += t.monthly[i];
      return { month: m, sales: t.monthly[i], records: recordsByMonth[i], growth: st.points[i].growth, cumulative: cum };
    });
    const zoneMap = new Map<string, HierNode>();
    const hoRows: (HierNode & { sub?: string })[] = [];
    for (const mg of t.managers) {
      for (const ty of mg.types) {
        if (ty.type === 'ho') hoRows.push({ ...ty, key: `${mg.key}-ho`, sub: `Credited to ${mg.label}` });
        for (const z of ty.zones) {
          const cur = zoneMap.get(z.key) ?? { key: z.key, label: z.label, total: 0, records: 0, monthly: new Array(12).fill(0) };
          cur.total += z.total;
          cur.records += z.records;
          z.monthly.forEach((v, i) => (cur.monthly[i] += v));
          zoneMap.set(z.key, cur);
        }
      }
    }
    for (const b of t.buckets) hoRows.push({ ...b, sub: 'Not credited to a manager' });
    return { st, rows, zones: [...zoneMap.values()].sort((a, b) => b.total - a.total), hoRows: hoRows.sort((a, b) => b.total - a.total) };
  }, [model]);

  return (
    <div>
      <PageHeader
        title="Monthly sales report"
        description="April–March sales by month, manager, HO and zone — all from the sheet’s INR Value."
        actions={
          model && d ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="no-print" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" aria-hidden /> Print
              </Button>
              <ExportMenu name="monthly-sales-report" rows={d.rows} columns={COLUMNS} preamble={preamble(model, params, 'Monthly sales report')} />
            </div>
          ) : null
        }
      />
      <PerfNav />
      <HierFilterBar params={params} update={update} reset={reset} model={model} fields={['fy', 'manager', 'type', 'zone']} />
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
          <Card className="mb-6">
            <CardHeader
              title={`Company — ${fyLabel(model.fy)}`}
              description={`Total ${fmtInr(d.st.total)} · average ${fmtInr(d.st.average)} per month${d.st.highest ? ` · highest ${monthLabel(d.st.highest.month, true)}` : ''}${d.st.lowest ? ` · lowest ${monthLabel(d.st.lowest.month, true)}` : ''}`}
            />
            <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
              <table className="data-table w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-2 py-2 font-medium">Month</th>
                    <th className="px-2 py-2 text-right font-medium">Sales</th>
                    <th className="px-2 py-2 text-right font-medium">Records</th>
                    <th className="px-2 py-2 text-right font-medium">Growth</th>
                    <th className="px-2 py-2 text-right font-medium">Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => {
                    const future = !!model.upTo && r.month > model.upTo;
                    return (
                      <tr key={r.month} className={cn('border-b border-line/60', future && 'text-muted')}>
                        <td className="px-2 py-1.5">{monthLabel(r.month, true)}</td>
                        <td className="tabular px-2 py-1.5 text-right">{future ? '—' : fmtInr(r.sales)}</td>
                        <td className="tabular px-2 py-1.5 text-right">{future ? '—' : r.records}</td>
                        <td className={cn('tabular px-2 py-1.5 text-right', r.growth !== null && (r.growth >= 0 ? 'text-success' : 'text-danger'))}>{growthText(r.growth)}</td>
                        <td className="tabular px-2 py-1.5 text-right">{future ? '—' : fmtInr(r.cumulative)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-line font-semibold text-navy">
                    <td className="px-2 py-2">Total</td>
                    <td className="tabular px-2 py-2 text-right">{fmtInr(d.st.total)}</td>
                    <td className="tabular px-2 py-2 text-right">{d.rows.reduce((s, r) => s + r.records, 0)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          <MatrixTable title="Manager breakdown" description="Own sales + HO sales named for the manager." months={model.months} upTo={model.upTo} rows={model.fyTree.managers.map((m) => ({ ...m, sub: m.zones.join(', ') }))} />
          <MatrixTable title="HO breakdown" months={model.months} upTo={model.upTo} rows={d.hoRows} />
          <MatrixTable title="Zone breakdown" description="Includes HO sales for the zone. HO (Third Party) has no zone." months={model.months} upTo={model.upTo} rows={d.zones} />
        </>
      )}
    </div>
  );
}
