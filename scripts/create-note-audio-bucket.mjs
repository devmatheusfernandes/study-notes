// One-off provisioning for the `note-audio` bucket (Storage buckets aren't
// DDL, so they don't belong in supabase/migrations — same reasoning as the
// other buckets in lib/storage-config.ts).
//
//   node scripts/create-note-audio-bucket.mjs
//
// Private, like `files`: playback goes through a signed URL issued by
// app/(app)/drawing-actions.ts. No RLS policies — every write is either
// service-role or a service-role-issued signed upload URL, and
// `storage.objects` defaults to deny-all with zero policies.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Read .env by hand — this runs outside Next, so no automatic env loading
// (same reader as scripts/db-migrate.mjs).
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const { error } = await supabase.storage.createBucket("note-audio", {
  public: false,
  allowedMimeTypes: ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg"],
  fileSizeLimit: 40 * 1024 * 1024,
});

if (error && !/already exists/i.test(error.message)) {
  console.error("Falha ao criar o bucket:", error.message);
  process.exit(1);
}

console.log(error ? "Bucket note-audio já existia." : "Bucket note-audio criado.");
