import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/ui/fade-in";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <FadeIn className="flex flex-col items-center gap-4">
        <div className="size-8 rounded-full bg-primary" />
        <h1 className="font-heading text-2xl">Você entrou, {user?.email}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          O seu espaço de notas está sendo preparado. Por enquanto, esta é só a confirmação de que o login funciona.
        </p>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Sair
          </Button>
        </form>
      </FadeIn>
    </main>
  );
}
