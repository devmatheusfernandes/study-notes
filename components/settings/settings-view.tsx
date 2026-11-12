"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import {
  BookOpen,
  DatabaseBackup,
  HardDriveDownload,
  Library,
  Lock,
  LogOut,
  Palette,
  Sparkles,
  User,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { signOutAndWipeLocalData } from "@/lib/sign-out-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { ViewModeToggle } from "@/components/content/view-mode-toggle";
import { ThemeToggle } from "@/components/settings/theme-toggle";
import { AiUsageCard } from "@/components/settings/ai-usage-card";
import { VectorQueueCard } from "@/components/settings/vector-queue-card";
import { GlobalVideoSyncCard } from "@/components/settings/global-video-sync-card";
import { VideoScriptureIndexCard } from "@/components/settings/video-scripture-index-card";
import { ResearchGuideUploadCard } from "@/components/settings/research-guide-upload-card";
import { InsightUploadCard } from "@/components/settings/insight-upload-card";
import { ResearchGuideTopicsUploadCard } from "@/components/settings/research-guide-topics-upload-card";
import { BackupExportCard } from "@/components/settings/backup-export-card";
import { PrivacyLockCard } from "@/components/settings/privacy-lock-card";
import { TagsSettingsCard } from "@/components/settings/tags-settings-card";
import { BackupsCard } from "@/components/settings/backups-card";
import { OfflinePublicationsCard } from "@/components/settings/offline-publications-card";
import { OfflineBibleCard } from "@/components/settings/offline-bible-card";
import { DangerZoneCard } from "@/components/settings/danger-zone-card";

interface SettingsViewProps {
  userEmail: string;
}

type SectionId = "account" | "appearance" | "offline" | "ai" | "library" | "data";

interface SectionMeta {
  id: SectionId;
  label: string;
  /** One line under the label in the desktop sidebar — says what's inside without opening it. */
  hint: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Ordered by how often people come here: who I am and how it looks first,
 * then what's on this device, then the heavier machinery (AI, shared content)
 * and finally the data/danger zone at the bottom.
 */
const SECTIONS: SectionMeta[] = [
  { id: "account", label: "Conta", hint: "E-mail, bloqueio, sair", icon: User },
  { id: "appearance", label: "Aparência", hint: "Tema, exibição e etiquetas", icon: Palette },
  { id: "offline", label: "Offline", hint: "Bíblia e publicações no aparelho", icon: HardDriveDownload },
  { id: "ai", label: "Inteligência artificial", hint: "Uso e indexação das notas", icon: Sparkles },
  { id: "library", label: "Biblioteca", hint: "Vídeos, Guia e Perspicaz", icon: Library },
  { id: "data", label: "Dados e backup", hint: "Importar, exportar, apagar", icon: DatabaseBackup },
];

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h2 className="font-heading text-xl text-foreground">{title}</h2>
      <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p>
    </header>
  );
}

/** Plain titled group inside a section, for settings that are a row or two rather than a full card. */
function Panel({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-heading text-base text-foreground">{title}</h3>
        </div>
        {description && <p className="text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground/90">{label}</span>
        {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function SettingsView({ userEmail }: SettingsViewProps) {
  const [active, setActive] = useState<SectionId>("account");
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // Deep link: /settings#offline opens that section. Read after mount (not in
  // the initial state) so the server and first client render agree.
  useEffect(() => {
    queueMicrotask(() => {
      const hash = window.location.hash.slice(1);
      if (SECTION_IDS.has(hash)) setActive(hash as SectionId);
    });
  }, []);

  function select(id: SectionId) {
    setActive(id);
    // replaceState, not router.replace: no navigation, no RSC round trip, and
    // no entry added to history for every tab switch.
    window.history.replaceState(null, "", `#${id}`);
  }

  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      {/* Navigation: horizontal chips on small screens, a sticky list on desktop */}
      <nav
        aria-label="Seções das configurações"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:-mx-6 sm:px-6 lg:sticky lg:top-6 lg:mx-0 lg:w-64 lg:shrink-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0"
      >
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => select(section.id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-full px-4 py-2 text-left text-[13px] font-medium transition-colors lg:w-full lg:rounded-2xl lg:px-3.5 lg:py-2.5",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground lg:bg-transparent"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span>{section.label}</span>
                <span
                  className={cn(
                    "hidden text-[11.5px] font-normal lg:block",
                    isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                  )}
                >
                  {section.hint}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-5"
          >
            {active === "account" && (
              <>
                <SectionIntro title={current.label} description="Quem está conectado e como proteger o acesso às suas notas." />

                <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border bg-gradient-to-r from-card via-card to-secondary/30 p-5 shadow-sm sm:p-6">
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent font-heading text-xl text-primary-foreground shadow-lg">
                      {userEmail?.[0]?.toUpperCase() ?? "U"}
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-base font-semibold text-foreground">{userEmail}</span>
                      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                        <Lock className="size-3.5 text-success" />
                        Suas notas só podem ser lidas por você
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<LogOut className="size-3.5 text-destructive" />}
                    onClick={() => setConfirmSignOut(true)}
                    className="rounded-full text-[12.5px] max-sm:w-full"
                  >
                    Sair da conta
                  </Button>
                </section>

                <PrivacyLockCard />

                <Panel
                  icon={<BookOpen className="size-4 text-accent" />}
                  title="Documentação"
                  description="Como usar cada tela do app e as decisões técnicas por trás do funcionamento offline."
                >
                  <div>
                    <Button variant="outline" size="sm" render={<Link href="/docs" />} className="rounded-full text-[12.5px]">
                      Ver documentação
                    </Button>
                  </div>
                </Panel>
              </>
            )}

            {active === "appearance" && (
              <>
                <SectionIntro title={current.label} description="Como o app parece e como suas notas são organizadas na tela." />
                <Panel icon={<Palette className="size-4 text-accent" />} title="Exibição">
                  <SettingRow label="Tema" hint="Claro, escuro ou o mesmo do sistema. Vale só neste aparelho.">
                    <ThemeToggle />
                  </SettingRow>
                  <hr className="border-border/50" />
                  <SettingRow label="Modo de exibição" hint="Grade ou lista, nas notas, arquivados e lixeira.">
                    <ViewModeToggle />
                  </SettingRow>
                </Panel>
                <TagsSettingsCard />
              </>
            )}

            {active === "offline" && (
              <>
                <SectionIntro
                  title={current.label}
                  description="O que fica salvo neste aparelho para abrir na hora e sem internet. Tudo some ao sair da conta."
                />
                <OfflineBibleCard />
                <OfflinePublicationsCard />
              </>
            )}

            {active === "ai" && (
              <>
                <SectionIntro
                  title={current.label}
                  description="Quanto da IA você usou e o andamento da indexação das suas notas para a busca inteligente."
                />
                <AiUsageCard />
                <VectorQueueCard />
              </>
            )}

            {active === "library" && (
              <>
                <SectionIntro
                  title={current.label}
                  description="Conteúdo compartilhado: o que você importa aqui fica disponível para todos os usuários do app, não só para você."
                />
                <GlobalVideoSyncCard />
                <VideoScriptureIndexCard />
                <ResearchGuideUploadCard />
                <ResearchGuideTopicsUploadCard />
                <InsightUploadCard />
              </>
            )}

            {active === "data" && (
              <>
                <SectionIntro
                  title={current.label}
                  description="Traga dados do JW Library, leve uma cópia das suas notas ou apague tudo."
                />
                <BackupsCard />
                <BackupExportCard />
                <DangerZoneCard />
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <ConfirmVault
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="Sair da sua conta?"
        description="Você precisará informar seu e-mail e senha novamente para acessar suas notas."
        confirmLabel="Sair agora"
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOutAndWipeLocalData();
        }}
      />
    </div>
  );
}
