"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/providers/store-hydration";
import { useLockStore } from "@/lib/store/lock-store";
import { useNotesStore } from "@/lib/store/notes-store";
import { lockedNoteIds } from "@/lib/lock/locked";

interface LockGateProps {
  noteId: string;
  /** Computed on the server (getNoteLockState) so locked content never paints before the client store can decide. */
  initialLocked: boolean;
  children: React.ReactNode;
}

/**
 * Wraps a note's page (editor, PDF reader, publication reader). While the note is
 * locked and the session isn't unlocked, the children are not mounted at all — only
 * a "trancada" screen that asks for the biometric/PIN as soon as it appears.
 */
export function LockGate({ noteId, initialLocked, children }: LockGateProps) {
  const router = useRouter();
  const unlocked = useLockStore((s) => s.unlocked);
  const requestUnlock = useLockStore((s) => s.requestUnlock);
  const hydrated = useHydrated();
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);

  // After hydration the store is the truth (a note just locked or unlocked on
  // another screen); before it, the server's answer.
  const locked = hydrated ? lockedNoteIds(notes, folders).has(noteId) || (initialLocked && !notes.some((n) => n.id === noteId)) : initialLocked;
  const blocked = locked && !unlocked;

  useEffect(() => {
    if (!blocked) return;
    void requestUnlock();
  }, [blocked, requestUnlock]);

  if (!blocked) return <>{children}</>;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Lock className="size-6" />
      </div>
      <h1 className="font-heading text-xl">Conteúdo trancado</h1>
      <p className="max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
        Confirme sua digital ou seu PIN para ver esta nota.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" leftIcon={<ArrowLeft />} onClick={() => router.push("/notes")}>
          Voltar
        </Button>
        <Button leftIcon={<Lock />} onClick={() => void requestUnlock()}>
          Desbloquear
        </Button>
      </div>
    </div>
  );
}
