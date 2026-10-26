# Ikris Pharma Network — Sales Tracker

A secure, department-based sales CRM for Ikris Pharma Network. **NPP (Named Patient Program)** is the first fully operational
department; **Export** and **Rare Disease** are configured as future modules and show no sales figures until their real data
sources are connected.

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS v4, Radix (shadcn-style primitives), Motion, Recharts, React Router, React Hook Form + Zod, React Toastify, Lucide |
| Data | Supabase PostgreSQL with Row Level Security, Supabase Auth, Edge Functions (Deno) |
| Source | Google Sheets API v4 (read-only service account) |
| Hosting | Vercel (frontend) + Supabase (database, auth, functions) |

## What's live

- **Supabase project `sales-tracker`** (ref `qretfslofiaixvcfwesp`, region ap-south-1 / Mumbai) with all migrations in
  [`supabase/migrations`](supabase/migrations) applied.
- **221 NPP sales records imported** from the NPP Google Sheet (227 rows read, 6 subtotal rows skipped, 0 rejected,
  44 imported with data-quality flags). Total reported INR Value ₹21,14,88,710 — matching the sheet's own monthly subtotals.
- Edge Functions **`sheets-sync`** (Google Sheets import) and **`admin-users`** (user management) deployed.

## Features

- Secure login, logout, password reset, session-expiry handling; no self-registration.
- One administrator + named department users; role and department are enforced **in the database** (RLS + guarded functions).
- Sidebar with Overview, Sales Dashboard, **Department** selector, NPP Sales, Google Sheets Sync, Reports, Analytics,
  Audit Logs, User Management (admin), Settings, Profile, Logout.
- Dashboard: 8 KPI cards and 8 interactive charts (monthly sales by currency, monthly INR, product, manager, hospital,
  trend, contribution, shipping) — every chart has a data-table view; all respond to the same filters (date range, FY,
  month, product, manager, hospital, doctor, place, voucher, currency).
- NPP Sales table: server-side pagination, debounced search, sorting, column visibility, CSV/Excel export, record detail
  with source values and audit history, add/edit with validation and duplicate-voucher warning, admin archive/restore.
- Reports: daily, monthly, quarterly, financial-year, product, manager, hospital, doctor, place, shipping, record history
  and sync report — with filter summary, definitions, CSV/Excel export.
- Idempotent Google Sheets sync with preview, conflict handling and a full run history.
- Append-only audit log (patient names are never written to it).

## Money rules

- Amounts are PostgreSQL `numeric` — never floating point.
- `Value`, `Shipping`, `Gross Total`, `EXPORT SALES` are stored **in the currency of the Rate column** (`$` → USD,
  `€` → EUR). Dr/Cr designations are stored in separate columns.
- **USD and EUR are never added together.** Rows whose Rate has no currency symbol are reported as "Currency not stated".
- `INR Value` is stored exactly as reported by the sheet. The CRM does **not** convert currencies.
- Shipping is reported separately and never added to sales value.

## Getting started

```bash
cp .env.example .env.local      # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev                     # http://localhost:5173
npm test                        # unit + component tests
npm run build && npm run check:bundle-secrets
```

For the live project:

```
VITE_SUPABASE_URL=https://qretfslofiaixvcfwesp.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key from Supabase → Project Settings → API>
```

### First administrator

`medicine.access@ikrispharmanetwork.com` is configured as the bootstrap administrator. Create the account once in
**Supabase Dashboard → Authentication → Users → Add user** (tick *Auto confirm*), choosing a strong password. The database
trigger gives that account the admin role automatically. All other users (e.g. the NPP department login) are then created
from **User Management** inside the app.

## Documentation

- [Deployment (Vercel + Supabase)](docs/DEPLOYMENT.md)
- [Google Sheets synchronisation & column mapping](docs/GOOGLE_SHEETS_SYNC.md)
- [Architecture, security model & activating new departments](docs/ARCHITECTURE.md)
- [Testing — what was run and what still needs credentials](docs/TESTING.md)
