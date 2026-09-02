"use client";

import { useSelectionStore } from "@/lib/store/selection-store";
import { BulkActionBar } from "./bulk-action-bar";
import { SmartComposer } from "@/components/ui/smart-composer";
import type { NoteStatus } from "@/lib/store/notes-store";

/**
 * Selecting notes and asking the assistant both want the bottom-of-screen dock,
 * so only one shows at a time — bulk actions take over the moment something's selected.
 */
export function ContentDock({ status }: { status: NoteStatus }) {
  const hasSelection = useSelectionStore((s) => s.selectedIds.length > 0);
  return hasSelection ? (
    <BulkActionBar status={status} />
  ) : (
    <SmartComposer
      variant="notes"
      // Trash: no actions at all
      noActions={status === "trashed"}
      // Archived: show all (including import) — nothing to hide
      hideImport={false}
    />
  );
}
