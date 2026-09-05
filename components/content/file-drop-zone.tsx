"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Upload } from "lucide-react";
import { useDevice } from "@/hooks/ui/use-device";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useFolderViewStore } from "@/lib/store/folder-view-store";
import { extractDiscoveredItems } from "@/lib/import-notes";
import { notify } from "@/components/ui/toaster";

/**
 * Desktop file uploads & note import: drop anywhere over the content area or onto folders.
 * Mobile uses the header's upload button instead (no drag source there).
 */
export function FileDropZone({
  children,
  blockJwlibrary = false,
}: {
  children: React.ReactNode;
  /** Main /notes screen only — .jwlibrary backups aren't notes, they belong on /jwlibrary. */
  blockJwlibrary?: boolean;
}) {
  const { isMobile } = useDevice();
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child element, so count depth instead of toggling.
  const depth = useRef(0);

  const { processDiscoveredItems, isUploading } = useFileUpload();
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

        void extractDiscoveredItems(e.dataTransfer).then((discovered) => {
          if (discovered.length === 0) return;
          if (!blockJwlibrary) {
            void processDiscoveredItems(discovered, activeFolderId ?? undefined);
            return;
          }
          const allowed = discovered.filter((d) => !d.file.name.toLowerCase().endsWith(".jwlibrary"));
          if (allowed.length < discovered.length) {
            notify.info("Backups do JW Library vão em outro lugar", 'Importe pelo botão "Importar backup" em Estudo Pessoal.');
          }
          if (allowed.length > 0) void processDiscoveredItems(allowed, activeFolderId ?? undefined);
        });
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
            <span className="font-heading text-lg">Solte para importar</span>
            <span className="text-[13px] text-muted-foreground">
              Arquivos .json, .txt e .md viram notas. Pastas e arquivos entram na pasta aberta.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isUploading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="pointer-events-none fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface-elevated px-4 py-2 text-[13px] text-foreground shadow-[0_14px_34px_rgba(0,0,0,0.5)]"
          >
            <Loader2 className="size-4 animate-spin text-accent" />
            Processando importação…
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
