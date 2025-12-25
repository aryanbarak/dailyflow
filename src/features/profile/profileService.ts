import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export interface Profile {
  id: string;
  userId: string;
  displayName: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

function mapRowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    bio: row.bio,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOrCreateProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,user_id,display_name,bio,created_at,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load profile");
  }

  if (data) return mapRowToProfile(data as ProfileRow);

  const { data: created, error: createError } = await supabase
    .from("profiles")
    .insert({ user_id: userId })
    .select("id,user_id,display_name,bio,created_at,updated_at")
    .single();

  if (createError || !created) {
    throw new Error(createError?.message || "Failed to create profile");
  }

  return mapRowToProfile(created as ProfileRow);
}

export async function updateProfile(
  userId: string,
  data: { displayName?: string; bio?: string },
): Promise<Profile> {
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      display_name:
        data.displayName === undefined ? undefined : data.displayName.trim() || null,
      bio: data.bio === undefined ? undefined : data.bio.trim() || null,
    })
    .eq("user_id", userId)
    .select("id,user_id,display_name,bio,created_at,updated_at")
    .single();

  if (error || !updated) {
    throw new Error(error?.message || "Failed to update profile");
  }

  return mapRowToProfile(updated as ProfileRow);
}
