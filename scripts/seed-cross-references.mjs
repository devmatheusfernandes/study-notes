/**
 * One-off seed for public.bible_cross_references from
 * data/cross_references.sqlite (table `cross_reference(vid, r, sv, ev)`).
 * Mirrors scripts/seed-bible.mjs exactly (sql.js to read the sqlite file,
 * `pg` to bulk-insert via DATABASE_URL).
 *
 * `vid`/`sv`/`ev` are composite integers: book(2 digits) + chapter(3 digits)
 * + verse(3 digits) — e.g. 24047003 = Jeremiah 47:3 (book 24, same 1-66
 * canonical order as bible_verses.book_order, confirmed empirically).
 * `vid` = the source verse, `sv`/`ev` = the referenced verse or range
 * (`ev = 0` means a single verse, not a range), `r` = display rank.
 *
 * Safe to re-run: truncates the table first, so this is idempotent.
 *
 *   npm run seed:cross-references
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import initSqlJs from "sql.js";

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
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL não está definida (.env ou ambiente).");
  process.exit(1);
}

const dbPath = path.join(root, "data", "cross_references.sqlite");
if (!fs.existsSync(dbPath)) {
  console.error(`Arquivo não encontrado: ${dbPath}`);
  process.exit(1);
}

function decode(v) {
  return {
    bookOrder: Math.floor(v / 1000000),
    chapter: Math.floor((v % 1000000) / 1000),
    verse: v % 1000,
  };
}

const SQL = await initSqlJs();
const sqlite = new SQL.Database(fs.readFileSync(dbPath));

const res = sqlite.exec("SELECT vid, r, sv, ev FROM cross_reference");
sqlite.close();

if (res.length === 0) {
  console.error("Tabela cross_reference vazia ou não encontrada.");
  process.exit(1);
}

const rawRows = res[0].values;
console.log(`${rawRows.length} linhas lidas de cross_references.sqlite.`);

const seen = new Set();
const rows = [];
for (const [vid, r, sv, ev] of rawRows) {
  const src = decode(vid);
  const ref = decode(sv);
  const refEndVerse = ev !== 0 ? decode(ev).verse : null;
  const key = `${src.bookOrder}|${src.chapter}|${src.verse}|${r}|${ref.bookOrder}|${ref.chapter}|${ref.verse}|${refEndVerse}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push([src.bookOrder, src.chapter, src.verse, r, ref.bookOrder, ref.chapter, ref.verse, refEndVerse]);
}
console.log(`${rows.length} linhas após deduplicar (${rawRows.length - rows.length} duplicadas removidas).`);

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

await client.query("begin");
try {
  await client.query("truncate table public.bible_cross_references");

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = batch.map((row, idx) => {
      const base = idx * 8;
      values.push(...row);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    });

    await client.query(
      `insert into public.bible_cross_references
       (book_order, chapter, verse, rank, ref_book_order, ref_chapter, ref_start_verse, ref_end_verse)
       values ${placeholders.join(", ")}`,
      values
    );
    process.stdout.write(`\rInserindo… ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  await client.query("commit");
  console.log("\nOK — public.bible_cross_references populada.");
} catch (error) {
  await client.query("rollback");
  console.error("\nFalhou:", error);
  process.exit(1);
} finally {
  await client.end();
}
