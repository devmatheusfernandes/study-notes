import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = {
  title: "Configurações — Study Notes",
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <Header variant="title" title="Configurações" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <SettingsView userEmail={user?.email ?? ""} />
      </main>
    </>
  );
}
