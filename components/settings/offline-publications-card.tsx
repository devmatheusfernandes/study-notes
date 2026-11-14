"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDriveDownload, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { notify } from "@/components/ui/toaster";
import { formatBytes } from "@/lib/format-bytes";
import { listOfflinePublications, removeOfflinePublication, type OfflinePublication } from "@/lib/offline/jwpub-offline";

/** The publications kept on this device for offline reading (downloaded from the reader's header). */
export function OfflinePublicationsCard() {
  const [publications, setPublications] = useState<OfflinePublication[] | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<OfflinePublication | "all" | null>(null);

  const load = useCallback(async () => {
    setPublications(await listOfflinePublications());
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage !== undefined && estimate.quota !== undefined) {
        setUsage({ used: estimate.usage, quota: estimate.quota });
      }
    } catch {
      // Not supported — the per-publication sizes are still shown.
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function confirmRemoval() {
    const targets = pendingRemoval === "all" ? (publications ?? []) : pendingRemoval ? [pendingRemoval] : [];
    for (const target of targets) await removeOfflinePublication(target.noteId);
    notify.success(targets.length === 1 ? "Download removido" : "Downloads removidos");
    await load();
  }

  const totalBytes = (publications ?? []).reduce((sum, p) => sum + p.bytes, 0);

  return (
    <>
      <section className="flex w-full flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <HardDriveDownload className="size-4 text-accent" />
              <h2 className="font-heading text-base">Publicações offline</h2>
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Publicações salvas neste aparelho para ler sem internet. Para baixar uma, abra-a e use o botão de download
              no topo do leitor.
            </p>
          </div>

          {publications && publications.length > 0 && (
            <Badge variant="outline" className="h-auto shrink-0 rounded-full font-mono text-[10px]">
              {formatBytes(totalBytes)}
            </Badge>
          )}
        </div>

        {publications === null ? (
          <div className="h-12 animate-pulse rounded-2xl bg-muted/60" />
        ) : publications.length === 0 ? (
          <p className="rounded-2xl border border-border/50 bg-secondary/50 p-4 text-[13px] text-muted-foreground">
            Nenhuma publicação baixada neste aparelho.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {publications.map((p) => (
              <li
                key={p.noteId}
                className="flex items-center gap-3 rounded-2xl border border-border/50 bg-secondary/50 p-3.5"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link href={`/notes/${p.noteId}`} className="truncate text-[13.5px] font-medium hover:underline">
                    {p.publication.title || "Publicação"}
                  </Link>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatBytes(p.bytes)} · {new Date(p.downloadedAt).toLocaleDateString("pt-BR")}
                    {p.mediaFailed > 0 ? ` · ${p.mediaFailed} imagens faltando` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingRemoval(p)}
                  aria-label={`Remover download de ${p.publication.title}`}
                  className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[12px] text-muted-foreground">
            {usage
              ? `Armazenamento do navegador: ${formatBytes(usage.used)} de ${formatBytes(usage.quota)} usados.`
              : "Os downloads somem ao sair da conta."}
          </span>
          {publications && publications.length > 1 && (
            <Button variant="ghost" size="sm" className="rounded-full text-[12.5px]" onClick={() => setPendingRemoval("all")}>
              Remover todos
            </Button>
          )}
        </div>
      </section>

      <ConfirmVault
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        title={pendingRemoval === "all" ? "Remover todos os downloads?" : "Remover download?"}
        description="As publicações continuam na sua biblioteca, mas só abrirão com internet. Seus destaques e notas não são apagados."
        confirmLabel="Remover"
        onConfirm={() => void confirmRemoval()}
      />
    </>
  );
}
