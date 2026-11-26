"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, AudioLines, FileDown, ImagePlus, Lock, Maximize2, Minimize2, PenLine, Pin, Search, Share, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { HistoryVaultButton } from "@/components/layout/history-vault-button";
import { SyncStatusIndicator } from "@/components/content/sync-status";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/content/rich-text-editor";
import { NoteReferenceSurface } from "@/components/content/note-reference-surface";
import { RsvpButton } from "@/components/content/rsvp-button";
import { DrawingCanvas } from "@/components/content/drawing-canvas";
import { DrawingToolbar } from "@/components/content/drawing-toolbar";
import { AudioRecordControl } from "@/components/content/audio-record-control";
import { NoteAudioPlayer, NoteTranscriptPanel } from "@/components/content/note-audio-player";
import { useNotesStore } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { useNavigationHistoryStore } from "@/lib/store/navigation-history-store";
import { bodyToPlainText } from "@/lib/note-preview";
import { shareFile, shareNote } from "@/lib/share";
import { useHydrated } from "@/components/providers/store-hydration";
import { useAudioRecorder, type Recording } from "@/hooks/use-audio-recorder";
import { createClient } from "@/lib/supabase/client";
import { NOTE_AUDIO_BUCKET } from "@/lib/storage-config";
import {
  HIGHLIGHTER_SIZE,
  INK_COLORS,
  PAGE_WIDTH,
  PEN_SIZES,
  lowestInkY,
  parseDoc,
  serializeDoc,
  type DrawTool,
  type Stroke,
} from "@/lib/drawing/strokes";
import {
  deleteDrawingAudio,
  finalizeAudioUpload,
  getAudioUrl,
  requestAudioUploadSlot,
  transcribeNoteAudio,
  type DrawingRow,
} from "@/app/(app)/drawing-actions";
import { listPublicationSymbols } from "@/app/(app)/jwpub-actions";
import { listGlobalPublicationSymbols } from "@/app/(app)/global-publications-actions";
import type { NoteOption, PublicationOption } from "@/lib/notes/reference-suggestions";
import type { NoteReference } from "@/lib/notes/note-reference";
import type * as Y from "yjs";
import { useCollabDoc, COLLAB_TITLE_FIELD } from "@/lib/collab/use-collab-doc";
import { useSharedStore } from "@/lib/store/shared-store";
import { ownSharedNoteIds } from "@/lib/collab/shared-ids";
import { lockedNoteIds } from "@/lib/lock/locked";
import { ShareVault } from "@/components/content/share-vault";
import { createNoteInSharedFolder } from "@/app/(app)/shares-actions";
import { setSharedReferenceContext } from "@/lib/notes/reference-resolver";

/** Applies a new title string to a Y.Text as the smallest edit (common prefix/suffix kept), so two people typing in the title don't clobber each other. */
function replaceYText(ytext: Y.Text, next: string) {
  const prev = ytext.toString();
  if (prev === next) return;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  const apply = () => {
    if (endPrev > start) ytext.delete(start, endPrev - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  };
  if (ytext.doc) ytext.doc.transact(apply);
  else apply();
}

interface NoteEditorProps {
  /** Existing note id, or undefined for a brand-new note. */
  noteId?: string;
  initialNote?: {
    id: string;
    title: string;
    body: string;
  } | null;
  /** The note's handwriting layer and voice recording, if it has either. */
  initialDrawing?: DrawingRow | null;
  /**
   * Overrides the "Voltar" button's navigation. Used by OfflineNoteView (the
   * Service Worker's fallback body for a failed /notes/[id] navigation — see
   * app/sw.ts): that page's embedded route tree is /notes-offline's own, not
   * /notes/[id]'s, so a Next `router.push` from there would navigate against
   * a mismatched client router state. A real `window.location` assignment
   * (full reload) sidesteps that entirely.
   */
  onBack?: () => void;
}

export function NoteEditor({ noteId, initialNote, initialDrawing, onBack }: NoteEditorProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  // Read client-side (not as server searchParams) so /notes/new stays a
  // static shell — see the comment on that page.
  const searchParams = useSearchParams();
  const initialBody = noteId ? "" : searchParams.get("q") ?? "";
  const folderId = noteId ? undefined : searchParams.get("folder") ?? undefined;
  // Same `?text=` convention chat-message.tsx already sends jwpub notes to
  // (see JwpubChapterView's own highlight effect) — reused here so a note
  // opened from a search result (see notes-collection.tsx) or a chat source
  // jumps straight to where the term appears instead of just opening at the top.
  const highlight = searchParams.get("text");

  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const togglePin = useNotesStore((s) => s.togglePin);
  const fullscreen = useFullscreen();
  const saveDrawingStrokes = useNotesStore((s) => s.saveDrawingStrokes);

  const existing = noteId ? (notes.find((n) => n.id === noteId) ?? initialNote) : undefined;

  const effectiveTitle =
    existing?.title && existing.title.trim().length > 0
      ? existing.title
      : initialNote?.title && initialNote.title.trim().length > 0
      ? initialNote.title
      : "";

  const effectiveBody =
    existing?.body && existing.body.trim().length > 0
      ? existing.body
      : initialNote?.body && initialNote.body.trim().length > 0
      ? initialNote.body
      : initialBody;

  const [title, setTitle] = useState(effectiveTitle);
  const [body, setBody] = useState(effectiveBody);
  // Once a new note is persisted we keep writing to that same id.
  const [createdId, setCreatedId] = useState<string | null>(noteId ?? null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  // ── Sharing / real-time collaboration ────────────────────────────────────
  // A shared note (by this user, or with them) is edited through a Yjs
  // document synced over Supabase Realtime — see lib/collab/. Everything else
  // keeps the ordinary offline-first path below, untouched.
  const folders = useNotesStore((s) => s.folders);
  const sharedHydrated = useSharedStore((s) => s.hydrated);
  const collabRoles = useSharedStore((s) => s.collabRoles);
  const outgoingNoteIds = useSharedStore((s) => s.outgoingNoteIds);
  const outgoingFolderIds = useSharedStore((s) => s.outgoingFolderIds);
  const lockedSet = useMemo(() => lockedNoteIds(notes, folders), [notes, folders]);
  const ownShared = useMemo(
    () =>
      createdId
        ? ownSharedNoteIds(notes, folders, outgoingNoteIds, outgoingFolderIds, lockedSet).has(createdId)
        : false,
    [createdId, notes, folders, outgoingNoteIds, outgoingFolderIds, lockedSet]
  );
  const knownShared = !!createdId && (createdId in collabRoles || ownShared);
  // A note born in this editor never switches to collaborative mode under the
  // user's fingers (the server may not even have it yet) — only sharing it from
  // here does. It opens collaboratively the next time.
  const [sharedFromHere, setSharedFromHere] = useState(false);
  const collab = useCollabDoc(noteId || sharedFromHere ? (createdId ?? undefined) : undefined, { knownShared });
  // While the server check is in flight, an existing note that MIGHT be shared
  // shows the skeleton rather than the ordinary editor — which would open
  // empty (or with a stale copy) and then visibly swap. "Might": the shared
  // lists haven't been read back from this device yet, or the note isn't one
  // of the user's own (so it can only be someone else's, shared with them).
  // A note of the user's own that isn't known to be shared opens instantly.
  const maybeShared =
    knownShared ||
    (!!noteId && (!sharedHydrated || (hydrated && !notes.some((n) => n.id === noteId))));
  const inCollab =
    collab.status === "loading" ||
    collab.status === "ready" ||
    collab.status === "revoked" ||
    collab.status === "unavailable" ||
    (collab.status === "checking" && maybeShared);
  const collabReady = collab.status === "ready" && !!collab.doc && !!collab.provider;
  const isOwner = !inCollab || collab.role === "owner";
  const canWrite = !inCollab || collab.role === "owner" || collab.role === "editor";
  const [shareOpen, setShareOpen] = useState(false);
  const applyCollabSnapshot = useNotesStore((s) => s.applyCollabSnapshot);

  // ── New note inside a shared folder ──────────────────────────────────────
  // Created up front and then opened as an ordinary shared note, so it is
  // collaborative from its first keystroke. In someone else's folder it must
  // belong to the folder's owner (that's what puts it in the shared tree), so
  // the server creates it.
  const sharedFolders = useSharedStore((s) => s.folders);
  const sharedTargetFolder = folderId ? sharedFolders.find((f) => f.id === folderId) : undefined;
  const ownFolderId = folderId && !sharedTargetFolder ? folderId : undefined;
  // Not known yet whether `folder` is the user's own or a shared one: wait.
  const folderUnresolved =
    !!folderId && !sharedTargetFolder && (!sharedHydrated || !hydrated) && !folders.some((f) => f.id === folderId);
  // The user's own folder that is shared (itself or through a folder above it).
  const inOwnSharedFolder = useMemo(() => {
    const parentOf = new Map(folders.map((f) => [f.id, f.parentId ?? null]));
    const seen = new Set<string>();
    let cursor: string | null = ownFolderId ?? null;
    while (cursor && !seen.has(cursor)) {
      if (outgoingFolderIds.includes(cursor)) return true;
      seen.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    return false;
  }, [ownFolderId, folders, outgoingFolderIds]);
  const [creatingOwnShared, setCreatingOwnShared] = useState(false);
  const creatingInShared =
    !noteId && (sharedTargetFolder?.role === "editor" || folderUnresolved || creatingOwnShared);
  const sharedCreateStarted = useRef(false);
  useEffect(() => {
    if (noteId || !folderId || sharedTargetFolder?.role !== "editor" || sharedCreateStarted.current) return;
    sharedCreateStarted.current = true;
    const id = crypto.randomUUID();
    const draft = initialBody
      ? "<p>" + initialBody.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>"
      : "";
    createNoteInSharedFolder({ id, folderId, title: "", body: draft })
      .then((res) => {
        if (res.error) {
          notify.error("Não foi possível criar a nota", res.error);
          router.replace("/notes");
          return;
        }
        void useSharedStore.getState().refresh();
        router.replace("/notes/" + id + "?new=1");
      })
      .catch(() => {
        notify.error("Sem conexão", "Notas em pastas compartilhadas só podem ser criadas online.");
        router.replace("/notes");
      });
  }, [noteId, folderId, sharedTargetFolder?.role, initialBody, router]);

  useEffect(() => {
    if (noteId || createdId || !hydrated || !inOwnSharedFolder || sharedCreateStarted.current) return;
    // Already typing (the share list arrived late): leave the note where it is.
    if (title.trim() || body !== initialBody) return;
    sharedCreateStarted.current = true;
    const draft = initialBody
      ? "<p>" + initialBody.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>"
      : "";
    queueMicrotask(() => setCreatingOwnShared(true));
    const id = addNote({ title: "Nova nota", body: draft, folderId: ownFolderId });

    // Wait for the server to have it before opening it as a shared note. If it
    // can't be reached, keep editing right here, the ordinary offline way.
    const settle = () => {
      const state = useNotesStore.getState();
      const note = state.notes.find((n) => n.id === id);
      const queued = Object.values(state.pendingOps).some((op) => op.entityId === id);
      if (note && note.syncStatus !== "synced" && !queued) return false;
      if (!note) {
        // The server refused it (the store already said so).
        router.replace("/notes");
      } else if (note.syncStatus === "synced") {
        router.replace("/notes/" + id + "?new=1");
      } else {
        setCreatedId(id);
        setCreatingOwnShared(false);
        window.history.replaceState(null, "", `/notes/${id}`);
      }
      return true;
    };
    // Deliberately not torn down by the effect: it unsubscribes itself once.
    const unsubscribe = useNotesStore.subscribe(() => {
      if (settle()) unsubscribe();
    });
  }, [noteId, createdId, hydrated, inOwnSharedFolder, title, body, initialBody, ownFolderId, addNote, router]);

  // "@" note-linking candidates — plain notes only (not files/publications),
  // excludes this note itself so it can't reference its own text, and reads
  // straight from the already-hydrated store rather than a server round trip
  // (the whole point of the offline-first store is that every note the user
  // owns is already sitting in memory).
  const noteMentionOptions: NoteOption[] = useMemo(
    () =>
      notes
        .filter((n) => n.type === "nota" && n.status === "active" && n.id !== createdId && n.title.trim())
        .map((n) => ({ id: n.id, title: n.title })),
    [notes, createdId]
  );

  // ── Handwriting layer ─────────────────────────────────────────────────────
  // Any note can carry ink over its text — there is no separate "drawing note"
  // type, the same way Samsung Notes lets one page hold both.
  const [penMode, setPenMode] = useState(false);
  // In fullscreen the bars tuck away on scrolling down and return on scrolling up; while writing they stay put.
  const barsHidden = useHideOnScroll(fullscreen.isFullscreen && !penMode);
  const [strokes, setStrokes] = useState<Stroke[]>(() => parseDoc(initialDrawing?.strokes).strokes);
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[0]);
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[1]);
  const [clearInkOpen, setClearInkOpen] = useState(false);
  const inkDirtyRef = useRef(false);
  const penOnly = usePreferencesStore((s) => s.penOnly);
  const setPenOnly = usePreferencesStore((s) => s.setPenOnly);

  // The ink layer must stay tall enough to hold every stroke even if the text
  // under it later shrinks — otherwise handwriting past the new bottom is
  // clipped, and can't be erased because it no longer has a surface.
  const inkWrapRef = useRef<HTMLDivElement>(null);
  const [inkWrapWidth, setInkWrapWidth] = useState(0);
  useEffect(() => {
    const wrap = inkWrapRef.current;
    if (!wrap) return;
    // Width only, never height. The text column inside stretches to this
    // element, so sizing this element from a measurement of that one is a
    // feedback loop: the note grew without bound, scrolled by itself and took
    // the browser down with it. Height must come from things layout can't
    // change — here, the strokes themselves.
    const observer = new ResizeObserver(() => setInkWrapWidth(wrap.getBoundingClientRect().width));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /**
   * Room to keep writing. Rather than Samsung Notes' drag-to-add-a-page
   * gesture, the note keeps a screenful of blank space below its lowest
   * content while the pen is out — so writing toward the bottom extends the
   * page by itself and there's no page boundary to manage. Two independent,
   * non-circular pieces: this minimum keeps space under the lowest *stroke*,
   * and the spacer at the end of the text column keeps space under the
   * *text*. Both collapse when the pen is put away, so a typed note is never
   * padded with emptiness.
   */
  const inkBottom = inkWrapWidth > 0 ? (lowestInkY(strokes) + 40) * (inkWrapWidth / PAGE_WIDTH) : 0;
  const inkMinHeight = penMode ? `calc(${inkBottom}px + 60svh)` : `${inkBottom}px`;

  // ── Voice recording ───────────────────────────────────────────────────────
  const recorder = useAudioRecorder();
  const [audioPath, setAudioPath] = useState<string | null>(initialDrawing?.audioPath ?? null);
  const [audioDurationMs, setAudioDurationMs] = useState(initialDrawing?.audioDurationMs ?? 0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [pendingUpload, setPendingUpload] = useState(false);
  const pendingRecordingRef = useRef<Recording | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Covers the whole stop → upload round trip, not just MediaRecorder's own
  // stop, so the toolbar can say the recording actually landed.
  const [audioSaveState, setAudioSaveState] = useState<"idle" | "saving" | "saved">("idle");
  /** Whether the player is on screen while typing — in pen mode it's always in the toolbar instead. */
  const [audioOpen, setAudioOpen] = useState(false);

  // Baseline to diff autosaves against, for an EXISTING note only — `null`
  // for a brand-new one, so its very first save still goes through
  // unconditionally (see the autosave effect below) whether or not the user
  // has typed anything beyond an initial `?q=` draft.
  const lastSaved = useRef<{ title: string; body: string } | null>(
    noteId ? { title: effectiveTitle, body: effectiveBody } : null
  );

  // Logged to the header's history Vault — only for an EXISTING note (not
  // the still-unsaved /notes/new draft). Keyed on the title text itself
  // (not the `existing` object, which gets a new identity every render off
  // `notes.find(...)`) so this only re-fires when the title actually changes.
  const recordHistoryVisit = useNavigationHistoryStore((s) => s.recordVisit);
  const existingTitle = existing?.title;
  useEffect(() => {
    if (!noteId || existingTitle === undefined) return;
    recordHistoryVisit({
      id: noteId,
      type: "note",
      title: existingTitle.trim() || "Nota sem título",
      href: `/notes/${noteId}`,
    });
  }, [noteId, existingTitle, recordHistoryVisit]);

  // The user's .jwpub library, for in-note references: it decides whether a
  // typed "(th 2)" is a real reference and it populates the "/" menu. Fetched
  // once here rather than per keystroke — a note is edited far more often
  // than the library changes.
  const [publications, setPublications] = useState<PublicationOption[]>([]);
  const [openReference, setOpenReference] = useState<NoteReference | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listPublicationSymbols(), listGlobalPublicationSymbols()]).then(
      ([own, global]) => {
        if (cancelled) return;
        // Own entries win on a symbol collision — they're what the user
        // actually has open in their own library, so "(th 2)" should resolve
        // there even if a shared copy also exists.
        const ownSymbols = new Set(own.publications.map((p) => p.symbol));
        const merged = [
          ...own.publications,
          ...global.publications.filter((p) => !ownSymbols.has(p.symbol)),
        ];
        setPublications(merged);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Read through refs so `ensureNote` keeps a stable identity while the user
  // types — otherwise every keystroke re-creates it and restarts the ink
  // save debounce that depends on it.
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  useEffect(() => {
    titleRef.current = title;
    bodyRef.current = body;
  }, [title, body]);

  /**
   * Creates the note row on first use — by typing, by drawing, or by hitting
   * record — so every one of those paths lands on the same single note instead
   * of racing each other into two.
   */
  const ensureNote = useCallback(
    (seed?: { title?: string; body?: string }) => {
      if (createdId) return createdId;
      const id = addNote({
        title: (seed?.title ?? titleRef.current).trim() || "Nova nota",
        body: seed?.body ?? bodyRef.current,
        folderId: ownFolderId,
      });
      setCreatedId(id);
      // Not router.replace(): that navigates from the /notes/new route tree
      // to /notes/[id], which remounts this whole component (replaying the
      // entrance animation and dropping focus — the "flicker"). A plain
      // history update keeps this same instance alive and just relabels
      // the URL bar, since nothing here actually depends on route params.
      window.history.replaceState(null, "", `/notes/${id}`);
      return id;
    },
    [createdId, addNote, ownFolderId]
  );

  // Debounced autosave. Guarded against re-saving content that's identical
  // to what was already loaded/persisted — merely opening an existing note
  // was re-triggering this (once `hydrated` flips true, `title`/`body`
  // change as dependencies even though nothing in them actually changed),
  // which through updateNoteRow unconditionally re-queues the note for
  // vectorization (a real OpenAI embedding call) on every open, not just
  // every real edit.
  useEffect(() => {
    if (!hydrated) return;
    // A shared note persists through its collaborative document instead, and
    // one being created in a shared folder already has its row on the way.
    if (inCollab || creatingInShared) return;
    if (!title.trim() && !body.trim()) return;
    if (lastSaved.current && title === lastSaved.current.title && body === lastSaved.current.body) return;

    const timer = setTimeout(() => {
      lastSaved.current = { title, body };
      if (createdId) updateNote(createdId, { title: title.trim() || "Nova nota", body });
      else ensureNote({ title, body });
    }, 600);

    return () => clearTimeout(timer);
  }, [title, body, hydrated, ensureNote, updateNote, createdId, inCollab, creatingInShared]);

  // Collaborative title: lives in the same Yjs doc as the text, so it syncs live.
  const collabDoc = collab.doc;
  useEffect(() => {
    if (!collabReady || !collabDoc) return;
    const ytitle = collabDoc.getText(COLLAB_TITLE_FIELD);
    const sync = () => setTitle(ytitle.toString());
    sync();
    ytitle.observe(sync);
    return () => ytitle.unobserve(sync);
  }, [collabReady, collabDoc]);

  // References in a note shared WITH the user point at the owner's library;
  // the resolver asks for them through this note (server-checked).
  useEffect(() => {
    if (!collabReady || !createdId || collab.role === "owner") return;
    setSharedReferenceContext(createdId);
    return () => setSharedReferenceContext(null);
  }, [collabReady, createdId, collab.role]);

  // The owner's own card (preview, search) mirrors the shared text locally.
  useEffect(() => {
    if (!collabReady || collab.role !== "owner" || !createdId) return;
    const timer = setTimeout(() => applyCollabSnapshot(createdId, { title: title.trim() || "Nova nota", body }), 800);
    return () => clearTimeout(timer);
  }, [collabReady, collab.role, createdId, title, body, applyCollabSnapshot]);

  function changeTitle(next: string) {
    if (collabReady && collabDoc) {
      if (canWrite) replaceYText(collabDoc.getText(COLLAB_TITLE_FIELD), next);
      return;
    }
    setTitle(next);
  }

  // Ink is saved on its own debounce — a stroke is a bigger, less frequent
  // change than a keystroke, and it goes to `note_drawings`, not `notes.body`.
  useEffect(() => {
    if (!hydrated || !inkDirtyRef.current) return;
    const timer = setTimeout(() => {
      const id = ensureNote();
      saveDrawingStrokes(id, serializeDoc({ version: 1, strokes }));
      inkDirtyRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, [strokes, hydrated, ensureNote, saveDrawingStrokes]);

  // Jumps to (and selects, so it's visually highlighted) the first
  // occurrence of the search term once the editor has real content to search —
  // `body` only carries the note's actual text once the store has hydrated,
  // so this keeps retrying (cheaply — it's just a doc walk) until that lands
  // instead of firing once too early and silently finding nothing. Left in
  // the URL afterward rather than stripped, matching JwpubChapterView's own
  // `?text=` handling — reloading the same link re-highlights the same spot.
  const highlightApplied = useRef(false);
  useEffect(() => {
    if (!highlight || highlightApplied.current || !body) return;

    // `body` being non-empty doesn't guarantee the Tiptap editor itself has
    // finished mounting yet — RichTextEditor's own `useEditor` returns null
    // for a render or two (`immediatelyRender: false`), and this effect only
    // re-fires when `highlight`/`body` change, neither of which happens again
    // once the note is loaded. So poll briefly instead of trying once.
    const target = highlight;
    let cancelled = false;
    let attempts = 0;
    function attempt() {
      if (cancelled) return;
      if (editorRef.current?.scrollToText(target)) {
        highlightApplied.current = true;
        return;
      }
      attempts += 1;
      if (attempts < 20) setTimeout(attempt, 150);
    }
    attempt();
    return () => {
      cancelled = true;
    };
  }, [highlight, body]);

  // ── Ink editing ───────────────────────────────────────────────────────────
  const pushInkHistory = useCallback((previous: Stroke[]) => {
    // 40 steps is plenty for a page of handwriting and keeps the snapshots
    // (whole stroke arrays) from growing without bound.
    setPast((stack) => [...stack.slice(-39), previous]);
    setFuture([]);
    inkDirtyRef.current = true;
  }, []);

  const commitStroke = useCallback(
    (stroke: Stroke) => {
      setStrokes((previous) => {
        pushInkHistory(previous);
        return [...previous, stroke];
      });
    },
    [pushInkHistory]
  );

  const eraseStrokes = useCallback(
    (ids: string[], startsGesture: boolean) => {
      setStrokes((previous) => {
        const remaining = previous.filter((s) => !ids.includes(s.id));
        if (remaining.length === previous.length) return previous;
        // One sweep of the eraser is one undo step: only the first hit of the
        // drag snapshots, the rest just keep removing.
        if (startsGesture) pushInkHistory(previous);
        else inkDirtyRef.current = true;
        return remaining;
      });
    },
    [pushInkHistory]
  );

  function undoInk() {
    setPast((stack) => {
      if (stack.length === 0) return stack;
      setFuture((f) => [strokes, ...f]);
      setStrokes(stack[stack.length - 1]);
      inkDirtyRef.current = true;
      return stack.slice(0, -1);
    });
  }

  function redoInk() {
    setFuture((stack) => {
      if (stack.length === 0) return stack;
      setPast((p) => [...p, strokes]);
      setStrokes(stack[0]);
      inkDirtyRef.current = true;
      return stack.slice(1);
    });
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  async function uploadRecording(recording: Recording) {
    const id = ensureNote();
    const slot = await requestAudioUploadSlot(id, recording.extension);
    if (slot.error || !slot.storagePath || !slot.token) {
      pendingRecordingRef.current = recording;
      setPendingUpload(true);
      notify.error("Não foi possível enviar a gravação", slot.error);
      return;
    }

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(NOTE_AUDIO_BUCKET)
      .uploadToSignedUrl(slot.storagePath, slot.token, recording.blob, {
        contentType: recording.blob.type,
      });
    if (uploadError) {
      pendingRecordingRef.current = recording;
      setPendingUpload(true);
      notify.error("Não foi possível enviar a gravação");
      return;
    }

    const result = await finalizeAudioUpload(id, slot.storagePath, recording.durationMs);
    if (result.error) {
      pendingRecordingRef.current = recording;
      setPendingUpload(true);
      notify.error("Não foi possível salvar a gravação", result.error);
      return;
    }

    pendingRecordingRef.current = null;
    setPendingUpload(false);
    setAudioPath(slot.storagePath);
    setAudioDurationMs(recording.durationMs);
    setAudioUrl(URL.createObjectURL(recording.blob));
  }

  async function startRecording() {
    // The row must exist before Storage can accept a path under its id.
    ensureNote();
    const result = await recorder.start();
    if (result.error) notify.error("Gravação indisponível", result.error);
  }

  async function stopRecording() {
    const recording = await recorder.stop();
    if (!recording) return;
    setAudioSaveState("saving");
    await uploadRecording(recording);
    // A tick of explicit confirmation before the toolbar goes back to normal —
    // otherwise the timer just disappears and it's not obvious it worked.
    setAudioSaveState(pendingRecordingRef.current ? "idle" : "saved");
  }

  useEffect(() => {
    if (audioSaveState !== "saved") return;
    const timer = setTimeout(() => setAudioSaveState("idle"), 2200);
    return () => clearTimeout(timer);
  }, [audioSaveState]);

  function retryAudioUpload() {
    const recording = pendingRecordingRef.current;
    if (recording) void uploadRecording(recording);
  }

  const isRecordingNow = recorder.state === "recording" || recorder.state === "paused";

  /** Leaving mid-recording would drop the take on the floor — close it out first, then navigate. */
  async function leaveNote() {
    if (isRecordingNow) await stopRecording();
    if (onBack) onBack();
    else router.push("/notes");
  }

  // Reloading or closing the tab can't be awaited, so all this can do is ask.
  useEffect(() => {
    if (!isRecordingNow) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isRecordingNow]);

  // ── Playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!audioPath || audioUrl) return;
    let cancelled = false;
    void getAudioUrl(audioPath).then((res) => {
      if (!cancelled && res.url) setAudioUrl(res.url);
    });
    return () => {
      cancelled = true;
    };
  }, [audioPath, audioUrl]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setPositionMs(audio.currentTime * 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    // Replaying from the end would show nothing new — start over instead.
    if (positionMs >= audioDurationMs - 200) {
      audio.currentTime = 0;
      setPositionMs(0);
    }
    void audio.play().then(() => setIsPlaying(true));
  }

  function seek(ms: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    setPositionMs(ms);
  }

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(initialDrawing?.audioTranscript ?? null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  async function transcribeAudioToNote() {
    if (!createdId || isTranscribing) return;
    setIsTranscribing(true);
    const result = await transcribeNoteAudio(createdId);
    setIsTranscribing(false);
    if (result.error || !result.text) {
      notify.error("Não foi possível transcrever", result.error ?? "Tente novamente.");
      return;
    }
    setTranscript(result.text);
    setTranscriptOpen(true);
  }

  const [exportingPdf, setExportingPdf] = useState(false);
  async function exportPdf() {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const { noteToPdfFile } = await import("@/lib/note-pdf");
      const file = await noteToPdfFile(title.trim() || "Nova nota", body);
      const result = await shareFile(file, title.trim() || "Nota");
      if (result === "downloaded") notify.success("PDF gerado", "O arquivo foi baixado.");
    } catch {
      notify.error("Não foi possível gerar o PDF", "Tente novamente.");
    } finally {
      setExportingPdf(false);
    }
  }

  async function shareAudio() {
    if (!audioUrl) return;
    try {
      const blob = await (await fetch(audioUrl)).blob();
      const extension = audioPath?.endsWith(".mp4") ? "mp4" : "webm";
      const file = new File([blob], `${title.trim() || "gravacao"}.${extension}`, {
        type: blob.type || `audio/${extension}`,
      });
      const result = await shareFile(file, title.trim() || "Gravação");
      if (result === "downloaded") notify.success("Áudio baixado", "O arquivo foi salvo no dispositivo.");
    } catch {
      notify.error("Não foi possível compartilhar", "Falha ao carregar o áudio.");
    }
  }

  async function removeAudio() {
    if (!createdId) return;
    const result = await deleteDrawingAudio(createdId);
    if (result.error) {
      notify.error("Não foi possível remover", result.error);
      return;
    }
    audioRef.current?.pause();
    setIsPlaying(false);
    setPositionMs(0);
    setAudioPath(null);
    setAudioUrl(null);
    setAudioDurationMs(0);
    setTranscript(null);
    setTranscriptOpen(false);
  }

  // Playback rewinds the handwriting along with the audio; any other time the
  // full page is on screen (including strokes written outside a recording,
  // which carry no timeline position at all — see `Stroke.t`).
  const revealUntilMs = isPlaying || (audioPath !== null && positionMs > 0) ? positionMs : undefined;

  const current = createdId ? notes.find((n) => n.id === createdId) : undefined;
  const pinned = current?.pinned ?? false;

  return (
    // Row, not just the main column: the reference panel is a flex sibling
    // (same arrangement as JwpubReader), so opening it narrows the note
    // instead of floating over the text the user is writing.
    <div className="flex min-h-dvh w-full">
      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex min-w-0 flex-1 flex-col"
      >
        {/* Sticky, because in pen mode this carries the drawing toolbar —
            which has to stay reachable while writing down a long note. The
            player rides along in the same block so it never has to guess the
            header's height. */}
        <div
          className={cn(
            "sticky top-0 z-20 bg-background/85 backdrop-blur-md transition-transform duration-200",
            barsHidden ? "-translate-y-full" : "translate-y-0"
          )}
        >
          <header className="flex items-center gap-2 px-4 py-2 sm:px-6">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft />}
              onClick={() => void leaveNote()}
              className={cn("shrink-0", penMode && "max-sm:px-2")}
            >
              <span className={cn(penMode && "max-sm:hidden")}>Voltar</span>
            </Button>

            {penMode && (
              <DrawingToolbar
                className="min-w-0 flex-1"
                tool={tool}
                color={inkColor}
                size={tool === "highlighter" ? HIGHLIGHTER_SIZE : penSize}
                canUndo={past.length > 0}
                canRedo={future.length > 0}
                penOnly={penOnly}
                recorderState={recorder.state}
                recordingElapsedMs={recorder.elapsedMs}
                audioSaveState={audioSaveState}
                audioSlot={
                  audioPath !== null || pendingUpload ? (
                    <NoteAudioPlayer
                      embedded
                      isPlaying={isPlaying}
                      positionMs={positionMs}
                      durationMs={audioDurationMs}
                      pendingUpload={pendingUpload}
                      onTogglePlay={togglePlay}
                      onSeek={seek}
                      onRetryUpload={retryAudioUpload}
                      onDelete={() => void removeAudio()}
                      onTranscribe={() => void transcribeAudioToNote()}
                      onShare={() => void shareAudio()}
                      isTranscribing={isTranscribing}
                      hasTranscript={transcript !== null}
                      transcriptOpen={transcriptOpen}
                      onToggleTranscript={() => setTranscriptOpen((open) => !open)}
                    />
                  ) : undefined
                }
                onToolChange={setTool}
                onColorChange={setInkColor}
                onSizeChange={setPenSize}
                onUndo={undoInk}
                onRedo={redoInk}
                onClear={() => setClearInkOpen(true)}
                onPenOnlyChange={setPenOnly}
                onStartRecording={() => void startRecording()}
                onPauseRecording={recorder.pause}
                onResumeRecording={recorder.resume}
                onStopRecording={() => void stopRecording()}
              />
            )}

            {/* Out of pen mode there are too many buttons for a phone: this
                group scrolls sideways on its own (Voltar stays put) instead of
                widening the page. */}
            <div
              className={cn(
                "flex items-center gap-1 [&>*]:shrink-0",
                penMode
                  ? "shrink-0"
                  : "ml-auto min-w-0 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              )}
            >
              {/* Sharing and image insert belong to typing — while the pen is
                  out they'd only crowd the toolbar beside them. */}
              {!penMode && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await shareNote(title || "Nova nota", bodyToPlainText(body));
                      if (result === "copied") notify.success("Copiado", "O conteúdo da nota foi copiado.");
                    }}
                    aria-label="Compartilhar nota"
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Share className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportPdf()}
                    disabled={exportingPdf}
                    aria-label="Enviar nota como PDF"
                    title="Enviar como PDF"
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  >
                    <FileDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => editorRef.current?.openFind()}
                    aria-label="Buscar na nota"
                    title="Buscar na nota (Ctrl+Shift+F)"
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Search className="size-4" />
                  </button>
                  <RsvpButton title={title || "Nova nota"} html={body} />
                  {/* Shown at every width: this header has no avatar menu to move it into. */}
                  <HistoryVaultButton className="inline-flex size-9 shrink-0 rounded-full text-muted-foreground" />
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => editorRef.current?.openImagePicker()}
                      aria-label="Inserir imagem"
                      className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <ImagePlus className="size-4" />
                    </button>
                  )}
                  {/* Invite people to this note (owner only, once it exists). */}
                  {isOwner && createdId && (current?.type ?? "nota") === "nota" && (
                    <button
                      type="button"
                      onClick={() => setShareOpen(true)}
                      aria-label="Compartilhar com pessoas"
                      title="Compartilhar com pessoas"
                      className={cn(
                        "rounded-full p-2 transition-colors",
                        inCollab
                          ? "bg-primary/[0.18] text-accent"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      <Users className="size-4" />
                    </button>
                  )}
                  {/* Recording a voice note used to only be reachable from the
                      pen toolbar — it doesn't need the pen at all, so it's
                      available here too. Hidden once a recording already
                      exists (one slot per note; the AudioLines button below
                      plays it back, and recording a replacement means
                      deleting this one first from the player). */}
                  {isOwner && (isRecordingNow || audioSaveState !== "idle" || (audioPath === null && !pendingUpload)) && (
                    <AudioRecordControl
                      recorderState={recorder.state}
                      recordingElapsedMs={recorder.elapsedMs}
                      audioSaveState={audioSaveState}
                      onStartRecording={() => void startRecording()}
                      onPauseRecording={recorder.pause}
                      onResumeRecording={recorder.resume}
                      onStopRecording={() => void stopRecording()}
                    />
                  )}
                </>
              )}
              {isOwner && (
              <button
                type="button"
                onClick={() => setPenMode((on) => !on)}
                aria-label={penMode ? "Voltar a digitar" : "Escrever à mão"}
                aria-pressed={penMode}
                className={cn(
                  "rounded-full p-2 transition-colors",
                  penMode
                    ? "bg-primary/[0.18] text-accent"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <PenLine className="size-4" />
              </button>
              )}
              {/* Playing back a recording shouldn't require picking up the pen. */}
              {isOwner && !penMode && (audioPath !== null || pendingUpload) && (
                <button
                  type="button"
                  onClick={() => setAudioOpen((open) => !open)}
                  aria-label={audioOpen ? "Ocultar gravação" : "Ouvir gravação"}
                  aria-pressed={audioOpen}
                  className={cn(
                    "rounded-full p-2 transition-colors",
                    audioOpen
                      ? "bg-primary/[0.18] text-accent"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <AudioLines className="size-4" />
                </button>
              )}
              {fullscreen.supported && (
                <button
                  type="button"
                  onClick={() => void fullscreen.toggle()}
                  aria-label={fullscreen.isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                  title={fullscreen.isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {fullscreen.isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
              )}
              {current && (
                <button
                  type="button"
                  onClick={() => togglePin(current.id)}
                  aria-label={pinned ? "Desafixar nota" : "Fixar nota"}
                  aria-pressed={pinned}
                  className={cn(
                    "rounded-full p-2 transition-colors",
                    pinned
                      ? "bg-primary/[0.18] text-accent"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <Pin className={cn("size-4", pinned && "fill-current")} />
                </button>
              )}
            </div>
            {collabReady && collab.peers.length > 0 && (
              <div className="flex shrink-0 -space-x-1.5" aria-label="Pessoas nesta nota">
                {collab.peers.slice(0, 3).map((peer, i) => (
                  <span
                    key={peer.name + "-" + i}
                    title={peer.role === "viewer" ? peer.name + " (só vendo)" : peer.name}
                    aria-label={peer.name}
                    className="flex size-7 items-center justify-center rounded-full font-mono text-[11px] font-semibold text-white ring-2 ring-background"
                    style={{ backgroundColor: peer.color }}
                  >
                    {peer.name.slice(0, 1).toUpperCase()}
                  </span>
                ))}
                {collab.peers.length > 3 && (
                  <span className="flex size-7 items-center justify-center rounded-full bg-secondary font-mono text-[11px] ring-2 ring-background">
                    +{collab.peers.length - 3}
                  </span>
                )}
              </div>
            )}
          </header>

          {/* Typing mode keeps the player out of the way until asked for; in
              pen mode it lives in the toolbar instead. */}
          {!penMode && audioOpen && (audioPath !== null || pendingUpload) && (
            <div className="flex justify-center px-3 pb-2">
              <NoteAudioPlayer
                isPlaying={isPlaying}
                positionMs={positionMs}
                durationMs={audioDurationMs}
                pendingUpload={pendingUpload}
                onTogglePlay={togglePlay}
                onSeek={seek}
                onRetryUpload={retryAudioUpload}
                onDelete={() => void removeAudio()}
                onTranscribe={() => void transcribeAudioToNote()}
                onShare={() => void shareAudio()}
                isTranscribing={isTranscribing}
                hasTranscript={transcript !== null}
                transcriptOpen={transcriptOpen}
                onToggleTranscript={() => setTranscriptOpen((open) => !open)}
              />
            </div>
          )}

          {transcript !== null && transcriptOpen && (audioPath !== null || pendingUpload) && (
            <div className="flex justify-center px-3 pb-2">
              <NoteTranscriptPanel transcript={transcript} />
            </div>
          )}
        </div>

        {/* The ink layer spans this whole column, not just the text's reading
            width — handwriting shouldn't stop at a margin the typing happens
            to use. */}
        <div ref={inkWrapRef} className="relative flex flex-1 flex-col" style={{ minHeight: inkMinHeight }}>
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-16 sm:px-6">
            {creatingInShared ? (
              <CollabPlaceholder status="loading" onBack={() => void leaveNote()} />
            ) : inCollab && !collabReady ? (
              <CollabPlaceholder status={collab.status} onBack={() => void leaveNote()} />
            ) : (
              <>
                {/* First collaborative open: the editor below is mounted (it builds
                    the initial state from its own schema) but stays hidden until
                    that state lands, so the note never shows up empty first. */}
                {collab.needsSeed && <CollabPlaceholder status="loading" onBack={() => void leaveNote()} />}
                <div className={cn("flex flex-1 flex-col gap-3", collab.needsSeed && "hidden")}>
                <input
                  value={collab.viewerFallback ? collab.viewerFallback.title : title}
                  onChange={(e) => changeTitle(e.target.value)}
                  readOnly={!canWrite || !!collab.viewerFallback}
                  placeholder="Título da nota"
                  aria-label="Título da nota"
                  autoFocus={!noteId || searchParams.get("new") === "1"}
                  className="w-full bg-transparent font-heading text-3xl leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50"
                />

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <SyncStatusIndicator
                    status={
                      collabReady
                        ? collab.saveState === "saved"
                          ? "synced"
                          : collab.saveState === "saving"
                            ? "syncing"
                            : "offline"
                        : current?.syncStatus ?? "local"
                    }
                  />
                  {collabReady && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Users className="size-3" />
                      {collab.role === "owner"
                        ? "Compartilhada"
                        : collab.role === "editor"
                          ? "Compartilhada com você"
                          : "Compartilhada com você · só leitura"}
                    </span>
                  )}
                </div>

                {collab.viewerFallback ? (
                  <RichTextEditor
                    key="viewer-fallback"
                    ref={editorRef}
                    content={collab.viewerFallback.body}
                    onChange={() => {}}
                    readOnly
                    className="flex flex-1 flex-col"
                    onReferenceClick={setOpenReference}
                  />
                ) : collabReady && collab.doc && collab.provider && collab.self ? (
                  <RichTextEditor
                    key={"collab:" + createdId}
                    ref={editorRef}
                    content=""
                    onChange={setBody}
                    className="flex flex-1 flex-col"
                    publications={publications}
                    notes={noteMentionOptions}
                    onReferenceClick={setOpenReference}
                    collab={{
                      doc: collab.doc,
                      provider: collab.provider,
                      user: collab.self,
                      readOnly: !canWrite,
                      seedHtml: collab.seedHtml,
                      onSeed: collab.applySeed,
                      registerHtmlSource: collab.setHtmlSource,
                    }}
                  />
                ) : (
                  <RichTextEditor
                    key="plain"
                    ref={editorRef}
                    content={body}
                    onChange={setBody}
                    autoFocus={!noteId}
                    className="flex flex-1 flex-col"
                    publications={publications}
                    notes={noteMentionOptions}
                    onReferenceClick={setOpenReference}
                  />
                )}
                </div>
              </>
            )}

            {/* Blank paper below the text while the pen is out. Real content
                rather than a computed height, so nothing has to be measured. */}
            {penMode && <div className="h-[60svh] shrink-0" aria-hidden />}
          </div>

          <DrawingCanvas
            strokes={strokes}
            tool={tool}
            color={inkColor}
            size={tool === "highlighter" ? HIGHLIGHTER_SIZE : penSize}
            active={isOwner && penMode && !isPlaying}
            penOnly={penOnly}
            // A stylus showing up is proof this device has one, so palm
            // rejection turns itself on the first time the pen touches the
            // screen — the toolbar's own toggle then overrides it either way.
            onPenDetected={() => setPenOnly(true)}
            revealUntilMs={revealUntilMs}
            recordingElapsed={recorder.elapsedNow}
            onCommitStroke={commitStroke}
            onEraseStrokes={eraseStrokes}
          />
        </div>
      </motion.main>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onLoadedMetadata={(e) => {
            // MediaRecorder's WebM carries no duration in its header, so the
            // element reports Infinity and refuses to seek. Forcing the
            // playhead past the end makes the browser scan the file and
            // resolve a real duration; it then seeks normally. Harmless for
            // formats (mp4) that already declare one.
            const audio = e.currentTarget;
            if (audio.duration === Infinity) {
              audio.currentTime = 1e101;
              audio.currentTime = 0;
            }
          }}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          hidden
        />
      )}

      <ConfirmVault
        open={clearInkOpen}
        onOpenChange={setClearInkOpen}
        title="Apagar o que foi escrito à mão?"
        description="Todos os traços desta nota serão removidos. O texto digitado e a gravação, se houver, são mantidos."
        confirmLabel="Apagar"
        onConfirm={() => {
          pushInkHistory(strokes);
          setStrokes([]);
        }}
      />

      {createdId && isOwner && (
        <ShareVault
          open={shareOpen}
          onOpenChange={setShareOpen}
          target={{ noteId: createdId }}
          name={title.trim() || "Nova nota"}
          locked={lockedSet.has(createdId)}
          onShared={() => {
            // Shared now: flush the last plain edit, then reopen it collaboratively.
            if (!inCollab) updateNote(createdId, { title: title.trim() || "Nova nota", body });
            setSharedFromHere(true);
            setTimeout(() => collab.recheck(), 400);
          }}
        />
      )}

      <NoteReferenceSurface
        reference={openReference}
        onClose={() => setOpenReference(null)}
        onOpenNote={(id) => router.push(`/notes/${id}`)}
      />
    </div>
  );
}

/** What a shared note shows while it opens, or when it can't be opened. */
function CollabPlaceholder({
  status,
  onBack,
}: {
  status: ReturnType<typeof useCollabDoc>["status"];
  onBack: () => void;
}) {
  if (status === "revoked" || status === "unavailable") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          {status === "revoked" ? <Lock className="size-6" /> : <Users className="size-6" />}
        </div>
        <h1 className="font-heading text-xl">
          {status === "revoked" ? "Você não tem mais acesso a esta nota" : "Nota compartilhada indisponível offline"}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {status === "revoked"
            ? "Ela deixou de ser compartilhada com você (ou foi trancada). A cópia deste aparelho foi removida."
            : "Abra esta nota uma vez com internet para poder lê-la e editá-la offline neste aparelho."}
        </p>
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} onClick={onBack}>
          Voltar
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-3 py-2" aria-busy>
      <div className="h-9 w-2/3 animate-pulse rounded-xl bg-foreground/5" />
      <div className="h-4 w-full animate-pulse rounded-lg bg-foreground/5" />
      <div className="h-4 w-5/6 animate-pulse rounded-lg bg-foreground/5" />
    </div>
  );
}
