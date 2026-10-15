// One-off: moves `note-images` from public-read to private.
//
//   node scripts/make-note-images-private.mjs           # dry run — counts only
//   node scripts/make-note-images-private.mjs --apply   # rewrite bodies, THEN flip the bucket
//
// DEPLOY THE APP FIRST (the /api/note-images route has to exist before the
// bucket goes private, or every image in every note breaks until it does).
//
// 1. Rewrites every note body that still references a public
//    `.../storage/v1/object/public/note-images/<path>` URL to `/api/note-images/<path>`.
//    Bodies are AES-GCM encrypted (lib/encryption.ts), so this decrypts with
//    ENCRYPTION_KEY, rewrites, re-encrypts. `updated_at` is left untouched.
// 2. Only then sets the bucket `public = false`.

import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const env = {
  ...Object.fromEntries(
    readFileSync(new URL("../.env", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
  ),
  ...process.env,
};
const apply = process.argv.includes("--apply");

const key = Buffer.from(env.ENCRYPTION_KEY ?? "", "hex");
if (key.length !== 32) throw new Error("ENCRYPTION_KEY ausente ou inválida.");

function decrypt(hash) {
  const [iv, tag, enc] = hash.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(enc, "hex", "utf8") + d.final("utf8");
}
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = c.update(text, "utf8", "hex") + c.final("hex");
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc}`;
}

// Matches the whole absolute URL up to the path, whatever the project host is.
const LEGACY = /https?:\/\/[^"'\s)]+?\/storage\/v1\/object\/public\/note-images\//g;

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const { rows } = await db.query("select id, body from public.notes where body <> ''");
let scanned = 0;
const todo = [];
for (const row of rows) {
  if (row.body.split(":").length !== 3) continue; // not ciphertext (file size strings etc. are encrypted too, but be safe)
  let plain;
  try {
    plain = decrypt(row.body);
  } catch {
    continue;
  }
  scanned++;
  if (!LEGACY.test(plain)) continue;
  LEGACY.lastIndex = 0;
  todo.push({ id: row.id, body: plain.replace(LEGACY, "/api/note-images/") });
}
console.log(`Notas lidas: ${scanned} · com URLs públicas antigas: ${todo.length}`);

if (!apply) {
  console.log("Dry run — nada alterado. Rode com --apply depois de publicar o app.");
  await db.end();
  process.exit(0);
}

await db.query("begin");
await db.query("alter table public.notes disable trigger notes_set_updated_at");
for (const t of todo) {
  await db.query("update public.notes set body = $1 where id = $2", [encrypt(t.body), t.id]);
}
await db.query("alter table public.notes enable trigger notes_set_updated_at");
await db.query("commit");
console.log(`Reescritas ${todo.length} notas.`);
await db.end();

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { error } = await supabase.storage.updateBucket("note-images", {
  public: false,
  fileSizeLimit: 8 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
});
if (error) throw error;
console.log("Bucket note-images agora é privado.");
