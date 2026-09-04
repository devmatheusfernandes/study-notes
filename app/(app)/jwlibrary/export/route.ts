import { createHash } from "node:crypto";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { decryptText } from "@/lib/encryption";
import { htmlToPlainText } from "@/lib/jwlibrary/plain-text";
import { buildJwlibraryDatabase, type JwlibraryExportData, type JwlibraryExportTag } from "@/lib/jwlibrary/writer";
import type { JwlibraryLocation, JwlibraryBlockRange, JwlibraryNote, JwlibraryUserMark } from "@/lib/jwlibrary/types";

function readLocation(row: {
  book_number: number | null;
  chapter_number: number | null;
  key_symbol: string | null;
  meps_language: number | null;
  issue_tag_number: number | null;
  meps_document_id: number | null;
  track: number | null;
  location_type: number | null;
}): JwlibraryLocation {
  return {
    bookNumber: row.book_number,
    chapterNumber: row.chapter_number,
    keySymbol: row.key_symbol,
    mepsLanguage: row.meps_language,
    issueTagNumber: row.issue_tag_number,
    mepsDocumentId: row.meps_document_id,
    track: row.track,
    locationType: row.location_type,
  };
}

const LOCATION_SELECT =
  "book_number, chapter_number, key_symbol, meps_language, issue_tag_number, meps_document_id, track, location_type";

/**
 * Consolidates every jwlibrary_* row this user owns (across all imported
 * backups, plus anything created directly in Study Notes) into one fresh
 * `.jwlibrary` file — see lib/jwlibrary/writer.ts for the SQLite side.
 * Mirrors the auth pattern of app/(app)/jwlibrary/ingest/route.ts.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sessão expirada." }, { status: 401 });

  const [
    { data: noteRows, error: notesError },
    { data: markRows, error: marksError },
    { data: rangeRows, error: rangesError },
    { data: tagRows, error: tagsError },
    { data: tagMapRows, error: tagMapError },
    { data: bookmarkRows, error: bookmarksError },
    { data: inputFieldRows, error: inputFieldsError },
  ] = await Promise.all([
    supabase
      .from("jwlibrary_notes")
      .select(`id, source_guid, user_mark_id, title, content, block_type, block_identifier, source_created_at, source_last_modified, ${LOCATION_SELECT}`),
    supabase.from("jwlibrary_usermarks").select(`id, source_guid, color_index, style_index, version, ${LOCATION_SELECT}`),
    supabase.from("jwlibrary_blockranges").select("usermark_id, block_type, identifier, start_token, end_token"),
    supabase.from("jwlibrary_tags").select("id, tag_type, name"),
    supabase.from("jwlibrary_tag_map").select(`tag_id, note_id, ${LOCATION_SELECT}`),
    supabase.from("jwlibrary_bookmarks").select(`title, snippet, slot, block_type, block_identifier, ${LOCATION_SELECT}`),
    supabase.from("jwlibrary_input_fields").select(`text_tag, value, ${LOCATION_SELECT}`),
  ]);

  const firstError = notesError ?? marksError ?? rangesError ?? tagsError ?? tagMapError ?? bookmarksError ?? inputFieldsError;
  if (firstError) return Response.json({ error: "Não foi possível carregar seus dados." }, { status: 500 });

  const usermarkGuidById = new Map((markRows ?? []).map((m) => [m.id, m.source_guid as string]));
  const noteGuidById = new Map((noteRows ?? []).map((n) => [n.id, n.source_guid as string]));

  const rangesByMark = new Map<string, JwlibraryBlockRange[]>();
  for (const r of rangeRows ?? []) {
    const list = rangesByMark.get(r.usermark_id) ?? [];
    list.push({ blockType: r.block_type, identifier: r.identifier, startToken: r.start_token, endToken: r.end_token });
    rangesByMark.set(r.usermark_id, list);
  }

  const notes: JwlibraryNote[] = (noteRows ?? []).map((n) => ({
    guid: n.source_guid,
    userMarkGuid: n.user_mark_id ? (usermarkGuidById.get(n.user_mark_id) ?? null) : null,
    title: decryptText(n.title) ?? "",
    content: htmlToPlainText(decryptText(n.content) ?? ""),
    blockType: n.block_type,
    blockIdentifier: n.block_identifier,
    createdAt: n.source_created_at,
    lastModified: n.source_last_modified,
    location: readLocation(n),
  }));

  const userMarks: JwlibraryUserMark[] = (markRows ?? []).map((m) => ({
    guid: m.source_guid,
    colorIndex: m.color_index,
    styleIndex: m.style_index,
    version: m.version,
    location: readLocation(m),
    blockRanges: rangesByMark.get(m.id) ?? [],
  }));

  const tags: JwlibraryExportTag[] = (tagRows ?? []).map((t) => ({ id: t.id, tagType: t.tag_type, name: t.name }));

  const tagMaps: JwlibraryExportData["tagMaps"] = (tagMapRows ?? []).map((row) => ({
    tagId: row.tag_id,
    noteGuid: row.note_id ? (noteGuidById.get(row.note_id) ?? null) : null,
    location: row.note_id ? null : readLocation(row),
  }));

  const bookmarks = (bookmarkRows ?? []).map((b) => ({
    title: b.title,
    snippet: b.snippet,
    slot: b.slot,
    blockType: b.block_type,
    blockIdentifier: b.block_identifier,
    location: readLocation(b),
  }));

  const inputFields = (inputFieldRows ?? []).map((f) => ({
    textTag: f.text_tag,
    value: f.value,
    location: readLocation(f),
  }));

  try {
    const dbBytes = await buildJwlibraryDatabase({ notes, userMarks, tags, tagMaps, bookmarks, inputFields });

    const hash = createHash("sha256").update(dbBytes).digest("hex");
    const now = new Date();
    const isoDate = now.toISOString().slice(0, 10);
    const manifest = {
      name: `StudyNotes_Export_${isoDate}.jwlibrary`,
      creationDate: isoDate,
      version: 1,
      type: 0,
      userDataBackup: {
        lastModifiedDate: now.toISOString().replace(/\.\d+Z$/, "Z"),
        deviceName: "Study Notes",
        databaseName: "userData.db",
        hash,
        schemaVersion: 16,
      },
    };

    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest));
    zip.file("userData.db", dbBytes);
    const zipBytes = await zip.generateAsync({ type: "uint8array" });

    return new Response(Buffer.from(zipBytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${manifest.name}"`,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Falha ao gerar a exportação." },
      { status: 500 }
    );
  }
}
