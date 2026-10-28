-- pg_net is used to trigger the sheets-sync Edge Function from SQL
-- (staged snapshot imports and, once enabled, the scheduled sync).
create extension if not exists pg_net with schema extensions;
