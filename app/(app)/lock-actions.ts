"use server";

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const PIN_PATTERN = /^\d{4,8}$/;
const FREE_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

export interface LockStatus {
  hasPin: boolean;
  /** Needed client-side to scope this device's biometric credential to the account. */
  userId: string | null;
}

export interface LockResult {
  ok?: boolean;
  error?: string;
  /** Seconds to wait before another attempt, when the PIN is temporarily locked out. */
  retryAfter?: number;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

async function hashPin(pin: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function matchesPin(pin: string, stored: string) {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(pin, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * All access to `user_lock_pins` goes through the service-role client — the table
 * has no RLS policy at all (see migration 0050), so a live session can't read the
 * hash or reset the attempt counter by talking to PostgREST directly.
 */
export async function getLockStatus(): Promise<LockStatus> {
  const user = await requireUser();
  if (!user) return { hasPin: false, userId: null };
  const { data } = await createAdminClient()
    .from("user_lock_pins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return { hasPin: !!data, userId: user.id };
}

/** Checks the PIN with exponential back-off after repeated failures. */
async function checkPin(userId: string, pin: string): Promise<LockResult> {
  if (!PIN_PATTERN.test(pin)) return { error: "PIN incorreto." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("user_lock_pins")
    .select("pin_hash, failed_attempts, locked_until")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return { error: "Nenhum PIN configurado." };

  const now = Date.now();
  const until = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (until > now) {
    return { error: "Muitas tentativas. Aguarde um pouco.", retryAfter: Math.ceil((until - now) / 1000) };
  }

  if (await matchesPin(pin, row.pin_hash)) {
    if (row.failed_attempts > 0 || row.locked_until) {
      await admin.from("user_lock_pins").update({ failed_attempts: 0, locked_until: null }).eq("user_id", userId);
    }
    return { ok: true };
  }

  const failed = row.failed_attempts + 1;
  const backoff = failed >= FREE_ATTEMPTS ? Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** (failed - FREE_ATTEMPTS)) : 0;
  await admin
    .from("user_lock_pins")
    .update({ failed_attempts: failed, locked_until: backoff ? new Date(now + backoff).toISOString() : null })
    .eq("user_id", userId);

  return backoff
    ? { error: "PIN incorreto. Muitas tentativas — aguarde.", retryAfter: Math.ceil(backoff / 1000) }
    : { error: "PIN incorreto." };
}

export async function verifyLockPin(pin: string): Promise<LockResult> {
  const user = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };
  return checkPin(user.id, String(pin ?? ""));
}

/** First-time setup, or a change when `currentPin` is supplied and correct. */
export async function setLockPin(pin: string, currentPin?: string): Promise<LockResult> {
  const user = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  const next = String(pin ?? "").trim();
  if (!PIN_PATTERN.test(next)) return { error: "Use de 4 a 8 dígitos." };

  const admin = createAdminClient();
  const { data: existing } = await admin.from("user_lock_pins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (existing) {
    const check = await checkPin(user.id, String(currentPin ?? ""));
    if (!check.ok) return check;
  }

  const { error } = await admin.from("user_lock_pins").upsert({
    user_id: user.id,
    pin_hash: await hashPin(next),
    failed_attempts: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  });
  return error ? { error: "Não foi possível salvar o PIN." } : { ok: true };
}

/** Removing the PIN also unlocks everything — otherwise locked notes could never be opened again. */
export async function removeLockPin(currentPin: string): Promise<LockResult> {
  const user = await requireUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  const check = await checkPin(user.id, String(currentPin ?? ""));
  if (!check.ok) return check;

  const admin = createAdminClient();
  await Promise.all([
    admin.from("notes").update({ locked: false }).eq("user_id", user.id).eq("locked", true),
    admin.from("folders").update({ locked: false }).eq("user_id", user.id).eq("locked", true),
  ]);
  const { error } = await admin.from("user_lock_pins").delete().eq("user_id", user.id);
  return error ? { error: "Não foi possível remover o PIN." } : { ok: true };
}
