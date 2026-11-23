import type { CollabOpenResult, CollabRole } from "@/app/(app)/collab-actions";

/**
 * Client side of app/api/collab/[id] — see that file for why these aren't
 * Server Actions. A network failure throws (the caller treats that as
 * "offline", same as an action that never reached the server).
 */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok && res.status >= 500) throw new Error(`collab api ${res.status}`);
  return (await res.json()) as T;
}

export function fetchCollabOpen(noteId: string) {
  return call<CollabOpenResult>(`/api/collab/${encodeURIComponent(noteId)}`);
}

export function fetchCollabAccess(noteId: string) {
  return call<{ role: CollabRole | null }>(`/api/collab/${encodeURIComponent(noteId)}?access=1`);
}

export function postCollabSeed(noteId: string, seed: string) {
  return call<{ state?: string; error?: string }>(`/api/collab/${encodeURIComponent(noteId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed }),
  });
}
