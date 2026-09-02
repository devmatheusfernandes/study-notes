import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/store/notes-store";

/** Color comes from per-tag user data (like note body content), not app chrome — an inline style here isn't a hardcoded theme color. */
export function TagDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function TagPill({ tag, className }: { tag: Tag; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[9rem] items-center gap-1 rounded-full bg-secondary/70 px-2 py-0.5 text-[10.5px] font-medium text-foreground/80",
        className
      )}
    >
      <TagDot color={tag.color} />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
