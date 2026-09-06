import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { DocsView } from "@/components/docs/docs-view";

export const metadata: Metadata = {
  title: "Documentação — Study Notes",
};

// Deliberately not in SIDEBAR_NAV_ITEMS — reachable only from the "Ver
// documentação" button in Settings, per the ask that this stay out of the
// sidebar. Still a normal (app) route otherwise (same Header/Sidebar shell).
export default function DocsPage() {
  return (
    <>
      <Header variant="title" title="Documentação" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <DocsView />
      </main>
    </>
  );
}
