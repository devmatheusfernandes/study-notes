import type { Metadata } from "next";
import { Archive } from "lucide-react";
import { Header } from "@/components/layout/header";
import { NotesCollection } from "@/components/content/notes-collection";
import { ContentDock } from "@/components/content/content-dock";

export const metadata: Metadata = {
  title: "Arquivados — Study Notes",
};

export default function ArchivedPage() {
  return (
    <>
      <Header variant="search" showActions searchPlaceholder="Buscar em arquivados…" />
      <NotesCollection
        status="archived"
        emptyIcon={<Archive />}
        emptyTitle="Nada arquivado"
        emptyDescription="Notas e arquivos arquivados saem da sua lista principal, mas continuam aqui."
      />
      <ContentDock status="archived" />
    </>
  );
}
