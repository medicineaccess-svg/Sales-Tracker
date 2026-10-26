import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Building, ClipboardList, Coins, IndianRupee, Package, Stethoscope, Truck, AlertTriangle } from 'lucide-react';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { KpiCard } from '@/components/dashboard/KpiCard';
import {
  BreakdownBars,
  ChartCard,
  ContributionDonut,
  MetricSwitch,
  MonthlyCurrencyBars,
  MonthlyInrBars,
  TrendLine,
  breakdownTable,
  monthlyCurrencyTable,
  useMonthlyInr,
  type BreakdownMetric,
} from '@/components/dashboard/charts';
import { PageHeader } from '@/components/ui/card';
import { ErrorState, StaleBanner } from '@/components/ui/feedback';
import { useDashboard } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { describeFilters } from '@/lib/filters';
import { friendlyError } from '@/lib/errors';
import { CURRENCY_LABEL, CURRENCY_ORDER, formatInrShort, formatMoney, formatMonth, formatNumber } from '@/lib/format';
import type { CurrencyTotals } from '@/types/database';

function CurrencyLines({ rows, field }: { rows: CurrencyTotals[]; field: 'value' | 'shipping' | 'avg_value' }) {
  const sorted = [...rows].sort((a, b) => CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency));
  const visible = sorted.filter((r) => r[field] !== null && Number(r[field]) !== 0);
  if (!visible.length) return <span>—</span>;
  return (
    <div className="space-y-0.5">
      {visible.map((r) => (
        <div key={r.currency} className={visible.length > 1 ? 'text-lg leading-snug' : undefined}>
          {r.currency === 'UNSPECIFIED' ? (
            <span title="Rate column has no currency symbol">
              {formatMoney(r[field], 'UNSPECIFIED')} <span className="text-xs font-normal text-muted">(currency not stated)</span>
            </span>
          ) : (
            formatMoney(r[field], r.currency)
          )}
        </div>
      ))}
    </div>
  );
}

const BREAKDOWN_OPTIONS: { value: BreakdownMetric; label: string }[] = [
  { value: 'inr_value', label: 'INR' },
  { value: 'value_usd', label: 'USD' },
  { value: 'value_eur', label: 'EUR' },
  { value: 'records', label: 'Records' },
];

export function DashboardPage() {
  const { filters, update, reset } = useFilters();
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboard(filters, 10);
  const [productMetric, setProductMetric] = useState<BreakdownMetric>('inr_value');
  const [managerMetric, setManagerMetric] = useState<BreakdownMetric>('inr_value');
  const [hospitalMetric, setHospitalMetric] = useState<BreakdownMetric>('inr_value');
  const [trendMetric, setTrendMetric] = useState<'inr' | 'records'>('inr');
  const [contribBy, setContribBy] = useState<'product' | 'manager'>('product');
  const [contribMetric, setContribMetric] = useState<'inr_value' | 'records'>('inr_value');
  const inrMonthly = useMonthlyInr(data?.monthly);

  const t = data?.totals;
  const loading = isLoading && !data;
  const empty = !!data && t?.records === 0;

  return (
    <div>
      <PageHeader
        title="NPP Sales Dashboard"
        description={
          <>
            Live figures from the sales database. Monetary values are shown in their own currency; INR Value is the
            figure reported in the source sheet and is never recalculated. {isFetching && !loading && <span className="text-brand">Refreshing…</span>}
          </>
        }
      />
      <FilterBar filters={filters} onChange={update} onReset={reset} />

      {isError && data && <StaleBanner message={friendlyError(error)} onRetry={() => refetch()} />}
      {isError && !data ? (
        <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
      ) : (
        <>
          {!!t?.needs_review && (
            <Link
              to="/sales?needs_review=true"
              className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-[#7a4a0d] hover:bg-amber-100"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {t.needs_review} record(s) in this view have data-quality flags from the sheet (e.g. missing date or currency). Review them →
            </Link>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard index={0} loading={loading} icon={Coins} label="Total sales value" value={<CurrencyLines rows={data?.by_currency ?? []} field="value" />} sub="Sheet “Value” column, per currency" />
            <KpiCard
              index={1}
              loading={loading}
              icon={IndianRupee}
              label="Total INR value"
              value={formatInrShort(t?.inr_value)}
              sub={`${formatMoney(t?.inr_value, 'INR')} · source-reported`}
            />
            <KpiCard
              index={2}
              loading={loading}
              icon={ClipboardList}
              label="Sales records"
              value={formatNumber(t?.records)}
              sub={t?.undated ? `${t.undated} without a date in the sheet` : t?.first_date ? `${t.first_date} → ${t.last_date}` : undefined}
            />
            <KpiCard
              index={3}
              loading={loading}
              icon={Package}
              label="Quantity sold"
              value={
                data?.quantity_by_unit.length ? (
                  <span className="text-lg leading-snug">
                    {data.quantity_by_unit.slice(0, 3).map((q) => `${formatNumber(q.quantity)} ${q.unit}`).join(' · ')}
                  </span>
                ) : (
                  '—'
                )
              }
              sub="Summed per unit — packs, vials and pens are not added together"
            />
            <KpiCard index={4} loading={loading} icon={Truck} label="Shipping charges" value={<CurrencyLines rows={data?.by_currency ?? []} field="shipping" />} sub="Reported separately — not added to sales" />
            <KpiCard index={5} loading={loading} icon={Activity} label="Avg. value per record" value={<CurrencyLines rows={data?.by_currency ?? []} field="avg_value" />} sub="Mean of “Value”, per currency" />
            <KpiCard index={6} loading={loading} icon={Building} label="Unique hospitals" value={formatNumber(t?.hospitals)} sub="Distinct hospital names" />
            <KpiCard index={7} loading={loading} icon={Stethoscope} label="Unique doctors" value={formatNumber(t?.doctors)} sub="Distinct names (spelling variants count separately)" />
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Monthly sales value"
              description="Sum of Value per month — one bar per currency"
              loading={loading}
              empty={empty || !data?.monthly.length}
              table={data ? monthlyCurrencyTable(data.monthly, 'value') : undefined}
            >
              {data && <MonthlyCurrencyBars monthly={data.monthly} metric="value" />}
            </ChartCard>
            <ChartCard
              title="Monthly INR sales"
              description="Source-reported INR Value per month (all currencies)"
              loading={loading}
              empty={empty || !inrMonthly.length}
              table={{
                columns: ['Month', 'INR Value', 'Records'],
                rows: inrMonthly.map((m) => [formatMonth(m.month), formatMoney(m.inr, 'INR'), m.records]),
              }}
            >
              {data && <MonthlyInrBars monthly={data.monthly} />}
            </ChartCard>

            <ChartCard
              title="Product-wise sales"
              description={`Top 10 products`}
              loading={loading}
              empty={empty}
              height={340}
              actions={<MetricSwitch label="Metric" value={productMetric} onChange={setProductMetric} options={BREAKDOWN_OPTIONS} />}
              table={data ? breakdownTable(data.by_product, productMetric, 'Product') : undefined}
            >
              {data && <BreakdownBars rows={data.by_product} metric={productMetric} />}
            </ChartCard>
            <ChartCard
              title="Sales by manager"
              description="Ikris Manager Involved"
              loading={loading}
              empty={empty}
              height={340}
              actions={<MetricSwitch label="Metric" value={managerMetric} onChange={setManagerMetric} options={BREAKDOWN_OPTIONS} />}
              table={data ? breakdownTable(data.by_manager, managerMetric, 'Manager') : undefined}
            >
              {data && <BreakdownBars rows={data.by_manager} metric={managerMetric} color="#3157a4" />}
            </ChartCard>

            <ChartCard
              title="Hospital-wise sales"
              description="Top 10 hospitals"
              loading={loading}
              empty={empty}
              height={340}
              actions={<MetricSwitch label="Metric" value={hospitalMetric} onChange={setHospitalMetric} options={BREAKDOWN_OPTIONS} />}
              table={data ? breakdownTable(data.by_hospital, hospitalMetric, 'Hospital') : undefined}
            >
              {data && <BreakdownBars rows={data.by_hospital} metric={hospitalMetric} />}
            </ChartCard>
            <ChartCard
              title="Sales trend"
              description={trendMetric === 'inr' ? 'INR Value over time' : 'Number of sales records over time'}
              loading={loading}
              empty={empty || !inrMonthly.length}
              actions={
                <MetricSwitch
                  label="Trend metric"
                  value={trendMetric}
                  onChange={setTrendMetric}
                  options={[
                    { value: 'inr', label: 'INR' },
                    { value: 'records', label: 'Records' },
                  ]}
                />
              }
            >
              {data && <TrendLine monthly={data.monthly} metric={trendMetric} />}
            </ChartCard>

            <ChartCard
              title="Sales contribution"
              description={`Share of ${contribMetric === 'inr_value' ? 'INR Value' : 'records'} by ${contribBy} (top 7 + other)`}
              loading={loading}
              empty={empty}
              height={300}
              actions={
                <>
                  <MetricSwitch
                    label="Group by"
                    value={contribBy}
                    onChange={setContribBy}
                    options={[
                      { value: 'product', label: 'Product' },
                      { value: 'manager', label: 'Manager' },
                    ]}
                  />
                  <MetricSwitch
                    label="Contribution metric"
                    value={contribMetric}
                    onChange={setContribMetric}
                    options={[
                      { value: 'inr_value', label: 'INR' },
                      { value: 'records', label: 'Records' },
                    ]}
                  />
                </>
              }
              table={data ? breakdownTable(contribBy === 'product' ? data.by_product : data.by_manager, contribMetric, contribBy === 'product' ? 'Product' : 'Manager') : undefined}
            >
              {data && <ContributionDonut rows={contribBy === 'product' ? data.by_product : data.by_manager} metric={contribMetric} />}
            </ChartCard>
            <ChartCard
              title="Shipping charges"
              description="Monthly shipping, per currency"
              loading={loading}
              empty={empty || !data?.monthly.some((m) => Number(m.shipping) > 0)}
              table={data ? monthlyCurrencyTable(data.monthly, 'shipping') : undefined}
            >
              {data && <MonthlyCurrencyBars monthly={data.monthly} metric="shipping" />}
            </ChartCard>
          </div>

          <p className="mt-6 text-xs text-muted">
            Applied filters: {describeFilters(filters).join(' · ')}. Currencies shown:{' '}
            {(data?.by_currency ?? []).map((c) => CURRENCY_LABEL[c.currency]).join(', ') || '—'}.
          </p>
        </>
      )}
    </div>
  );
}
