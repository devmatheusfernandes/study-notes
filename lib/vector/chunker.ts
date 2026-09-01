import "server-only";

/**
 * Strips HTML tags and unescapes common HTML entities to get clean plain text.
 */
export function stripHtmlTags(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TextChunk {
  index: number;
  content: string;
}

/**
 * Splits text into readable chunks (~500 characters each with ~80 char overlap),
 * respecting sentence boundaries where possible.
 */
export function splitTextIntoChunks(text: string, chunkSize = 500, overlap = 80): TextChunk[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) {
    return [{ index: 0, content: clean }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < clean.length) {
    let end = start + chunkSize;

    if (end < clean.length) {
      // Try to break at sentence end (. ! ?) or newline
      const lastSentenceEnd = Math.max(
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf("! ", end),
        clean.lastIndexOf("? ", end),
        clean.lastIndexOf("\n", end)
      );

      if (lastSentenceEnd > start + chunkSize / 2) {
        end = lastSentenceEnd + 1;
      } else {
        // Fallback to space boundary
        const lastSpace = clean.lastIndexOf(" ", end);
        if (lastSpace > start + chunkSize / 2) {
          end = lastSpace;
        }
      }
    } else {
      end = clean.length;
    }

    const content = clean.slice(start, end).trim();
    if (content.length > 0) {
      chunks.push({ index: chunkIndex++, content });
    }

    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
