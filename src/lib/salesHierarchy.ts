/**
 * Sales hierarchy built only from columns in the sheet:
 *
 *   Company → Manager → { Own sales | HO sales credited to the manager } → Zone → transactions
 *
 * "Own sales"  = rows where "Ikris Manager Involved" is the manager (e.g. Firoz).
 * "HO sales"   = rows where "Ikris Manager Involved" is HO and Zone names the manager,
 *                e.g. "HO North Zone (Firoz)".
 * HO (Third Party) rows and HO rows without a name are credited to nobody and are shown as
 * separate company-level buckets.
 *
 * Every fact (sheet row aggregate) lands in exactly one leaf, so each level is the plain sum of
 * the level below it: Zone → HO/Own → Manager → Company. Nothing can be counted twice.
 */
import { num, type PerfFact } from './performance';

export type SalesType = 'own' | 'ho';

export interface HierFact extends PerfFact {
  owner_key: string | null;
  owner_label: string | null;
}

export interface HierNode {
  key: string;
  label: string;
  total: number;
  records: number;
  /** Totals per month, aligned with the `months` array passed to buildTree */
  monthly: number[];
}

export interface ZoneNode extends HierNode {
  zone: string | null;
}

export interface TypeNode extends HierNode {
  type: SalesType;
  zones: ZoneNode[];
}

export interface ManagerNode extends HierNode {
  own: number;
  ho: number;
  types: TypeNode[];
  zones: string[];
}

export interface BucketNode extends HierNode {
  reason: 'third_party' | 'ho_unassigned' | 'no_manager';
}

export interface CompanyTree extends HierNode {
  managers: ManagerNode[];
  buckets: BucketNode[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export const typeOf = (f: Pick<PerfFact, 'channel'>): SalesType | null =>
  f.channel === 'individual' ? 'own' : f.channel === 'ho' ? 'ho' : null;

export function bucketOf(f: HierFact): BucketNode['reason'] | null {
  if (f.owner_key) return null;
  if (f.channel === 'ho_third_party') return 'third_party';
  if (f.channel === 'ho') return 'ho_unassigned';
  return 'no_manager';
}

export const BUCKET_LABEL: Record<BucketNode['reason'], string> = {
  third_party: 'HO (Third Party)',
  ho_unassigned: 'HO — manager not named in Zone',
  no_manager: 'Manager not stated',
};

export const typeLabel = (type: SalesType, managerLabel: string, zone?: string | null) =>
  type === 'own' ? `${managerLabel} — own sales` : `HO ${zone ?? ''}`.trim() + ` (${managerLabel})`;

function node<T extends HierNode>(base: Omit<T, 'total' | 'records' | 'monthly'>, len: number): T {
  return { ...base, total: 0, records: 0, monthly: new Array(len).fill(0) } as T;
}

function add(n: HierNode, f: PerfFact, idx: number) {
  const v = num(f.inr);
  n.total = r2(n.total + v);
  n.records += num(f.records);
  if (idx >= 0) n.monthly[idx] = r2(n.monthly[idx] + v);
}

/**
 * Aggregates facts into the hierarchy. Pass only the facts for the period you want
 * (e.g. one financial year); `months` controls the monthly arrays.
 */
export function buildTree(facts: HierFact[], months: string[]): CompanyTree {
  const len = months.length;
  const mIdx = new Map(months.map((m, i) => [m, i]));
  const company = node<CompanyTree>({ key: 'company', label: 'Company', managers: [], buckets: [] }, len);
  const managers = new Map<string, ManagerNode>();
  const buckets = new Map<string, BucketNode>();

  for (const f of facts) {
    const idx = mIdx.get(f.month) ?? -1;
    add(company, f, idx);
    const b = bucketOf(f);
    if (b) {
      const bn = buckets.get(b) ?? node<BucketNode>({ key: b, label: BUCKET_LABEL[b], reason: b }, len);
      add(bn, f, idx);
      buckets.set(b, bn);
      continue;
    }
    const key = f.owner_key!;
    const m =
      managers.get(key) ??
      node<ManagerNode>({ key, label: f.owner_label ?? key, own: 0, ho: 0, types: [], zones: [] }, len);
    add(m, f, idx);
    const type = typeOf(f) ?? 'own';
    if (type === 'own') m.own = r2(m.own + num(f.inr));
    else m.ho = r2(m.ho + num(f.inr));
    let t = m.types.find((x) => x.type === type);
    if (!t) {
      t = node<TypeNode>({ key: type, label: '', type, zones: [] }, len);
      m.types.push(t);
    }
    add(t, f, idx);
    const zk = f.zone ?? 'Zone not stated';
    let z = t.zones.find((x) => x.key === zk);
    if (!z) {
      z = node<ZoneNode>({ key: zk, label: zk, zone: f.zone }, len);
      t.zones.push(z);
    }
    add(z, f, idx);
    if (f.zone && !m.zones.includes(f.zone)) m.zones.push(f.zone);
    managers.set(key, m);
  }

  for (const m of managers.values()) {
    m.types.sort((a, b) => (a.type === 'own' ? -1 : 1) - (b.type === 'own' ? -1 : 1));
    for (const t of m.types) {
      t.label = typeLabel(t.type, m.label, t.zones.length === 1 ? t.zones[0].zone : null);
      t.zones.sort((a, b) => b.total - a.total);
    }
    m.zones.sort();
  }
  company.managers = [...managers.values()].sort((a, b) => b.total - a.total);
  company.buckets = [...buckets.values()].sort((a, b) => b.total - a.total);
  return company;
}

// ---------------------------------------------------------------------------
// Monthly statistics for one person / node
// ---------------------------------------------------------------------------

export interface MonthPointStat {
  month: string;
  value: number;
  /** % change vs previous month; null when the previous month had no sales */
  growth: number | null;
}

export interface MonthlyStats {
  total: number;
  /** Mean over the months counted (FY start → last month with company data) */
  average: number | null;
  highest: { month: string; value: number } | null;
  lowest: { month: string; value: number } | null;
  monthsCounted: number;
  points: MonthPointStat[];
}

/**
 * @param months  the FY months (April → March)
 * @param values  totals aligned with `months`
 * @param upTo    last month to include in average / highest / lowest (usually the latest month
 *                with any sales in the sheet), so months that have not happened yet never count as 0.
 */
export function monthlyStats(months: string[], values: number[], upTo: string | null): MonthlyStats {
  const points: MonthPointStat[] = months.map((m, i) => {
    const prev = i > 0 ? values[i - 1] : null;
    return {
      month: m,
      value: values[i] ?? 0,
      growth: prev && prev > 0 && (!upTo || m <= upTo) ? ((values[i] - prev) / prev) * 100 : null,
    };
  });
  const counted = points.filter((p) => upTo !== null && p.month <= upTo);
  const total = r2(points.reduce((s, p) => s + p.value, 0));
  if (!counted.length) return { total, average: null, highest: null, lowest: null, monthsCounted: 0, points };
  let hi = counted[0];
  let lo = counted[0];
  for (const p of counted) {
    if (p.value > hi.value) hi = p;
    if (p.value < lo.value) lo = p;
  }
  return {
    total,
    average: r2(counted.reduce((s, p) => s + p.value, 0) / counted.length),
    highest: { month: hi.month, value: hi.value },
    lowest: { month: lo.month, value: lo.value },
    monthsCounted: counted.length,
    points,
  };
}
