import { useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Table2 } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { CURRENCY_COLOR, CURRENCY_LABEL, CURRENCY_ORDER, SERIES, SERIES_OTHER, formatInrShort, formatMoney, formatMonth, formatNumber } from '@/lib/format';
import type { CurrencyBucket, DashboardData, GroupTotals } from '@/types/database';
import { cn } from '@/lib/utils';

const AXIS = { fontSize: 11, fill: '#55606c' };
const GRID = '#ece6db';
const CURSOR = 'rgba(34,97,146,0.07)';

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

export function ChartCard({
  title,
  description,
  loading,
  empty,
  actions,
  table,
  height = 300,
  className,
  footer,
  children,
}: {
  footer?: ReactNode;
  title: string;
  description?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  actions?: ReactNode;
  table?: TableView;
  height?: number;
  className?: string;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      <CardHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            {table && !empty && (
              <button
                type="button"
                onClick={() => setShowTable((s) => !s)}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-accent-50 hover:text-accent-700"
                aria-label={showTable ? 'Show chart' : 'Show data table'}
                title={showTable ? 'Show chart' : 'Show data table'}
              >
                {showTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
              </button>
            )}
          </>
        }
      />
      <div className="flex-1 px-3 pb-4 pt-3 sm:px-5" style={{ minHeight: height }}>
        {loading ? (
          <Skeleton className="h-[260px] w-full rounded-xl" />
        ) : empty ? (
          <EmptyState title="No data for these filters" description="Adjust or reset the filters to see results." className="py-10" />
        ) : showTable && table ? (
          <div className="scroll-thin max-h-[340px] overflow-auto">
            <table className="data-table w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-line text-left text-muted">
                  {table.columns.map((c, i) => (
                    <th key={c} className={cn('px-2 py-2 font-medium', i > 0 && 'text-right')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/60">
                    {r.map((c, j) => (
                      <td key={j} className={cn('tabular px-2 py-1.5', j > 0 && 'text-right')}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height }} className="animate-[fadeIn_0.4s_ease-out]">
            {children}
          </div>
        )}
        {footer && !loading && !empty && footer}
      </div>
    </Card>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-xl border border-line bg-card/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      <p className="mb-1 font-semibold text-navy">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="tabular font-medium text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

const shortMoney = (v: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

// ---------------------------------------------------------------------------
// Monthly per-currency bars (Sales value or Shipping) — currencies never mixed
// ---------------------------------------------------------------------------

export function useMonthlyByCurrency(monthly: DashboardData['monthly'] | undefined, metric: 'value' | 'shipping') {
  return useMemo(() => {
    const months = [...new Set((monthly ?? []).map((m) => m.month))].sort();
    const currencies = CURRENCY_ORDER.filter((c) => (monthly ?? []).some((m) => m.currency === c && Number(m[metric]) > 0));
    const data = months.map((month) => {
      const row: Record<string, number | string> = { month, label: formatMonth(month) };
      for (const c of currencies) {
        const m = (monthly ?? []).find((x) => x.month === month && x.currency === c);
        row[c] = m ? Number(m[metric]) : 0;
      }
      return row;
    });
    return { data, currencies };
  }, [monthly, metric]);
}

export function MonthlyCurrencyBars({
  monthly,
  metric,
}: {
  monthly: DashboardData['monthly'];
  metric: 'value' | 'shipping';
}) {
  const { data, currencies } = useMonthlyByCurrency(monthly, metric);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={shortMoney} width={48} />
        <Tooltip
          cursor={{ fill: CURSOR }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={String(label)}
                rows={payload.map((p) => ({
                  label: CURRENCY_LABEL[p.dataKey as CurrencyBucket],
                  value: formatMoney(Number(p.value), p.dataKey as CurrencyBucket),
                  color: CURRENCY_COLOR[p.dataKey as CurrencyBucket],
                }))}
              />
            ) : null
          }
        />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(v) => CURRENCY_LABEL[v as CurrencyBucket]} />
        {currencies.map((c) => (
          <Bar key={c} dataKey={c} fill={CURRENCY_COLOR[c]} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={600} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function monthlyCurrencyTable(monthly: DashboardData['monthly'], metric: 'value' | 'shipping'): TableView {
  const months = [...new Set(monthly.map((m) => m.month))].sort();
  const currencies = CURRENCY_ORDER.filter((c) => monthly.some((m) => m.currency === c));
  return {
    columns: ['Month', ...currencies.map((c) => CURRENCY_LABEL[c])],
    rows: months.map((month) => [
      formatMonth(month),
      ...currencies.map((c) => {
        const m = monthly.find((x) => x.month === month && x.currency === c);
        return m ? formatMoney(m[metric], c) : '—';
      }),
    ]),
  };
}

// ---------------------------------------------------------------------------
// Monthly INR (all currencies, source-reported INR Value) — bars or line
// ---------------------------------------------------------------------------

export function useMonthlyInr(monthly: DashboardData['monthly'] | undefined) {
  return useMemo(() => {
    const map = new Map<string, { inr: number; records: number }>();
    for (const m of monthly ?? []) {
      const cur = map.get(m.month) ?? { inr: 0, records: 0 };
      cur.inr += Number(m.inr_value);
      cur.records += Number(m.records);
      map.set(m.month, cur);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, label: formatMonth(month), ...v }));
  }, [monthly]);
}

export function MonthlyInrBars({ monthly }: { monthly: DashboardData['monthly'] }) {
  const data = useMonthlyInr(monthly);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => formatInrShort(v).replace('₹', '')} width={56} />
        <Tooltip
          cursor={{ fill: CURSOR }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={String(label)}
                rows={[
                  { label: 'INR Value', value: formatMoney(Number(payload[0].payload.inr), 'INR'), color: SERIES[0] },
                  { label: 'Records', value: formatNumber(payload[0].payload.records) },
                ]}
              />
            ) : null
          }
        />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="inr" name="INR Value (source-reported)" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={40} animationDuration={600} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({ monthly, metric }: { monthly: DashboardData['monthly']; metric: 'inr' | 'records' }) {
  const data = useMonthlyInr(monthly);
  const color = metric === 'inr' ? SERIES[0] : SERIES[3];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`trend-fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => (metric === 'inr' ? formatInrShort(v).replace('₹', '') : formatNumber(v))}
        />
        <Tooltip
          cursor={{ stroke: '#b9ae9c', strokeDasharray: '4 4' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={String(label)}
                rows={[
                  { label: 'INR Value', value: formatMoney(Number(payload[0].payload.inr), 'INR'), color: metric === 'inr' ? color : undefined },
                  { label: 'Records', value: formatNumber(payload[0].payload.records), color: metric === 'records' ? color : undefined },
                ]}
              />
            ) : null
          }
        />
        <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey={metric}
          name={metric === 'inr' ? 'INR Value (source-reported)' : 'Records'}
          stroke={color}
          strokeWidth={2.5}
          fill={`url(#trend-fill-${metric})`}
          dot={{ r: 3.5, strokeWidth: 2, fill: '#fbfaf7', stroke: color }}
          activeDot={{ r: 6, strokeWidth: 2, fill: '#ef8557', stroke: '#fbfaf7' }}
          animationDuration={900}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Category breakdowns (product / manager / hospital …)
// ---------------------------------------------------------------------------

export type BreakdownMetric = 'inr_value' | 'value_usd' | 'value_eur' | 'records';

export const METRIC_LABEL: Record<BreakdownMetric, string> = {
  inr_value: 'INR Value (source-reported)',
  value_usd: 'Sales value · USD',
  value_eur: 'Sales value · EUR',
  records: 'Number of records',
};

export function formatMetric(v: number, metric: BreakdownMetric) {
  if (metric === 'inr_value') return formatMoney(v, 'INR');
  if (metric === 'value_usd') return formatMoney(v, 'USD');
  if (metric === 'value_eur') return formatMoney(v, 'EUR');
  return formatNumber(v);
}

export function BreakdownBars({ rows, metric, color = SERIES[0] }: { rows: GroupTotals[]; metric: BreakdownMetric; color?: string }) {
  const data = useMemo(
    () => [...rows].map((r) => ({ ...r, metric: Number(r[metric]) })).filter((r) => r.metric > 0).sort((a, b) => b.metric - a.metric),
    [rows, metric],
  );
  if (!data.length) return <EmptyState title="Nothing to show for this metric" className="py-10" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }} barCategoryGap="24%">
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => (metric === 'inr_value' ? formatInrShort(v).replace('₹', '') : metric === 'records' ? formatNumber(v) : shortMoney(v))}
        />
        <YAxis
          type="category"
          dataKey="key"
          tick={{ ...AXIS, fill: '#1e2a36' }}
          tickLine={false}
          axisLine={false}
          width={140}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
        />
        <Tooltip
          cursor={{ fill: CURSOR }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={payload[0].payload.key}
                rows={[
                  { label: METRIC_LABEL[metric], value: formatMetric(payload[0].payload.metric, metric), color },
                  ...(metric !== 'records' ? [{ label: 'Records', value: formatNumber(payload[0].payload.records) }] : []),
                  ...(metric !== 'inr_value' ? [{ label: 'INR Value', value: formatMoney(payload[0].payload.inr_value, 'INR') }] : []),
                ]}
              />
            ) : null
          }
        />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="metric" name={METRIC_LABEL[metric]} fill={color} radius={[0, 6, 6, 0]} maxBarSize={22} animationDuration={700} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function breakdownTable(rows: GroupTotals[], metric: BreakdownMetric, keyLabel: string): TableView {
  return {
    columns: [keyLabel, METRIC_LABEL[metric], 'Records'],
    rows: [...rows]
      .sort((a, b) => Number(b[metric]) - Number(a[metric]))
      .map((r) => [r.key, formatMetric(Number(r[metric]), metric), formatNumber(r.records)]),
  };
}

export function ContributionDonut({ rows, metric, maxSlices = 7 }: { rows: GroupTotals[]; metric: 'inr_value' | 'records'; maxSlices?: number }) {
  const data = useMemo(() => {
    const sorted = [...rows].map((r) => ({ name: r.key, value: Number(r[metric]) })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const head = sorted.slice(0, maxSlices);
    const tail = sorted.slice(maxSlices).reduce((s, r) => s + r.value, 0);
    return tail > 0 ? [...head, { name: 'Other', value: tail }] : head;
  }, [rows, metric, maxSlices]);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length) return <EmptyState title="Nothing to show" className="py-10" />;
  return (
    <div className="flex h-full flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-56 sm:h-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={1} stroke="#fbfaf7" strokeWidth={2} animationDuration={800} animationEasing="ease-out">
              {data.map((d, i) => (
                <Cell key={d.name} fill={d.name === 'Other' ? SERIES_OTHER : SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={String(payload[0].name)}
                    rows={[
                      { label: metric === 'inr_value' ? 'INR Value' : 'Records', value: metric === 'inr_value' ? formatMoney(Number(payload[0].value), 'INR') : formatNumber(Number(payload[0].value)) },
                      { label: 'Share', value: `${((Number(payload[0].value) / total) * 100).toFixed(1)}%` },
                    ]}
                  />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-xs sm:w-1/2">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.name === 'Other' ? SERIES_OTHER : SERIES[i % SERIES.length] }} />
              <span className="truncate text-ink">{d.name}</span>
            </span>
            <span className="tabular shrink-0 text-muted">
              {metric === 'inr_value' ? formatInrShort(d.value) : formatNumber(d.value)} · <span className="font-semibold text-ink">{((d.value / total) * 100).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MetricSwitch<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all duration-200',
            value === o.value ? 'bg-card text-navy shadow-sm ring-1 ring-accent/50' : 'text-muted hover:text-navy',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
