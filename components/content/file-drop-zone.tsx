"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Upload } from "lucide-react";
import { useDevice } from "@/hooks/ui/use-device";
import { useNotesStore } from "@/lib/store/notes-store";
import { useFolderViewStore } from "@/lib/store/folder-view-store";

/**
 * Desktop file uploads: drop anywhere over the content area.
 * Mobile uses the header's upload button instead (no drag source there).
 */
export function FileDropZone({ children }: { children: React.ReactNode }) {
  const { isMobile } = useDevice();
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child element, so count depth instead of toggling.
  const depth = useRef(0);

  const addFiles = useNotesStore((s) => s.addFiles);
  const activeFolderId = useFolderViewStore((s) => s.activeFolderId);

  if (isMobile) return <>{children}</>;

  function hasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  return (
    <div
      className="relative flex flex-1 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        addFiles(
          files.map((f) => ({ name: f.name, size: f.size })),
          activeFolderId ?? undefined
        );
      }}
    >
      {children}

      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-accent bg-background/85 backdrop-blur-sm"
          >
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/20 text-accent">
              <Upload className="size-5" />
            </span>
            <span className="font-heading text-lg">Solte para enviar</span>
            <span className="text-[13px] text-muted-foreground">
              Os arquivos entram na pasta aberta.
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
