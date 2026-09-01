import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { createClient } from "@/lib/supabase/server";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = {
  title: "Configurações — Study Notes",
};

export default async function SettingsPage() {
  const supabase = await createClient();
  // getSession(), not getUser() — proxy.ts's middleware already
  // network-validated this request's session; re-validating again here just
  // to read the email would be a redundant Supabase Auth round-trip on top
  // of the one UserMenu (rendered inside Header, below) also used to make.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;

  return (
    <>
      <Header variant="title" title="Configurações" />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <SettingsView userEmail={user?.email ?? ""} />
      </main>
    </>
  );
}
