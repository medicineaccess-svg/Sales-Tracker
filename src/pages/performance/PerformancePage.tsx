import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { ChartCard } from '@/components/dashboard/charts';
import {
  ComparisonBars,
  ExportMenu,
  fmtInr,
  fmtInrShort,
  fmtPct,
  HierFilterBar,
  LastRefresh,
  monthLabel,
  PerfNav,
  periodLabel,
  preamble,
  StatTile,
  useHierModel,
  useHierParams,
  type HierModel,
  type HierParams,
} from '@/components/performance/hierUi';
import { ManagerCards, MonthlyPanel } from '@/components/performance/hierPanels';
import { friendlyError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { SERIES } from '@/lib/format';
import { fyLabel, fyStartYear } from '@/lib/performance';
import { monthlyStats, type ManagerNode } from '@/lib/salesHierarchy';

interface RankRow {
  rank: number;
  m: ManagerNode;
  share: number;
  average: number | null;
  best: string;
}

const RANK_COLUMNS: ExportColumn<RankRow>[] = [
  { header: 'Rank', value: (r) => r.rank },
  { header: 'Manager', value: (r) => r.m.label, width: 20 },
  { header: 'Zone', value: (r) => r.m.zones.join(', ') },
  { header: 'Total sales (INR)', value: (r) => r.m.total, numFmt: '#,##0' },
  { header: 'Own sales (INR)', value: (r) => r.m.own, numFmt: '#,##0' },
  { header: 'HO sales (INR)', value: (r) => r.m.ho, numFmt: '#,##0' },
  { header: 'Records', value: (r) => r.m.records },
  { header: 'Share of company %', value: (r) => Number(r.share.toFixed(2)) },
  { header: 'Average monthly (INR)', value: (r) => r.average, numFmt: '#,##0' },
  { header: 'Best month', value: (r) => r.best },
];

/** Link that keeps the active filters and opens the drill-down at the given level. */
export function drillHref(search: URLSearchParams, level: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const k of ['fy', 'month', 'type', 'zone']) if (search.get(k)) p.set(k, search.get(k)!);
  for (const [k, v] of Object.entries(level)) if (v) p.set(k, v);
  return `/performance/drill?${p}`;
}

function YearlyTable({ model, params }: { model: HierModel; params: HierParams }) {
  const rows = useMemo(() => {
    const map = new Map<number, { total: number; records: number }>();
    for (const f of model.allFacts) {
      if (params.manager && f.owner_key !== params.manager) continue;
      if (params.zone && f.zone !== params.zone) continue;
      const fy = fyStartYear(f.month);
      const cur = map.get(fy) ?? { total: 0, records: 0 };
      cur.total += Number(f.inr ?? 0);
      cur.records += Number(f.records ?? 0);
      map.set(fy, cur);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [model, params.manager, params.zone]);
  return (
    <Card>
      <CardHeader title="Yearly sales performance" description="Financial-year totals (April–March) from the sheet." />
      <div className="px-2 pb-4 sm:px-5">
        <table className="data-table w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-2 py-2 font-medium">Financial year</th>
              <th className="px-2 py-2 text-right font-medium">Sales</th>
              <th className="px-2 py-2 text-right font-medium">Records</th>
              <th className="px-2 py-2 text-right font-medium">vs previous FY</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([fy, v], i) => {
              const prev = rows[i + 1]?.[1].total;
              return (
                <tr key={fy} className="border-b border-line/60">
                  <td className="px-2 py-2 font-medium">{fyLabel(fy)}</td>
                  <td className="tabular px-2 py-2 text-right">{fmtInr(v.total)}</td>
                  <td className="tabular px-2 py-2 text-right">{v.records}</td>
                  <td className="tabular px-2 py-2 text-right">{prev ? fmtPct(((v.total - prev) / prev) * 100) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length < 2 && <p className="mt-2 text-xs text-muted">Only one financial year is in the sheet so far, so there is no year-on-year comparison yet.</p>}
      </div>
    </Card>
  );
}

export function PerformancePage() {
  const navigate = useNavigate();
  const { params, update, reset, search } = useHierParams();
  const { model, isLoading, error, refetch, isFetching } = useHierModel(params);

  const d = useMemo(() => {
    if (!model) return null;
    const t = model.tree;
    const st = monthlyStats(model.months, model.fyTree.monthly, model.upTo);
    const zoneMap = new Map<string, number>();
    const hoRows: { key: string; label: string; manager: string; total: number; records: number }[] = [];
    for (const m of t.managers) {
      for (const ty of m.types) {
        for (const z of ty.zones) zoneMap.set(z.key, (zoneMap.get(z.key) ?? 0) + z.total);
        if (ty.type === 'ho') hoRows.push({ key: m.key, label: ty.label, manager: m.label, total: ty.total, records: ty.records });
      }
    }
    for (const b of t.buckets) {
      if (b.reason === 'third_party') hoRows.push({ key: `bucket:${b.reason}`, label: b.label, manager: '— (not credited to a manager)', total: b.total, records: b.records });
      else if (b.reason === 'ho_unassigned') hoRows.push({ key: `bucket:${b.reason}`, label: b.label, manager: '—', total: b.total, records: b.records });
    }
    const ranking: RankRow[] = t.managers.map((m, i) => {
      const fy = model.fyTree.managers.find((x) => x.key === m.key);
      const s = fy ? monthlyStats(model.months, fy.monthly, model.upTo) : null;
      return { rank: i + 1, m, share: t.total ? (m.total / t.total) * 100 : 0, average: s?.average ?? null, best: s?.highest ? monthLabel(s.highest.month, true) : '—' };
    });
    return {
      st,
      zones: [...zoneMap.entries()].map(([key, value]) => ({ key, label: key, value })).sort((a, b) => b.value - a.value),
      hoRows: hoRows.sort((a, b) => b.total - a.total),
      ranking,
    };
  }, [model]);

  return (
    <div>
      <PageHeader
        title="Sales performance"
        description="Manager → HO → Zone → individual sales, built only from the sheet’s columns. Click any manager, HO or zone to drill down."
        actions={model && d ? <ExportMenu name="manager-sales" rows={d.ranking} columns={RANK_COLUMNS} preamble={preamble(model, params, 'Manager sales ranking')} /> : null}
      />
      <PerfNav />
      <HierFilterBar params={params} update={update} reset={reset} model={model} />
      {error && !model ? (
        <Card>
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !model || !d ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-4">
            <LastRefresh model={model} isFetching={isFetching} onRefresh={() => refetch()} />
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={`Company sales · ${periodLabel(model, params)}`} value={fmtInrShort(model.tree.total)} title={fmtInr(model.tree.total)} sub={`${model.tree.records} sale(s)`} />
            <StatTile label="Managers with sales" value={model.tree.managers.length} sub={`Top: ${model.tree.managers[0]?.label ?? '—'}`} />
            <StatTile label="Top zone" value={d.zones[0]?.label ?? '—'} sub={d.zones[0] ? fmtInrShort(d.zones[0].value) : undefined} />
            <StatTile
              label="HO (Third Party)"
              value={fmtInrShort(model.tree.buckets.find((b) => b.reason === 'third_party')?.total ?? 0)}
              sub="Not credited to any manager"
            />
          </div>

          <div className="mb-2 flex items-end justify-between gap-2">
            <h2 className="text-sm font-semibold text-navy">Manager-wise performance · {periodLabel(model, params)}</h2>
            <span className="text-xs text-muted">Individual achievement = own sales + HO sales named for the manager</span>
          </div>
          <div className="mb-6">
            <ManagerCards tree={model.tree} fyTree={model.fyTree} months={model.months} upTo={model.upTo} hrefFor={(k) => drillHref(search, { m: k })} />
          </div>

          <div className="mb-6 grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Zone-wise sales comparison"
              description={`${periodLabel(model, params)} · HO zone sales count in their zone. Click a zone to see its sales.`}
              height={Math.max(200, d.zones.length * 48)}
              table={{ columns: ['Zone', 'Sales'], rows: d.zones.map((z) => [z.label, fmtInr(z.value)]) }}
            >
              <ComparisonBars items={d.zones} onSelect={(z) => navigate(drillHref(search, { zone: z }))} />
            </ChartCard>
            <Card className="min-w-0">
              <CardHeader title="HO-wise sales summary" description="HO rows are credited to the manager named in the Zone column, e.g. “HO North Zone (Firoz)”." />
              <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
                <table className="data-table w-full min-w-[460px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="px-2 py-2 font-medium">HO</th>
                      <th className="px-2 py-2 font-medium">Manager</th>
                      <th className="px-2 py-2 text-right font-medium">Sales</th>
                      <th className="px-2 py-2 text-right font-medium">Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.hoRows.map((h) => (
                      <tr key={h.label} className="border-b border-line/60">
                        <td className="px-2 py-2">
                          <Link className="font-medium text-brand hover:underline" to={drillHref(search, h.key.startsWith('bucket:') ? { m: h.key } : { m: h.key, t: 'ho' })}>
                            {h.label}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-muted">{h.manager}</td>
                        <td className="tabular px-2 py-2 text-right">{fmtInr(h.total)}</td>
                        <td className="tabular px-2 py-2 text-right">{h.records}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <h2 className="mb-2 text-sm font-semibold text-navy">Monthly sales trend · {fyLabel(model.fy)}</h2>
          <div className="mb-6">
            <MonthlyPanel
              title="Company"
              months={model.months}
              values={model.fyTree.monthly}
              upTo={model.upTo}
              onSelectMonth={(m) => update({ month: m === params.month ? undefined : m, fy: model.fy })}
            />
          </div>

          <div className="mb-6 grid gap-4 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader title={`Manager ranking · ${periodLabel(model, params)}`} description="Ranked by total sales (own + HO)." />
              <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
                <table className="data-table w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="px-2 py-2 font-medium">#</th>
                      <th className="px-2 py-2 font-medium">Manager</th>
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                      <th className="px-2 py-2 text-right font-medium">Own</th>
                      <th className="px-2 py-2 text-right font-medium">HO</th>
                      <th className="px-2 py-2 text-right font-medium">Share</th>
                      <th className="px-2 py-2 text-right font-medium">Avg / month</th>
                      <th className="px-2 py-2 font-medium">Best month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ranking.map((r) => (
                      <tr key={r.m.key} className="border-b border-line/60">
                        <td className="tabular px-2 py-2 font-semibold">{r.rank}</td>
                        <td className="px-2 py-2">
                          <Link className="font-medium text-brand hover:underline" to={drillHref(search, { m: r.m.key })}>
                            {r.m.label}
                          </Link>
                          <span className="block text-[11px] text-muted">{r.m.zones.join(', ')}</span>
                        </td>
                        <td className="tabular px-2 py-2 text-right font-medium">{fmtInr(r.m.total)}</td>
                        <td className="tabular px-2 py-2 text-right">{fmtInr(r.m.own)}</td>
                        <td className="tabular px-2 py-2 text-right">{fmtInr(r.m.ho)}</td>
                        <td className="tabular px-2 py-2 text-right">{fmtPct(r.share)}</td>
                        <td className="tabular px-2 py-2 text-right">{fmtInrShort(r.average)}</td>
                        <td className="px-2 py-2">{r.best}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <ChartCard
              title="Manager contribution"
              description={periodLabel(model, params)}
              height={Math.max(220, model.tree.managers.length * 44)}
              table={{ columns: ['Manager', 'Sales'], rows: model.tree.managers.map((m) => [m.label, fmtInr(m.total)]) }}
            >
              <ComparisonBars
                items={model.tree.managers.map((m) => ({ key: m.key, label: m.label, value: m.total, sub: `Own ${fmtInrShort(m.own)} · HO ${fmtInrShort(m.ho)}` }))}
                onSelect={(k) => navigate(drillHref(search, { m: k }))}
                color={SERIES[1]}
              />
            </ChartCard>
          </div>

          <YearlyTable model={model} params={params} />
        </>
      )}
    </div>
  );
}
