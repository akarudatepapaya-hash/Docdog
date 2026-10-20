import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Client acting AS the signed-in user (RLS applies). Token comes from the Authorization header. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client: server-side scripts only (sync job). Never import from client code. */
export function serviceClient(): SupabaseClient {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
