import { describe, expect, it } from 'vitest';
import { buildTree, monthlyStats, type HierFact } from '@/lib/salesHierarchy';
import { fyMonths } from '@/lib/performance';

const f = (p: Partial<HierFact>): HierFact => ({
  month: '2026-04-01',
  manager_key: 'firoz',
  manager_label: 'Firoz',
  owner_key: 'firoz',
  owner_label: 'Firoz',
  zone: 'North Zone',
  ho_zone: false,
  channel: 'individual',
  place: 'Delhi',
  records: 1,
  inr: 0,
  missing_inr: 0,
  dup_flags: 0,
  last_sale: null,
  ...p,
});

const months = fyMonths(2026);

// Mirrors the real sheet: Firoz own + "HO North Zone (Firoz)", Fazan own + "HO South Zone (Fazan)", third party
const FACTS: HierFact[] = [
  f({ inr: 1000, records: 2 }),
  f({ month: '2026-05-01', inr: 500 }),
  f({ channel: 'ho', manager_key: 'ho', manager_label: 'HO', ho_zone: true, inr: 300 }),
  f({ owner_key: 'fazan', owner_label: 'Fazan', manager_key: 'fazan', manager_label: 'Fazan', zone: 'South Zone', place: 'Bangalore', inr: 200, month: '2026-08-01' }),
  f({ owner_key: 'fazan', owner_label: 'Fazan', manager_key: 'ho', manager_label: 'HO', channel: 'ho', zone: 'South Zone', place: 'Bangalore', inr: 700 }),
  f({ owner_key: null, owner_label: null, manager_key: 'ho (third party)', manager_label: 'HO (Third Party)', channel: 'ho_third_party', zone: null, inr: 4000 }),
  f({ owner_key: null, owner_label: null, manager_key: 'ho', manager_label: 'HO', channel: 'ho', zone: 'West Zone', inr: 50 }),
];

describe('buildTree — consolidation without double counting', () => {
  const t = buildTree(FACTS, months);

  it('company total equals the sum of every row exactly once', () => {
    expect(t.total).toBe(1000 + 500 + 300 + 200 + 700 + 4000 + 50);
    const managers = t.managers.reduce((s, m) => s + m.total, 0);
    const buckets = t.buckets.reduce((s, b) => s + b.total, 0);
    expect(managers + buckets).toBe(t.total);
  });

  it('manager total = own + HO sales credited to the manager', () => {
    const firoz = t.managers.find((m) => m.key === 'firoz')!;
    expect(firoz.own).toBe(1500);
    expect(firoz.ho).toBe(300);
    expect(firoz.total).toBe(1800);
    expect(firoz.types.map((x) => x.total).reduce((a, b) => a + b, 0)).toBe(firoz.total);
    expect(firoz.records).toBe(4);
  });

  it('HO level total = sum of its zones; labels follow the sheet', () => {
    const fazan = t.managers.find((m) => m.key === 'fazan')!;
    const ho = fazan.types.find((x) => x.type === 'ho')!;
    expect(ho.label).toBe('HO South Zone (Fazan)');
    expect(ho.zones.reduce((s, z) => s + z.total, 0)).toBe(ho.total);
    expect(fazan.types[0].type).toBe('own');
  });

  it('keeps third-party and unnamed HO sales out of every manager', () => {
    expect(t.buckets.map((b) => [b.reason, b.total])).toEqual([
      ['third_party', 4000],
      ['ho_unassigned', 50],
    ]);
  });

  it('builds month-aligned totals', () => {
    const firoz = t.managers.find((m) => m.key === 'firoz')!;
    expect(firoz.monthly[0]).toBe(1300); // April: 1000 own + 300 HO
    expect(firoz.monthly[1]).toBe(500);
    expect(t.monthly.reduce((a, b) => a + b, 0)).toBe(t.total);
  });

  it('orders managers by total sales', () => {
    expect(t.managers.map((m) => m.key)).toEqual(['firoz', 'fazan']);
  });
});

describe('monthlyStats', () => {
  const values = [100, 300, 0, 200, 0, 0, 0, 0, 0, 0, 0, 0];

  it('computes total, average, highest and lowest over months up to the latest data month', () => {
    const s = monthlyStats(months, values, '2026-07-01');
    expect(s.total).toBe(600);
    expect(s.monthsCounted).toBe(4);
    expect(s.average).toBe(150);
    expect(s.highest).toEqual({ month: '2026-05-01', value: 300 });
    expect(s.lowest).toEqual({ month: '2026-06-01', value: 0 });
  });

  it('computes month-on-month growth and skips months without a prior sale', () => {
    const s = monthlyStats(months, values, '2026-07-01');
    expect(s.points[0].growth).toBeNull();
    expect(s.points[1].growth).toBe(200);
    expect(s.points[2].growth).toBe(-100);
    expect(s.points[3].growth).toBeNull(); // previous month was 0
    expect(s.points[4].growth).toBeNull(); // after the latest data month
  });

  it('handles no data', () => {
    const s = monthlyStats(months, new Array(12).fill(0), null);
    expect(s.average).toBeNull();
    expect(s.highest).toBeNull();
  });
});
