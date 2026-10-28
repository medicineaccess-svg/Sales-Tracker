# Google Sheets synchronisation

## Source

| Setting | Value |
|---|---|
| Spreadsheet | `1X1oWDT1p6fyFwVCW9xEPkegOJ4ztBL82ANoCYWdvxq0` ("NPM Sales sheet", since 28 Oct 2026) |
| Worksheet | gid `631975196` (`Sheet1`) |
| Previous | `1yEn6NflVFtU9Bjv4vcRZsqoKTpEeeviGczBUPcLe0Us` (v1 layout) — kept as `previous_spreadsheet_id` |
| Stored in | `departments.config` for `npp` (editable in **Settings → Departments**) |

## Ownership policy

- **Supabase is the permanent store.** If Google Sheets is unavailable, the CRM keeps serving previously imported data.
- **Google Sheets is authoritative for rows it supplied**, *unless* a record was edited in the CRM
  (`locally_modified = true`). Then a newer sheet version is **parked** in `pending_source` and counted as a *conflict*;
  an administrator chooses **Keep CRM version** or **Accept sheet version** (`npp_resolve_conflict`). Nothing is
  overwritten silently.
- Records created in the CRM (`source = 'manual'`) are never touched by the sync. There is no write-back to the sheet
  (no uncontrolled two-way sync).
- Rows that disappear from the sheet are **flagged** (`missing_from_source_at`), never deleted. Archive them manually if
  appropriate.

## Sheet layouts

The parser detects the layout from the header row. Only **Date, Particulars, Product Name and INR Value** are required.

| Layout | Columns |
|---|---|
| v2 "NPM Sales sheet" (current) | Date, Particulars, Product Name, Place of sale, Ikris Manager Involved, **Zone**, Concerned Doctor name, Hospital Name, Quantity, INR Value |
| v1 "NPP Sales sheet" | as v2 without Zone, plus Voucher No., Rate, Value, Gross Total, EXPORT SALES, Shipping Charges |

Every parsed row carries `fields` — the database columns the current layout provides. `npp_sync_apply_v2` only writes
those, so voucher / rate / currency / value captured from the v1 sheet are **kept**, never blanked.

### Switch-over (28 Oct 2026)

The new sheet holds the same 221 sales (₹21,14,88,710) with a Zone column added. The first v2 import **adopted** all
221 existing records (matched on customer + product + INR value + date) instead of creating duplicates; record IDs,
audit history and v1-only fields are preserved. Reconciliation: sheet 221 rows / ₹211,488,710.00 = database 221 rows /
₹211,488,710.00. A second run reported 221 unchanged.

## Ways to import

1. **Google Sheets API** (admin "Import from Google Sheets", or the scheduled run) — needs the
   `GOOGLE_SERVICE_ACCOUNT_JSON` Edge Function secret and the sheet shared with that service account (Viewer).
   The new sheet is private, so this is required for live sync.
2. **Upload CSV** (Sync page, admins) — File → Download → CSV in Google Sheets, then upload. Parsed in the browser,
   validated and stored by the Edge Function with the admin's JWT; a copy is kept in `npp_sheet_uploads`.
3. **Staged snapshot** (operators) — a row inserted into `npp_sheet_uploads` with the service role, then
   `POST /functions/v1/sheets-sync {"upload_id": "…"}`. Upload ids are single-use and expire after 15 minutes.

Every import returns a reconciliation (sheet rows/INR total vs database rows/INR total for that run).

## Matching & idempotency

- Stable key = normalised **Voucher No.** (upper-case, whitespace collapsed). Spreadsheet row numbers are informational
  only. If a voucher appears twice in the sheet, the second occurrence gets `<voucher>#2` and both are flagged.
- Rows without a voucher (all v2 rows) use `ROW:` + hash of date + particulars + product + manager. Amount and quantity
  are excluded so a corrected amount updates the record. Exact repeats get `#2` and are flagged `duplicate_row_in_sheet`.
- Rows with the same date, customer, product and INR value under **different managers** (e.g. HO and an individual) are
  all flagged `possible_duplicate_attribution` and counted as recorded — never merged automatically.
- Rows missing from the current sheet are excluded from dashboards and performance figures (`include_missing` filter).
- Each row's raw cells are hashed; unchanged rows are skipped. Re-running a sync never creates duplicates.

## Column mapping

| Sheet column | Database | Parsing |
|---|---|---|
| Date | `sale_date` | `01-Apr-26` → 2026-04-01. Blank → NULL + `missing_date` flag (never guessed) |
| Particulars | `particulars` | whitespace collapsed, trailing commas removed |
| Product Name | `product_name` | whitespace collapsed |
| Place of sale | `place_of_sale` | |
| Ikris Manager Involved | `manager` (+ generated `channel`) | "HO ( Third Party )", "HO Third Party", "HO ( Third Party Sales )" → `HO (Third Party)`. Channel: `individual` / `ho` / `ho_third_party` / `unassigned` |
| Zone (v2) | `zone` (+ generated `zone_base`) | "HO South Zone" → zone_base "South Zone". Blank zone on a manager/HO row → `zone_not_assigned` flag |
| Concerned Doctor name | `doctor_name` | |
| Hospital Name | `hospital_name` | |
| Voucher No. | `voucher_no`, `source_key` | |
| Quantity | `quantity` + `quantity_unit` | `14 PEN` → 14 / PEN |
| Rate | `rate` + `currency` + `rate_unit` | `$6200.00/PACK` → 6200.00 / USD / PACK; no symbol → currency NULL + flag |
| Value | `value` | exact decimal; `#VALUE!` → NULL + flag |
| Gross Total | `gross_total` + `gross_total_dc` | `6900.00 Dr` → 6900.00 / Dr |
| EXPORT SALES | `export_sales` + `export_sales_dc` | |
| Shipping Charges | `shipping_charges` + `shipping_charges_dc` | |
| INR Value | `inr_value` | `  582,800 ` → 582800.00 — stored as reported |

The original text of every cell is kept in `source_raw`. Subtotal rows (`Total`, `toal`, rows containing only an INR
figure) are skipped.

### Data-quality flags (`data_issues`)

`missing_date`, `missing_voucher`, `duplicate_voucher_in_sheet`, `missing_quantity`, `missing_rate`,
`currency_not_stated`, `invalid_value`, `value_mismatch` (qty × rate ≠ value), `rate_unit_mismatch`,
`columns_shifted` (Gross / Export / Shipping shifted one column right — repaired and flagged),
`export_sales_mismatch`, `missing_inr_value`, `invalid_number`.

Flagged rows are imported, visible under **NPP Sales → Data quality: Needs review**, and can be cleared by a user after
checking ("I have checked this record").

### Findings from the initial import (26 Oct 2026)

227 rows read · 221 imported · 6 subtotal rows skipped · 0 rejected · 44 flagged:
11 missing date, 10 currency not stated, 9 shifted columns, 9 export-sales mismatches, 6 unit mismatches,
4 value ≠ qty × rate, 1 `#VALUE!`, 1 missing quantity. Total INR Value ₹21,14,88,710 equals the sum of the sheet's monthly
subtotals.

## Enabling automatic sync from the app

The initial import was performed during setup. For **Import from Google Sheets** in the app:

1. In Google Cloud, create a service account, enable the **Google Sheets API**, create a JSON key.
2. Share the NPP sheet with the service account's `client_email` as **Viewer** (read-only, least privilege).
3. Set the Edge Function secret (Supabase Dashboard → Edge Functions → Secrets, or CLI):
   ```bash
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" --project-ref qretfslofiaixvcfwesp
   ```
4. Optional: `ALLOWED_ORIGINS=https://<your-vercel-domain>` to restrict CORS, `APP_URL=https://<your-vercel-domain>`.

Use **Preview** first — it parses the sheet and reports counts without saving.

## Scheduled sync (optional)

```sql
-- 1. Store a long random secret in Vault and as the SYNC_CRON_SECRET function secret
select vault.create_secret('<random-secret>', 'sync_cron_secret');

-- 2. Schedule (daily 01:30 UTC = 07:00 IST)
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule('npp-sheets-sync', '30 1 * * *', $$
  select net.http_post(
    url := 'https://qretfslofiaixvcfwesp.supabase.co/functions/v1/sheets-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_cron_secret')),
    body := '{}'::jsonb);
$$);

-- 3. Reflect it in the UI
update app_settings set value = '{"enabled": true, "cron": "30 1 * * *"}' where key = 'sync.schedule';
```
