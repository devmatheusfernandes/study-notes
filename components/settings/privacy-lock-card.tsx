"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { notify } from "@/components/ui/toaster";
import { Vault, VaultContent, VaultDescription, VaultHeader, VaultIcon, VaultTitle } from "@/components/ui/vault";
import { getLockStatus, removeLockPin, setLockPin, type LockStatus } from "@/app/(app)/lock-actions";
import {
  enrollBiometric,
  forgetDeviceCredential,
  hasDeviceCredential,
  isBiometricAvailable,
  setDeclinedBiometric,
} from "@/lib/lock/biometric";
import { useLockStore } from "@/lib/store/lock-store";
import { useNotesStore } from "@/lib/store/notes-store";

type PinMode = "change" | "remove" | null;

const PIN_PATTERN = /^\d{4,8}$/;
const digits = (v: string) => v.replace(/\D/g, "");

export function PrivacyLockCard() {
  const unlocked = useLockStore((s) => s.unlocked);
  const lock = useLockStore((s) => s.lock);
  const requestUnlock = useLockStore((s) => s.requestUnlock);
  const lockedCount = useNotesStore(
    (s) => s.notes.filter((n) => n.locked).length + s.folders.filter((f) => f.locked).length
  );

  const [status, setStatus] = useState<LockStatus | null>(null);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [deviceEnrolled, setDeviceEnrolled] = useState(false);
  const [mode, setMode] = useState<PinMode>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [s, bio] = await Promise.all([getLockStatus().catch(() => null), isBiometricAvailable()]);
    setStatus(s);
    setBiometricSupported(bio);
    setDeviceEnrolled(!!s?.userId && hasDeviceCredential(s.userId));
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  function openVault(next: PinMode) {
    setMode(next);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (mode === "remove") {
      setBusy(true);
      const res = await removeLockPin(current);
      setBusy(false);
      if (!res.ok) return setError(res.error ?? "Não foi possível remover o PIN.");
      // Everything that was locked is unlocked on the server; mirror that locally.
      useNotesStore.setState((s) => ({
        notes: s.notes.map((n) => (n.locked ? { ...n, locked: false } : n)),
        folders: s.folders.map((f) => (f.locked ? { ...f, locked: false } : f)),
      }));
      if (status?.userId) forgetDeviceCredential(status.userId);
      notify.success("Bloqueio removido. Todas as notas e pastas foram destrancadas.");
      setMode(null);
      void refresh();
      return;
    }

    if (!PIN_PATTERN.test(next)) return setError("Use de 4 a 8 dígitos.");
    if (next !== confirm) return setError("Os PINs não são iguais.");
    setBusy(true);
    const res = await setLockPin(next, current);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Não foi possível salvar o PIN.");
    notify.success("PIN alterado.");
    setMode(null);
  }

  async function toggleBiometric() {
    if (!status?.userId) return;
    if (deviceEnrolled) {
      forgetDeviceCredential(status.userId);
      setDeclinedBiometric(status.userId, true);
      setDeviceEnrolled(false);
      return;
    }
    // Turning it on is itself a gated action: only someone who can pass the PIN adds a fingerprint.
    if (!(await requestUnlock())) return;
    const ok = await enrollBiometric(status.userId);
    if (ok) {
      setDeviceEnrolled(true);
      notify.success("Digital ativada neste aparelho.");
    } else {
      notify.error("Não foi possível ativar a digital.");
    }
  }

  const hasPin = !!status?.hasPin;

  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <ShieldCheck className="size-5" />
        </span>
        <div className="flex flex-col">
          <h3 className="font-heading text-base text-foreground">Bloqueio de notas e pastas</h3>
          <p className="text-xs text-muted-foreground">Digital por padrão; PIN quando o aparelho não tem digital</p>
        </div>
      </div>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Tranque uma nota ou pasta no menu <span className="text-foreground">⋯</span> dela. O conteúdo trancado fica escondido
        até você confirmar a digital ou o PIN, e volta a trancar sozinho depois de 2 minutos sem uso ou ao sair do app. O
        assistente de IA nunca usa notas trancadas.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-foreground">
          <Lock className="size-3.5 text-accent" />
          {lockedCount} {lockedCount === 1 ? "item trancado" : "itens trancados"}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-foreground">
          <KeyRound className="size-3.5 text-primary" />
          {hasPin ? "PIN definido" : "Sem PIN"}
        </span>
        {biometricSupported && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-foreground">
            <Fingerprint className="size-3.5 text-warning" />
            {deviceEnrolled ? "Digital ativa neste aparelho" : "Digital disponível"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {unlocked && (
          <Button variant="outline" leftIcon={<Lock className="size-4 text-accent" />} onClick={lock}>
            Trancar agora
          </Button>
        )}
        {hasPin ? (
          <>
            <Button variant="outline" onClick={() => openVault("change")}>
              Alterar PIN
            </Button>
            {biometricSupported && (
              <Button variant="outline" leftIcon={<Fingerprint className="size-4" />} onClick={() => void toggleBiometric()}>
                {deviceEnrolled ? "Desativar digital aqui" : "Ativar digital aqui"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => openVault("remove")}>
              Remover bloqueio
            </Button>
          </>
        ) : (
          <Button leftIcon={<KeyRound className="size-4" />} onClick={() => void requestUnlock().then(() => refresh())}>
            Criar PIN
          </Button>
        )}
      </div>

      <Vault open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <VaultContent aria-label={mode === "remove" ? "Remover bloqueio" : "Alterar PIN"}>
          <VaultHeader showCloseButton={false}>
            <VaultIcon type={mode === "remove" ? "warning" : "info"}>
              <KeyRound className="size-6" />
            </VaultIcon>
            <VaultTitle>{mode === "remove" ? "Remover bloqueio?" : "Alterar PIN"}</VaultTitle>
            <VaultDescription>
              {mode === "remove"
                ? "Confirme o PIN atual. Todas as notas e pastas trancadas serão destrancadas."
                : "Informe o PIN atual e escolha o novo."}
            </VaultDescription>
          </VaultHeader>

          {error && <Alert variant="destructive">{error}</Alert>}

          <form onSubmit={submit} className="flex flex-col gap-3 pt-2">
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              autoFocus
              value={current}
              onChange={(e) => setCurrent(digits(e.target.value))}
              placeholder="PIN atual"
              aria-label="PIN atual"
              className="text-center font-mono tracking-[0.4em]"
            />
            {mode === "change" && (
              <>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(digits(e.target.value))}
                  placeholder="Novo PIN (4 a 8 dígitos)"
                  aria-label="Novo PIN"
                  className="text-center font-mono tracking-[0.4em]"
                />
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(digits(e.target.value))}
                  placeholder="Repita o novo PIN"
                  aria-label="Repita o novo PIN"
                  className="text-center font-mono tracking-[0.4em]"
                />
              </>
            )}
            <div className="flex gap-2 pt-1">
              <div className="flex-1">
                <Button type="button" variant="outline" fullWidth onClick={() => setMode(null)}>
                  Cancelar
                </Button>
              </div>
              <div className="flex-1">
                <Button
                  type="submit"
                  variant={mode === "remove" ? "destructive" : "default"}
                  fullWidth
                  isLoading={busy}
                  disabled={current.length < 4}
                >
                  {mode === "remove" ? "Remover" : "Salvar"}
                </Button>
              </div>
            </div>
          </form>
        </VaultContent>
      </Vault>
    </section>
  );
}
