"use client";

import { useEffect, useState, useTransition } from "react";
import { Brain, Coins, Database, Layers, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/components/ui/toaster";
import { getAiUsageStats, revectorizeAllNotes, processVectorQueue, type AiUsageStats } from "@/lib/vector/queue-actions";

export function AiUsageCard() {
  const [stats, setStats] = useState<AiUsageStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoading(true);
    });

    void getAiUsageStats()
      .then((res) => {
        if (cancelled) return;
        setStats(res);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        notify.error("Não foi possível carregar as estatísticas de IA.");
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRevectorizeAll = () => {
    startTransition(async () => {
      try {
        const res = await revectorizeAllNotes();
        if (res.error) {
          notify.error("Erro ao iniciar re-vetorização", res.error);
          return;
        }
        notify.success(`${res.enqueued} nota(s) enfileirada(s) para vetorização.`);
        await processVectorQueue();
        const freshStats = await getAiUsageStats();
        setStats(freshStats);
      } catch {
        notify.error("Ocorreu uma falha ao re-vetorizar as notas.");
      }
    });
  };

  const formattedCostUsd = stats
    ? stats.totalCostUsd < 0.001 && stats.totalCostUsd > 0
      ? "< $0,001"
      : `$ ${stats.totalCostUsd.toFixed(4).replace(".", ",")}`
    : "$ 0,00";

  const formattedCostBrl = stats
    ? stats.totalCostBrl < 0.01 && stats.totalCostBrl > 0
      ? "< R$ 0,01"
      : `R$ ${stats.totalCostBrl.toFixed(3).replace(".", ",")}`
    : "R$ 0,00";

  return (
    <section className="flex w-full flex-col gap-5 rounded-3xl bg-card p-5 sm:p-6 shadow-sm border border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-lg">Inteligência Artificial & Vetorização</h2>
            <Badge variant="outline" className="gap-1 font-mono text-[10px]">
              <Sparkles className="size-3 text-accent" />
              OpenAI
            </Badge>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Acompanhamento de consumo de tokens, estimativa de custos e vetorização para busca RAG.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-2xl bg-secondary/50 p-4 border border-border/50">
              <div className="flex items-center gap-1.5">
                <div className="size-3.5 rounded-full bg-muted/60 animate-pulse" />
                <div className="h-3 w-24 rounded bg-muted/60 animate-pulse" />
              </div>
              <div className="h-7 w-20 mt-1 rounded bg-muted/60 animate-pulse" />
              <div className="h-2.5 w-16 mt-0.5 rounded bg-muted/60 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-2xl bg-secondary/50 p-4 border border-border/50">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Coins className="size-3.5 text-accent" />
                <span>Custo Estimado</span>
              </div>
              <span className="font-heading text-xl tracking-tight text-foreground">
                {formattedCostUsd}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                ({formattedCostBrl})
              </span>
            </div>

            <div className="flex flex-col gap-1 rounded-2xl bg-secondary/50 p-4 border border-border/50">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Brain className="size-3.5 text-accent" />
                <span>Tokens Consumidos</span>
              </div>
              <span className="font-heading text-xl tracking-tight text-foreground">
                {stats?.totalTokens.toLocaleString("pt-BR") ?? 0}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                text-embedding-3-small
              </span>
            </div>

            <div className="flex flex-col gap-1 rounded-2xl bg-secondary/50 p-4 border border-border/50">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Database className="size-3.5 text-accent" />
                <span>Notas no Banco</span>
              </div>
              <span className="font-heading text-xl tracking-tight text-foreground">
                {stats?.vectorizedNotesCount ?? 0}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {stats?.vectorizedChunksCount ?? 0} trechos (chunks)
              </span>
            </div>

            <div className="flex flex-col gap-1 rounded-2xl bg-secondary/50 p-4 border border-border/50">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Layers className="size-3.5 text-accent" />
                <span>Fila de Processamento</span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                {stats?.queuePendingCount ? (
                  <Badge variant="outline" className="text-[10px] text-accent border-accent/40">
                    {stats.queuePendingCount} pendente(s)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-success border-success/40">
                    Em dia
                  </Badge>
                )}
                {!!stats?.queueFailedCount && (
                  <Badge variant="destructive" className="text-[10px]">
                    {stats.queueFailedCount} com erro
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw />}
              isLoading={isPending}
              onClick={handleRevectorizeAll}
              fullWidth
            >
              Re-vetorizar todas as notas
            </Button>
            <p className="text-[11px] text-muted-foreground/80 text-center leading-relaxed">
              O modelo <code>text-embedding-3-small</code> custa aprox. <strong>US$ 0,02 por 1 milhão de tokens</strong> (~R$ 0,11).
            </p>
          </div>
        </>
      )}
    </section>
  );
}
