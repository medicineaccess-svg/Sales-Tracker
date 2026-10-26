import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

/**
 * Browser client. Uses only the publishable/anon key — every table is protected
 * by Row Level Security, so this key grants nothing without a signed-in user.
 * The service-role key is never present in the frontend.
 */
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'public-anon-key-missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'ikris-sales-tracker-auth',
  },
});

export const BRAND_LOGO_URL =
  (import.meta.env.VITE_BRAND_LOGO_URL as string | undefined) ?? 'https://ikrispharmanetwork.com/assets/img/logo.png';
