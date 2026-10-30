# Sales performance & drill-down

Pages under **Sales Performance** (`/performance`): Overview, Drill-down, Monthly report. The Sales Dashboard also
shows the manager cards. Everything is built only from the columns of the NPM Sales sheet:

`Date · Particulars · Product Name · Place of sale · Ikris Manager Involved · Zone · Concerned Doctor name · Hospital Name · Quantity · INR Value`

There are no targets, achievement %, status labels or manager master fields in the dashboards (they are not in the
sheet). Amounts are the sheet's own INR Value — never converted.

## Hierarchy (from the sheet)

```
Company
 └─ Manager (e.g. Firoz)                       = own sales + HO sales credited to the manager
     ├─ Own sales      "Ikris Manager Involved" = Firoz
     └─ HO sales       "Ikris Manager Involved" = HO and Zone = "HO North Zone (Firoz)"
         └─ Zone        North Zone
             └─ Individual sales (transactions)
HO (Third Party)                                not credited to any manager (shown separately)
```

* `npp_sales.credited_manager` (generated): the manager name for own rows, the name in brackets for HO rows,
  NULL for HO (Third Party).
* `npp_sales.zone_base` (generated): "HO North Zone (Firoz)" → "North Zone".
* The sheet has **no BD Person or separate HO Name column**, so the lowest level is the individual sale and
  "Total number of BD persons" cannot be shown. Add a BD Person column to the sheet to enable that level.

## Consolidation (no double counting) — `src/lib/salesHierarchy.ts`, unit tested

Every sheet row lands in exactly one leaf, so:

* Zone total = Σ its sales · HO / Own total = Σ its zones · Manager total = own + HO
* Company total = Σ managers + HO (Third Party) + any HO row without a manager name

Current sheet (FY 2026-27, Apr–Sep): Firoz ₹7.90 Cr · Mandar ₹2.87 Cr · Iyappan ₹2.52 Cr · Yatharth ₹1.81 Cr ·
Mujeeb ₹1.71 Cr · Fazan ₹1.17 Cr · HO (Third Party) ₹3.17 Cr = company ₹21.15 Cr (matches the sheet total).

## Month-wise figures

Charts run April → March (financial year). Average, highest and lowest month count months up to the latest month
that has any sales in the sheet, so months that have not happened yet never count as zero. Growth % =
(month − previous month) ÷ previous month; "—" when the previous month had no sales.

## Filters

Financial Year · Month · Manager · HO (own sales / HO sales / HO Third Party) · Zone. All cards, charts and totals
update together; filters are kept in the URL so views can be shared. Clicking a month bar filters that month.

## Drill-down

Company → Manager → Own / HO → Zone → individual sales, with a breadcrumb and a **Back** button at every level.
Each level shows its total, share of the parent, KPI cards (total, average, highest, lowest month), a month-wise bar
chart, a trend line and a growth row. Individual sales come straight from the database (RLS applies) and export to
CSV / Excel with the sheet's column names.

## Data notes

* Targets tables (`sales_targets`, `sales_managers`) are kept in the database but no longer used by any screen.
* Fields carried over from the previous sheet layout (voucher, rate, value, shipping) are kept on old records but are
  no longer displayed, exported or editable.
