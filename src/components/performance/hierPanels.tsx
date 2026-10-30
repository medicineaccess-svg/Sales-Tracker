import { Link } from 'react-router-dom';
import { ChevronRight, UserRound } from 'lucide-react';
import { ChartCard } from '@/components/dashboard/charts';
import { SERIES } from '@/lib/format';
import { monthlyStats, type CompanyTree } from '@/lib/salesHierarchy';
import { fmtInr, fmtInrShort, fmtPct, growthText, monthLabel, MonthlyBarChart, MonthlyTrendChart, StatTile } from './hierUi';

/**
 * One card per manager: individual achievement = own sales + HO sales named for the manager.
 * `fyTree` supplies the monthly figures (best month, last-month growth) for the whole FY.
 */
export function ManagerCards({
  tree,
  fyTree,
  months,
  upTo,
  hrefFor,
}: {
  tree: CompanyTree;
  fyTree: CompanyTree;
  months: string[];
  upTo: string | null;
  hrefFor: (managerKey: string) => string;
}) {
  if (!tree.managers.length) return <p className="rounded-2xl border border-line/70 bg-card p-5 text-sm text-muted">No manager sales in this period.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tree.managers.map((m) => {
        const fy = fyTree.managers.find((x) => x.key === m.key);
        const st = fy ? monthlyStats(months, fy.monthly, upTo) : null;
        const last = st?.points.filter((p) => upTo && p.month <= upTo).slice(-1)[0];
        const ownPct = m.total ? (m.own / m.total) * 100 : 0;
        const share = tree.total ? (m.total / tree.total) * 100 : 0;
        return (
          <Link
            key={m.key}
            to={hrefFor(m.key)}
            className="group rounded-2xl border border-line/70 bg-card p-4 shadow-card transition-[border-color,box-shadow] hover:border-accent/60 hover:shadow-lift focus-visible:outline-2 focus-visible:outline-brand"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sidebar text-white">
                  <UserRound className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-navy">{m.label}</p>
                  <p className="truncate text-xs text-muted">{m.zones.join(', ') || 'Zone not stated'}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
            </div>
            <p className="tabular mt-3 text-2xl font-bold tracking-tight text-navy" title={fmtInr(m.total)}>
              {fmtInrShort(m.total)}
            </p>
            <p className="text-xs text-muted">
              {m.records} sale(s) · {fmtPct(share)} of company
            </p>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-line/60" aria-hidden>
              <span style={{ width: `${ownPct}%`, background: SERIES[0] }} />
              <span style={{ width: `${100 - ownPct}%`, background: SERIES[1] }} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: SERIES[0] }} />
                <dt className="text-muted">Own</dt>
                <dd className="tabular ml-auto font-medium text-ink">{fmtInrShort(m.own)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: SERIES[1] }} />
                <dt className="text-muted">HO</dt>
                <dd className="tabular ml-auto font-medium text-ink">{fmtInrShort(m.ho)}</dd>
              </div>
            </dl>
            {st && st.highest && (
              <p className="mt-2 border-t border-line/60 pt-2 text-[11px] text-muted">
                Best month {monthLabel(st.highest.month)} ({fmtInrShort(st.highest.value)})
                {last && ` · ${monthLabel(last.month)} ${growthText(last.growth)}`}
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** KPI cards + month-wise bar chart + trend line + growth table for one person or node. */
export function MonthlyPanel({
  title,
  months,
  values,
  upTo,
  onSelectMonth,
}: {
  title: string;
  months: string[];
  values: number[];
  upTo: string | null;
  onSelectMonth?: (m: string) => void;
}) {
  const st = monthlyStats(months, values, upTo);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total sales" value={fmtInrShort(st.total)} title={fmtInr(st.total)} sub={`${months.length ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}` : ''}`} />
        <StatTile label="Average monthly sales" value={fmtInrShort(st.average)} title={fmtInr(st.average)} sub={st.monthsCounted ? `Over ${st.monthsCounted} month(s) to ${monthLabel(upTo!)}` : 'No months yet'} />
        <StatTile label="Highest month" value={st.highest ? monthLabel(st.highest.month, true) : '—'} sub={st.highest ? fmtInr(st.highest.value) : undefined} />
        <StatTile label="Lowest month" value={st.lowest ? monthLabel(st.lowest.month, true) : '—'} sub={st.lowest ? fmtInr(st.lowest.value) : undefined} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={`Month-wise sales — ${title}`}
          description={onSelectMonth ? 'Click a bar to filter that month.' : 'April to March. Highest and lowest months are labelled.'}
          table={{ columns: ['Month', 'Sales', 'vs previous month'], rows: st.points.map((p) => [monthLabel(p.month, true), fmtInr(p.value), growthText(p.growth)]) }}
        >
          <MonthlyBarChart months={months} values={values} upTo={upTo} onSelect={onSelectMonth} />
        </ChartCard>
        <ChartCard title={`Monthly trend — ${title}`} description="Dashed line = average monthly sales.">
          <MonthlyTrendChart months={months} values={values} upTo={upTo} />
        </ChartCard>
      </div>
      <div className="scroll-thin overflow-x-auto rounded-2xl border border-line/70 bg-card shadow-card">
        <table className="data-table w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-3 py-2 font-medium">Month</th>
              {st.points.map((p) => (
                <th key={p.month} className="px-2 py-2 text-right font-medium">
                  {monthLabel(p.month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/60">
              <td className="px-3 py-1.5 font-medium">Sales</td>
              {st.points.map((p) => (
                <td key={p.month} className="tabular px-2 py-1.5 text-right">
                  {upTo && p.month > upTo ? '—' : fmtInrShort(p.value)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-3 py-1.5 font-medium">Growth</td>
              {st.points.map((p) => (
                <td key={p.month} className={`tabular px-2 py-1.5 text-right ${p.growth === null ? 'text-muted' : p.growth >= 0 ? 'text-success' : 'text-danger'}`}>
                  {growthText(p.growth)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
