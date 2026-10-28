import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';

describe('parseCsv', () => {
  it('parses quoted fields with commas, quotes and Indian digit grouping', () => {
    const csv = 'Date,Particulars,INR Value\r\n01-Apr-26,"Rajasekhar, A","5,82,800"\r\n02-Apr-26,"He said ""hi""",100\r\n';
    expect(parseCsv(csv)).toEqual([
      ['Date', 'Particulars', 'INR Value'],
      ['01-Apr-26', 'Rajasekhar, A', '5,82,800'],
      ['02-Apr-26', 'He said "hi"', '100'],
    ]);
  });

  it('handles LF endings, a BOM, empty cells and trailing blank lines', () => {
    expect(parseCsv('﻿a,b,c\n1,,3\n\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('keeps newlines inside quoted cells', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });
});
