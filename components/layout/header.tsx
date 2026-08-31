import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { HeaderActions } from "./header-actions";
import { UserMenu } from "./user-menu";

interface HeaderProps {
  variant: "search" | "title";
  title?: string;
  searchPlaceholder?: string;
  /** Content screens get the create-folder / upload actions; chat & settings don't. */
  showActions?: boolean;
}

export function Header({ variant, title, searchPlaceholder, showActions }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:gap-3 sm:px-6">
      <SidebarToggleButton />

      {variant === "search" ? (
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={searchPlaceholder ?? "Buscar em suas notas…"}
            className="pl-10"
          />
        </div>
      ) : (
        <h1 className="min-w-0 flex-1 truncate font-heading text-lg tracking-tight">{title}</h1>
      )}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {showActions && <HeaderActions />}
        <UserMenu />
      </div>
    </header>
  );
}
