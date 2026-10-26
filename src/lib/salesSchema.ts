import { z } from 'zod';

const decimal = (label: string, opts: { required?: boolean; positive?: boolean } = {}) =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/,/g, ''))
    .refine((s) => (opts.required ? s !== '' : true), `${label} is required`)
    .refine((s) => s === '' || /^\d+(\.\d{1,2})?$/.test(s), `${label} must be a number with up to 2 decimals`)
    .refine((s) => s === '' || !opts.positive || Number(s) > 0, `${label} must be greater than zero`);

const optionalText = (max: number) => z.string().trim().max(max, `Maximum ${max} characters`);

export const UNITS = ['PACK', 'VIAL', 'PEN', 'BOX', 'INJ'] as const;
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'] as const;

export const salesSchema = z.object({
  sale_date: z
    .string()
    .min(1, 'Date is required')
    .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)), 'Enter a valid date')
    .refine((s) => s >= '2000-01-01' && s <= new Date(Date.now() + 86_400_000 * 366).toISOString().slice(0, 10), 'Date is out of range'),
  particulars: z.string().trim().min(1, 'Customer / patient is required').max(200),
  product_name: z.string().trim().min(1, 'Product is required').max(200),
  place_of_sale: optionalText(120),
  manager: optionalText(120),
  doctor_name: optionalText(160),
  hospital_name: optionalText(200),
  voucher_no: z.string().trim().min(1, 'Voucher number is required').max(60),
  quantity: z
    .string()
    .trim()
    .min(1, 'Quantity is required')
    .refine((s) => /^\d+(\.\d{1,3})?$/.test(s) && Number(s) > 0, 'Quantity must be a positive number'),
  quantity_unit: z.string().trim().toUpperCase().regex(/^[A-Z]{1,12}$/, 'Unit must be letters only (e.g. PACK)'),
  currency: z.enum(CURRENCIES, { errorMap: () => ({ message: 'Choose a currency' }) }),
  rate: decimal('Rate', { required: true, positive: true }),
  value: decimal('Value', { required: true }),
  gross_total: decimal('Gross total'),
  gross_total_dc: z.enum(['', 'Dr', 'Cr']),
  export_sales: decimal('Export sales'),
  export_sales_dc: z.enum(['', 'Dr', 'Cr']),
  shipping_charges: decimal('Shipping charges'),
  shipping_charges_dc: z.enum(['', 'Dr', 'Cr']),
  inr_value: decimal('INR value'),
  remarks: optionalText(1000),
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
  doctor_name: '',
  hospital_name: '',
  voucher_no: '',
  quantity: '',
  quantity_unit: 'PACK',
  currency: 'USD',
  rate: '',
  value: '',
  gross_total: '',
  gross_total_dc: '',
  export_sales: '',
  export_sales_dc: '',
  shipping_charges: '',
  shipping_charges_dc: '',
  inr_value: '',
  remarks: '',
  mark_reviewed: false,
};

const nz = (s: string) => (s === '' ? null : s);

/** Form output → database payload (business fields only; provenance is set by the database). */
export function toSalesPayload(v: SalesFormOutput, existingIssues: string[] = []) {
  return {
    sale_date: v.sale_date,
    particulars: v.particulars,
    product_name: v.product_name,
    place_of_sale: nz(v.place_of_sale),
    manager: nz(v.manager),
    doctor_name: nz(v.doctor_name),
    hospital_name: nz(v.hospital_name),
    voucher_no: v.voucher_no,
    quantity: v.quantity,
    quantity_unit: v.quantity_unit,
    currency: v.currency,
    rate: v.rate,
    rate_unit: v.quantity_unit,
    value: v.value,
    gross_total: nz(v.gross_total),
    gross_total_dc: v.gross_total ? nz(v.gross_total_dc) : null,
    export_sales: nz(v.export_sales),
    export_sales_dc: v.export_sales ? nz(v.export_sales_dc) : null,
    shipping_charges: nz(v.shipping_charges),
    shipping_charges_dc: v.shipping_charges ? nz(v.shipping_charges_dc) : null,
    inr_value: nz(v.inr_value),
    remarks: nz(v.remarks),
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
    doctor_name: s(r.doctor_name),
    hospital_name: s(r.hospital_name),
    voucher_no: s(r.voucher_no),
    quantity: s(r.quantity),
    quantity_unit: s(r.quantity_unit) || 'PACK',
    currency: (r.currency as SalesFormValues['currency']) ?? ('' as unknown as 'USD'),
    rate: s(r.rate),
    value: s(r.value),
    gross_total: s(r.gross_total),
    gross_total_dc: (s(r.gross_total_dc) as '' | 'Dr' | 'Cr') ?? '',
    export_sales: s(r.export_sales),
    export_sales_dc: (s(r.export_sales_dc) as '' | 'Dr' | 'Cr') ?? '',
    shipping_charges: s(r.shipping_charges),
    shipping_charges_dc: (s(r.shipping_charges_dc) as '' | 'Dr' | 'Cr') ?? '',
    inr_value: s(r.inr_value),
    remarks: s(r.remarks),
    mark_reviewed: false,
  };
}

/** Quantity × rate rounded to 2 dp using integer arithmetic. */
export function suggestValue(quantity: string, rate: string): string | null {
  if (!/^\d+(\.\d{1,3})?$/.test(quantity) || !/^\d+(\.\d{1,2})?$/.test(rate)) return null;
  const [qi, qf = ''] = quantity.split('.');
  const [ri, rf = ''] = rate.split('.');
  const q = BigInt(qi + qf);
  const r = BigInt(ri + rf.padEnd(2, '0'));
  const scale = 10n ** BigInt(qf.length);
  const cents = (q * r + scale / 2n) / scale;
  const str = cents.toString().padStart(3, '0');
  return `${str.slice(0, -2)}.${str.slice(-2)}`;
}
