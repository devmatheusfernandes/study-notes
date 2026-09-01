"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Download, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "desktop";

export function InstallCard() {
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [isStandalone, setIsStandalone] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    const isAndroid = /Android/.test(ua);
    queueMicrotask(() => {
      setPlatform(isIOS ? "ios" : isAndroid ? "android" : "desktop");
      setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);
    });

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  }

  const alreadyInstalled = isStandalone || installed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full max-w-[520px] rounded-3xl border border-border bg-card overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 90% at 12% 0%, var(--surface) 0%, var(--card) 62%)",
      }}
    >
      <div className="flex flex-col items-start gap-6 p-10 sm:p-14">
        <div className="flex items-center gap-2.5">
          <div className="size-6.5 rounded-full bg-primary" />
          <span className="font-heading text-lg tracking-tight">Study Notes</span>
        </div>

        {alreadyInstalled ? (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="font-heading text-3xl leading-[1.1] tracking-tight">
                Já está instalado
              </h1>
              <p className="max-w-[36ch] text-sm text-muted-foreground text-pretty">
                O Study Notes já está no seu dispositivo. Abra pelo ícone na tela inicial
                ou na lista de apps.
              </p>
            </div>
            <Badge variant="success" className="h-auto gap-2 rounded-full px-3.5 py-2 text-[11.5px] font-normal">
              <CheckCircle2 className="size-3.5" />
              App instalado neste dispositivo
            </Badge>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="font-heading text-3xl leading-[1.1] tracking-tight">
                Instale o Study Notes
              </h1>
              <p className="max-w-[36ch] text-sm text-muted-foreground text-pretty">
                Use como um app nativo, com acesso rápido pela tela inicial e suporte a
                notas offline — sem precisar de loja de aplicativos.
              </p>
            </div>

            {platform === "ios" ? (
              <div className="flex w-full flex-col gap-3">
                <Step icon={<Share className="size-4" />} index={1}>
                  Toque no ícone de compartilhar na barra do Safari
                </Step>
                <Step icon={<SquarePlus className="size-4" />} index={2}>
                  Escolha <strong className="text-foreground">Adicionar à Tela de Início</strong>
                </Step>
              </div>
            ) : installEvent ? (
              <Button size="lg" fullWidth leftIcon={<Download />} onClick={handleInstall}>
                Instalar app
              </Button>
            ) : (
              <div className="flex w-full flex-col gap-3">
                <Step icon={<Download className="size-4" />} index={1}>
                  {platform === "android"
                    ? "Abra o menu do navegador (⋮) e toque em Instalar app ou Adicionar à tela inicial"
                    : "Abra o menu do navegador e procure por Instalar Study Notes… ou Adicionar à tela inicial"}
                </Step>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function Step({
  icon,
  index,
  children,
}: {
  icon: React.ReactNode;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        {icon}
      </span>
      <span className="text-sm text-foreground/90">
        <span className="font-mono text-[11px] font-medium text-muted-foreground">
          {index}.{" "}
        </span>
        {children}
      </span>
    </div>
  );
}
