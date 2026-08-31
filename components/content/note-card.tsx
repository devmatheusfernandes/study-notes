"use client";

import { useRef, useState } from "react";
import {
  Check,
  File,
  FileSpreadsheet,
  FileText,
  FileType,
  MoreHorizontal,
  NotebookPen,
  Pin,
  PinOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { SyncStatusIndicator, type SyncStatus } from "./sync-status";

export type ContentType = "nota" | "pdf" | "docx" | "xlsx" | "jwpub" | "arquivo";

const TYPE_CONFIG: Record<ContentType, { label: string; icon: LucideIcon; className: string }> = {
  nota: { label: "NOTA", icon: NotebookPen, className: "bg-primary/[0.18] text-accent" },
  pdf: { label: "PDF", icon: FileText, className: "bg-foreground/10 text-foreground/80" },
  docx: { label: "DOCX", icon: FileType, className: "bg-foreground/10 text-foreground/80" },
  xlsx: { label: "XLSX", icon: FileSpreadsheet, className: "bg-foreground/10 text-foreground/80" },
  jwpub: { label: "JWPUB", icon: FileText, className: "bg-success/20 text-success" },
  arquivo: { label: "ARQUIVO", icon: File, className: "bg-foreground/10 text-foreground/80" },
};

/** Cards are previews — long notes would otherwise blow out a masonry column. */
const MAX_PREVIEW_CHARS = 220;

function toPreview(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_PREVIEW_CHARS) return normalized;
  const cut = normalized.slice(0, MAX_PREVIEW_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : MAX_PREVIEW_CHARS).trimEnd()}…`;
}

/** How long a press must be held to enter selection mode — the only way to
 * reach the checkbox on touch devices, which have no hover. */
const LONG_PRESS_MS = 450;

export interface NoteCardProps {
  id: string;
  type: ContentType;
  title: string;
  /** Full note body — rendered untruncated (up to the preview cap) in grid view, which is what gives the masonry its varied heights. */
  body?: string;
  /** Short one-line summary used instead of `body` for file-type entries. */
  description?: string;
  meta: string;
  syncStatus?: SyncStatus;
  pinned?: boolean;
  variant?: "grid" | "list";
  /** Whether `onDelete` removes the item for good (trash screen) vs. moves it to the trash. */
  permanentDelete?: boolean;
  /** Bulk-selection state, driven by the parent from `useSelectionStore`. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onOpen?: () => void;
  onTogglePin?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}

export function NoteCard({
  id,
  type,
  title,
  body,
  description,
  meta,
  syncStatus,
  pinned = false,
  variant = "grid",
  permanentDelete = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onOpen,
  onTogglePin,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: NoteCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const config = TYPE_CONFIG[type];
  const raw = body ?? description;
  const text = raw ? toPreview(raw) : undefined;
  const isList = variant === "list";

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handlePointerDown() {
    if (selectionMode) return; // already in selection mode — a plain click toggles.
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onToggleSelect?.(id);
    }, LONG_PRESS_MS);
  }

  function handleOpen() {
    // Swallow the click that fires right after a long-press triggers selection.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selectionMode) onToggleSelect?.(id);
    else onOpen?.();
  }

  const openButtonProps = onToggleSelect
    ? {
        onPointerDown: handlePointerDown,
        onPointerUp: clearLongPress,
        onPointerLeave: clearLongPress,
        onPointerCancel: clearLongPress,
      }
    : undefined;

  // Collapsed to zero width at rest (not just hidden) so it doesn't reserve
  // layout space — the badge/icon next to it sits flush until hover pushes
  // it over. Expanded permanently once something's selected, so multi-select
  // doesn't need re-hovering every card.
  const checkboxExpanded = selectionMode || selected;
  const checkbox = onToggleSelect && (
    <span
      className={cn(
        "inline-block shrink-0 overflow-hidden transition-[width,margin-right] duration-200 ease-out",
        checkboxExpanded ? "mr-2 w-5" : "mr-0 w-0 group-hover:mr-2 group-hover:w-5"
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(id);
        }}
        aria-label={selected ? `Remover ${title} da seleção` : `Selecionar ${title}`}
        aria-pressed={selected}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background/60 text-transparent hover:border-accent"
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </button>
    </span>
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Mais opções para ${title}`}
          className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onToggleSelect && !selected && (
          <DropdownMenuItem onSelect={() => onToggleSelect(id)}>
            <Check className="size-4" />
            Selecionar
          </DropdownMenuItem>
        )}
        {onTogglePin && (
          <DropdownMenuItem onSelect={onTogglePin}>
            {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {pinned ? "Desafixar" : "Fixar no topo"}
          </DropdownMenuItem>
        )}
        {onRename && <DropdownMenuItem onSelect={onRename}>Renomear</DropdownMenuItem>}
        {onArchive && <DropdownMenuItem onSelect={onArchive}>Arquivar</DropdownMenuItem>}
        {onRestore && <DropdownMenuItem onSelect={onRestore}>Restaurar</DropdownMenuItem>}
        {onDelete && (
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            {permanentDelete ? "Excluir definitivamente" : "Excluir"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const pinButton = onTogglePin && (
    <button
      type="button"
      onClick={onTogglePin}
      aria-label={pinned ? `Desafixar ${title}` : `Fixar ${title}`}
      aria-pressed={pinned}
      className={cn(
        "shrink-0 rounded-full p-1 transition-colors",
        pinned
          ? "text-accent hover:bg-background"
          : "text-muted-foreground hover:bg-background hover:text-foreground"
      )}
    >
      <Pin className={cn("size-4", pinned && "fill-current")} />
    </button>
  );

  const confirmDialog = onDelete && (
    <ConfirmVault
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title={permanentDelete ? "Excluir definitivamente?" : "Excluir?"}
      description={
        permanentDelete
          ? `"${title}" será removida para sempre. Essa ação não pode ser desfeita.`
          : `"${title}" vai para a lixeira e pode ser restaurada depois.`
      }
      confirmLabel={permanentDelete ? "Excluir definitivamente" : "Excluir"}
      onConfirm={onDelete}
    />
  );

  if (isList) {
    return (
      <div
        className={cn(
          "group flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors",
          pinned ? "bg-primary/[0.12] ring-1 ring-primary/25" : "bg-secondary hover:bg-surface"
        )}
      >
        {checkbox}
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl",
            config.className
          )}
        >
          <config.icon className="size-4" />
        </span>

        <button
          type="button"
          onClick={handleOpen}
          {...openButtonProps}
          className="flex min-w-0 flex-1 flex-col text-left"
          style={{ touchAction: "manipulation" }}
        >
          <span className="truncate font-heading text-[15px]">{title}</span>
          {text && (
            <span className="truncate text-[12.5px] text-muted-foreground">{text}</span>
          )}
        </button>

        <span className="hidden shrink-0 text-[11.5px] text-muted-foreground sm:block">{meta}</span>
        {pinButton}
        {menu}
        {confirmDialog}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex flex-col gap-2.5 rounded-3xl border p-4 transition-colors",
        pinned
          ? "border-transparent bg-primary/[0.12] ring-1 ring-primary/25"
          : "border-transparent bg-secondary hover:border-accent/40"
      )}
    >
      <div className="flex items-start">
        {checkbox}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium",
            config.className
          )}
        >
          <config.icon className="size-2.5" />
          {config.label}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {pinButton}
          {menu}
        </span>
      </div>

      <button
        type="button"
        onClick={handleOpen}
        {...openButtonProps}
        className="flex flex-1 flex-col gap-1.5 text-left"
        style={{ touchAction: "manipulation" }}
      >
        <span className="font-heading text-[17px] leading-tight text-balance">{title}</span>
        {text && (
          <span className="text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            {text}
          </span>
        )}
      </button>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground/70">
        <span>{meta}</span>
        {syncStatus && <SyncStatusIndicator status={syncStatus} />}
      </div>
      {confirmDialog}
    </div>
  );
}
