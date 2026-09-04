"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { Vault, VaultContent, VaultHeader, VaultTitle, VaultDescription, VaultBody } from "@/components/ui/vault";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/content/rich-text-editor";
import { BibleReferencePicker, type BibleReferenceValue } from "./bible-reference-picker";
import { JwlibraryTagChip } from "./jwlibrary-tag-chip";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import {
  createJwlibraryNote,
  updateJwlibraryNote,
  deleteJwlibraryNote,
  listOwnPublications,
  listOwnJwlibraryTags,
  getJwlibraryNoteTagIds,
  addTagToJwlibraryNote,
  removeTagFromJwlibraryNote,
  createJwlibraryTag,
  type OwnPublication,
  type CreateJwlibraryNoteInput,
  type JwlibraryTagView,
} from "@/app/(app)/jwlibrary-actions";
import type { JwlibraryLocation } from "@/lib/jwlibrary/types";

/** Only what the editor actually reads/writes — a full JwlibraryNoteView (from the /jwlibrary list) satisfies this too, but so does the lighter note shape a reader's highlight click already has on hand (see jwpub-reader.tsx), with no extra fetch needed. */
export interface EditableJwlibraryNote {
  id: string;
  title: string;
  content: string;
}

/** A location already fully decided before the Vault opens — used when the user picked a paragraph while reading (see jwpub-reader.tsx's picking mode). Skips the location step entirely. */
export interface PrefilledJwlibraryLocation {
  blockType: number;
  blockIdentifier: number | null;
  location: JwlibraryLocation;
  /** Shown under the title so the user knows what they're annotating, e.g. "Organizados, cap. 5 §21". */
  label: string;
  /** Set when the user selected a specific span of text (not just clicked the paragraph) — lets them also pick a highlight color for it. */
  tokenRange?: { start: number; end: number };
  /** Pre-selects a highlight color chip — set when the user tapped a color directly in the reader's selection popup instead of opening the editor first and choosing one there. */
  initialColorIndex?: number;
  /** The raw selected text, for a preview only (not persisted) — lets the user confirm what they're about to highlight before picking a color. */
  selectedText?: string;
}

interface JwlibraryNoteEditorVaultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this note when set; otherwise creating a new one. */
  note?: EditableJwlibraryNote | null;
  prefilledLocation?: PrefilledJwlibraryLocation | null;
  /** Called after any successful create/update/delete so the caller can refresh its list. */
  onSaved: () => void;
}

type LocationMode = "publication" | "bible";
type SaveState = "idle" | "saving" | "saved" | "error";

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> salvando…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-success">
        <Check className="size-3" /> salvo
      </span>
    );
  }
  if (state === "error") {
    return <span className="text-[11.5px] text-destructive">falha ao salvar</span>;
  }
  return null;
}

const EMPTY_BIBLE_REF: BibleReferenceValue = { bookOrder: null, chapter: null, verse: null };

export function JwlibraryNoteEditorVault({
  open,
  onOpenChange,
  note,
  prefilledLocation,
  onSaved,
}: JwlibraryNoteEditorVaultProps) {
  const isEdit = !!note;
  const isPrefilled = !!prefilledLocation;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [mode, setMode] = useState<LocationMode>("publication");
  const [publications, setPublications] = useState<OwnPublication[]>([]);
  const [publicationId, setPublicationId] = useState("");
  const [bibleRef, setBibleRef] = useState<BibleReferenceValue>(EMPTY_BIBLE_REF);
  const [highlightColor, setHighlightColor] = useState<number | null>(null);

  const [tags, setTags] = useState<JwlibraryTagView[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [noteTagIds, setNoteTagIds] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  // Guards the one-time flush (below) of tags picked before a brand-new note existed.
  const flushedTagsRef = useRef(false);

  // Reset every field the moment the Vault (re-)opens for a specific
  // note/target — done during render (React's documented pattern for
  // resetting state on a prop change), same as tag-picker-vault.tsx's
  // wasOpen guard, so switching between "edit note A" → "edit note B"
  // doesn't leak the previous note's draft.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTitle(note?.title ?? "");
      setContent(note?.content ?? "");
      setCreatedId(note?.id ?? null);
      setSaveState("idle");
      setMode("publication");
      setPublicationId("");
      setBibleRef(EMPTY_BIBLE_REF);
      setHighlightColor(prefilledLocation?.initialColorIndex ?? null);
      setNoteTagIds([]);
      setTagQuery("");
    }
  }

  // Resets the one-time tag-flush guard whenever the vault opens — done in an
  // effect (not the render-time reset block above) since refs shouldn't be
  // written during render.
  useEffect(() => {
    if (open) flushedTagsRef.current = false;
  }, [open]);

  useEffect(() => {
    if (open && !isEdit && !isPrefilled) {
      void listOwnPublications().then((result) => setPublications(result.publications ?? []));
    }
  }, [open, isEdit, isPrefilled]);

  // The tag *list* doesn't depend on this note existing — fetched as soon as
  // the vault opens so the row (or its skeleton, while this is in flight)
  // shows immediately, even before the note has ever been saved.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setTagsLoading(true);
    });
    void listOwnJwlibraryTags().then((result) => {
      if (cancelled) return;
      setTags(result.tags ?? []);
      setTagsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // This note's own *assigned* tags only exist server-side once it's been
  // saved — only relevant when editing a note that already existed. A
  // brand-new note's selection lives purely in local state (staged) until
  // its first autosave, then gets flushed to the server just below.
  useEffect(() => {
    if (!open || !isEdit || !note) return;
    void getJwlibraryNoteTagIds(note.id).then((result) => setNoteTagIds(result.tagIds ?? []));
  }, [open, isEdit, note]);

  // Flushes any tags picked before the note existed, the moment its first
  // autosave creates it.
  useEffect(() => {
    if (!createdId || isEdit || flushedTagsRef.current) return;
    flushedTagsRef.current = true;
    for (const tagId of noteTagIds) {
      void addTagToJwlibraryNote(createdId, tagId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush once with whatever was staged at that moment, not on every noteTagIds change
  }, [createdId, isEdit]);

  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => (t.name ?? "").toLowerCase().includes(q));
  }, [tags, tagQuery]);

  // A tag can be picked before the note has ever been saved — staged locally
  // and flushed to the server by the effect above once the first autosave
  // creates it. Once `createdId` exists, toggles apply immediately as before.
  function toggleNoteTag(tagId: string) {
    const wasActive = noteTagIds.includes(tagId);
    setNoteTagIds((prev) => (wasActive ? prev.filter((t) => t !== tagId) : [...prev, tagId]));
    if (!createdId) return;
    if (wasActive) void removeTagFromJwlibraryNote(createdId, tagId);
    else void addTagToJwlibraryNote(createdId, tagId);
  }

  async function handleCreateAndAssignTag() {
    const name = tagQuery.trim();
    if (!name) return;
    const result = await createJwlibraryTag(name);
    if (!result.id) return;
    setTagQuery("");
    const refreshed = await listOwnJwlibraryTags();
    setTags(refreshed.tags ?? []);
    const tagId = result.id;
    setNoteTagIds((prev) => [...prev, tagId]);
    if (createdId) void addTagToJwlibraryNote(createdId, tagId);
  }

  const locationReady =
    isEdit ||
    isPrefilled ||
    (mode === "publication"
      ? publicationId !== ""
      : bibleRef.bookOrder !== null && bibleRef.chapter !== null && bibleRef.verse !== null);

  function buildCreateInput(): CreateJwlibraryNoteInput | null {
    if (prefilledLocation) {
      return {
        title,
        content,
        blockType: prefilledLocation.blockType,
        blockIdentifier: prefilledLocation.blockIdentifier,
        location: prefilledLocation.location,
        highlight:
          prefilledLocation.tokenRange && highlightColor !== null
            ? {
                colorIndex: highlightColor,
                startToken: prefilledLocation.tokenRange.start,
                endToken: prefilledLocation.tokenRange.end,
              }
            : null,
      };
    }
    if (mode === "publication") {
      const pub = publications.find((p) => p.id === publicationId);
      if (!pub) return null;
      return {
        title,
        content,
        blockType: 0,
        blockIdentifier: null,
        location: {
          bookNumber: null,
          chapterNumber: null,
          keySymbol: pub.symbol,
          mepsLanguage: pub.mepsLanguageIndex,
          issueTagNumber: pub.issueTagNumber,
          mepsDocumentId: null,
          track: null,
          locationType: 1,
        },
      };
    }
    if (bibleRef.bookOrder === null || bibleRef.chapter === null || bibleRef.verse === null) return null;
    return {
      title,
      content,
      blockType: 2,
      blockIdentifier: bibleRef.verse,
      location: {
        bookNumber: bibleRef.bookOrder,
        chapterNumber: bibleRef.chapter,
        keySymbol: null,
        mepsLanguage: null,
        issueTagNumber: null,
        mepsDocumentId: null,
        track: null,
        locationType: 0,
      },
    };
  }

  // Debounced autosave — same 600ms shape as note-editor.tsx's, just calling
  // server actions directly (awaited inside the timeout) instead of a
  // local-first store, since these notes have no offline outbox behind them.
  useEffect(() => {
    if (!open || !locationReady) return;
    if (!title.trim() && !content.trim()) return;

    const timer = setTimeout(async () => {
      setSaveState("saving");
      if (createdId) {
        const result = await updateJwlibraryNote(createdId, { title, content });
        setSaveState(result.error ? "error" : "saved");
        if (!result.error) onSaved();
      } else {
        const input = buildCreateInput();
        if (!input) return;
        const result = await createJwlibraryNote(input);
        if (result.id) {
          setCreatedId(result.id);
          setSaveState("saved");
          onSaved();
        } else {
          setSaveState("error");
        }
      }
    }, 600);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildCreateInput closes over mode/publicationId/bibleRef/highlightColor, already listed below
  }, [title, content, createdId, locationReady, open, mode, publicationId, bibleRef, highlightColor]);

  async function handleDelete() {
    if (!note) return;
    await deleteJwlibraryNote(note.id);
    setConfirmDeleteOpen(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <>
      <Vault open={open} onOpenChange={onOpenChange}>
        <VaultContent aria-label={isEdit ? "Editar nota" : "Nova nota"}>
          <VaultHeader showCloseButton={false}>
            <VaultTitle>{isEdit ? "Editar nota" : "Nova nota"}</VaultTitle>
            {isPrefilled && <VaultDescription>{prefilledLocation.label}</VaultDescription>}
          </VaultHeader>
          <VaultBody>
            {isPrefilled && prefilledLocation.tokenRange && prefilledLocation.selectedText && (
              <blockquote className="line-clamp-3 rounded-xl border-l-2 border-accent/50 bg-secondary/50 px-3 py-2 text-[13px] italic leading-relaxed text-muted-foreground">
                “{prefilledLocation.selectedText}”
              </blockquote>
            )}
            {!isEdit && !isPrefilled && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Button
                    variant={mode === "publication" ? "default" : "outline"}
                    size="sm"
                    fullWidth
                    onClick={() => setMode("publication")}
                  >
                    Publicação
                  </Button>
                  <Button
                    variant={mode === "bible" ? "default" : "outline"}
                    size="sm"
                    fullWidth
                    onClick={() => setMode("bible")}
                  >
                    Versículo bíblico
                  </Button>
                </div>

                {mode === "publication" ? (
                  <Select value={publicationId} onValueChange={setPublicationId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha uma publicação" />
                    </SelectTrigger>
                    <SelectContent>
                      {publications.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <BibleReferencePicker value={bibleRef} onChange={setBibleRef} />
                )}
              </div>
            )}

            {locationReady ? (
              <div className={cn("flex flex-col gap-2.5", !isEdit && !isPrefilled && "mt-3")}>
                <div className="flex items-center gap-2">
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Título"
                    aria-label="Título da nota"
                    className="flex-1"
                  />
                  {isPrefilled && prefilledLocation.tokenRange && (
                    <Select
                      value={highlightColor !== null ? String(highlightColor) : "none"}
                      onValueChange={(v) => setHighlightColor(v === "none" ? null : Number(v))}
                    >
                      <SelectTrigger className="w-36 shrink-0" aria-label="Cor do destaque">
                        <SelectValue placeholder="Destacar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem destaque</SelectItem>
                        {Object.entries(JWLIBRARY_HIGHLIGHT_COLORS).map(([index, color]) => (
                          <SelectItem key={index} value={index}>
                            <span className="flex items-center gap-2">
                              <span
                                className="size-3 shrink-0 rounded-full"
                                style={{ backgroundColor: color.hex }}
                              />
                              {color.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <RichTextEditor content={content} onChange={setContent} placeholder="Escreva sua nota…" />

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] text-muted-foreground">Tags</span>
                  <div className="flex items-center gap-2">
                    <div className="relative w-28 shrink-0">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={tagQuery}
                        onChange={(e) => setTagQuery(e.target.value)}
                        placeholder="Buscar"
                        className="h-8 pl-8 pr-2 text-[12px]"
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                      {tagsLoading ? (
                        <>
                          <Skeleton className="h-8 w-16 shrink-0 rounded-full" />
                          <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
                          <Skeleton className="h-8 w-14 shrink-0 rounded-full" />
                        </>
                      ) : (
                        <>
                          {filteredTags.map((tag) => (
                            <span key={tag.id} className="shrink-0">
                              <JwlibraryTagChip
                                tag={tag}
                                active={noteTagIds.includes(tag.id)}
                                onClick={() => toggleNoteTag(tag.id)}
                              />
                            </span>
                          ))}
                          {tagQuery.trim() !== "" && filteredTags.length === 0 && (
                            <button
                              type="button"
                              onClick={() => void handleCreateAndAssignTag()}
                              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-accent/50 px-2.5 text-[12px] text-accent transition-colors hover:bg-accent/10"
                            >
                              <Plus className="size-3" />
                              Criar &quot;{tagQuery.trim()}&quot;
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <SaveIndicator state={saveState} />
                  {isEdit && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteOpen(true)}
                      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />
                      Excluir
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                Escolha onde essa nota se conecta pra continuar.
              </p>
            )}
          </VaultBody>
        </VaultContent>
      </Vault>

      {isEdit && (
        <ConfirmVault
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          title="Excluir nota?"
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir"
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}
