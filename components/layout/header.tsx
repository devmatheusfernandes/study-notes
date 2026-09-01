import { SidebarToggleButton } from "./sidebar-toggle-button";
import { HeaderActions } from "./header-actions";
import { HeaderSearchInput } from "./header-search-input";
import { UserMenu } from "./user-menu";
import { AssistantToggleButton } from "@/components/assistant/assistant-toggle-button";

interface HeaderProps {
  variant: "search" | "title";
  title?: string;
  searchPlaceholder?: string;
  /** Content screens get the create-folder / upload actions; chat & settings don't. */
  showActions?: boolean;
}

export function Header({ variant, title, searchPlaceholder, showActions }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
      <SidebarToggleButton />

      {variant === "search" ? (
        <HeaderSearchInput placeholder={searchPlaceholder} />
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
