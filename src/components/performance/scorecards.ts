import {
  inZone,
  isManager,
  NO_ZONE,
  salesManagers,
  scorecard,
  THIRD_PARTY,
  zoneBucket,
  type PerfFact,
  type ResolvedTarget,
  type Scorecard,
} from '@/lib/performance';
import type { PerfModel, PerfParams } from './PerfUi';

export interface ManagerCard extends Scorecard {
  zone: string | null;
  inMaster: boolean;
}

/** Scorecards for every active sales manager (plus unknown names found in the data). */
export function managerScorecards(model: PerfModel, params: PerfParams, month = model.month): ManagerCard[] {
  const masters = salesManagers(model.data.managers).filter((m) => !params.zone || m.zone === params.zone);
  const keys = new Map(masters.map((m) => [m.manager_key, { label: m.display_name, zone: m.zone, inMaster: true }]));
  const nonSales = new Set(model.data.managers.filter((m) => !m.is_sales_manager).map((m) => m.manager_key));
  for (const f of model.facts) {
    if (f.channel !== 'individual' || !f.manager_key || keys.has(f.manager_key) || nonSales.has(f.manager_key)) continue;
    keys.set(f.manager_key, { label: f.manager_label, zone: f.zone, inMaster: false });
  }
  return [...keys.entries()]
    .filter(([k]) => !params.manager || k === params.manager)
    .map(([key, meta]) => ({
      ...scorecard({
        key,
        label: meta.label,
        facts: model.facts,
        pred: isManager(key),
        target: (m) => model.book.manager(key, m),
        month,
        today: model.today,
      }),
      zone: meta.zone,
      inMaster: meta.inMaster,
    }));
}

/** Zone scorecards: HO zone sales roll into their base zone. Third-party / unzoned rows get their own buckets. */
export function zoneScorecards(model: PerfModel, params: PerfParams, month = model.month): Scorecard[] {
  const zones = model.zones.filter((z) => !params.zone || z === params.zone);
  const cards = zones.map((z) =>
    scorecard({ key: z, label: z, facts: model.facts, pred: inZone(z), target: (m) => model.book.zone(z, m), month, today: model.today }),
  );
  if (!params.zone) {
    for (const bucket of [THIRD_PARTY, NO_ZONE]) {
      const pred = (f: PerfFact) => zoneBucket(f) === bucket;
      if (!model.facts.some(pred)) continue;
      cards.push(
        scorecard({
          key: bucket,
          label: bucket,
          facts: model.facts,
          pred,
          target: () => ({ value: null, source: null }),
          month,
          today: model.today,
        }),
      );
    }
  }
  return cards;
}

/** Scope of the headline figures: the selected manager, zone, or the whole company. */
export function headlineScope(model: PerfModel, params: PerfParams): {
  label: string;
  pred: (f: PerfFact) => boolean;
  target: (m: string) => ResolvedTarget;
} {
  if (params.manager) {
    const m = model.data.managers.find((x) => x.manager_key === params.manager);
    return { label: m?.display_name ?? params.manager, pred: isManager(params.manager), target: (mo) => model.book.manager(params.manager!, mo) };
  }
  if (params.zone) {
    return { label: params.zone, pred: inZone(params.zone), target: (mo) => model.book.zone(params.zone!, mo) };
  }
  return { label: 'Company', pred: () => true, target: (mo) => model.book.company(mo, model.zones) };
}
