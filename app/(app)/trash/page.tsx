import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { NotesCollection } from "@/components/content/notes-collection";
import { ContentDock } from "@/components/content/content-dock";

export const metadata: Metadata = {
  title: "Lixeira — Study Notes",
};

export default function TrashPage() {
  return (
    <>
      <Header variant="search" searchPlaceholder="Buscar na lixeira…" />
      <NotesCollection
        status="trashed"
        emptyIcon={<Trash2 />}
        emptyTitle="A lixeira está vazia"
        emptyDescription="Itens excluídos ficam aqui por 30 dias antes de serem removidos de vez."
      />
      <ContentDock status="trashed" />
    </>
  );
}
