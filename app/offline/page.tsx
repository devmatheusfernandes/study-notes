import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";

export const metadata: Metadata = {
  title: "Você está offline — Study Notes",
};

export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <FadeIn className="flex flex-col items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <WifiOff className="size-6" />
        </div>
        <h1 className="font-heading text-2xl">Você está offline</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Essa página ainda não tinha sido salva no seu dispositivo. Assim que a conexão
          voltar, ela fica disponível automaticamente.
        </p>
      </FadeIn>
    </main>
  );
}
