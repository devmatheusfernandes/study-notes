import postgres from "postgres";
import fs from "fs";

const dbUrl = process.env.DATABASE_URL;
const sql = postgres(dbUrl, { ssl: "require" });

async function check() {
  const queue = await sql`
    SELECT id, note_id, user_id, status, attempts, error, created_at, updated_at
    FROM public.vectorization_queue
    ORDER BY created_at DESC
    LIMIT 10
  `;

  const details = [];
  for (const q of queue) {
    const notes = await sql`
      SELECT id, title, type, body, storage_path
      FROM public.notes
      WHERE id = ${q.note_id}
    `;
    details.push({ queueItem: q, note: notes[0] || null });
  }

  fs.writeFileSync("scratch/queue-dump.json", JSON.stringify(details, null, 2));
  console.log("Saved to scratch/queue-dump.json");
  await sql.end();
}

check();
