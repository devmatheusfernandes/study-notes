"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { HeaderActions } from "./header-actions";
import { UserMenu } from "./user-menu";
import { AssistantToggleButton } from "@/components/assistant/assistant-toggle-button";
import { useSearchStore } from "@/lib/store/search-store";

interface HeaderProps {
  variant: "search" | "title";
  title?: string;
  searchPlaceholder?: string;
  /** Content screens get the create-folder / upload actions; chat & settings don't. */
  showActions?: boolean;
}

export function Header({ variant, title, searchPlaceholder, showActions }: HeaderProps) {
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
      <SidebarToggleButton />

      {variant === "search" ? (
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder ?? "Buscar em suas notas…"}
            className="pl-10"
          />
        </div>
      ) : (
        <h1 className="min-w-0 flex-1 truncate font-heading text-lg tracking-tight">{title}</h1>
      )}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {showActions && <HeaderActions />}
        <AssistantToggleButton />
        <UserMenu />
      </div>
    </header>
  );
}
