import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FilterBar } from '@/components/dashboard/FilterBar';
import {
  BreakdownBars,
  ChartCard,
  ContributionDonut,
  MetricSwitch,
  TrendLine,
  breakdownTable,
  type BreakdownMetric,
} from '@/components/dashboard/charts';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ErrorState, Skeleton, StaleBanner } from '@/components/ui/feedback';
import { useDashboard } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { toRpcFilters } from '@/lib/filters';
import { friendlyError } from '@/lib/errors';
import { formatMoney, formatNumber } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { DATA_ISSUE_LABELS, type DataIssue } from '@shared/npp-parser';

const OPTIONS: { value: BreakdownMetric; label: string }[] = [
  { value: 'inr_value', label: 'INR' },
  { value: 'records', label: 'Records' },
];

function useIssueBreakdown(filters: ReturnType<typeof useFilters>['filters']) {
  const rpc = toRpcFilters({ ...filters, needs_review: true });
  return useQuery({
    queryKey: ['npp', 'issues', rpc],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('npp_filtered', { p: rpc }).select('data_issues').limit(5000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const r of (data ?? []) as { data_issues: string[] }[]) for (const i of r.data_issues) counts.set(i, (counts.get(i) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    },
  });
}

export function AnalyticsPage() {
  const { filters, update, reset } = useFilters();
  const { data, isLoading, isError, error, refetch } = useDashboard(filters, 15);
  const issues = useIssueBreakdown(filters);
  const [doctorMetric, setDoctorMetric] = useState<BreakdownMetric>('inr_value');
  const [placeMetric, setPlaceMetric] = useState<BreakdownMetric>('inr_value');
  const loading = isLoading && !data;
  const empty = !!data && data.totals.records === 0;

  const shareOfTop = useMemo(() => {
    if (!data?.by_product.length || !data.totals.inr_value) return null;
    const top3 = [...data.by_product].sort((a, b) => b.inr_value - a.inr_value).slice(0, 3);
    return { names: top3.map((p) => p.key), pct: (top3.reduce((s, p) => s + Number(p.inr_value), 0) / Number(data.totals.inr_value)) * 100 };
  }, [data]);

  return (
    <div>
      <PageHeader title="Analytics" description="Deeper views of NPP performance: concentration, doctors, regions and data quality." />
      <FilterBar filters={filters} onChange={update} onReset={reset} />
      {isError && data && <StaleBanner message={friendlyError(error)} onRetry={() => refetch()} />}
      {isError && !data ? (
        <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Concentration</p>
              {loading ? (
                <Skeleton className="mt-2 h-10" />
              ) : shareOfTop ? (
                <>
                  <p className="mt-1 text-2xl font-semibold text-navy">{shareOfTop.pct.toFixed(1)}%</p>
                  <p className="text-xs text-muted">of INR value comes from the top 3 products ({shareOfTop.names.join(', ')})</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">—</p>
              )}
            </Card>
            <Card className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Average INR per record</p>
              {loading ? (
                <Skeleton className="mt-2 h-10" />
              ) : (
                <>
                  <p className="mt-1 text-2xl font-semibold text-navy">
                    {data?.totals.records_with_inr ? formatMoney(Number(data.totals.inr_value) / data.totals.records_with_inr, 'INR') : '—'}
                  </p>
                  <p className="text-xs text-muted">Across {formatNumber(data?.totals.records_with_inr)} records with an INR value</p>
                </>
              )}
            </Card>
            <Card className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Unique hospitals / doctors</p>
              {loading ? (
                <Skeleton className="mt-2 h-10" />
              ) : (
                <>
                  <p className="tabular mt-1 text-2xl font-bold text-navy">
                    {formatNumber(data?.totals.hospitals)} / {formatNumber(data?.totals.doctors)}
                  </p>
                  <p className="text-xs text-muted">Distinct names in the sheet</p>
                </>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <ChartCard title="Records over time" description="Number of sales records per month" loading={loading} empty={empty}>
              {data && <TrendLine monthly={data.monthly} metric="records" />}
            </ChartCard>
            <ChartCard
              title="Contribution by product"
              description="Share of INR value (top 7 + other)"
              loading={loading}
              empty={empty}
              table={data ? breakdownTable(data.by_product, 'inr_value', 'Product') : undefined}
            >
              {data && <ContributionDonut rows={data.by_product} metric="inr_value" />}
            </ChartCard>
            <ChartCard
              title="Doctor-wise sales"
              description="Top 15 concerned doctors"
              loading={loading}
              empty={empty}
              height={420}
              actions={<MetricSwitch label="Metric" value={doctorMetric} onChange={setDoctorMetric} options={OPTIONS} />}
              table={data ? breakdownTable(data.by_doctor, doctorMetric, 'Doctor') : undefined}
            >
              {data && <BreakdownBars rows={data.by_doctor} metric={doctorMetric} />}
            </ChartCard>
            <ChartCard
              title="Place-of-sale analysis"
              description="Top 15 places of sale"
              loading={loading}
              empty={empty}
              height={420}
              actions={<MetricSwitch label="Metric" value={placeMetric} onChange={setPlaceMetric} options={OPTIONS} />}
              table={data ? breakdownTable(data.by_place, placeMetric, 'Place') : undefined}
            >
              {data && <BreakdownBars rows={data.by_place} metric={placeMetric} />}
            </ChartCard>
          </div>

          <Card className="mt-4">
            <CardHeader title="Data quality" description="Flags raised while importing the sheet — fix them in the sheet or edit the record" />
            <div className="p-5">
              {issues.isLoading ? (
                <Skeleton className="h-24" />
              ) : !issues.data?.length ? (
                <p className="text-sm text-success">No data-quality flags in this view.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {issues.data.map(([issue, n]) => (
                    <li key={issue} className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2 text-sm">
                      <span>{DATA_ISSUE_LABELS[issue as DataIssue] ?? issue}</span>
                      <span className="tabular font-semibold text-[#8a5410]">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/sales?needs_review=true" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
                Open flagged records →
              </Link>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
