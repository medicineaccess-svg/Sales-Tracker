import type { CurrencyBucket } from '@/types/database';

/** UI filter state (kept in the URL so views are shareable and survive reloads). */
export interface SalesFilters {
  fy?: string; // "FY 2026-27"
  month?: string; // "2026-05"
  date_from?: string; // "2026-04-01"
  date_to?: string;
  product?: string;
  manager?: string;
  hospital?: string;
  doctor?: string;
  place?: string;
  voucher?: string;
  search?: string;
  currency?: CurrencyBucket;
  needs_review?: boolean;
  include_archived?: boolean;
}

export const FILTER_KEYS: (keyof SalesFilters)[] = [
  'fy', 'month', 'date_from', 'date_to', 'product', 'manager', 'hospital', 'doctor', 'place',
  'voucher', 'search', 'currency', 'needs_review', 'include_archived',
];

/** "FY 2026-27" → { from: 2026-04-01, to: 2027-03-31 } (Indian financial year). */
export function fyRange(fy: string): { from: string; to: string } | null {
  const m = fy.match(/(\d{4})/);
  if (!m) return null;
  const start = Number(m[1]);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** The Indian financial year containing a date. */
export function fyOf(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 3 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function monthRange(ym: string): { from: string; to: string } | null {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
}

const maxDate = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);
const minDate = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);

/**
 * Converts UI filters into the jsonb object expected by the npp_* database
 * functions. FY and month narrow the explicit date range (intersection).
 */
export function toRpcFilters(f: SalesFilters): Record<string, string | boolean> {
  let from = f.date_from;
  let to = f.date_to;
  for (const r of [f.fy ? fyRange(f.fy) : null, f.month ? monthRange(f.month) : null]) {
    if (r) {
      from = maxDate(from, r.from);
      to = minDate(to, r.to);
    }
  }
  const out: Record<string, string | boolean> = {};
  if (from) out.date_from = from;
  if (to) out.date_to = to;
  for (const k of ['product', 'manager', 'hospital', 'doctor', 'place', 'voucher', 'search', 'currency'] as const) {
    const v = f[k]?.toString().trim();
    if (v) out[k] = v;
  }
  if (f.needs_review !== undefined) out.needs_review = f.needs_review;
  if (f.include_archived) out.include_archived = true;
  return out;
}

export function activeFilterCount(f: SalesFilters): number {
  return FILTER_KEYS.filter((k) => f[k] !== undefined && f[k] !== '').length;
}

/** Human-readable description of the active filters (shown on reports and exports). */
export function describeFilters(f: SalesFilters): string[] {
  const out: string[] = [];
  const r = toRpcFilters(f);
  if (r.date_from || r.date_to) out.push(`Dates: ${r.date_from ?? 'start'} → ${r.date_to ?? 'latest'}`);
  if (f.fy) out.push(f.fy);
  if (f.month) out.push(`Month: ${f.month}`);
  const labels: [keyof SalesFilters, string][] = [
    ['product', 'Product'], ['manager', 'Manager'], ['hospital', 'Hospital'], ['doctor', 'Doctor'],
    ['place', 'Place'], ['voucher', 'Voucher'], ['search', 'Search'], ['currency', 'Currency'],
  ];
  for (const [k, label] of labels) if (f[k]) out.push(`${label}: ${f[k]}`);
  if (f.needs_review === true) out.push('Only records needing review');
  if (f.include_archived) out.push('Including archived');
  return out.length ? out : ['All active records'];
}

export function filtersFromParams(params: URLSearchParams): SalesFilters {
  const f: SalesFilters = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v === null || v === '') continue;
    if (k === 'needs_review' || k === 'include_archived') (f[k] as boolean) = v === 'true';
    else (f as Record<string, string>)[k] = v;
  }
  return f;
}

export function filtersToParams(f: SalesFilters, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const k of FILTER_KEYS) p.delete(k);
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  return p;
}
