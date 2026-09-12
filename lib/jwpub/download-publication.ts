"use client";

import { downloadAndStagePublication } from "@/app/(app)/publication-download-actions";
import { getFileUrl } from "@/app/(app)/files-actions";
import { ingestJwpub } from "./ingest";
import { enqueueNoteForVectorization } from "@/lib/vector/queue-actions";

export interface DownloadPublicationResult {
  ok: boolean;
  noteId?: string;
  title?: string;
  error?: string;
}

/**
 * Resolves a `data-jwpub-pubref` citation that isn't in this user's library
 * yet, fetches the real publication from jw.org, and ingests it exactly like
 * a manual upload would — see publication-download-actions.ts for the
 * resolve/download/stage steps, which run server-side (the file host itself
 * blocks a direct browser fetch — no CORS headers there, verified).
 *
 * `parseJwpub`/`ingestJwpub` need `sql.js`/`pako`/`DOMParser`, none of which
 * exist server-side, so the actual parsing still has to happen here — the
 * server only gets the bytes as far as Storage, then hands back a normal
 * signed URL (60s, same as any other file this app already serves).
 */
export async function downloadAndIngestPublication(mepsDocumentId: number): Promise<DownloadPublicationResult> {
  const staged = await downloadAndStagePublication(mepsDocumentId);
  if (staged.error || !staged.publication) {
    return { ok: false, error: staged.error ?? "Não foi possível localizar essa publicação." };
  }

  const { noteId, storagePath, title } = staged.publication;

  const urlResult = await getFileUrl(storagePath);
  if (urlResult.error || !urlResult.url) {
    return { ok: false, error: "Publicação baixada, mas não foi possível abri-la." };
  }

  let blob: Blob;
  try {
    const res = await fetch(urlResult.url);
    if (!res.ok) throw new Error();
    blob = await res.blob();
  } catch {
    return { ok: false, error: "Publicação baixada, mas não foi possível lê-la." };
  }

  const ingestResult = await ingestJwpub(blob, noteId);
  if (!ingestResult.ok) {
    return { ok: false, error: ingestResult.error ?? "Não foi possível processar a publicação." };
  }

  void enqueueNoteForVectorization(noteId);

  return { ok: true, noteId, title: ingestResult.title ?? title };
}
