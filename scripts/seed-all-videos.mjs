import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import OpenAI from "openai";

// This runs outside Next via plain `node`, so .env isn't loaded automatically
// — same manual read as scripts/db-migrate.mjs.
function readEnv() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
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
const dbUrl = env.DATABASE_URL;
const openaiKey = env.OPENAI_API_KEY;

if (!dbUrl || !openaiKey) {
  console.error("DATABASE_URL ou OPENAI_API_KEY não configuradas no .env");
  process.exit(1);
}

const sql = postgres(dbUrl, { ssl: "require" });
const openai = new OpenAI({ apiKey: openaiKey });

/** Helper to clean WebVTT subtitles */
function formatVttToText(vtt) {
  const lines = vtt.split(/\r?\n/);
  const paragraphs = [];
  let buffer = "";

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith("WEBVTT") || line.startsWith("NOTE") || line.startsWith("STYLE")) continue;
    if (line.includes("-->")) continue;
    if (/^\d+$/.test(line)) continue;

    line = line.replace(/<[^>]+>/g, "").trim();
    if (!line) continue;

    if (buffer.length > 0) {
      buffer += " " + line;
    } else {
      buffer = line;
    }

    if (/[.!?…]$/.test(line)) {
      paragraphs.push(buffer.trim());
      buffer = "";
    }
  }

  if (buffer) paragraphs.push(buffer.trim());
  return paragraphs.join("\n\n");
}

/** Simple text chunker (~350 words per chunk) */
function splitTextIntoChunks(text, maxWords = 350) {
  const paragraphs = text.split("\n\n").filter(Boolean);
  const chunks = [];
  let currentWords = [];
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).filter(Boolean);
    if (currentWords.length + paraWords.length > maxWords && currentWords.length > 0) {
      chunks.push({
        index: chunkIndex++,
        content: currentWords.join(" "),
      });
      currentWords = [];
    }
    currentWords.push(...paraWords);
  }

  if (currentWords.length > 0) {
    chunks.push({
      index: chunkIndex++,
      content: currentWords.join(" "),
    });
  }

  return chunks;
}

/** Helper to pick the best MP4 URL */
function selectBestVideoUrl(files = []) {
  const mp4s = files.filter((f) => (f.mimetype || "").includes("mp4"));
  if (mp4s.length === 0) return undefined;

  mp4s.sort((a, b) => {
    const ah = Number(a.frameHeight || 0);
    const bh = Number(b.frameHeight || 0);
    const ar = Number(a.bitRate || 0);
    const br = Number(b.bitRate || 0);
    if (bh !== ah) return bh - ah;
    return br - ar;
  });

  return mp4s[0]?.progressiveDownloadURL;
}

/** JW.org category fetcher */
async function fetchCategory(key) {
  const url = `https://b.jw-cdn.org/apis/mediator/v1/categories/T/${key}?detailed=1&mediaLimit=0&clientType=www`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Recursive crawler */
async function crawlCategory(key = "VideoOnDemand", visited = new Set()) {
  if (visited.has(key)) return [];
  visited.add(key);

  const data = await fetchCategory(key);
  const category = data?.category;
  if (!category) return [];

  const mediaList = Array.isArray(category.media) ? category.media : [];
  const results = [];

  for (const video of mediaList) {
    const subtitlesUrl = (video.files || []).find((f) => f?.subtitles?.url)?.subtitles?.url;
    if (!subtitlesUrl) continue;

    const title = video.title || "";
    const coverImage =
      video.images?.wss?.lg || video.images?.pnr?.lg || video.images?.sqr?.lg || undefined;
    const videoUrl = selectBestVideoUrl(video.files || []);

    results.push({
      id: video.naturalKey,
      title,
      categoryKey: video.primaryCategory || key,
      durationFormatted: video.durationFormattedMinSec || "00:00",
      durationSeconds: video.duration || 0,
      coverImage,
      videoUrl,
      subtitlesUrl,
      firstPublished: video.firstPublished || null,
    });
  }

  const subcategories = Array.isArray(category.subcategories) ? category.subcategories : [];
  const subResults = await Promise.all(
    subcategories.map((sub) => crawlCategory(sub.key, visited))
  );

  return [...results, ...subResults.flat()];
}

/** Process a single video item */
async function processSingleVideo(video) {
  try {
    // Download VTT subtitle
    let contentText = "";
    if (video.subtitlesUrl) {
      const res = await fetch(video.subtitlesUrl);
      if (res.ok) {
        const vtt = await res.text();
        contentText = formatVttToText(vtt);
      }
    }

    // Upsert into global_videos
    await sql`
      INSERT INTO public.global_videos (
        id, title, category_key, duration_formatted, duration_seconds, cover_image, video_url, subtitles_url, content_text, metadata, first_published
      ) VALUES (
        ${video.id}, ${video.title}, ${video.categoryKey}, ${video.durationFormatted}, ${Math.round(Number(video.durationSeconds) || 0)}, ${video.coverImage || null}, ${video.videoUrl || null}, ${video.subtitlesUrl || null}, ${contentText}, ${JSON.stringify({ jwVideoId: video.id, videoUrl: video.videoUrl, coverImage: video.coverImage, durationFormatted: video.durationFormatted })}, ${video.firstPublished}
      ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        video_url = EXCLUDED.video_url,
        content_text = EXCLUDED.content_text,
        first_published = EXCLUDED.first_published,
        updated_at = NOW();
    `;

    if (contentText) {
      const fullText = `Vídeo: ${video.title}\n\n${contentText}`;
      const chunks = splitTextIntoChunks(fullText, 350);

      if (chunks.length > 0) {
        const chunkTexts = chunks.map((c) => c.content);

        // OpenAI Embedding Call
        const embRes = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: chunkTexts,
        });

        // Delete existing embeddings for this video before inserting
        await sql`DELETE FROM public.global_video_embeddings WHERE video_id = ${video.id}`;

        // Insert vector chunks
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const embedding = embRes.data[i].embedding;
          const vectorString = `[${embedding.join(",")}]`;

          const metadataObj = {
            title: video.title,
            type: "video",
            videoId: video.id,
            videoUrl: video.videoUrl,
            coverImage: video.coverImage,
            durationFormatted: video.durationFormatted,
            subtitlesUrl: video.subtitlesUrl,
          };

          await sql`
            INSERT INTO public.global_video_embeddings (
              video_id, chunk_index, content, embedding, metadata
            ) VALUES (
              ${video.id}, ${chunk.index}, ${chunk.content}, ${vectorString}::vector, ${JSON.stringify(metadataObj)}
            );
          `;
        }
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Cheap, no-OpenAI-cost pass for videos that already have a row: just backs
 * fills `first_published` from the crawl (which we already paid for) instead
 * of re-downloading transcripts or re-embedding anything. Batched via
 * jsonb_to_recordset so it's one round trip per batch, not one per video.
 */
async function backfillFirstPublished(videos) {
  const rows = videos
    .filter((v) => v.firstPublished)
    .map((v) => ({ id: v.id, first_published: v.firstPublished }));
  if (rows.length === 0) return 0;

  const BATCH_SIZE = 500;
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await sql`
      UPDATE public.global_videos AS g SET
        first_published = c.first_published
      FROM (
        SELECT * FROM jsonb_to_recordset(${sql.json(batch)})
          AS x(id text, first_published timestamptz)
      ) AS c
      WHERE g.id = c.id
        AND g.first_published IS DISTINCT FROM c.first_published
    `;
    updated += result.count ?? 0;
  }
  return updated;
}

async function run() {
  console.log("=================================================");
  console.log("🚀 INICIANDO IMPORTAÇÃO E VETORIZAÇÃO (PARALELA) ");
  console.log("=================================================\n");

  // 1. Fetch existing video IDs
  const existingRows = await sql`SELECT id FROM public.global_videos`;
  const existingIds = new Set(existingRows.map((r) => r.id));
  console.log(`📌 VÍDEOS JÁ IMPORTADOS NO BANCO: ${existingIds.size}`);

  // 2. Crawl JW.org API
  console.log("🔎 Varrendo o catálogo do JW.org...");
  const allCrawled = await crawlCategory("VideoOnDemand");

  // Deduplicate
  const uniqueMap = new Map();
  for (const v of allCrawled) {
    if (!uniqueMap.has(v.id)) {
      uniqueMap.set(v.id, v);
    }
  }

  const videos = Array.from(uniqueMap.values());
  const pendingVideos = videos.filter((v) => !existingIds.has(v.id));
  const existingVideos = videos.filter((v) => existingIds.has(v.id));

  console.log(`✅ Total de vídeos encontrados com transcrição VTT: ${videos.length}`);
  console.log(`⚡ Novos vídeos pendentes para salvar e vetorizar: ${pendingVideos.length}\n`);

  // Videos already in the DB never get re-downloaded/re-embedded here — just
  // their first_published backfilled (cheap, already-crawled data, no OpenAI cost).
  console.log("📅 Atualizando data de publicação dos vídeos já existentes...");
  const backfilledCount = await backfillFirstPublished(existingVideos);
  console.log(`   ${backfilledCount} vídeo(s) com data atualizada.\n`);

  if (pendingVideos.length === 0) {
    console.log("🎉 Todos os vídeos já estão importados e vetorizados com sucesso!");
    await sql.end();
    return;
  }

  // 3. Process pending videos in parallel batches of 15
  const BATCH_SIZE = 15;
  let processedCount = 0;
  let successCount = 0;

  for (let i = 0; i < pendingVideos.length; i += BATCH_SIZE) {
    const batch = pendingVideos.slice(i, i + BATCH_SIZE);
    const startIdx = i + 1;
    const endIdx = Math.min(i + BATCH_SIZE, pendingVideos.length);

    console.log(`⏳ Processando lote [${startIdx} - ${endIdx} de ${pendingVideos.length}]...`);

    const results = await Promise.all(
      batch.map((video) => processSingleVideo(video))
    );

    const batchSuccess = results.filter((r) => r.ok).length;
    processedCount += batch.length;
    successCount += batchSuccess;

    const progressPct = Math.round((processedCount / pendingVideos.length) * 100);
    console.log(`   ✨ Progresso: ${processedCount}/${pendingVideos.length} (${progressPct}%) — ${successCount} concluídos com sucesso.`);
  }

  console.log("\n=================================================");
  console.log(`🎉 PROCESSO CONCLUÍDO COM SUCESSO!`);
  console.log(`- Total de vídeos vetorizados no Supabase: ${successCount}`);
  console.log("=================================================\n");

  await sql.end();
}

run().catch((err) => {
  console.error("Erro fatal na execução do script de vetorização:", err);
  process.exit(1);
});
