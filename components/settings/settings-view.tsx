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
} from "lucide-react";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { ViewModeToggle } from "@/components/content/view-mode-toggle";
import { AiUsageCard } from "@/components/settings/ai-usage-card";
import { VectorQueueCard } from "@/components/settings/vector-queue-card";

interface SettingsViewProps {
  userEmail: string;
}

type SettingsSection = "all" | "ai" | "appearance" | "account";

export function SettingsView({ userEmail }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("all");
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const filterTabs = [
    { id: "all", label: "Tudo", icon: Sliders },
    { id: "ai", label: "IA & Vetorização", icon: Sparkles },
    { id: "appearance", label: "Aparência", icon: Palette },
    { id: "account", label: "Conta", icon: User },
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* Profile Header Banner */}
      <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent font-heading text-base text-primary-foreground shadow-md">
              {userEmail?.[0]?.toUpperCase() ?? "U"}
            </span>
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {userEmail}
                </span>
                <Badge variant="success" className="h-auto rounded-full px-2 py-0.5 font-mono text-[9.5px]">
                  Ativo
                </Badge>
              </div>
              <span className="text-[12px] text-muted-foreground">
                Sessão segura com criptografia & RLS ativado
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

      {/* Filter Navigation Pills */}
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

      {/* Section 1: Appearance */}
      {(activeSection === "all" || activeSection === "appearance") && (
        <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Palette className="size-4 text-accent" />
              <h2 className="font-heading text-base">Aparência & Exibição</h2>
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Como suas notas, arquivados e lixeira são exibidos na tela principal.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="text-sm font-medium text-foreground/90">Modo de Exibição</span>
            <ViewModeToggle />
          </div>
        </section>
      )}

      {/* Section 2: Real-time Vector Queue */}
      {(activeSection === "all" || activeSection === "ai") && (
        <VectorQueueCard />
      )}

      {/* Section 3: AI Usage & Cost */}
      {(activeSection === "all" || activeSection === "ai") && (
        <AiUsageCard />
      )}

      {/* Section 4: Account & Security */}
      {(activeSection === "all" || activeSection === "account") && (
        <section className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
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

          <div className="pt-1">
            <Button
              variant="outline"
              leftIcon={<LogOut className="size-4 text-destructive" />}
              onClick={() => setConfirmSignOut(true)}
              fullWidth
            >
              Sair da conta
            </Button>
          </div>
        </section>
      )}

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
