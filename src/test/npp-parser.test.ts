import { describe, expect, it } from 'vitest';
import {
  findHeader,
  hashString,
  normaliseManager,
  parseAmount,
  parseDrCr,
  parseNppSheet,
  parseQuantity,
  parseRate,
  parseSheetDate,
  SheetStructureError,
  channelOf,
  creditedManager,
  zoneBase,
} from '@shared/npp-parser';

// Synthetic rows that mirror the structure and quirks of the real NPP sheet.
// Names are fictitious — no patient data in the repository.
const HEADER = ['Date', 'Particulars', 'Product Name', 'Place of sale', 'Ikris Manager Involved', 'Concerned Doctor name', 'Hospital Name', 'Voucher No.', 'Quantity', 'Rate', 'Value', 'Gross Total', 'EXPORT SALES', 'Shipping Charges', ' INR Value '];
const SHEET: string[][] = [
  HEADER,
  ['01-Apr-26', 'Test Patient A', 'Truqap 200 Mg', 'Delhi', 'Firoz', 'Dr. Example', 'Fortis Hospital', 'INV/IGL/26-27/001', '1 PACK', '$6200.00/PACK', '6200.00', '6900.00 Dr', '6200.00 Cr', '700.00 Cr', '  582,800 '],
  ['10-Apr-26', 'Test Patient B', 'LYSODREN 500 MG', 'Mumbai', 'HO ( Third Party ) ', 'Dr. Example', 'Example Hospital', 'INV/IGL/26-27/004', '6 PACK', '€1150.00/PACK', '6900.00', '7500.00 Dr', '6900.00 Cr', '600.00 Cr', '  731,400 '],
  ['', 'Test Patient C', 'Lysodren', 'Mumbai', 'HO ( Third Party Sales ) ', '', 'Example Hospital', 'No 000000468', '5 PACK', ' €  1,200.00 ', '6000.00', '', '6000.00 Cr', '', '  636,000 '],
  ['Total', '', '', '', '', '', '', '', '', '', '', '', '', '', '  1,950,200 '],
  // columns shifted by one (seen in the real sheet)
  ['29-Jun-26', 'Test Patient D', 'Truqap 200 Mg', 'Delhi', 'Firoz', '', 'Fortis', 'INV/IGL/26-27/093', '1 PACK', '$6200.00/PACK', '6200.00', '582800.00', '6900.00 Dr', '6200.00 Cr', '  582,800 '],
  // no currency symbol, #VALUE!
  ['25-Sep-26', 'Test Patient E', 'Alkeran ', 'Chennai ', 'Iyappan', '', 'Apollo', 'No 000000627', '7 PACK', '378.00/PACK', '#VALUE!', '5880.00 Dr', '', '', '  280,476 '],
  // duplicate voucher
  ['02-Apr-26', 'Test Patient F', 'Zepzelca', 'Delhi', 'Firoz', '', 'Fortis', 'INV/IGL/26-27/001', '2 PACK', '$3900.00/PACK', '7800.00', '8450.00 Dr', '7800.00 Cr', '650.00 Cr', '  733,200 '],
  // invalid: no particulars
  ['03-Apr-26', '', 'Zepzelca', 'Delhi', 'Firoz', '', 'Fortis', 'INV/IGL/26-27/099', '2 PACK', '$3900.00/PACK', '7800.00', '', '', '', '  733,200 '],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '  42,915,842 '],
  [],
];

describe('cell parsers', () => {
  it('parses dates in the sheet format', () => {
    expect(parseSheetDate('01-Apr-26')).toBe('2026-04-01');
    expect(parseSheetDate('31-Mar-2027')).toBe('2027-03-31');
    expect(parseSheetDate('2026-05-13')).toBe('2026-05-13');
    expect(parseSheetDate('13/05/2026')).toBe('2026-05-13');
    expect(parseSheetDate('31-Feb-26')).toBeNull();
    expect(parseSheetDate('')).toBeNull();
    expect(parseSheetDate('toal')).toBeNull();
  });

  it('parses amounts exactly, without floating-point drift', () => {
    expect(parseAmount('  582,800 ')).toEqual({ value: '582800.00', ok: true });
    expect(parseAmount('6200.00')).toEqual({ value: '6200.00', ok: true });
    expect(parseAmount('2820.675')).toEqual({ value: '2820.68', ok: true });
    expect(parseAmount('0.1')).toEqual({ value: '0.10', ok: true });
    expect(parseAmount('#VALUE!')).toEqual({ value: null, ok: false });
    expect(parseAmount('')).toEqual({ value: null, ok: true });
  });

  it('separates Dr/Cr designations from amounts', () => {
    expect(parseDrCr('6900.00 Dr')).toEqual({ amount: '6900.00', dc: 'Dr', ok: true });
    expect(parseDrCr('700.00 Cr')).toEqual({ amount: '700.00', dc: 'Cr', ok: true });
    expect(parseDrCr('14000.00')).toEqual({ amount: '14000.00', dc: null, ok: true });
    expect(parseDrCr('600')).toEqual({ amount: '600.00', dc: null, ok: true });
  });

  it('extracts currency, rate and unit from Rate', () => {
    expect(parseRate('$6200.00/PACK')).toEqual({ currency: 'USD', rate: '6200.00', unit: 'PACK', ok: true });
    expect(parseRate('€1150.00/VIAL')).toEqual({ currency: 'EUR', rate: '1150.00', unit: 'VIAL', ok: true });
    expect(parseRate(' €  1,200.00 ')).toEqual({ currency: 'EUR', rate: '1200.00', unit: null, ok: true });
    expect(parseRate('999.00/PACK')).toEqual({ currency: null, rate: '999.00', unit: 'PACK', ok: true });
  });

  it('parses quantity and unit', () => {
    expect(parseQuantity('14 PEN')).toEqual({ quantity: '14', unit: 'PEN', ok: true });
    expect(parseQuantity('3 Box')).toEqual({ quantity: '3', unit: 'BOX', ok: true });
    expect(parseQuantity('')).toEqual({ quantity: null, unit: null, ok: true });
    expect(parseQuantity('two')).toEqual({ quantity: null, unit: null, ok: false });
  });

  it('normalises only the HO third-party spelling variants', () => {
    expect(normaliseManager('HO ( Third Party ) ')).toBe('HO (Third Party)');
    expect(normaliseManager('HO ( Third Party Sales ) ')).toBe('HO (Third Party)');
    expect(normaliseManager('HO Third Party')).toBe('HO (Third Party)');
    expect(normaliseManager('HO')).toBe('HO');
    expect(normaliseManager(' Firoz ')).toBe('Firoz');
  });

  it('hashes deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('parseNppSheet', () => {
  const result = parseNppSheet(SHEET, { spreadsheetId: 'sheet-1', sheetGid: 631975196 });
  const byVoucher = (v: string) => result.rows.find((r) => r.voucher_no === v)!;

  it('finds the header and maps the exact source columns', () => {
    expect(result.headerRow).toBe(1);
  });

  it('skips subtotal rows and blank rows, and reports invalid rows', () => {
    expect(result.skipped).toBe(2);
    expect(result.invalid).toEqual([{ row: 9, reason: 'Particulars (customer) is empty' }]);
    expect(result.rows).toHaveLength(6);
  });

  it('maps a clean row exactly as the sample in the brief', () => {
    const r = byVoucher('INV/IGL/26-27/001');
    expect(r).toMatchObject({
      sale_date: '2026-04-01',
      product_name: 'Truqap 200 Mg',
      quantity: '1',
      quantity_unit: 'PACK',
      currency: 'USD',
      rate: '6200.00',
      value: '6200.00',
      gross_total: '6900.00',
      gross_total_dc: 'Dr',
      export_sales: '6200.00',
      export_sales_dc: 'Cr',
      shipping_charges: '700.00',
      shipping_charges_dc: 'Cr',
      inr_value: '582800.00',
      source_key: 'INV/IGL/26-27/001',
      source_row_number: 2,
    });
    expect(r.source_raw['INR Value']).toBe('  582,800 ');
  });

  it('flags missing dates instead of inventing them', () => {
    const r = byVoucher('No 000000468');
    expect(r.sale_date).toBeNull();
    expect(r.data_issues).toContain('missing_date');
    expect(r.source_key).toBe('NO 000000468');
  });

  it('repairs and flags the shifted-columns pattern', () => {
    const r = byVoucher('INV/IGL/26-27/093');
    expect(r.gross_total).toBe('6900.00');
    expect(r.gross_total_dc).toBe('Dr');
    expect(r.export_sales).toBe('6200.00');
    expect(r.shipping_charges).toBeNull();
    expect(r.data_issues).toContain('columns_shifted');
  });

  it('never guesses a currency and flags invalid values', () => {
    const r = byVoucher('No 000000627');
    expect(r.currency).toBeNull();
    expect(r.value).toBeNull();
    expect(r.data_issues).toEqual(expect.arrayContaining(['currency_not_stated', 'invalid_value']));
  });

  it('gives duplicate vouchers distinct, stable keys and flags both', () => {
    const dupes = result.rows.filter((r) => r.voucher_no === 'INV/IGL/26-27/001');
    expect(dupes.map((d) => d.source_key)).toEqual(['INV/IGL/26-27/001', 'INV/IGL/26-27/001#2']);
    expect(dupes.every((d) => d.data_issues.includes('duplicate_voucher_in_sheet'))).toBe(true);
  });

  it('is idempotent: parsing twice yields identical keys and hashes', () => {
    const again = parseNppSheet(SHEET, { spreadsheetId: 'sheet-1', sheetGid: 631975196 });
    expect(again.rows.map((r) => [r.source_key, r.source_hash])).toEqual(result.rows.map((r) => [r.source_key, r.source_hash]));
  });

  it('changes the hash when a source cell changes', () => {
    const edited = SHEET.map((row) => [...row]);
    edited[1][10] = '6300.00';
    const again = parseNppSheet(edited, { spreadsheetId: 'sheet-1' });
    expect(again.rows[0].source_hash).not.toBe(result.rows[0].source_hash);
    expect(again.rows[0].source_key).toBe(result.rows[0].source_key);
  });

  it('rejects a sheet with a renamed required column', () => {
    const broken = [HEADER.map((h) => (h.trim() === 'INR Value' ? 'INR Amount' : h)), ...SHEET.slice(1)];
    expect(() => findHeader(broken)).toThrow(SheetStructureError);
    try {
      findHeader(broken);
    } catch (e) {
      expect((e as SheetStructureError).missingColumns).toEqual(['INR Value']);
    }
  });
});

// ---------------------------------------------------------------------------
// v2 layout ("NPM Sales sheet"): Zone column, no voucher / rate / value columns
// ---------------------------------------------------------------------------
const V2_HEADER = ['Date', 'Particulars', 'Product Name', 'Place of sale', 'Ikris Manager Involved', 'Zone', 'Concerned Doctor name', 'Hospital Name', 'Quantity', 'INR Value'];
const V2: string[][] = [
  V2_HEADER,
  ['01-Apr-26', 'Patient A', 'Truqap 200 Mg', 'Delhi', 'Firoz', 'North Zone', 'Dr X', 'Fortis', '1 PACK', '5,82,800'],
  ['14-Apr-26', 'Patient B', 'Fabhalta', 'Bangalore', 'HO', 'HO South Zone', '', '', '4 PACK', '15,41,600'],
  ['10-Apr-26', 'Patient C', 'Lysodren', 'Mumbai', 'HO ( Third Party )', '', 'Dr Y', 'Sushrut', ' 5 PACK ', '6,36,000'],
  ['24-Aug-26', 'Patient D', 'Hernexeos', 'Bangalore', 'Fazan', 'South Zone', '', 'Manipal', '1 PACK', '7,94,300'],
  // Same sale under HO and an individual → flagged, never merged
  ['20-Sep-26', 'Patient E', 'Datroway', 'Bangalore', 'HO', 'HO South Zone', '', '', '3 PACK', '7,05,000'],
  ['20-Sep-26', 'Patient E', 'Datroway', 'Bangalore', 'Fazan', 'South Zone', '', '', '3 PACK', '7,05,000'],
  // Exact duplicate row (same manager) → second gets #2 and both flagged
  ['21-Sep-26', 'Patient F', 'Kineret', 'Chennai', 'Iyappan', 'South Zone', '', '', '1 PACK', '1,48,400'],
  ['21-Sep-26', 'Patient F', 'Kineret', 'Chennai', 'Iyappan', 'South Zone', '', '', '1 PACK', '1,48,400'],
  ['22-Sep-26', 'Patient G', 'Kineret', 'Chennai', 'Iyappan', '', '', '', '1 PACK', '10,600.00'],
];

describe('parseNppSheet — v2 layout', () => {
  const r = parseNppSheet(V2, { spreadsheetId: 'v2', sheetGid: 631975196 });
  const by = (name: string) => r.rows.filter((x) => x.particulars === name);

  it('accepts the layout without voucher, rate or value columns', () => {
    expect(r.columns).toContain('zone');
    expect(r.columns).not.toContain('voucher_no');
    expect(r.rows).toHaveLength(9);
    expect(r.invalid).toEqual([]);
  });

  it('only declares the fields the sheet provides', () => {
    const f = r.rows[0].fields;
    expect(f).toEqual(expect.arrayContaining(['sale_date', 'zone', 'manager', 'inr_value', 'quantity']));
    expect(f).not.toContain('value');
    expect(f).not.toContain('currency');
    expect(f).not.toContain('voucher_no');
  });

  it('does not raise legacy-column flags', () => {
    expect(by('Patient A')[0].data_issues).toEqual([]);
  });

  it('derives the sales channel from the manager column', () => {
    expect(channelOf('Firoz')).toBe('individual');
    expect(by('Patient B')[0].channel).toBe('ho');
    expect(by('Patient C')[0].channel).toBe('ho_third_party');
    expect(by('Patient C')[0].zone).toBeNull();
    expect(by('Patient C')[0].data_issues).not.toContain('zone_not_assigned');
    expect(channelOf(null)).toBe('unassigned');
  });

  it('maps HO zones onto their base zone', () => {
    expect(zoneBase('HO South Zone')).toBe('South Zone');
    expect(zoneBase('HO North Zone (Firoz)')).toBe('North Zone');
    expect(zoneBase('HO South Zone(Iyappan)')).toBe('South Zone');
    expect(zoneBase(' South  Zone ')).toBe('South Zone');
    expect(zoneBase('')).toBeNull();
  });

  it('credits HO rows to the manager named in the Zone cell', () => {
    expect(creditedManager('HO', 'HO North Zone (Firoz)')).toBe('Firoz');
    expect(creditedManager('HO', 'HO South Zone(Iyappan)')).toBe('Iyappan');
    expect(creditedManager('HO', 'HO South Zone')).toBeNull();
    expect(creditedManager('Fazan', 'South Zone')).toBe('Fazan');
    expect(creditedManager('HO (Third Party)', '')).toBeNull();
  });

  it('parses Indian digit grouping and padded quantities', () => {
    expect(by('Patient B')[0].inr_value).toBe('1541600.00');
    expect(by('Patient C')[0].quantity).toBe('5');
    expect(by('Patient G')[0].inr_value).toBe('10600.00');
  });

  it('flags the same sale recorded under HO and an individual without merging it', () => {
    const e = by('Patient E');
    expect(e).toHaveLength(2);
    expect(new Set(e.map((x) => x.source_key)).size).toBe(2);
    expect(e.every((x) => x.data_issues.includes('possible_duplicate_attribution'))).toBe(true);
    expect(by('Patient D')[0].data_issues).not.toContain('possible_duplicate_attribution');
  });

  it('keeps exact duplicate rows distinct and flags them', () => {
    const f = by('Patient F');
    expect(f.map((x) => x.source_key.endsWith('#2'))).toEqual([false, true]);
    expect(f.every((x) => x.data_issues.includes('duplicate_row_in_sheet'))).toBe(true);
  });

  it('flags a missing zone for a sales-manager row', () => {
    expect(by('Patient G')[0].data_issues).toContain('zone_not_assigned');
  });

  it('keys rows independently of amount, so a corrected value is an update', () => {
    const edited = V2.map((row) => [...row]);
    edited[1][9] = '6,00,000';
    const again = parseNppSheet(edited, { spreadsheetId: 'v2' });
    expect(again.rows[0].source_key).toBe(r.rows[0].source_key);
    expect(again.rows[0].source_hash).not.toBe(r.rows[0].source_hash);
  });

  it('reports the INR total for reconciliation', () => {
    expect(r.inrTotal).toBe('5272100.00');
  });
});
