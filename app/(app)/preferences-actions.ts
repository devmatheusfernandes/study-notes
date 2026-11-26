"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizeHighlightLabel, type HighlightLabels } from "@/lib/jwlibrary/highlight-labels";

export interface UserPreferencesData {
  viewMode?: "grid" | "list";
  selectedSourceFilters?: string[];
  highlightLabels?: HighlightLabels;
}

/** Six colours, short titles — anything else is dropped before it reaches the account metadata. */
function cleanHighlightLabels(labels: HighlightLabels): HighlightLabels {
  const clean: HighlightLabels = {};
  for (let index = 1; index <= 6; index++) {
    const value = labels?.[index];
    const label = typeof value === "string" ? normalizeHighlightLabel(value) : "";
    if (label) clean[index] = label;
  }
  return clean;
}

export async function getUserPreferences(): Promise<UserPreferencesData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.user_metadata?.preferences) {
    return {};
  }

  return user.user_metadata.preferences as UserPreferencesData;
}

export async function updateUserPreferences(
  patch: UserPreferencesData
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Usuário não autenticado." };

  const currentPreferences = (user.user_metadata?.preferences ?? {}) as UserPreferencesData;
  const updatedPreferences = { ...currentPreferences, ...patch };
  if (patch.highlightLabels) updatedPreferences.highlightLabels = cleanHighlightLabels(patch.highlightLabels);

  const { error } = await supabase.auth.updateUser({
    data: {
      ...user.user_metadata,
      preferences: updatedPreferences,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return {};
}
