/**
 * One-off vectorization of public.bible_verses into global_bible_embeddings —
 * global/shared content (the NWT text is identical for every user), so this
 * is a manual seed script, never the per-user vectorization_queue/cron.
 *
 * Chunked per CHAPTER (not per verse): ~1,189 Bible chapters vs. ~31,194
 * verses is far cheaper to embed, and a chapter is a more coherent semantic
 * unit for retrieval than one verse in isolation. Uses the same
 * ~500-char/80-overlap chunking as the rest of the app (lib/vector/chunker.ts,
 * duplicated inline here since this runs as a standalone script, not through
 * Next's module graph).
 *
 * Safe to re-run: truncates global_bible_embeddings first.
 *
 *   npm run seed:bible-embeddings
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import OpenAI from "openai";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      })
  );
}

const env = { ...readEnv(), ...process.env };
if (!env.DATABASE_URL || !env.OPENAI_API_KEY) {
  console.error("DATABASE_URL ou OPENAI_API_KEY não configuradas no .env");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_COST_PER_1K = 0.00002;

/** Same shape as lib/vector/chunker.ts's splitTextIntoChunks. */
function splitTextIntoChunks(text, chunkSize = 500, overlap = 80) {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = start + chunkSize;
    if (end < clean.length) {
      const lastBreak = Math.max(
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf("! ", end),
        clean.lastIndexOf("? ", end),
        clean.lastIndexOf("\n", end)
      );
      if (lastBreak > start + chunkSize / 2) end = lastBreak + 1;
      else {
        const lastSpace = clean.lastIndexOf(" ", end);
        if (lastSpace > start + chunkSize / 2) end = lastSpace;
      }
    } else {
      end = clean.length;
    }

    const content = clean.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end >= clean.length) break;

    let nextStart = Math.max(end - overlap, start + 1);
    if (clean[nextStart - 1] !== " ") {
      const nextSpace = clean.indexOf(" ", nextStart);
      if (nextSpace !== -1 && nextSpace < end) nextStart = nextSpace + 1;
    }
    start = nextStart;
  }
  return chunks;
}

async function main() {
  const client = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const { rows } = await client.query(
    `select id, book, chapter, verse, text, book_order
     from bible_verses
     order by book_order, chapter, verse nulls first, id`
  );
  console.log(`${rows.length} versículo(s) lido(s) de bible_verses.`);

  // Group into chapters, in canonical order.
  const chapters = [];
  let current = null;
  for (const row of rows) {
    const key = `${row.book_order}:${row.chapter}`;
    if (!current || current.key !== key) {
      current = { key, book: row.book, chapter: row.chapter, bookOrder: row.book_order, verseNumbers: [], texts: [] };
      chapters.push(current);
    }
    // `verse` is null for superscription rows — only real verse numbers are
    // useful for linking (the /bible reader takes a per-chapter verse
    // *number*, not `bible_verses.id`'s global BibleVerseId).
    if (row.verse !== null) current.verseNumbers.push(row.verse);
    if (row.text) current.texts.push(row.text);
  }
  console.log(`Agrupados em ${chapters.length} capítulo(s).`);

  // Build every chunk up front (cheap, in-memory) — text, embedding batch,
  // and DB insert are handled together right after, in slices.
  const allChunks = [];
  let globalChunkIndex = 0;
  for (const ch of chapters) {
    const fullText = `${ch.book} ${ch.chapter}\n\n${ch.texts.join(" ")}`.trim();
    const pieces = splitTextIntoChunks(fullText);
    for (const content of pieces) {
      allChunks.push({
        chunkIndex: globalChunkIndex++,
        content,
        metadata: {
          title: `${ch.book} ${ch.chapter}`,
          type: "biblia",
          book: ch.book,
          chapter: ch.chapter,
          bookOrder: ch.bookOrder,
          firstVerse: ch.verseNumbers[0] ?? null,
          lastVerse: ch.verseNumbers[ch.verseNumbers.length - 1] ?? null,
        },
      });
    }
  }
  console.log(`${allChunks.length} trecho(s) para vetorizar.`);

  await client.query("truncate table public.global_bible_embeddings");

  const EMBEDDING_BATCH_SIZE = 100;
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (let i = 0; i < allChunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = allChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((c) => c.content),
    });

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    totalTokens += promptTokens;
    totalCostUsd += (promptTokens / 1000) * EMBEDDING_COST_PER_1K;

    const values = [];
    const placeholders = batch.map((chunk, idx) => {
      const base = idx * 4;
      values.push(chunk.chunkIndex, chunk.content, `[${response.data[idx].embedding.join(",")}]`, JSON.stringify(chunk.metadata));
      return `($${base + 1}, $${base + 2}, $${base + 3}::vector, $${base + 4}::jsonb)`;
    });

    await client.query(
      `insert into public.global_bible_embeddings (chunk_index, content, embedding, metadata) values ${placeholders.join(", ")}`,
      values
    );

    process.stdout.write(`\rVetorizando… ${Math.min(i + EMBEDDING_BATCH_SIZE, allChunks.length)}/${allChunks.length}`);
  }

  console.log(`\nOK — ${allChunks.length} trecho(s) inserido(s) em global_bible_embeddings.`);
  console.log(`Tokens: ${totalTokens} — custo estimado: US$ ${totalCostUsd.toFixed(4)}`);

  await client.end();
}

main().catch((error) => {
  console.error("\nFalhou:", error);
  process.exit(1);
});
