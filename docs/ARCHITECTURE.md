# Architecture & security model

```
Browser (React SPA on Vercel)
  │  publishable/anon key + user JWT  ──►  PostgREST ──► PostgreSQL (RLS on every table)
  │                                     ─► Edge Function admin-users  (admin JWT, service role inside)
  │                                     ─► Edge Function sheets-sync  (admin JWT or cron secret)
  │                                                     └─► Google Sheets API (read-only service account)
```

## Tables

| Table | Purpose |
|---|---|
| `departments` | NPP / Export / Rare Disease, status and per-department source config |
| `profiles` | 1:1 with `auth.users`; role (`admin` / `department_user`), department, active flag |
| `npp_sales` | NPP sales records — business fields, provenance, data-quality flags, lifecycle |
| `sync_runs` | Every Google Sheets import attempt with counts and errors |
| `audit_logs` | Append-only audit trail |
| `app_settings` | Application settings (public and admin-only keys) |

## Security model

- **RLS is enabled on every table.** `anon` has no table privileges at all.
- `is_admin()` and `has_department_access(code)` are `SECURITY DEFINER` helpers reading the caller's profile.
  NPP users can read/insert/update `npp_sales`; users of other departments see nothing.
- **Profiles cannot be written by clients.** Role/department changes only happen through
  `admin_set_user_access()` (checks `is_admin()`, prevents removing the last admin, audits the change).
- Role at sign-up comes only from `app_metadata` (writable only with the service role) or the
  `bootstrap_admin_emails` setting — never from user-editable metadata.
- `npp_sales_guard` trigger: clients cannot set provenance columns (`source`, `source_key`, `source_raw`…), cannot
  archive/restore unless admin, cannot edit archived rows. Deletion is blocked — records are archived.
- `npp_sales_audit` trigger logs every create/update/archive with a field-level diff. **Patient names are never written
  to the audit log** — only "particulars changed".
- `audit_logs` is immutable (update/delete raise an error). Clients can only add a fixed set of events
  (`log_client_event`: login, logout, password change, exports).
- Sync functions (`npp_sync_*`) and `write_audit*` are executable by the service role only.
- Analytics functions (`npp_dashboard`, `npp_report`, `npp_filtered`, `npp_filter_options`) are `SECURITY INVOKER`, so
  RLS applies to every aggregate.
- The service-role key and Google credentials exist only as Edge Function secrets. `npm run check:bundle-secrets`
  verifies none appear in the built frontend.
- Hiding menu items is cosmetic; every rule above is enforced by the database. `supabase/tests/security_checks.sql`
  verifies it.

## Frontend

- `src/hooks/useData.ts` — TanStack Query hooks (cached, invalidated after mutations; previous data kept on error so
  the UI shows a "may be out of date" banner instead of a blank page).
- `src/lib/filters.ts` — shared filter model, kept in the URL; FY / month / date range are intersected.
- `src/auth/AuthProvider.tsx` — session, profile, department context; logout clears the query cache.
- Charts use a fixed, colour-blind-validated categorical palette; currencies always keep the same colour.

## Activating a future department (Export, Rare Disease)

Departments deliberately do **not** share NPP's columns. To activate one:

1. **Schema** — add a migration with a dedicated table (e.g. `export_sales`) modelled on the department's real sheet,
   with RLS policies using `has_department_access('export')`, a guard trigger and an audit trigger (copy the NPP pattern).
2. **Parser** — add `supabase/functions/_shared/export-parser.ts` with that sheet's column mapping and tests.
3. **Sync** — add a `sheets-sync-export` function (or a department switch in `sheets-sync`) using the same
   `sync_runs` table with `department_code = 'export'`.
4. **Analytics** — add `export_dashboard` / `export_report` invoker functions.
5. **UI** — add the department's pages and routes, guarded by `RequireDepartment code="export"`.
6. **Activate** — update `admin_update_department` to allow activation, then set the spreadsheet ID/gid and status in
   **Settings → Departments**, and assign users in **User Management**.

Until then the Department selector shows the module as *Coming soon* with no figures.
