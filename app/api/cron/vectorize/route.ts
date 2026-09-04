import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runVectorizationBatch } from "@/lib/vector/processor";

/** Vercel invokes this on the schedule in vercel.json — see that file for the interval. */
export const maxDuration = 60;

/**
 * Drains one batch of the vectorization queue across every user — the
 * background counterpart to the Settings "Processar Agora" button (which
 * calls the same runVectorizationBatch, just with the caller's own
 * RLS-scoped client instead of this admin one).
 *
 * This is the one legitimate place in the app that uses the admin client
 * with no user session to verify: the equivalent verification here is the
 * `CRON_SECRET` check below (Vercel sends `Authorization: Bearer
 * $CRON_SECRET` when it invokes a configured cron route) instead of a
 * session cookie. Every row this touches already carries the correct
 * `user_id` from when it was originally enqueued, so writes stay scoped by
 * construction, not by a per-call ownership check.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const result = await runVectorizationBatch(createAdminClient());
  return Response.json(result);
}
