"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  BookMarked,
  BookOpen,
  FileText,
  FolderPlus,
  NotebookPen,
  Scroll,
  Sparkles,
  Upload,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssistantStore, type AssistantSource } from "@/lib/store/assistant-store";
import { useFolderViewStore } from "@/lib/store/folder-view-store";
import { useNotesStore } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { useFileUpload } from "@/hooks/use-file-upload";

// ─── Drag-to-create-note constants ────────────────────────────────────────────
const HOLD_MS = 320;
const MOVE_CANCEL_PX = 12;
const COMMIT_PX = 90;
const HINT_HEIGHT = 56;

// ─── Source filter config (chat variant) ──────────────────────────────────────
const SOURCE_FILTERS = [
  { id: "nota", label: "Notas", icon: NotebookPen },
  { id: "pdf", label: "PDFs", icon: FileText },
  { id: "jwpub", label: "JWPUB", icon: BookOpen },
  { id: "video", label: "Vídeos", icon: Video },
  { id: "estudo_pessoal", label: "Estudo Pessoal", icon: BookMarked },
  { id: "biblia", label: "Bíblia", icon: Scroll },
] as const;;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Ripple {
  id: number;
  x: number;
  y: number;
}

/**
 * variant="notes"  → floating dock on /notes, /archived, /trash
 *   - sparkles opens quick-action tray: Nova nota | Nova pasta | Importar
 *   - drag-to-create-note gesture (only on /notes)
 * variant="chat"   → floating bar inside /chats/[id]
 *   - sparkles opens source-filter drawer
 *   - auto-resize textarea
 * variant="panel"  → embedded inside the assistant side panel / sheet
 *   - no sparkles, no gesture, simple input
 */
export type SmartComposerVariant = "notes" | "chat" | "panel";

interface SmartComposerBaseProps {
  variant: SmartComposerVariant;
  /**
   * Only used by "notes" and "panel" variants.
   * When true the "Importar" quick-action is hidden (archived/trash context).
   */
  hideImport?: boolean;
  /**
   * Only used by "notes" and "panel" variants.
   * When true no quick-actions are shown (trash context).
   */
  noActions?: boolean;
}

interface SmartComposerChatProps extends SmartComposerBaseProps {
  variant: "chat";
  onSend: (message: string, allowedSourceTypes: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

interface SmartComposerOtherProps extends SmartComposerBaseProps {
  variant: "notes" | "panel";
  onSend?: never;
  disabled?: never;
  placeholder?: string;
}

type SmartComposerProps = SmartComposerChatProps | SmartComposerOtherProps;

// ─── Component ────────────────────────────────────────────────────────────────
export function SmartComposer(props: SmartComposerProps) {
  const {
    variant,
    hideImport = false,
    noActions = false,
    placeholder,
  } = props;

  const router = useRouter();
  const [value, setValue] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // "folder-input" phase: inline folder name entry
  const [drawerPhase, setDrawerPhase] = useState<"menu" | "folder-input">("menu");
  const [folderName, setFolderName] = useState("");

  // Drag-to-create (notes variant only)
  const [armed, setArmed] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  // Chat source filters (persisted in Zustand store + synced to Supabase DB)
  const selectedFilters = usePreferencesStore((s) => s.selectedSourceFilters);
  const setSelectedFilters = usePreferencesStore((s) => s.setSelectedSourceFilters);

  const open = useAssistantStore((s) => s.open);
  const start = useAssistantStore((s) => s.start);
  const fail = useAssistantStore((s) => s.fail);
  const activeFolderId = useFolderViewStore((s) => s.activeFolderId);
  const createFolder = useNotesStore((s) => s.createFolder);
  const { upload, isUploading } = useFileUpload();

  const dockRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const dragYRef = useRef(0);

  const gestureEnabled = variant === "notes";
  const isPanel = variant === "panel";
  const isChat = variant === "chat";
  const isNotes = variant === "notes";

  // ── Auto-resize textarea (chat variant) ──────────────────────────────────
  useEffect(() => {
    if (!isChat) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 175)}px`;
  }, [value, isChat]);

  // ── Focus folder input when phase switches ────────────────────────────────
  useEffect(() => {
    if (drawerPhase === "folder-input") {
      setTimeout(() => folderInputRef.current?.focus(), 50);
    }
  }, [drawerPhase]);

  // ── Prefetch /notes/new ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isNotes) return;
    type PrefetchOptions = Parameters<typeof router.prefetch>[1];
    router.prefetch("/notes/new", { kind: "full" } as PrefetchOptions);
  }, [router, isNotes]);

  // ── Drag-to-create helpers ────────────────────────────────────────────────
  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const resetGesture = useCallback(() => {
    clearHold();
    armedRef.current = false;
    dragYRef.current = 0;
    startPoint.current = null;
    setArmed(false);
    setPressing(false);
    setDragY(0);
  }, [clearHold]);

  useEffect(() => () => clearHold(), [clearHold]);

  // ── Source filter toggle ──────────────────────────────────────────────────
  function toggleFilter(id: string) {
    let next: string[];
    if (selectedFilters.includes(id)) {
      next = selectedFilters.filter((item) => item !== id);
      if (next.length === 0) next = SOURCE_FILTERS.map((f) => f.id);
    } else {
      next = [...selectedFilters, id];
    }
    setSelectedFilters(next);
  }

  // ── Assistant submit (notes/panel variants) ───────────────────────────────
  async function submitAssistant() {
    const question = value.trim();
    if (!question) return;
    setValue("");
    start(question);

    try {
      const response = await fetch("/assistant/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!response.ok || !response.body) {
        fail("Não foi possível falar com o assistente agora.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr) as {
              type: string;
              content?: string;
              sources?: unknown[];
            };
            if (event.type === "delta" && event.content) {
              useAssistantStore.getState().appendDelta(event.content);
            } else if (event.type === "sources" && event.sources) {
              // Cast via unknown to avoid TSX angle-bracket ambiguity
              useAssistantStore.getState().setSources(event.sources as unknown as AssistantSource[]);
            } else if (event.type === "done") {
              useAssistantStore.getState().finishStream();
            } else if (event.type === "error") {
              fail(event.content ?? "Erro no assistente.");
            }
          } catch {
            // skip malformed line
          }
        }
      }

      useAssistantStore.getState().finishStream();
    } catch {
      fail("Não foi possível falar com o assistente agora.");
    }
  }

  // ── Chat submit ───────────────────────────────────────────────────────────
  function submitChat() {
    if (props.variant !== "chat") return;
    const trimmed = value.trim();
    if (!trimmed || props.disabled) return;
    props.onSend(trimmed, selectedFilters);
    setValue("");
  }

  function handleSubmit() {
    if (isChat) submitChat();
    else void submitAssistant();
  }

  // ── Folder creation ───────────────────────────────────────────────────────
  function submitFolder() {
    const trimmed = folderName.trim();
    if (!trimmed) return;
    createFolder(trimmed, activeFolderId ?? undefined);
    setFolderName("");
    setDrawerPhase("menu");
    setDrawerOpen(false);
  }

  // ── File import ───────────────────────────────────────────────────────────
  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    void upload(Array.from(list), activeFolderId ?? undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setDrawerOpen(false);
  }

  // ── Pointer events (gesture) ──────────────────────────────────────────────
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!gestureEnabled) return;
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;

    const rect = dockRef.current?.getBoundingClientRect();
    if (rect) {
      setRipples((prev) => [
        ...prev,
        { id: Date.now(), x: event.clientX - rect.left, y: event.clientY - rect.top },
      ]);
    }

    setPressing(true);
    startPoint.current = { x: event.clientX, y: event.clientY };
    const currentTarget = event.currentTarget;
    const pointerId = event.pointerId;

    clearHold();
    holdTimer.current = setTimeout(() => {
      armedRef.current = true;
      setArmed(true);
      try {
        currentTarget.setPointerCapture(pointerId);
      } catch {
        // pointer already released
      }
    }, HOLD_MS);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!gestureEnabled || !startPoint.current) return;
    const dx = event.clientX - startPoint.current.x;
    const dy = startPoint.current.y - event.clientY;

    if (!armedRef.current) {
      if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) resetGesture();
      return;
    }

    const next = Math.max(0, dy);
    dragYRef.current = next;
    setDragY(next);
  }

  function handlePointerUp() {
    if (!gestureEnabled) return;
    const shouldCommit = armedRef.current && dragYRef.current > COMMIT_PX;
    const draft = value.trim();
    resetGesture();

    if (shouldCommit) {
      const params = new URLSearchParams();
      if (draft) params.set("q", draft);
      if (activeFolderId) params.set("folder", activeFolderId);
      const qs = params.toString();
      router.push(qs ? `/notes/new?${qs}` : "/notes/new");
    }
  }

  // ── Notes: floating dock hides when assistant opens (with exit animation) ──
  // We must NOT early-return before the composerInner is defined,
  // so this gate is moved to the floating render section below.

  const progress = Math.min(1, dragY / COMMIT_PX);
  const willCommit = dragY > COMMIT_PX;
  const hasNarrowedFilters = selectedFilters.length < SOURCE_FILTERS.length;

  // ── Sparkles drawer content ───────────────────────────────────────────────
  const notesActionsContent = !noActions && (
    <AnimatePresence initial={false}>
      {drawerOpen && (
        <motion.div
          key="notes-drawer"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.32, 0, 0.67, 0] }}
          className="overflow-hidden"
        >
          <AnimatePresence mode="wait">
            {drawerPhase === "menu" ? (
              <motion.div
                key="menu"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-4 pb-3 pt-3 text-xs"
                data-no-drag
              >
                <span className="mr-1 font-mono text-[10px] uppercase text-muted-foreground/80">
                  Nova
                </span>

                {/* Nova nota */}
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(false);
                    const params = new URLSearchParams();
                    if (activeFolderId) params.set("folder", activeFolderId);
                    const qs = params.toString();
                    router.push(qs ? `/notes/new?${qs}` : "/notes/new");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11.5px] font-medium text-foreground/80 transition-all hover:border-accent/50 hover:bg-accent/15 hover:text-accent"
                >
                  <NotebookPen className="size-3 shrink-0" />
                  <span>Nota</span>
                </button>

                {/* Nova pasta */}
                <button
                  type="button"
                  onClick={() => setDrawerPhase("folder-input")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11.5px] font-medium text-foreground/80 transition-all hover:border-accent/50 hover:bg-accent/15 hover:text-accent"
                >
                  <FolderPlus className="size-3 shrink-0" />
                  <span>Pasta</span>
                </button>

                {/* Importar */}
                {!hideImport && (
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11.5px] font-medium text-foreground/80 transition-all hover:border-accent/50 hover:bg-accent/15 hover:text-accent"
                  >
                    {isUploading ? (
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="block size-3 shrink-0 rounded-full border-2 border-accent border-t-transparent"
                      />
                    ) : (
                      <Upload className="size-3 shrink-0" />
                    )}
                    <span>{isUploading ? "Enviando…" : "Importar"}</span>
                  </button>
                )}
              </motion.div>
            ) : (
              /* Folder name inline input */
              <motion.div
                key="folder-input"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex items-center gap-2 border-b border-white/10 px-4 pb-3 pt-3"
                data-no-drag
              >
                {/* Back button */}
                <button
                  type="button"
                  onClick={() => {
                    setDrawerPhase("menu");
                    setFolderName("");
                  }}
                  aria-label="Voltar"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>

                <FolderPlus className="size-3.5 shrink-0 text-accent" />

                <input
                  ref={folderInputRef}
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitFolder();
                    }
                    if (e.key === "Escape") {
                      setDrawerPhase("menu");
                      setFolderName("");
                    }
                  }}
                  placeholder="Nome da pasta…"
                  className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/60"
                />

                {/* Confirm */}
                <motion.button
                  type="button"
                  onClick={submitFolder}
                  disabled={!folderName.trim()}
                  animate={{ opacity: folderName.trim() ? 1 : 0.35, scale: folderName.trim() ? 1 : 0.9 }}
                  transition={{ duration: 0.15 }}
                  aria-label="Criar pasta"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:cursor-not-allowed"
                >
                  <ArrowUp className="size-3.5 stroke-[2.5]" />
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const chatFiltersContent = isChat && (
    <AnimatePresence initial={false}>
      {drawerOpen && (
        <motion.div
          key="chat-filters"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="overflow-hidden"
          data-no-drag
        >
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-4 pb-3 pt-3 text-xs sm:px-5">
            <span className="mr-1 font-mono text-[10px] uppercase text-muted-foreground/80">
              Procurar em:
            </span>
            {SOURCE_FILTERS.map((f) => {
              const Icon = f.icon;
              const isSelected = selectedFilters.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggleFilter(f.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-all",
                    isSelected
                      ? "bg-accent/20 border border-accent/50 text-accent shadow-xs"
                      : "bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  )}
                >
                  <Icon className="size-3 shrink-0" />
                  <span>{f.label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── The capsule shell + content row ──────────────────────────────────────
  const composerInner = (
    <motion.div
      ref={dockRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetGesture}
      animate={
        gestureEnabled
          ? {
              y: -dragY * 0.35,
              scale: armed ? 1 + progress * 0.03 : pressing ? 0.985 : 1,
            }
          : {}
      }
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      style={gestureEnabled ? { touchAction: "none" } : undefined}
      className={cn(
        "relative w-full overflow-hidden rounded-[28px] sm:rounded-[32px] border transition-colors duration-200",
        "bg-[#211f1e]/90 backdrop-blur-2xl",
        !isPanel && "shadow-[0_12px_36px_rgba(0,0,0,0.5)]",
        // border states
        gestureEnabled
          ? willCommit
            ? "border-accent"
            : armed
            ? "border-accent/50"
            : "border-white/12 hover:border-white/20 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20"
          : "border-white/12 hover:border-white/20 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20"
      )}
    >
      {/* Ripple layer */}
      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.span
            key={ripple.id}
            initial={{ scale: 0, opacity: 0.35 }}
            animate={{ scale: 1, opacity: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            onAnimationComplete={() =>
              setRipples((prev) => prev.filter((r) => r.id !== ripple.id))
            }
            className="pointer-events-none absolute z-0 size-[320px] rounded-full bg-accent"
            style={{ left: ripple.x - 160, top: ripple.y - 160 }}
          />
        ))}
      </AnimatePresence>

      {/* Drag hint (notes) */}
      {gestureEnabled && (
        <motion.div
          initial={false}
          animate={{ height: armed ? HINT_HEIGHT : 0, opacity: armed ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
          className="relative z-10 overflow-hidden"
        >
          <div
            className="flex items-center justify-center gap-2 px-4 text-accent"
            style={{ height: HINT_HEIGHT }}
          >
            <motion.span
              animate={{ y: willCommit ? -2 : 0, scale: 1 + progress * 0.1 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="flex shrink-0 items-center"
            >
              <NotebookPen className="size-4" />
            </motion.span>
            <span className="text-[13px] leading-none">
              {willCommit ? "Solte para criar a nota" : "Arraste para cima para criar uma nota"}
            </span>
          </div>
        </motion.div>
      )}

      {/* Sparkles drawer — notes quick-actions or chat filters */}
      {isNotes ? notesActionsContent : chatFiltersContent}

      {/* Main input row — items-center works for all variants:
           single-line (notes/panel) and growing textarea (chat) alike. */}
      <div
        className={cn(
          "relative z-10 flex items-center gap-3",
          isPanel ? "px-4 py-2.5" : "px-4 py-3 sm:px-5 sm:py-3.5"
        )}
      >
        {/* Sparkles / accent dot */}
        {!isPanel ? (
          <button
            type="button"
            data-no-drag
            onClick={() => {
              if (noActions && isNotes) return;
              setDrawerOpen((v) => !v);
              if (drawerOpen) {
                // reset folder input on close
                setTimeout(() => setDrawerPhase("menu"), 200);
                setFolderName("");
              }
            }}
            aria-label={isChat ? "Filtros de busca" : "Ações rápidas"}
            aria-expanded={drawerOpen}
            className={cn(
              "relative size-7 shrink-0 rounded-full text-accent transition-colors flex items-center justify-center",
              noActions && isNotes
                ? "cursor-default opacity-40"
                : drawerOpen
                ? "bg-accent/25"
                : "bg-accent/15 hover:bg-accent/25"
            )}
          >
            <Sparkles className="size-3.5" />
            {/* badge for narrowed chat filters */}
            {isChat && hasNarrowedFilters && !drawerOpen && (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-[#211f1e]" />
            )}
          </button>
        ) : (
          /* Panel: simple accent dot as affordance indicator */
          <span className="size-2 shrink-0 rounded-full bg-accent" />
        )}

        {/* Text input: textarea for chat, input for notes/panel */}
        {isChat ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              placeholder ??
              (props.variant === "chat" && props.disabled
                ? "Gerando resposta…"
                : "Pergunte às suas notas ou vídeos…")
            }
            disabled={props.variant === "chat" ? props.disabled : false}
            rows={1}
            className="min-h-[26px] max-h-44 flex-1 resize-none bg-transparent text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
          />
        ) : (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              placeholder ??
              (isPanel ? "Continue a conversa…" : "Pergunte às suas notas ou dê um comando…")
            }
            aria-label="Perguntar ao assistente"
            className="min-w-0 flex-1 bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        )}

        {/* ⌘K badge (notes floating only) */}
        {isNotes && (
          <span className="hidden shrink-0 rounded-full bg-foreground/10 px-2 py-1 font-mono text-[10.5px] text-muted-foreground sm:inline">
            ⌘K
          </span>
        )}

        {/* Send button */}
        <button
          type="button"
          data-no-drag
          onClick={handleSubmit}
          disabled={
            !value.trim() ||
            (props.variant === "chat" ? !!props.disabled : false)
          }
          aria-label="Enviar"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full transition-all duration-200",
            value.trim() &&
              !(props.variant === "chat" && props.disabled)
              ? "bg-primary text-primary-foreground shadow-md hover:bg-accent hover:scale-105 active:scale-95"
              : "bg-secondary/70 text-muted-foreground opacity-40 cursor-not-allowed"
          )}
        >
          <ArrowUp className="size-4 stroke-[2.5]" />
        </button>
      </div>

      {/* Hidden file input for import */}
      {isNotes && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.jwpub,.png,.jpg,.jpeg,.webp"
          onChange={(e) => handleFiles(e.target.files)}
        />
      )}
    </motion.div>
  );

  // Panel variant — render inline
  if (isPanel) return composerInner;

  // Floating variant — sticky bottom bar with animated enter/exit
  // (hides while the assistant panel is open to avoid duplicating the input)
  return (
    <AnimatePresence mode="wait">
      {(!isNotes || !open) && (
        <motion.div
          key="floating-composer"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className="pointer-events-none sticky bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6"
        >
          <div className="pointer-events-auto w-full max-w-2xl">{composerInner}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
