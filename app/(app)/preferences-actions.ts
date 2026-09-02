"use server";

import { createClient } from "@/lib/supabase/server";

export interface UserPreferencesData {
  viewMode?: "grid" | "list";
  selectedSourceFilters?: string[];
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
