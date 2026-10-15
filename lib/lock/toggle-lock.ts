"use client";

import { getLockStatus } from "@/app/(app)/lock-actions";
import { useLockStore } from "@/lib/store/lock-store";

/**
 * Locking something needs a PIN to exist (it's the way back in), but not a fresh
 * authentication when one does: anyone may close the door. Without a PIN yet this
 * opens the unlock vault in its setup state. Returns false if the user backed out.
 */
export async function authorizeLocking(): Promise<boolean> {
  const status = await getLockStatus().catch(() => null);
  if (status?.hasPin) return true;
  return useLockStore.getState().requestUnlock();
}

/** Lock a note/folder: authorize, apply, and hide it right away (re-lock the session). */
export async function lockItem(apply: () => void): Promise<boolean> {
  if (!(await authorizeLocking())) return false;
  apply();
  useLockStore.getState().lock();
  return true;
}

/** Unlock a note/folder for good: opening the door again requires proving who you are. */
export async function unlockItem(apply: () => void): Promise<boolean> {
  if (!(await useLockStore.getState().requestUnlock())) return false;
  apply();
  return true;
}
