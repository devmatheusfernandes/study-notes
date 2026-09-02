"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Plus, Search, Tags, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useSearchStore } from "@/lib/store/search-store";
import { useNotesStore } from "@/lib/store/notes-store";
import { TagDot } from "@/components/content/tag-pill";
import { TagSwatchPicker } from "@/components/content/tag-swatch-picker";
import { DEFAULT_TAG_COLOR } from "@/lib/tag-colors";

/**
 * Split out of `Header` (a Server Component, so it can render the async
 * `UserMenu`) since this is the only piece that needs the search store hook.
 *
 * Also owns the expandable tag filter/create panel — same drawer interaction
 * as `components/ui/smart-composer.tsx` (explicit trigger button, menu/create
 * phase switch), the only place besides Settings where a tag can be created.
 */
export function HeaderSearchInput({ placeholder }: { placeholder?: string }) {
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const selectedTagIds = useSearchStore((s) => s.selectedTagIds);
  const toggleTagFilter = useSearchStore((s) => s.toggleTagFilter);

  const tags = useNotesStore((s) => s.tags);
  const createTag = useNotesStore((s) => s.createTag);

  const [panelOpen, setPanelOpen] = useState(false);
  const [phase, setPhase] = useState<"menu" | "create">("menu");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_TAG_COLOR);

  const containerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!panelOpen) return;
    function onOutside(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setPanelOpen(false);
    }
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (phase === "create") setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [phase]);

  function togglePanel() {
    setPanelOpen((open) => {
      if (open) {
        setTimeout(() => {
          setPhase("menu");
          setName("");
          setColor(DEFAULT_TAG_COLOR);
        }, 200);
      }
      return !open;
    });
  }

  function submitCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createTag(trimmed, color);
    setName("");
    setColor(DEFAULT_TAG_COLOR);
    setPhase("menu");
  }

  const hasActiveFilter = selectedTagIds.length > 0;

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 sm:max-w-sm">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? "Buscar em suas notas…"}
        className="pl-10 pr-9"
      />
      <button
        type="button"
        onClick={togglePanel}
        aria-label="Filtrar ou criar tags"
        aria-expanded={panelOpen}
        className={cn(
          "absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
          panelOpen || hasActiveFilter
            ? "bg-accent/20 text-accent"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
      >
        <Tags className="size-3.5" />
        {hasActiveFilter && !panelOpen && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-background" />
        )}
      </button>

      <AnimatePresence>
        {panelOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-2xl border border-white/12 bg-[#211f1e]/95 shadow-[0_12px_36px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
          >
            <AnimatePresence mode="wait">
              {phase === "menu" ? (
                <motion.div
                  key="menu"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="flex flex-wrap items-center gap-1.5 p-3"
                >
                  {tags.length === 0 && (
                    <span className="px-1 py-1 text-[12px] text-muted-foreground">Nenhuma tag ainda.</span>
                  )}
                  {tags.map((tag) => {
                    const isSelected = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTagFilter(tag.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all",
                          isSelected
                            ? "border-accent/50 bg-accent/20 text-accent"
                            : "border-white/10 bg-white/5 text-foreground/80 hover:border-accent/50 hover:bg-accent/15 hover:text-accent"
                        )}
                      >
                        <TagDot color={tag.color} />
                        {tag.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setPhase("create")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-white/15 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground transition-all hover:border-accent/50 hover:text-accent"
                  >
                    <Plus className="size-3 shrink-0" />
                    Nova tag
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="create"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="flex flex-col gap-3 p-3"
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPhase("menu")}
                      aria-label="Voltar"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                    <input
                      ref={nameInputRef}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitCreate();
                        }
                      }}
                      placeholder="Nome da tag…"
                      className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/60"
                    />
                    <motion.button
                      type="button"
                      onClick={submitCreate}
                      disabled={!name.trim()}
                      animate={{ opacity: name.trim() ? 1 : 0.35, scale: name.trim() ? 1 : 0.9 }}
                      transition={{ duration: 0.15 }}
                      aria-label="Criar tag"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground disabled:cursor-not-allowed"
                    >
                      <ArrowUp className="size-3.5 stroke-[2.5]" />
                    </motion.button>
                  </div>
                  <TagSwatchPicker value={color} onChange={setColor} className="px-1" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
