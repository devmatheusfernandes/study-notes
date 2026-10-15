"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Vault, VaultContent, VaultDescription, VaultHeader, VaultIcon, VaultTitle } from "@/components/ui/vault";
import { getLockStatus, setLockPin, verifyLockPin, type LockStatus } from "@/app/(app)/lock-actions";
import {
  enrollBiometric,
  hasDeclinedBiometric,
  hasDeviceCredential,
  isBiometricAvailable,
  setDeclinedBiometric,
  verifyBiometric,
} from "@/lib/lock/biometric";
import { useLockStore } from "@/lib/store/lock-store";

type Mode = "loading" | "setup" | "biometric" | "pin";

const PIN_PATTERN = /^\d{4,8}$/;

/**
 * The one unlock surface (a Vault, never a modal — see CLAUDE.md). Fingerprint / face /
 * Windows Hello is the default whenever this device has it enrolled; the PIN covers
 * devices without a biometric, a failed read, and first-time setup (a PIN is always
 * created first so there is a way back in if the biometric ever stops working).
 */
export function UnlockVault() {
  const open = useLockStore((s) => s.promptOpen);
  const completeUnlock = useLockStore((s) => s.completeUnlock);
  const cancelPrompt = useLockStore((s) => s.cancelPrompt);

  const [mode, setMode] = useState<Mode>("loading");
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [biometricReady, setBiometricReady] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  const unlockWithBiometric = useCallback(
    async (userId: string) => {
      setBusy(true);
      setError(null);
      const ok = await verifyBiometric(userId);
      setBusy(false);
      if (ok) completeUnlock();
      else setError("Não foi possível verificar sua digital. Tente de novo ou use o PIN.");
    },
    [completeUnlock]
  );

  // Work out which screen to show each time the vault opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    autoTried.current = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMode("loading");
      setPin("");
      setConfirmPin("");
      setError(null);
    });

    void (async () => {
      const [lockStatus, bio] = await Promise.all([getLockStatus().catch(() => null), isBiometricAvailable()]);
      if (cancelled) return;
      if (!lockStatus || !lockStatus.userId) {
        setError("Não foi possível verificar o bloqueio agora. Verifique a conexão.");
        setMode("pin");
        return;
      }
      setStatus(lockStatus);
      setBiometricReady(bio);
      if (!lockStatus.hasPin) setMode("setup");
      else if (bio && hasDeviceCredential(lockStatus.userId)) setMode("biometric");
      else setMode("pin");
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Biometric is the default: ask for it as soon as the screen is ready. Some browsers
  // (Safari) insist on a tap first — then the button below is the way in.
  useEffect(() => {
    if (!open || mode !== "biometric" || !status?.userId || autoTried.current) return;
    autoTried.current = true;
    void unlockWithBiometric(status.userId);
  }, [open, mode, status, unlockWithBiometric]);

  /** After a PIN success on a device that can do biometrics but hasn't enrolled yet. */
  async function offerBiometricEnrollment(userId: string) {
    if (!biometricReady || hasDeviceCredential(userId) || hasDeclinedBiometric(userId)) return;
    const enrolled = await enrollBiometric(userId);
    if (!enrolled) setDeclinedBiometric(userId, true);
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!status?.userId || busy) return;
    setBusy(true);
    setError(null);

    if (mode === "setup") {
      if (!PIN_PATTERN.test(pin)) {
        setError("Use de 4 a 8 dígitos.");
        setBusy(false);
        return;
      }
      if (pin !== confirmPin) {
        setError("Os PINs não são iguais.");
        setBusy(false);
        return;
      }
      const res = await setLockPin(pin);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar o PIN.");
        setBusy(false);
        return;
      }
      await offerBiometricEnrollment(status.userId);
      setBusy(false);
      completeUnlock();
      return;
    }

    const res = await verifyLockPin(pin);
    if (!res.ok) {
      setError(res.retryAfter ? `${res.error} (${res.retryAfter}s)` : (res.error ?? "PIN incorreto."));
      setPin("");
      setBusy(false);
      return;
    }
    await offerBiometricEnrollment(status.userId);
    setBusy(false);
    completeUnlock();
  }

  const isSetup = mode === "setup";
  const title = isSetup ? "Criar PIN de bloqueio" : "Conteúdo trancado";
  const description = isSetup
    ? biometricReady
      ? "Esse PIN é o seu plano B. Em seguida você poderá ativar a digital neste aparelho."
      : "Use de 4 a 8 dígitos. Ele protege suas notas e pastas trancadas."
    : mode === "biometric"
      ? "Confirme com a sua digital para ver."
      : "Digite seu PIN para ver.";

  return (
    <Vault open={open} onOpenChange={(next) => !next && cancelPrompt()}>
      <VaultContent aria-label={title}>
        <VaultHeader showCloseButton={false}>
          <VaultIcon type="info">
            {mode === "biometric" ? <Fingerprint className="size-6" /> : <KeyRound className="size-6" />}
          </VaultIcon>
          <VaultTitle>{title}</VaultTitle>
          <VaultDescription>{description}</VaultDescription>
        </VaultHeader>

        {error && <Alert variant="destructive">{error}</Alert>}

        {mode === "biometric" && status?.userId ? (
          <div className="flex flex-col gap-2 pt-2">
            <Button
              fullWidth
              isLoading={busy}
              leftIcon={<Fingerprint />}
              onClick={() => void unlockWithBiometric(status.userId!)}
            >
              Usar digital
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setMode("pin")}>
              Usar PIN
            </Button>
          </div>
        ) : mode === "loading" ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Verificando…</p>
        ) : (
          <form onSubmit={submitPin} className="flex flex-col gap-3 pt-2">
            <Input
              type="password"
              inputMode="numeric"
              autoComplete={isSetup ? "new-password" : "one-time-code"}
              autoFocus
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder={isSetup ? "Novo PIN (4 a 8 dígitos)" : "PIN"}
              aria-label="PIN"
              className="text-center font-mono tracking-[0.4em]"
            />
            {isSetup && (
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Repita o PIN"
                aria-label="Repita o PIN"
                className="text-center font-mono tracking-[0.4em]"
              />
            )}
            <div className="flex flex-col gap-2 pt-1">
              <Button type="submit" fullWidth isLoading={busy} disabled={pin.length < 4}>
                {isSetup ? "Criar PIN" : "Desbloquear"}
              </Button>
              {!isSetup && biometricReady && status?.userId && hasDeviceCredential(status.userId) && (
                <Button
                  type="button"
                  variant="ghost"
                  fullWidth
                  leftIcon={<Fingerprint />}
                  onClick={() => {
                    setMode("biometric");
                    void unlockWithBiometric(status.userId!);
                  }}
                >
                  Usar digital
                </Button>
              )}
            </div>
          </form>
        )}
      </VaultContent>
    </Vault>
  );
}
