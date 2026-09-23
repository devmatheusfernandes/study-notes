"use client";

import { useRouter } from "next/navigation";
import { Book, BookText, FileText, History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Vault,
  VaultBody,
  VaultContent,
  VaultHeader,
  VaultTitle,
  VaultDescription,
} from "@/components/ui/vault";
import { useNavigationHistoryStore, type HistoryEntry } from "@/lib/store/navigation-history-store";
import { useHistoryVaultUiStore } from "@/lib/store/history-vault-ui-store";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<HistoryEntry["type"], typeof FileText> = {
  note: FileText,
  publication: BookText,
  bible: Book,
};

const TYPE_LABEL: Record<HistoryEntry["type"], string> = {
  note: "Nota",
  publication: "Publicação",
  bible: "Bíblia",
};

/** "Agora" / "há N min" / "há N h" / "27 ago" — kept separate from lib/format-date.ts's formatRelativeMeta, whose "Editado há…" wording is specific to a note's own last-save time, not "when this was opened". */
function formatVisitedAt(timestamp: number): string {
  const diffMin = Math.floor((Date.now() - timestamp) / 60_000);
  if (diffMin < 1) return "Agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours} h`;
  const date = new Date(timestamp);
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

function HistoryList({ onNavigate }: { onNavigate: (href: string) => void }) {
  const entries = useNavigationHistoryStore((s) => s.entries);
  const clear = useNavigationHistoryStore((s) => s.clear);

  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-[13.5px] text-muted-foreground">
        Nada por aqui ainda. Notas, publicações e capítulos da Bíblia que você abrir aparecem aqui.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto no-scrollbar">
        {entries.map((entry) => {
          const Icon = TYPE_ICON[entry.type];
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onNavigate(entry.href)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-secondary"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                  <Icon className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-foreground">{entry.title}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {TYPE_LABEL[entry.type]}
                    {entry.subtitle ? ` · ${entry.subtitle}` : ""} · {formatVisitedAt(entry.visitedAt)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => clear()}
        className="flex w-fit items-center gap-1.5 self-center rounded-full px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Trash2 className="size-3.5" />
        Limpar histórico
      </button>
    </div>
  );
}

/**
 * Shared Vault content for the navigation history — opened either from the
 * standalone header icon (rendered next to the avatar when there's room) or
 * from an item inside UserMenuClient's dropdown (when there isn't). Both
 * triggers just flip useHistoryVaultUiStore's `open` flag; only one of them
 * is ever mounted at a time per screen (there's exactly one header per
 * route), so there's no risk of two Vaults fighting over the same state.
 */
export function HistoryVault() {
  const router = useRouter();
  const open = useHistoryVaultUiStore((s) => s.open);
  const setOpen = useHistoryVaultUiStore((s) => s.setOpen);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <Vault open={open} onOpenChange={setOpen}>
      <VaultContent aria-label="Histórico de navegação">
        <VaultHeader showCloseButton={false}>
          <VaultTitle>Histórico</VaultTitle>
          <VaultDescription>Notas, publicações e capítulos que você abriu recentemente.</VaultDescription>
        </VaultHeader>
        <VaultBody>
          <HistoryList onNavigate={navigate} />
        </VaultBody>
      </VaultContent>
    </Vault>
  );
}

/**
 * The icon trigger itself — placed next to the avatar in every header. Hidden
 * below `sm` on purpose: at that width the header is already tight (toggle +
 * search/title + avatar), so the same action moves into UserMenuClient's
 * dropdown instead (see the "Histórico" item there, shown only `sm:hidden`)
 * rather than the header growing a third icon on a phone-width screen.
 */
export function HistoryVaultButton({ className }: { className?: string }) {
  const setOpen = useHistoryVaultUiStore((s) => s.setOpen);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Histórico"
        className={cn("hidden sm:inline-flex", className)}
        onClick={() => setOpen(true)}
      >
        <History className="size-[18px]" />
      </Button>
      <HistoryVault />
    </>
  );
}
