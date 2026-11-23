"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, ChevronLeft, Download, FileText, Folder, LogOut, NotebookPen, Users, X } from "lucide-react";
import { useFolderViewStore } from "@/lib/store/folder-view-store";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { notify } from "@/components/ui/toaster";
import { NoteCard, type CardAction } from "./note-card";
import { FolderCard } from "./folder-card";
import { useSharedStore } from "@/lib/store/shared-store";
import { useNotesStore } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import {
  importSharedCopy,
  leaveShare,
  respondToInvite,
  type IncomingInvite,
  type SharedFolder,
  type SharedNote,
} from "@/app/(app)/shares-actions";
import { listUserContent } from "@/app/(app)/notes-actions";

const ROLE_LABEL = { editor: "pode editar", viewer: "só ver" } as const;

function sectionLabel(text: string) {
  return <span className="font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground">{text}</span>;
}

/**
 * "Compartilhado comigo" on /notes: pending invites first, then whatever is
 * shared with this user, browsable folder by folder in place (same idea as
 * the user's own folders, but its own navigation state — these folders belong
 * to someone else and must never mix into the user's tree).
 *
 * A share root (a folder or note shared directly) offers "Importar para mim"
 * — a full independent copy — and "Remover da minha lista". After an import
 * the app asks whether to also drop the shared original ("Cancelar
 * compartilhamento?"), the short-project flow where everyone ends up with
 * their own copy.
 */
export function SharedWithMe() {
  const router = useRouter();
  const notes = useSharedStore((s) => s.notes);
  const folders = useSharedStore((s) => s.folders);
  const invites = useSharedStore((s) => s.invites);
  const loaded = useSharedStore((s) => s.loaded);
  const refresh = useSharedStore((s) => s.refresh);
  const removeShareLocally = useSharedStore((s) => s.removeShareLocally);
  const viewMode = usePreferencesStore((s) => s.viewMode);

  const [requestedFolderId, setOpenFolderId] = useState<string | null>(null);
  const [busyShare, setBusyShare] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [leaveAfterImport, setLeaveAfterImport] = useState<{ shareId: string; name: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<{ shareId: string; name: string } | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A folder that stopped being shared while open simply falls back to the top level.
  const openFolder = requestedFolderId ? folders.find((f) => f.id === requestedFolderId) : undefined;
  const openFolderId = openFolder ? openFolder.id : null;

  // An editable shared folder that's open is where new notes go — the "+"
  // menu and the composer's drag-to-create read it from the folder-view store.
  const setSharedFolder = useFolderViewStore((s) => s.setSharedFolder);
  const writableFolderId = openFolder?.role === "editor" ? openFolder.id : null;
  useEffect(() => {
    setSharedFolder(writableFolderId);
  }, [writableFolderId, setSharedFolder]);
  useEffect(() => () => setSharedFolder(null), [setSharedFolder]);

  const levelFolders = folders.filter((f) => (f.parentId ?? null) === openFolderId);
  const levelNotes = notes.filter((n) => (n.folderId ?? null) === openFolderId);

  async function answer(invite: IncomingInvite, accept: boolean) {
    setAnswering(invite.id);
    try {
      const res = await respondToInvite(invite.id, accept);
      if (res.error) notify.error("Não foi possível responder", res.error);
      else if (accept) notify.success("Convite aceito", `“${invite.title}” agora aparece aqui.`);
      await refresh();
    } catch {
      notify.error("Sem conexão", "Responda ao convite quando estiver online.");
    } finally {
      setAnswering(null);
    }
  }

  async function importCopy(shareId: string, name: string) {
    if (busyShare) return;
    setBusyShare(shareId);
    try {
      const res = await importSharedCopy(shareId);
      if (res.error) {
        notify.error("Não foi possível importar", res.error);
        return;
      }
      const count = res.importedNotes ?? 0;
      notify.success("Cópia criada", `${count} ${count === 1 ? "nota importada" : "notas importadas"} para Pastas.`);
      const fresh = await listUserContent();
      if (fresh.ok) useNotesStore.getState().hydrate(fresh.notes, fresh.folders, fresh.tags);
      setLeaveAfterImport({ shareId, name });
    } catch {
      notify.error("Sem conexão", "Importe quando estiver online.");
    } finally {
      setBusyShare(null);
    }
  }

  async function leave(shareId: string) {
    try {
      const res = await leaveShare(shareId);
      if (res.error) {
        notify.error("Não foi possível remover", res.error);
        return;
      }
      removeShareLocally(shareId);
      setOpenFolderId(null);
    } catch {
      notify.error("Sem conexão", "Tente de novo quando estiver online.");
    }
  }

  function rootActions(shareId: string, name: string): CardAction[] {
    return [
      {
        label: busyShare === shareId ? "Importando…" : "Importar para mim",
        icon: Download,
        onSelect: () => void importCopy(shareId, name),
      },
      { label: "Remover da minha lista", icon: LogOut, destructive: true, onSelect: () => setConfirmLeave({ shareId, name }) },
    ];
  }

  const renderFolder = (folder: SharedFolder) => (
    <FolderCard
      key={folder.id}
      folderId={folder.id}
      name={folder.name}
      shared
      itemCount={0}
      caption={`de ${folder.ownerName} · ${ROLE_LABEL[folder.role]}`}
      onOpen={() => setOpenFolderId(folder.id)}
      extraActions={folder.parentId ? [] : rootActions(folder.shareId, folder.name)}
    />
  );

  const renderNote = (note: SharedNote) => (
    <NoteCard
      key={note.id}
      id={note.id}
      type="nota"
      title={note.title || "Sem título"}
      body={note.body}
      meta={`de ${note.ownerName} · ${ROLE_LABEL[note.role]}`}
      variant={viewMode}
      shared
      onOpen={() => router.push(`/notes/${note.id}`)}
      extraActions={note.folderId ? [] : rootActions(note.shareId, note.title || "Nota")}
    />
  );

  const nothingShared = notes.length === 0 && folders.length === 0;

  return (
    <div className="flex flex-col gap-7">
      {invites.length > 0 && !openFolderId && (
        <section className="flex flex-col gap-3">
          {sectionLabel("CONVITES")}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {invites.map((invite) => (
              <motion.div
                key={invite.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-accent">
                    {invite.kind === "folder" ? <Folder className="size-[18px]" /> : <FileText className="size-[18px]" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading text-[15px]">{invite.title}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {invite.ownerName} convidou você · {ROLE_LABEL[invite.role]}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    leftIcon={<Check />}
                    isLoading={answering === invite.id}
                    onClick={() => void answer(invite, true)}
                  >
                    Aceitar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<X />}
                    disabled={answering === invite.id}
                    onClick={() => void answer(invite, false)}
                  >
                    Recusar
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {openFolder && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpenFolderId(openFolder.parentId ?? null)}
            className="flex w-fit items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[13px] text-foreground/80 transition-all hover:bg-surface"
          >
            <ChevronLeft className="size-4" />
            {openFolder.name}
          </button>
          {openFolder.role === "editor" && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<NotebookPen />}
              onClick={() => router.push(`/notes/new?folder=${encodeURIComponent(openFolder.id)}`)}
            >
              Nova nota aqui
            </Button>
          )}
        </div>
      )}

      {levelFolders.length > 0 && (
        <section className="flex flex-col gap-3">
          {openFolderId && sectionLabel("PASTAS")}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{levelFolders.map(renderFolder)}</div>
        </section>
      )}

      {levelNotes.length > 0 && (
        <section className="flex flex-col gap-3">
          {sectionLabel("NOTAS")}
          <div
            className={
              viewMode === "list"
                ? "flex flex-col gap-2"
                : "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
            }
          >
            {levelNotes.map(renderNote)}
          </div>
        </section>
      )}

      {nothingShared && invites.length === 0 && (
        <div className="flex flex-1 items-center justify-center py-10">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>{loaded ? "Nada compartilhado com você" : "Carregando…"}</EmptyTitle>
              <EmptyDescription>
                Quando alguém compartilhar uma nota ou pasta com você, o convite aparece aqui para aceitar ou recusar.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}

      {openFolder && levelFolders.length === 0 && levelNotes.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma nota nesta pasta.</p>
      )}

      <ConfirmVault
        open={leaveAfterImport !== null}
        onOpenChange={(open) => {
          if (!open) setLeaveAfterImport(null);
        }}
        title="Cancelar compartilhamento?"
        description={`Sua cópia de “${leaveAfterImport?.name ?? ""}” já está em Pastas e é só sua. Quer também tirar o original compartilhado da sua lista? Se preferir, mantenha os dois.`}
        confirmLabel="Remover original"
        cancelLabel="Manter os dois"
        onConfirm={() => {
          if (leaveAfterImport) void leave(leaveAfterImport.shareId);
        }}
      />

      <ConfirmVault
        open={confirmLeave !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmLeave(null);
        }}
        title="Remover da sua lista?"
        description={`“${confirmLeave?.name ?? ""}” deixa de aparecer para você e sai deste aparelho. Para voltar a ter acesso, a pessoa precisa convidar você de novo. Se quiser ficar com o conteúdo, importe uma cópia antes.`}
        confirmLabel="Remover"
        onConfirm={() => {
          if (confirmLeave) void leave(confirmLeave.shareId);
        }}
      />
    </div>
  );
}
