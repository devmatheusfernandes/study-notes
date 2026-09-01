"use client";

import { useEffect, useState } from "react";
import { Film, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/components/ui/toaster";
import { getGlobalVideoStats, syncGlobalJwVideos, type GlobalVideoStats } from "@/app/(app)/global-video-actions";

export function GlobalVideoSyncCard() {
  const [stats, setStats] = useState<GlobalVideoStats>({
    totalVideos: 0,
    vectorizedCount: 0,
    pendingCount: 0,
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchStats = async () => {
    try {
      const data = await getGlobalVideoStats();
      setStats(data);
    } catch (err) {
      console.error("Erro ao carregar estatísticas de vídeos:", err);
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void fetchStats());
    const interval = setInterval(() => void fetchStats(), 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await syncGlobalJwVideos();
      if (result.ok) {
        notify.success("Sincronização concluída!", result.message);
        void fetchStats();
      } else {
        notify.error("Erro na sincronização", result.error);
      }
    } catch {
      notify.error("Não foi possível iniciar a sincronização.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <section className="flex w-full flex-col gap-5 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <Film className="size-4 text-accent" />
            <h2 className="font-heading text-base">Biblioteca Global de Vídeos JW.org</h2>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            Acervo compartilhado de vídeos e transcrições do JW.org para busca semântica no chat.
          </p>
        </div>

        <Badge variant="outline" className="h-auto shrink-0 rounded-full font-mono text-[10px]">
          Global & Compartilhado
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-2xl bg-secondary/50 p-3.5 border border-border/50">
          <span className="text-[11px] font-medium text-muted-foreground">Vídeos no Banco</span>
          <span className="font-mono text-lg font-bold text-foreground">
            {isLoadingStats ? "…" : stats.totalVideos.toLocaleString("pt-BR")}
          </span>
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-secondary/50 p-3.5 border border-border/50">
          <span className="text-[11px] font-medium text-muted-foreground">Vetorizados (RAG)</span>
          <span className="flex items-center gap-1.5 font-mono text-lg font-bold text-success">
            {isLoadingStats ? "…" : stats.vectorizedCount.toLocaleString("pt-BR")}
          </span>
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-secondary/50 p-3.5 border border-border/50">
          <span className="text-[11px] font-medium text-muted-foreground">Pendentes na Fila</span>
          <span className="font-mono text-lg font-bold text-accent">
            {isLoadingStats ? "…" : stats.pendingCount.toLocaleString("pt-BR")}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[12px] text-muted-foreground">
          A sincronização faz a varredura de novos lançamentos semanais sem duplicar os existentes.
        </span>

        <Button
          variant="outline"
          size="sm"
          isLoading={isSyncing}
          leftIcon={<RefreshCw className="size-3.5 text-accent" />}
          onClick={() => void handleSync()}
          className="rounded-full text-[12.5px] max-sm:w-full"
        >
          Sincronizar novos vídeos
        </Button>
      </div>
    </section>
  );
}
