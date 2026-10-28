import { describe, expect, it } from 'vitest';
import {
  achievementPct,
  addMonths,
  consolidateBranch,
  elapsedFraction,
  fyMonths,
  fyStartYear,
  growthPct,
  latestDataMonth,
  matrixCategory,
  monthlyStatus,
  projectFy,
  projectMonth,
  rankScorecards,
  remaining,
  scorecard,
  sumFacts,
  TargetBook,
  variance,
  zoneBucket,
  type BranchRule,
  type PerfFact,
  type PerfTarget,
  type SalesManager,
} from '@/lib/performance';

const fact = (p: Partial<PerfFact>): PerfFact => ({
  month: '2026-08-01',
  manager_key: 'ho',
  manager_label: 'HO',
  zone: 'South Zone',
  ho_zone: true,
  channel: 'ho',
  place: 'Bangalore',
  records: 1,
  inr: 0,
  missing_inr: 0,
  dup_flags: 0,
  last_sale: null,
  ...p,
});

const mgr = (p: Partial<SalesManager>): SalesManager => ({
  manager_key: 'x',
  display_name: 'X',
  aliases: [],
  employee_id: null,
  designation: null,
  zone: null,
  branch: null,
  reporting_manager: null,
  is_sales_manager: true,
  active: true,
  ...p,
});

const MANAGERS: SalesManager[] = [
  mgr({ manager_key: 'fazan', display_name: 'Fazan', zone: 'South Zone' }),
  mgr({ manager_key: 'iyappan', display_name: 'Iyappan', zone: 'South Zone' }),
  mgr({ manager_key: 'firoz', display_name: 'Firoz', zone: 'North Zone' }),
  mgr({ manager_key: 'ho', display_name: 'HO', is_sales_manager: false }),
  mgr({ manager_key: 'ho (third party)', display_name: 'HO (Third Party)', is_sales_manager: false }),
];

const BANGALORE: BranchRule = {
  name: 'Bangalore',
  zone: 'South Zone',
  places: ['Bangalore', 'Bengaluru'],
  channels: ['ho', 'individual'],
};

describe('core formulas', () => {
  it('computes achievement, remaining, variance and growth', () => {
    expect(achievementPct(75, 100)).toBe(75);
    expect(remaining(100, 75)).toBe(25);
    expect(remaining(100, 130)).toBe(0); // never negative
    expect(variance(130, 100)).toBe(30);
    expect(variance(70, 100)).toBe(-30);
    expect(growthPct(120, 100)).toBe(20);
    expect(growthPct(80, 100)).toBe(-20);
  });

  it('handles zero and missing values safely', () => {
    expect(achievementPct(50, 0)).toBeNull();
    expect(achievementPct(50, null)).toBeNull();
    expect(remaining(null, 10)).toBeNull();
    expect(variance(10, undefined)).toBeNull();
    expect(growthPct(100, 0)).toBeNull();
    expect(growthPct(0, 0)).toBeNull();
    expect(growthPct(0, 100)).toBe(-100);
  });
});

describe('calendar', () => {
  it('uses the Indian financial year (April–March)', () => {
    expect(fyStartYear('2026-03-01')).toBe(2025);
    expect(fyStartYear('2026-04-01')).toBe(2026);
    const m = fyMonths(2026);
    expect(m[0]).toBe('2026-04-01');
    expect(m[11]).toBe('2027-03-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
  });

  it('computes the elapsed share of a month', () => {
    expect(elapsedFraction('2026-09-01', '2026-10-28')).toBe(1);
    expect(elapsedFraction('2026-11-01', '2026-10-28')).toBe(0);
    expect(elapsedFraction('2026-10-01', '2026-10-31')).toBe(1);
    expect(elapsedFraction('2026-10-01', '2026-10-15')).toBeCloseTo(15 / 31);
  });
});

describe('monthlyStatus', () => {
  const today = '2026-10-15';
  it('reports Target Not Set when no monthly target exists', () => {
    expect(monthlyStatus({ month: '2026-09-01', actual: 500, records: 2, target: null, today }).status).toBe('target_not_set');
    expect(monthlyStatus({ month: '2026-09-01', actual: 500, records: 2, target: 0, today }).status).toBe('target_not_set');
  });
  it('distinguishes exceeded and achieved', () => {
    expect(monthlyStatus({ month: '2026-09-01', actual: 101, records: 1, target: 100, today }).status).toBe('exceeded');
    expect(monthlyStatus({ month: '2026-09-01', actual: 100, records: 1, target: 100, today }).status).toBe('achieved');
  });
  it('marks completed months below target as behind', () => {
    expect(monthlyStatus({ month: '2026-09-01', actual: 99, records: 1, target: 100, today }).status).toBe('behind');
  });
  it('reports No Sales Recorded instead of a percentage when nothing was sold', () => {
    expect(monthlyStatus({ month: '2026-09-01', actual: 0, records: 0, target: 100, today }).status).toBe('no_sales');
  });
  it('paces the current month linearly', () => {
    // 15 of 31 days elapsed → expected ≈ 48.39 of 100
    const on = monthlyStatus({ month: '2026-10-01', actual: 50, records: 1, target: 100, today });
    expect(on.status).toBe('on_track');
    expect(on.expectedToDate).toBeCloseTo(48.39, 2);
    expect(monthlyStatus({ month: '2026-10-01', actual: 40, records: 1, target: 100, today }).status).toBe('behind');
  });
  it('never marks a manager behind in the first days of the month', () => {
    expect(monthlyStatus({ month: '2026-10-01', actual: 1, records: 1, target: 100, today: '2026-10-02' }).status).toBe('on_track');
  });
  it('treats future months as not started', () => {
    expect(monthlyStatus({ month: '2026-12-01', actual: 0, records: 0, target: 100, today }).status).toBe('upcoming');
  });
});

describe('TargetBook — no double counting', () => {
  const targets: PerfTarget[] = [
    { scope: 'manager', scope_key: 'fazan', month: '2026-08-01', target: 1000 },
    { scope: 'manager', scope_key: 'iyappan', month: '2026-08-01', target: 2000 },
    { scope: 'manager', scope_key: 'firoz', month: '2026-08-01', target: 4000 },
  ];

  it('derives zone targets from manager targets when no zone target exists', () => {
    const book = new TargetBook(targets, MANAGERS);
    expect(book.zone('South Zone', '2026-08-01')).toEqual({ value: 3000, source: 'sum_of_managers' });
  });

  it('uses an explicit zone target instead of (not in addition to) manager targets', () => {
    const book = new TargetBook([...targets, { scope: 'zone', scope_key: 'South Zone', month: '2026-08-01', target: 5000 }], MANAGERS);
    expect(book.zone('South Zone', '2026-08-01')).toEqual({ value: 5000, source: 'explicit' });
    expect(book.company('2026-08-01', ['South Zone', 'North Zone']).value).toBe(9000); // 5000 + 4000
  });

  it('uses an explicit company target when present', () => {
    const book = new TargetBook([...targets, { scope: 'company', scope_key: 'company', month: '2026-08-01', target: 12000 }], MANAGERS);
    expect(book.company('2026-08-01', [])).toEqual({ value: 12000, source: 'explicit' });
  });

  it('returns null rather than zero when no targets exist', () => {
    const book = new TargetBook([], MANAGERS);
    expect(book.manager('fazan', '2026-08-01').value).toBeNull();
    expect(book.zone('South Zone', '2026-08-01').value).toBeNull();
    expect(book.company('2026-08-01', ['South Zone']).value).toBeNull();
  });

  it('sums FY targets only over months that were entered (no equal split)', () => {
    const book = new TargetBook(targets, MANAGERS);
    const fy = TargetBook.sum(fyMonths(2026).map((m) => book.manager('fazan', m)));
    expect(fy).toEqual({ value: 1000, monthsWithTarget: 1 });
  });
});

describe('HO–Bangalore consolidation', () => {
  it('adds HO and individual Bangalore sales when they are separate transactions', () => {
    const facts = [
      fact({ channel: 'ho', manager_key: 'ho', inr: 700000, records: 2 }),
      fact({ channel: 'individual', manager_key: 'fazan', manager_label: 'Fazan', ho_zone: false, inr: 794300 }),
    ];
    const c = consolidateBranch(facts, BANGALORE, MANAGERS);
    expect(c.hoOnly.actual).toBe(700000);
    expect(c.managersOnly.actual).toBe(794300);
    expect(c.consolidated.actual).toBe(1494300);
    expect(c.consolidated.records).toBe(3);
    expect(c.warnings).toEqual([]);
  });

  it('counts each sheet row once and flags a sale recorded under both HO and a manager', () => {
    // Same sale appears twice in the sheet: once as HO, once as Fazan (parser flags both rows)
    const facts = [
      fact({ channel: 'ho', manager_key: 'ho', inr: 705000, dup_flags: 1 }),
      fact({ channel: 'individual', manager_key: 'fazan', manager_label: 'Fazan', ho_zone: false, inr: 705000, dup_flags: 1 }),
    ];
    const c = consolidateBranch(facts, BANGALORE, MANAGERS);
    expect(c.consolidated.actual).toBe(1410000); // as recorded — never silently merged
    expect(c.consolidated.dupFlags).toBe(2);
    expect(c.warnings[0]).toMatch(/review them/);
  });

  it('keeps third-party and other-place sales out of the consolidated figure but reports them', () => {
    const facts = [
      fact({ channel: 'ho', manager_key: 'ho', inr: 100 }),
      fact({ channel: 'ho_third_party', manager_key: 'ho (third party)', zone: null, inr: 564000 }),
      fact({ channel: 'individual', manager_key: 'iyappan', place: 'Chennai', inr: 999 }),
      fact({ channel: 'ho', manager_key: 'ho', place: 'bengaluru', inr: 50 }),
    ];
    const c = consolidateBranch(facts, BANGALORE, MANAGERS);
    expect(c.consolidated.actual).toBe(150);
    expect(c.excluded.actual).toBe(564000);
    expect(c.warnings.some((w) => w.includes('outside this rule'))).toBe(true);
  });

  it('flags a Bangalore manager mapped to a different zone, and unknown managers', () => {
    const facts = [
      fact({ channel: 'individual', manager_key: 'firoz', manager_label: 'Firoz', inr: 10 }),
      fact({ channel: 'individual', manager_key: 'newbie', manager_label: 'Newbie', inr: 10 }),
    ];
    const c = consolidateBranch(facts, BANGALORE, MANAGERS);
    expect(c.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Firoz is mapped to North Zone'), expect.stringContaining('"Newbie" is not in')]),
    );
  });

  it('is configurable for other branches', () => {
    const facts = [fact({ place: 'Chennai', channel: 'individual', manager_key: 'iyappan', inr: 42 })];
    const c = consolidateBranch(facts, { name: 'Chennai', places: ['Chennai'], channels: ['individual'] }, MANAGERS);
    expect(c.consolidated.actual).toBe(42);
  });

  it('rolls HO zone sales into the base zone for zone totals', () => {
    const facts = [
      fact({ channel: 'ho', zone: 'South Zone', inr: 100 }),
      fact({ channel: 'individual', manager_key: 'iyappan', zone: 'South Zone', inr: 200 }),
      fact({ channel: 'ho_third_party', zone: null, inr: 300 }),
    ];
    expect(sumFacts(facts, (f) => f.zone === 'South Zone').actual).toBe(300);
    expect(zoneBucket(facts[2])).toBe('HO (Third Party)');
  });
});

describe('scorecard', () => {
  const facts = [
    fact({ month: '2026-07-01', channel: 'individual', manager_key: 'fazan', inr: 400 }),
    fact({ month: '2026-08-01', channel: 'individual', manager_key: 'fazan', inr: 600 }),
    fact({ month: '2026-08-01', channel: 'individual', manager_key: 'iyappan', inr: 9999 }),
  ];
  const book = new TargetBook(
    [
      { scope: 'manager', scope_key: 'fazan', month: '2026-07-01', target: 500 },
      { scope: 'manager', scope_key: 'fazan', month: '2026-08-01', target: 500 },
    ],
    MANAGERS,
  );
  const sc = scorecard({
    key: 'fazan',
    label: 'Fazan',
    facts,
    pred: (f) => f.manager_key === 'fazan',
    target: (m) => book.manager('fazan', m),
    month: '2026-08-01',
    today: '2026-10-28',
  });

  it('computes the selected month against its monthly target', () => {
    expect(sc.actual).toBe(600);
    expect(sc.target).toBe(500);
    expect(sc.achievement).toBe(120);
    expect(sc.status).toBe('exceeded');
    expect(sc.growth).toBe(50);
  });

  it('computes FY-to-date against the months entered, separately from the month', () => {
    expect(sc.ytdActual).toBe(1000);
    expect(sc.ytdTarget).toBe(1000);
    expect(sc.ytdAchievement).toBe(100);
    expect(sc.fyTarget).toBe(1000);
    expect(sc.fyMonthsWithTarget).toBe(2);
  });
});

describe('ranking', () => {
  it('ranks only managers with targets; others follow unranked', () => {
    const r = rankScorecards([
      { id: 'a', achievement: null, actual: 10_000_000, target: null },
      { id: 'b', achievement: 90, actual: 90, target: 100 },
      { id: 'c', achievement: 140, actual: 140, target: 100 },
    ]);
    expect(r.map((x) => [x.item.id, x.rank])).toEqual([
      ['c', 1],
      ['b', 2],
      ['a', null],
    ]);
  });

  it('assigns equal rank to ties', () => {
    const r = rankScorecards([
      { achievement: 100, actual: 50, target: 50 },
      { achievement: 100, actual: 50, target: 50 },
      { achievement: 80, actual: 40, target: 50 },
    ]);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3]);
  });

  it('categorises the performance matrix', () => {
    expect(matrixCategory(120, 5)).toBe('star');
    expect(matrixCategory(120, -5)).toBe('achiever_slowing');
    expect(matrixCategory(60, 10)).toBe('improving');
    expect(matrixCategory(60, -10)).toBe('at_risk');
    expect(matrixCategory(null, 10)).toBe('no_target');
  });
});

describe('forecast', () => {
  it('projects the current month by run rate and completed months as actual', () => {
    expect(projectMonth(500, '2026-10-01', '2026-10-15')).toBeCloseTo(1033.33, 2);
    expect(projectMonth(500, '2026-09-01', '2026-10-15')).toBe(500);
    expect(projectMonth(0, '2026-11-01', '2026-10-15')).toBeNull();
  });

  it('projects the FY from completed-month averages', () => {
    const s = fyMonths(2026).map((m, i) => ({ month: m, actual: i < 6 ? 100 : 0 }));
    expect(projectFy(s, '2026-10-15')).toBe(1200);
    expect(projectFy(s, '2026-04-10')).toBeNull();
  });
});

describe('latestDataMonth', () => {
  it('finds the latest month with sales not after today', () => {
    const facts = [fact({ month: '2026-09-01' }), fact({ month: '2026-12-01' }), fact({ month: '2026-08-01' })];
    expect(latestDataMonth(facts, '2026-10-28')).toBe('2026-09-01');
  });
});
