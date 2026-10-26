import { describe, expect, it } from 'vitest';
import { describeFilters, filtersFromParams, filtersToParams, fyOf, fyRange, monthRange, toRpcFilters } from '@/lib/filters';

describe('Indian financial year helpers', () => {
  it('maps a FY label to 1 April – 31 March', () => {
    expect(fyRange('FY 2026-27')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });
  it('finds the FY of a date', () => {
    expect(fyOf('2026-04-01')).toBe('FY 2026-27');
    expect(fyOf('2027-03-31')).toBe('FY 2026-27');
    expect(fyOf('2026-03-31')).toBe('FY 2025-26');
  });
  it('computes month ranges including leap years', () => {
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });
});

describe('toRpcFilters', () => {
  it('intersects FY, month and explicit dates', () => {
    expect(toRpcFilters({ fy: 'FY 2026-27', month: '2026-05' })).toEqual({ date_from: '2026-05-01', date_to: '2026-05-31' });
    expect(toRpcFilters({ fy: 'FY 2026-27', date_from: '2026-06-15' })).toEqual({ date_from: '2026-06-15', date_to: '2027-03-31' });
  });
  it('drops empty values and trims text', () => {
    expect(toRpcFilters({ product: '  Kineret ', manager: '', voucher: undefined })).toEqual({ product: 'Kineret' });
  });
  it('passes booleans through', () => {
    expect(toRpcFilters({ needs_review: false, include_archived: true })).toEqual({ needs_review: false, include_archived: true });
  });
});

describe('URL round trip', () => {
  it('serialises and parses filters', () => {
    const f = { fy: 'FY 2026-27', product: 'Truqap 200 Mg', needs_review: true };
    expect(filtersFromParams(filtersToParams(f))).toEqual(f);
  });
  it('describes filters for reports', () => {
    expect(describeFilters({})).toEqual(['All active records']);
    expect(describeFilters({ manager: 'Firoz' })).toContain('Manager: Firoz');
  });
});
