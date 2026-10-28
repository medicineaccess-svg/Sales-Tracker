# Performance, targets and zones

Pages live under **Performance** (`/performance`): Overview, Managers (profile), Compare, Zones (drill-down),
Monthly report, Rankings, Targets. All amounts are the sheet's own **INR Value (₹)** — never converted or recalculated.

## Data model

| Object | Purpose |
|---|---|
| `npp_sales.zone` | Zone exactly as in the sheet ("HO South Zone", "South Zone", blank) |
| `npp_sales.zone_base` (generated) | HO prefix removed → HO zone sales roll into their zone |
| `npp_sales.channel` (generated) | `individual` · `ho` · `ho_third_party` · `unassigned`, from "Ikris Manager Involved" |
| `sales_managers` | Master data: `manager_key` (stable id), display name, **aliases** (e.g. Fazan ← "Faizan"), zone, branch, employee id, designation, reporting manager, `is_sales_manager` (false for HO and HO (Third Party)), active |
| `sales_targets` | One row per **scope** (`manager` / `zone` / `company`) × key × **calendar month** (`period_month` = 1st of month), `target_inr` |
| `npp_performance(filters)` | Invoker RPC: monthly facts (month × manager × zone × channel × place), targets, managers, settings, last sync |

RLS: managers and targets are readable by users with NPP access and writable **only by administrators**; every change
is written to `audit_logs` (`managers.*`, `targets.*`). The browser never receives privileged keys.

## Formulas (`src/lib/performance.ts`, unit tested)

| Measure | Formula | No target / zero |
|---|---|---|
| Achievement % | Actual ÷ Target × 100 | "—" (never 0 % or ∞) |
| Remaining | max(Target − Actual, 0) | "—" |
| Variance | Actual − Target | "—" |
| Growth % | (Current − Previous) ÷ Previous × 100 | "—" when the previous month had no sales |

## Monthly status (one month vs its monthly target only)

| Status | Rule |
|---|---|
| Target Not Set | no target (or 0) for that month |
| Target Exceeded | actual > target |
| Target Achieved | actual = target |
| Not Started | future month |
| No Sales Recorded | target set, no sales yet |
| Behind Target | completed month below target, or current month below the paced expectation |
| On Track | current month at/above target × elapsed days ÷ days in month (`targets.pacing = linear`); never "Behind" during the first 3 days |

Annual figures never feed the monthly status. FY target = **sum of the months entered** (the UI shows "n of 12 months
entered"); FY-to-date target = completed months in full + current month pro-rated. Annual targets are never divided
equally across months — the Targets page's copy button only repeats a monthly value the admin typed, on request.

## Target hierarchy (no double counting)

- Manager target = its own monthly row.
- Zone target = explicit zone row; otherwise the **sum of its sales managers' targets** (marked `*`). Zone actuals
  include HO sales for the zone, so enter an explicit zone target if HO sales should be covered by the target.
- Company target = explicit company row; otherwise Σ zone targets + targets of managers without a zone.
  An explicit level always **replaces** the derived one, it is never added to it.

## HO–Bangalore consolidation (configurable)

Setting `reporting.consolidation.branches` (default):

```json
{ "name": "Bangalore", "zone": "South Zone", "places": ["Bangalore", "Bengaluru"], "channels": ["ho", "individual"] }
```

- **HO Bangalore only** = HO rows with place of sale Bangalore.
- **Individual managers** = individual managers' rows with place Bangalore (currently Fazan).
- **Consolidated Bangalore** = the two above. Each sheet row is one record, so nothing is counted twice.
- Rows that look like one sale recorded under HO *and* a manager (same date, customer, product, INR value) are flagged
  `possible_duplicate_attribution`; the card warns and lists them for review — they are **not** silently removed.
- HO (Third Party) rows at Bangalore are shown as "not included".
- Other branches: add another object to the array (Settings → app_settings); no code change.

Current data: no possible-duplicate rows exist; Bangalore FY 2026-27 to date = HO + Fazan as recorded.

## Rankings & matrix

Only managers **with a target** are ranked (achievement %, then actual; ties share a rank). Managers without a target
are listed below as "Not ranked" so high sales without a target cannot top the list. HO / HO (Third Party) are company
channels and are not ranked. Matrix categories use an icon + label (never colour alone): Achieving & growing ·
Achieving, sales down · Below target, sales up · Below target & sales down · Target not set.

## Forecast

Labelled **run-rate projection** only: current month = actual ÷ elapsed share; FY = actual of completed months +
their average × remaining months. No previous-FY data exists yet, so the previous-year comparison column stays hidden.

## Branch

The sheet has no Branch column. "Branch" filters and drill-downs use **Place of sale**; `sales_managers.branch` can
record a manager's home branch.

## Outstanding configuration

1. **Monthly targets** — none were provided, so every status is "Target Not Set". Enter them on Performance → Targets
   (admin), per manager (and optionally zone/company).
2. **Live Google sync** — the new sheet is private: add `GOOGLE_SERVICE_ACCOUNT_JSON` and share the sheet with that
   service account as Viewer, or use **Upload CSV** on the Sync page.
3. **Manager master data** — branch, employee id, designation and reporting manager are not in the sheet.
4. Optional: `SYNC_CRON_SECRET` + pg_cron schedule for automatic sync once (2) is done.
