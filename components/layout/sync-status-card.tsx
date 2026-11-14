"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { notify } from "@/components/ui/toaster";
import { Vault, VaultContent, VaultDescription, VaultHeader, VaultTitle } from "@/components/ui/vault";
import { useNotesStore } from "@/lib/store/notes-store";
import { useJwOutbox } from "@/lib/offline/jwlibrary-outbox";
import { describeJwOp, describeNotesOp, explainSyncError, type PendingItem } from "@/lib/sync-status";

interface SyncStatusCardProps {
  isOnline: boolean;
  pendingCount: number;
}

/**
 * The sidebar's "offline-first" card. Tapping it opens what is still waiting to
 * reach the server, why, and a "Sincronizar agora" that doesn't let one change
 * that keeps failing hold every other one back — the automatic pass stops at
 * the first failure to keep ordering safe, which is right when merely offline
 * but means a single stuck change can leave the whole queue waiting for hours.
 */
export function SyncStatusCard({ isOnline, pendingCount }: SyncStatusCardProps) {
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<PendingItem | null>(null);

  const pendingOps = useNotesStore((s) => s.pendingOps);
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const tags = useNotesStore((s) => s.tags);
  const jwOps = useJwOutbox((s) => s.ops);

  const items = useMemo<PendingItem[]>(
    () => [
      ...Object.values(pendingOps).map((op) => describeNotesOp(op, notes, folders, tags)),
      ...jwOps.map(describeJwOp),
    ],
    [pendingOps, notes, folders, tags, jwOps]
  );

  async function syncNow() {
    if (!navigator.onLine) {
      notify.error("Sem conexão", "Assim que a internet voltar, a sincronização roda sozinha.");
      return;
    }
    setSyncing(true);
    try {
      await Promise.all([
        useNotesStore.getState().forceSyncPendingOps(),
        useJwOutbox.getState().sync({ force: true }),
      ]);
    } catch {
      // Each store records its own failures per item; the summary below reads them.
    } finally {
      setSyncing(false);
    }
    const left = Object.keys(useNotesStore.getState().pendingOps).length + useJwOutbox.getState().ops.length;
    if (left === 0) notify.success("Tudo sincronizado");
    else notify.error(`${left} ${left === 1 ? "alteração continua" : "alterações continuam"} aguardando`, "O motivo aparece em cada item da lista.");
  }

  function discard(item: PendingItem) {
    if (item.source === "notes") useNotesStore.getState().discardPendingOp(item.id);
    else useJwOutbox.getState().discard(item.id);
  }

  return (
    <>
      <Button
        variant="ghost"
        fullWidth
        onClick={() => setOpen(true)}
        aria-label="Ver o estado da sincronização"
        className="h-auto flex-col items-start justify-start gap-1.5 whitespace-normal rounded-3xl bg-secondary p-3.5 text-left font-sans font-normal hover:bg-secondary/70"
      >
        {/* O Button põe o conteúdo num <span> em linha; este wrapper único empilha rótulo e texto. */}
        <span className="flex w-full min-w-0 flex-col items-start gap-1.5 text-left">
          <span
            className={cn(
              "font-mono text-[10px] font-medium tracking-[0.08em]",
              isOnline ? "text-success" : "text-accent"
            )}
          >
            {isOnline ? "OFFLINE-FIRST" : "SEM CONEXÃO"}
          </span>
          <span className="text-[12px] leading-relaxed text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount} alteraç${pendingCount === 1 ? "ão" : "ões"} aguardando sincronização. Toque para ver.`
              : "Suas notas continuam disponíveis sem conexão."}
          </span>
        </span>
      </Button>

      <Vault open={open} onOpenChange={setOpen}>
        <VaultContent aria-label="Sincronização">
          <VaultHeader>
            <VaultTitle>Sincronização</VaultTitle>
            <VaultDescription>
              {isOnline ? "Conectado." : "Sem conexão."}{" "}
              {items.length === 0
                ? "Tudo o que você fez neste aparelho já está salvo no servidor."
                : `${items.length} ${items.length === 1 ? "alteração aguarda" : "alterações aguardam"} para ser enviada${items.length === 1 ? "" : "s"}.`}
            </VaultDescription>
          </VaultHeader>

          {items.length > 0 && (
            <ul className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto py-2">
              {items.map((item) => {
                const reason = explainSyncError(item.error, isOnline);
                return (
                  <li key={`${item.source}:${item.id}`} className="flex items-start gap-2 rounded-2xl bg-secondary/60 p-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13px] font-medium">
                        {item.label}
                        {item.subject ? <span className="font-normal text-muted-foreground"> · {item.subject}</span> : null}
                      </span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {item.source === "publications" ? "Publicações" : "Notas"}
                        {item.attempts > 0 ? ` · ${item.attempts} ${item.attempts === 1 ? "tentativa" : "tentativas"}` : ""}
                      </span>
                      {reason && <span className="break-words font-mono text-[10.5px] text-accent">{reason}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingDiscard(item)}
                      aria-label="Descartar esta alteração"
                      title="Descartar esta alteração"
                      className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <Button
              variant="default"
              fullWidth
              isLoading={syncing}
              disabled={items.length === 0}
              leftIcon={<RefreshCw />}
              onClick={() => void syncNow()}
            >
              Sincronizar agora
            </Button>
            {items.length > 0 && (
              <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
                Descartar tira só a alteração da fila: o que você escreveu continua neste aparelho, mas não vai para o
                servidor.
              </p>
            )}
          </div>
        </VaultContent>
      </Vault>

      <ConfirmVault
        open={pendingDiscard !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDiscard(null);
        }}
        title="Descartar esta alteração?"
        description="Ela não será enviada ao servidor. O que está neste aparelho não é apagado, mas pode ficar diferente do que está salvo online."
        confirmLabel="Descartar"
        onConfirm={() => {
          if (pendingDiscard) discard(pendingDiscard);
        }}
      />
    </>
  );
}
