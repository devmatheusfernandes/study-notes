import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { JwlibraryTagsPageView } from "@/components/content/jwlibrary-tags-page-view";

export const metadata: Metadata = {
  title: "Tags do Estudo Pessoal — Study Notes",
};

export default function JwlibraryTagsPage() {
  return (
    <>
      <Header variant="title" title="Gerenciar tags" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <JwlibraryTagsPageView />
      </main>
    </>
  );
}
