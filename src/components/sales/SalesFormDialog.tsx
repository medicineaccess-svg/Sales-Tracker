import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { useFilterOptions } from '@/hooks/useData';
import { friendlyError, notify } from '@/lib/errors';
import {
  UNITS,
  emptySalesForm,
  salesSchema,
  salesToForm,
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
    formState: { errors, isDirty },
  } = useForm<SalesFormValues, unknown, SalesFormOutput>({
    resolver: zodResolver(salesSchema),
    defaultValues: emptySalesForm,
  });

  useEffect(() => {
    if (open) reset(record ? salesToForm(record as unknown as Record<string, unknown>) : emptySalesForm);
  }, [open, record, reset]);

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

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}
      title={editing ? 'Edit sales record' : 'Add sales record'}
      description={
        editing && record?.source === 'google_sheets'
          ? 'This record was imported from Google Sheets. Saving marks it as edited in the CRM; later sheet changes will be held for review instead of overwriting it.'
          : 'Same columns as the NPM Sales sheet. INR Value is stored exactly as entered.'
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
        <datalist id="dl-zones">{(opts?.zones ?? []).map((p) => <option key={p} value={p} />)}</datalist>

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Sale</legend>
          <Field label="Date" htmlFor="sale_date" required error={errors.sale_date?.message}>
            <Input id="sale_date" type="date" {...register('sale_date')} aria-invalid={!!errors.sale_date} />
          </Field>
          <Field label="Particulars" htmlFor="particulars" required error={errors.particulars?.message}>
            <Input id="particulars" autoComplete="off" {...register('particulars')} aria-invalid={!!errors.particulars} />
          </Field>
          <Field label="Product Name" htmlFor="product_name" required error={errors.product_name?.message}>
            <Input id="product_name" list="dl-products" {...register('product_name')} aria-invalid={!!errors.product_name} />
          </Field>
          <Field label="Place of sale" htmlFor="place_of_sale" error={errors.place_of_sale?.message}>
            <Input id="place_of_sale" list="dl-places" {...register('place_of_sale')} />
          </Field>
          <Field label="Ikris Manager Involved" htmlFor="manager" error={errors.manager?.message}>
            <Input id="manager" list="dl-managers" {...register('manager')} />
          </Field>
          <Field
            label="Zone"
            htmlFor="zone"
            error={errors.zone?.message}
            hint="For HO sales write the manager in brackets, e.g. HO North Zone (Firoz)."
          >
            <Input id="zone" list="dl-zones" {...register('zone')} />
          </Field>
          <Field label="Concerned Doctor name" htmlFor="doctor_name" error={errors.doctor_name?.message}>
            <Input id="doctor_name" list="dl-doctors" {...register('doctor_name')} />
          </Field>
          <Field label="Hospital Name" htmlFor="hospital_name" error={errors.hospital_name?.message} className="sm:col-span-2">
            <Input id="hospital_name" list="dl-hospitals" {...register('hospital_name')} />
          </Field>
          <Field label="Quantity" htmlFor="quantity" error={errors.quantity?.message}>
            <div className="flex gap-2">
              <Input id="quantity" inputMode="decimal" {...register('quantity')} aria-invalid={!!errors.quantity} />
              <Input list="dl-units" className="w-24 shrink-0" aria-label="Unit" {...register('quantity_unit')} />
              <datalist id="dl-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
            {errors.quantity_unit && <p className="mt-1 text-xs text-danger">{errors.quantity_unit.message}</p>}
          </Field>
          <Field label="INR Value" htmlFor="inr_value" required error={errors.inr_value?.message}>
            <Input id="inr_value" inputMode="decimal" {...register('inr_value')} aria-invalid={!!errors.inr_value} />
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
