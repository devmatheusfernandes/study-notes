"use server";

import { createClient } from "@/lib/supabase/server";

export type DevicePlatform = "phone" | "tablet" | "desktop";

export interface DeviceInventoryItem {
  kind: "bible" | "publication";
  title: string;
  bytes: number;
  downloadedAt: number;
  noteId?: string;
}

export interface DeviceInventory {
  deviceId: string;
  name: string;
  platform: DevicePlatform;
  isPwa: boolean;
  items: DeviceInventoryItem[];
  updatedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 300;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** A device reports what it holds. Replaces its previous report — the inventory is a snapshot, not a log. */
export async function saveDeviceInventory(input: {
  deviceId: string;
  name: string;
  platform: DevicePlatform;
  isPwa: boolean;
  items: DeviceInventoryItem[];
}): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const name = input.name.trim().slice(0, 60);
  if (!UUID.test(input.deviceId) || !name) return { error: "Aparelho inválido." };
  if (!["phone", "tablet", "desktop"].includes(input.platform)) return { error: "Aparelho inválido." };
  if (!Array.isArray(input.items) || input.items.length > MAX_ITEMS) return { error: "Inventário inválido." };

  const items: DeviceInventoryItem[] = [];
  for (const item of input.items) {
    if (item.kind !== "bible" && item.kind !== "publication") continue;
    items.push({
      kind: item.kind,
      title: String(item.title ?? "").trim().slice(0, 200),
      bytes: Number.isFinite(item.bytes) && item.bytes > 0 ? Math.round(item.bytes) : 0,
      downloadedAt: Number.isFinite(item.downloadedAt) ? Math.round(item.downloadedAt) : 0,
      ...(typeof item.noteId === "string" && UUID.test(item.noteId) ? { noteId: item.noteId } : {}),
    });
  }

  const { error } = await supabase.from("device_offline_inventory").upsert(
    {
      user_id: user.id,
      device_id: input.deviceId,
      name,
      platform: input.platform,
      is_pwa: input.isPwa === true,
      items,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,device_id" }
  );
  return error ? { error: "Não foi possível registrar este aparelho." } : {};
}

/** Every device of the signed-in user, most recently seen first. */
export async function listDeviceInventories(): Promise<{ devices?: DeviceInventory[]; error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };

  const { data, error } = await supabase
    .from("device_offline_inventory")
    .select("device_id, name, platform, is_pwa, items, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return { error: "Não foi possível carregar os aparelhos." };

  return {
    devices: (data ?? []).map((row) => ({
      deviceId: row.device_id,
      name: row.name,
      platform: (["phone", "tablet", "desktop"].includes(row.platform) ? row.platform : "desktop") as DevicePlatform,
      isPwa: row.is_pwa,
      items: Array.isArray(row.items) ? (row.items as DeviceInventoryItem[]) : [],
      updatedAt: row.updated_at,
    })),
  };
}

/** Forgets a device's report (a retired phone, a browser profile that was cleared). The device itself is untouched and registers again the next time it opens the app. */
export async function removeDeviceInventory(deviceId: string): Promise<{ error?: string }> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Sessão expirada." };
  if (!UUID.test(deviceId)) return { error: "Aparelho inválido." };

  const { error } = await supabase.from("device_offline_inventory").delete().eq("device_id", deviceId);
  return error ? { error: "Não foi possível esquecer o aparelho." } : {};
}
