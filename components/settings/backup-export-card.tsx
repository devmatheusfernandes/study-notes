"use client";

import { useState } from "react";
import { Download, FileJson, Folder, NotebookPen, FileText } from "lucide-react";
import { useNotesStore } from "@/lib/store/notes-store";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";

export function BackupExportCard() {
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const [isExporting, setIsExporting] = useState(false);

  // Filter out JWPUB publications and JW Library backups — neither's real
  // content lives in this row (a publication's chapters, or a backup's own
  // notes/highlights, live in their own tables), so exporting the row alone
  // would just be a useless stub. JW Library backups also get their own
  // management section below (BackupsCard) instead.
  const backupNotes = notes.filter((n) => n.type !== "jwpub" && n.type !== "jwlibrary");
  const notesCount = backupNotes.filter((n) => n.type === "nota").length;
  const filesCount = backupNotes.filter((n) => n.type !== "nota").length;

  function handleExport() {
    if (backupNotes.length === 0 && folders.length === 0) {
      notify.error("Nenhum dado disponível para exportar.");
      return;
    }

    setIsExporting(true);

    try {
      const payload = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        appName: "Study Notes",
        stats: {
          totalNotes: notesCount,
          totalFiles: filesCount,
          totalFolders: folders.length,
        },
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          parentId: f.parentId ?? null,
        })),
        notes: backupNotes.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          folderId: n.folderId ?? null,
          pinned: n.pinned,
          status: n.status,
          updatedAt: new Date(n.updatedAt).toISOString(),
        })),
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().split("T")[0];

      const a = document.createElement("a");
      a.href = url;
      a.download = `study-notes-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      notify.success("Backup exportado em formato JSON com sucesso!");
    } catch {
      notify.error("Não foi possível gerar o arquivo de backup.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="flex flex-col justify-between gap-5 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <FileJson className="size-5" />
            </span>
            <div className="flex flex-col">
              <h3 className="font-heading text-base text-foreground">Exportar Backup</h3>
              <p className="text-xs text-muted-foreground">
                Baixe suas notas, pastas e arquivos em JSON
              </p>
            </div>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Gere uma cópia de segurança de todo o seu conteúdo pessoal (notas manuscritas, textos e documentos PDF/arquivos). Publicações JWPUB são ignoradas no arquivo.
        </p>

        {/* Content summary badges */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs text-foreground font-medium">
            <NotebookPen className="size-3.5 text-accent" />
            {notesCount} {notesCount === 1 ? "Nota" : "Notas"}
          </span>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs text-foreground font-medium">
            <FileText className="size-3.5 text-primary" />
            {filesCount} {filesCount === 1 ? "PDF / Arquivo" : "PDFs / Arquivos"}
          </span>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs text-foreground font-medium">
            <Folder className="size-3.5 text-warning" />
            {folders.length} {folders.length === 1 ? "Pasta" : "Pastas"}
          </span>
        </div>
      </div>

      <div className="pt-2">
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting}
          leftIcon={<Download className="size-4 text-accent" />}
          className="rounded-full text-[13px] max-sm:w-full font-medium"
        >
          {isExporting ? "Gerando backup…" : "Exportar Backup (.json)"}
        </Button>
      </div>
    </section>
  );
}
