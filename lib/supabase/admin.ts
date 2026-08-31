import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS entirely. Only ever import this from
 * Server Actions/Route Handlers that have ALREADY verified the caller's
 * session via `lib/supabase/server.ts`, and that scope every operation to
 * that verified user's own path/row themselves. The `server-only` import
 * above makes an accidental Client Component import a build error rather
 * than a leaked secret.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
