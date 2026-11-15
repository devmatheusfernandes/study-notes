"use client";

import { useRef, useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImageUploadNodeOptions } from "./image-upload-node-extension";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The editor-side UI of the image upload block: a drop zone that turns into a
 * progress card while the file goes up, then replaces itself with the image.
 *
 * The upload is a Server Action (FormData), which reports no progress, so the
 * card shows an indeterminate bar rather than a percentage.
 */
export function ImageUploadNodeView({ node, editor, getPos, deleteNode, extension }: ReactNodeViewProps) {
  const { accept, maxSize, upload, onError } = extension.options as ImageUploadNodeOptions;
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  async function handleFile(picked: File | undefined) {
    if (!picked || file) return;
    if (!picked.type.startsWith("image/")) {
      onError?.(new Error("Escolha um arquivo de imagem."));
      return;
    }
    if (maxSize > 0 && picked.size > maxSize) {
      onError?.(new Error(`A imagem excede o limite de ${Math.round(maxSize / 1024 / 1024)} MB.`));
      return;
    }

    setFile(picked);
    try {
      const url = await upload(picked);
      // Cancelled (or the block deleted) while the upload was in flight: the file is
      // already stored, but it never reaches the note.
      if (cancelledRef.current) return;

      const pos = getPos();
      if (typeof pos !== "number") return;
      const end = pos + node.nodeSize;
      const hasNodeAfter = editor.state.doc.resolve(end).nodeAfter !== null;
      const image = { type: "image", attrs: { src: url, alt: picked.name.replace(/\.[^/.]+$/, "") } };
      // Keep a line to type on when the image would otherwise end the note.
      editor
        .chain()
        .focus()
        .insertContentAt({ from: pos, to: end }, hasNodeAfter ? [image] : [image, { type: "paragraph" }])
        .run();
    } catch (error) {
      if (cancelledRef.current) return;
      setFile(null);
      onError?.(error instanceof Error ? error : new Error("Falha ao enviar a imagem."));
    }
  }

  function cancel() {
    cancelledRef.current = true;
    deleteNode();
  }

  return (
    <NodeViewWrapper className="my-3" contentEditable={false}>
      {file ? (
        <div className="relative flex items-center gap-3 overflow-hidden border border-border bg-secondary px-3 py-2.5">
          <ImagePlus className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-foreground">{file.name}</span>
            <span className="block font-mono text-[11px] text-muted-foreground">
              {formatFileSize(file.size)} · enviando…
            </span>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cancelar envio" onClick={cancel}>
            <X className="size-4" />
          </Button>
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-primary" />
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              // Not the editor's own drop handler (which would upload the file straight into the text).
              e.stopPropagation();
              setDragging(false);
              void handleFile(e.dataTransfer.files[0]);
            }}
            className={cn(
              "flex w-full flex-col items-center gap-1.5 border border-dashed px-4 py-7 text-center transition-colors",
              dragging
                ? "border-primary bg-primary/10"
                : "border-border bg-secondary/50 hover:border-foreground/30 hover:bg-secondary"
            )}
          >
            <ImagePlus className="size-6 text-muted-foreground" />
            <span className="text-[13.5px] text-foreground">
              <em className="font-medium not-italic text-accent">Clique para enviar</em> ou arraste e solte
            </span>
            {maxSize > 0 && (
              <span className="font-mono text-[11px] text-muted-foreground">
                Imagem de até {Math.round(maxSize / 1024 / 1024)} MB
              </span>
            )}
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remover bloco de imagem"
            onClick={cancel}
            className="absolute right-1.5 top-1.5"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          void handleFile(picked);
        }}
      />
    </NodeViewWrapper>
  );
}
