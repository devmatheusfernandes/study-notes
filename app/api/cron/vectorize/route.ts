import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runVectorizationBatch, MAX_TICK_DURATION_MS } from "@/lib/vector/processor";

/** Vercel invokes this on the schedule in vercel.json — see that file for the interval. */
export const maxDuration = 60;

/**
 * The whole invocation's time budget, shared by every batch it runs.
 *
 * Vercel's Hobby plan only allows a once-a-day cron, so this route can't rely
 * on a five-minute tick coming back to pick up where it left off — it drains
 * as much of the queue as it can in one go instead. `MAX_TICK_DURATION_MS`
 * already leaves headroom under `maxDuration` for the bookkeeping after the
 * loop, so it doubles as the deadline for the whole run.
 */
const RUN_BUDGET_MS = MAX_TICK_DURATION_MS;

/**
 * Drains the vectorization queue across every user, batch after batch until
 * the run's time budget is spent — the background counterpart to the Settings
 * "Processar Agora" button (which runs a single batch with the caller's own
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

  const supabase = createAdminClient();
  const deadline = Date.now() + RUN_BUDGET_MS;

  let processed = 0;
  let errors = 0;
  let batches = 0;

  // Keep claiming batches until a batch makes no progress or the budget runs
  // out. Anything still marked 'processing' when the budget expires is picked
  // up by the next run's stale-recovery, exactly as before.
  //
  // The exit condition is "processed nothing", not "queue was empty": a claim
  // that fails outright also reports zero processed (with an error), and
  // retrying that in a tight loop would just hammer the database for the rest
  // of the budget. Stopping on no progress covers the empty queue, a failed
  // claim, and a batch whose items all failed — all cases where going round
  // again cannot help.
  while (Date.now() < deadline) {
    const result = await runVectorizationBatch(supabase, { deadline });
    batches += 1;
    processed += result.processed;
    errors += result.errors;
    if (result.processed === 0) break;
  }

  return Response.json({ processed, errors, batches });
}
