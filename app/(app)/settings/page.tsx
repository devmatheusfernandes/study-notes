import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { ViewModeToggle } from "@/components/content/view-mode-toggle";

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
      <main className="flex flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
        <section className="flex max-w-xl flex-col gap-4 rounded-3xl bg-card p-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-lg">Aparência</h2>
            <p className="text-[13px] text-muted-foreground">
              Como suas notas, arquivados e lixeira são exibidos.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-foreground/80">Visualização</span>
            <ViewModeToggle />
          </div>
        </section>

        <section className="flex max-w-xl flex-col gap-4 rounded-3xl bg-card p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-base text-primary-foreground">
              {user?.email?.[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-foreground">{user?.email}</span>
              <span className="text-xs text-muted-foreground">Conta Study Notes</span>
            </div>
          </div>

          <form action={signOut}>
            <Button type="submit" variant="outline" fullWidth>
              Sair da conta
            </Button>
          </form>
        </section>
      </main>
    </>
  );
}
