import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALLOWED_IMAGE_EXTENSIONS, NOTE_IMAGES_BUCKET } from "@/lib/storage-config";
import { isOwnedStoragePath } from "@/lib/storage-path";

/**
 * Private replacement for the old public `note-images` URLs. A note's body
 * stores `/api/note-images/<user_id>/<uuid>.<ext>` — a stable reference that
 * needs no expiring signature — and this handler checks the session and the
 * path's owner on every request before streaming the bytes, so the bucket
 * itself can stay private. (`proxy.ts` skips `/api`, so the check is here.)
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const storagePath = segments.map((s) => decodeURIComponent(s)).join("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isOwnedStoragePath(storagePath, user.id)) {
    return new Response("Not found", { status: 404 });
  }

  const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
  const contentType = ALLOWED_IMAGE_EXTENSIONS[ext];
  if (!contentType) return new Response("Not found", { status: 404 });

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(NOTE_IMAGES_BUCKET).download(storagePath);
  if (error || !data) return new Response("Not found", { status: 404 });

  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      // Only this user's browser may cache it; the path is unguessable per-user anyway.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
