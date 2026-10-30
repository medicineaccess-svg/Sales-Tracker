import { z } from 'zod';

/**
 * Manual sales record form — the same columns as the NPM Sales sheet:
 * Date, Particulars, Product Name, Place of sale, Ikris Manager Involved, Zone,
 * Concerned Doctor name, Hospital Name, Quantity, INR Value.
 */

const optionalText = (max: number) => z.string().trim().max(max, `Maximum ${max} characters`);

export const UNITS = ['PACK', 'VIAL', 'PEN', 'BOX', 'INJ'] as const;

export const salesSchema = z.object({
  sale_date: z
    .string()
    .min(1, 'Date is required')
    .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)), 'Enter a valid date')
    .refine((s) => s >= '2000-01-01' && s <= new Date(Date.now() + 86_400_000 * 366).toISOString().slice(0, 10), 'Date is out of range'),
  particulars: z.string().trim().min(1, 'Particulars (customer / patient) is required').max(200),
  product_name: z.string().trim().min(1, 'Product name is required').max(200),
  place_of_sale: optionalText(120),
  manager: optionalText(120),
  zone: optionalText(80),
  doctor_name: optionalText(160),
  hospital_name: optionalText(200),
  quantity: z
    .string()
    .trim()
    .refine((s) => s === '' || (/^\d+(\.\d{1,3})?$/.test(s) && Number(s) > 0), 'Quantity must be a positive number'),
  quantity_unit: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => s === '' || /^[A-Z]{1,12}$/.test(s), 'Unit must be letters only (e.g. PACK)'),
  inr_value: z
    .string()
    .trim()
    .transform((s) => s.replace(/,/g, ''))
    .refine((s) => s !== '', 'INR Value is required')
    .refine((s) => s === '' || /^\d+(\.\d{1,2})?$/.test(s), 'INR Value must be a number with up to 2 decimals'),
  mark_reviewed: z.boolean(),
});

export type SalesFormValues = z.input<typeof salesSchema>;
export type SalesFormOutput = z.output<typeof salesSchema>;

export const emptySalesForm: SalesFormValues = {
  sale_date: new Date().toISOString().slice(0, 10),
  particulars: '',
  product_name: '',
  place_of_sale: '',
  manager: '',
  zone: '',
  doctor_name: '',
  hospital_name: '',
  quantity: '',
  quantity_unit: 'PACK',
  inr_value: '',
  mark_reviewed: false,
};

const nz = (s: string) => (s === '' ? null : s);

/**
 * Form output → database payload. Only the sheet's columns are written; fields carried over from the
 * previous sheet layout (voucher, rate, value, …) are never touched by an edit.
 */
export function toSalesPayload(v: SalesFormOutput, existingIssues: string[] = []) {
  return {
    sale_date: v.sale_date,
    particulars: v.particulars,
    product_name: v.product_name,
    place_of_sale: nz(v.place_of_sale),
    manager: nz(v.manager),
    zone: nz(v.zone),
    doctor_name: nz(v.doctor_name),
    hospital_name: nz(v.hospital_name),
    quantity: nz(v.quantity),
    quantity_unit: v.quantity ? nz(v.quantity_unit) : null,
    inr_value: v.inr_value,
    data_issues: v.mark_reviewed ? [] : existingIssues,
  };
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function salesToForm(r: Record<string, unknown>): SalesFormValues {
  return {
    sale_date: s(r.sale_date),
    particulars: s(r.particulars),
    product_name: s(r.product_name),
    place_of_sale: s(r.place_of_sale),
    manager: s(r.manager),
    zone: s(r.zone),
    doctor_name: s(r.doctor_name),
    hospital_name: s(r.hospital_name),
    quantity: s(r.quantity),
    quantity_unit: s(r.quantity_unit) || 'PACK',
    inr_value: s(r.inr_value),
    mark_reviewed: false,
  };
}
