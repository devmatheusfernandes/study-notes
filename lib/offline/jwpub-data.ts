import {
  getAnswers,
  getChapter,
  getExtracts,
  getFootnote,
  type JwpubExtractRow,
} from "@/app/(app)/jwpub-actions";
import { getChapterHighlights, type ParagraphHighlight } from "@/app/(app)/jwlibrary-actions";
import type { PublicationSummary } from "@/lib/jwpub/types";
import {
  readOfflineAnswers,
  readOfflineChapter,
  readOfflineExtracts,
  readOfflineFootnote,
  readOfflineHighlights,
} from "./jwpub-offline";
import { useJwOutbox } from "./jwlibrary-outbox";

/**
 * What the publication reader loads its content through. A downloaded
 * publication answers from the device (instantly, and with no connection);
 * anything else goes to the server, and a failure to reach it comes back as an
 * `error` the caller can show instead of an unhandled rejection.
 */

export const NO_CONNECTION_MESSAGE = "Sem conexão. Baixe a publicação para ler offline.";

export async function loadChapter(publicationId: string, documentId: number): Promise<{ html?: string; error?: string }> {
  const local = await readOfflineChapter(publicationId, documentId);
  if (local !== undefined) return { html: local };
  try {
    return await getChapter(publicationId, documentId);
  } catch {
    return { error: NO_CONNECTION_MESSAGE };
  }
}

export async function loadFootnote(publicationId: string, footnoteId: number): Promise<{ html?: string; error?: string }> {
  const local = await readOfflineFootnote(publicationId, footnoteId);
  if (local !== undefined) return { html: local };
  try {
    return await getFootnote(publicationId, footnoteId);
  } catch {
    return { error: NO_CONNECTION_MESSAGE };
  }
}

export async function loadExtracts(
  publicationId: string,
  extractIds: number[]
): Promise<{ extracts?: JwpubExtractRow[]; error?: string }> {
  const local = await readOfflineExtracts(publicationId, extractIds);
  if (local !== undefined) return { extracts: local };
  try {
    return await getExtracts(publicationId, extractIds);
  } catch {
    return { error: NO_CONNECTION_MESSAGE };
  }
}

export async function loadAnswers(publicationId: string): Promise<{ answers?: Record<string, string>; error?: string }> {
  const local = await readOfflineAnswers(publicationId);
  if (local !== undefined) return { answers: local };
  try {
    return await getAnswers(publicationId);
  } catch {
    return { error: NO_CONNECTION_MESSAGE };
  }
}

/** `highlights` is undefined on failure, so a reader keeps what it already shows instead of clearing it. */
export async function loadChapterHighlights(
  publication: PublicationSummary,
  mepsDocumentId: number | null
): Promise<{ highlights?: ParagraphHighlight[]; error?: string }> {
  const local = await readOfflineHighlights(publication, mepsDocumentId);
  if (local !== undefined) return { highlights: local };
  try {
    // The server only knows what the outbox has already sent.
    await useJwOutbox.getState().sync();
    return await getChapterHighlights(
      publication.symbol,
      publication.mepsLanguageIndex,
      publication.issueTagNumber,
      mepsDocumentId
    );
  } catch {
    return { error: NO_CONNECTION_MESSAGE };
  }
}
