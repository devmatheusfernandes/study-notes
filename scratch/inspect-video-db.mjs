import postgres from "postgres";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const sql = postgres(dbUrl, { ssl: "require" });

async function check() {
  console.log("--- GLOBAL VIDEOS SAMPLE ---");
  const videos = await sql`SELECT id, title, video_url, subtitles_url, cover_image FROM public.global_videos LIMIT 3`;
  console.log(JSON.stringify(videos, null, 2));

  console.log("--- GLOBAL VIDEO EMBEDDINGS SAMPLE ---");
  const embeddings = await sql`SELECT video_id, metadata FROM public.global_video_embeddings LIMIT 3`;
  console.log(JSON.stringify(embeddings, null, 2));

  await sql.end();
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
