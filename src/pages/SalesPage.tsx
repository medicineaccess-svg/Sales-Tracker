import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, FileSpreadsheet, Plus, Search, TriangleAlert } from 'lucide-react';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { SalesDetailDrawer } from '@/components/sales/SalesDetailDrawer';
import { SalesFormDialog } from '@/components/sales/SalesFormDialog';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Dropdown, DropdownCheckItem, DropdownContent, DropdownItem, DropdownLabel, DropdownTrigger } from '@/components/ui/dropdown';
import { EmptyState, ErrorState, Skeleton, StaleBanner } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { fetchAllFilteredSales, useSalesPage, type SortKey } from '@/hooks/useData';
import { useDebounce, useFilters } from '@/hooks/useFilters';
import { describeFilters, activeFilterCount } from '@/lib/filters';
import { downloadCsv, downloadXlsx, stamp, type ExportColumn } from '@/lib/export';
import { friendlyError, notify } from '@/lib/errors';
import { formatDate, formatMoney, formatNumber, toNumber } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { NppSale } from '@/types/database';

interface Column {
  id: string;
  label: string;
  sort?: SortKey;
  align?: 'right';
  render: (r: NppSale) => ReactNode;
  defaultVisible?: boolean;
}

const COLUMNS: Column[] = [
  { id: 'date', label: 'Date', sort: 'sale_date', render: (r) => (r.sale_date ? formatDate(r.sale_date) : <span className="text-[#8a5410]">No date</span>), defaultVisible: true },
  { id: 'voucher', label: 'Voucher', render: (r) => <span className="font-mono text-[11px]">{r.voucher_no ?? '—'}</span>, defaultVisible: true },
  { id: 'particulars', label: 'Particulars', render: (r) => r.particulars, defaultVisible: true },
  { id: 'product', label: 'Product', sort: 'product_name', render: (r) => r.product_name, defaultVisible: true },
  { id: 'place', label: 'Place', render: (r) => r.place_of_sale ?? '—' },
  { id: 'manager', label: 'Manager', sort: 'manager', render: (r) => r.manager ?? '—', defaultVisible: true },
  { id: 'doctor', label: 'Doctor', render: (r) => r.doctor_name ?? '—' },
  { id: 'hospital', label: 'Hospital', sort: 'hospital_name', render: (r) => r.hospital_name ?? '—', defaultVisible: true },
  { id: 'quantity', label: 'Qty', sort: 'quantity', align: 'right', render: (r) => (r.quantity !== null ? `${formatNumber(r.quantity, 3)} ${r.quantity_unit ?? ''}` : '—'), defaultVisible: true },
  { id: 'rate', label: 'Rate', align: 'right', render: (r) => formatMoney(r.rate, r.currency ?? 'UNSPECIFIED') },
  { id: 'value', label: 'Value', sort: 'value', align: 'right', render: (r) => formatMoney(r.value, r.currency ?? 'UNSPECIFIED'), defaultVisible: true },
  { id: 'shipping', label: 'Shipping', align: 'right', render: (r) => formatMoney(r.shipping_charges, r.currency ?? 'UNSPECIFIED') },
  { id: 'inr', label: 'INR value', sort: 'inr_value', align: 'right', render: (r) => formatMoney(r.inr_value, 'INR'), defaultVisible: true },
];

const COLS_KEY = 'ikris.sales.columns';

const EXPORT_COLUMNS: ExportColumn<NppSale>[] = [
  { header: 'Date', value: (r) => r.sale_date, width: 12 },
  { header: 'Particulars', value: (r) => r.particulars, width: 28 },
  { header: 'Product Name', value: (r) => r.product_name, width: 26 },
  { header: 'Place of sale', value: (r) => r.place_of_sale },
  { header: 'Ikris Manager Involved', value: (r) => r.manager },
  { header: 'Concerned Doctor name', value: (r) => r.doctor_name, width: 24 },
  { header: 'Hospital Name', value: (r) => r.hospital_name, width: 28 },
  { header: 'Voucher No.', value: (r) => r.voucher_no, width: 20 },
  { header: 'Quantity', value: (r) => toNumber(r.quantity), numFmt: '#,##0.###' },
  { header: 'Unit', value: (r) => r.quantity_unit },
  { header: 'Currency', value: (r) => r.currency ?? 'Not stated' },
  { header: 'Rate', value: (r) => toNumber(r.rate), numFmt: '#,##0.00' },
  { header: 'Value', value: (r) => toNumber(r.value), numFmt: '#,##0.00' },
  { header: 'Gross Total', value: (r) => toNumber(r.gross_total), numFmt: '#,##0.00' },
  { header: 'Gross Dr/Cr', value: (r) => r.gross_total_dc },
  { header: 'Export Sales', value: (r) => toNumber(r.export_sales), numFmt: '#,##0.00' },
  { header: 'Export Dr/Cr', value: (r) => r.export_sales_dc },
  { header: 'Shipping Charges', value: (r) => toNumber(r.shipping_charges), numFmt: '#,##0.00' },
  { header: 'INR Value', value: (r) => toNumber(r.inr_value), numFmt: '#,##0' },
  { header: 'Source', value: (r) => (r.source === 'google_sheets' ? 'Google Sheets' : 'CRM') },
  { header: 'Data issues', value: (r) => r.data_issues.join('; '), width: 30 },
  { header: 'Status', value: (r) => r.status },
];

export function SalesPage() {
  const { filters, update, reset } = useFilters();
  const [search, setSearch] = useState(filters.search ?? '');
  const debounced = useDebounce(search, 350);
  const [sort, setSort] = useState<SortKey>('sale_date');
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(COLS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore */
    }
    return Object.fromEntries(COLUMNS.map((c) => [c.id, !!c.defaultVisible]));
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(visible));
    } catch {
      /* ignore */
    }
  }, [visible]);

  useEffect(() => {
    if ((debounced || undefined) !== filters.search) update({ search: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setSearch(filters.search ?? ''), [filters.search]);
  useEffect(() => setPage(0), [filters, sort, ascending, pageSize]);

  const { data, isLoading, isError, error, refetch, isFetching } = useSalesPage({ filters, sort, ascending, page, pageSize });
  const cols = useMemo(() => COLUMNS.filter((c) => visible[c.id] !== false), [visible]);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAscending((a) => !a);
    else {
      setSort(key);
      setAscending(key === 'manager' || key === 'hospital_name' || key === 'product_name');
    }
  };

  const doExport = async (kind: 'csv' | 'xlsx') => {
    setExporting(kind);
    try {
      const rows = await fetchAllFilteredSales(filters);
      if (!rows.length) {
        notify.warning('There are no records to export for these filters.');
        return;
      }
      const preamble = [
        'Ikris Pharma Network — NPP sales export',
        `Generated ${new Date().toLocaleString('en-IN')}`,
        `Filters: ${describeFilters(filters).join(' · ')}`,
        'Values are in the currency shown per row; INR Value is source-reported.',
      ];
      const name = `npp-sales-${stamp()}.${kind}`;
      if (kind === 'csv') downloadCsv(name, rows, EXPORT_COLUMNS, preamble);
      else await downloadXlsx(name, 'NPP Sales', rows, EXPORT_COLUMNS, preamble);
      void supabase.rpc('log_client_event', {
        p_action: 'sales.export',
        p_department_code: 'npp',
        p_metadata: { format: kind, rows: rows.length, filter_keys: Object.keys(filters) },
      });
      notify.success(`Exported ${rows.length} records`);
    } catch (e) {
      notify.error(friendlyError(e, 'Export failed.'));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="NPP Sales"
        description="Every NPP sales record stored in the CRM — imported from Google Sheets or entered here."
        actions={
          <>
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="outline" loading={!!exporting}>
                  {!exporting && <Download className="h-4 w-4" />} Export
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownLabel>Export filtered records</DropdownLabel>
                <DropdownItem icon={<Download className="h-4 w-4" />} onSelect={() => void doExport('csv')}>
                  CSV (.csv)
                </DropdownItem>
                <DropdownItem icon={<FileSpreadsheet className="h-4 w-4" />} onSelect={() => void doExport('xlsx')}>
                  Excel (.xlsx)
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add Sales
            </Button>
          </>
        }
      />

      <FilterBar
        filters={filters}
        onChange={update}
        onReset={() => {
          setSearch('');
          reset();
        }}
        fields={['fy', 'month', 'dates', 'product', 'manager', 'hospital', 'doctor', 'place', 'voucher', 'currency', 'review']}
      />

      {isError && data && <StaleBanner message={friendlyError(error)} onRetry={() => refetch()} />}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Search sales</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search particulars, product, doctor, hospital, manager, voucher…" className="h-9 pl-9" />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#226192]"
              checked={!!filters.include_archived}
              onChange={(e) => update({ include_archived: e.target.checked || undefined })}
            />
            Include archived
          </label>
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="h-3.5 w-3.5" /> Columns
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownLabel>Visible columns</DropdownLabel>
              {COLUMNS.map((c) => (
                <DropdownCheckItem key={c.id} checked={visible[c.id] !== false} onCheckedChange={(v) => setVisible((s) => ({ ...s, [c.id]: v }))}>
                  {c.label}
                </DropdownCheckItem>
              ))}
            </DropdownContent>
          </Dropdown>
          <span className="text-xs text-muted" aria-live="polite">
            {data ? `${formatNumber(data.total)} record${data.total === 1 ? '' : 's'}` : ''}
            {isFetching && !isLoading ? ' · updating…' : ''}
          </span>
        </div>

        {isError && !data ? (
          <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="data-table w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
                  {cols.map((c) => (
                    <th key={c.id} scope="col" className={cn('whitespace-nowrap px-4 py-3 font-medium', c.align === 'right' && 'text-right')} aria-sort={c.sort && sort === c.sort ? (ascending ? 'ascending' : 'descending') : undefined}>
                      {c.sort ? (
                        <button type="button" onClick={() => toggleSort(c.sort!)} className={cn('inline-flex items-center gap-1 hover:text-navy', sort === c.sort && 'text-navy')}>
                          {c.label}
                          {sort === c.sort ? ascending ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                  <th className="w-8 px-2" aria-label="Flags" />
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-line/60">
                      {cols.map((c) => (
                        <td key={c.id} className="px-4 py-3">
                          <Skeleton className="h-4" />
                        </td>
                      ))}
                      <td />
                    </tr>
                  ))}
                {data?.rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => setSelected(r.id)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSelected(r.id))}
                    className={cn(
                      'cursor-pointer border-b border-line/60 transition-colors focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                      r.status === 'archived' && 'opacity-60',
                    )}
                  >
                    {cols.map((c) => (
                      <td key={c.id} className={cn('tabular max-w-60 truncate whitespace-nowrap px-4 py-2.5', c.align === 'right' && 'text-right')}>
                        {c.render(r)}
                      </td>
                    ))}
                    <td className="px-2">
                      {(r.needs_review || r.pending_source) && (
                        <TriangleAlert className={cn('h-4 w-4', r.pending_source ? 'text-danger' : 'text-[#8a5410]')} aria-label={r.pending_source ? 'Sync conflict' : 'Needs review'} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && data.rows.length === 0 && (
              <EmptyState
                title={activeFilterCount(filters) ? 'No records match these filters' : 'No sales records yet'}
                description={activeFilterCount(filters) ? 'Try clearing a filter or the search.' : 'Import from Google Sheets or add a sale to get started.'}
                action={
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> Add Sales
                  </Button>
                }
              />
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted">
          <label className="flex items-center gap-2">
            Rows per page
            <Select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-8 w-20 text-xs">
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex items-center gap-2">
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      <SalesFormDialog open={adding} onOpenChange={setAdding} />
      <SalesDetailDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
