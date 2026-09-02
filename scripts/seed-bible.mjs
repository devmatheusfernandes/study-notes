/**
 * One-off seed for public.bible_verses from data/NWT.sqlite (see
 * data/NWT_structure.md for the source schema). Uses sql.js to read the
 * sqlite file (same library the app uses client-side for .jwpub parsing —
 * no native binary needed) and `pg` to bulk-insert via DATABASE_URL, exactly
 * like scripts/db-migrate.mjs.
 *
 * Safe to re-run: truncates the table first, so this is idempotent.
 *
 *   npm run seed:bible
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

const dbPath = path.join(root, "data", "NWT.sqlite");
if (!fs.existsSync(dbPath)) {
  console.error(`Arquivo não encontrado: ${dbPath}`);
  process.exit(1);
}

const SQL = await initSqlJs();
const sqlite = new SQL.Database(fs.readFileSync(dbPath));

const res = sqlite.exec(
  "SELECT id, book, chapter, verse, text, is_superscription, book_order FROM verses ORDER BY id"
);
sqlite.close();

if (res.length === 0) {
  console.error("Tabela verses vazia ou não encontrada em NWT.sqlite.");
  process.exit(1);
}

const rows = res[0].values;
console.log(`${rows.length} versos lidos de NWT.sqlite.`);

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

await client.query("begin");
try {
  await client.query("truncate table public.bible_verses");

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = batch.map((row, idx) => {
      const base = idx * 7;
      values.push(
        row[0],
        row[1],
        row[2],
        row[3],
        row[4],
        Boolean(row[5]),
        row[6]
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });

    await client.query(
      `insert into public.bible_verses (id, book, chapter, verse, text, is_superscription, book_order)
       values ${placeholders.join(", ")}`,
      values
    );
    process.stdout.write(`\rInserindo… ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  await client.query("commit");
  console.log("\nOK — public.bible_verses populada.");
} catch (error) {
  await client.query("rollback");
  console.error("\nFalhou:", error);
  process.exit(1);
} finally {
  await client.end();
}
