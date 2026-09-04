"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { BookMarked, Download, Pencil, Plus, RefreshCw, Search, Settings2, Tag, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FileDropZone } from "./file-drop-zone";
import { JwlibraryNoteEditorVault } from "./jwlibrary-note-editor-vault";
import { JwlibraryTagPickerVault } from "./jwlibrary-tag-picker-vault";
import { JwlibraryTagChip } from "./jwlibrary-tag-chip";
import { JwlibraryBulkActionBar } from "./jwlibrary-bulk-action-bar";
import { JwlibraryNotesSkeleton } from "./jwlibrary-notes-skeleton";
import { ViewModeToggle } from "./view-mode-toggle";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useSearchStore } from "@/lib/store/search-store";
import { useJwlibrarySelectionStore } from "@/lib/store/jwlibrary-selection-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { parseNotePreview } from "@/lib/note-preview";
import { listJwlibraryContent, type JwlibraryNoteView, type JwlibraryTagView } from "@/app/(app)/jwlibrary-actions";
import { JWLIBRARY_HIGHLIGHT_COLORS, getPublicationFallbackTitle } from "@/lib/jwlibrary/constants";

/** Strips tags for search matching — a note's content may be plain text (imported from a real backup) or Tiptap HTML (created here), same as notes.body elsewhere in the app. */
function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function matchesQuery(note: JwlibraryNoteView, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [note.title, plainText(note.content), note.publicationTitle, note.bibleBook, note.bibleText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function referenceLabel(note: JwlibraryNoteView): string {
  if (note.bibleBook && note.location.chapterNumber !== null) {
    const verse = note.blockType === 2 && note.blockIdentifier !== null ? `:${note.blockIdentifier}` : "";
    return `${note.bibleBook} ${note.location.chapterNumber}${verse}`;
  }
  if (note.publicationTitle) return note.publicationTitle;
  if (note.location.keySymbol) return getPublicationFallbackTitle(note.location.keySymbol);
  return "Nota geral";
}

function ColorChip({
  colorIndex,
  active,
  onClick,
}: {
  colorIndex: number;
  active: boolean;
  onClick: () => void;
}) {
  const color = JWLIBRARY_HIGHLIGHT_COLORS[colorIndex];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
        active ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:bg-secondary"
      )}
    >
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color.hex }} />
      {color.name}
    </button>
  );
}

export function JwlibraryNotesCollection() {
  const router = useRouter();
  const query = useSearchStore((s) => s.query);
  const fileInput = useRef<HTMLInputElement>(null);
  const { upload, isUploading } = useFileUpload();

  const [notes, setNotes] = useState<JwlibraryNoteView[] | null>(null);
  const [tags, setTags] = useState<JwlibraryTagView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedColors, setSelectedColors] = useState<Set<number>>(new Set());
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [editingNote, setEditingNote] = useState<JwlibraryNoteView | null>(null);
  const [creatingNote, setCreatingNote] = useState(false);
  const editorOpen = editingNote !== null || creatingNote;
  const [taggingNoteId, setTaggingNoteId] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState("");
  const jwlibraryViewMode = usePreferencesStore((s) => s.jwlibraryViewMode);
  const setJwlibraryViewMode = usePreferencesStore((s) => s.setJwlibraryViewMode);

  // Subscribing to selectedIds itself (not just the isSelected getter below)
  // is what makes this component re-render on toggle/selectAll/clear —
  // isSelected is a stable function reference across renders, so subscribing
  // to it alone never triggers a re-render (same pattern notes-collection.tsx
  // relies on). Read but otherwise unused — the subscription is the point.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const selectedIds = useJwlibrarySelectionStore((s) => s.selectedIds);
  const isSelected = useJwlibrarySelectionStore((s) => s.isSelected);
  const toggleSelect = useJwlibrarySelectionStore((s) => s.toggle);
  const setVisibleIds = useJwlibrarySelectionStore((s) => s.setVisibleIds);
  const clearSelection = useJwlibrarySelectionStore((s) => s.clear);

  async function refresh() {
    setRefreshing(true);
    const result = await listJwlibraryContent();
    if (result.error) setError(result.error);
    setNotes(result.notes ?? []);
    setTags(result.tags ?? []);
    setRefreshing(false);
  }

  // Initial load — deliberately not routed through refresh() (which sets
  // `refreshing`, meant for the manual button/poll) and every setState call
  // happens inside the .then(), not synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    void listJwlibraryContent().then((result) => {
      if (cancelled) return;
      if (result.error) setError(result.error);
      setNotes(result.notes ?? []);
      setTags(result.tags ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ingesting a backup (thousands of highlights isn't unusual) can take a
  // while after the upload itself finishes — there's no server push here, so
  // once the upload settles, poll a few times for the import to land instead
  // of leaving the page looking stuck.
  function pollAfterUpload() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      void refresh();
      if (attempts >= 6) clearInterval(timer);
    }, 4000);
  }

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    void upload(Array.from(list)).then(pollAfterUpload);
    if (fileInput.current) fileInput.current.value = "";
  }

  const usedColors = useMemo(
    () => [...new Set((notes ?? []).map((n) => n.colorIndex).filter((c): c is number => c !== null))].sort(),
    [notes]
  );

  // Narrows which tag chips show in the horizontal-scroll filter row — purely
  // visual/local, doesn't touch selectedTagIds (which chips filter notes by).
  const visibleTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => (t.name ?? "").toLowerCase().includes(q));
  }, [tags, tagSearch]);

  const filteredNotes = useMemo(() => {
    if (!notes) return [];
    return notes.filter((note) => {
      if (!matchesQuery(note, query)) return false;
      if (selectedColors.size > 0 && (note.colorIndex === null || !selectedColors.has(note.colorIndex))) return false;
      if (selectedTagIds.size > 0 && !note.tagIds.some((id) => selectedTagIds.has(id))) return false;
      return true;
    });
  }, [notes, query, selectedColors, selectedTagIds]);

  // Keeps "Selecionar todas" scoped to whatever's currently visible — same
  // pattern as notes-collection.tsx's own sync effect.
  useEffect(() => {
    setVisibleIds(filteredNotes.map((n) => n.id));
  }, [filteredNotes, setVisibleIds]);

  useEffect(() => clearSelection, [clearSelection]);

  function toggleColor(colorIndex: number) {
    setSelectedColors((prev) => {
      const next = new Set(prev);
      if (next.has(colorIndex)) next.delete(colorIndex);
      else next.add(colorIndex);
      return next;
    });
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function openNote(note: JwlibraryNoteView) {
    if (note.publicationNoteId && note.chapterDocumentId !== null) {
      const params = new URLSearchParams({ doc: String(note.chapterDocumentId) });
      if (note.blockType === 1 && note.blockIdentifier !== null) {
        params.set("pid", String(note.blockIdentifier));
      }
      router.push(`/notes/${note.publicationNoteId}?${params.toString()}`);
      return;
    }
    if (note.location.bookNumber !== null && note.location.chapterNumber !== null) {
      const params = new URLSearchParams({
        book: String(note.location.bookNumber),
        chapter: String(note.location.chapterNumber),
      });
      if (note.blockType === 2 && note.blockIdentifier !== null) {
        params.set("verse", String(note.blockIdentifier));
      }
      router.push(`/bible?${params.toString()}`);
      return;
    }
    // Unresolved publication notes have nothing to navigate to yet — their
    // reference text is already shown inline below.
  }

  const fileInputEl = (
    <input
      ref={fileInput}
      type="file"
      accept=".jwlibrary"
      hidden
      onChange={(e) => handleFiles(e.target.files)}
    />
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        leftIcon={<Upload />}
        isLoading={isUploading}
        onClick={() => fileInput.current?.click()}
      >
        Importar backup
      </Button>
      <Button variant="outline" size="sm" leftIcon={<Plus />} onClick={() => setCreatingNote(true)}>
        Nova nota
      </Button>
      {notes !== null && notes.length > 0 && (
        <>
          <Button variant="ghost" size="sm" leftIcon={<Settings2 />} render={<Link href="/jwlibrary/tags" />}>
            Gerenciar tags
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Download />} render={<a href="/jwlibrary/export" />}>
            Exportar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw />}
            isLoading={refreshing}
            onClick={() => void refresh()}
          >
            Atualizar
          </Button>
          <ViewModeToggle value={jwlibraryViewMode} onChange={setJwlibraryViewMode} />
        </>
      )}
    </div>
  );

  if (notes === null) {
    return (
      <FileDropZone>
        {fileInputEl}
        <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
          {toolbar}
          <JwlibraryNotesSkeleton />
        </div>
      </FileDropZone>
    );
  }

  if (error && notes.length === 0) {
    return (
      <FileDropZone>
        {fileInputEl}
        <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
          {toolbar}
          <p className="py-10 text-center text-[13px] text-destructive">{error}</p>
        </div>
      </FileDropZone>
    );
  }

  if (notes.length === 0) {
    return (
      <FileDropZone>
        {fileInputEl}
        <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
          {toolbar}
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia>
                <BookMarked />
              </EmptyMedia>
              <EmptyTitle>Nenhum backup importado</EmptyTitle>
              <EmptyDescription>
                Envie um arquivo .jwlibrary pra trazer suas notas, marcações e tags do JW Library.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
        <JwlibraryNoteEditorVault
          open={editorOpen}
          onOpenChange={(next) => {
            if (!next) {
              setEditingNote(null);
              setCreatingNote(false);
            }
          }}
          note={editingNote}
          onSaved={() => void refresh()}
        />
      </FileDropZone>
    );
  }

  return (
    <FileDropZone>
      {fileInputEl}
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
        {toolbar}
        {(usedColors.length > 0 || tags.length > 0) && (
          <div className="flex flex-col gap-2">
            {usedColors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {usedColors.map((colorIndex) => (
                  <ColorChip
                    key={colorIndex}
                    colorIndex={colorIndex}
                    active={selectedColors.has(colorIndex)}
                    onClick={() => toggleColor(colorIndex)}
                  />
                ))}
              </div>
            )}
            {tags.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="relative w-28 shrink-0">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="Buscar tag"
                    className="h-8 pl-8 pr-2 text-[12px]"
                  />
                </div>
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {visibleTags.map((tag) => (
                    <span key={tag.id} className="shrink-0">
                      <JwlibraryTagChip tag={tag} active={selectedTagIds.has(tag.id)} onClick={() => toggleTag(tag.id)} />
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div
          className={
            jwlibraryViewMode === "grid"
              ? "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
              : "flex flex-col gap-2.5"
          }
        >
          {filteredNotes.map((note) => {
            const openable = Boolean(
              (note.publicationNoteId && note.chapterDocumentId !== null) ||
                (note.location.bookNumber !== null && note.location.chapterNumber !== null)
            );
            // note.content is either plain text (imported from a real backup)
            // or Tiptap HTML (created here) — parseNotePreview handles both
            // the same way NoteCard already does for notes.body, so raw tags
            // never leak into the card as visible text.
            const preview = note.content ? parseNotePreview(note.content).html : undefined;
            const body = (
              <>
                {note.bibleText && (
                  <p className="line-clamp-2 text-[12.5px] italic leading-relaxed text-muted-foreground">
                    “{note.bibleText}”
                  </p>
                )}
                {note.title && <span className="font-heading text-[15px]">{note.title}</span>}
                {preview && (
                  <p
                    className="line-clamp-3 text-[13px] leading-relaxed text-foreground/85"
                    dangerouslySetInnerHTML={{ __html: preview }}
                  />
                )}
              </>
            );

            return (
              <motion.div
                key={note.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-1.5 rounded-2xl border border-transparent bg-secondary p-4 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSelect(note.id)}
                    aria-label={isSelected(note.id) ? "Remover da seleção" : "Selecionar"}
                    aria-pressed={isSelected(note.id)}
                    className="shrink-0"
                  >
                    <Checkbox checked={isSelected(note.id)} className="pointer-events-none" tabIndex={-1} readOnly />
                  </button>
                  {note.colorIndex !== null && (
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: JWLIBRARY_HIGHLIGHT_COLORS[note.colorIndex]?.hex }}
                    />
                  )}
                  <span className="truncate font-mono text-[11px] tracking-[0.04em] text-accent">
                    {referenceLabel(note)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTaggingNoteId(note.id)}
                    aria-label="Gerenciar tags da nota"
                    className="ml-auto shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <Tag className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingNote(note)}
                    aria-label="Editar nota"
                    className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </div>

                {/* Sibling of the edit button above, not nested inside it — a
                    card can't both open the reader and edit metadata from the
                    same click target. */}
                {openable ? (
                  <button
                    type="button"
                    onClick={() => openNote(note)}
                    className="flex flex-col gap-1.5 text-left hover:opacity-90"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex flex-col gap-1.5">{body}</div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      <JwlibraryBulkActionBar onDeleted={() => void refresh()} />

      <JwlibraryNoteEditorVault
        open={editorOpen}
        onOpenChange={(next) => {
          if (!next) {
            setEditingNote(null);
            setCreatingNote(false);
          }
        }}
        note={editingNote}
        onSaved={() => void refresh()}
      />
      <JwlibraryTagPickerVault
        open={taggingNoteId !== null}
        onOpenChange={(next) => {
          if (!next) {
            setTaggingNoteId(null);
            // Tag add/remove happens directly inside the picker (not through
            // onSaved-style callback) — refresh here so this list's cached
            // tagIds/filter chips catch up once the vault closes.
            void refresh();
          }
        }}
        noteIds={taggingNoteId ? [taggingNoteId] : []}
      />
    </FileDropZone>
  );
}
