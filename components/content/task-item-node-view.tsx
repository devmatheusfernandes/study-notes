"use client";

import { NodeViewWrapper, NodeViewContent, type ReactNodeViewProps } from "@tiptap/react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Replaces Tiptap's default TaskItem markup (a bare, unstyled native
 * checkbox) with the app's own animated `Checkbox` primitive, so it actually
 * matches the rest of the UI instead of looking like raw browser chrome.
 */
export function TaskItemNodeView({ node, updateAttributes }: ReactNodeViewProps) {
  const checked = !!node.attrs.checked;

  return (
    <NodeViewWrapper as="li" className="flex items-center gap-2.5 py-0.5" data-checked={checked}>
      <span
        contentEditable={false}
        // Keeps the checkbox click from also placing a text cursor, without
        // stealing focus from the editor the way a real blur would.
        onMouseDown={(e) => e.preventDefault()}
        className="shrink-0 select-none"
      >
        <Checkbox
          checked={checked}
          onCheckedChange={(next) => updateAttributes({ checked: next })}
          aria-label={checked ? "Marcar tarefa como não concluída" : "Marcar tarefa como concluída"}
        />
      </span>
      <NodeViewContent
        className={cn(
          // `!` is required: the editor container's own `[&_p]:my-2` (in
          // rich-text-editor.tsx) targets every <p> descendant including
          // this one, and matches it with equal CSS specificity — without
          // `!` the winner depends on stylesheet order, which was giving
          // each task item's paragraph 0.5rem of vertical margin on top of
          // this row's own `py-1`, stacking into the oversized gaps between
          // rows (and making the checkbox look disproportionately large
          // next to all that empty space).
          "min-w-0 flex-1 leading-normal [&>p]:my-0!",
          checked && "text-muted-foreground/60 line-through"
        )}
      />
    </NodeViewWrapper>
  );
}
