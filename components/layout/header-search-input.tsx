"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSearchStore } from "@/lib/store/search-store";

/**
 * Split out of `Header` (a Server Component, so it can render the async
 * `UserMenu`) since this is the only piece that needs the search store hook.
 */
export function HeaderSearchInput({ placeholder }: { placeholder?: string }) {
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-sm">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? "Buscar em suas notas…"}
        className="pl-10"
      />
    </div>
  );
}
