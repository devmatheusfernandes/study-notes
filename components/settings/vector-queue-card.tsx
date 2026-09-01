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
    <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <RefreshCw className={cn("size-4", isProcessing && "animate-spin")} />
          </span>
          <div>
            <h3 className="font-heading text-base">Fila de Vetorização</h3>
            <p className="text-[12px] text-muted-foreground">
              Acompanhe e gerencie o processamento de notas e documentos em tempo real.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
              autoRefresh
                ? "bg-success/15 text-success"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
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
            className="h-8 gap-1.5 rounded-full text-[12px]"
          >
            <RefreshCw className="size-3.5 pr-2" />
            Atualizar
          </Button>

          <Button
            variant="default"
            size="sm"
            isLoading={isProcessing}
            onClick={() => void handleProcessNow()}
            className="h-8 gap-1.5 rounded-full text-[12px]"
          >
            <Play className="size-3.5 pr-2" />
            Processar Agora
          </Button>
        </div>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5 rounded-2xl bg-secondary/60 p-3">
          <span className="font-mono text-[10px] text-muted-foreground">TOTAL NA FILA</span>
          {isLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted/60 mt-0.5" />
          ) : (
            <span className="font-heading text-lg">{items.length}</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-2xl bg-accent/10 p-3">
          <span className="font-mono text-[10px] text-accent">PENDENTES / PROCESSANDO</span>
          {isLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted/60 mt-0.5" />
          ) : (
            <span className="font-heading text-lg text-accent">{pendingCount}</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-2xl bg-destructive/10 p-3">
          <span className="font-mono text-[10px] text-destructive">COM ERRO</span>
          {isLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted/60 mt-0.5" />
          ) : (
            <span className="font-heading text-lg text-destructive">{failedCount}</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-2xl bg-success/10 p-3">
          <span className="font-mono text-[10px] text-success">CONCLUÍDOS</span>
          {isLoading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted/60 mt-0.5" />
          ) : (
            <span className="font-heading text-lg text-success">{completedCount}</span>
          )}
        </div>
      </div>

      {failedCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-[12.5px] text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>Existem {failedCount} item(ns) com erro na fila.</span>
          </div>
          <button
            type="button"
            onClick={() => void handleRetryAll()}
            className="rounded-full bg-destructive/20 px-3 py-1 text-[11.5px] font-medium transition-colors hover:bg-destructive/30"
          >
            Tentar Todos Novamente
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-surface p-3.5 h-[76px] animate-pulse">
              <div className="flex items-center gap-3">
                <div className="size-7 rounded-xl bg-muted/60" />
                <div className="flex flex-col gap-1.5 flex-1">
                  <div className="h-3 w-1/3 rounded bg-muted/60" />
                  <div className="h-2.5 w-1/4 rounded bg-muted/60" />
                </div>
                <div className="h-5 w-20 rounded-full bg-muted/60" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
            <CheckCircle2 className="size-8 text-success/60" />
            <p className="text-[13px]">A fila de vetorização está totalmente limpa.</p>
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
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-surface p-3.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                        <Icon className="size-3.5" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13.5px] font-medium text-foreground">
                          {item.noteTitle}
                        </span>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="font-mono uppercase">{item.noteType}</span>
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

                      <div className="flex items-center gap-1">
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
