import type { TagPlan } from "./tag-plan-types";

const STORAGE_KEY = "study-notes:jwlibrary-tag-plan";

/**
 * The AI-generated plan is deliberately never persisted server-side until the
 * user approves each operation (see the review screen at /jwlibrary/tag-ai)
 * — this just keeps it alive across a reload on the same browser/device.
 */
export function loadTagPlan(): TagPlan | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TagPlan;
  } catch {
    return null;
  }
}

export function saveTagPlan(plan: TagPlan): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // localStorage can throw (private browsing, quota) — the in-memory
    // React state still works for the rest of this session either way.
  }
}

export function clearTagPlan(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // see saveTagPlan
  }
}
