import {
  removeDeviceInventory,
  saveDeviceInventory,
  type DeviceInventoryItem,
  type DevicePlatform,
} from "@/app/(app)/offline-devices-actions";
import { getBibleOfflineInfo } from "./bible-offline";
import { listOfflinePublications } from "./jwpub-offline";

// Neither key starts with "study-notes:", which sign-out wipes: the device id is
// not account data, and keeping it means signing back in reuses this device's row.
const DEVICE_ID_KEY = "sn-device-id";
const DEVICE_NAME_KEY = "sn-device-name";

/** A random id this browser profile generates once and keeps. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked: a per-load id at least keeps this report from colliding with another device's.
    return crypto.randomUUID();
  }
}

export function detectPlatform(): DevicePlatform {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  if (/iPhone|iPod/.test(ua)) return "phone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "phone" : "tablet";
  return "desktop";
}

function detectOs(): string {
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

/** "Celular Android", "Tablet Android", "Computador Windows" — what the browser can tell; the user can rename it. */
export function defaultDeviceName(): string {
  const kind = { phone: "Celular", tablet: "Tablet", desktop: "Computador" }[detectPlatform()];
  return `${kind} ${detectOs()}`.trim();
}

export function getDeviceName(): string {
  try {
    return localStorage.getItem(DEVICE_NAME_KEY)?.trim() || defaultDeviceName();
  } catch {
    return defaultDeviceName();
  }
}

export function setDeviceName(name: string) {
  try {
    const trimmed = name.trim().slice(0, 60);
    if (trimmed && trimmed !== defaultDeviceName()) localStorage.setItem(DEVICE_NAME_KEY, trimmed);
    else localStorage.removeItem(DEVICE_NAME_KEY);
  } catch {
    // Storage blocked — the default name stays.
  }
}

function isInstalledApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for a home-screen app.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** What this device holds right now, read from its own IndexedDB. */
async function readLocalItems(): Promise<DeviceInventoryItem[]> {
  const [bible, publications] = await Promise.all([getBibleOfflineInfo(), listOfflinePublications()]);
  const items: DeviceInventoryItem[] = [];
  if (bible) items.push({ kind: "bible", title: "Bíblia", bytes: bible.bytes, downloadedAt: bible.downloadedAt });
  for (const p of publications) {
    items.push({
      kind: "publication",
      title: p.publication.title || "Publicação",
      bytes: p.bytes,
      downloadedAt: p.downloadedAt,
      noteId: p.noteId,
    });
  }
  return items;
}

/** Tells the server what this device has downloaded, so Settings can show it on every other device too. */
export async function publishInventory(): Promise<{ error?: string }> {
  return saveDeviceInventory({
    deviceId: getDeviceId(),
    name: getDeviceName(),
    platform: detectPlatform(),
    isPwa: isInstalledApp(),
    items: await readLocalItems(),
  });
}

/** Best effort, on sign-out: the device is about to be wiped, so its report would go stale. */
export async function forgetThisDevice() {
  try {
    await removeDeviceInventory(getDeviceId());
  } catch {
    // Offline — the row stays until the device is forgotten from Settings.
  }
}
