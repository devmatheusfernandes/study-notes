import { cn } from "@/lib/utils";

export type SyncStatus = "local" | "syncing" | "synced" | "offline";

const STATUS_CONFIG: Record<SyncStatus, { label: string; dotClassName: string }> = {
  local: { label: "Salvo localmente", dotClassName: "bg-accent" },
  syncing: { label: "Sincronizando…", dotClassName: "bg-foreground/35" },
  synced: { label: "Salvo na nuvem", dotClassName: "bg-success" },
  offline: { label: "Sem conexão", dotClassName: "bg-destructive" },
};

interface SyncStatusIndicatorProps {
  status: SyncStatus;
  className?: string;
}

export function SyncStatusIndicator({ status, className }: SyncStatusIndicatorProps) {
  const { label, dotClassName } = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", dotClassName)} />
      {label}
    </span>
  );
}
