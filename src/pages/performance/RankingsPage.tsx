import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { MetricSwitch } from '@/components/dashboard/charts';
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
import { managerScorecards, type ManagerCard } from '@/components/performance/scorecards';
import { NoTargetsNote, TargetFilterWarning } from './PerformancePage';
import { friendlyError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { fyLabel, MATRIX_LABEL, matrixCategory, rankScorecards, STATUS_LABEL, type MatrixCategory, type Ranked } from '@/lib/performance';

type Period = 'month' | 'ytd';

interface RankRow {
  rank: number | null;
  card: ManagerCard;
  achievement: number | null;
  actual: number;
  target: number | null;
  category: MatrixCategory;
}

const MATRIX_ICON: Record<MatrixCategory, string> = {
  star: '★',
  achiever_slowing: '◆',
  improving: '↗',
  at_risk: '!',
  no_target: '○',
};

const COLUMNS: ExportColumn<RankRow>[] = [
  { header: 'Rank', value: (r) => r.rank ?? 'Not ranked' },
  { header: 'Manager', value: (r) => r.card.label, width: 22 },
  { header: 'Zone', value: (r) => r.card.zone ?? '' },
  { header: 'Actual (INR)', value: (r) => r.actual, numFmt: '#,##0.00' },
  { header: 'Target (INR)', value: (r) => r.target, numFmt: '#,##0.00' },
  { header: 'Achievement %', value: (r) => (r.achievement === null ? null : Number(r.achievement.toFixed(2))) },
  { header: 'Growth % vs previous month', value: (r) => (r.card.growth === null ? null : Number(r.card.growth.toFixed(2))) },
  { header: 'Month status', value: (r) => STATUS_LABEL[r.card.status] },
  { header: 'Performance category', value: (r) => MATRIX_LABEL[r.category], width: 34 },
];

export function RankingsPage() {
  const { params, update, reset } = usePerfParams();
  const [sp, setSp] = useSearchParams();
  const period = (sp.get('period') as Period) || 'month';
  const { model, isLoading, error, refetch } = usePerfModel({ ...params, manager: undefined });

  const rows = useMemo<RankRow[]>(() => {
    if (!model) return [];
    const cards = managerScorecards(model, params);
    const items = cards.map((c) => ({
      card: c,
      achievement: period === 'month' ? c.achievement : c.ytdAchievement,
      actual: period === 'month' ? c.actual : c.ytdActual,
      target: period === 'month' ? c.target : c.ytdTarget,
    }));
    return rankScorecards(items).map((r: Ranked<(typeof items)[number]>) => ({
      rank: r.rank,
      ...r.item,
      category: matrixCategory(r.item.achievement, r.item.card.growth),
    }));
  }, [model, params, period]);

  const matrix = useMemo(() => {
    const m = new Map<MatrixCategory, RankRow[]>();
    for (const r of rows) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return m;
  }, [rows]);

  return (
    <div>
      <PageHeader
        title="Rankings & performance matrix"
        description="Managers are ranked by achievement against their own target. Managers without a target are listed separately and never top the ranking."
        actions={model ? <ExportMenu name="manager-ranking" rows={rows} columns={COLUMNS} preamble={filterPreamble(model, params, `Manager ranking (${period === 'month' ? 'month' : 'FY to date'})`)} /> : null}
      />
      <PerfNav />
      <PerfFilterBar params={params} update={update} reset={reset} model={model} fields={['fy', 'month', 'zone', 'product', 'place', 'dates']} />
      {error && !model ? (
        <Card>
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !model ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <>
          <NoTargetsNote model={model} />
          <TargetFilterWarning params={params} />
          <Card className="mb-6">
            <CardHeader
              title={period === 'month' ? `Ranking — ${monthLabel(model.month, true)}` : `Ranking — ${fyLabel(model.fy)} to ${monthLabel(model.month, true)}`}
              actions={
                <MetricSwitch
                  label="Period"
                  value={period}
                  onChange={(v) => {
                    const next = new URLSearchParams(sp);
                    next.set('period', v);
                    setSp(next, { replace: true });
                  }}
                  options={[
                    { value: 'month', label: 'Month' },
                    { value: 'ytd', label: 'FY to date' },
                  ]}
                />
              }
            />
            <div className="scroll-thin overflow-x-auto px-2 pb-4 sm:px-5">
              <table className="data-table w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-2 py-2 font-medium">Rank</th>
                    <th className="px-2 py-2 font-medium">Manager</th>
                    <th className="px-2 py-2 font-medium">Zone</th>
                    <th className="px-2 py-2 text-right font-medium">Actual</th>
                    <th className="px-2 py-2 text-right font-medium">Target</th>
                    <th className="px-2 py-2 text-right font-medium">Achievement</th>
                    <th className="px-2 py-2 text-right font-medium">Growth</th>
                    <th className="px-2 py-2 font-medium">Status (month)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.card.key} className={i > 0 && r.rank === null && rows[i - 1].rank !== null ? 'border-t-2 border-line' : 'border-b border-line/60'}>
                      <td className="tabular px-2 py-2 font-semibold">{r.rank ?? <span className="text-xs font-normal text-muted">Not ranked</span>}</td>
                      <td className="px-2 py-2">
                        <Link className="font-medium text-brand hover:underline" to={`/performance/managers/${encodeURIComponent(r.card.key)}?fy=${model.fy}&month=${model.month}`}>
                          {r.card.label}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-muted">{r.card.zone ?? '—'}</td>
                      <td className="tabular px-2 py-2 text-right">{fmtInr(r.actual)}</td>
                      <td className="tabular px-2 py-2 text-right">{r.target === null ? 'Not set' : fmtInr(r.target)}</td>
                      <td className="tabular px-2 py-2 text-right">{fmtPct(r.achievement)}</td>
                      <td className="tabular px-2 py-2 text-right">{r.card.growth === null ? '—' : `${r.card.growth >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(r.card.growth))}`}</td>
                      <td className="px-2 py-2">
                        <StatusBadge status={r.card.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <h2 className="mb-2 text-sm font-semibold text-navy">Performance matrix</h2>
          <p className="mb-3 text-xs text-muted">Achievement against target (above/below 100 %) combined with sales growth versus the previous month.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {(Object.keys(MATRIX_LABEL) as MatrixCategory[]).map((c) => (
              <Card key={c}>
                <CardBody>
                  <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                    <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand">
                      {MATRIX_ICON[c]}
                    </span>
                    {MATRIX_LABEL[c]}
                  </p>
                  <ul className="mt-3 space-y-1 text-sm">
                    {(matrix.get(c) ?? []).map((r) => (
                      <li key={r.card.key} className="flex justify-between gap-2">
                        <span>{r.card.label}</span>
                        <span className="tabular text-xs text-muted">{r.achievement === null ? fmtInr(r.actual) : fmtPct(r.achievement)}</span>
                      </li>
                    ))}
                    {!(matrix.get(c) ?? []).length && <li className="text-xs text-muted">None</li>}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
