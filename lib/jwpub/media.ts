"use client";

import { JWPUB_MEDIA_BATCH_SIZE, JWPUB_MEDIA_BATCH_MAX_BYTES } from "@/lib/storage-config";
import { batchBySize } from "@/lib/utils";
import { uploadPublicationMedia } from "@/app/(app)/jwpub-actions";
import { uploadGlobalPublicationMedia } from "@/app/(app)/global-publications-actions";

/**
 * Slices `[name, blob]` entries into batches bounded by BOTH the summed byte
 * size (JWPUB_MEDIA_BATCH_MAX_BYTES — the one that actually matters for
 * staying under Vercel's request-body cap) and a plain count ceiling
 * (JWPUB_MEDIA_BATCH_SIZE, guarding against per-part multipart overhead if
 * a publication has many tiny images). Whichever limit is hit first ends
 * the batch.
 */
function batchMediaEntries(entries: [string, Blob][]): [string, Blob][][] {
  const bySize = batchBySize(entries, ([, blob]) => blob.size, JWPUB_MEDIA_BATCH_MAX_BYTES);
  return bySize.flatMap((batch) => {
    const chunks: [string, Blob][][] = [];
    for (let i = 0; i < batch.length; i += JWPUB_MEDIA_BATCH_SIZE) {
      chunks.push(batch.slice(i, i + JWPUB_MEDIA_BATCH_SIZE));
    }
    return chunks;
  });
}

/**
 * Uploads the archive's illustrations to the public `jwpub-media` bucket and
 * returns `filename → public URL`.
 *
 * Batched because a single publication can carry hundreds of images — see
 * batchMediaEntries above for how each request is kept under the body-size
 * cap. The whole set is deduped by filename first (publications reuse the
 * same logos/icons across every chapter).
 */
export async function uploadMedia(
  publicationId: string,
  media: Map<string, Blob>,
  onProgress?: (uploaded: number, total: number) => void
): Promise<Record<string, string>> {
  const entries = [...media.entries()];
  const urls: Record<string, string> = {};
  let uploaded = 0;

  for (const batch of batchMediaEntries(entries)) {
    const formData = new FormData();
    formData.set("publicationId", publicationId);
    for (const [name, blob] of batch) {
      formData.append("files", new File([blob], name));
    }

    const result = await uploadPublicationMedia(formData);
    if (result.urls) Object.assign(urls, result.urls);
    uploaded += batch.length;
    onProgress?.(uploaded, entries.length);
  }

  return urls;
}

/** Same as uploadMedia above, but for a shared global publication (see global-publications-actions.ts) — keyed by `symbol` instead of a per-user `publicationId`. */
export async function uploadGlobalMedia(
  symbol: string,
  media: Map<string, Blob>,
  onProgress?: (uploaded: number, total: number) => void
): Promise<Record<string, string>> {
  const entries = [...media.entries()];
  const urls: Record<string, string> = {};
  let uploaded = 0;

  for (const batch of batchMediaEntries(entries)) {
    const formData = new FormData();
    formData.set("symbol", symbol);
    for (const [name, blob] of batch) {
      formData.append("files", new File([blob], name));
    }

    const result = await uploadGlobalPublicationMedia(formData);
    if (result.urls) Object.assign(urls, result.urls);
    uploaded += batch.length;
    onProgress?.(uploaded, entries.length);
  }

  return urls;
}

/** Swaps every `jwpub-media://foo.jpg` for its uploaded public URL; unresolved refs are left as-is. */
export function rewriteMediaUrls(html: string, urls: Record<string, string>): string {
  return html.replace(/jwpub-media:\/\/([^\s"'<>)]+)/g, (match, ref: string) => {
    const name = decodeURIComponent(ref).split("/").pop() ?? "";
    return urls[name] ?? match;
  });
}
