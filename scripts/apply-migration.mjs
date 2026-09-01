import fs from "fs";
import path from "path";
import postgres from "postgres";

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL não configurada no .env");
    process.exit(1);
  }

  const sqlClient = postgres(dbUrl, { ssl: "require" });
  console.log("Conectado ao Supabase Postgres com sucesso.");

  const sqlPath = path.join(process.cwd(), "supabase", "migrations", "20260901_create_global_videos.sql");
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");

  await sqlClient.unsafe(sqlContent);
  console.log("Migração de vídeos globais e RPC de busca híbrida executada com sucesso!");

  await sqlClient.end();
}

run().catch((err) => {
  console.error("Erro ao aplicar migração:", err);
  process.exit(1);
});
