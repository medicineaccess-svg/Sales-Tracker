import {
  achievementPct,
  addMonths,
  growthPct,
  monthlySeries,
  type PerfFact,
  type ResolvedTarget,
} from '@/lib/performance';
import type { MonthPoint } from './perfCharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTHS[mo - 1]} ${String(y).slice(2)}`;
};

export interface MonthRow extends MonthPoint {
  month: string;
  records: number;
  variance: number | null;
  remaining: number | null;
  prevActual: number;
}

/**
 * Month-by-month rows for an FY. Months after `upTo` are kept (targets are visible) but carry no
 * achievement or growth, so future months never read as 0 %.
 */
export function buildMonthRows(
  facts: PerfFact[],
  months: string[],
  pred: (f: PerfFact) => boolean,
  target: (m: string) => ResolvedTarget,
  upTo: string,
): MonthRow[] {
  const prevMonth = addMonths(months[0], -1);
  const series = monthlySeries(facts, [prevMonth, ...months], pred);
  let cumA = 0;
  let cumT = 0;
  let anyT = false;
  return months.map((m, i) => {
    const cur = series[i + 1];
    const prev = series[i];
    const t = target(m).value;
    const future = m > upTo;
    if (!future) cumA += cur.actual;
    if (t !== null) {
      cumT += t;
      anyT = true;
    }
    return {
      month: m,
      label: short(m),
      actual: future ? 0 : cur.actual,
      records: future ? 0 : cur.records,
      target: t,
      achievement: future ? null : achievementPct(cur.actual, t),
      growth: future ? null : growthPct(cur.actual, prev.actual),
      variance: future || t === null ? null : Math.round((cur.actual - t) * 100) / 100,
      remaining: future || t === null ? null : Math.max(Math.round((t - cur.actual) * 100) / 100, 0),
      prevActual: prev.actual,
      cumActual: Math.round(cumA * 100) / 100,
      cumTarget: anyT ? Math.round(cumT * 100) / 100 : null,
    };
  });
}
