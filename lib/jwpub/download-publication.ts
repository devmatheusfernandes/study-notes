"use client";

import { downloadAndStagePublication } from "@/app/(app)/publication-download-actions";
import { getFileUrl } from "@/app/(app)/files-actions";
import { ingestJwpub } from "./ingest";
import { enqueueNoteForVectorization } from "@/lib/vector/queue-actions";
import { useIngestProgressStore, type IngestProgress } from "@/lib/store/ingest-progress-store";

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
export async function downloadAndIngestPublication(
  mepsDocumentId: number,
  onProgress?: (progress: IngestProgress) => void
): Promise<DownloadPublicationResult> {
  // One percentage across the whole thing: fetching from jw.org (server side,
  // 0–35), reading the file back (35–45), then processing it (45–100, the
  // same figure the reader's own reprocess shows). Never goes backwards.
  let last = 0;
  const report = (percent: number, stage: string) => {
    last = Math.max(last, Math.min(100, Math.round(percent)));
    onProgress?.({ stage, percent: last });
  };

  report(1, "Baixando do jw.org");
  // The server step reports nothing while it runs, and on a big publication
  // it is the longest part — creep toward (never reaching) the end of its
  // share so the bar visibly moves instead of looking stuck.
  const creep = setInterval(() => report(last + (33 - last) * 0.05, "Baixando do jw.org"), 600);
  let staged: Awaited<ReturnType<typeof downloadAndStagePublication>>;
  try {
    staged = await downloadAndStagePublication(mepsDocumentId);
  } finally {
    clearInterval(creep);
  }
  if (staged.error || !staged.publication) {
    return { ok: false, error: staged.error ?? "Não foi possível localizar essa publicação." };
  }
  report(35, "Lendo o arquivo");

  const { noteId, storagePath, title } = staged.publication;

  const urlResult = await getFileUrl(storagePath);
  if (urlResult.error || !urlResult.url) {
    return { ok: false, error: "Publicação baixada, mas não foi possível abri-la." };
  }

  let blob: Blob;
  try {
    const res = await fetch(urlResult.url);
    if (!res.ok) throw new Error();
    blob = await readWithProgress(res, (fraction) => report(35 + fraction * 10, "Lendo o arquivo"));
  } catch {
    return { ok: false, error: "Publicação baixada, mas não foi possível lê-la." };
  }

  // ingestJwpub publishes its own percentage per publication; fold it into the
  // 45–100 part of this one.
  report(45, "Processando");
  const unsubscribe = useIngestProgressStore.subscribe((state) => {
    const ingest = state.byNote[noteId];
    if (ingest) report(45 + (ingest.percent / 100) * 55, ingest.stage);
  });
  let ingestResult: Awaited<ReturnType<typeof ingestJwpub>>;
  try {
    ingestResult = await ingestJwpub(blob, noteId);
  } finally {
    unsubscribe();
  }
  if (!ingestResult.ok) {
    return { ok: false, error: ingestResult.error ?? "Não foi possível processar a publicação." };
  }

  void enqueueNoteForVectorization(noteId);

  report(100, "Concluído");
  return { ok: true, noteId, title: ingestResult.title ?? title };
}

/** `response.blob()`, reporting how much of it has arrived when the server says how big it is. */
async function readWithProgress(response: Response, onFraction: (fraction: number) => void): Promise<Blob> {
  const total = Number(response.headers.get("content-length"));
  if (!response.body || !Number.isFinite(total) || total <= 0) return response.blob();

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as BlobPart);
    received += value.length;
    onFraction(Math.min(1, received / total));
  }
  return new Blob(chunks, { type: response.headers.get("content-type") ?? undefined });
}
