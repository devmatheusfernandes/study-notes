// One-off: uploads the illustrations the Study Bible's appendices reference
// (`jwpub-media://…` in data/nwt_st.sqlite) to the public `jwpub-media` bucket,
// under the shared prefix `global/nwtsty/` — the appendices are one table for
// every user, so their images are shared too (per-user publications use
// `${user_id}/${publication_id}/`).
//
//   node scripts/upload-nwtsty-media.mjs "C:\path\to\nwtsty_T.jwpub"
//
// The .jwpub is a zip whose `contents` entry is another zip holding the images.
// Re-runnable (upsert). Afterwards run `npm run seed:bible-study` so the
// appendices' HTML points at these files.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jwpubPath = process.argv[2];
if (!jwpubPath || !fs.existsSync(jwpubPath)) {
  console.error('Uso: node scripts/upload-nwtsty-media.mjs "<caminho do nwtsty_T.jwpub>"');
  process.exit(1);
}

const env = {
  ...Object.fromEntries(
    fs
      .readFileSync(path.join(root, ".env"), "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      })
  ),
  ...process.env,
};
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
  process.exit(1);
}

// Which images the appendices actually use.
const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(path.join(root, "data", "nwt_st.sqlite")));
const wanted = new Set();
for (const [html] of db.exec("SELECT content FROM appendices")[0].values.map((row) => row)) {
  for (const m of String(html ?? "").matchAll(/jwpub-media:\/\/([^\s"'<>)]+)/g)) {
    wanted.add(decodeURIComponent(m[1]).split("/").pop());
  }
}
console.log(`${wanted.size} imagens referenciadas pelos apêndices.`);

const outer = await JSZip.loadAsync(fs.readFileSync(jwpubPath));
const inner = await JSZip.loadAsync(await outer.file("contents").async("uint8array"));
const byName = new Map();
inner.forEach((p, entry) => {
  if (!entry.dir) byName.set(p.split("/").pop(), entry);
});

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", svg: "image/svg+xml" };
const supabase = createClient(url, serviceKey);
let ok = 0;
const missing = [];
for (const name of wanted) {
  const entry = byName.get(name);
  if (!entry) {
    missing.push(name);
    continue;
  }
  const type = MIME[name.split(".").pop().toLowerCase()] ?? "application/octet-stream";
  const bytes = await entry.async("uint8array");
  // Supabase validates the bucket's allowedMimeTypes against the blob's own type.
  const { error } = await supabase.storage
    .from("jwpub-media")
    .upload(`global/nwtsty/${name}`, new Blob([bytes], { type }), { contentType: type, upsert: true });
  if (error) {
    console.error(`✗ ${name}: ${error.message}`);
    process.exitCode = 1;
  } else {
    ok++;
  }
}
console.log(`${ok} enviadas.${missing.length ? ` Ausentes no .jwpub: ${missing.join(", ")}` : ""}`);
