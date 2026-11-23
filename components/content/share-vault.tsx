"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Lock, PenLine, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { Vault, VaultBody, VaultContent, VaultDescription, VaultHeader, VaultTitle } from "@/components/ui/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import { notify } from "@/components/ui/toaster";
import {
  inviteToShare,
  listShareMembers,
  revokeShare,
  updateShareRole,
  type ShareMember,
  type ShareRole,
  type ShareStatus,
  type ShareTarget,
} from "@/app/(app)/shares-actions";
import { useSharedStore } from "@/lib/store/shared-store";

const ROLE_OPTIONS: { value: ShareRole; label: string; icon: typeof PenLine }[] = [
  { value: "editor", label: "Pode editar", icon: PenLine },
  { value: "viewer", label: "Só ver", icon: Eye },
];

const STATUS_LABEL: Record<ShareStatus, { label: string; variant: "secondary" | "success" | "warning" | "destructive" }> = {
  pending: { label: "Pendente", variant: "warning" },
  accepted: { label: "Aceito", variant: "success" },
  declined: { label: "Recusou", variant: "destructive" },
  left: { label: "Saiu", variant: "secondary" },
  revoked: { label: "Removido", variant: "secondary" },
};

interface ShareVaultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareTarget;
  /** Shown in the title. */
  name: string;
  /** Locked (directly or through a folder above it) — sharing is refused. */
  locked: boolean;
  /** Fired after an invite goes out, so an open editor can switch to collaborative mode. */
  onShared?: () => void;
}

/**
 * Invite people to a note or a folder, and manage who has it. A Vault, never a
 * modal (see CLAUDE.md). Locked items can't be shared at all — inside a shared
 * folder they're simply left out by the database.
 */
export function ShareVault({ open, onOpenChange, target, name, locked, onShared }: ShareVaultProps) {
  const isFolder = "folderId" in target;
  const targetKey = isFolder ? `f:${target.folderId}` : `n:${target.noteId}`;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [members, setMembers] = useState<ShareMember[]>([]);
  // Which target the member list was last loaded for — "loading" is derived from it.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== targetKey;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshShared = useSharedStore((s) => s.refresh);

  const load = useCallback(async () => {
    try {
      const res = await listShareMembers(target);
      setMembers(res.members);
    } catch {
      // offline — the list just stays as it was
    } finally {
      setLoadedFor(targetKey);
    }
    // targetKey identifies the target; the object itself is recreated by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  useEffect(() => {
    if (!open || locked) return;
    let cancelled = false;
    listShareMembers(target)
      .then((res) => {
        if (!cancelled) setMembers(res.members);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedFor(targetKey);
      });
    return () => {
      cancelled = true;
    };
    // targetKey identifies the target; the object itself is recreated by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locked, targetKey]);

  async function invite(address = email, withRole = role) {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      const res = await inviteToShare(target, address, withRole);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (address === email) setEmail("");
      notify.success("Convite enviado", "A pessoa vê o convite em “Compartilhado comigo”.");
      await load();
      void refreshShared();
      onShared?.();
    } catch {
      setError("Sem conexão. Tente de novo quando estiver online.");
    } finally {
      setSending(false);
    }
  }

  async function changeRole(member: ShareMember, next: ShareRole) {
    setMembers((list) => list.map((m) => (m.id === member.id ? { ...m, role: next } : m)));
    const res = await updateShareRole(member.id, next).catch(() => ({ error: "Sem conexão." }));
    if (res.error) {
      notify.error("Não foi possível alterar", res.error);
      void load();
    }
  }

  async function remove(member: ShareMember) {
    setMembers((list) => list.filter((m) => m.id !== member.id));
    const res = await revokeShare(member.id).catch(() => ({ error: "Sem conexão." }));
    if (res.error) {
      notify.error("Não foi possível remover", res.error);
      void load();
      return;
    }
    void refreshShared();
  }

  return (
    <Vault open={open} onOpenChange={onOpenChange}>
      <VaultContent aria-label="Compartilhar">
        <VaultHeader>
          <VaultTitle>Compartilhar “{name || (isFolder ? "Pasta" : "Nota")}”</VaultTitle>
          <VaultDescription>
            {isFolder
              ? "Quem aceitar vê as notas desta pasta e das subpastas, inclusive as que você criar depois. Notas trancadas ficam de fora."
              : "Quem aceitar vê esta nota e, se puder editar, escreve nela com você em tempo real."}
          </VaultDescription>
        </VaultHeader>

        <VaultBody>
          {locked ? (
            <Alert className="flex items-start gap-2 text-sm">
              <Lock className="mt-0.5 size-4 shrink-0" />
              <span>
                {isFolder ? "Pastas trancadas" : "Notas trancadas"} não podem ser compartilhadas. Destranque para
                compartilhar.
              </span>
            </Alert>
          ) : (
            <>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void invite();
                }}
              >
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="E-mail da pessoa"
                  aria-label="E-mail da pessoa"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SegmentedPills aria-label="Permissão" options={ROLE_OPTIONS} value={role} onChange={setRole} />
                  <Button type="submit" size="sm" leftIcon={<UserPlus />} isLoading={sending} disabled={!email.trim()}>
                    Convidar
                  </Button>
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
              </form>

              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground">
                  PESSOAS
                </span>
                {members.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">
                    {loading ? "Carregando…" : "Ainda não compartilhado com ninguém."}
                  </p>
                )}
                {members.map((member) => {
                  const status = STATUS_LABEL[member.status];
                  const canReinvite = member.status === "declined" || member.status === "left";
                  return (
                    <div key={member.id} className="flex flex-col gap-2 rounded-2xl bg-foreground/5 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{member.name ?? member.email}</p>
                          {member.name && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
                        </div>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Remover ${member.email}`}
                          onClick={() => void remove(member)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <SegmentedPills
                          size="sm"
                          aria-label={`Permissão de ${member.email}`}
                          options={ROLE_OPTIONS}
                          value={member.role}
                          onChange={(next) => void changeRole(member, next)}
                        />
                        {canReinvite && (
                          <Button
                            variant="ghost"
                            size="xs"
                            leftIcon={<RotateCcw />}
                            onClick={() => void invite(member.email, member.role)}
                          >
                            Convidar de novo
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </VaultBody>
      </VaultContent>
    </Vault>
  );
}
