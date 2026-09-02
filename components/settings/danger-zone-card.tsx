"use client";

import { useState } from "react";
import {
  AlertTriangle,
  FileText,
  Folder,
  MessageSquare,
  NotebookPen,
  Tags,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { useNotesStore } from "@/lib/store/notes-store";
import { useChatStore } from "@/lib/store/chat-store";

type DangerAction = "notes" | "files" | "folders" | "tags" | "conversations" | "everything";

interface DangerRow {
  action: DangerAction;
  icon: LucideIcon;
  label: string;
  count: number;
  countLabel: string;
  description: string;
  confirmPhrase: string;
}

/**
 * Settings "danger zone" — bulk-wipe actions the user asked for explicitly.
 * Every action reaches every status (ativos, arquivados, lixeira), not just
 * what's currently visible, and requires typing a phrase (not just a click)
 * before the confirm button unlocks, via `ConfirmVault`'s `confirmPhrase`.
 */
export function DangerZoneCard() {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const tags = useNotesStore((s) => s.tags);
  const bulkDeletePermanently = useNotesStore((s) => s.bulkDeletePermanently);
  const deleteAllFolders = useNotesStore((s) => s.deleteAllFolders);
  const deleteAllTags = useNotesStore((s) => s.deleteAllTags);
  const conversations = useChatStore((s) => s.conversations);
  const clearAllConversations = useChatStore((s) => s.clearAllConversations);

  const [activeAction, setActiveAction] = useState<DangerAction | null>(null);

  const noteIds = notes.filter((n) => n.type === "nota").map((n) => n.id);
  const fileIds = notes.filter((n) => n.type !== "nota").map((n) => n.id);
  const allNoteIds = notes.map((n) => n.id);

  const rows: DangerRow[] = [
    {
      action: "notes",
      icon: NotebookPen,
      label: "Todas as notas",
      count: noteIds.length,
      countLabel: noteIds.length === 1 ? "1 nota" : `${noteIds.length} notas`,
      description: "Apaga permanentemente todas as notas de texto — ativas, arquivadas e na lixeira.",
      confirmPhrase: "EXCLUIR NOTAS",
    },
    {
      action: "files",
      icon: FileText,
      label: "Todos os arquivos",
      count: fileIds.length,
      countLabel: fileIds.length === 1 ? "1 arquivo" : `${fileIds.length} arquivos`,
      description: "Apaga permanentemente todos os PDFs, publicações e outros arquivos enviados.",
      confirmPhrase: "EXCLUIR ARQUIVOS",
    },
    {
      action: "folders",
      icon: Folder,
      label: "Todas as pastas",
      count: folders.length,
      countLabel: folders.length === 1 ? "1 pasta" : `${folders.length} pastas`,
      description: "Remove todas as pastas — notas e arquivos dentro delas voltam para a raiz.",
      confirmPhrase: "EXCLUIR PASTAS",
    },
    {
      action: "tags",
      icon: Tags,
      label: "Todas as tags",
      count: tags.length,
      countLabel: tags.length === 1 ? "1 tag" : `${tags.length} tags`,
      description: "Remove todas as tags — elas somem de qualquer nota ou arquivo que as usava.",
      confirmPhrase: "EXCLUIR TAGS",
    },
    {
      action: "conversations",
      icon: MessageSquare,
      label: "Todas as conversas",
      count: conversations.length,
      countLabel: conversations.length === 1 ? "1 conversa" : `${conversations.length} conversas`,
      description: "Apaga permanentemente todo o histórico de conversas com o assistente.",
      confirmPhrase: "EXCLUIR CONVERSAS",
    },
  ];

  const active = rows.find((r) => r.action === activeAction);
  const isEverything = activeAction === "everything";

  function runAction(action: DangerAction) {
    if (action === "notes") bulkDeletePermanently(noteIds);
    else if (action === "files") bulkDeletePermanently(fileIds);
    else if (action === "folders") deleteAllFolders();
    else if (action === "tags") deleteAllTags();
    else if (action === "conversations") clearAllConversations();
    else if (action === "everything") {
      bulkDeletePermanently(allNoteIds);
      deleteAllFolders();
      deleteAllTags();
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-destructive/30 bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
          <AlertTriangle className="size-5" />
        </span>
        <div className="flex flex-col">
          <h3 className="font-heading text-base text-foreground">Zona de perigo</h3>
          <p className="text-xs text-muted-foreground">Exclusões em massa e permanentes — não podem ser desfeitas</p>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border/50">
        {rows.map((row) => (
          <div key={row.action} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary/70 text-muted-foreground">
              <row.icon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13.5px] font-medium text-foreground">
                {row.label} <span className="font-mono text-[11px] text-muted-foreground">({row.countLabel})</span>
              </span>
              <span className="text-[12px] text-muted-foreground">{row.description}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Trash2 className="size-3.5 text-destructive" />}
              disabled={row.count === 0}
              onClick={() => setActiveAction(row.action)}
              className="shrink-0 text-[12.5px] text-destructive"
            >
              Excluir
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[13.5px] font-semibold text-foreground">Excluir tudo</span>
            <span className="text-[12px] text-muted-foreground">
              Notas, arquivos, pastas e tags — de uma vez. As conversas não são incluídas aqui.
            </span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            leftIcon={<Trash2 className="size-3.5" />}
            disabled={allNoteIds.length === 0 && folders.length === 0 && tags.length === 0}
            onClick={() => setActiveAction("everything")}
            className="shrink-0 text-[12.5px] max-sm:w-full"
          >
            Excluir tudo
          </Button>
        </div>
      </div>

      <ConfirmVault
        open={activeAction !== null}
        onOpenChange={(open) => {
          if (!open) setActiveAction(null);
        }}
        title={isEverything ? "Excluir tudo?" : `Excluir ${active?.label.toLowerCase()}?`}
        description={
          isEverything
            ? `Isso apaga permanentemente ${allNoteIds.length === 1 ? "1 nota/arquivo" : `${allNoteIds.length} notas/arquivos`}, ${folders.length === 1 ? "1 pasta" : `${folders.length} pastas`} e ${tags.length === 1 ? "1 tag" : `${tags.length} tags`}. Essa ação não pode ser desfeita.`
            : active
              ? `${active.description} Essa ação não pode ser desfeita.`
              : undefined
        }
        confirmLabel={isEverything ? "Excluir tudo" : "Excluir"}
        confirmPhrase={isEverything ? "EXCLUIR TUDO" : active?.confirmPhrase}
        onConfirm={() => {
          if (activeAction) runAction(activeAction);
        }}
      />
    </section>
  );
}
