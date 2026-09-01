/**
 * Applies any .sql file in supabase/migrations/ that hasn't run yet, in
 * filename order, one transaction each, tracked in public._migrations.
 *
 * Uses DATABASE_URL (a direct Postgres connection string — Project Settings →
 * Database), not the Supabase REST API: RLS policies and other DDL aren't
 * reachable through service_role/PostgREST.
 *
 *   npm run migrate
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");

// Read .env by hand — this runs outside Next, so no automatic env loading.
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

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

await client.query(`
  create table if not exists public._migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`);

const { rows } = await client.query("select name from public._migrations");
const applied = new Set(rows.map((r) => r.name));

const pending = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => !applied.has(f));

if (pending.length === 0) {
  console.log("Nada a aplicar — todas as migrations já rodaram.");
  await client.end();
  process.exit(0);
}

for (const name of pending) {
  const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
  process.stdout.write(`Aplicando ${name}… `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into public._migrations (name) values ($1)", [name]);
    await client.query("commit");
    console.log("ok");
  } catch (error) {
    await client.query("rollback");
    console.log("falhou");
    console.error(error);
    await client.end();
    process.exit(1);
  }
}

console.log(`${pending.length} migration(s) aplicada(s).`);
await client.end();
