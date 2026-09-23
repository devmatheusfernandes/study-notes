"use client";

import { useRouter } from "next/navigation";
import { History, LogOut, Settings, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/login/actions";
import { useHistoryVaultUiStore } from "@/lib/store/history-vault-ui-store";

interface UserMenuClientProps {
  email?: string;
}

export function UserMenuClient({ email }: UserMenuClientProps) {
  const router = useRouter();
  const setHistoryOpen = useHistoryVaultUiStore((s) => s.setOpen);
  const initial = email?.[0]?.toUpperCase() ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu do usuário"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-sm text-primary-foreground"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
          <User className="size-3.5" />
          <span className="truncate">{email ?? "Minha conta"}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Mirrors the standalone <HistoryVaultButton> icon next to this
            avatar — that one is `hidden sm:inline-flex`, so this item picks
            up the same action below that breakpoint instead of the header
            growing a third icon on a phone-width screen. */}
        <DropdownMenuItem className="sm:hidden" onSelect={() => setHistoryOpen(true)}>
          <History className="size-4" />
          Histórico
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings className="size-4" />
          Configurações
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => signOut()}>
          <LogOut className="size-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
