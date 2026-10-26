// Exports the dashboard exactly as currently filtered: totals per currency, monthly figures and
// the product / manager / hospital breakdowns. Uses the data already returned by npp_dashboard —
// nothing is recalculated or converted between currencies.
import type { DashboardData, GroupTotals } from '@/types/database';
import { CURRENCY_LABEL, CURRENCY_ORDER, formatMonth } from './format';
import { downloadXlsx, type ExportColumn } from './export';

export interface DashboardExportRow {
  section: string;
  item: string;
  currency: string;
  records: number | null;
  value: number | null;
  shipping: number | null;
  inr: number | null;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function groupRows(section: string, rows: GroupTotals[]): DashboardExportRow[] {
  const out: DashboardExportRow[] = [];
  for (const r of rows) {
    out.push({ section, item: r.key, currency: 'All (INR Value as reported)', records: n(r.records), value: null, shipping: null, inr: n(r.inr_value) });
    if (Number(r.value_usd)) out.push({ section, item: r.key, currency: 'USD', records: null, value: n(r.value_usd), shipping: null, inr: null });
    if (Number(r.value_eur)) out.push({ section, item: r.key, currency: 'EUR', records: null, value: n(r.value_eur), shipping: null, inr: null });
    if (Number(r.value_unspecified))
      out.push({ section, item: r.key, currency: 'Currency not stated', records: null, value: n(r.value_unspecified), shipping: null, inr: null });
  }
  return out;
}

export function buildDashboardRows(data: DashboardData): DashboardExportRow[] {
  const rows: DashboardExportRow[] = [];
  const t = data.totals;
  rows.push({ section: 'Summary', item: 'All records in view', currency: 'All (INR Value as reported)', records: n(t.records), value: null, shipping: null, inr: n(t.inr_value) });
  for (const c of [...data.by_currency].sort((a, b) => CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency))) {
    rows.push({
      section: 'Totals by currency',
      item: 'Sales value',
      currency: CURRENCY_LABEL[c.currency],
      records: n(c.records),
      value: n(c.value),
      shipping: n(c.shipping),
      inr: n(c.inr_value),
    });
  }
  rows.push({ section: 'Summary', item: 'Unique hospitals', currency: '', records: n(t.hospitals), value: null, shipping: null, inr: null });
  rows.push({ section: 'Summary', item: 'Unique doctors', currency: '', records: n(t.doctors), value: null, shipping: null, inr: null });
  for (const q of data.quantity_by_unit) {
    rows.push({ section: 'Quantity', item: `Quantity (${q.unit})`, currency: '', records: n(q.records), value: n(q.quantity), shipping: null, inr: null });
  }
  for (const m of [...data.monthly].sort((a, b) => a.month.localeCompare(b.month) || CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency))) {
    rows.push({
      section: 'Monthly',
      item: formatMonth(m.month),
      currency: CURRENCY_LABEL[m.currency],
      records: n(m.records),
      value: n(m.value),
      shipping: n(m.shipping),
      inr: n(m.inr_value),
    });
  }
  rows.push(...groupRows('Top products', data.by_product));
  rows.push(...groupRows('Top managers', data.by_manager));
  rows.push(...groupRows('Top hospitals', data.by_hospital));
  return rows;
}

export const DASHBOARD_EXPORT_COLUMNS: ExportColumn<DashboardExportRow>[] = [
  { header: 'Section', value: (r) => r.section, width: 20 },
  { header: 'Item', value: (r) => r.item, width: 34 },
  { header: 'Currency', value: (r) => r.currency, width: 26 },
  { header: 'Records / Count', value: (r) => r.records },
  { header: 'Value (in stated currency)', value: (r) => r.value, numFmt: '#,##0.00', width: 22 },
  { header: 'Shipping (in stated currency)', value: (r) => r.shipping, numFmt: '#,##0.00', width: 22 },
  { header: 'INR Value (source-reported)', value: (r) => r.inr, numFmt: '#,##0', width: 22 },
];

export async function exportDashboard(data: DashboardData, filename: string, preamble: string[]) {
  await downloadXlsx(filename, 'NPP dashboard', buildDashboardRows(data), DASHBOARD_EXPORT_COLUMNS, preamble);
}
