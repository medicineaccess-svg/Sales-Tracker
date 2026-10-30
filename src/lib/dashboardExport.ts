// Exports the dashboard exactly as currently filtered, using only the sheet's own figures:
// INR Value, records and quantity. Uses the data already returned by npp_dashboard.
import type { DashboardData, GroupTotals } from '@/types/database';
import { formatMonth } from './format';
import { downloadXlsx, type ExportColumn } from './export';

export interface DashboardExportRow {
  section: string;
  item: string;
  records: number | null;
  inr: number | null;
  note?: string;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const groupRows = (section: string, rows: GroupTotals[]): DashboardExportRow[] =>
  rows.map((r) => ({ section, item: r.key, records: n(r.records), inr: n(r.inr_value) }));

export function buildDashboardRows(data: DashboardData): DashboardExportRow[] {
  const rows: DashboardExportRow[] = [];
  const t = data.totals;
  rows.push({ section: 'Summary', item: 'All records in view', records: n(t.records), inr: n(t.inr_value) });
  rows.push({ section: 'Summary', item: 'Unique hospitals', records: n(t.hospitals), inr: null });
  rows.push({ section: 'Summary', item: 'Unique doctors', records: n(t.doctors), inr: null });
  for (const q of data.quantity_by_unit) {
    rows.push({ section: 'Quantity', item: `Quantity (${q.unit})`, records: n(q.records), inr: null, note: String(n(q.quantity)) });
  }
  // Monthly rows arrive split by a legacy currency bucket — merge them into one INR figure per month
  const monthly = new Map<string, { records: number; inr: number }>();
  for (const m of data.monthly) {
    const cur = monthly.get(m.month) ?? { records: 0, inr: 0 };
    cur.records += Number(m.records);
    cur.inr += Number(m.inr_value);
    monthly.set(m.month, cur);
  }
  for (const [month, v] of [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push({ section: 'Monthly', item: formatMonth(month), records: v.records, inr: v.inr });
  }
  rows.push(...groupRows('Top products', data.by_product));
  rows.push(...groupRows('Top managers', data.by_manager));
  rows.push(...groupRows('Top hospitals', data.by_hospital));
  return rows;
}

export const DASHBOARD_EXPORT_COLUMNS: ExportColumn<DashboardExportRow>[] = [
  { header: 'Section', value: (r) => r.section, width: 20 },
  { header: 'Item', value: (r) => r.item, width: 34 },
  { header: 'Records / Count', value: (r) => r.records },
  { header: 'INR Value', value: (r) => r.inr, numFmt: '#,##0', width: 22 },
  { header: 'Quantity', value: (r) => r.note ?? null },
];

export async function exportDashboard(data: DashboardData, filename: string, preamble: string[]) {
  await downloadXlsx(filename, 'NPP dashboard', buildDashboardRows(data), DASHBOARD_EXPORT_COLUMNS, preamble);
}
