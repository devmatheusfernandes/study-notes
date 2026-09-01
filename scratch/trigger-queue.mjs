import postgres from "postgres";

const dbUrl = process.env.DATABASE_URL;
const sql = postgres(dbUrl, { ssl: "require" });

async function trigger() {
  console.log("Checking vectorization queue...");
  const queue = await sql`
    SELECT id, note_id, user_id, status, attempts, error, created_at, updated_at
    FROM public.vectorization_queue
    WHERE status IN ('pending', 'processing')
  `;
  console.log("Pending items in DB:", queue);
  await sql.end();
}

trigger();
