"use client";

import { Button } from "@/components/ui/button";
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
}: ConfirmVaultProps) {
  return (
    <Vault open={open} onOpenChange={onOpenChange}>
      <VaultContent aria-label={title}>
        <VaultHeader showCloseButton={false}>
          <VaultIcon type={destructive ? "delete" : "confirm"} />
          <VaultTitle>{title}</VaultTitle>
          {description && <VaultDescription>{description}</VaultDescription>}
        </VaultHeader>

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
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </VaultContent>
    </Vault>
  );
}
