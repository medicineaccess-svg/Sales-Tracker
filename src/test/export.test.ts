import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/export';

describe('CSV export', () => {
  const cols = [
    { header: 'Name', value: (r: { n: string; v: number | null }) => r.n },
    { header: 'Value', value: (r: { n: string; v: number | null }) => r.v },
  ];
  it('quotes commas, quotes and newlines and keeps UTF-8 BOM', () => {
    const csv = toCsv([{ n: 'A, "B"', v: 1 }, { n: 'line\nbreak', v: null }], cols);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"A, ""B"""');
    expect(csv).toContain('"line\nbreak",');
  });
  it('neutralises spreadsheet formula injection', () => {
    const csv = toCsv([{ n: '=HYPERLINK("x")', v: 2 }], cols);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('writes the filter preamble before the header', () => {
    const csv = toCsv([], cols, ['Report', 'Filters: All']);
    expect(csv.split('\r\n').slice(0, 4)).toEqual(['﻿Report', 'Filters: All', '', 'Name,Value']);
  });
});
