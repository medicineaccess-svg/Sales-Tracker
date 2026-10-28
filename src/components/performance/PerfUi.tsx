import { useCallback, useMemo, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Clock, Download, FileSpreadsheet, Printer, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown';
import { useFilterOptions, usePerformance } from '@/hooks/useData';
import { downloadCsv, downloadXlsx, stamp, type ExportColumn } from '@/lib/export';
import { formatDateTime, formatInrShort, formatMoney } from '@/lib/format';
import {
  fyLabel,
  fyMonths,
  fyStartYear,
  latestDataMonth,
  STATUS_LABEL,
  STATUS_SYMBOL,
  TargetBook,
  todayIso,
  zonesOf,
  type Channel,
  type PerfFact,
  type PerfStatus,
  type PerformanceData,
} from '@/lib/performance';
import { notify } from '@/lib/errors';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const monthLabel = (m: string, long = false) => {
  const [y, mo] = m.split('-').map(Number);
  return long ? `${MONTHS[mo - 1]} ${y}` : `${MONTHS[mo - 1]} ${String(y).slice(2)}`;
};

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`;

export const fmtInr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoney(v, 'INR'));
export const fmtInrShort = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatInrShort(v));

export const CHANNEL_LABEL: Record<Channel, string> = {
  individual: 'Individual managers',
  ho: 'HO (zone)',
  ho_third_party: 'HO (Third Party)',
  unassigned: 'Manager not stated',
};

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export interface PerfParams {
  fy?: number;
  month?: string; // YYYY-MM-01
  zone?: string;
  manager?: string; // manager_key
  channel?: Channel;
  product?: string;
  place?: string;
  date_from?: string;
  date_to?: string;
}

const KEYS = ['fy', 'month', 'zone', 'manager', 'channel', 'product', 'place', 'date_from', 'date_to'] as const;

export function usePerfParams() {
  const [sp, setSp] = useSearchParams();
  const params = useMemo<PerfParams>(() => {
    const p: PerfParams = {};
    for (const k of KEYS) {
      const v = sp.get(k);
      if (!v) continue;
      if (k === 'fy') p.fy = Number(v);
      else (p as Record<string, string>)[k] = v;
    }
    return p;
  }, [sp]);
  const update = useCallback(
    (patch: Partial<PerfParams>) => {
      const next = new URLSearchParams(sp);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '' || v === null) next.delete(k);
        else next.set(k, String(v));
      }
      setSp(next, { replace: true });
    },
    [sp, setSp],
  );
  const reset = useCallback(() => {
    const next = new URLSearchParams(sp);
    for (const k of KEYS) next.delete(k);
    setSp(next, { replace: true });
  }, [sp, setSp]);
  return { params, update, reset };
}

// ---------------------------------------------------------------------------
// Model: data + derived context shared by all performance pages
// ---------------------------------------------------------------------------

export interface PerfModel {
  data: PerformanceData;
  today: string;
  month: string;
  fy: number;
  months: string[];
  book: TargetBook;
  zones: string[];
  /** Facts after zone / manager filters */
  facts: PerfFact[];
  /** Facts after period-independent filters only (product, place, channel, dates) */
  allFacts: PerfFact[];
  latestMonth: string | null;
  fyOptions: number[];
}

export function usePerfModel(params: PerfParams) {
  const query = usePerformance({
    product: params.product,
    place: params.place,
    channel: params.channel,
    date_from: params.date_from,
    date_to: params.date_to,
  });
  const model = useMemo<PerfModel | null>(() => {
    const data = query.data;
    if (!data) return null;
    const today = todayIso();
    const startMonth = Number(data.settings['reporting.financial_year_start_month'] ?? 4) || 4;
    const latestMonth = latestDataMonth(data.facts, today);
    const fallbackMonth = latestMonth ?? today.slice(0, 7) + '-01';
    let month = params.month ?? fallbackMonth;
    let fy = params.fy ?? fyStartYear(month, startMonth);
    if (params.fy && (!params.month || fyStartYear(params.month, startMonth) !== params.fy)) {
      // FY chosen without a month in it: use the latest month of that FY not after today
      const ms = fyMonths(params.fy, startMonth).filter((m) => m <= today.slice(0, 7) + '-01');
      month = ms.length ? ms[ms.length - 1] : fyMonths(params.fy, startMonth)[0];
      if (latestMonth && ms.includes(latestMonth)) month = latestMonth;
      fy = params.fy;
    }
    const facts = data.facts.filter(
      (f) => (!params.zone || f.zone === params.zone) && (!params.manager || f.manager_key === params.manager),
    );
    const fySet = new Set<number>([fyStartYear(today, startMonth)]);
    for (const f of data.facts) fySet.add(fyStartYear(f.month, startMonth));
    for (const t of data.targets) fySet.add(fyStartYear(t.month, startMonth));
    return {
      data,
      today,
      month,
      fy,
      months: fyMonths(fy, startMonth),
      book: new TargetBook(data.targets, data.managers),
      zones: zonesOf(data),
      facts,
      allFacts: data.facts,
      latestMonth,
      fyOptions: [...fySet].sort((a, b) => b - a),
    };
  }, [query.data, params.month, params.fy, params.zone, params.manager]);
  return { ...query, model };
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type PerfField = 'fy' | 'month' | 'zone' | 'manager' | 'channel' | 'product' | 'place' | 'dates';

export function PerfFilterBar({
  params,
  update,
  reset,
  model,
  fields = ['fy', 'month', 'zone', 'manager', 'channel', 'product', 'place', 'dates'],
}: {
  params: PerfParams;
  update: (p: Partial<PerfParams>) => void;
  reset: () => void;
  model: PerfModel | null;
  fields?: PerfField[];
}) {
  const { data: opts } = useFilterOptions();
  const has = (f: PerfField) => fields.includes(f);
  const managers = (model?.data.managers ?? []).filter((m) => m.active);
  const active = Object.values(params).filter((v) => v !== undefined && v !== '').length;
  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted';
  return (
    <div className="no-print mb-5 rounded-2xl border border-line/70 bg-card p-4 shadow-card">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {has('fy') && (
          <label>
            <span className={label}>Financial year</span>
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
            <span className={label}>Month</span>
            <Select className="h-9 text-xs" value={model?.month ?? ''} onChange={(e) => update({ month: e.target.value, fy: model?.fy })}>
              {(model?.months ?? []).map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, true)}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('zone') && (
          <label>
            <span className={label}>Zone</span>
            <Select className="h-9 text-xs" value={params.zone ?? ''} onChange={(e) => update({ zone: e.target.value || undefined })}>
              <option value="">All zones</option>
              {(model?.zones ?? []).map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          </label>
        )}
        {has('manager') && (
          <label>
            <span className={label}>Manager</span>
            <Select className="h-9 text-xs" value={params.manager ?? ''} onChange={(e) => update({ manager: e.target.value || undefined })}>
              <option value="">All</option>
              {managers.map((m) => (
                <option key={m.manager_key} value={m.manager_key}>
                  {m.display_name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('channel') && (
          <label>
            <span className={label}>Channel</span>
            <Select className="h-9 text-xs" value={params.channel ?? ''} onChange={(e) => update({ channel: (e.target.value || undefined) as Channel | undefined })}>
              <option value="">All channels</option>
              {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('product') && (
          <label>
            <span className={label}>Product</span>
            <Select className="h-9 text-xs" value={params.product ?? ''} onChange={(e) => update({ product: e.target.value || undefined })}>
              <option value="">All products</option>
              {(opts?.products ?? []).slice().sort().map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </label>
        )}
        {has('place') && (
          <label title="The sheet has no Branch column; Place of sale is used as the branch.">
            <span className={label}>Branch (place)</span>
            <Select className="h-9 text-xs" value={params.place ?? ''} onChange={(e) => update({ place: e.target.value || undefined })}>
              <option value="">All places</option>
              {(opts?.places ?? []).slice().sort().map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </label>
        )}
        {has('dates') && (
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className={label}>From</span>
              <Input type="date" className="h-9 text-xs" value={params.date_from ?? ''} onChange={(e) => update({ date_from: e.target.value || undefined })} />
            </label>
            <label className="min-w-0 flex-1">
              <span className={label}>To</span>
              <Input type="date" className="h-9 text-xs" value={params.date_to ?? ''} onChange={(e) => update({ date_to: e.target.value || undefined })} />
            </label>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Amounts are the sheet&apos;s INR Value (₹). Rows missing from the current sheet and archived rows are excluded.
          {(params.date_from || params.date_to) && ' A date range limits the sales counted in each month.'}
        </span>
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
// Small presentational pieces
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<PerfStatus, 'success' | 'brand' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  exceeded: 'success',
  achieved: 'success',
  on_track: 'brand',
  behind: 'danger',
  target_not_set: 'neutral',
  no_sales: 'warning',
  upcoming: 'neutral',
};

export function StatusBadge({ status }: { status: PerfStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span aria-hidden>{STATUS_SYMBOL[status]}</span> {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Flat KPI tile (no 3-D motion, for dense performance pages). */
export function StatTile({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'bad' | 'accent';
  title?: string;
}) {
  return (
    <div
      title={title}
      className={cn(
        'min-w-0 rounded-2xl border bg-card p-4 shadow-card',
        tone === 'good' ? 'border-emerald-200' : tone === 'bad' ? 'border-red-200' : tone === 'accent' ? 'border-accent/40' : 'border-line/70',
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="tabular mt-1 truncate text-xl font-bold tracking-tight text-navy">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function GrowthText({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">— no prior-month sales</span>;
  const up = value >= 0;
  return (
    <span className={up ? 'text-success' : 'text-danger'}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}% vs previous month
    </span>
  );
}

export function LastRefresh({ model, isFetching, onRefresh }: { model: PerfModel | null; isFetching?: boolean; onRefresh?: () => void }) {
  const sync = model?.data.last_sync;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Clock className="h-3.5 w-3.5" aria-hidden />
      <span>
        Data refreshed {formatDateTime(model?.data.generated_at)}
        {sync && ` · last sheet sync ${formatDateTime(sync.finished_at ?? sync.started_at)}`}
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

export function ExportMenu<T>({
  name,
  rows,
  columns,
  preamble,
  print = true,
}: {
  name: string;
  rows: T[];
  columns: ExportColumn<T>[];
  preamble: string[];
  print?: boolean;
}) {
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
        <DropdownItem
          onSelect={() =>
            downloadXlsx(`${file}.xlsx`, name, rows, columns, preamble).catch(() => notify.error('Excel export failed. Try CSV instead.'))
          }
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
        </DropdownItem>
        {print && (
          <DropdownItem onSelect={() => setTimeout(() => window.print(), 50)}>
            <Printer className="h-4 w-4" aria-hidden /> Print / PDF
          </DropdownItem>
        )}
      </DropdownContent>
    </Dropdown>
  );
}

export function PerfNav() {
  const [sp] = useSearchParams();
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const items = [
    ['/performance', 'Overview'],
    ['/performance/managers', 'Managers'],
    ['/performance/compare', 'Compare'],
    ['/performance/zones', 'Zones'],
    ['/performance/report', 'Monthly report'],
    ['/performance/rankings', 'Rankings'],
    ['/performance/targets', 'Targets'],
  ];
  const path = useLocation().pathname;
  return (
    <nav aria-label="Performance sections" className="no-print scroll-thin mb-4 flex gap-1 overflow-x-auto">
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

export function filterPreamble(model: PerfModel, params: PerfParams, title: string): string[] {
  const out = [
    `Ikris Pharma Network — ${title}`,
    `${fyLabel(model.fy)} · month ${monthLabel(model.month, true)} · generated ${formatDateTime(model.data.generated_at)}`,
  ];
  const f: string[] = [];
  if (params.zone) f.push(`Zone: ${params.zone}`);
  if (params.manager) f.push(`Manager: ${params.manager}`);
  if (params.channel) f.push(`Channel: ${CHANNEL_LABEL[params.channel]}`);
  if (params.product) f.push(`Product: ${params.product}`);
  if (params.place) f.push(`Place: ${params.place}`);
  if (params.date_from || params.date_to) f.push(`Dates: ${params.date_from ?? 'start'} → ${params.date_to ?? 'latest'}`);
  out.push(f.length ? `Filters: ${f.join('; ')}` : 'Filters: none');
  out.push('Amounts: sheet INR Value (₹). Targets: monthly figures entered by administrators.');
  return out;
}
