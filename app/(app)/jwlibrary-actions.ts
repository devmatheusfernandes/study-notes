"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { updateNoteRow } from "@/app/(app)/notes-actions";
import { encryptText, decryptText } from "@/lib/encryption";
import { buildPublicationIndex } from "@/lib/jwlibrary/resolve";
import type { ParsedJwlibrary, JwlibraryLocation } from "@/lib/jwlibrary/types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const BATCH_SIZE = 200;
// A real backup can carry thousands of highlights (one user's test file had
// ~7000 UserMark/BlockRange rows) — inserting batches one at a time made the
// whole ingest take long enough that it looked hung. Capped concurrency
// keeps it fast without opening dozens of simultaneous connections at once.
const CONCURRENCY = 6;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function insertInBatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict?: string
) {
  await mapConcurrent(chunk(rows, BATCH_SIZE), CONCURRENCY, async (batch) => {
    const query = supabase.from(table);
    const { error } = onConflict ? await query.upsert(batch, { onConflict }) : await query.insert(batch);
    if (error) throw new Error(`Falha ao gravar em ${table}: ${error.message}`);
  });
}

/** Same as insertInBatches, but for upserts whose generated ids the caller needs back (usermarks/notes, linked by guid afterward). */
async function upsertInBatchesReturning<R>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  select: string
): Promise<R[]> {
  const results = await mapConcurrent(chunk(rows, BATCH_SIZE), CONCURRENCY, async (batch) => {
    const { data, error } = await supabase.from(table).upsert(batch, { onConflict }).select(select);
    if (error) throw new Error(`Falha ao gravar em ${table}: ${error.message}`);
    return (data ?? []) as R[];
  });
  return results.flat();
}

function locationColumns(location: JwlibraryLocation) {
  return {
    book_number: location.bookNumber,
    chapter_number: location.chapterNumber,
    key_symbol: location.keySymbol,
    meps_language: location.mepsLanguage,
    issue_tag_number: location.issueTagNumber,
    meps_document_id: location.mepsDocumentId,
    track: location.track,
    location_type: location.locationType,
  };
}

/**
 * Persists a fully-parsed `.jwlibrary` backup. Resolution against the user's
 * own already-imported `.jwpub` publications happens here (not in the parser,
 * which has no DB access) via a single in-memory index — see
 * lib/jwlibrary/resolve.ts for why that beats a query per row.
 */
export async function saveJwlibraryBackup(
  noteId: string,
  parsed: ParsedJwlibrary
): Promise<{ backupId?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: note } = await supabase.from("notes").select("id").eq("id", noteId).single();
  if (!note) return { error: "Backup não encontrado." };

  // Re-ingesting replaces whatever was there — everything cascades from backup_id.
  await supabase.from("jwlibrary_backups").delete().eq("note_id", noteId);

  const { data: backup, error: backupError } = await supabase
    .from("jwlibrary_backups")
    .insert({
      user_id: user.id,
      note_id: noteId,
      device_name: parsed.deviceName,
      schema_version: parsed.schemaVersion,
    })
    .select("id")
    .single();
  if (backupError || !backup) return { error: "Não foi possível registrar o backup." };

  // The note row was created with the raw filename as its title — swap in
  // something readable now that we know the source device. Best-effort, same
  // as savePublication's title fix for .jwpub in jwpub-actions.ts.
  if (parsed.deviceName) {
    await updateNoteRow(noteId, { title: `Backup JW Library — ${parsed.deviceName}` }).catch(() => {});
  }

  try {
    const index = await buildPublicationIndex(supabase);

    // 1. UserMarks first — notes link to them by guid.
    const userMarkIdByGuid = new Map<string, string>();
    if (parsed.userMarks.length > 0) {
      const rows = parsed.userMarks.map((mark) => {
        const resolved = index.resolve(mark.location);
        return {
          user_id: user.id,
          backup_id: backup.id,
          source_guid: mark.guid,
          color_index: mark.colorIndex,
          style_index: mark.styleIndex,
          version: mark.version,
          ...locationColumns(mark.location),
          resolved_publication_id: resolved.publicationId,
          resolved_chapter_id: resolved.chapterId,
        };
      });
      const inserted = await upsertInBatchesReturning<{ id: string; source_guid: string }>(
        supabase,
        "jwlibrary_usermarks",
        rows,
        "user_id,source_guid",
        "id, source_guid"
      );
      for (const row of inserted) userMarkIdByGuid.set(row.source_guid, row.id);

      const blockRangeRows = parsed.userMarks.flatMap((mark) => {
        const userMarkId = userMarkIdByGuid.get(mark.guid);
        if (!userMarkId) return [];
        return mark.blockRanges.map((range) => ({
          user_id: user.id,
          usermark_id: userMarkId,
          block_type: range.blockType,
          identifier: range.identifier,
          start_token: range.startToken,
          end_token: range.endToken,
        }));
      });
      // Ranges aren't upserted (no natural unique key) — the backup delete above
      // already cleared any previous ones via the usermark cascade.
      if (blockRangeRows.length > 0) await insertInBatches(supabase, "jwlibrary_blockranges", blockRangeRows);
    }

    // 2. Notes — link to their UserMark (if any) by the id map built above.
    const noteIdByGuid = new Map<string, string>();
    if (parsed.notes.length > 0) {
      const rows = parsed.notes.map((n) => {
        const resolved = index.resolve(n.location);
        return {
          user_id: user.id,
          backup_id: backup.id,
          source_guid: n.guid,
          user_mark_id: n.userMarkGuid ? (userMarkIdByGuid.get(n.userMarkGuid) ?? null) : null,
          title: encryptText(n.title),
          content: encryptText(n.content),
          block_type: n.blockType,
          block_identifier: n.blockIdentifier,
          source_created_at: n.createdAt || null,
          source_last_modified: n.lastModified || null,
          ...locationColumns(n.location),
          resolved_publication_id: resolved.publicationId,
          resolved_chapter_id: resolved.chapterId,
        };
      });
      const inserted = await upsertInBatchesReturning<{ id: string; source_guid: string }>(
        supabase,
        "jwlibrary_notes",
        rows,
        "user_id,source_guid",
        "id, source_guid"
      );
      for (const row of inserted) noteIdByGuid.set(row.source_guid, row.id);
    }

    // 3. Tags — local id only used to link TagMap rows below, not persisted.
    const tagIdByLocalId = new Map<number, string>();
    if (parsed.tags.length > 0) {
      const rows = parsed.tags.map((tag) => ({
        user_id: user.id,
        backup_id: backup.id,
        tag_type: tag.tagType,
        name: tag.name,
      }));
      const { data: inserted, error } = await supabase.from("jwlibrary_tags").insert(rows).select("id");
      if (error) throw new Error(`Falha ao gravar tags: ${error.message}`);
      (inserted ?? []).forEach((row, i) => tagIdByLocalId.set(parsed.tags[i].localId, row.id));
    }

    // 4. TagMap — either a note (by guid) or a bare location.
    if (parsed.tagMaps.length > 0) {
      const rows = parsed.tagMaps
        .map((tm) => {
          const tagId = tagIdByLocalId.get(tm.tagLocalId);
          if (!tagId) return null;
          const resolved = tm.location ? index.resolve(tm.location) : { publicationId: null, chapterId: null };
          return {
            user_id: user.id,
            tag_id: tagId,
            note_id: tm.noteGuid ? (noteIdByGuid.get(tm.noteGuid) ?? null) : null,
            ...(tm.location ? locationColumns(tm.location) : {}),
            resolved_publication_id: resolved.publicationId,
            resolved_chapter_id: resolved.chapterId,
            position: tm.position,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
      if (rows.length > 0) await insertInBatches(supabase, "jwlibrary_tag_map", rows);
    }

    // 5. Bookmarks
    if (parsed.bookmarks.length > 0) {
      const rows = parsed.bookmarks.map((b) => {
        const resolved = index.resolve(b.location);
        return {
          user_id: user.id,
          backup_id: backup.id,
          title: b.title,
          snippet: b.snippet,
          slot: b.slot,
          block_type: b.blockType,
          block_identifier: b.blockIdentifier,
          ...locationColumns(b.location),
          resolved_publication_id: resolved.publicationId,
          resolved_chapter_id: resolved.chapterId,
        };
      });
      await insertInBatches(supabase, "jwlibrary_bookmarks", rows);
    }

    // 6. Input fields — plus a best-effort cross-write into jwpub_answers
    // (the "Your answer" fields the reader already renders) when the
    // TextTag turns out to match a data-pid actually present in that
    // chapter's stored HTML. Unverified against a real export (no confirmed
    // sample with overlapping InputField + already-imported publication),
    // so this only fires when the text genuinely matches — never guesses.
    if (parsed.inputFields.length > 0) {
      const rows = parsed.inputFields.map((f) => {
        const resolved = index.resolve(f.location);
        return {
          user_id: user.id,
          backup_id: backup.id,
          text_tag: f.textTag,
          value: f.value,
          ...locationColumns(f.location),
          resolved_publication_id: resolved.publicationId,
          resolved_chapter_id: resolved.chapterId,
        };
      });
      await insertInBatches(supabase, "jwlibrary_input_fields", rows);

      const resolvedFields = parsed.inputFields
        .map((f) => ({ field: f, resolved: index.resolve(f.location) }))
        .filter((x) => x.resolved.chapterId !== null);

      const chapterIds = [...new Set(resolvedFields.map((x) => x.resolved.chapterId!))];
      if (chapterIds.length > 0) {
        const { data: chapters } = await supabase
          .from("jwpub_chapters")
          .select("id, publication_id, document_id, content_html")
          .in("id", chapterIds);
        const chapterById = new Map((chapters ?? []).map((c) => [c.id, c]));

        const answerRows = resolvedFields
          .map(({ field, resolved }) => {
            const chapter = chapterById.get(resolved.chapterId!);
            if (!chapter?.content_html?.includes(`data-pid="${field.textTag}"`)) return null;
            return {
              user_id: user.id,
              publication_id: chapter.publication_id,
              document_id: chapter.document_id,
              pid: field.textTag,
              answer: encryptText(field.value),
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);

        if (answerRows.length > 0) {
          await insertInBatches(supabase, "jwpub_answers", answerRows, "publication_id,document_id,pid");
        }
      }
    }
  } catch (error) {
    await supabase.from("jwlibrary_backups").delete().eq("id", backup.id);
    return { error: error instanceof Error ? error.message : "Erro desconhecido ao importar o backup." };
  }

  return { backupId: backup.id };
}

export interface JwlibraryNoteView {
  id: string;
  title: string;
  content: string;
  blockType: number;
  blockIdentifier: number | null;
  colorIndex: number | null;
  location: JwlibraryLocation;
  resolvedPublicationId: string | null;
  resolvedChapterId: string | null;
  publicationTitle: string | null;
  /** The `notes.id` of the underlying imported .jwpub — needed to build `/notes/[id]?doc=&pid=`. */
  publicationNoteId: string | null;
  chapterDocumentId: number | null;
  /** Book name + verse text, only set when `location.bookNumber` resolved against public.bible_verses. */
  bibleBook: string | null;
  bibleText: string | null;
  tagIds: string[];
  createdAt: string | null;
  lastModified: string | null;
}

export interface JwlibraryTagView {
  id: string;
  tagType: number;
  name: string | null;
}

/** Everything the /jwlibrary management page needs, already decrypted/joined. */
export async function listJwlibraryContent(): Promise<{
  notes?: JwlibraryNoteView[];
  tags?: JwlibraryTagView[];
  error?: string;
}> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  // Resolved fresh on every read (not just read from the stored
  // resolved_publication_id/resolved_chapter_id snapshot taken at import
  // time) — so reprocessing a .jwpub that was already imported before this
  // note's backup, or importing a new one, makes previously "loose" notes
  // resolve without needing to re-import the whole backup.
  const index = await buildPublicationIndex(supabase);

  const [{ data: notes }, { data: usermarks }, { data: tags }, { data: tagMap }, { data: publications }, { data: chapters }] =
    await Promise.all([
      supabase.from("jwlibrary_notes").select("*"),
      supabase.from("jwlibrary_usermarks").select("id, color_index"),
      supabase.from("jwlibrary_tags").select("id, tag_type, name"),
      supabase.from("jwlibrary_tag_map").select("tag_id, note_id").not("note_id", "is", null),
      supabase.from("jwpub_publications").select("id, note_id, title"),
      supabase.from("jwpub_chapters").select("id, document_id"),
    ]);

  const userMarkColorById = new Map((usermarks ?? []).map((m) => [m.id, m.color_index as number]));
  const publicationTitleById = new Map((publications ?? []).map((p) => [p.id, p.title as string]));
  const publicationNoteIdById = new Map((publications ?? []).map((p) => [p.id, p.note_id as string]));
  const chapterDocIdById = new Map((chapters ?? []).map((c) => [c.id, c.document_id as number]));
  const tagIdsByNoteId = new Map<string, string[]>();
  for (const row of tagMap ?? []) {
    if (!row.note_id) continue;
    const list = tagIdsByNoteId.get(row.note_id) ?? [];
    list.push(row.tag_id);
    tagIdsByNoteId.set(row.note_id, list);
  }

  // Bible verse text for every note that carries a book/chapter — fetched by
  // book (a handful at most) rather than one query per note, then matched by
  // chapter/verse in memory.
  const bookNumbers = [...new Set((notes ?? []).map((n) => n.book_number).filter((n): n is number => n !== null))];
  const verseByRef = new Map<string, { book: string; text: string | null }>();
  if (bookNumbers.length > 0) {
    const { data: verses } = await supabase
      .from("bible_verses")
      .select("book, book_order, chapter, verse, text")
      .in("book_order", bookNumbers);
    for (const v of verses ?? []) {
      verseByRef.set(`${v.book_order}:${v.chapter}:${v.verse ?? "sup"}`, { book: v.book, text: v.text });
    }
  }

  return {
    notes: (notes ?? []).map((n) => {
      const location = {
        bookNumber: n.book_number,
        chapterNumber: n.chapter_number,
        keySymbol: n.key_symbol,
        mepsLanguage: n.meps_language,
        issueTagNumber: n.issue_tag_number,
        mepsDocumentId: n.meps_document_id,
        track: n.track,
        locationType: n.location_type,
      };
      const resolved = index.resolve(location);
      return {
        id: n.id,
        title: decryptText(n.title) ?? "",
        content: decryptText(n.content) ?? "",
        blockType: n.block_type,
        blockIdentifier: n.block_identifier,
        colorIndex: n.user_mark_id ? (userMarkColorById.get(n.user_mark_id) ?? null) : null,
        location,
        resolvedPublicationId: resolved.publicationId,
        resolvedChapterId: resolved.chapterId,
        publicationTitle: resolved.publicationId ? (publicationTitleById.get(resolved.publicationId) ?? null) : null,
        publicationNoteId: resolved.publicationId ? (publicationNoteIdById.get(resolved.publicationId) ?? null) : null,
        chapterDocumentId: resolved.chapterId ? (chapterDocIdById.get(resolved.chapterId) ?? null) : null,
        bibleBook:
          (n.book_number !== null &&
            n.chapter_number !== null &&
            verseByRef.get(`${n.book_number}:${n.chapter_number}:${n.block_type === 2 ? n.block_identifier : "sup"}`)
              ?.book) ||
          null,
        bibleText:
          (n.book_number !== null &&
            n.chapter_number !== null &&
            n.block_type === 2 &&
            verseByRef.get(`${n.book_number}:${n.chapter_number}:${n.block_identifier}`)?.text) ||
          null,
        tagIds: tagIdsByNoteId.get(n.id) ?? [],
        createdAt: n.source_created_at,
        lastModified: n.source_last_modified,
      };
    }),
    tags: (tags ?? []).map((t) => ({ id: t.id, tagType: t.tag_type, name: t.name })),
  };
}

export interface OwnPublication {
  id: string;
  title: string;
  symbol: string;
  mepsLanguageIndex: number | null;
  issueTagNumber: number | null;
}

/** For the "whole publication" note-location picker and the reader's paragraph-picking mode. */
export async function listOwnPublications(): Promise<{ publications?: OwnPublication[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("jwpub_publications")
    .select("id, title, symbol, meps_language_index, issue_tag_number")
    .eq("status", "ready")
    .order("title", { ascending: true });

  if (error) return { error: "Não foi possível carregar suas publicações." };
  return {
    publications: (data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      symbol: p.symbol,
      mepsLanguageIndex: p.meps_language_index,
      issueTagNumber: p.issue_tag_number,
    })),
  };
}

export interface CreateJwlibraryNoteInput {
  title: string;
  content: string;
  /** 0 = whole publication (no specific paragraph/verse), 1 = publication paragraph, 2 = Bible verse — same convention as the source .jwlibrary schema. */
  blockType: number;
  blockIdentifier: number | null;
  location: JwlibraryLocation;
  /** Set when the note is anchored to a selected text span (not just the whole paragraph) and the user picked a highlight color for it. */
  highlight?: { colorIndex: number; startToken: number; endToken: number } | null;
}

/**
 * A note created directly in Study Notes, not imported from any backup —
 * `backup_id` stays null (see migration 0011) and `source_guid` is a fresh
 * UUID, the same shape a real JW Library Guid has, so a future export
 * doesn't need to special-case these. When `input.highlight` is set, also
 * creates the UserMark/BlockRange pair backing the visible highlight and
 * links the note to it — same shape an imported note+highlight pair has.
 */
export async function createJwlibraryNote(
  input: CreateJwlibraryNoteInput
): Promise<{ id?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (!input.title.trim() && !input.content.trim()) return { error: "A nota está vazia." };

  let userMarkId: string | null = null;
  if (input.highlight) {
    const { data: mark, error: markError } = await supabase
      .from("jwlibrary_usermarks")
      .insert({
        user_id: user.id,
        backup_id: null,
        source_guid: randomUUID(),
        color_index: input.highlight.colorIndex,
        style_index: 0,
        version: 1,
        ...locationColumns(input.location),
      })
      .select("id")
      .single();
    if (markError || !mark) return { error: "Não foi possível criar o destaque." };
    userMarkId = mark.id;

    const { error: rangeError } = await supabase.from("jwlibrary_blockranges").insert({
      user_id: user.id,
      usermark_id: userMarkId,
      block_type: input.blockType,
      identifier: input.blockIdentifier,
      start_token: input.highlight.startToken,
      end_token: input.highlight.endToken,
    });
    if (rangeError) return { error: "Não foi possível criar o destaque." };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("jwlibrary_notes")
    .insert({
      user_id: user.id,
      backup_id: null,
      source_guid: randomUUID(),
      user_mark_id: userMarkId,
      title: encryptText(input.title),
      content: encryptText(input.content),
      block_type: input.blockType,
      block_identifier: input.blockIdentifier,
      source_created_at: now,
      source_last_modified: now,
      ...locationColumns(input.location),
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Não foi possível criar a nota." };
  return { id: data.id };
}

export async function updateJwlibraryNote(
  id: string,
  patch: { title?: string; content?: string }
): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const update: Record<string, unknown> = { source_last_modified: new Date().toISOString() };
  if (patch.title !== undefined) update.title = encryptText(patch.title);
  if (patch.content !== undefined) update.content = encryptText(patch.content);

  const { error } = await supabase.from("jwlibrary_notes").update(update).eq("id", id);
  return error ? { error: "Não foi possível salvar a nota." } : {};
}

export async function deleteJwlibraryNote(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("jwlibrary_notes").delete().eq("id", id);
  return error ? { error: "Não foi possível excluir a nota." } : {};
}

export interface ParagraphHighlight {
  /** Matches a rendered chapter's `data-pid` attribute directly. */
  pid: string;
  colorIndex: number;
  startToken: number;
  endToken: number;
  /** The note attached to this highlight's UserMark, if any — shown in a side panel when the mark is clicked (see jwlibrary-highlight-note-surface.tsx). */
  note: { id: string; title: string; content: string } | null;
}

/**
 * All paragraph-level highlights (UserMark.BlockType = 1) for one chapter,
 * filtered directly by location columns — this app's users can carry
 * thousands of jwlibrary_usermarks total, so this must never load the whole
 * set, only what this specific chapter needs (see lib/jwlibrary/resolve.ts's
 * comment for the same reasoning applied to note resolution). Includes each
 * highlight's attached note (if any), fetched up front so clicking a mark in
 * the reader doesn't need a second round trip.
 */
export async function getChapterHighlights(
  symbol: string,
  mepsLanguage: number | null,
  issueTagNumber: number | null,
  mepsDocumentId: number | null
): Promise<{ highlights?: ParagraphHighlight[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (mepsDocumentId === null) return { highlights: [] };

  let query = supabase
    .from("jwlibrary_usermarks")
    .select("id, color_index")
    .eq("key_symbol", symbol)
    .eq("meps_document_id", mepsDocumentId);
  query = mepsLanguage === null ? query.is("meps_language", null) : query.eq("meps_language", mepsLanguage);
  query = issueTagNumber === null ? query.is("issue_tag_number", null) : query.eq("issue_tag_number", issueTagNumber);

  const { data: usermarks, error } = await query;
  if (error) return { error: "Não foi possível carregar as marcações." };
  if (!usermarks || usermarks.length === 0) return { highlights: [] };

  const colorByMark = new Map(usermarks.map((m) => [m.id, m.color_index as number]));
  const markIds = [...colorByMark.keys()];

  const [{ data: ranges, error: rangesError }, { data: notes, error: notesError }] = await Promise.all([
    supabase
      .from("jwlibrary_blockranges")
      .select("usermark_id, identifier, start_token, end_token")
      .in("usermark_id", markIds)
      .eq("block_type", 1), // paragraph ranges only — nothing renders Bible-verse (block_type 2) highlights inline yet
    supabase.from("jwlibrary_notes").select("id, user_mark_id, title, content").in("user_mark_id", markIds),
  ]);

  if (rangesError || notesError) return { error: "Não foi possível carregar as marcações." };

  const noteByMark = new Map(
    (notes ?? []).map((n) => [
      n.user_mark_id as string,
      { id: n.id, title: decryptText(n.title) ?? "", content: decryptText(n.content) ?? "" },
    ])
  );

  return {
    highlights: (ranges ?? [])
      .filter((r) => r.start_token !== null && r.end_token !== null)
      .map((r) => ({
        pid: String(r.identifier),
        colorIndex: colorByMark.get(r.usermark_id) ?? 1,
        startToken: r.start_token as number,
        endToken: r.end_token as number,
        note: noteByMark.get(r.usermark_id) ?? null,
      })),
  };
}

export interface BibleVerseHighlight {
  verse: number;
  colorIndex: number;
  startToken: number;
  endToken: number;
  note: { id: string; title: string; content: string } | null;
}

/** Sibling of getChapterHighlights, for Bible chapters (UserMark.BlockType = 2) instead of publication paragraphs — see components/content/bible-chapter-view.tsx. */
export async function getBibleChapterHighlights(
  bookNumber: number,
  chapterNumber: number
): Promise<{ highlights?: BibleVerseHighlight[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data: usermarks, error } = await supabase
    .from("jwlibrary_usermarks")
    .select("id, color_index")
    .eq("book_number", bookNumber)
    .eq("chapter_number", chapterNumber);

  if (error) return { error: "Não foi possível carregar as marcações." };
  if (!usermarks || usermarks.length === 0) return { highlights: [] };

  const colorByMark = new Map(usermarks.map((m) => [m.id, m.color_index as number]));
  const markIds = [...colorByMark.keys()];

  const [{ data: ranges, error: rangesError }, { data: notes, error: notesError }] = await Promise.all([
    supabase
      .from("jwlibrary_blockranges")
      .select("usermark_id, identifier, start_token, end_token")
      .in("usermark_id", markIds)
      .eq("block_type", 2), // Bible verse ranges only
    supabase.from("jwlibrary_notes").select("id, user_mark_id, title, content").in("user_mark_id", markIds),
  ]);

  if (rangesError || notesError) return { error: "Não foi possível carregar as marcações." };

  const noteByMark = new Map(
    (notes ?? []).map((n) => [
      n.user_mark_id as string,
      { id: n.id, title: decryptText(n.title) ?? "", content: decryptText(n.content) ?? "" },
    ])
  );

  return {
    highlights: (ranges ?? [])
      .filter((r) => r.start_token !== null && r.end_token !== null)
      .map((r) => ({
        verse: Number(r.identifier),
        colorIndex: colorByMark.get(r.usermark_id) ?? 1,
        startToken: r.start_token as number,
        endToken: r.end_token as number,
        note: noteByMark.get(r.usermark_id) ?? null,
      })),
  };
}

export async function listOwnJwlibraryTags(): Promise<{ tags?: JwlibraryTagView[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("jwlibrary_tags")
    .select("id, tag_type, name")
    .order("tag_type", { ascending: true })
    .order("name", { ascending: true });
  if (error) return { error: "Não foi possível carregar as tags." };

  return { tags: (data ?? []).map((t) => ({ id: t.id, tagType: t.tag_type, name: t.name })) };
}

export async function createJwlibraryTag(name: string): Promise<{ id?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Dê um nome para a tag." };

  const { data, error } = await supabase
    .from("jwlibrary_tags")
    .insert({ user_id: user.id, backup_id: null, tag_type: 1, name: trimmed })
    .select("id")
    .single();
  if (error || !data) return { error: "Não foi possível criar a tag." };
  return { id: data.id };
}

/** `tag_type = 1` guard keeps the imported "Favorito" tag (type 0) from being renamed through this UI. */
export async function renameJwlibraryTag(id: string, name: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Dê um nome para a tag." };

  const { error } = await supabase.from("jwlibrary_tags").update({ name: trimmed }).eq("id", id).eq("tag_type", 1);
  return error ? { error: "Não foi possível renomear a tag." } : {};
}

/** Same `tag_type = 1` guard as renameJwlibraryTag — tag_map rows cascade via FK. */
export async function deleteJwlibraryTag(id: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("jwlibrary_tags").delete().eq("id", id).eq("tag_type", 1);
  return error ? { error: "Não foi possível excluir a tag." } : {};
}

export async function getJwlibraryNoteTagIds(noteId: string): Promise<{ tagIds?: string[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase.from("jwlibrary_tag_map").select("tag_id").eq("note_id", noteId);
  if (error) return { error: "Não foi possível carregar as tags da nota." };
  return { tagIds: (data ?? []).map((row) => row.tag_id) };
}

/** Upsert relies on the partial unique index (tag_id, note_id) where note_id is not null — see migration 0013. */
export async function addTagToJwlibraryNote(noteId: string, tagId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase
    .from("jwlibrary_tag_map")
    .upsert({ user_id: user.id, tag_id: tagId, note_id: noteId, position: 0 }, { onConflict: "tag_id,note_id" });
  return error ? { error: "Não foi possível adicionar a tag." } : {};
}

export async function removeTagFromJwlibraryNote(noteId: string, tagId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("jwlibrary_tag_map").delete().eq("note_id", noteId).eq("tag_id", tagId);
  return error ? { error: "Não foi possível remover a tag." } : {};
}

/** Mirrors deleteJwlibraryNote — does not delete the associated usermark/highlight, same as the single-delete path. */
export async function bulkDeleteJwlibraryNotes(ids: string[]): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (ids.length === 0) return {};

  const { error } = await supabase.from("jwlibrary_notes").delete().in("id", ids);
  return error ? { error: "Não foi possível excluir as notas." } : {};
}
