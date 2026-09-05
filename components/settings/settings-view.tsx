"use client";

import { useState } from "react";
import {
  LogOut,
  Palette,
  ShieldCheck,
  Sparkles,
  User,
  Sliders,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { ViewModeToggle } from "@/components/content/view-mode-toggle";
import { AiUsageCard } from "@/components/settings/ai-usage-card";
import { VectorQueueCard } from "@/components/settings/vector-queue-card";
import { GlobalVideoSyncCard } from "@/components/settings/global-video-sync-card";
import { BackupExportCard } from "@/components/settings/backup-export-card";
import { TagsSettingsCard } from "@/components/settings/tags-settings-card";
import { BackupsCard } from "@/components/settings/backups-card";
import { DangerZoneCard } from "@/components/settings/danger-zone-card";

interface SettingsViewProps {
  userEmail: string;
}

type SettingsSection = "all" | "ai" | "appearance" | "account";

export function SettingsView({ userEmail }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("all");
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const filterTabs = [
    { id: "all", label: "Visão Geral", icon: Sliders },
    { id: "ai", label: "IA", icon: Sparkles },
    { id: "appearance", label: "Aparência", icon: Palette },
    { id: "account", label: "Conta & Segurança", icon: User },
  ] as const;

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Profile Bento Hero Header */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-r from-card via-card to-secondary/30 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent font-heading text-xl text-primary-foreground shadow-lg">
              {userEmail?.[0]?.toUpperCase() ?? "U"}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="truncate text-base font-semibold text-foreground">
                  {userEmail}
                </span>
              </div>
              <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Lock className="size-3.5 text-success" />
                Sessão criptografada via Supabase Auth & RLS
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
        </div>
      </section>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {filterTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSection(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-all",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon className={cn("size-3.5", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bento Grid Content Container */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeSection === "all" && (
            /* Balanced Bento Grid Layout (Full Width) */
            <div className="flex flex-col gap-5">
              {/* Row 1: AI Stats & Appearance/Security Side by Side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
                {/* Column 1: AI Usage Card */}
                <div className="flex">
                  <AiUsageCard />
                </div>

                {/* Column 2: Combined Appearance & Security Card */}
                <div className="flex flex-col justify-between rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm gap-5">
                  {/* Appearance Section */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Palette className="size-4 text-accent" />
                      <h2 className="font-heading text-base text-foreground">Aparência & Exibição</h2>
                    </div>
                    <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                      Escolha como suas notas, arquivados e lixeira são organizados na tela principal.
                    </p>
                    <div className="pt-1">
                      <ViewModeToggle />
                    </div>
                  </div>

                  <hr className="border-border/50" />

                  {/* Security Section */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-4 text-success" />
                      <h2 className="font-heading text-base text-foreground">Segurança & RLS</h2>
                    </div>
                    <div className="flex flex-col gap-2 rounded-2xl bg-secondary/50 p-3.5 border border-border/50">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-muted-foreground">E-mail:</span>
                        <span className="font-mono font-medium text-foreground truncate max-w-[180px]">
                          {userEmail}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-muted-foreground">Proteção de dados:</span>
                        <span className="flex items-center gap-1 font-mono text-success text-[11px]">
                          <CheckCircle2 className="size-3" />
                          RLS Ativado (Owner Only)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Full Width Vector Queue Card */}
              <VectorQueueCard />

              {/* Row 3: Full Width Global Video Sync Card */}
              <GlobalVideoSyncCard />

              {/* Row 4: Full Width Tags Card */}
              <TagsSettingsCard />

              {/* Row 5: Full Width JW Library Backups Card */}
              <BackupsCard />

              {/* Row 6: Full Width Backup Export Card */}
              <BackupExportCard />

              {/* Row 7: Full Width Danger Zone Card */}
              <DangerZoneCard />
            </div>
          )}

          {activeSection === "ai" && (
            <div className="flex flex-col gap-5">
              <AiUsageCard />
              <VectorQueueCard />
              <GlobalVideoSyncCard />
            </div>
          )}

          {activeSection === "appearance" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
              <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Palette className="size-4 text-accent" />
                    <h2 className="font-heading text-base">Aparência & Exibição</h2>
                  </div>
                  <p className="text-[12.5px] text-muted-foreground">
                    Alterne o formato de grade, lista ou mosaico (masonry) para organizar suas notas.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <span className="text-sm font-medium text-foreground/90">Modo de Exibição</span>
                  <ViewModeToggle />
                </div>
              </section>

              <TagsSettingsCard />
            </div>
          )}

          {activeSection === "account" && (
            <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
              <section className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-success" />
                    <h2 className="font-heading text-base">Segurança & Conta</h2>
                  </div>
                  <p className="text-[12.5px] text-muted-foreground">
                    Suas notas e embeddings de IA são protegidos via Supabase Row Level Security (RLS).
                  </p>
                </div>

                <div className="flex flex-col gap-2.5 rounded-2xl bg-secondary/50 p-4 border border-border/50">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">E-mail cadastrado:</span>
                    <span className="font-mono font-medium text-foreground">{userEmail}</span>
                  </div>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">Autenticação:</span>
                    <span className="font-mono text-foreground">Supabase Auth</span>
                  </div>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-foreground">Proteção de dados:</span>
                    <span className="flex items-center gap-1 font-mono text-success">
                      <CheckCircle2 className="size-3.5" />
                      RLS Ativado (Owner Only)
                    </span>
                  </div>
                </div>
              </section>

              <BackupExportCard />
            </div>

            <DangerZoneCard />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Confirmation Vault for Sign Out */}
      <ConfirmVault
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="Sair da sua conta?"
        description="Você precisará informar seu e-mail e senha novamente para acessar suas notas."
        confirmLabel="Sair agora"
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut();
        }}
      />
    </div>
  );
}
