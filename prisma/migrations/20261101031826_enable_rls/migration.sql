-- Lock every app table away from Supabase's public REST API (anon/authenticated roles).
-- The app talks to Postgres through Prisma as the table owner, which RLS does not restrict.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
