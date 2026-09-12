"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookMarked, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { notify } from "@/components/ui/toaster";
import {
  getVideoScriptureStats,
  indexVideoScriptureRefs,
  resetVideoScriptureIndex,
  type ScriptureIndexStats,
} from "@/app/(app)/video-scripture-actions";

/**
 * Runs (and re-runs) the parser that links each JW.org video to the Bible
 * chapters its title and transcript cite — what fills the "Vídeos" tab in the
 * Bible reader's study panel.
 *
 * One batch per call, looped from here rather than a single long Server Action:
 * the whole catalog is 2.460 videos and 16 MB of transcripts, far past what one
 * request should hold open. The loop also means progress is visible instead of
 * the page sitting on a spinner for a minute.
 */
export function VideoScriptureIndexCard() {
  const [stats, setStats] = useState<ScriptureIndexStats>({
    totalVideos: 0,
    indexedVideos: 0,
    pendingVideos: 0,
    totalRefs: 0,
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Lets an unmount stop the loop instead of leaving it running against a
  // screen nobody is looking at.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      setStats(await getVideoScriptureStats());
    } catch (error) {
      console.error("Erro ao carregar estatísticas de referências:", error);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void fetchStats());
  }, [fetchStats]);

  async function handleIndex() {
    setIsIndexing(true);
    let processed = 0;
    let refs = 0;

    try {
      for (;;) {
        if (cancelledRef.current) return;
        const result = await indexVideoScriptureRefs();
        if (!result.ok || !result.progress) {
          notify.error("Erro ao indexar referências", result.error);
          return;
        }

        processed += result.progress.processedVideos;
        refs += result.progress.refsAdded;
        setStats((prev) => ({
          ...prev,
          pendingVideos: result.progress!.pendingVideos,
          indexedVideos: prev.totalVideos - result.progress!.pendingVideos,
          totalRefs: prev.totalRefs + result.progress!.refsAdded,
        }));

        // Nothing left to take: either the queue drained, or this call found
        // no unindexed video to begin with.
        if (result.progress.pendingVideos === 0 || result.progress.processedVideos === 0) break;
      }

      notify.success(
        "Indexação concluída!",
        `${processed.toLocaleString("pt-BR")} vídeos analisados, ${refs.toLocaleString("pt-BR")} referências bíblicas encontradas.`
      );
    } catch {
      notify.error("Não foi possível concluir a indexação.");
    } finally {
      setIsIndexing(false);
      void fetchStats();
    }
  }

  async function handleReset() {
    const result = await resetVideoScriptureIndex();
    if (!result.ok) {
      notify.error("Não foi possível reiniciar", result.error);
      return;
    }
    notify.info("Índice limpo. Rode a indexação novamente.");
    void fetchStats();
  }

  const progressPercent =
    stats.totalVideos > 0 ? Math.round((stats.indexedVideos / stats.totalVideos) * 100) : 0;

  return (
    <>
      <section className="flex w-full flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <BookMarked className="size-4 text-accent" />
              <h2 className="font-heading text-base">Referências bíblicas dos vídeos</h2>
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Liga cada vídeo ao livro e capítulo que ele cita, para aparecerem na aba Vídeos do
              painel de estudo da Bíblia.
            </p>
          </div>

          <Badge variant="outline" className="h-auto shrink-0 rounded-full font-mono text-[10px]">
            {progressPercent}%
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-2xl border border-border/50 bg-secondary/50 p-3.5">
            <span className="text-[11px] font-medium text-muted-foreground">Vídeos analisados</span>
            {isLoadingStats ? (
              <div className="h-7 w-16 animate-pulse rounded bg-muted/60" />
            ) : (
              <span className="font-mono text-lg font-bold text-success">
                {stats.indexedVideos.toLocaleString("pt-BR")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1 rounded-2xl border border-border/50 bg-secondary/50 p-3.5">
            <span className="text-[11px] font-medium text-muted-foreground">Faltando</span>
            {isLoadingStats ? (
              <div className="h-7 w-16 animate-pulse rounded bg-muted/60" />
            ) : (
              <span className="font-mono text-lg font-bold text-accent">
                {stats.pendingVideos.toLocaleString("pt-BR")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1 rounded-2xl border border-border/50 bg-secondary/50 p-3.5">
            <span className="text-[11px] font-medium text-muted-foreground">Referências</span>
            {isLoadingStats ? (
              <div className="h-7 w-16 animate-pulse rounded bg-muted/60" />
            ) : (
              <span className="font-mono text-lg font-bold text-foreground">
                {stats.totalRefs.toLocaleString("pt-BR")}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[12px] text-muted-foreground">
            Vídeos novos são analisados sozinhos na sincronização. Reindexe tudo só depois de mudar
            o parser.
          </span>

          <div className="flex shrink-0 items-center gap-2 max-sm:w-full">
            <Button
              variant="ghost"
              size="sm"
              disabled={isIndexing}
              leftIcon={<RotateCcw className="size-3.5" />}
              onClick={() => setConfirmReset(true)}
              className="rounded-full text-[12.5px]"
            >
              Reindexar tudo
            </Button>
            <Button
              variant="outline"
              size="sm"
              isLoading={isIndexing}
              leftIcon={<RefreshCw className="size-3.5 text-accent" />}
              onClick={() => void handleIndex()}
              className="rounded-full text-[12.5px] max-sm:flex-1"
            >
              {stats.pendingVideos > 0
                ? `Analisar ${stats.pendingVideos.toLocaleString("pt-BR")} vídeos`
                : "Analisar vídeos"}
            </Button>
          </div>
        </div>
      </section>

      <ConfirmVault
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reindexar todos os vídeos?"
        description="Apaga todas as referências já encontradas e marca os 2.460 vídeos para serem analisados de novo. A aba Vídeos fica vazia até a análise terminar."
        confirmLabel="Reindexar"
        onConfirm={() => {
          setConfirmReset(false);
          void handleReset();
        }}
      />
    </>
  );
}
