"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  NotebookPen,
  Play,
  RefreshCw,
  Trash2,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import {
  getVectorQueueDetails,
  processVectorQueue,
  retryQueueItem,
  retryAllFailedQueueItems,
  deleteQueueItem,
  type VectorQueueItemDetails,
} from "@/lib/vector/queue-actions";

function typeIcon(type: string) {
  if (type === "pdf" || type === "jwpub") return FileText;
  return NotebookPen;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "agora mesmo";
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `há ${hours}h`;
}

export function VectorQueueCard() {
  const [items, setItems] = useState<VectorQueueItemDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const data = await getVectorQueueDetails();
      setItems(data);
    } catch {
      // silent fetch failure
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getVectorQueueDetails()
      .then((data) => {
        if (mounted) {
          setItems(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Live polling every 4 seconds when autoRefresh is active
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchItems();
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchItems]);

  async function handleProcessNow() {
    setIsProcessing(true);
    try {
      const result = await processVectorQueue();
      notify.success(
        `Fila processada: ${result.processed} item(ns) concluído(s), ${result.errors} erro(s).`
      );
      await fetchItems();
    } catch {
      notify.error("Erro ao processar a fila.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleRetryItem(id: string) {
    const res = await retryQueueItem(id);
    if (res.error) {
      notify.error(res.error);
    } else {
      notify.success("Item colocado na fila novamente.");
      await fetchItems();
    }
  }

  async function handleRetryAll() {
    const res = await retryAllFailedQueueItems();
    if (res.error) {
      notify.error(res.error);
    } else {
      notify.success(`${res.count} item(ns) reiniciado(s) na fila.`);
      await fetchItems();
    }
  }

  async function handleDeleteItem(id: string) {
    const res = await deleteQueueItem(id);
    if (res.error) {
      notify.error(res.error);
    } else {
      notify.success("Item removido da fila.");
      setItems((prev) => prev.filter((i) => i.id !== id));
    }
  }

  const pendingCount = items.filter(
    (i) => i.status === "pending" || i.status === "processing"
  ).length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const completedCount = items.filter((i) => i.status === "completed").length;

  return (
    <div className="flex w-full flex-col gap-5 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent shadow-inner">
            <RefreshCw className={cn("size-4", isProcessing && "animate-spin")} />
          </span>
          <div className="flex flex-col gap-0.5">
            <h3 className="font-heading text-base text-foreground">Fila de Vetorização</h3>
            <p className="text-[12.5px] text-muted-foreground">
              Acompanhe e gerencie o processamento de notas e documentos em tempo real.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap max-sm:w-full max-sm:justify-between">
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors border",
              autoRefresh
                ? "border-success/30 bg-success/15 text-success"
                : "border-border bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                autoRefresh ? "animate-pulse bg-success" : "bg-muted-foreground"
              )}
            />
            {autoRefresh ? "Tempo Real On" : "Pausado"}
          </button>

          <Button
            variant="outline"
            size="sm"
            isLoading={isLoading}
            onClick={() => void fetchItems()}
            leftIcon={<RefreshCw className="size-3.5 text-muted-foreground" />}
            className="rounded-full text-[12px]"
          >
            Atualizar
          </Button>

          <Button
            variant="default"
            size="sm"
            isLoading={isProcessing}
            onClick={() => void handleProcessNow()}
            leftIcon={<Play className="size-3.5 fill-current" />}
            className="rounded-full text-[12px]"
          >
            Processar Agora
          </Button>
        </div>
      </div>

      {/* Proportional Summary Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1 rounded-2xl bg-secondary/50 p-3.5 border border-border/50">
          <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground truncate">
            Total na Fila
          </span>
          {isLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted/60" />
          ) : (
            <span className="font-heading text-xl text-foreground">{items.length}</span>
          )}
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-accent/10 p-3.5 border border-accent/20">
          <span className="font-mono text-[10px] tracking-wider uppercase text-accent truncate">
            Pendentes
          </span>
          {isLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted/60" />
          ) : (
            <span className="font-heading text-xl text-accent">{pendingCount}</span>
          )}
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-destructive/10 p-3.5 border border-destructive/20">
          <span className="font-mono text-[10px] tracking-wider uppercase text-destructive truncate">
            Com Erro
          </span>
          {isLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted/60" />
          ) : (
            <span className="font-heading text-xl text-destructive">{failedCount}</span>
          )}
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-success/10 p-3.5 border border-success/20">
          <span className="font-mono text-[10px] tracking-wider uppercase text-success truncate">
            Concluídos
          </span>
          {isLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted/60" />
          ) : (
            <span className="font-heading text-xl text-success">{completedCount}</span>
          )}
        </div>
      </div>

      {/* Error Alert Banner */}
      {failedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[12.5px] text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>Existem {failedCount} item(ns) com erro no processamento.</span>
          </div>
          <button
            type="button"
            onClick={() => void handleRetryAll()}
            className="rounded-full bg-destructive/20 px-3.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-destructive/30"
          >
            Tentar Todos Novamente
          </button>
        </div>
      )}

      {/* Item List Container */}
      <div className="flex flex-col gap-2.5 pt-1">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-secondary/30 p-3.5 animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-xl bg-muted/60" />
                <div className="flex flex-col gap-1.5">
                  <div className="h-4 w-40 rounded bg-muted/60" />
                  <div className="h-3 w-24 rounded bg-muted/60" />
                </div>
              </div>
              <div className="h-6 w-20 rounded-full bg-muted/60" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-8 px-4 rounded-2xl border border-dashed border-border bg-secondary/20 text-center">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-success/15 text-success">
              <CheckCircle2 className="size-5" />
            </div>
            <div className="flex flex-col gap-0.5 max-w-sm">
              <span className="font-heading text-sm text-foreground">Fila de vetorização em dia</span>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Todas as suas notas e arquivos foram processados e estão prontos para busca inteligente.
              </p>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {items.map((item) => {
              const Icon = typeIcon(item.noteType);
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="flex flex-col gap-2 rounded-2xl border border-border/50 bg-secondary/30 p-3.5 hover:border-border transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground border border-border/40">
                        <Icon className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13.5px] font-medium text-foreground">
                          {item.noteTitle}
                        </span>
                        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground flex-wrap">
                          <span className="font-mono text-[10.5px] uppercase text-accent font-medium">
                            {item.noteType}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {formatRelativeTime(item.updatedAt)}
                          </span>
                          {item.attempts > 0 && (
                            <>
                              <span>•</span>
                              <span>{item.attempts} tentativa(s)</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.status === "pending" && (
                        <Badge variant="outline" className="gap-1 border-accent/40 text-accent">
                          <Clock className="size-3" />
                          Pendente
                        </Badge>
                      )}
                      {item.status === "processing" && (
                        <Badge variant="outline" className="gap-1 border-accent/40 text-accent">
                          <Loader2 className="size-3 animate-spin" />
                          Processando
                        </Badge>
                      )}
                      {item.status === "completed" && (
                        <Badge variant="success" className="gap-1">
                          <CheckCircle2 className="size-3" />
                          Vetorizado
                        </Badge>
                      )}
                      {item.status === "failed" && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="size-3" />
                          Falhou
                        </Badge>
                      )}

                      <div className="flex items-center gap-1 border-l border-border/40 pl-2">
                        <button
                          type="button"
                          onClick={() => void handleRetryItem(item.id)}
                          title="Reprocessar item"
                          aria-label="Reprocessar item"
                          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <RefreshCw className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteItem(item.id)}
                          title="Remover da fila"
                          aria-label="Remover da fila"
                          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {item.error && (
                    <div className="rounded-xl bg-destructive/10 p-2.5 text-[11.5px] font-mono text-destructive">
                      {item.error}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
