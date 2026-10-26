# Deployment

## 1. Supabase (already provisioned)

Project `sales-tracker`, ref `qretfslofiaixvcfwesp`, region `ap-south-1`. All migrations are applied and both Edge
Functions are deployed. To recreate in a fresh project:

```bash
npm i -g supabase
supabase login
supabase link --project-ref <new-ref>
supabase db push                                  # applies supabase/migrations in order
supabase functions deploy sheets-sync --no-verify-jwt
supabase functions deploy admin-users
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
                     ALLOWED_ORIGINS="https://<app-domain>" APP_URL="https://<app-domain>"
psql "$DATABASE_URL" -f supabase/tests/security_checks.sql   # expect: ALL SECURITY CHECKS PASSED
```

Then run an import from **Google Sheets Sync** (see `GOOGLE_SHEETS_SYNC.md`).

### Auth settings (Supabase Dashboard → Authentication)

- **Sign In / Providers → Email**: disable *Allow new users to sign up* (accounts are created by admins).
- **URL Configuration**: Site URL = `https://<app-domain>`; Redirect URLs = `https://<app-domain>/reset-password`
  and `http://localhost:5173/reset-password`.
- **SMTP**: configure a custom SMTP sender for password-reset and invitation emails in production
  (the built-in sender is rate-limited).
- Recommended: enable leaked-password protection and set minimum password length to 10.

### First administrator

Authentication → Users → **Add user** → `medicine.access@ikrispharmanetwork.com`, strong password, *Auto confirm*.
The trigger assigns the admin role (from `app_settings.bootstrap_admin_emails`). Create the NPP login from the app's
**User Management** page.

## 2. Vercel

1. Vercel → **Add New → Project** → import `medicineaccess-svg/Sales-Tracker`. Framework preset: Vite (also set in
   `vercel.json`).
2. Environment variables (Production + Preview):
   - `VITE_SUPABASE_URL` = `https://qretfslofiaixvcfwesp.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the project's publishable key
3. Deploy. `vercel.json` rewrites all routes to `index.html` (React Router) and adds security headers.
4. Add the Vercel domain to Supabase Auth redirect URLs and to the `ALLOWED_ORIGINS` / `APP_URL` function secrets.

**Never** add the service-role key or Google credentials to Vercel — the frontend does not need them.
