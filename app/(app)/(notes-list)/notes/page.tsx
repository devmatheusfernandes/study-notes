import type { Metadata } from "next";
import { NotebookPen } from "lucide-react";
import { Header } from "@/components/layout/header";
import { NotesCollection } from "@/components/content/notes-collection";
import { ContentDock } from "@/components/content/content-dock";

export const metadata: Metadata = {
  title: "Meu conteúdo — Study Notes",
};

export default function NotesPage() {
  return (
    <>
      <Header variant="search" searchPlaceholder="Buscar em suas notas…" />
      <NotesCollection
        status="active"
        showFolders
        emptyIcon={<NotebookPen />}
        emptyTitle="Nenhuma nota ainda"
        emptyDescription="Segure a barra abaixo e arraste para cima para criar sua primeira nota."
      />
      <ContentDock status="active" showFolders />
    </>
  );
}
