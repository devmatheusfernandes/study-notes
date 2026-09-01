import postgres from "postgres";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const sql = postgres(dbUrl, { ssl: "require" });

async function check() {
  console.log("--- VECTORIZATION QUEUE ITEMS ---");
  const queue = await sql`
    SELECT id, note_id, user_id, status, attempts, error, created_at, updated_at
    FROM public.vectorization_queue
    ORDER BY created_at DESC
    LIMIT 10
  `;
  console.log(JSON.stringify(queue, null, 2));

  for (const q of queue) {
    const notes = await sql`
      SELECT id, title, type, body, storage_path
      FROM public.notes
      WHERE id = ${q.note_id}
    `;
    console.log(`--- NOTE FOR QUEUE ITEM ${q.id} (note_id: ${q.note_id}) ---`);
    console.log(JSON.stringify(notes, null, 2));
  }

  await sql.end();
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
