# Testing

## How to run

```bash
npm test                         # unit + component tests (Vitest)
npm run build && npm run check:bundle-secrets
npx playwright install chromium
npm run test:e2e                 # public checks; journeys need the env vars below
psql "$DATABASE_URL" -f supabase/tests/security_checks.sql
```

E2E environment variables: `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_NPP_EMAIL`, `E2E_NPP_PASSWORD`;
`E2E_ALLOW_WRITES=1` enables `sales-flow.spec.ts`, which creates, edits and archives one test record.

## Results of the run on 26 Oct 2026

All of the following were **executed**, not just written.

| Suite | Where | Result |
|---|---|---|
| TypeScript (`tsc -b`, strict) | Vercel Sandbox, Node 24 | ✅ no errors |
| Unit + component tests (Vitest) — parser, filters/FY, money formatting, form validation, CSV export, login page | Vercel Sandbox | ✅ 41 / 41 passed |
| Production build (`vite build`) | Vercel Sandbox | ✅ |
| Bundle secret scan | Vercel Sandbox | ✅ no privileged credentials in `dist/` |
| Database security checks (`security_checks.sql`) against the live project | Supabase | ✅ ALL SECURITY CHECKS PASSED |
| Supabase security advisor | Supabase | ✅ trigger functions locked; remaining notices are intentional admin RPCs that check `is_admin()` internally |
| E2E (Playwright, Chromium desktop + Pixel 7) against the live Supabase project: unauthenticated redirect, validation, wrong credentials, admin journey + logout, NPP journey + admin-page block, visual smoke of 11 pages | Vercel Sandbox | ✅ passed |
| E2E sales lifecycle (create with validation & duplicate-voucher warning, quantity × rate helper, edit, audit history, NPP cannot archive, admin archive) | Vercel Sandbox | ✅ 2 / 2 passed |
| Page audit (desktop 1360 px and mobile 390 px): every page renders, no horizontal overflow, no console or HTTP errors, charts/tables populated | Vercel Sandbox | ✅ |
| Import verification | Supabase | ✅ 221 rows; checksum of keys, hashes, names, values identical to the parser output; INR total equals the sheet's monthly subtotals |

### Authorization checks covered by `security_checks.sql`

NPP user reads all NPP sales · cannot update `profiles` (self-promotion) · cannot call `admin_set_user_access` ·
cannot delete sales · cannot spoof provenance on insert · cannot archive · cannot call `write_audit` or sync
functions · cannot tamper with audit logs. Export user reads 0 NPP rows, aggregates 0, cannot insert. Admin can archive.
Anonymous access is denied.

## Not yet tested (needs configuration)

- **Live Google Sheets sync from the app** — requires `GOOGLE_SERVICE_ACCOUNT_JSON` (see `GOOGLE_SHEETS_SYNC.md`).
  Until then the function returns a "not configured" error (code path not exercised in the test run). The initial import was done during setup.
- **Password-reset and invitation emails** — depend on the project's SMTP configuration.
- **Scheduled sync** — optional pg_cron setup.

## Test data left in the live project

E2E runs used two throw-away accounts (`e2e-admin@ikris-test.example`, `e2e-npp@ikris-test.example`) and created four
"E2E Test Customer" records. After the runs the records were **archived** (hidden from dashboards and reports), the NPP
test account was **deactivated**, and both passwords were replaced with random values nobody holds. To remove them
completely, run [`supabase/tests/cleanup_e2e.sql`](../supabase/tests/cleanup_e2e.sql) once your real administrator
account exists.
