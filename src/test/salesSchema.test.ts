import { describe, expect, it } from 'vitest';
import { emptySalesForm, salesSchema, suggestValue, toSalesPayload } from '@/lib/salesSchema';

const valid = {
  ...emptySalesForm,
  sale_date: '2026-04-01',
  particulars: 'Test Patient',
  product_name: 'Truqap 200 Mg',
  voucher_no: 'INV/IGL/26-27/900',
  quantity: '1',
  quantity_unit: 'pack',
  currency: 'USD' as const,
  rate: '6,200.00',
  value: '6200.00',
  shipping_charges: '700',
  shipping_charges_dc: 'Cr' as const,
  inr_value: '582800',
};

describe('sales form validation', () => {
  it('accepts a valid record and normalises values', () => {
    const r = salesSchema.parse(valid);
    expect(r.rate).toBe('6200.00');
    expect(r.quantity_unit).toBe('PACK');
  });
  it('requires the mandatory fields', () => {
    const r = salesSchema.safeParse({ ...emptySalesForm, sale_date: '' });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['sale_date', 'particulars', 'product_name', 'voucher_no', 'quantity', 'rate', 'value']));
  });
  it('rejects malformed numbers and dates', () => {
    expect(salesSchema.safeParse({ ...valid, value: '12.345' }).success).toBe(false);
    expect(salesSchema.safeParse({ ...valid, quantity: '-1' }).success).toBe(false);
    expect(salesSchema.safeParse({ ...valid, rate: '0' }).success).toBe(false);
    expect(salesSchema.safeParse({ ...valid, sale_date: '2026-02-31x' }).success).toBe(false);
  });
  it('builds a payload with business fields only (no provenance)', () => {
    const payload = toSalesPayload(salesSchema.parse(valid), ['missing_date']);
    expect(payload).not.toHaveProperty('source');
    expect(payload).not.toHaveProperty('source_key');
    expect(payload.gross_total).toBeNull();
    expect(payload.gross_total_dc).toBeNull();
    expect(payload.shipping_charges_dc).toBe('Cr');
    expect(payload.data_issues).toEqual(['missing_date']);
    expect(toSalesPayload(salesSchema.parse({ ...valid, mark_reviewed: true }), ['x']).data_issues).toEqual([]);
  });
  it('suggests value = quantity × rate exactly', () => {
    expect(suggestValue('14', '2680.00')).toBe('37520.00');
    expect(suggestValue('3', '2820.67')).toBe('8462.01');
    expect(suggestValue('1.5', '0.10')).toBe('0.15');
    expect(suggestValue('x', '1')).toBeNull();
  });
});
