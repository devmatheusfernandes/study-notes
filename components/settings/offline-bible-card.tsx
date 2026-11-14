"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { notify } from "@/components/ui/toaster";
import { formatBytes } from "@/lib/format-bytes";
import {
  downloadBible,
  getBibleOfflineInfo,
  removeOfflineBible,
  type BibleOfflineInfo,
} from "@/lib/offline/bible-offline";

/** Keeps the whole Bible on this device so citations (@) and the reader resolve instantly, with no connection. */
export function OfflineBibleCard() {
  const [info, setInfo] = useState<BibleOfflineInfo | null | undefined>(undefined);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(async () => {
    setInfo(await getBibleOfflineInfo());
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function handleDownload() {
    setProgress(0);
    const result = await downloadBible(setProgress);
    setProgress(null);
    if (result.error) notify.error(result.error);
    else notify.success("Bíblia salva neste aparelho");
    await load();
  }

  async function handleRemove() {
    await removeOfflineBible();
    notify.success("Bíblia removida do aparelho");
    await load();
  }

  const downloading = progress !== null;

  return (
    <>
      <section className="flex w-full flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-accent" />
              <h2 className="font-heading text-base">Bíblia offline</h2>
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Salve o texto completo da Bíblia neste aparelho. As citações com @ nas notas aparecem na hora e funcionam
              sem internet.
            </p>
          </div>
          {info && (
            <Badge variant="outline" className="h-auto shrink-0 rounded-full font-mono text-[10px]">
              {formatBytes(info.bytes)}
            </Badge>
          )}
        </div>

        {downloading && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[12px] text-muted-foreground">
            {info
              ? `${info.verseCount.toLocaleString("pt-BR")} versículos · baixada em ${new Date(info.downloadedAt).toLocaleDateString("pt-BR")}`
              : "Cerca de 5 MB. Some ao sair da conta."}
          </span>
          {info === undefined ? null : info ? (
            <Button variant="ghost" size="sm" className="rounded-full text-[12.5px]" onClick={() => setConfirmRemove(true)}>
              Remover
            </Button>
          ) : (
            <Button size="sm" className="rounded-full" disabled={downloading} onClick={() => void handleDownload()}>
              {downloading ? `Baixando… ${Math.round((progress ?? 0) * 100)}%` : "Baixar Bíblia"}
            </Button>
          )}
        </div>
      </section>

      <ConfirmVault
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover a Bíblia do aparelho?"
        description="As citações voltam a buscar o texto na internet. Você pode baixar de novo quando quiser."
        confirmLabel="Remover"
        onConfirm={() => void handleRemove()}
      />
    </>
  );
}
