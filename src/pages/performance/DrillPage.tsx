import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, ExternalLink, Layers, MapPin, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import {
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
} from '@/components/performance/hierUi';
import { MonthlyPanel } from '@/components/performance/hierPanels';
import { friendlyError } from '@/lib/errors';
import type { ExportColumn } from '@/lib/export';
import { formatDate, formatNumber, toNumber } from '@/lib/format';
import { daysInMonth } from '@/lib/performance';
import { BUCKET_LABEL, typeLabel, type BucketNode, type HierNode, type SalesType } from '@/lib/salesHierarchy';
import { supabase } from '@/lib/supabase';
import type { NppSale } from '@/types/database';

type Tx = NppSale & { credited_manager?: string | null };

/** Zone key used by buildTree for rows without a zone */
const NO_ZONE_KEY = 'Zone not stated';

const TX_COLUMNS: ExportColumn<Tx>[] = [
  { header: 'Date', value: (r) => r.sale_date, width: 12 },
  { header: 'Particulars', value: (r) => r.particulars, width: 28 },
  { header: 'Product Name', value: (r) => r.product_name, width: 24 },
  { header: 'Place of sale', value: (r) => r.place_of_sale },
  { header: 'Ikris Manager Involved', value: (r) => r.manager },
  { header: 'Zone', value: (r) => r.zone ?? null },
  { header: 'Concerned Doctor name', value: (r) => r.doctor_name, width: 22 },
  { header: 'Hospital Name', value: (r) => r.hospital_name, width: 26 },
  { header: 'Quantity', value: (r) => (r.quantity !== null ? `${toNumber(r.quantity)} ${r.quantity_unit ?? ''}`.trim() : null) },
  { header: 'INR Value', value: (r) => toNumber(r.inr_value), numFmt: '#,##0' },
];

function periodRange(model: HierModel, month?: string) {
  const first = month ?? model.months[0];
  const last = month ?? model.months[11];
  return { date_from: first, date_to: `${last.slice(0, 8)}${String(daysInMonth(last)).padStart(2, '0')}` };
}

/** Individual sales behind a drill-down node, fetched from the database (RLS applies). */
function Transactions({
  title,
  filters,
  clientFilter,
  pre,
}: {
  title: string;
  filters: Record<string, string>;
  clientFilter?: (r: Tx) => boolean;
  pre: string[];
}) {
  const q = useQuery({
    queryKey: ['npp', 'drill-tx', filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('npp_filtered', { p: filters }).order('sale_date', { ascending: true }).order('id').range(0, 1999);
      if (error) throw error;
      return (data ?? []) as Tx[];
    },
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (q.data ?? []).filter((r) => r.sale_date && (!clientFilter || clientFilter(r))), [q.data, clientFilter]);
  const total = rows.reduce((s, r) => s + (toNumber(r.inr_value) ?? 0), 0);
  return (
    <Card className="min-w-0">
      <CardHeader
        title={`Individual sales — ${title}`}
        description={`${rows.length} sale(s) · ${fmtInr(total)} · ${formatDate(filters.date_from)} – ${formatDate(filters.date_to)}`}
        actions={<ExportMenu name="drill-down-sales" rows={rows} columns={TX_COLUMNS} preamble={pre} />}
      />
      {q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState title="No sales for this selection" />
      ) : (
        <div className="scroll-thin max-h-[560px] overflow-auto px-2 pb-4 sm:px-5">
          <table className="data-table w-full min-w-[980px] text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-line text-left text-muted">
                {['Date', 'Particulars', 'Product Name', 'Place of sale', 'Ikris Manager Involved', 'Zone', 'Concerned Doctor', 'Hospital Name', 'Quantity'].map((h) => (
                  <th key={h} className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">INR Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="whitespace-nowrap px-2 py-1.5">{formatDate(r.sale_date)}</td>
                  <td className="px-2 py-1.5">{r.particulars}</td>
                  <td className="px-2 py-1.5">{r.product_name}</td>
                  <td className="px-2 py-1.5">{r.place_of_sale ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.manager ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.zone ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.doctor_name ?? '—'}</td>
                  <td className="px-2 py-1.5">{r.hospital_name ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{r.quantity !== null ? `${formatNumber(r.quantity, 3)} ${r.quantity_unit ?? ''}` : '—'}</td>
                  <td className="tabular px-2 py-1.5 text-right">{fmtInr(toNumber(r.inr_value))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-semibold text-navy">
                <td className="px-2 py-2" colSpan={9}>
                  Total
                </td>
                <td className="tabular px-2 py-2 text-right">{fmtInr(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function ChildList({
  title,
  description,
  parentTotal,
  items,
  icon,
}: {
  title: string;
  description?: string;
  parentTotal: number;
  items: { key: string; label: string; sub?: string; total: number; records: number; href: string }[];
  icon: typeof UserRound;
}) {
  const Icon = icon;
  return (
    <Card className="min-w-0">
      <CardHeader title={title} description={description} />
      <ul className="divide-y divide-line/60 px-2 pb-3 sm:px-4">
        {items.map((it) => (
          <li key={it.key}>
            <Link to={it.href} className="group flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-accent-50 focus-visible:outline-2 focus-visible:outline-brand">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-navy">{it.label}</span>
                <span className="block truncate text-xs text-muted">
                  {it.records} sale(s){it.sub ? ` · ${it.sub}` : ''}
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden>
                  <span className="block h-full bg-sidebar" style={{ width: `${parentTotal ? (it.total / parentTotal) * 100 : 0}%` }} />
                </span>
              </span>
              <span className="text-right">
                <span className="tabular block font-semibold text-ink">{fmtInrShort(it.total)}</span>
                <span className="tabular block text-xs text-muted">{fmtPct(parentTotal ? (it.total / parentTotal) * 100 : 0)}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
        {!items.length && <li className="px-2 py-4 text-sm text-muted">Nothing at this level for the selected period.</li>}
      </ul>
    </Card>
  );
}

export function DrillPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { params, update, reset } = useHierParams();
  const { model, isLoading, error, refetch, isFetching } = useHierModel(params);
  const m = sp.get('m') ?? undefined;
  const t = (sp.get('t') as SalesType | null) ?? undefined;
  const z = sp.get('z') ?? undefined;

  const href = (level: { m?: string; t?: string; z?: string }) => {
    const p = new URLSearchParams(sp);
    for (const k of ['m', 't', 'z']) p.delete(k);
    for (const [k, v] of Object.entries(level)) if (v) p.set(k, v);
    return `/performance/drill?${p}`;
  };

  const ctx = useMemo(() => {
    if (!model) return null;
    const bucket = m?.startsWith('bucket:') ? (m.slice(7) as BucketNode['reason']) : undefined;
    const mgr = !bucket && m ? model.tree.managers.find((x) => x.key === m) : undefined;
    const mgrFy = !bucket && m ? model.fyTree.managers.find((x) => x.key === m) : undefined;
    const bkt = bucket ? model.tree.buckets.find((b) => b.reason === bucket) : undefined;
    const bktFy = bucket ? model.fyTree.buckets.find((b) => b.reason === bucket) : undefined;
    const type = mgr && t ? mgr.types.find((x) => x.type === t) : undefined;
    const typeFy = mgrFy && t ? mgrFy.types.find((x) => x.type === t) : undefined;
    const zone = type && z ? type.zones.find((x) => x.key === z) : undefined;
    const zoneFy = typeFy && z ? typeFy.zones.find((x) => x.key === z) : undefined;
    const label = mgr?.label ?? mgrFy?.label ?? model.managers.find((x) => x.key === m)?.label ?? m;
    return { bucket, mgr, mgrFy, bkt, bktFy, type, typeFy, zone, zoneFy, label };
  }, [model, m, t, z]);

  const level = !m ? 0 : ctx?.bucket ? 1 : !t ? 1 : !z ? 2 : 3;
  const back = level === 0 ? null : level === 1 ? href({}) : level === 2 ? href({ m }) : href({ m, t });
  const range = model ? periodRange(model, params.month) : null;

  const crumbs: { label: string; to?: string }[] = [{ label: 'Company', to: m ? href({}) : undefined }];
  if (m && ctx) crumbs.push({ label: ctx.bucket ? BUCKET_LABEL[ctx.bucket] : (ctx.label ?? m), to: t ? href({ m }) : undefined });
  if (t && ctx) crumbs.push({ label: typeLabel(t, ctx.label ?? '', ctx.type?.zones.length === 1 ? ctx.type.zones[0].zone : ctx.typeFy?.zones.length === 1 ? ctx.typeFy.zones[0].zone : null), to: z ? href({ m, t }) : undefined });
  if (z) crumbs.push({ label: z });

  const node: HierNode | undefined = !model || !ctx ? undefined : level === 0 ? model.tree : ctx.bucket ? ctx.bkt : level === 1 ? ctx.mgr : level === 2 ? ctx.type : ctx.zone;
  const fyNode: HierNode | undefined = !model || !ctx ? undefined : level === 0 ? model.fyTree : ctx.bucket ? ctx.bktFy : level === 1 ? ctx.mgrFy : level === 2 ? ctx.typeFy : ctx.zoneFy;
  const nodeTitle = crumbs[crumbs.length - 1].label;
  const zeroMonthly = model ? new Array(model.months.length).fill(0) : [];

  return (
    <div>
      <PageHeader
        title="Sales drill-down"
        description="Company → Manager → HO / own sales → Zone → individual sales. Every level shows its own total, which is the sum of the level below."
      />
      <PerfNav />
      <HierFilterBar params={params} update={update} reset={reset} model={model} fields={['fy', 'month', 'type', 'zone']} />
      {error && !model ? (
        <Card>
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !model || !ctx ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <>
          <div className="no-print mb-4 flex flex-wrap items-center gap-3">
            {back && (
              <Button variant="outline" size="sm" onClick={() => navigate(back)}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
              </Button>
            )}
            <nav aria-label="Drill-down path" className="flex flex-wrap items-center gap-1.5 text-sm">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <ChevronRight className="h-4 w-4 text-muted" aria-hidden />}
                  {c.to ? (
                    <Link className="font-medium text-brand hover:underline" to={c.to}>
                      {c.label}
                    </Link>
                  ) : (
                    <span className="font-semibold text-navy" aria-current="page">
                      {c.label}
                    </span>
                  )}
                </span>
              ))}
            </nav>
          </div>
          <div className="mb-4">
            <LastRefresh model={model} isFetching={isFetching} onRefresh={() => refetch()} />
          </div>

          {/* Header figures for the current level */}
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={`${nodeTitle} · ${periodLabel(model, params)}`} value={fmtInrShort(node?.total ?? 0)} title={fmtInr(node?.total ?? 0)} sub={`${node?.records ?? 0} sale(s)`} />
            {level === 1 && ctx.mgr && (
              <>
                <StatTile label="Own sales" value={fmtInrShort(ctx.mgr.own)} sub={`${ctx.label} in “Ikris Manager Involved”`} />
                <StatTile
                  label="HO sales"
                  value={fmtInrShort(ctx.mgr.ho)}
                  sub={ctx.mgr.types.filter((x) => x.type === 'ho').map((x) => x.label).join(', ') || 'No HO sales'}
                />
                <StatTile label="Zone" value={ctx.mgr.zones.join(', ') || '—'} sub="BD Person: not in the sheet" />
              </>
            )}
            {level >= 2 && (
              <StatTile
                label="Share of manager total"
                value={fmtPct(ctx.mgr?.total ? ((node?.total ?? 0) / ctx.mgr.total) * 100 : null)}
                sub={`of ${fmtInrShort(ctx.mgr?.total)} (${ctx.label})`}
              />
            )}
            {level === 0 && (
              <>
                <StatTile label="Managers" value={model.tree.managers.length} sub="Credited with sales" />
                <StatTile label="Zones" value={new Set(model.tree.managers.flatMap((x) => x.zones)).size} />
                <StatTile label="Not credited to a manager" value={fmtInrShort(model.tree.buckets.reduce((s, b) => s + b.total, 0))} sub="HO (Third Party) etc." />
              </>
            )}
          </div>

          {/* Children of the current level */}
          <div className="mb-6">
            {level === 0 && (
              <ChildList
                title="Managers"
                description="Total = own sales + HO sales named for the manager in the Zone column."
                parentTotal={model.tree.total}
                icon={UserRound}
                items={[
                  ...model.tree.managers.map((x) => ({
                    key: x.key,
                    label: x.label,
                    sub: `${x.zones.join(', ')} · own ${fmtInrShort(x.own)} · HO ${fmtInrShort(x.ho)}`,
                    total: x.total,
                    records: x.records,
                    href: href({ m: x.key }),
                  })),
                  ...model.tree.buckets.map((b) => ({ key: b.key, label: b.label, sub: 'Not credited to a manager', total: b.total, records: b.records, href: href({ m: `bucket:${b.reason}` }) })),
                ]}
              />
            )}
            {level === 1 && ctx.mgr && (
              <ChildList
                title={`${ctx.label}: own sales and HO sales`}
                parentTotal={ctx.mgr.total}
                icon={Layers}
                items={ctx.mgr.types.map((x) => ({
                  key: x.type,
                  label: x.label,
                  sub: x.zones.map((zz) => zz.label).join(', '),
                  total: x.total,
                  records: x.records,
                  href: href({ m, t: x.type }),
                }))}
              />
            )}
            {level === 2 && ctx.type && (
              <ChildList
                title={`Zones — ${ctx.type.label}`}
                parentTotal={ctx.type.total}
                icon={MapPin}
                items={ctx.type.zones.map((x) => ({ key: x.key, label: x.label, total: x.total, records: x.records, href: href({ m, t, z: x.key }) }))}
              />
            )}
            {level === 1 && !ctx.bucket && !ctx.mgr && <EmptyState title={`${ctx.label ?? 'This manager'} has no sales in ${periodLabel(model, params)}`} />}
          </div>

          {/* Month-wise performance of the current node (whole FY) */}
          <h2 className="mb-2 text-sm font-semibold text-navy">
            Month-wise sales · {nodeTitle} · April–March {model.fy}–{String((model.fy + 1) % 100).padStart(2, '0')}
          </h2>
          <div className="mb-6">
            <MonthlyPanel
              title={nodeTitle}
              months={model.months}
              values={fyNode?.monthly ?? zeroMonthly}
              upTo={model.upTo}
              onSelectMonth={(mo) => update({ month: mo === params.month ? undefined : mo, fy: model.fy })}
            />
            {params.month && (
              <p className="mt-2 text-xs text-muted">
                Totals above the chart are for {monthLabel(params.month, true)}; the chart always shows the whole financial year.
              </p>
            )}
          </div>

          {/* Lowest level: the individual sales */}
          {range && (level === 3 || ctx.bucket) && (
            <Transactions
              title={nodeTitle}
              pre={preamble(model, params, `Sales — ${crumbs.map((c) => c.label).join(' › ')}`)}
              filters={
                ctx.bucket === 'third_party'
                  ? { ...range, channel: 'ho_third_party' }
                  : ctx.bucket
                    ? { ...range, ...(ctx.bucket === 'ho_unassigned' ? { channel: 'ho' } : {}) }
                    : { ...range, owner: m!, channel: t === 'own' ? 'individual' : 'ho', ...(z !== NO_ZONE_KEY ? { zone: z! } : {}) }
              }
              clientFilter={
                ctx.bucket && ctx.bucket !== 'third_party'
                  ? (r) => !r.credited_manager && (ctx.bucket === 'ho_unassigned' ? r.channel === 'ho' : !r.manager)
                  : z === NO_ZONE_KEY
                    ? (r) => !r.zone_base
                    : undefined
              }
            />
          )}
          {level > 0 && level < 3 && !ctx.bucket && (
            <p className="text-xs text-muted">
              Drill to a zone to see the individual sales, or{' '}
              <Link className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" to={`/sales?${new URLSearchParams({ owner: m!, ...(range ?? {}) })}`}>
                open all of {ctx.label}’s sales <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}
