import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the SERVICE-ROLE key.
 *
 * SECURITY: this client BYPASSES Row-Level Security and is the only role allowed
 * to read/write `connected_accounts.plaid_access_token` (column SELECT is revoked
 * from `authenticated`/`anon` in supabase/migrations/0001_init.sql). It must never
 * be exposed to the client and lives only on the server.
 *
 * Requires:
 *   SUPABASE_URL               — project URL (https://<ref>.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (server-side secret, NEVER shipped to device)
 */

let cached: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Lazily construct the service-role client so the server still boots before
 * credentials exist (matches the lazy-import pattern used elsewhere in the app).
 */
export function getServiceClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server."
    );
  }
  cached = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
