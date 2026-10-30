import { describe, expect, it } from 'vitest';
import { emptySalesForm, salesSchema, salesToForm, toSalesPayload } from '@/lib/salesSchema';

const valid = {
  ...emptySalesForm,
  sale_date: '2026-04-01',
  particulars: 'Test Patient',
  product_name: 'Truqap 200 Mg',
  manager: 'Firoz',
  zone: 'North Zone',
  quantity: '1',
  quantity_unit: 'pack',
  inr_value: '5,82,800',
};

describe('sales form validation (sheet columns only)', () => {
  it('accepts a valid record and normalises values', () => {
    const r = salesSchema.parse(valid);
    expect(r.inr_value).toBe('582800');
    expect(r.quantity_unit).toBe('PACK');
  });
  it('requires date, particulars, product and INR value', () => {
    const r = salesSchema.safeParse({ ...emptySalesForm, sale_date: '' });
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['sale_date', 'particulars', 'product_name', 'inr_value']));
    expect(paths).not.toContain('quantity');
  });
  it('rejects malformed numbers and dates', () => {
    expect(salesSchema.safeParse({ ...valid, inr_value: '12.345' }).success).toBe(false);
    expect(salesSchema.safeParse({ ...valid, quantity: '-1' }).success).toBe(false);
    expect(salesSchema.safeParse({ ...valid, sale_date: '2026-02-31x' }).success).toBe(false);
  });
  it('writes only the sheet columns (no provenance, no legacy voucher/rate/value fields)', () => {
    const payload = toSalesPayload(salesSchema.parse(valid), ['missing_date']);
    expect(Object.keys(payload).sort()).toEqual(
      ['data_issues', 'doctor_name', 'hospital_name', 'inr_value', 'manager', 'particulars', 'place_of_sale', 'product_name', 'quantity', 'quantity_unit', 'sale_date', 'zone'].sort(),
    );
    expect(payload.zone).toBe('North Zone');
    expect(payload.data_issues).toEqual(['missing_date']);
    expect(toSalesPayload(salesSchema.parse({ ...valid, mark_reviewed: true }), ['x']).data_issues).toEqual([]);
  });
  it('round-trips a stored record into the form', () => {
    const f = salesToForm({ sale_date: '2026-05-01', particulars: 'A', product_name: 'B', zone: 'HO North Zone (Firoz)', quantity: 2, inr_value: '100.00' });
    expect(f.zone).toBe('HO North Zone (Firoz)');
    expect(f.quantity).toBe('2');
  });
});
