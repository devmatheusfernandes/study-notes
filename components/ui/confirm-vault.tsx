"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Vault, VaultContent, VaultHeader, VaultTitle, VaultDescription, VaultIcon } from "@/components/ui/vault";

interface ConfirmVaultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tints the icon/button red and defaults confirmLabel-adjacent styling for destructive actions. */
  destructive?: boolean;
  onConfirm: () => void;
  /** When set, the confirm button stays disabled until the user types this exact phrase — extra friction for especially broad/irreversible actions (e.g. "wipe everything" in Settings). */
  confirmPhrase?: string;
}

/**
 * The app's one confirmation surface — see the "no modals" rule in CLAUDE.md.
 * Every destructive action (delete note, delete folder, bulk delete, …) confirms
 * through this component instead of a Dialog/AlertDialog, so the confirmation UI
 * is consistent and works the same way on mobile (bottom sheet) as everywhere else.
 */
export function ConfirmVault({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = true,
  onConfirm,
  confirmPhrase,
}: ConfirmVaultProps) {
  const [typed, setTyped] = useState("");

  // Reset the typed phrase each time the vault (re-)opens — during render
  // (React's documented pattern for resetting state on a prop change) rather
  // than an effect, so a stale phrase from a previous open can't linger.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped("");
  }

  const canConfirm = !confirmPhrase || typed === confirmPhrase;

  function confirm() {
    if (!canConfirm) return;
    onConfirm();
    onOpenChange(false);
  }

  return (
    <Vault open={open} onOpenChange={onOpenChange}>
      <VaultContent aria-label={title}>
        <VaultHeader showCloseButton={false}>
          <VaultIcon type={destructive ? "delete" : "confirm"} />
          <VaultTitle>{title}</VaultTitle>
          {description && <VaultDescription>{description}</VaultDescription>}
        </VaultHeader>

        {confirmPhrase && (
          <div className="flex flex-col gap-1.5 pb-1 pt-2">
            <label className="text-center text-[12.5px] text-muted-foreground">
              Digite <span className="font-mono font-semibold text-foreground">{confirmPhrase}</span> para confirmar
            </label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
              placeholder={confirmPhrase}
              autoFocus
              className="text-center font-mono"
            />
          </div>
        )}

        {/* Button carries `shrink-0`, so each needs its own flex-1 wrapper to
            share the row instead of overflowing it. */}
        <div className="flex gap-2 pt-2">
          <div className="flex-1">
            <Button variant="outline" fullWidth onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
          </div>
          <div className="flex-1">
            <Button
              variant={destructive ? "destructive" : "default"}
              fullWidth
              disabled={!canConfirm}
              onClick={confirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </VaultContent>
    </Vault>
  );
}
