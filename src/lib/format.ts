import type { CurrencyBucket } from '@/types/database';

export const CURRENCY_LABEL: Record<CurrencyBucket, string> = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  INR: 'INR',
  UNSPECIFIED: 'Currency not stated',
};

/** Series colour per currency — fixed by entity, never by rank. */
export const CURRENCY_COLOR: Record<CurrencyBucket, string> = {
  USD: '#226192',
  EUR: '#ef8557',
  GBP: '#7652c7',
  INR: '#1f9e86',
  UNSPECIFIED: '#8f8a80',
};

/**
 * Brand-derived categorical order (#226192 blue, #EF8557 orange + accessible shades).
 * Validated: adjacent CVD ΔE ≥ 11.4, normal-vision ΔE ≥ 20.1 on the #FBFAF7 card surface.
 * Lighter slots sit below 3:1 contrast, so every chart ships tooltips and a data-table view.
 */
export const SERIES = ['#226192', '#ef8557', '#7652c7', '#1f9e86', '#c98a00', '#5d9be0', '#b4532b'];
export const SERIES_OTHER = '#8f8a80';

export const CURRENCY_ORDER: CurrencyBucket[] = ['USD', 'EUR', 'GBP', 'INR', 'UNSPECIFIED'];

export function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Formats money in its own currency. INR uses Indian digit grouping. */
export function formatMoney(
  v: number | string | null | undefined,
  currency: CurrencyBucket | null | undefined,
  opts: { compact?: boolean; decimals?: number } = {},
): string {
  const n = toNumber(v);
  if (n === null) return '—';
  const c = currency ?? 'UNSPECIFIED';
  const decimals = opts.decimals ?? (opts.compact ? 1 : c === 'INR' ? 0 : 2);
  if (c === 'UNSPECIFIED') {
    return new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: opts.compact ? 0 : decimals,
      notation: opts.compact ? 'compact' : 'standard',
    }).format(n);
  }
  return new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: decimals,
    minimumFractionDigits: opts.compact ? 0 : decimals,
    notation: opts.compact ? 'compact' : 'standard',
  }).format(n);
}

/** ₹ amounts in Lakh/Crore for headline tiles, e.g. ₹21.15 Cr. */
export function formatInrShort(v: number | string | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return formatMoney(n, 'INR');
}

export function formatNumber(v: number | string | null | undefined, decimals = 0): string {
  const n = toNumber(v);
  if (n === null) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: decimals }).format(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-04-01 → 01 Apr 2026 (timezone-safe: parses the date parts, not a Date). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} d ago`;
}
