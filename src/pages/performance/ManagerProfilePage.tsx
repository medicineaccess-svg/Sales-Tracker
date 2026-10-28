import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, UserRound } from 'lucide-react';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
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
} from '@/components/performance/PerfUi';
import {
  AchievementGauge,
  AchievementTrendChart,
  ContributionChart,
  CumulativeChart,
  GrowthChart,
  TargetVsActualChart,
} from '@/components/performance/perfCharts';
import { buildMonthRows, type MonthRow } from '@/components/performance/series';
import { NoTargetsNote, TargetFilterWarning } from './PerformancePage';
import { friendlyError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { fyLabel, isManager, monthlyStatus, salesManagers, scorecard, STATUS_LABEL } from '@/lib/performance';

const ROW_COLUMNS: ExportColumn<MonthRow>[] = [
  { header: 'Month', value: (r) => r.label },
  { header: 'Target (INR)', value: (r) => r.target, numFmt: '#,##0.00' },
  { header: 'Actual (INR)', value: (r) => r.actual, numFmt: '#,##0.00' },
  { header: 'Achievement %', value: (r) => (r.achievement === null ? null : Number(r.achievement.toFixed(2))) },
  { header: 'Variance (INR)', value: (r) => r.variance, numFmt: '#,##0.00' },
  { header: 'Remaining (INR)', value: (r) => r.remaining, numFmt: '#,##0.00' },
  { header: 'Growth %', value: (r) => (r.growth === null ? null : Number(r.growth.toFixed(2))) },
  { header: 'Records', value: (r) => r.records },
  { header: 'Cumulative actual (INR)', value: (r) => r.cumActual, numFmt: '#,##0.00' },
  { header: 'Cumulative target (INR)', value: (r) => r.cumTarget, numFmt: '#,##0.00' },
];

export function ManagerProfilePage() {
  const { key } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { params, update, reset } = usePerfParams();
  const { model, isLoading, error, refetch, isFetching } = usePerfModel({ ...params, manager: undefined, zone: undefined });

  const managers = useMemo(() => (model ? salesManagers(model.data.managers) : []), [model]);
  const selected = key ?? managers[0]?.manager_key;
  const master = model?.data.managers.find((m) => m.manager_key === selected);

  const d = useMemo(() => {
    if (!model || !selected) return null;
    const target = (m: string) => model.book.manager(selected, m);
    const pred = isManager(selected);
    const card = scorecard({ key: selected, label: master?.display_name ?? selected, facts: model.allFacts, pred, target, month: model.month, today: model.today });
    const rows = buildMonthRows(model.allFacts, model.months, pred, target, model.month);
    const zone = master?.zone ?? model.allFacts.find((f) => pred(f) && f.zone)?.zone ?? null;
    // Zone contribution: this manager vs the rest of the zone (FY to date)
    const ytd = model.allFacts.filter((f) => model.months.includes(f.month) && f.month <= model.month && zone && f.zone === zone);
    const mine = ytd.filter(pred).reduce((s, f) => s + Number(f.inr ?? 0), 0);
    const ho = ytd.filter((f) => f.channel === 'ho').reduce((s, f) => s + Number(f.inr ?? 0), 0);
    const others = new Map<string, number>();
    for (const f of ytd) if (!pred(f) && f.channel === 'individual') others.set(f.manager_label, (others.get(f.manager_label) ?? 0) + Number(f.inr ?? 0));
    const slices = [
      { name: master?.display_name ?? selected, value: mine, highlight: true },
      ...[...others.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
      { name: `HO ${zone ?? ''}`.trim(), value: ho },
    ];
    const statusRows = rows.map((r) => ({
      ...r,
      status: monthlyStatus({ month: r.month, actual: r.actual, records: r.records, target: r.target, today: model.today }).status,
    }));
    return { card, rows: statusRows, zone, slices, zoneTotal: mine + ho + [...others.values()].reduce((a, b) => a + b, 0), mine };
  }, [model, selected, master]);

  const qs = sp.toString() ? `?${sp.toString()}` : '';

  return (
    <div>
      <PageHeader
        title={master ? `${master.display_name} — performance` : 'Manager performance'}
        description="Monthly targets, actual sales, achievement and growth for one sales manager."
        actions={
          model && d ? (
            <ExportMenu
              name={`manager-${selected}`}
              rows={d.rows}
              columns={ROW_COLUMNS}
              preamble={filterPreamble(model, { ...params, manager: selected }, `Manager profile: ${master?.display_name ?? selected}`)}
            />
          ) : null
        }
      />
      <PerfNav />
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <label className="w-64">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Sales manager</span>
          <Select value={selected ?? ''} onChange={(e) => navigate(`/performance/managers/${encodeURIComponent(e.target.value)}${qs}`)}>
            {managers.map((m) => (
              <option key={m.manager_key} value={m.manager_key}>
                {m.display_name}
                {m.zone ? ` · ${m.zone}` : ''}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <PerfFilterBar params={params} update={update} reset={reset} model={model} fields={['fy', 'month', 'product', 'place', 'dates']} />

      {error && !model ? (
        <Card>
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !model ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : !d || !selected ? (
        <Card>
          <EmptyState title="No sales managers" description="Add sales managers on the Targets page." />
        </Card>
      ) : (
        <>
          <div className="mb-4">
            <LastRefresh model={model} isFetching={isFetching} onRefresh={() => refetch()} />
          </div>
          <NoTargetsNote model={model} />
          <TargetFilterWarning params={params} />

          <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Card>
              <CardBody className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sidebar text-white">
                  <UserRound className="h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0 text-sm">
                  <p className="text-lg font-bold text-navy">{master?.display_name ?? selected}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted">Zone</dt>
                    <dd>{d.zone ?? 'Not assigned'}</dd>
                    <dt className="text-muted">Branch</dt>
                    <dd>{master?.branch ?? 'Not recorded'}</dd>
                    <dt className="text-muted">Employee ID</dt>
                    <dd>{master?.employee_id ?? 'Not recorded'}</dd>
                    <dt className="text-muted">Designation</dt>
                    <dd>{master?.designation ?? 'Not recorded'}</dd>
                    <dt className="text-muted">Reports to</dt>
                    <dd>{master?.reporting_manager ?? 'Not recorded'}</dd>
                    {master && master.aliases.length > 0 && (
                      <>
                        <dt className="text-muted">Also spelt</dt>
                        <dd>{master.aliases.join(', ')}</dd>
                      </>
                    )}
                  </dl>
                  <Link
                    className="no-print mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                    to={`/sales?${new URLSearchParams({ manager_key: selected, fy: fyLabel(model.fy) })}`}
                  >
                    View transactions <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              </CardBody>
            </Card>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label={`${monthLabel(model.month, true)} sales`} value={fmtInrShort(d.card.actual)} title={fmtInr(d.card.actual)} sub={`${d.card.records} record(s)`} />
              <StatTile label="Month target" value={d.card.target === null ? 'Not set' : fmtInrShort(d.card.target)} />
              <StatTile label="Achievement" value={fmtPct(d.card.achievement)} sub={<StatusBadge status={d.card.status} />} />
              <StatTile label="Remaining" value={d.card.remaining === null ? '—' : fmtInrShort(d.card.remaining)} sub={d.card.variance === null ? undefined : `Variance ${fmtInrShort(d.card.variance)}`} />
              <StatTile label="Growth" value={d.card.growth === null ? '—' : fmtPct(d.card.growth)} sub={<GrowthText value={d.card.growth} />} />
              <StatTile label={`${fyLabel(model.fy)} to date`} value={fmtInrShort(d.card.ytdActual)} title={fmtInr(d.card.ytdActual)} />
              <StatTile label="FY to date target" value={d.card.ytdTarget === null ? 'Not set' : fmtInrShort(d.card.ytdTarget)} sub={d.card.ytdTarget === null ? undefined : `${fmtPct(d.card.ytdAchievement)} achieved`} />
              <StatTile
                label="Share of zone"
                value={d.zoneTotal ? fmtPct((d.mine / d.zoneTotal) * 100) : '—'}
                sub={d.zone ? `${d.zone}, FY to date (incl. HO)` : 'No zone'}
              />
            </div>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Target vs actual by month"
              table={{ columns: ['Month', 'Target', 'Actual', 'Achievement'], rows: d.rows.map((r) => [r.label, r.target === null ? 'Not set' : fmtInr(r.target), fmtInr(r.actual), fmtPct(r.achievement)]) }}
            >
              <TargetVsActualChart data={d.rows} />
            </ChartCard>
            <ChartCard title="Monthly achievement trend" table={{ columns: ['Month', 'Achievement'], rows: d.rows.map((r) => [r.label, fmtPct(r.achievement)]) }}>
              <AchievementTrendChart data={d.rows} />
            </ChartCard>
            <ChartCard
              title="Cumulative actual vs cumulative target"
              table={{ columns: ['Month', 'Cumulative actual', 'Cumulative target'], rows: d.rows.map((r) => [r.label, fmtInr(r.cumActual), r.cumTarget === null ? 'Not set' : fmtInr(r.cumTarget)]) }}
            >
              <CumulativeChart data={d.rows} />
            </ChartCard>
            <ChartCard title="Month-on-month growth" table={{ columns: ['Month', 'Growth'], rows: d.rows.map((r) => [r.label, fmtPct(r.growth)]) }}>
              <GrowthChart data={d.rows} />
            </ChartCard>
            <ChartCard title={`Achievement — ${monthLabel(model.month, true)}`} height={240}>
              <AchievementGauge value={d.card.achievement} caption={d.card.target === null ? undefined : `${fmtInrShort(d.card.actual)} of ${fmtInrShort(d.card.target)}`} />
            </ChartCard>
            <ChartCard
              title="Zone contribution"
              description={d.zone ? `${d.zone}, ${fyLabel(model.fy)} to ${monthLabel(model.month, true)}` : 'Manager has no zone'}
              height={240}
              table={{ columns: ['Contributor', 'INR'], rows: d.slices.map((s) => [s.name, fmtInr(s.value)]) }}
            >
              <ContributionChart slices={d.slices} />
            </ChartCard>
          </div>

          <Card>
            <CardHeader title={`Month by month — ${fyLabel(model.fy)}`} />
            <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
              <table className="data-table w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-2 py-2 font-medium">Month</th>
                    <th className="px-2 py-2 text-right font-medium">Target</th>
                    <th className="px-2 py-2 text-right font-medium">Actual</th>
                    <th className="px-2 py-2 text-right font-medium">Achievement</th>
                    <th className="px-2 py-2 text-right font-medium">Variance</th>
                    <th className="px-2 py-2 text-right font-medium">Growth</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.month} className="border-b border-line/60">
                      <td className="px-2 py-1.5">{r.label}</td>
                      <td className="tabular px-2 py-1.5 text-right">{r.target === null ? 'Not set' : fmtInr(r.target)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{fmtInr(r.actual)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{fmtPct(r.achievement)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{r.variance === null ? '—' : fmtInr(r.variance)}</td>
                      <td className="tabular px-2 py-1.5 text-right">{fmtPct(r.growth)}</td>
                      <td className="px-2 py-1.5" title={STATUS_LABEL[r.status]}>
                        <StatusBadge status={r.status} />
                      </td>
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
