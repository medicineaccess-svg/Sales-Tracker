/**
 * NPP Google Sheet → npp_sales row parser.
 *
 * Pure TypeScript with no runtime-specific APIs, so the same file is used by
 * the `sheets-sync` Edge Function (Deno) and by the frontend unit tests (Vitest).
 *
 * Supports two sheet layouts, detected from the header row:
 *  - v1 "NPP Sales sheet": Voucher No., Rate, Value, Gross Total, EXPORT SALES, Shipping Charges …
 *  - v2 "NPM Sales sheet": Zone column; no voucher, rate, value or currency columns.
 * Only Date, Particulars, Product Name and INR Value are mandatory. Every parsed row lists
 * the columns the sheet actually provided (`fields`), so the database never blanks out
 * values the current sheet simply does not carry.
 *
 * Principles
 *  - Never invent data. Values that cannot be parsed are stored as NULL and the
 *    row is flagged in `data_issues`; the original cell text is kept in `source_raw`.
 *  - Never convert currencies. `inr_value` is the sheet's own INR figure.
 *  - Subtotal rows ("Total", "toal", rows with only an INR figure) are skipped.
 */

export const NPP_COLUMNS = {
  date: 'Date',
  particulars: 'Particulars',
  product_name: 'Product Name',
  place_of_sale: 'Place of sale',
  manager: 'Ikris Manager Involved',
  zone: 'Zone',
  doctor_name: 'Concerned Doctor name',
  hospital_name: 'Hospital Name',
  voucher_no: 'Voucher No.',
  quantity: 'Quantity',
  rate: 'Rate',
  value: 'Value',
  gross_total: 'Gross Total',
  export_sales: 'EXPORT SALES',
  shipping_charges: 'Shipping Charges',
  inr_value: 'INR Value',
} as const;

export type NppColumnKey = keyof typeof NPP_COLUMNS;

export const REQUIRED_COLUMNS: NppColumnKey[] = ['date', 'particulars', 'product_name', 'inr_value'];

/** Database fields written when a given sheet column is present. */
export const COLUMN_FIELDS: Record<NppColumnKey, string[]> = {
  date: ['sale_date'],
  particulars: ['particulars'],
  product_name: ['product_name'],
  place_of_sale: ['place_of_sale'],
  manager: ['manager'],
  zone: ['zone'],
  doctor_name: ['doctor_name'],
  hospital_name: ['hospital_name'],
  voucher_no: ['voucher_no'],
  quantity: ['quantity', 'quantity_unit'],
  rate: ['rate', 'rate_unit', 'currency'],
  value: ['value'],
  gross_total: ['gross_total', 'gross_total_dc'],
  export_sales: ['export_sales', 'export_sales_dc'],
  shipping_charges: ['shipping_charges', 'shipping_charges_dc'],
  inr_value: ['inr_value'],
};

export type Currency = 'USD' | 'EUR' | 'GBP' | 'INR';
export type DrCr = 'Dr' | 'Cr';
export type SalesChannel = 'individual' | 'ho' | 'ho_third_party' | 'unassigned';

export type DataIssue =
  | 'missing_date'
  | 'missing_voucher'
  | 'duplicate_voucher_in_sheet'
  | 'duplicate_row_in_sheet'
  | 'possible_duplicate_attribution'
  | 'zone_not_assigned'
  | 'missing_quantity'
  | 'missing_rate'
  | 'currency_not_stated'
  | 'invalid_value'
  | 'value_mismatch'
  | 'rate_unit_mismatch'
  | 'columns_shifted'
  | 'export_sales_mismatch'
  | 'missing_inr_value'
  | 'invalid_number';

export const DATA_ISSUE_LABELS: Record<DataIssue, string> = {
  missing_date: 'Date missing in sheet',
  missing_voucher: 'Voucher number missing',
  duplicate_voucher_in_sheet: 'Voucher number appears more than once in the sheet',
  duplicate_row_in_sheet: 'Same date, customer, product and manager appear more than once in the sheet',
  possible_duplicate_attribution:
    'Same date, customer, product and INR value recorded under more than one manager — may be one sale counted twice',
  zone_not_assigned: 'Zone missing for a sales manager row',
  missing_quantity: 'Quantity missing',
  missing_rate: 'Rate missing',
  currency_not_stated: 'Currency not stated (no $ / € symbol in Rate)',
  invalid_value: 'Value cell is not a number (e.g. #VALUE!)',
  value_mismatch: 'Quantity × Rate does not equal Value',
  rate_unit_mismatch: 'Quantity unit differs from Rate unit',
  columns_shifted: 'Gross Total / Export Sales / Shipping appear shifted by one column in the sheet',
  export_sales_mismatch: 'EXPORT SALES differs from Value',
  missing_inr_value: 'INR Value missing',
  invalid_number: 'A numeric cell could not be read',
};

/** Issues that describe columns only the v1 sheet carried (kept when a v2 sync adopts an old record). */
export const LEGACY_COLUMN_ISSUES: DataIssue[] = [
  'missing_voucher',
  'duplicate_voucher_in_sheet',
  'missing_rate',
  'currency_not_stated',
  'invalid_value',
  'value_mismatch',
  'rate_unit_mismatch',
  'columns_shifted',
  'export_sales_mismatch',
];

export interface ParsedNppRow {
  source_key: string;
  source_sheet_id: string;
  source_gid: string | null;
  source_row_number: number;
  source_hash: string;
  source_raw: Record<string, string>;
  /** Database fields this sheet layout provides; others are left untouched on update. */
  fields: string[];
  sale_date: string | null;
  particulars: string;
  product_name: string;
  place_of_sale: string | null;
  manager: string | null;
  zone: string | null;
  channel: SalesChannel;
  doctor_name: string | null;
  hospital_name: string | null;
  voucher_no: string | null;
  quantity: string | null;
  quantity_unit: string | null;
  currency: Currency | null;
  rate: string | null;
  rate_unit: string | null;
  value: string | null;
  gross_total: string | null;
  gross_total_dc: DrCr | null;
  export_sales: string | null;
  export_sales_dc: DrCr | null;
  shipping_charges: string | null;
  shipping_charges_dc: DrCr | null;
  inr_value: string | null;
  data_issues: DataIssue[];
}

export interface RowError {
  row: number;
  reason: string;
}

export interface ParseResult {
  rows: ParsedNppRow[];
  rowsRead: number;
  skipped: number;
  invalid: RowError[];
  flagged: number;
  headerRow: number;
  /** Sheet columns that were found. */
  columns: NppColumnKey[];
  /** Total of the INR Value column across imported rows (for reconciliation). */
  inrTotal: string;
}

export class SheetStructureError extends Error {
  readonly missingColumns: string[];
  constructor(message: string, missingColumns: string[] = []) {
    super(message);
    this.name = 'SheetStructureError';
    this.missingColumns = missingColumns;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const collapse = (s: string | null | undefined): string =>
  (s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

const orNull = (s: string): string | null => (s === '' ? null : s);

/** Decimal string with 2 dp, or null. Keeps exact decimal text (no float maths on stored values). */
export function parseAmount(input: string | null | undefined): { value: string | null; ok: boolean } {
  const s = collapse(input).replace(/[₹$€£]/g, '').replace(/,/g, '').replace(/\s/g, '');
  if (s === '') return { value: null, ok: true };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { value: null, ok: false };
  return { value: toFixed2(s), ok: true };
}

/** Formats a validated decimal string to 2 dp without floating point rounding errors. */
export function toFixed2(s: string): string {
  const neg = s.startsWith('-');
  const [intPart, frac = ''] = (neg ? s.slice(1) : s).split('.');
  // round half up on the third decimal using integer arithmetic on strings
  const padded = (frac + '000').slice(0, 3);
  let cents = BigInt((intPart.replace(/^0+(?=\d)/, '') || '0') + padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1n;
  const str = cents.toString().padStart(3, '0');
  return `${neg ? '-' : ''}${str.slice(0, -2)}.${str.slice(-2)}`;
}

/** "6900.00 Dr" → { amount: "6900.00", dc: "Dr" } */
export function parseDrCr(input: string | null | undefined): {
  amount: string | null;
  dc: DrCr | null;
  ok: boolean;
} {
  const s = collapse(input);
  if (s === '') return { amount: null, dc: null, ok: true };
  const m = s.match(/^(.*?)\s*\b(Dr|Cr)\.?$/i);
  const num = parseAmount(m ? m[1] : s);
  const dc = m ? ((m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()) as DrCr) : null;
  return { amount: num.value, dc, ok: num.ok };
}

const SYMBOLS: Record<string, Currency> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR' };

/** "$6200.00/PACK" → { currency: USD, rate: "6200.00", unit: "PACK" } */
export function parseRate(input: string | null | undefined): {
  currency: Currency | null;
  rate: string | null;
  unit: string | null;
  ok: boolean;
} {
  const s = collapse(input);
  if (s === '') return { currency: null, rate: null, unit: null, ok: true };
  const symbol = s.match(/[$€£₹]/)?.[0];
  const currency = symbol ? SYMBOLS[symbol] : null;
  const [amountPart, unitPart] = s.split('/');
  const amount = parseAmount(amountPart);
  const unit = unitPart ? collapse(unitPart).toUpperCase().replace(/[^A-Z]/g, '') || null : null;
  return { currency, rate: amount.value, unit, ok: amount.ok };
}

/** "14 PEN" → { quantity: "14", unit: "PEN" } */
export function parseQuantity(input: string | null | undefined): {
  quantity: string | null;
  unit: string | null;
  ok: boolean;
} {
  const s = collapse(input);
  if (s === '') return { quantity: null, unit: null, ok: true };
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/);
  if (!m) return { quantity: null, unit: null, ok: false };
  const q = Number(m[1]);
  if (!(q > 0)) return { quantity: null, unit: null, ok: false };
  return { quantity: m[1], unit: m[2] ? m[2].toUpperCase() : null, ok: true };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Accepts 01-Apr-26, 01-Apr-2026, 01/04/2026 (day first), 2026-04-01. */
export function parseSheetDate(input: string | null | undefined): string | null {
  const s = collapse(input);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,4})[-\s/,]*(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (!mon) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoDate(y, mon, Number(m[1]));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoDate(y, Number(m[2]), Number(m[1]));
  }
  return null;
}

/** Canonical manager label. Only whitespace and the "HO third party" spelling variants are normalised. */
export function normaliseManager(input: string | null | undefined): string | null {
  const s = collapse(input);
  if (!s) return null;
  if (/^HO\s*\(?\s*third\s*party(\s*sales)?\s*\)?$/i.test(s)) return 'HO (Third Party)';
  return s;
}

export function normaliseVoucherKey(voucher: string): string {
  return collapse(voucher).toUpperCase();
}

/** Deterministic 53-bit string hash (cyrb53), hex encoded. Used only for change detection. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const cents = (s: string | null) => (s === null ? null : BigInt(s.replace('.', '')));
const closeTo = (a: string | null, b: string | null, toleranceCents = 100n) => {
  const x = cents(a);
  const y = cents(b);
  if (x === null || y === null) return true;
  const d = x > y ? x - y : y - x;
  return d <= toleranceCents;
};

/** quantity × rate, as a 2 dp string. */
function multiply(q: string, r: string): string {
  const [qi, qf = ''] = q.split('.');
  const scale = qf.length;
  const qInt = BigInt(qi + qf);
  const rCents = BigInt(r.replace('.', ''));
  const product = qInt * rCents; // cents × 10^scale
  const div = 10n ** BigInt(scale);
  const rounded = (product + div / 2n) / div;
  const str = rounded.toString().padStart(3, '0');
  return `${str.slice(0, -2)}.${str.slice(-2)}`;
}


/** "HO ( Third Party )" → ho_third_party, "HO" → ho, blank → unassigned, anything else → individual. */
export function channelOf(manager: string | null): SalesChannel {
  if (!manager) return 'unassigned';
  if (/^HO\s*\(?\s*third\s*party/i.test(manager)) return 'ho_third_party';
  if (/^HO$/i.test(manager.trim())) return 'ho';
  return 'individual';
}

/** "HO South Zone (Fazan)" → "South Zone"; blank → null. */
export function zoneBase(zone: string | null | undefined): string | null {
  const z = collapse(collapse(zone).replace(/\(.*\)/g, '')).replace(/^HO\s+/i, '');
  return z === '' ? null : z;
}

/**
 * Manager a row is credited to: the "Ikris Manager Involved" name for individual rows, the name in
 * brackets in Zone for HO rows ("HO North Zone (Firoz)" → "Firoz"), null for HO (Third Party).
 * Mirrors the generated column npp_sales.credited_manager.
 */
export function creditedManager(manager: string | null, zone: string | null | undefined): string | null {
  const ch = channelOf(manager);
  if (ch === 'individual') return collapse(manager);
  if (ch === 'ho') {
    const m = collapse(zone).match(/\(([^)]*)\)/);
    return m && collapse(m[1]) ? collapse(m[1]) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface ParseOptions {
  spreadsheetId: string;
  sheetGid?: string | number | null;
}

export function findHeader(values: string[][]): {
  rowIndex: number;
  map: Partial<Record<NppColumnKey, number>>;
  columns: NppColumnKey[];
} {
  const wanted = Object.entries(NPP_COLUMNS) as [NppColumnKey, string][];
  for (let i = 0; i < Math.min(values.length, 20); i++) {
    const cells = (values[i] ?? []).map((c) => normHeader(String(c ?? '')));
    if (!cells.includes('particulars')) continue;
    const map: Partial<Record<NppColumnKey, number>> = {};
    for (const [key, label] of wanted) {
      const idx = cells.indexOf(normHeader(label));
      if (idx !== -1) map[key] = idx;
    }
    const missing = REQUIRED_COLUMNS.filter((k) => map[k] === undefined).map((k) => NPP_COLUMNS[k]);
    if (missing.length) {
      throw new SheetStructureError(
        `The NPP sheet is missing required column(s): ${missing.join(', ')}. ` +
          'Restore the column names or update the mapping before syncing.',
        missing,
      );
    }
    return { rowIndex: i, map, columns: wanted.map(([k]) => k).filter((k) => map[k] !== undefined) };
  }
  throw new SheetStructureError('Could not find the header row (expected a "Particulars" column) in the first 20 rows.');
}

const sumCents = (values: (string | null)[]) =>
  values.reduce((acc, v) => (v ? acc + BigInt(v.replace('.', '')) : acc), 0n);
const centsToString = (c: bigint) => {
  const s = c.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};

export function parseNppSheet(values: string[][], opts: ParseOptions): ParseResult {
  const { rowIndex, map, columns } = findHeader(values);
  const has = (k: NppColumnKey) => map[k] !== undefined;
  const fields = columns.flatMap((c) => COLUMN_FIELDS[c]);
  const rows: ParsedNppRow[] = [];
  const invalid: RowError[] = [];
  let skipped = 0;
  let rowsRead = 0;
  const keyCounts = new Map<string, number>();

  for (let i = rowIndex + 1; i < values.length; i++) {
    const rowNumber = i + 1; // 1-based sheet row
    const cells = values[i] ?? [];
    const get = (k: NppColumnKey) => (map[k] === undefined ? '' : String(cells[map[k]!] ?? ''));
    const raw: Record<string, string> = {};
    for (const k of columns) raw[NPP_COLUMNS[k]] = get(k);

    const anyContent = Object.values(raw).some((v) => collapse(v) !== '');
    if (!anyContent) continue; // fully blank row — not counted
    rowsRead++;

    const first = collapse(get('date')).toLowerCase();
    const particulars = collapse(get('particulars')).replace(/[,;]+$/, '').trim();
    const product = collapse(get('product_name'));

    // Subtotal / summary rows
    if (/^(total|toal|grand total|sub ?total)$/.test(first) || (!particulars && !product && !collapse(get('voucher_no')))) {
      skipped++;
      continue;
    }

    if (!particulars || !product) {
      invalid.push({
        row: rowNumber,
        reason: !particulars ? 'Particulars (customer) is empty' : 'Product Name is empty',
      });
      continue;
    }

    const issues = new Set<DataIssue>();

    const saleDate = parseSheetDate(get('date'));
    if (!saleDate) issues.add('missing_date');

    const voucher = has('voucher_no') ? collapse(get('voucher_no')) || null : null;
    if (has('voucher_no') && !voucher) issues.add('missing_voucher');

    const qty = parseQuantity(get('quantity'));
    if (has('quantity')) {
      if (!qty.ok) issues.add('invalid_number');
      if (!qty.quantity) issues.add('missing_quantity');
    }

    const rate = parseRate(get('rate'));
    if (has('rate')) {
      if (!rate.ok) issues.add('invalid_number');
      if (!rate.rate) issues.add('missing_rate');
      if (!rate.currency) issues.add('currency_not_stated');
      if (rate.unit && qty.unit && rate.unit !== qty.unit) issues.add('rate_unit_mismatch');
    }

    const value = parseAmount(get('value'));
    if (has('value') && !value.ok) issues.add('invalid_value');

    const inr = parseAmount(get('inr_value'));
    if (!inr.ok) issues.add('invalid_number');
    if (!inr.value) issues.add('missing_inr_value');

    let gross = parseDrCr(get('gross_total'));
    let exportSales = parseDrCr(get('export_sales'));
    let shipping = parseDrCr(get('shipping_charges'));
    if (!gross.ok || !exportSales.ok || !shipping.ok) issues.add('invalid_number');

    // Detect the "shifted by one column" pattern seen in the v1 sheet: Gross Total
    // holds the INR figure (no Dr/Cr), Export Sales holds the Dr gross, and
    // Shipping holds the Cr export amount.
    if (
      gross.amount && !gross.dc && inr.value && closeTo(gross.amount, inr.value) &&
      (exportSales.dc === 'Dr' || (!exportSales.amount && !shipping.amount))
    ) {
      issues.add('columns_shifted');
      gross = exportSales;
      exportSales = shipping.dc === 'Cr' ? shipping : { amount: null, dc: null, ok: true };
      shipping = { amount: null, dc: null, ok: true };
    }

    if (exportSales.amount && value.value && !closeTo(exportSales.amount, value.value, 1n)) {
      issues.add('export_sales_mismatch');
    }

    if (qty.quantity && rate.rate && value.value && !closeTo(multiply(qty.quantity, rate.rate), value.value)) {
      issues.add('value_mismatch');
    }

    const manager = normaliseManager(get('manager'));
    const channel = channelOf(manager);
    const zone = has('zone') ? collapse(get('zone')) || null : null;
    if (has('zone') && !zone && (channel === 'individual' || channel === 'ho')) issues.add('zone_not_assigned');

    // Stable key: voucher number when the sheet has one; otherwise date + customer + product + manager.
    // Amount and quantity are deliberately excluded so that correcting a value updates the record.
    const baseKey = voucher
      ? normaliseVoucherKey(voucher)
      : (has('voucher_no') ? 'NOVOUCHER:' : 'ROW:') +
        hashString(
          [saleDate ?? '', particulars.toLowerCase(), product.toLowerCase(), (manager ?? '').toLowerCase()].join('|'),
        );
    const seen = (keyCounts.get(baseKey) ?? 0) + 1;
    keyCounts.set(baseKey, seen);
    const sourceKey = seen === 1 ? baseKey : `${baseKey}#${seen}`;
    if (seen > 1) issues.add(voucher ? 'duplicate_voucher_in_sheet' : 'duplicate_row_in_sheet');

    rows.push({
      source_key: sourceKey,
      source_sheet_id: opts.spreadsheetId,
      source_gid: opts.sheetGid != null ? String(opts.sheetGid) : null,
      source_row_number: rowNumber,
      source_hash: hashString(JSON.stringify(raw)),
      source_raw: raw,
      fields,
      sale_date: saleDate,
      particulars,
      product_name: product,
      place_of_sale: orNull(collapse(get('place_of_sale')).replace(/^['"]+|['"]+$/g, '')),
      manager,
      zone,
      channel,
      doctor_name: orNull(collapse(get('doctor_name'))),
      hospital_name: orNull(collapse(get('hospital_name'))),
      voucher_no: voucher,
      quantity: qty.quantity,
      quantity_unit: qty.unit,
      currency: rate.currency,
      rate: rate.rate,
      rate_unit: rate.unit,
      value: value.value,
      gross_total: gross.amount,
      gross_total_dc: gross.dc,
      export_sales: exportSales.amount,
      export_sales_dc: exportSales.dc,
      shipping_charges: shipping.amount,
      shipping_charges_dc: shipping.dc,
      inr_value: inr.value,
      data_issues: [...issues],
    });
  }

  // Mark the first occurrence of a duplicated key too
  const baseOf = (k: string) => k.replace(/#\d+$/, '');
  for (const r of rows) {
    if ((keyCounts.get(baseOf(r.source_key)) ?? 0) > 1) {
      const issue: DataIssue = r.voucher_no ? 'duplicate_voucher_in_sheet' : 'duplicate_row_in_sheet';
      if (!r.data_issues.includes(issue)) r.data_issues.push(issue);
    }
  }

  // Same sale recorded under different managers (e.g. HO and an individual): flag, never merge.
  const groups = new Map<string, ParsedNppRow[]>();
  for (const r of rows) {
    if (!r.sale_date || !r.inr_value) continue;
    const g = [r.sale_date, r.particulars.toLowerCase(), r.product_name.toLowerCase(), r.inr_value].join('|');
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  for (const g of groups.values()) {
    const managers = new Set(g.map((r) => (r.manager ?? '').toLowerCase()));
    if (g.length > 1 && managers.size > 1) {
      for (const r of g) if (!r.data_issues.includes('possible_duplicate_attribution')) r.data_issues.push('possible_duplicate_attribution');
    }
  }

  return {
    rows,
    rowsRead,
    skipped,
    invalid,
    flagged: rows.filter((r) => r.data_issues.length > 0).length,
    headerRow: rowIndex + 1,
    columns,
    inrTotal: centsToString(sumCents(rows.map((r) => r.inr_value))),
  };
}
