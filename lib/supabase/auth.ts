import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The signed-in user's id, read from the session JWT instead of asking the
 * Auth server about it.
 *
 * `auth.getUser()` is a network round trip to Supabase Auth on every call. For
 * reads of public reference content (Bible text, study notes, the research
 * guide, the video catalogue) that round trip is pure latency: the JWT's
 * signature is still verified — locally, against the project's cached JWKS —
 * and Postgres re-validates it on every query through RLS anyway. If the
 * project still signs with the legacy shared secret, `getClaims()` falls back
 * to the same server call `getUser()` makes, so this is never slower.
 *
 * What it gives up: a session revoked elsewhere (sign-out on another device, a
 * banned account) keeps working until its access token expires. That is fine
 * for read-only reference data and NOT fine for anything that writes user
 * content or goes through the service-role client — keep `getUser()` there.
 */
export async function getSessionUserId(supabase: { auth: SupabaseClient["auth"] }): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (error || typeof sub !== "string" || sub.length === 0) return null;
    return sub;
  } catch {
    return null;
  }
}
