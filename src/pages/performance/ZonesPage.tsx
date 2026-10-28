import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { ChartCard } from '@/components/dashboard/charts';
import {
  CHANNEL_LABEL,
  ExportMenu,
  filterPreamble,
  fmtInr,
  fmtPct,
  monthLabel,
  PerfFilterBar,
  PerfNav,
  StatusBadge,
  usePerfModel,
  usePerfParams,
} from '@/components/performance/PerfUi';
import { ContributionChart, GroupedBars, TargetVsActualChart } from '@/components/performance/perfCharts';
import { buildMonthRows } from '@/components/performance/series';
import { managerScorecards, zoneScorecards } from '@/components/performance/scorecards';
import { BranchCard, NoTargetsNote, TargetFilterWarning } from './PerformancePage';
import { friendlyError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { SERIES } from '@/lib/format';
import {
  fyLabel,
  inZone,
  monthlySeries,
  NO_ZONE,
  rankScorecards,
  STATUS_LABEL,
  THIRD_PARTY,
  zoneBucket,
  type PerfFact,
  type PerfStatus,
  type Scorecard,
} from '@/lib/performance';

const ZONE_COLUMNS: ExportColumn<Scorecard>[] = [
  { header: 'Zone', value: (r) => r.label, width: 22 },
  { header: 'Month actual (INR)', value: (r) => r.actual, numFmt: '#,##0.00' },
  { header: 'Month target (INR)', value: (r) => r.target, numFmt: '#,##0.00' },
  { header: 'Target source', value: (r) => r.targetSource ?? '' },
  { header: 'Achievement %', value: (r) => (r.achievement === null ? null : Number(r.achievement.toFixed(2))) },
  { header: 'Remaining (INR)', value: (r) => r.remaining, numFmt: '#,##0.00' },
  { header: 'Growth %', value: (r) => (r.growth === null ? null : Number(r.growth.toFixed(2))) },
  { header: 'Status', value: (r) => STATUS_LABEL[r.status] },
  { header: 'FY to date actual (INR)', value: (r) => r.ytdActual, numFmt: '#,##0.00' },
  { header: 'FY to date target (INR)', value: (r) => r.ytdTarget, numFmt: '#,##0.00' },
];

const sumInr = (facts: PerfFact[]) => Math.round(facts.reduce((s, f) => s + Number(f.inr ?? 0), 0) * 100) / 100;
const count = (facts: PerfFact[]) => facts.reduce((s, f) => s + Number(f.records ?? 0), 0);

export function ZonesPage() {
  const { params, update, reset } = usePerfParams();
  const [sp, setSp] = useSearchParams();
  const { model, isLoading, error, refetch } = usePerfModel({ ...params, zone: undefined, manager: undefined });
  const dz = sp.get('dz') ?? undefined;
  const dp = sp.get('dp') ?? undefined;
  const dm = sp.get('dm') ?? undefined;
  const go = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setSp(next, { replace: false });
  };

  const d = useMemo(() => {
    if (!model) return null;
    const zones = zoneScorecards(model, {});
    const managers = managerScorecards(model, {});
    const ytdFacts = model.facts.filter((f) => model.months.includes(f.month) && f.month <= model.month);
    const statusCounts = new Map<string, Record<PerfStatus, number>>();
    for (const m of managers) {
      const z = m.zone ?? NO_ZONE;
      const c = statusCounts.get(z) ?? ({ exceeded: 0, achieved: 0, on_track: 0, behind: 0, target_not_set: 0, no_sales: 0, upcoming: 0 } as Record<PerfStatus, number>);
      c[m.status]++;
      statusCounts.set(z, c);
    }
    const topManager = (z: string) => {
      const r = rankScorecards(managers.filter((m) => m.zone === z));
      const first = r[0];
      if (!first) return null;
      return first.rank ? `${first.item.label} (${fmtPct(first.item.achievement)})` : `${first.item.label} (highest sales, no target)`;
    };
    const trend = (() => {
      const ms = model.months.filter((m) => m <= model.month);
      const per = model.zones.map((z) => ({ z, s: monthlySeries(model.facts, ms, inZone(z)) }));
      return ms.map((m, i) => {
        const row: Record<string, number | string | null> = { label: monthLabel(m) };
        for (const p of per) row[p.z] = p.s[i].actual;
        return row;
      });
    })();
    const contribution = [...new Set(ytdFacts.map(zoneBucket))].map((z) => ({ name: z, value: sumInr(ytdFacts.filter((f) => zoneBucket(f) === z)) })).sort((a, b) => b.value - a.value);
    return { zones, managers, ytdFacts, statusCounts, topManager, trend, contribution };
  }, [model]);

  const zoneColors = useMemo(() => Object.fromEntries((model?.zones ?? []).map((z, i) => [z, SERIES[i % SERIES.length]])), [model]);

  const crumb = (label: string, onClick?: () => void) =>
    onClick ? (
      <button type="button" onClick={onClick} className="font-medium text-brand hover:underline">
        {label}
      </button>
    ) : (
      <span className="font-semibold text-navy">{label}</span>
    );

  return (
    <div>
      <PageHeader
        title="Zone performance"
        description="Zone targets and actuals with drill-down from company to zone, place, manager and transactions. HO zone sales count towards their zone."
        actions={model && d ? <ExportMenu name="zone-performance" rows={d.zones} columns={ZONE_COLUMNS} preamble={filterPreamble(model, params, 'Zone performance')} /> : null}
      />
      <PerfNav />
      <PerfFilterBar params={params} update={update} reset={reset} model={model} fields={['fy', 'month', 'channel', 'product', 'dates']} />
      {error && !model ? (
        <Card>
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !model || !d ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <>
          <NoTargetsNote model={model} />
          <TargetFilterWarning params={params} />
          <nav aria-label="Drill-down" className="no-print mb-4 flex flex-wrap items-center gap-1.5 text-sm">
            {crumb('Company', dz ? () => go({ dz: undefined, dp: undefined, dm: undefined }) : undefined)}
            {dz && (
              <>
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                {crumb(dz, dp ? () => go({ dp: undefined, dm: undefined }) : undefined)}
              </>
            )}
            {dp && (
              <>
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                {crumb(dp, dm ? () => go({ dm: undefined }) : undefined)}
              </>
            )}
            {dm && (
              <>
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                {crumb(d.ytdFacts.find((f) => f.manager_key === dm)?.manager_label ?? dm)}
              </>
            )}
          </nav>

          {!dz ? (
            <>
              <Card className="mb-6">
                <CardHeader title={`Zones — ${monthLabel(model.month, true)}`} description="Select a zone to drill down." />
                <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
                  <table className="data-table w-full min-w-[960px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="px-2 py-2 font-medium">Zone</th>
                        <th className="px-2 py-2 text-right font-medium">Actual</th>
                        <th className="px-2 py-2 text-right font-medium">Target</th>
                        <th className="px-2 py-2 text-right font-medium">Achievement</th>
                        <th className="px-2 py-2 text-right font-medium">Remaining</th>
                        <th className="px-2 py-2 text-right font-medium">FY to date</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 font-medium">Managers by status</th>
                        <th className="px-2 py-2 font-medium">Top manager</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.zones.map((z) => {
                        const counts = d.statusCounts.get(z.key);
                        const special = z.key === THIRD_PARTY || z.key === NO_ZONE;
                        return (
                          <tr key={z.key} className="border-b border-line/60">
                            <td className="px-2 py-2">
                              {special ? (
                                <span className="text-ink">{z.label}</span>
                              ) : (
                                <button type="button" className="font-medium text-brand hover:underline" onClick={() => go({ dz: z.key })}>
                                  {z.label}
                                </button>
                              )}
                            </td>
                            <td className="tabular px-2 py-2 text-right">{fmtInr(z.actual)}</td>
                            <td className="tabular px-2 py-2 text-right" title={z.targetSource === 'sum_of_managers' ? 'Sum of manager targets (HO sales have no target here)' : undefined}>
                              {z.target === null ? (special ? 'n/a' : 'Not set') : `${fmtInr(z.target)}${z.targetSource === 'sum_of_managers' ? ' *' : ''}`}
                            </td>
                            <td className="tabular px-2 py-2 text-right">{fmtPct(z.achievement)}</td>
                            <td className="tabular px-2 py-2 text-right">{z.remaining === null ? '—' : fmtInr(z.remaining)}</td>
                            <td className="tabular px-2 py-2 text-right">{fmtInr(z.ytdActual)}</td>
                            <td className="px-2 py-2">{special ? <span className="text-xs text-muted">Company channel</span> : <StatusBadge status={z.status} />}</td>
                            <td className="px-2 py-2 text-xs text-muted">
                              {counts
                                ? (Object.entries(counts) as [PerfStatus, number][])
                                    .filter(([, n]) => n > 0)
                                    .map(([s, n]) => `${STATUS_LABEL[s]}: ${n}`)
                                    .join(' · ')
                                : '—'}
                            </td>
                            <td className="px-2 py-2 text-xs">{special ? '—' : (d.topManager(z.key) ?? '—')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted">* Zone target derived from the sum of its managers&apos; targets because no zone target was entered. Zone actuals include HO sales for the zone.</p>
                </div>
              </Card>
              <div className="grid gap-4 xl:grid-cols-3">
                <ChartCard
                  className="xl:col-span-2"
                  title={`Monthly sales by zone — ${fyLabel(model.fy)}`}
                  height={320}
                  table={{ columns: ['Month', ...model.zones], rows: d.trend.map((r) => [String(r.label), ...model.zones.map((z) => fmtInr(r[z] as number))]) }}
                >
                  <GroupedBars data={d.trend} keys={model.zones.map((z) => ({ key: z, label: z }))} colors={zoneColors} />
                </ChartCard>
                <ChartCard title="Contribution to company sales" description={`${fyLabel(model.fy)} to date`} table={{ columns: ['Zone', 'INR'], rows: d.contribution.map((c) => [c.name, fmtInr(c.value)]) }}>
                  <ContributionChart slices={d.contribution} />
                </ChartCard>
              </div>
            </>
          ) : (
            ZoneDrill({ zone: dz, place: dp, manager: dm, go })
          )}
        </>
      )}
    </div>
  );

  function ZoneDrill({ zone, place, manager, go: nav }: { zone: string; place?: string; manager?: string; go: (p: Record<string, string | undefined>) => void }) {
    const m = model!;
    const card = d!.zones.find((z) => z.key === zone);
    const rows = buildMonthRows(m.facts, m.months, inZone(zone), (mo) => m.book.zone(zone, mo), m.month);
    const zoneFacts = d!.ytdFacts.filter((f) => f.zone === zone);
    const monthFacts = m.facts.filter((f) => f.zone === zone && f.month === m.month);
    const scoped = place ? zoneFacts.filter((f) => (f.place ?? 'Not stated') === place) : zoneFacts;
    const groupKey = (f: PerfFact) => (place ? (f.manager_key ?? 'unknown') : (f.place ?? 'Not stated'));
    const groups = [...new Set(scoped.map(groupKey))].map((k) => {
      const ytd = scoped.filter((f) => groupKey(f) === k);
      const mon = (place ? monthFacts.filter((f) => (f.place ?? 'Not stated') === place) : monthFacts).filter((f) => groupKey(f) === k);
      return { key: k, label: place ? (ytd[0]?.manager_label ?? k) : k, channel: ytd[0]?.channel, month: sumInr(mon), ytd: sumInr(ytd), records: count(ytd) };
    }).sort((a, b) => b.ytd - a.ytd);
    const txQuery = new URLSearchParams({ zone, fy: fyLabel(m.fy) });
    if (place) txQuery.set('place', place);
    if (manager) txQuery.set('manager_key', manager);
    const mgrRules = (m.data.settings['reporting.consolidation']?.branches ?? []).filter((r) => !r.zone || r.zone === zone);

    return (
      <>
        {card && (
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={card.status} />
            <span>
              {monthLabel(m.month, true)}: {fmtInr(card.actual)} of {card.target === null ? 'no target' : fmtInr(card.target)} ({fmtPct(card.achievement)})
            </span>
            <span className="text-muted">
              Individual {fmtInr(sumInr(monthFacts.filter((f) => f.channel === 'individual')))} · HO {fmtInr(sumInr(monthFacts.filter((f) => f.channel === 'ho')))}
            </span>
          </div>
        )}
        {!place && (
          <ChartCard className="mb-6" title={`${zone} — target vs actual`} table={{ columns: ['Month', 'Actual', 'Target'], rows: rows.map((r) => [r.label, fmtInr(r.actual), r.target === null ? 'Not set' : fmtInr(r.target)]) }}>
            <TargetVsActualChart data={rows} />
          </ChartCard>
        )}
        {manager ? (
          <Card className="mb-6 p-5 text-sm">
            <p>
              Transactions for <strong>{groups.find((g) => g.key === manager)?.label ?? manager}</strong> at {place} ({zone}), {fyLabel(m.fy)}.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" to={`/sales?${txQuery}`}>
                Open transactions <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
              {d!.managers.some((x) => x.key === manager) && (
                <Link className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" to={`/performance/managers/${encodeURIComponent(manager)}?fy=${m.fy}&month=${m.month}`}>
                  Manager profile
                </Link>
              )}
            </div>
          </Card>
        ) : (
          <Card className="mb-6">
            <CardHeader
              title={place ? `${place} — by manager` : `${zone} — by place of sale`}
              description={`${monthLabel(m.month, true)} and ${fyLabel(m.fy)} to date. The sheet has no branch column, so place of sale is used.`}
              actions={
                <Link className="no-print inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline" to={`/sales?${txQuery}`}>
                  Transactions <ExternalLink className="h-3 w-3" aria-hidden />
                </Link>
              }
            />
            <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
              <table className="data-table w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-2 py-2 font-medium">{place ? 'Manager / channel' : 'Place'}</th>
                    <th className="px-2 py-2 text-right font-medium">{monthLabel(m.month, true)}</th>
                    <th className="px-2 py-2 text-right font-medium">FY to date</th>
                    <th className="px-2 py-2 text-right font-medium">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.key} className="border-b border-line/60">
                      <td className="px-2 py-2">
                        <button type="button" className="font-medium text-brand hover:underline" onClick={() => nav(place ? { dm: g.key } : { dp: g.key })}>
                          {g.label}
                        </button>
                        {place && g.channel && g.channel !== 'individual' && <span className="ml-1 text-xs text-muted">({CHANNEL_LABEL[g.channel]})</span>}
                      </td>
                      <td className="tabular px-2 py-2 text-right">{fmtInr(g.month)}</td>
                      <td className="tabular px-2 py-2 text-right">{fmtInr(g.ytd)}</td>
                      <td className="tabular px-2 py-2 text-right">{g.records}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {!place && mgrRules.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {mgrRules.map((r) => (
              <BranchCard key={r.name} model={m} rule={r} />
            ))}
          </div>
        )}
      </>
    );
  }
}
