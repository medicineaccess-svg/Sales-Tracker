import type { ReactNode } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '@/components/ui/feedback';
import { SERIES, SERIES_OTHER, formatMoney } from '@/lib/format';
import { fmtPct } from './PerfUi';

const AXIS = { fontSize: 11, fill: '#55606c' };
const GRID = '#ece6db';
const CURSOR = 'rgba(34,97,146,0.07)';
const ACTUAL = SERIES[0];
const TARGET = SERIES[1];
const POS = '#1d7d4f';
const NEG = '#c8372d';

const compact = (v: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const inr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoney(v, 'INR'));

function Box({ title, rows }: { title: string; rows: { label: string; value: string; color?: string; dashed?: boolean }[] }) {
  return (
    <div className="rounded-xl border border-line bg-card/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      <p className="mb-1 font-semibold text-navy">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            {r.color && (
              <span
                className="h-2 w-2 rounded-sm"
                style={r.dashed ? { border: `1.5px dashed ${r.color}` } : { background: r.color }}
              />
            )}
            {r.label}
          </span>
          <span className="tabular font-medium text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export interface MonthPoint {
  label: string;
  actual: number;
  target: number | null;
  achievement: number | null;
  growth: number | null;
  cumActual: number;
  cumTarget: number | null;
}

const legendFmt = (v: string) => <span className="text-xs text-ink">{v}</span>;

/** Actual as bars, monthly target as a dashed step line on the same ₹ axis. */
export function TargetVsActualChart({ data }: { data: MonthPoint[] }) {
  if (!data.some((d) => d.actual > 0 || d.target)) return <EmptyState title="No sales or targets in this period" className="py-10" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={52} />
        <Tooltip
          cursor={{ fill: CURSOR }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as MonthPoint;
            return (
              <Box
                title={String(label)}
                rows={[
                  { label: 'Actual', value: inr(d.actual), color: ACTUAL },
                  { label: 'Target', value: d.target === null ? 'Not set' : inr(d.target), color: TARGET, dashed: true },
                  { label: 'Achievement', value: fmtPct(d.achievement) },
                ]}
              />
            );
          }}
        />
        <Legend formatter={legendFmt} iconSize={10} />
        <Bar name="Actual" dataKey="actual" fill={ACTUAL} radius={[4, 4, 0, 0]} maxBarSize={36} animationDuration={700} />
        <Line
          name="Target"
          dataKey="target"
          type="step"
          stroke={TARGET}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3, fill: TARGET, strokeWidth: 0 }}
          connectNulls={false}
          animationDuration={700}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function AchievementTrendChart({ data }: { data: MonthPoint[] }) {
  if (!data.some((d) => d.achievement !== null)) {
    return <EmptyState title="Achievement needs monthly targets" description="Enter targets on the Targets page to see the trend." className="py-10" />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={48} />
        <ReferenceLine y={100} stroke="#55606c" strokeDasharray="3 3" label={{ value: '100% target', position: 'insideTopRight', fontSize: 10, fill: '#55606c' }} />
        <Tooltip
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <Box title={String(label)} rows={[{ label: 'Achievement', value: fmtPct((payload[0].payload as MonthPoint).achievement), color: ACTUAL }]} />
            ) : null
          }
        />
        <Line dataKey="achievement" name="Achievement %" stroke={ACTUAL} strokeWidth={2} dot={{ r: 4, fill: ACTUAL, stroke: '#fbfaf7', strokeWidth: 2 }} connectNulls={false} animationDuration={700} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CumulativeChart({ data }: { data: MonthPoint[] }) {
  if (!data.some((d) => d.cumActual > 0 || d.cumTarget)) return <EmptyState title="Nothing to accumulate yet" className="py-10" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={52} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as MonthPoint;
            return (
              <Box
                title={`${label} (cumulative)`}
                rows={[
                  { label: 'Actual', value: inr(d.cumActual), color: ACTUAL },
                  { label: 'Target', value: d.cumTarget === null ? 'Not set' : inr(d.cumTarget), color: TARGET, dashed: true },
                ]}
              />
            );
          }}
        />
        <Legend formatter={legendFmt} iconSize={10} />
        <Line name="Cumulative actual" dataKey="cumActual" stroke={ACTUAL} strokeWidth={2} dot={false} animationDuration={700} />
        <Line name="Cumulative target" dataKey="cumTarget" stroke={TARGET} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} animationDuration={700} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GrowthChart({ data }: { data: MonthPoint[] }) {
  if (!data.some((d) => d.growth !== null)) return <EmptyState title="Growth needs two consecutive months with sales" className="py-10" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={48} />
        <ReferenceLine y={0} stroke="#55606c" />
        <Tooltip
          cursor={{ fill: CURSOR }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const g = (payload[0].payload as MonthPoint).growth;
            return <Box title={String(label)} rows={[{ label: 'Growth vs previous month', value: g === null ? 'n/a' : `${g >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(g))}` }]} />;
          }}
        />
        <Bar dataKey="growth" name="Growth %" radius={[4, 4, 4, 4]} maxBarSize={32} animationDuration={700}>
          {data.map((d) => (
            <Cell key={d.label} fill={(d.growth ?? 0) >= 0 ? POS : NEG} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Semicircle gauge. Values above 100 % fill the arc and are stated in the label. */
export function AchievementGauge({ value, caption }: { value: number | null; caption?: ReactNode }) {
  if (value === null) {
    return <EmptyState title="Target not set" description="Achievement cannot be calculated without a monthly target." className="py-8" />;
  }
  const shown = Math.max(0, Math.min(value, 100));
  const data = [
    { name: 'achieved', v: shown },
    { name: 'rest', v: 100 - shown },
  ];
  const color = value >= 100 ? POS : ACTUAL;
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="v" startAngle={180} endAngle={0} cy="78%" innerRadius="70%" outerRadius="100%" stroke="none" animationDuration={800} isAnimationActive>
            <Cell fill={color} />
            <Cell fill="#ece6db" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 bottom-[14%] text-center">
        <p className="tabular text-3xl font-bold text-navy">{fmtPct(value)}</p>
        {caption && <p className="text-xs text-muted">{caption}</p>}
      </div>
    </div>
  );
}

export interface Slice {
  name: string;
  value: number;
  highlight?: boolean;
}

/** Contribution donut with a legend list (shares of the total). */
export function ContributionChart({ slices }: { slices: Slice[] }) {
  const data = slices.filter((s) => s.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <EmptyState title="No sales to compare" className="py-10" />;
  // Orange is reserved for the highlighted entity; the others take the remaining hues in fixed order.
  const rest = SERIES.filter((_, i) => i !== 1);
  let n = 0;
  const colors = data.map((s) => (s.highlight ? SERIES[1] : s.name === 'Other' ? SERIES_OTHER : rest[Math.min(n++, rest.length - 1)]));
  const colorOf = (i: number, _s: Slice) => colors[i];
  return (
    <div className="flex h-full flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-52 sm:h-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={1} stroke="#fbfaf7" strokeWidth={2} animationDuration={800}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={colorOf(i, d)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <Box
                    title={String(payload[0].name)}
                    rows={[
                      { label: 'INR Value', value: inr(Number(payload[0].value)) },
                      { label: 'Share', value: fmtPct((Number(payload[0].value) / total) * 100) },
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
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorOf(i, d) }} />
              <span className={d.highlight ? 'truncate font-semibold text-ink' : 'truncate text-ink'}>{d.name}</span>
            </span>
            <span className="tabular shrink-0 text-muted">
              {fmtPct((d.value / total) * 100)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Grouped bars for several entities (compare page). Colour follows the entity, never its rank. */
export function GroupedBars({
  data,
  keys,
  colors,
  percent,
}: {
  data: Record<string, number | string | null>[];
  keys: { key: string; label: string }[];
  colors: Record<string, string>;
  percent?: boolean;
}) {
  if (!data.length) return <EmptyState title="Nothing to compare" className="py-10" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={percent ? (v) => `${v}%` : compact} width={52} />
        {percent && <ReferenceLine y={100} stroke="#55606c" strokeDasharray="3 3" />}
        <Tooltip
          cursor={{ fill: CURSOR }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <Box
                title={String(label)}
                rows={payload.map((p) => ({
                  label: String(p.name),
                  value: p.value === null || p.value === undefined ? (percent ? 'Target not set' : '—') : percent ? fmtPct(Number(p.value)) : inr(Number(p.value)),
                  color: String(p.color),
                }))}
              />
            ) : null
          }
        />
        <Legend formatter={legendFmt} iconSize={10} />
        {keys.map((k) => (
          <Bar key={k.key} name={k.label} dataKey={k.key} fill={colors[k.key]} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={700} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
