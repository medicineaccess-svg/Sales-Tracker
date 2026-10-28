import { useMemo } from 'react';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { ChartCard, MetricSwitch } from '@/components/dashboard/charts';
import {
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
import { GroupedBars } from '@/components/performance/perfCharts';
import { buildMonthRows } from '@/components/performance/series';
import { managerScorecards } from '@/components/performance/scorecards';
import { MANAGER_COLUMNS, NoTargetsNote, TargetFilterWarning } from './PerformancePage';
import { useSearchParams } from 'react-router-dom';
import { friendlyError } from '@/lib/errors';
import { SERIES } from '@/lib/format';
import { fyLabel, isManager, salesManagers } from '@/lib/performance';
import { cn } from '@/lib/utils';

const MAX = 6;

export function ComparePage() {
  const { params, update, reset } = usePerfParams();
  const [sp, setSp] = useSearchParams();
  const { model, isLoading, error, refetch } = usePerfModel({ ...params, manager: undefined });
  const metric = (sp.get('metric') as 'actual' | 'achievement') || 'actual';

  const all = useMemo(() => (model ? salesManagers(model.data.managers).filter((m) => !params.zone || m.zone === params.zone) : []), [model, params.zone]);
  const picked = useMemo(() => {
    const raw = sp.get('ids');
    const ids = raw ? raw.split(',').filter(Boolean) : all.map((m) => m.manager_key);
    return ids.filter((id) => all.some((m) => m.manager_key === id)).slice(0, MAX);
  }, [sp, all]);
  // Colour is fixed per manager (by master-data order), so toggling others never repaints a manager.
  const colorOf = useMemo(() => Object.fromEntries(all.map((m, i) => [m.manager_key, SERIES[i % SERIES.length]])), [all]);

  const setIds = (ids: string[]) => {
    const next = new URLSearchParams(sp);
    next.set('ids', ids.join(','));
    setSp(next, { replace: true });
  };
  const toggle = (id: string) =>
    setIds(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length >= MAX ? picked : [...picked, id]);

  const d = useMemo(() => {
    if (!model) return null;
    const cards = managerScorecards(model, params).filter((c) => picked.includes(c.key));
    const perManager = picked.map((id) => ({ id, rows: buildMonthRows(model.facts, model.months, isManager(id), (m) => model.book.manager(id, m), model.month) }));
    const data = model.months
      .filter((m) => m <= model.month)
      .map((m, i) => {
        const row: Record<string, number | string | null> = { label: monthLabel(m) };
        for (const pm of perManager) row[pm.id] = metric === 'actual' ? pm.rows[i].actual : pm.rows[i].achievement;
        return row;
      });
    return { cards, data };
  }, [model, params, picked, metric]);

  return (
    <div>
      <PageHeader
        title="Compare managers"
        description="Side-by-side monthly performance for up to six sales managers."
        actions={model && d ? <ExportMenu name="manager-comparison" rows={d.cards} columns={MANAGER_COLUMNS} preamble={filterPreamble(model, params, 'Manager comparison')} /> : null}
      />
      <PerfNav />
      <PerfFilterBar params={params} update={update} reset={reset} model={model} fields={['fy', 'month', 'zone', 'product', 'place', 'dates']} />
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
          <div className="no-print mb-4 flex flex-wrap gap-2" role="group" aria-label="Managers to compare">
            {all.map((m) => {
              const on = picked.includes(m.manager_key);
              return (
                <button
                  key={m.manager_key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(m.manager_key)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                    on ? 'border-navy bg-card text-navy' : 'border-line text-muted hover:border-accent/60',
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: on ? colorOf[m.manager_key] : '#ddd6ca' }} />
                  {m.display_name}
                  <span aria-hidden>{on ? '✓' : '+'}</span>
                </button>
              );
            })}
          </div>
          <ChartCard
            className="mb-6"
            title={`${metric === 'actual' ? 'Monthly sales' : 'Monthly achievement %'} — ${fyLabel(model.fy)}`}
            height={340}
            actions={
              <MetricSwitch
                label="Metric"
                value={metric}
                onChange={(v) => {
                  const next = new URLSearchParams(sp);
                  next.set('metric', v);
                  setSp(next, { replace: true });
                }}
                options={[
                  { value: 'actual', label: 'Sales ₹' },
                  { value: 'achievement', label: 'Achievement %' },
                ]}
              />
            }
            table={{
              columns: ['Month', ...picked.map((id) => all.find((m) => m.manager_key === id)?.display_name ?? id)],
              rows: d.data.map((r) => [String(r.label), ...picked.map((id) => (metric === 'actual' ? fmtInr(r[id] as number) : fmtPct(r[id] as number | null)))]),
            }}
          >
            <GroupedBars
              data={d.data}
              keys={picked.map((id) => ({ key: id, label: all.find((m) => m.manager_key === id)?.display_name ?? id }))}
              colors={colorOf}
              percent={metric === 'achievement'}
            />
          </ChartCard>
          <Card>
            <CardHeader title={`${monthLabel(model.month, true)} and ${fyLabel(model.fy)} to date`} />
            <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
              <table className="data-table w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-2 py-2 font-medium">Manager</th>
                    <th className="px-2 py-2 text-right font-medium">Month actual</th>
                    <th className="px-2 py-2 text-right font-medium">Month target</th>
                    <th className="px-2 py-2 text-right font-medium">Achievement</th>
                    <th className="px-2 py-2 text-right font-medium">Growth</th>
                    <th className="px-2 py-2 text-right font-medium">FY to date</th>
                    <th className="px-2 py-2 text-right font-medium">FY to date ach.</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.cards.map((c) => (
                    <tr key={c.key} className="border-b border-line/60">
                      <td className="px-2 py-2">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorOf[c.key] }} />
                        {c.label}
                      </td>
                      <td className="tabular px-2 py-2 text-right">{fmtInr(c.actual)}</td>
                      <td className="tabular px-2 py-2 text-right">{c.target === null ? 'Not set' : fmtInr(c.target)}</td>
                      <td className="tabular px-2 py-2 text-right">{fmtPct(c.achievement)}</td>
                      <td className="tabular px-2 py-2 text-right">{fmtPct(c.growth)}</td>
                      <td className="tabular px-2 py-2 text-right">{fmtInr(c.ytdActual)}</td>
                      <td className="tabular px-2 py-2 text-right">{fmtPct(c.ytdAchievement)}</td>
                      <td className="px-2 py-2">
                        <StatusBadge status={c.status} />
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
