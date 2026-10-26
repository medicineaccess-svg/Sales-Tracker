import { describe, expect, it } from 'vitest';
import { formatDate, formatInrShort, formatMoney, formatMonth, toNumber } from '@/lib/format';

describe('formatting', () => {
  it('formats each currency in its own symbol — never converted', () => {
    expect(formatMoney(6200, 'USD')).toBe('$6,200.00');
    expect(formatMoney('1150.00', 'EUR')).toBe('€1,150.00');
    expect(formatMoney(582800, 'INR')).toBe('₹5,82,800');
    expect(formatMoney(null, 'USD')).toBe('—');
  });
  it('labels amounts without a currency neutrally', () => {
    expect(formatMoney(999, 'UNSPECIFIED')).toBe('999.00');
  });
  it('formats INR in lakh/crore', () => {
    expect(formatInrShort(211488710)).toBe('₹21.15 Cr');
    expect(formatInrShort(582800)).toBe('₹5.83 L');
  });
  it('formats dates without timezone shifts', () => {
    expect(formatDate('2026-04-01')).toBe('01 Apr 2026');
    expect(formatMonth('2026-09')).toBe('Sep 26');
    expect(formatDate(null)).toBe('—');
  });
  it('parses numeric strings safely', () => {
    expect(toNumber('6200.00')).toBe(6200);
    expect(toNumber('abc')).toBeNull();
    expect(toNumber('')).toBeNull();
  });
});
