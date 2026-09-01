"use client";

import { JWPUB_MEDIA_BATCH_SIZE } from "@/lib/storage-config";
import { uploadPublicationMedia } from "@/app/(app)/jwpub-actions";

/**
 * Uploads the archive's illustrations to the public `jwpub-media` bucket and
 * returns `filename → public URL`.
 *
 * Batched because a single publication can carry hundreds of images: each call
 * carries at most JWPUB_MEDIA_BATCH_SIZE files, and the whole set is deduped by
 * filename first (publications reuse the same logos/icons across every chapter).
 */
export async function uploadMedia(
  publicationId: string,
  media: Map<string, Blob>,
  onProgress?: (uploaded: number, total: number) => void
): Promise<Record<string, string>> {
  const names = [...media.keys()];
  const urls: Record<string, string> = {};

  for (let i = 0; i < names.length; i += JWPUB_MEDIA_BATCH_SIZE) {
    const batch = names.slice(i, i + JWPUB_MEDIA_BATCH_SIZE);
    const formData = new FormData();
    formData.set("publicationId", publicationId);
    for (const name of batch) {
      formData.append("files", new File([media.get(name)!], name));
    }

    const result = await uploadPublicationMedia(formData);
    if (result.urls) Object.assign(urls, result.urls);
    onProgress?.(Math.min(i + batch.length, names.length), names.length);
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
