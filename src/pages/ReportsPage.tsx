import { useMemo, useState } from 'react';
import { CalendarDays, Download, FileSpreadsheet, History, Info, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown';
import { EmptyState, ErrorState, Skeleton, StaleBanner } from '@/components/ui/feedback';
import { useReport, useSyncRuns, type ReportGroup } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { describeFilters } from '@/lib/filters';
import { downloadCsv, downloadXlsx, stamp, type ExportColumn } from '@/lib/export';
import { friendlyError, notify } from '@/lib/errors';
import { CURRENCY_LABEL, CURRENCY_ORDER, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { CurrencyBucket, ReportRow, SyncRun } from '@/types/database';

type ReportId = ReportGroup | 'shipping' | 'history' | 'sync';

const REPORTS: { id: ReportId; label: string; group?: ReportGroup; description: string }[] = [
  { id: 'day', label: 'Daily sales', group: 'day', description: 'Totals per sale date.' },
  { id: 'month', label: 'Monthly sales', group: 'month', description: 'Totals per calendar month.' },
  { id: 'quarter', label: 'Quarterly sales', group: 'quarter', description: 'Indian financial-year quarters (Q1 = Apr–Jun).' },
  { id: 'financial_year', label: 'Financial-year sales', group: 'financial_year', description: 'Totals per Indian financial year (1 Apr – 31 Mar).' },
  { id: 'product', label: 'Product-wise', group: 'product', description: 'Totals per product name.' },
  { id: 'manager', label: 'Manager-wise', group: 'manager', description: 'Totals per Ikris manager involved.' },
  { id: 'hospital', label: 'Hospital-wise', group: 'hospital', description: 'Totals per hospital.' },
  { id: 'doctor', label: 'Doctor-wise', group: 'doctor', description: 'Totals per concerned doctor.' },
  { id: 'place', label: 'Place of sale', group: 'place', description: 'Totals per place of sale.' },
  { id: 'shipping', label: 'Shipping charges', group: 'month', description: 'Monthly shipping charges per currency.' },
  { id: 'history', label: 'Sales record history', description: 'Record-level export and change history.' },
  { id: 'sync', label: 'Sheets sync report', description: 'Google Sheets import and synchronisation runs.' },
];

interface PivotRow {
  key: string;
  records: number;
  inr: number;
  value: Partial<Record<CurrencyBucket, number>>;
  shipping: Partial<Record<CurrencyBucket, number>>;
}

function pivot(rows: ReportRow[]): { data: PivotRow[]; currencies: CurrencyBucket[] } {
  const map = new Map<string, PivotRow>();
  const currencies = new Set<CurrencyBucket>();
  for (const r of rows) {
    currencies.add(r.currency);
    const p = map.get(r.group_key) ?? { key: r.group_key, records: 0, inr: 0, value: {}, shipping: {} };
    p.records += Number(r.records);
    p.inr += Number(r.inr_value);
    p.value[r.currency] = (p.value[r.currency] ?? 0) + Number(r.value);
    p.shipping[r.currency] = (p.shipping[r.currency] ?? 0) + Number(r.shipping);
    map.set(r.group_key, p);
  }
  return { data: [...map.values()], currencies: CURRENCY_ORDER.filter((c) => currencies.has(c)) };
}

const DEFINITIONS = [
  ['Records', 'Number of active (non-archived) sales records matching the filters.'],
  ['Value', 'Sum of the sheet “Value” column, kept separate per currency (taken from the $ / € symbol in Rate). Never converted.'],
  ['Currency not stated', 'Rows whose Rate has no currency symbol in the sheet; their Value is shown separately.'],
  ['Shipping', 'Sum of “Shipping Charges”, per currency. Reported separately and not added to sales value.'],
  ['INR Value', 'Sum of the sheet “INR Value” column as reported by the source. The CRM does not apply exchange rates.'],
  ['Undated', 'Rows that have no date in the sheet; they are excluded whenever a date filter is applied.'],
];

function SyncReport() {
  const { data, isLoading, isError, error, refetch } = useSyncRuns(200);
  const cols: ExportColumn<SyncRun>[] = [
    { header: 'Started', value: (r) => r.started_at },
    { header: 'Finished', value: (r) => r.finished_at },
    { header: 'Trigger', value: (r) => r.trigger },
    { header: 'Status', value: (r) => r.status },
    { header: 'Rows read', value: (r) => r.rows_read },
    { header: 'Inserted', value: (r) => r.inserted },
    { header: 'Updated', value: (r) => r.updated },
    { header: 'Unchanged', value: (r) => r.unchanged },
    { header: 'Conflicts', value: (r) => r.conflicts },
    { header: 'Flagged', value: (r) => r.flagged },
    { header: 'Invalid', value: (r) => r.invalid },
    { header: 'Missing from source', value: (r) => r.missing_from_source },
    { header: 'Notes', value: (r) => r.notes },
  ];
  if (isError) return <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />;
  return (
    <Card>
      <CardHeader
        title="Google Sheets import and synchronisation report"
        actions={
          <Button variant="outline" size="sm" disabled={!data?.length} onClick={() => data && downloadCsv(`sync-report-${stamp()}.csv`, data, cols)}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        }
      />
      <div className="scroll-thin mt-3 overflow-x-auto">
        <table className="data-table w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-y border-line bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
              {['Started', 'Trigger', 'Status', 'Read', 'Inserted', 'Updated', 'Unchanged', 'Conflicts', 'Flagged'].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="p-4">
                  <Skeleton className="h-6" />
                </td>
              </tr>
            )}
            {data?.map((r) => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="px-4 py-2">{formatDateTime(r.started_at)}</td>
                <td className="px-4 py-2 capitalize">{r.trigger}</td>
                <td className="px-4 py-2 capitalize">{r.status}</td>
                {[r.rows_read, r.inserted, r.updated, r.unchanged, r.conflicts, r.flagged].map((v, i) => (
                  <td key={i} className="tabular px-4 py-2">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ReportsPage() {
  const navigate = useNavigate();
  const { filters, update, reset } = useFilters();
  const [reportId, setReportId] = useState<ReportId>('month');
  const report = REPORTS.find((r) => r.id === reportId)!;
  const { data, isLoading, isError, error, refetch, isFetching } = useReport(report.group ?? 'month', filters, !!report.group);
  const { data: pivoted, currencies } = useMemo(() => pivot(data ?? []), [data]);
  const shippingOnly = reportId === 'shipping';

  const totals = useMemo(() => {
    const t: PivotRow = { key: 'Total', records: 0, inr: 0, value: {}, shipping: {} };
    for (const p of pivoted) {
      t.records += p.records;
      t.inr += p.inr;
      for (const c of currencies) {
        t.value[c] = (t.value[c] ?? 0) + (p.value[c] ?? 0);
        t.shipping[c] = (t.shipping[c] ?? 0) + (p.shipping[c] ?? 0);
      }
    }
    return t;
  }, [pivoted, currencies]);

  const exportCols: ExportColumn<PivotRow>[] = [
    { header: report.label.replace(/ sales$/, ''), value: (r) => r.key, width: 28 },
    { header: 'Records', value: (r) => r.records },
    ...(!shippingOnly
      ? currencies.map<ExportColumn<PivotRow>>((c) => ({ header: `Value (${CURRENCY_LABEL[c]})`, value: (r) => r.value[c] ?? 0, numFmt: '#,##0.00' }))
      : []),
    ...currencies.map<ExportColumn<PivotRow>>((c) => ({ header: `Shipping (${CURRENCY_LABEL[c]})`, value: (r) => r.shipping[c] ?? 0, numFmt: '#,##0.00' })),
    ...(!shippingOnly ? [{ header: 'INR Value (reported)', value: (r: PivotRow) => r.inr, numFmt: '#,##0' }] : []),
  ];

  const doExport = async (kind: 'csv' | 'xlsx') => {
    const preamble = [
      `Ikris Pharma Network — NPP ${report.label} report`,
      `Generated ${new Date().toLocaleString('en-IN')}`,
      `Filters: ${describeFilters(filters).join(' · ')}`,
      'Values are per currency; INR Value is the source-reported figure (no conversion applied).',
    ];
    const rows = [...pivoted, totals];
    const name = `npp-${reportId}-report-${stamp()}.${kind}`;
    try {
      if (kind === 'csv') downloadCsv(name, rows, exportCols, preamble);
      else await downloadXlsx(name, report.label, rows, exportCols, preamble);
      void supabase.rpc('log_client_event', {
        p_action: 'report.export',
        p_department_code: 'npp',
        p_metadata: { report: reportId, format: kind, rows: pivoted.length, filter_keys: Object.keys(filters) },
      });
      notify.success('Report exported');
    } catch (e) {
      notify.error(friendlyError(e, 'Export failed.'));
    }
  };

  return (
    <div>
      <PageHeader title="Sales Reports" description="Grouped NPP sales reports. Every report respects the filters below and can be exported." />
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1 scroll-thin" role="tablist" aria-label="Report type">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={reportId === r.id}
            onClick={() => setReportId(r.id)}
            className={cn(
              'whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
              reportId === r.id ? 'border-sidebar bg-sidebar text-white shadow-lift ring-2 ring-accent/60' : 'border-line bg-card text-ink hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {reportId === 'sync' ? (
        <SyncReport />
      ) : reportId === 'history' ? (
        <Card>
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Sales record history"
            description="Record-level data is exported from the NPP Sales page (CSV or Excel, respecting filters). Each record's full change history is in its detail panel and in Audit Logs."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => navigate('/sales')}>
                  <FileSpreadsheet className="h-4 w-4" /> Open NPP Sales
                </Button>
                <Button variant="outline" onClick={() => navigate('/audit?action=sales')}>
                  <History className="h-4 w-4" /> Sales audit trail
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <FilterBar filters={filters} onChange={update} onReset={reset} />
          {isError && data && <StaleBanner message={friendlyError(error)} onRetry={() => refetch()} />}
          <Card>
            <CardHeader
              title={report.label}
              description={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{report.description}</span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" /> {describeFilters(filters).join(' · ')}
                  </span>
                  <span>Currencies: {currencies.map((c) => CURRENCY_LABEL[c]).join(', ') || '—'}</span>
                  {isFetching && <RefreshCw className="h-3 w-3 animate-spin text-brand" />}
                </span>
              }
              actions={
                <Dropdown>
                  <DropdownTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!pivoted.length}>
                      <Download className="h-3.5 w-3.5" /> Export
                    </Button>
                  </DropdownTrigger>
                  <DropdownContent>
                    <DropdownItem onSelect={() => void doExport('csv')}>CSV (.csv)</DropdownItem>
                    <DropdownItem onSelect={() => void doExport('xlsx')}>Excel (.xlsx)</DropdownItem>
                  </DropdownContent>
                </Dropdown>
              }
            />
            {isError && !data ? (
              <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
            ) : isLoading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-6" />
                ))}
              </div>
            ) : !pivoted.length ? (
              <EmptyState title="No records for these filters" />
            ) : (
              <div className="scroll-thin mt-3 max-h-[620px] overflow-auto">
                <table className="data-table w-full min-w-[720px] text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-y border-line bg-canvas text-left text-[11px] uppercase tracking-wide text-muted">
                      {exportCols.map((c, i) => (
                        <th key={c.header} className={cn('whitespace-nowrap px-4 py-2.5 font-medium', i > 0 && 'text-right')}>
                          {c.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pivoted.map((p) => (
                      <tr key={p.key} className="border-b border-line/60 ">
                        <td className="px-4 py-2 font-medium text-ink">{p.key}</td>
                        <td className="tabular px-4 py-2 text-right">{formatNumber(p.records)}</td>
                        {!shippingOnly &&
                          currencies.map((c) => (
                            <td key={c} className="tabular px-4 py-2 text-right">
                              {p.value[c] ? formatMoney(p.value[c], c) : '—'}
                            </td>
                          ))}
                        {currencies.map((c) => (
                          <td key={`s${c}`} className="tabular px-4 py-2 text-right text-muted">
                            {p.shipping[c] ? formatMoney(p.shipping[c], c) : '—'}
                          </td>
                        ))}
                        {!shippingOnly && <td className="tabular px-4 py-2 text-right font-medium">{formatMoney(p.inr, 'INR')}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="sticky bottom-0 border-t-2 border-navy/20 bg-card font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="tabular px-4 py-2.5 text-right">{formatNumber(totals.records)}</td>
                      {!shippingOnly &&
                        currencies.map((c) => (
                          <td key={c} className="tabular px-4 py-2.5 text-right">
                            {formatMoney(totals.value[c] ?? 0, c)}
                          </td>
                        ))}
                      {currencies.map((c) => (
                        <td key={`s${c}`} className="tabular px-4 py-2.5 text-right">
                          {formatMoney(totals.shipping[c] ?? 0, c)}
                        </td>
                      ))}
                      {!shippingOnly && <td className="tabular px-4 py-2.5 text-right">{formatMoney(totals.inr, 'INR')}</td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Card className="mt-6">
        <CardHeader title="Reporting definitions" description="How every figure is calculated" />
        <dl className="grid gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-2">
          {DEFINITIONS.map(([k, v]) => (
            <div key={k}>
              <dt className="flex items-center gap-1.5 font-medium text-navy">
                <Info className="h-3.5 w-3.5" /> {k}
              </dt>
              <dd className="mt-0.5 text-xs text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
