/**
 * Performance calculations for the manager / zone / company dashboards.
 *
 * Pure functions over the `npp_performance` payload — no I/O, fully unit tested.
 *
 * Definitions (all amounts are the sheet's own INR Value, never converted):
 *   Achievement % = Actual ÷ Target × 100          (null when no target)
 *   Remaining     = max(Target − Actual, 0)         (null when no target)
 *   Variance      = Actual − Target                 (null when no target)
 *   Growth %      = (Current − Previous) ÷ Previous × 100   (null when Previous is 0 or missing)
 *
 * Targets are stored per calendar month. A financial-year target is the sum of the months
 * that were explicitly entered — an annual figure is never divided across months here.
 *
 * Hierarchy (no double counting):
 *   manager target = its own monthly row
 *   zone target    = explicit zone row, otherwise the sum of its sales managers' targets
 *   company target = explicit company row, otherwise Σ zone targets + targets of managers without a zone
 */

// ---------------------------------------------------------------------------
// Payload types (mirror public.npp_performance)
// ---------------------------------------------------------------------------

export type Channel = 'individual' | 'ho' | 'ho_third_party' | 'unassigned';

export interface PerfFact {
  month: string; // YYYY-MM-01
  manager_key: string | null;
  manager_label: string;
  zone: string | null; // base zone ("HO South Zone" → "South Zone")
  ho_zone: boolean | null;
  channel: Channel;
  place: string | null;
  records: number;
  inr: number | string | null;
  missing_inr: number;
  dup_flags: number;
  last_sale: string | null;
}

export interface PerfTarget {
  scope: 'manager' | 'zone' | 'company';
  scope_key: string;
  month: string; // YYYY-MM-01
  target: number | string;
}

export interface SalesManager {
  manager_key: string;
  display_name: string;
  aliases: string[];
  employee_id: string | null;
  designation: string | null;
  zone: string | null;
  branch: string | null;
  reporting_manager: string | null;
  is_sales_manager: boolean;
  active: boolean;
}

export interface BranchRule {
  name: string;
  zone?: string | null;
  places: string[];
  channels: Channel[];
  description?: string;
}

export interface ConsolidationSettings {
  ho_zone_rollup?: boolean;
  third_party_bucket?: string;
  branches?: BranchRule[];
}

export interface PerformanceData {
  facts: PerfFact[];
  undated: { records: number; inr: number | string };
  targets: PerfTarget[];
  managers: SalesManager[];
  settings: {
    'targets.pacing'?: string;
    'reporting.consolidation'?: ConsolidationSettings;
    'reporting.financial_year_start_month'?: number;
  };
  last_sync: { finished_at: string | null; started_at: string; status: string; trigger: string } | null;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Number helpers
// ---------------------------------------------------------------------------

export const num = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Rounds to paise to keep sums of decimal strings stable. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export function achievementPct(actual: number, target: number | null | undefined): number | null {
  if (target === null || target === undefined || !(target > 0)) return null;
  return (actual / target) * 100;
}

export function remaining(target: number | null | undefined, actual: number): number | null {
  if (target === null || target === undefined) return null;
  return Math.max(r2(target - actual), 0);
}

export function variance(actual: number, target: number | null | undefined): number | null {
  if (target === null || target === undefined) return null;
  return r2(actual - target);
}

export function growthPct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

// ---------------------------------------------------------------------------
// Calendar helpers (Indian financial year, April–March)
// ---------------------------------------------------------------------------

export const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}

export function fyStartYear(month: string, startMonth = 4): number {
  const [y, m] = month.split('-').map(Number);
  return m >= startMonth ? y : y - 1;
}

export function fyLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function fyMonths(startYear: number, startMonth = 4): string[] {
  return Array.from({ length: 12 }, (_, i) => addMonths(monthKey(startYear, startMonth), i));
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const todayIso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Share of the month that has elapsed on `today` (1 for past months, 0 for future months). */
export function elapsedFraction(month: string, today: string): number {
  const cur = today.slice(0, 7) + '-01';
  if (month < cur) return 1;
  if (month > cur) return 0;
  return Math.min(Number(today.slice(8, 10)) / daysInMonth(month), 1);
}

// ---------------------------------------------------------------------------
// Monthly status
// ---------------------------------------------------------------------------

export type PerfStatus =
  | 'exceeded'
  | 'achieved'
  | 'on_track'
  | 'behind'
  | 'target_not_set'
  | 'no_sales'
  | 'upcoming';

export const STATUS_LABEL: Record<PerfStatus, string> = {
  exceeded: 'Target Exceeded',
  achieved: 'Target Achieved',
  on_track: 'On Track',
  behind: 'Behind Target',
  target_not_set: 'Target Not Set',
  no_sales: 'No Sales Recorded',
  upcoming: 'Not Started',
};

/** Text symbol per status so the meaning never depends on colour alone. */
export const STATUS_SYMBOL: Record<PerfStatus, string> = {
  exceeded: '▲▲',
  achieved: '▲',
  on_track: '●',
  behind: '▼',
  target_not_set: '○',
  no_sales: '–',
  upcoming: '…',
};

export interface StatusInput {
  month: string;
  actual: number;
  records: number;
  target: number | null;
  today: string;
  /** No "Behind Target" during the first N days of the current month. */
  graceDays?: number;
}

export interface StatusResult {
  status: PerfStatus;
  /** Target expected by today (pro-rated for the current month). */
  expectedToDate: number | null;
  elapsed: number;
}

/**
 * Status for ONE month against ONE monthly target. Annual figures must never be passed here.
 *
 *  - target missing / zero      → Target Not Set (sales are still shown elsewhere)
 *  - actual > target            → Target Exceeded
 *  - actual = target            → Target Achieved
 *  - future month               → Not Started
 *  - no sales so far            → No Sales Recorded
 *  - completed month, short     → Behind Target
 *  - current month              → On Track when actual ≥ target × elapsed share (linear pacing),
 *                                 otherwise Behind Target — but never Behind within the grace days
 */
export function monthlyStatus({ month, actual, records, target, today, graceDays = 3 }: StatusInput): StatusResult {
  const elapsed = elapsedFraction(month, today);
  if (target === null || !(target > 0)) return { status: 'target_not_set', expectedToDate: null, elapsed };
  const expectedToDate = r2(target * elapsed);
  if (actual > target + 0.005) return { status: 'exceeded', expectedToDate, elapsed };
  if (Math.abs(actual - target) <= 0.005) return { status: 'achieved', expectedToDate, elapsed };
  if (elapsed === 0) return { status: 'upcoming', expectedToDate, elapsed };
  if (records === 0 || actual <= 0) return { status: 'no_sales', expectedToDate, elapsed };
  if (elapsed >= 1) return { status: 'behind', expectedToDate, elapsed };
  const day = Number(today.slice(8, 10));
  if (day <= graceDays) return { status: 'on_track', expectedToDate, elapsed };
  return { status: actual + 0.005 >= expectedToDate ? 'on_track' : 'behind', expectedToDate, elapsed };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface Totals {
  actual: number;
  records: number;
  dupFlags: number;
  missingInr: number;
}

const emptyTotals = (): Totals => ({ actual: 0, records: 0, dupFlags: 0, missingInr: 0 });

function addFact(t: Totals, f: PerfFact) {
  t.actual = r2(t.actual + num(f.inr));
  t.records += num(f.records);
  t.dupFlags += num(f.dup_flags);
  t.missingInr += num(f.missing_inr);
}

export function sumFacts(facts: PerfFact[], pred: (f: PerfFact) => boolean = () => true): Totals {
  const t = emptyTotals();
  for (const f of facts) if (pred(f)) addFact(t, f);
  return t;
}

/** Totals per month for the given predicate. */
export function monthlySeries(facts: PerfFact[], months: string[], pred: (f: PerfFact) => boolean = () => true) {
  const map = new Map(months.map((m) => [m, emptyTotals()]));
  for (const f of facts) {
    const t = map.get(f.month);
    if (t && pred(f)) addFact(t, f);
  }
  return months.map((m) => ({ month: m, ...map.get(m)! }));
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type TargetSource = 'explicit' | 'sum_of_managers' | 'sum_of_zones' | null;

export interface ResolvedTarget {
  value: number | null;
  source: TargetSource;
}

export class TargetBook {
  private byKey = new Map<string, number>();
  constructor(
    targets: PerfTarget[],
    private managers: SalesManager[],
  ) {
    for (const t of targets) this.byKey.set(`${t.scope}|${t.scope_key}|${t.month}`, num(t.target));
  }

  private get(scope: string, key: string, month: string): number | null {
    const v = this.byKey.get(`${scope}|${key}|${month}`);
    return v === undefined ? null : v;
  }

  manager(key: string, month: string): ResolvedTarget {
    const v = this.get('manager', key, month);
    return { value: v, source: v === null ? null : 'explicit' };
  }

  /** Sales managers that belong to a zone (master data). */
  zoneManagers(zone: string): SalesManager[] {
    return this.managers.filter((m) => m.is_sales_manager && m.zone === zone);
  }

  zone(zone: string, month: string): ResolvedTarget {
    const explicit = this.get('zone', zone, month);
    if (explicit !== null) return { value: explicit, source: 'explicit' };
    let sum = 0;
    let any = false;
    for (const m of this.zoneManagers(zone)) {
      const v = this.get('manager', m.manager_key, month);
      if (v !== null) {
        sum += v;
        any = true;
      }
    }
    return any ? { value: r2(sum), source: 'sum_of_managers' } : { value: null, source: null };
  }

  company(month: string, zones: string[]): ResolvedTarget {
    const explicit = this.get('company', 'company', month);
    if (explicit !== null) return { value: explicit, source: 'explicit' };
    let sum = 0;
    let any = false;
    const zoneSet = new Set(zones);
    for (const m of this.managers) if (m.zone) zoneSet.add(m.zone);
    for (const z of zoneSet) {
      const t = this.zone(z, month);
      if (t.value !== null) {
        sum += t.value;
        any = true;
      }
    }
    // Managers with no zone are not covered by any zone target
    for (const m of this.managers) {
      if (!m.is_sales_manager || m.zone) continue;
      const v = this.get('manager', m.manager_key, month);
      if (v !== null) {
        sum += v;
        any = true;
      }
    }
    return any ? { value: r2(sum), source: 'sum_of_zones' } : { value: null, source: null };
  }

  /** Sum of resolved monthly targets over months; null when no month has a target. */
  static sum(resolved: ResolvedTarget[]): { value: number | null; monthsWithTarget: number } {
    let s = 0;
    let n = 0;
    for (const r of resolved) {
      if (r.value !== null) {
        s += r.value;
        n++;
      }
    }
    return { value: n ? r2(s) : null, monthsWithTarget: n };
  }
}

// ---------------------------------------------------------------------------
// Scope predicates & consolidation
// ---------------------------------------------------------------------------

export const isManager = (key: string) => (f: PerfFact) => f.manager_key === key;
export const inZone = (zone: string) => (f: PerfFact) => f.zone === zone;
export const NO_ZONE = 'Zone not assigned';
export const THIRD_PARTY = 'HO (Third Party)';

/** Zone bucket a fact rolls up into for company-level breakdowns. */
export function zoneBucket(f: PerfFact): string {
  if (f.zone) return f.zone;
  if (f.channel === 'ho_third_party') return THIRD_PARTY;
  return NO_ZONE;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export interface BranchConsolidation {
  rule: BranchRule;
  hoOnly: Totals;
  managersOnly: Totals;
  consolidated: Totals;
  byManager: { manager_key: string; label: string; totals: Totals }[];
  /** Rows at this place that the rule does not include (e.g. third-party sales). */
  excluded: Totals;
  warnings: string[];
}

/**
 * Consolidated branch total = HO rows for the branch + individual managers' rows for the branch.
 * Every sheet row is one fact contribution, so a row can never be counted twice. Rows that look
 * like the same sale recorded under two managers are reported as a warning, never merged.
 */
export function consolidateBranch(facts: PerfFact[], rule: BranchRule, managers: SalesManager[]): BranchConsolidation {
  const places = new Set(rule.places.map(norm));
  const atPlace = (f: PerfFact) => places.has(norm(f.place));
  const zoneOk = (f: PerfFact) => !rule.zone || !f.zone || f.zone === rule.zone;
  const included = (f: PerfFact) => atPlace(f) && zoneOk(f) && rule.channels.includes(f.channel);

  const hoOnly = sumFacts(facts, (f) => included(f) && f.channel === 'ho');
  const managersOnly = sumFacts(facts, (f) => included(f) && f.channel === 'individual');
  const consolidated = sumFacts(facts, included);
  const excluded = sumFacts(facts, (f) => atPlace(f) && !included(f));

  const byMgr = new Map<string, { label: string; totals: Totals }>();
  for (const f of facts) {
    if (!(included(f) && f.channel === 'individual')) continue;
    const k = f.manager_key ?? 'unknown';
    const e = byMgr.get(k) ?? { label: f.manager_label, totals: emptyTotals() };
    addFact(e.totals, f);
    byMgr.set(k, e);
  }

  const warnings: string[] = [];
  if (consolidated.dupFlags > 0) {
    warnings.push(
      `${consolidated.dupFlags} ${rule.name} record(s) share date, customer, product and amount with a record under another manager. ` +
        'They are counted as recorded in the sheet — review them before relying on the consolidated total.',
    );
  }
  if (excluded.records > 0) {
    warnings.push(
      `${excluded.records} ${rule.name} record(s) are outside this rule (e.g. HO third-party or another zone) and are shown separately.`,
    );
  }
  const mgrIndex = new Map(managers.map((m) => [m.manager_key, m]));
  for (const k of byMgr.keys()) {
    const m = mgrIndex.get(k);
    if (!m) warnings.push(`Manager "${byMgr.get(k)!.label}" is not in the sales-manager master data.`);
    else if (rule.zone && m.zone && m.zone !== rule.zone)
      warnings.push(`${m.display_name} is mapped to ${m.zone} but has ${rule.name} sales.`);
  }

  return {
    rule,
    hoOnly,
    managersOnly,
    consolidated,
    byManager: [...byMgr.entries()]
      .map(([manager_key, v]) => ({ manager_key, ...v }))
      .sort((a, b) => b.totals.actual - a.totals.actual),
    excluded,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------------------

export interface Scorecard {
  key: string;
  label: string;
  /** Selected month */
  month: string;
  actual: number;
  records: number;
  target: number | null;
  targetSource: TargetSource;
  achievement: number | null;
  remaining: number | null;
  variance: number | null;
  prevActual: number;
  growth: number | null;
  status: PerfStatus;
  expectedToDate: number | null;
  /** Financial year to date (FY start → selected month) */
  ytdActual: number;
  ytdTarget: number | null;
  ytdAchievement: number | null;
  ytdMonthsWithTarget: number;
  /** Full-FY target = Σ months entered */
  fyTarget: number | null;
  fyMonthsWithTarget: number;
  dupFlags: number;
}

export interface ScorecardArgs {
  key: string;
  label: string;
  facts: PerfFact[];
  pred: (f: PerfFact) => boolean;
  target: (month: string) => ResolvedTarget;
  month: string;
  today: string;
  fyStartMonth?: number;
}

export function scorecard({ key, label, facts, pred, target, month, today, fyStartMonth = 4 }: ScorecardArgs): Scorecard {
  const fy = fyStartYear(month, fyStartMonth);
  const months = fyMonths(fy, fyStartMonth);
  const ytdMonths = months.filter((m) => m <= month);
  const series = monthlySeries(facts, [addMonths(month, -1), ...months], pred);
  const get = (m: string) => series.find((s) => s.month === m) ?? { actual: 0, records: 0, dupFlags: 0 };

  const cur = get(month);
  const prev = get(addMonths(month, -1));
  const t = target(month);
  const st = monthlyStatus({ month, actual: cur.actual, records: cur.records, target: t.value, today });

  // YTD target: completed months in full, the current month pro-rated by elapsed share.
  let ytdT = 0;
  let ytdN = 0;
  for (const m of ytdMonths) {
    const tv = target(m).value;
    if (tv !== null) {
      ytdT += tv * Math.min(elapsedFraction(m, today), 1);
      ytdN++;
    }
  }
  const ytdActual = r2(ytdMonths.reduce((s, m) => s + get(m).actual, 0));
  const fyT = TargetBook.sum(months.map(target));

  return {
    key,
    label,
    month,
    actual: cur.actual,
    records: cur.records,
    target: t.value,
    targetSource: t.source,
    achievement: achievementPct(cur.actual, t.value),
    remaining: remaining(t.value, cur.actual),
    variance: variance(cur.actual, t.value),
    prevActual: prev.actual,
    growth: growthPct(cur.actual, prev.actual),
    status: st.status,
    expectedToDate: st.expectedToDate,
    ytdActual,
    ytdTarget: ytdN ? r2(ytdT) : null,
    ytdAchievement: ytdN ? achievementPct(ytdActual, r2(ytdT)) : null,
    ytdMonthsWithTarget: ytdN,
    fyTarget: fyT.value,
    fyMonthsWithTarget: fyT.monthsWithTarget,
    dupFlags: cur.dupFlags,
  };
}

// ---------------------------------------------------------------------------
// Ranking & performance matrix
// ---------------------------------------------------------------------------

export interface Ranked<T> {
  rank: number | null;
  item: T;
}

/**
 * Fair ranking: only scorecards with a target are ranked (by achievement %, then actual).
 * Those without a target follow, unranked, ordered by actual sales.
 */
export function rankScorecards<T extends Pick<Scorecard, 'achievement' | 'actual' | 'target'>>(items: T[]): Ranked<T>[] {
  const withT = items.filter((i) => i.achievement !== null).sort((a, b) => b.achievement! - a.achievement! || b.actual - a.actual);
  const without = items.filter((i) => i.achievement === null).sort((a, b) => b.actual - a.actual);
  const out: Ranked<T>[] = [];
  let rank = 0;
  let prev: T | null = null;
  withT.forEach((item, i) => {
    if (!prev || prev.achievement !== item.achievement || prev.actual !== item.actual) rank = i + 1;
    out.push({ rank, item });
    prev = item;
  });
  for (const item of without) out.push({ rank: null, item });
  return out;
}

export type MatrixCategory = 'star' | 'achiever_slowing' | 'improving' | 'at_risk' | 'no_target';

export const MATRIX_LABEL: Record<MatrixCategory, string> = {
  star: 'Achieving & growing',
  achiever_slowing: 'Achieving, sales down vs last month',
  improving: 'Below target, sales up vs last month',
  at_risk: 'Below target & sales down',
  no_target: 'Target not set',
};

export function matrixCategory(achievement: number | null, growth: number | null): MatrixCategory {
  if (achievement === null) return 'no_target';
  const growing = growth === null || growth >= 0;
  if (achievement >= 100) return growing ? 'star' : 'achiever_slowing';
  return growing ? 'improving' : 'at_risk';
}

// ---------------------------------------------------------------------------
// Forecast (labelled run-rate projection, never presented as actuals)
// ---------------------------------------------------------------------------

export function projectMonth(actual: number, month: string, today: string): number | null {
  const e = elapsedFraction(month, today);
  if (e <= 0) return null;
  if (e >= 1) return actual;
  return r2(actual / e);
}

/** FY projection = actual so far + average of completed months × months still to come. */
export function projectFy(series: { month: string; actual: number }[], today: string): number | null {
  const done = series.filter((s) => elapsedFraction(s.month, today) >= 1);
  if (done.length === 0) return null;
  const avg = done.reduce((s, x) => s + x.actual, 0) / done.length;
  let total = 0;
  for (const s of series) {
    const e = elapsedFraction(s.month, today);
    if (e >= 1) total += s.actual;
    else total += avg; // current month uses the run-rate average, not a partial extrapolation
  }
  return r2(total);
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/** Distinct zones present in facts or master data (HO zones already rolled up). */
export function zonesOf(data: Pick<PerformanceData, 'facts' | 'managers'>): string[] {
  const s = new Set<string>();
  for (const f of data.facts) if (f.zone) s.add(f.zone);
  for (const m of data.managers) if (m.zone) s.add(m.zone);
  return [...s].sort();
}

/** Latest month with at least one dated sale, not after today. */
export function latestDataMonth(facts: PerfFact[], today: string): string | null {
  const cur = today.slice(0, 7) + '-01';
  let best: string | null = null;
  for (const f of facts) if (f.month <= cur && num(f.records) > 0 && (!best || f.month > best)) best = f.month;
  return best;
}

export function salesManagers(managers: SalesManager[]): SalesManager[] {
  return managers.filter((m) => m.is_sales_manager && m.active).sort((a, b) => a.display_name.localeCompare(b.display_name));
}
