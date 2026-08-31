"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/lib/store/assistant-store";
import { useFolderViewStore } from "@/lib/store/folder-view-store";
import { askAssistant } from "@/app/(app)/assistant-actions";

/** How long the pointer must be held before the drag-to-new-note gesture arms. */
const HOLD_MS = 320;
/** Movement before arming that means "this was a scroll/tap, not a hold". */
const MOVE_CANCEL_PX = 12;
/** Upward distance past which releasing creates the note. */
const COMMIT_PX = 90;
/** Height of the drag hint row once armed — fixed so the label never clips. */
const HINT_HEIGHT = 56;

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface AssistantDockProps {
  /**
   * `floating` is the composer that sits over the content grid. It carries the
   * drag-to-create-note gesture and hides itself when the desktop panel takes over.
   * `panel` is the same composer rendered inside the assistant side panel.
   */
  variant?: "floating" | "panel";
}

export function AssistantDock({ variant = "floating" }: AssistantDockProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [armed, setArmed] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const open = useAssistantStore((s) => s.open);
  const start = useAssistantStore((s) => s.start);
  const resolve = useAssistantStore((s) => s.resolve);
  const fail = useAssistantStore((s) => s.fail);
  const activeFolderId = useFolderViewStore((s) => s.activeFolderId);

  const dockRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const dragYRef = useRef(0);

  const gestureEnabled = variant === "floating";

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

  async function submit() {
    const question = value.trim();
    if (!question) return;
    setValue("");
    start(question);
    try {
      const reply = await askAssistant(question);
      if (reply.error) fail(reply.error);
      else resolve(reply.answer, reply.sources);
    } catch {
      fail("Não foi possível falar com o assistente agora.");
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!gestureEnabled) return;
    // Ignore the send button and other controls inside the dock.
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;

    // Ripple from the exact touch/click point, for immediate press feedback.
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
        // Pointer already released — the pointerup handler will reset us.
      }
    }, HOLD_MS);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!gestureEnabled || !startPoint.current) return;
    const dx = event.clientX - startPoint.current.x;
    const dy = startPoint.current.y - event.clientY;

    if (!armedRef.current) {
      // Moved before the hold completed → treat as a scroll or a stray tap.
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
      // Creating from inside a folder keeps the new note in that folder.
      if (activeFolderId) params.set("folder", activeFolderId);
      const qs = params.toString();
      router.push(qs ? `/notes/new?${qs}` : "/notes/new");
    }
  }

  // While the assistant is open its own surface hosts the composer — the side
  // panel on desktop, the bottom sheet on mobile — so the floating one steps aside.
  if (variant === "floating" && open) return null;

  const progress = Math.min(1, dragY / COMMIT_PX);
  const willCommit = dragY > COMMIT_PX;
  const isPanel = variant === "panel";

  const composer = (
    <motion.div
      ref={dockRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetGesture}
      animate={{
        y: -dragY * 0.35,
        scale: armed ? 1 + progress * 0.03 : pressing ? 0.985 : 1,
      }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      style={gestureEnabled ? { touchAction: "none" } : undefined}
      className={cn(
        "relative overflow-hidden rounded-3xl border bg-surface-elevated transition-colors",
        !isPanel && "shadow-[0_14px_34px_rgba(0,0,0,0.5)]",
        willCommit ? "border-accent" : armed ? "border-accent/50" : "border-border"
      )}
    >
      {/* Press ripple — expands from the touch point. */}
      <AnimatePresence>
        {ripples.map((ripple) => (
          <motion.span
            key={ripple.id}
            initial={{ scale: 0, opacity: 0.35 }}
            animate={{ scale: 1, opacity: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            onAnimationComplete={() => setRipples((prev) => prev.filter((r) => r.id !== ripple.id))}
            className="pointer-events-none absolute z-0 size-[320px] rounded-full bg-accent"
            style={{ left: ripple.x - 160, top: ripple.y - 160 }}
          />
        ))}
      </AnimatePresence>

      {/* Drag affordance — fixed height once armed so the label never clips. */}
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

      <div className="relative z-10 flex items-center gap-2 px-2 py-2 pl-5">
        <span className="size-2 shrink-0 rounded-full bg-accent" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={
            isPanel ? "Continue a conversa…" : "Pergunte às suas notas ou dê um comando…"
          }
          aria-label="Perguntar ao assistente"
          className="min-w-0 flex-1 bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {!isPanel && (
          <span className="hidden shrink-0 rounded-full bg-foreground/10 px-2 py-1 font-mono text-[10.5px] text-muted-foreground sm:inline">
            ⌘K
          </span>
        )}
        <button
          type="button"
          data-no-drag
          onClick={() => void submit()}
          disabled={!value.trim()}
          aria-label="Enviar pergunta"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </motion.div>
  );

  if (isPanel) return composer;

  return (
    <div className="pointer-events-none sticky bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
      <div className="pointer-events-auto w-full max-w-2xl">{composer}</div>
    </div>
  );
}
