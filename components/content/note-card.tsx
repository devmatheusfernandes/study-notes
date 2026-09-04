"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookMarked,
  Check,
  File,
  FileSpreadsheet,
  FileText,
  FileType,
  MoreHorizontal,
  NotebookPen,
  Pin,
  PinOff,
  Sparkles,
  Tags,
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
import { Checkbox } from "@/components/ui/checkbox";
import { SyncStatusIndicator, type SyncStatus } from "./sync-status";
import { parseNotePreview } from "@/lib/note-preview";
import { TagDot, TagPill } from "./tag-pill";
import type { Tag } from "@/lib/store/notes-store";

/** Cards only render a handful of tag pills before collapsing the rest into "+N". */
const MAX_TAG_PILLS = 3;

export type ContentType = "nota" | "pdf" | "docx" | "xlsx" | "jwpub" | "jwlibrary" | "arquivo";

const TYPE_CONFIG: Record<ContentType, { label: string; icon: LucideIcon; className: string }> = {
  nota: { label: "NOTA", icon: NotebookPen, className: "bg-primary/[0.18] text-accent" },
  pdf: { label: "PDF", icon: FileText, className: "bg-foreground/10 text-foreground/80" },
  docx: { label: "DOCX", icon: FileType, className: "bg-foreground/10 text-foreground/80" },
  xlsx: { label: "XLSX", icon: FileSpreadsheet, className: "bg-foreground/10 text-foreground/80" },
  jwpub: { label: "JWPUB", icon: FileText, className: "bg-[#8B5CF6]/20 text-[#8B5CF6]" },
  jwlibrary: { label: "BACKUP", icon: BookMarked, className: "bg-sky-500/20 text-sky-400" },
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
  vectorStatus?: "completed" | "pending" | "processing" | "failed" | "none";
  /** Still uploading or (for .jwpub) being ingested — not clickable, shows a "Processando…" badge, and flashes once when it flips back to false. */
  processing?: boolean;
  pinned?: boolean;
  variant?: "grid" | "list";
  /** Whether `onDelete` removes the item for good (trash screen) vs. moves it to the trash. */
  permanentDelete?: boolean;
  /** Bulk-selection state, driven by the parent from `useSelectionStore`. */
  selectionMode?: boolean;
  selected?: boolean;
  /** Resolved tag objects assigned to this item — passed pre-mapped by the parent, which already holds the full tag list. */
  tags?: Tag[];
  onToggleSelect?: (id: string) => void;
  onOpen?: () => void;
  onTogglePin?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  onManageTags?: () => void;
  /** Checks/unchecks one of the checklist items shown in the preview, by its index among all of them. */
  onToggleChecklistItem?: (index: number) => void;
}

export function NoteCard({
  id,
  type,
  title,
  body,
  description,
  meta,
  syncStatus,
  vectorStatus = "none",
  processing = false,
  pinned = false,
  variant = "grid",
  permanentDelete = false,
  selectionMode = false,
  selected = false,
  tags = [],
  onToggleSelect,
  onOpen,
  onTogglePin,
  onRename,
  onArchive,
  onRestore,
  onDelete,
  onManageTags,
  onToggleChecklistItem,
}: NoteCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const config = TYPE_CONFIG[type];
  const isList = variant === "list";

  // Text notes carry rich HTML (formatting preserved in the excerpt); files
  // just carry a plain one-line description (e.g. "2.3 MB") — only the
  // former is worth parsing for a checklist/image.
  const preview = type === "nota" ? parseNotePreview(body ?? "") : undefined;
  const previewHtml = preview ? preview.html : undefined;
  const plainText = !preview && description ? toPreview(description) : undefined;
  const checklist = preview?.checklist;
  const checklistRemaining = preview?.checklistRemaining ?? 0;
  const previewImageUrl = checklist ? undefined : preview?.imageUrl;

  const visibleTags = tags.slice(0, MAX_TAG_PILLS);
  const overflowTagCount = tags.length - visibleTags.length;

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handlePointerDown() {
    if (processing) return;
    if (selectionMode) return; // already in selection mode — a plain click toggles.
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onToggleSelect?.(id);
    }, LONG_PRESS_MS);
  }

  function handleOpen() {
    if (processing) return;
    // Swallow the click that fires right after a long-press triggers selection.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selectionMode) onToggleSelect?.(id);
    else onOpen?.();
  }

  // Flashes once when `processing` flips from true to false — i.e. the
  // upload/ingest that was gating this card just finished.
  const wasProcessing = useRef(processing);
  const [justReady, setJustReady] = useState(false);
  useEffect(() => {
    if (wasProcessing.current && !processing) {
      setJustReady(true);
      const timer = setTimeout(() => setJustReady(false), 900);
      wasProcessing.current = processing;
      return () => clearTimeout(timer);
    }
    wasProcessing.current = processing;
  }, [processing]);

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

  const hasMenuItems = Boolean(
    (onToggleSelect && !selected) || onTogglePin || onRename || onManageTags || onArchive || onRestore || onDelete
  );
  const menu = hasMenuItems && (
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
        {onManageTags && (
          <DropdownMenuItem onSelect={onManageTags}>
            <Tags className="size-4" />
            Gerenciar tags
          </DropdownMenuItem>
        )}
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
          "group flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-700",
          pinned ? "bg-primary/[0.12] ring-1 ring-primary/25" : "bg-secondary hover:bg-surface",
          processing && "opacity-60",
          justReady && "ring-2 ring-accent shadow-[0_0_20px_-4px_var(--accent)]"
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
          disabled={processing}
          aria-disabled={processing}
          {...openButtonProps}
          className={cn(
            "group/open flex min-w-0 flex-1 flex-col text-left",
            processing && "cursor-progress"
          )}
          style={{ touchAction: "manipulation" }}
        >
          <span className="truncate font-heading text-[15px] transition-colors group-hover/open:text-accent">
            {title}
          </span>
          {checklist ? (
            <span className="truncate text-[12.5px] text-muted-foreground">
              {checklist.filter((i) => i.checked).length}/
              {checklist.length + (checklistRemaining ?? 0)} concluídas
            </span>
          ) : previewHtml ? (
            <span
              className="truncate text-[12.5px] text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            plainText && <span className="truncate text-[12.5px] text-muted-foreground">{plainText}</span>
          )}
        </button>

        {tags.length > 0 && (
          <span className="hidden shrink-0 items-center gap-1 sm:flex" title={tags.map((t) => t.name).join(", ")}>
            {tags.slice(0, 5).map((tag) => (
              <TagDot key={tag.id} color={tag.color} />
            ))}
          </span>
        )}
        <span className="hidden shrink-0 text-[11.5px] text-muted-foreground sm:block">{meta}</span>
        {processing && (
          <span
            title="Processando…"
            className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9.5px] font-medium text-amber-400 border border-amber-500/25 sm:inline-flex"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
            Processando…
          </span>
        )}
        {!processing && vectorStatus === "completed" && (
          <span title="Vetorizado com IA" className="hidden shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[9.5px] font-medium text-accent border border-accent/25 sm:inline-flex">
            <Sparkles className="size-2.5" />
            Vetorizado
          </span>
        )}
        {!processing && (vectorStatus === "pending" || vectorStatus === "processing") && (
          <span title="Vetorização em andamento" className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9.5px] font-medium text-amber-400 border border-amber-500/25 sm:inline-flex">
            <Sparkles className="size-2.5 animate-pulse" />
            Vetorizando…
          </span>
        )}
        {pinButton}
        {menu}
        {confirmDialog}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex flex-col gap-2.5 rounded-3xl border p-4 transition-all duration-700",
        pinned
          ? "border-transparent bg-primary/[0.12] ring-1 ring-primary/25"
          : "border-transparent bg-secondary hover:border-accent/40",
        processing && "opacity-60",
        justReady && "ring-2 ring-accent shadow-[0_0_24px_-4px_var(--accent)]"
      )}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
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
        {processing && (
          <span
            title="Processando…"
            className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9.5px] font-medium text-amber-400 border border-amber-500/25"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
            Processando…
          </span>
        )}
        {!processing && vectorStatus === "completed" && (
          <span
            title="Vetorizado com IA"
            className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[9.5px] font-medium text-accent border border-accent/25"
          >
            <Sparkles className="size-2.5 text-accent" />
            Vetorizado
          </span>
        )}
        {!processing && (vectorStatus === "pending" || vectorStatus === "processing") && (
          <span
            title="Vetorização em andamento"
            className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9.5px] font-medium text-amber-400 border border-amber-500/25"
          >
            <Sparkles className="size-2.5 animate-pulse text-amber-400" />
            Vetorizando…
          </span>
        )}
        {!processing && vectorStatus === "failed" && (
          <span
            title="Falha ao vetorizar"
            className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 font-mono text-[9.5px] font-medium text-destructive border border-destructive/25"
          >
            Sem vetor
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {pinButton}
          {menu}
        </span>
      </div>

      <button
        type="button"
        onClick={handleOpen}
        disabled={processing}
        aria-disabled={processing}
        {...openButtonProps}
        className={cn(
          "group/open flex flex-col gap-1.5 text-left",
          processing ? "cursor-progress" : "cursor-pointer"
        )}
        style={{ touchAction: "manipulation" }}
      >
        <span className="font-heading text-[17px] leading-tight text-balance transition-colors group-hover/open:text-accent">
          {title}
        </span>

        {previewImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- public Storage URL, not a local asset Next can optimize
          <img
            src={previewImageUrl}
            alt=""
            className="max-h-40 w-full rounded-xl object-cover"
          />
        )}

        {!checklist && previewHtml && (
          <span
            className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground text-pretty"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
        {!checklist && plainText && (
          <span className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            {plainText}
          </span>
        )}
      </button>

      {/* Deliberately a sibling of the open-button above, not nested inside
          it — these need their own click target (toggle the item) that's
          fully independent of "open the note", not just a stopped click
          bubble inside an interactive element. */}
      {checklist && (
        <ul className="flex flex-1 flex-col gap-0.5">
          {checklist.map((item, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleChecklistItem?.(i);
                }}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="shrink-0 cursor-pointer">
                  {/* The row's own button (above) drives the toggle — this is
                      display-only, so it doesn't double-fire on click. */}
                  <Checkbox checked={item.checked} className="pointer-events-none hover:bg-muted" tabIndex={-1} readOnly />
                </span>
                <span
                  className={cn(
                    "text-pretty text-[12.5px] leading-relaxed text-muted-foreground hover:text-foreground transition-colors duration-150 ease-out",
                    item.checked && "text-muted-foreground/50 line-through"
                  )}
                >
                  {item.text}
                </span>
              </button>
            </li>
          ))}
          {checklistRemaining > 0 && (
            <li className="pl-[26px] text-[12px] text-muted-foreground/70">+{checklistRemaining} mais</li>
          )}
        </ul>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {visibleTags.map((tag) => (
            <TagPill key={tag.id} tag={tag} />
          ))}
          {overflowTagCount > 0 && (
            <span className="text-[11px] text-muted-foreground/70">+{overflowTagCount} mais</span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground/70">
        <span>{meta}</span>
        {syncStatus && <SyncStatusIndicator status={syncStatus} />}
      </div>
      {confirmDialog}
    </div>
  );
}
