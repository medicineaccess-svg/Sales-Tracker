import { useEffect, useState } from 'react';
import { Filter, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { useFilterOptions } from '@/hooks/useData';
import { useDebounce } from '@/hooks/useFilters';
import { activeFilterCount, type SalesFilters } from '@/lib/filters';
import { CURRENCY_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

type FieldKey = 'fy' | 'month' | 'dates' | 'product' | 'manager' | 'hospital' | 'doctor' | 'place' | 'voucher' | 'currency' | 'review';

const ALL: FieldKey[] = ['fy', 'month', 'dates', 'product', 'manager', 'hospital', 'doctor', 'place', 'voucher', 'currency'];

function OptionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options: string[] | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="h-9 text-xs">
        <option value="">All</option>
        {(options ?? []).slice().sort((a, b) => a.localeCompare(b)).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function FilterBar({
  filters,
  onChange,
  onReset,
  fields = ALL,
  className,
}: {
  filters: SalesFilters;
  onChange: (patch: Partial<SalesFilters>) => void;
  onReset: () => void;
  fields?: FieldKey[];
  className?: string;
}) {
  const { data: opts } = useFilterOptions();
  const [open, setOpen] = useState(false);
  const [voucher, setVoucher] = useState(filters.voucher ?? '');
  const debouncedVoucher = useDebounce(voucher);
  const count = activeFilterCount(filters);
  const has = (f: FieldKey) => fields.includes(f);

  useEffect(() => {
    if ((debouncedVoucher || undefined) !== filters.voucher) onChange({ voucher: debouncedVoucher || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedVoucher]);
  useEffect(() => setVoucher(filters.voucher ?? ''), [filters.voucher]);

  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted';

  return (
    <section aria-label="Filters" className={cn('mb-6 rounded-2xl border border-line/70 bg-card p-4 shadow-card', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-navy">
          <Filter className="h-4 w-4" aria-hidden /> Filters
          {count > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">{count}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} className="lg:hidden" aria-expanded={open}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> {open ? 'Hide' : 'Show'}
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} disabled={count === 0}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>
      <div className={cn('mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-8', !open && 'hidden lg:grid')}>
        {has('fy') && (
          <label>
            <span className={label}>Financial year</span>
            <Select value={filters.fy ?? ''} onChange={(e) => onChange({ fy: e.target.value || undefined })} className="h-9 text-xs">
              <option value="">All years</option>
              {(opts?.financial_years ?? []).map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('month') && (
          <label>
            <span className={label}>Month</span>
            <Input type="month" value={filters.month ?? ''} onChange={(e) => onChange({ month: e.target.value || undefined })} className="h-9 text-xs" />
          </label>
        )}
        {has('dates') && (
          <>
            <label>
              <span className={label}>From</span>
              <Input
                type="date"
                value={filters.date_from ?? ''}
                max={filters.date_to}
                onChange={(e) => onChange({ date_from: e.target.value || undefined })}
                className="h-9 text-xs"
              />
            </label>
            <label>
              <span className={label}>To</span>
              <Input
                type="date"
                value={filters.date_to ?? ''}
                min={filters.date_from}
                onChange={(e) => onChange({ date_to: e.target.value || undefined })}
                className="h-9 text-xs"
              />
            </label>
          </>
        )}
        {has('product') && <OptionSelect label="Product" value={filters.product} options={opts?.products} onChange={(v) => onChange({ product: v })} />}
        {has('manager') && <OptionSelect label="Manager" value={filters.manager} options={opts?.managers} onChange={(v) => onChange({ manager: v })} />}
        {has('hospital') && <OptionSelect label="Hospital" value={filters.hospital} options={opts?.hospitals} onChange={(v) => onChange({ hospital: v })} />}
        {has('doctor') && <OptionSelect label="Doctor" value={filters.doctor} options={opts?.doctors} onChange={(v) => onChange({ doctor: v })} />}
        {has('place') && <OptionSelect label="Place of sale" value={filters.place} options={opts?.places} onChange={(v) => onChange({ place: v })} />}
        {has('voucher') && (
          <label>
            <span className={label}>Voucher no.</span>
            <Input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="e.g. 26-27/041" className="h-9 text-xs" />
          </label>
        )}
        {has('currency') && (
          <label>
            <span className={label}>Currency</span>
            <Select
              value={filters.currency ?? ''}
              onChange={(e) => onChange({ currency: (e.target.value || undefined) as SalesFilters['currency'] })}
              className="h-9 text-xs"
            >
              <option value="">All currencies</option>
              {(opts?.currencies ?? []).map((c) => (
                <option key={c} value={c}>
                  {CURRENCY_LABEL[c]}
                </option>
              ))}
            </Select>
          </label>
        )}
        {has('review') && (
          <label>
            <span className={label}>Data quality</span>
            <Select
              value={filters.needs_review === undefined ? '' : String(filters.needs_review)}
              onChange={(e) => onChange({ needs_review: e.target.value === '' ? undefined : e.target.value === 'true' })}
              className="h-9 text-xs"
            >
              <option value="">All records</option>
              <option value="true">Needs review</option>
              <option value="false">No issues</option>
            </Select>
          </label>
        )}
      </div>
    </section>
  );
}
