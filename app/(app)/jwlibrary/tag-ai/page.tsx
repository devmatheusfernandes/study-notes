import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { JwlibraryTagAiView } from "@/components/content/jwlibrary-tag-ai-view";

export const metadata: Metadata = {
  title: "Organizar tags com IA — Study Notes",
};

export default function JwlibraryTagAiPage() {
  return (
    <>
      <Header variant="title" title="Organizar tags com IA" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <JwlibraryTagAiView />
      </main>
    </>
  );
}
