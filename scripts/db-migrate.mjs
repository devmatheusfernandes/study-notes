#!/usr/bin/env node
// Minimal migration runner — applies any .sql file under supabase/migrations
// that hasn't run yet, in filename order, each in its own transaction.
// Requires DATABASE_URL in .env (Project Settings -> Database -> Connection string).
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDir = path.join(root, "supabase", "migrations");

const env = Object.fromEntries(
  readFileSync(path.join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env");
  process.exit(1);
}

const client = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`
  create table if not exists public._migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );
`);

const { rows: applied } = await client.query("select name from public._migrations");
const appliedNames = new Set(applied.map((r) => r.name));

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let ranAny = false;
for (const file of files) {
  if (appliedNames.has(file)) continue;
  ranAny = true;
  const sql = readFileSync(path.join(migrationsDir, file), "utf8");
  console.log(`Applying ${file}...`);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into public._migrations (name) values ($1)", [file]);
    await client.query("commit");
    console.log(`  done.`);
  } catch (error) {
    await client.query("rollback");
    console.error(`  FAILED: ${error.message}`);
    await client.end();
    process.exit(1);
  }
}

if (!ranAny) console.log("Nothing to apply — up to date.");

await client.end();
