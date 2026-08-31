import { Sidebar } from "@/components/layout/sidebar";
import { AssistantSurface } from "@/components/assistant/assistant-surface";
import { StoreHydration } from "@/components/providers/store-hydration";
import { listUserContent } from "./notes-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Fetched once per entry into this section (layouts persist across the
  // client-side navigations between /notes, /archived, /trash, …) — RLS
  // scopes this to the signed-in user, same as every other query here.
  const { notes, folders } = await listUserContent();

  return (
    <div className="flex min-h-dvh w-full">
      <StoreHydration initialNotes={notes} initialFolders={folders} />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <AssistantSurface />
    </div>
  );
}
