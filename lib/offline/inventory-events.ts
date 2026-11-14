/** Fired whenever something is downloaded to, or removed from, this device — the DeviceListener re-reports the inventory on it. */
export const OFFLINE_INVENTORY_CHANGED_EVENT = "study-notes:offline-inventory-changed";

export function notifyInventoryChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_INVENTORY_CHANGED_EVENT));
}
