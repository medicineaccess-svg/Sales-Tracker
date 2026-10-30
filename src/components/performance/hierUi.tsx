import { useCallback, useMemo, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Clock, Download, FileSpreadsheet, Printer, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/feedback';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown';
import { usePerformance } from '@/hooks/useData';
import { downloadCsv, downloadXlsx, stamp, type ExportColumn } from '@/lib/export';
import { notify } from '@/lib/errors';
import { SERIES, formatDateTime, formatInrShort, formatMoney } from '@/lib/format';
import { fyLabel, fyMonths, fyStartYear, latestDataMonth, todayIso } from '@/lib/performance';
import { buildTree, monthlyStats, type CompanyTree, type HierFact } from '@/lib/salesHierarchy';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (m: string, long = false) => {
  const [y, mo] = m.split('-').map(Number);
  return long ? `${MONTHS[mo - 1]} ${y}` : `${MONTHS[mo - 1]} ${String(y).slice(2)}`;
};
export const fmtInr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoney(v, 'INR'));
export const fmtInrShort = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatInrShort(v));
export const fmtPct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}%`);
export const growthText = (g: number | null) => (g === null ? '—' : `${g >= 0 ? '▲' : '▼'} ${Math.abs(g).toFixed(1)}%`);

// ---------------------------------------------------------------------------
// URL filters: Financial Year, Month, Manager, HO (sales type), Zone
// ---------------------------------------------------------------------------

export type SalesTypeFilter = 'own' | 'ho' | 'third_party';
export const SALES_TYPE_LABEL: Record<SalesTypeFilter, string> = {
  own: 'Manager’s own sales',
  ho: 'HO sales (credited to a manager)',
  third_party: 'HO (Third Party)',
};

export interface HierParams {
  fy?: number;
  month?: string; // YYYY-MM-01
  manager?: string; // credited manager key
  type?: SalesTypeFilter;
  zone?: string;
}

const KEYS = ['fy', 'month', 'manager', 'type', 'zone'] as const;

export function useHierParams() {
  const [sp, setSp] = useSearchParams();
  const params = useMemo<HierParams>(() => {
    const p: HierParams = {};
    for (const k of KEYS) {
      const v = sp.get(k);
      if (!v) continue;
      if (k === 'fy') p.fy = Number(v);
      else (p as Record<string, string>)[k] = v;
    }
    return p;
  }, [sp]);
  const update = useCallback(
    (patch: Partial<HierParams>) => {
      const next = new URLSearchParams(sp);
      for (const [k, v] of Object.entries(patch)) (v === undefined || v === '' ? next.delete(k) : next.set(k, String(v)));
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );
  const reset = useCallback(() => {
    const next = new URLSearchParams(sp);
    for (const k of KEYS) next.delete(k);
    setSp(next, { replace: true });
  }, [sp, setSp]);
  return { params, update, reset, search: sp };
}

const matchType = (f: HierFact, t?: SalesTypeFilter) =>
  !t || (t === 'own' ? f.channel === 'individual' : t === 'ho' ? f.channel === 'ho' : f.channel === 'ho_third_party');

export interface HierModel {
  today: string;
  fy: number;
  fyOptions: number[];
  months: string[];
  latestMonth: string | null;
  /** Last month counted in averages / highest / lowest */
  upTo: string | null;
  /** Facts of the FY after Manager / HO / Zone filters (all months) */
  fyFacts: HierFact[];
  /** Facts of the selected period (FY, or one month when a month is chosen) */
  periodFacts: HierFact[];
  tree: CompanyTree; // period
  fyTree: CompanyTree; // whole FY (monthly arrays)
  allFacts: HierFact[];
  managers: { key: string; label: string }[];
  zones: string[];
  generatedAt: string;
  lastSync: string | null;
}

export function useHierModel(params: HierParams) {
  const q = usePerformance({});
  const model = useMemo<HierModel | null>(() => {
    if (!q.data) return null;
    const facts = q.data.facts as HierFact[];
    const today = todayIso();
    const latest = latestDataMonth(facts, today);
    const fy = params.fy ?? fyStartYear(params.month ?? latest ?? today);
    const months = fyMonths(fy);
    const filtered = facts.filter(
      (f) =>
        (!params.manager || f.owner_key === params.manager) && matchType(f, params.type) && (!params.zone || f.zone === params.zone),
    );
    const fyFacts = filtered.filter((f) => months.includes(f.month));
    const periodFacts = params.month ? fyFacts.filter((f) => f.month === params.month) : fyFacts;
    const fySet = new Set<number>([fyStartYear(today)]);
    for (const f of facts) fySet.add(fyStartYear(f.month));
    const mgr = new Map<string, string>();
    for (const f of facts) if (f.owner_key) mgr.set(f.owner_key, f.owner_label ?? f.owner_key);
    const lastFyMonth = months[11];
    const upTo = latest ? (latest < months[0] ? null : latest > lastFyMonth ? lastFyMonth : latest) : null;
    const sync = q.data.last_sync;
    return {
      today,
      fy,
      fyOptions: [...fySet].sort((a, b) => b - a),
      months,
      latestMonth: latest,
      upTo,
      fyFacts,
      periodFacts,
      tree: buildTree(periodFacts, months),
      fyTree: buildTree(fyFacts, months),
      allFacts: facts,
      managers: [...mgr.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
      zones: [...new Set(facts.map((f) => f.zone).filter(Boolean) as string[])].sort(),
      generatedAt: q.data.generated_at,
      lastSync: sync ? (sync.finished_at ?? sync.started_at) : null,
    };
  }, [q.data, params.fy, params.month, params.manager, params.type, params.zone]);
  return { ...q, model };
}

export function periodLabel(model: HierModel, params: HierParams) {
  return params.month ? monthLabel(params.month, true) : fyLabel(model.fy);
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type Field = 'fy' | 'month' | 'manager' | 'type' | 'zone';

export function HierFilterBar({
  params,
  update,
  reset,
  model,
  fields = ['fy', 'month', 'manager', 'type', 'zone'],
}: {
  params: HierParams;
  update: (p: Partial<HierParams>) => void;
  reset: () => void;
  model: HierModel | null;
  fields?: Field[];
}) {
  const has = (f: Field) => fields.includes(f);
  const lbl = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted';
  const active = KEYS.filter((k) => params[k] !== undefined).length;
  return (
    <div className="no-print mb-5 rounded-2xl border border-line/70 bg-card p-4 shadow-card">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {has('fy') && (
          <label>
            <span className={lbl}>Financial year</span>
            <Select className="h-9 text-xs" value={model?.fy ?? ''} onChange={(e) => update({ fy: Number(e.target.value) || undefined, month: undefined })}>
              {(model?.fyOptions ?? []).map((y) => (
                <option key={y} value={y}>
                  {fyLabel(y)}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('month') && (
          <label>
            <span className={lbl}>Month</span>
            <Select className="h-9 text-xs" value={params.month ?? ''} onChange={(e) => update({ month: e.target.value || undefined, fy: model?.fy })}>
              <option value="">All months</option>
              {(model?.months ?? []).map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, true)}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('manager') && (
          <label>
            <span className={lbl}>Manager</span>
            <Select className="h-9 text-xs" value={params.manager ?? ''} onChange={(e) => update({ manager: e.target.value || undefined })}>
              <option value="">All managers</option>
              {(model?.managers ?? []).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('type') && (
          <label>
            <span className={lbl}>HO</span>
            <Select className="h-9 text-xs" value={params.type ?? ''} onChange={(e) => update({ type: (e.target.value || undefined) as SalesTypeFilter | undefined })}>
              <option value="">Own + HO sales</option>
              {(Object.keys(SALES_TYPE_LABEL) as SalesTypeFilter[]).map((t) => (
                <option key={t} value={t}>
                  {SALES_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('zone') && (
          <label>
            <span className={lbl}>Zone</span>
            <Select className="h-9 text-xs" value={params.zone ?? ''} onChange={(e) => update({ zone: e.target.value || undefined })}>
              <option value="">All zones</option>
              {(model?.zones ?? []).map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          </label>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>All figures are the sheet’s INR Value. The sheet has no BD Person column, so the lowest level is the individual sale.</span>
        {active > 0 && (
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset filters ({active})
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

export function PerfNav() {
  const [sp] = useSearchParams();
  const path = useLocation().pathname;
  const keep = new URLSearchParams();
  for (const k of KEYS) if (sp.get(k)) keep.set(k, sp.get(k)!);
  const qs = keep.toString() ? `?${keep}` : '';
  const items: [string, string][] = [
    ['/performance', 'Overview'],
    ['/performance/drill', 'Drill-down'],
    ['/performance/report', 'Monthly report'],
  ];
  return (
    <nav aria-label="Sales performance sections" className="no-print scroll-thin mb-4 flex gap-1 overflow-x-auto">
      {items.map(([to, label]) => {
        const active = to === '/performance' ? path === to : path.startsWith(to);
        return (
          <Link
            key={to}
            to={`${to}${qs}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
              active ? 'bg-sidebar text-white' : 'text-muted hover:bg-accent-50 hover:text-navy',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function LastRefresh({ model, isFetching, onRefresh }: { model: HierModel | null; isFetching?: boolean; onRefresh?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Clock className="h-3.5 w-3.5" aria-hidden />
      <span>
        Data refreshed {formatDateTime(model?.generatedAt)}
        {model?.lastSync && ` · last sheet sync ${formatDateTime(model.lastSync)}`}
        {model?.latestMonth && ` · latest sales month ${monthLabel(model.latestMonth, true)}`}
      </span>
      {onRefresh && (
        <button type="button" className="no-print font-medium text-brand hover:underline" onClick={onRefresh} disabled={isFetching}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    </div>
  );
}

export function StatTile({ label, value, sub, title }: { label: string; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div title={title} className="min-w-0 rounded-2xl border border-line/70 bg-card p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="tabular mt-1 truncate text-xl font-bold tracking-tight text-navy">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function ExportMenu<T>({ name, rows, columns, preamble }: { name: string; rows: T[]; columns: ExportColumn<T>[]; preamble: string[] }) {
  const file = `${name}-${stamp()}`;
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="outline" size="sm" className="no-print" disabled={!rows.length}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Export
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownItem onSelect={() => downloadCsv(`${file}.csv`, rows, columns, preamble)}>
          <Download className="h-4 w-4" aria-hidden /> CSV
        </DropdownItem>
        <DropdownItem onSelect={() => downloadXlsx(`${file}.xlsx`, name, rows, columns, preamble).catch(() => notify.error('Excel export failed. Try CSV instead.'))}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
        </DropdownItem>
        <DropdownItem onSelect={() => setTimeout(() => window.print(), 50)}>
          <Printer className="h-4 w-4" aria-hidden /> Print / PDF
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

export function preamble(model: HierModel, params: HierParams, title: string): string[] {
  const f: string[] = [];
  if (params.manager) f.push(`Manager: ${model.managers.find((m) => m.key === params.manager)?.label ?? params.manager}`);
  if (params.type) f.push(`HO: ${SALES_TYPE_LABEL[params.type]}`);
  if (params.zone) f.push(`Zone: ${params.zone}`);
  return [
    `Ikris Pharma Network — ${title}`,
    `${periodLabel(model, params)} · generated ${formatDateTime(model.generatedAt)}`,
    f.length ? `Filters: ${f.join('; ')}` : 'Filters: none',
    'Amounts: sheet INR Value (₹). Manager total = own sales + HO sales named for the manager in the Zone column.',
  ];
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const AXIS = { fontSize: 11, fill: '#55606c' };
const GRID = '#ece6db';
const CURSOR = 'rgba(34,97,146,0.07)';
const compact = (v: number) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

function Tip({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-xl border border-line bg-card/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      <p className="mb-1 font-semibold text-navy">{title}</p>
      {rows.map(([k, v]) => (
        <p key={k} className="flex justify-between gap-4">
          <span className="text-muted">{k}</span>
          <span className="tabular font-medium text-ink">{v}</span>
        </p>
      ))}
    </div>
  );
}

interface MonthDatum {
  label: string;
  month: string;
  value: number;
  growth: number | null;
  tag: string;
}

function toData(months: string[], values: number[], upTo: string | null): MonthDatum[] {
  const st = monthlyStats(months, values, upTo);
  return st.points.map((p) => ({
    label: monthLabel(p.month),
    month: p.month,
    value: p.value,
    growth: p.growth,
    tag: st.highest?.month === p.month && p.value > 0 ? 'Highest' : st.lowest?.month === p.month && st.monthsCounted > 1 ? 'Lowest' : '',
  }));
}

/** Month-wise bars (April → March). Highest / lowest months are labelled in text, not colour alone. */
export function MonthlyBarChart({ months, values, upTo, onSelect }: { months: string[]; values: number[]; upTo: string | null; onSelect?: (m: string) => void }) {
  const data = toData(months, values, upTo);
  if (!values.some((v) => v > 0)) return <EmptyState title="No sales in this period" className="py-10" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={52} />
        <Tooltip
          cursor={{ fill: CURSOR }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as MonthDatum;
            return <Tip title={monthLabel(d.month, true)} rows={[['Sales', fmtInr(d.value)], ['vs previous month', growthText(d.growth)], ...(d.tag ? ([[d.tag, 'month']] as [string, string][]) : [])]} />;
          }}
        />
        <Bar
          dataKey="value"
          radius={[4, 4, 0, 0]}
          maxBarSize={34}
          animationDuration={700}
          cursor={onSelect ? 'pointer' : undefined}
          onClick={onSelect ? (d) => onSelect((d as unknown as { payload: MonthDatum }).payload.month) : undefined}
        >
          {data.map((d) => (
            <Cell key={d.month} fill={d.tag === 'Highest' ? SERIES[1] : SERIES[0]} />
          ))}
          <LabelList dataKey="tag" position="top" style={{ fontSize: 10, fill: '#55606c' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Monthly trend line; months after the latest sales month are left out instead of drawn as 0. */
export function MonthlyTrendChart({ months, values, upTo }: { months: string[]; values: number[]; upTo: string | null }) {
  const data = toData(months, values, upTo).map((d) => ({ ...d, value: upTo && d.month > upTo ? null : d.value }));
  const counted = data.filter((d) => d.value !== null);
  if (!counted.some((d) => (d.value ?? 0) > 0)) return <EmptyState title="No sales in this period" className="py-10" />;
  const avg = counted.reduce((s, d) => s + (d.value ?? 0), 0) / counted.length;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={52} />
        <ReferenceLine y={avg} stroke="#55606c" strokeDasharray="4 4" label={{ value: `Average ${formatInrShort(avg)}`, position: 'insideTopRight', fontSize: 10, fill: '#55606c' }} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as MonthDatum;
            return <Tip title={monthLabel(d.month, true)} rows={[['Sales', fmtInr(d.value)], ['vs previous month', growthText(d.growth)]]} />;
          }}
        />
        <Line dataKey="value" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, fill: SERIES[0], stroke: '#fbfaf7', strokeWidth: 2 }} connectNulls={false} animationDuration={700} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

/** Horizontal comparison bars; clicking a bar drills into it. */
export function ComparisonBars({ items, onSelect, color = SERIES[0] }: { items: BarItem[]; onSelect?: (key: string) => void; color?: string }) {
  if (!items.length) return <EmptyState title="Nothing to compare" className="py-10" />;
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={items} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 4 }} barCategoryGap="24%">
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} />
        <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={false} width={130} />
        <Tooltip
          cursor={{ fill: CURSOR }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as BarItem;
            return <Tip title={d.label} rows={[['Sales', fmtInr(d.value)], ['Share', fmtPct(total ? (d.value / total) * 100 : null)], ...(d.sub ? ([['', d.sub]] as [string, string][]) : [])]} />;
          }}
        />
        <Bar
          dataKey="value"
          fill={color}
          radius={[0, 4, 4, 0]}
          maxBarSize={22}
          animationDuration={700}
          cursor={onSelect ? 'pointer' : undefined}
          onClick={onSelect ? (d) => onSelect((d as unknown as { payload: BarItem }).payload.key) : undefined}
        >
          <LabelList dataKey="value" position="right" formatter={(v) => formatInrShort(Number(v))} style={{ fontSize: 10, fill: '#1e2a36' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
