import { checkNoteAccess, initCollabState, openCollabNote } from "@/app/(app)/collab-actions";

/*
 * The latency-sensitive half of the collaborative-note API, as a Route
 * Handler instead of Server Actions. Next dispatches Server Actions ONE AT A
 * TIME per client, and opening a note fires several (publication symbols,
 * the notes list, preferences, the shared lists…) — queued behind those, a
 * shared note took ~5 s to appear. A plain fetch runs in parallel.
 *
 * The functions called here verify the session themselves (proxy.ts skips
 * /api), exactly as they do when called as actions. Saving stays a Server
 * Action: it runs in the background, so waiting in the queue costs nothing.
 */

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  if (url.searchParams.get("access") === "1") {
    return Response.json(await checkNoteAccess(id), { headers: noStore });
  }
  return Response.json(await openCollabNote(id), { headers: noStore });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { seed?: unknown } | null;
  if (!body || typeof body.seed !== "string") return Response.json({ error: "Estado inválido." }, { status: 400 });
  return Response.json(await initCollabState(id, body.seed), { headers: noStore });
}
