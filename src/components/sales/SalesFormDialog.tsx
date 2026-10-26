import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator } from 'lucide-react';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useFilterOptions } from '@/hooks/useData';
import { useDebounce } from '@/hooks/useFilters';
import { friendlyError, notify } from '@/lib/errors';
import {
  CURRENCIES,
  UNITS,
  emptySalesForm,
  salesSchema,
  salesToForm,
  suggestValue,
  toSalesPayload,
  type SalesFormOutput,
  type SalesFormValues,
} from '@/lib/salesSchema';
import { supabase } from '@/lib/supabase';
import { DATA_ISSUE_LABELS, type DataIssue } from '@shared/npp-parser';
import type { NppSale } from '@/types/database';

export function SalesFormDialog({
  open,
  onOpenChange,
  record,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record?: NppSale | null;
}) {
  const editing = !!record;
  const qc = useQueryClient();
  const { data: opts } = useFilterOptions();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<SalesFormValues, unknown, SalesFormOutput>({
    resolver: zodResolver(salesSchema),
    defaultValues: emptySalesForm,
  });

  useEffect(() => {
    if (open) reset(record ? salesToForm(record as unknown as Record<string, unknown>) : emptySalesForm);
  }, [open, record, reset]);

  // Duplicate voucher warning (non-blocking — the sheet itself contains legitimate edge cases)
  const voucher = useDebounce(watch('voucher_no')?.trim() ?? '', 400);
  const [duplicate, setDuplicate] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!open || !voucher) {
      setDuplicate(false);
      return;
    }
    let q = supabase.from('npp_sales').select('id', { count: 'exact', head: true }).ilike('voucher_no', voucher.replace(/[%_]/g, '\\$&'));
    if (record?.id) q = q.neq('id', record.id);
    q.then(({ count }) => !cancelled && setDuplicate((count ?? 0) > 0));
    return () => {
      cancelled = true;
    };
  }, [voucher, open, record?.id]);

  const quantity = watch('quantity');
  const rate = watch('rate');
  const suggested = suggestValue(quantity ?? '', (rate ?? '').replace(/,/g, ''));

  const mutation = useMutation({
    mutationFn: async (v: SalesFormOutput) => {
      const payload = toSalesPayload(v, record?.data_issues ?? []);
      if (editing) {
        const { error } = await supabase.from('npp_sales').update(payload).eq('id', record!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('npp_sales').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      // Notify only after the database confirmed the write
      notify.success(editing ? 'Sales record updated' : 'Sales record created');
      await qc.invalidateQueries({ queryKey: ['npp'] });
      await qc.invalidateQueries({ queryKey: ['audit'] });
      onOpenChange(false);
    },
    onError: (e) => notify.error(friendlyError(e, editing ? 'Could not update the record.' : 'Could not create the record.')),
  });

  const issues = (record?.data_issues ?? []) as DataIssue[];

  const dcSelect = (name: 'gross_total_dc' | 'export_sales_dc' | 'shipping_charges_dc') => (
    <Select {...register(name)} className="w-20 shrink-0" aria-label="Dr / Cr">
      <option value="">—</option>
      <option value="Dr">Dr</option>
      <option value="Cr">Cr</option>
    </Select>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}
      title={editing ? 'Edit sales record' : 'Add sales record'}
      description={
        editing && record?.source === 'google_sheets'
          ? 'This record was imported from Google Sheets. Saving marks it as edited in the CRM; later sheet changes will be held for review instead of overwriting it.'
          : 'All amounts are stored exactly as entered, in the selected currency.'
      }
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button form="sales-form" type="submit" loading={mutation.isPending} disabled={editing && !isDirty}>
            {editing ? 'Save changes' : 'Create record'}
          </Button>
        </>
      }
    >
      <form id="sales-form" noValidate onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
        <datalist id="dl-products">{opts?.products.map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="dl-managers">{opts?.managers.map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="dl-hospitals">{opts?.hospitals.map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="dl-doctors">{opts?.doctors.map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="dl-places">{opts?.places.map((p) => <option key={p} value={p} />)}</datalist>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Sale</legend>
          <Field label="Date" htmlFor="sale_date" required error={errors.sale_date?.message}>
            <Input id="sale_date" type="date" {...register('sale_date')} aria-invalid={!!errors.sale_date} />
          </Field>
          <Field
            label="Voucher no."
            htmlFor="voucher_no"
            required
            error={errors.voucher_no?.message}
            hint={
              duplicate ? (
                <span className="inline-flex items-center gap-1 text-[#8a5410]">
                  <AlertTriangle className="h-3 w-3" /> Another record already uses this voucher number
                </span>
              ) : undefined
            }
          >
            <Input id="voucher_no" placeholder="INV/IGL/26-27/001" {...register('voucher_no')} aria-invalid={!!errors.voucher_no} />
          </Field>
          <Field label="Customer / patient (Particulars)" htmlFor="particulars" required error={errors.particulars?.message}>
            <Input id="particulars" autoComplete="off" {...register('particulars')} aria-invalid={!!errors.particulars} />
          </Field>
          <Field label="Product name" htmlFor="product_name" required error={errors.product_name?.message}>
            <Input id="product_name" list="dl-products" {...register('product_name')} aria-invalid={!!errors.product_name} />
          </Field>
          <Field label="Place of sale" htmlFor="place_of_sale" error={errors.place_of_sale?.message}>
            <Input id="place_of_sale" list="dl-places" {...register('place_of_sale')} />
          </Field>
          <Field label="Ikris manager involved" htmlFor="manager" error={errors.manager?.message}>
            <Input id="manager" list="dl-managers" {...register('manager')} />
          </Field>
          <Field label="Concerned doctor" htmlFor="doctor_name" error={errors.doctor_name?.message}>
            <Input id="doctor_name" list="dl-doctors" {...register('doctor_name')} />
          </Field>
          <Field label="Hospital" htmlFor="hospital_name" error={errors.hospital_name?.message} className="sm:col-span-2">
            <Input id="hospital_name" list="dl-hospitals" {...register('hospital_name')} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Quantity & value</legend>
          <Field label="Quantity" htmlFor="quantity" required error={errors.quantity?.message}>
            <div className="flex gap-2">
              <Input id="quantity" inputMode="decimal" {...register('quantity')} aria-invalid={!!errors.quantity} />
              <Input list="dl-units" className="w-24 shrink-0" aria-label="Unit" {...register('quantity_unit')} />
              <datalist id="dl-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
            {errors.quantity_unit && <p className="mt-1 text-xs text-danger">{errors.quantity_unit.message}</p>}
          </Field>
          <Field label="Currency" htmlFor="currency" required error={errors.currency?.message}>
            <Select id="currency" {...register('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rate (per unit)" htmlFor="rate" required error={errors.rate?.message}>
            <Input id="rate" inputMode="decimal" {...register('rate')} aria-invalid={!!errors.rate} />
          </Field>
          <Field
            label="Value"
            htmlFor="value"
            required
            error={errors.value?.message}
            hint={
              suggested ? (
                <button type="button" className="inline-flex items-center gap-1 text-brand hover:underline" onClick={() => setValue('value', suggested, { shouldDirty: true, shouldValidate: true })}>
                  <Calculator className="h-3 w-3" /> Use quantity × rate = {suggested}
                </button>
              ) : undefined
            }
          >
            <Input id="value" inputMode="decimal" {...register('value')} aria-invalid={!!errors.value} />
          </Field>
          <Field label="INR value (as reported)" htmlFor="inr_value" error={errors.inr_value?.message} hint="Enter the reported INR figure — the CRM does not convert currencies.">
            <Input id="inr_value" inputMode="decimal" {...register('inr_value')} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Accounting (optional)</legend>
          <Field label="Gross total" htmlFor="gross_total" error={errors.gross_total?.message}>
            <div className="flex gap-2">
              <Input id="gross_total" inputMode="decimal" {...register('gross_total')} />
              {dcSelect('gross_total_dc')}
            </div>
          </Field>
          <Field label="Export sales" htmlFor="export_sales" error={errors.export_sales?.message}>
            <div className="flex gap-2">
              <Input id="export_sales" inputMode="decimal" {...register('export_sales')} />
              {dcSelect('export_sales_dc')}
            </div>
          </Field>
          <Field label="Shipping charges" htmlFor="shipping_charges" error={errors.shipping_charges?.message}>
            <div className="flex gap-2">
              <Input id="shipping_charges" inputMode="decimal" {...register('shipping_charges')} />
              {dcSelect('shipping_charges_dc')}
            </div>
          </Field>
          <Field label="Remarks" htmlFor="remarks" error={errors.remarks?.message} className="sm:col-span-3">
            <Textarea id="remarks" rows={2} {...register('remarks')} />
          </Field>
        </fieldset>

        {editing && issues.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="mb-2 flex items-center gap-2 font-medium text-[#6b3f0a]">
              <AlertTriangle className="h-4 w-4" /> Data-quality flags from the sheet
            </p>
            <ul className="ml-6 list-disc space-y-0.5 text-xs text-[#6b3f0a]">
              {issues.map((i) => (
                <li key={i}>{DATA_ISSUE_LABELS[i] ?? i}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-center gap-2 text-xs font-medium text-ink">
              <input type="checkbox" className="h-4 w-4 accent-[#226192]" {...register('mark_reviewed')} />
              I have checked this record — clear the flags
            </label>
          </div>
        )}
      </form>
    </Modal>
  );
}
