import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { JwlibraryNotesCollection } from "@/components/content/jwlibrary-notes-collection";

export const metadata: Metadata = {
  title: "JW Library — Study Notes",
};

export default function JwlibraryPage() {
  return (
    <>
      <Header variant="search" searchPlaceholder="Buscar em suas notas do JW Library…" />
      <JwlibraryNotesCollection />
    </>
  );
}
