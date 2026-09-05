import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export interface Profile {
  id: string;
  userId: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

const PROFILE_COLUMNS = "id,user_id,display_name,bio,avatar_url,created_at,updated_at";

// Storage bucket created by supabase/migrations/20260905000000_profile_avatar.sql:
// public read, per-user write policies on the '<user_id>/...' folder.
const AVATARS_BUCKET = "avatars";
const AVATAR_OBJECT_NAME = "avatar.jpg";

// Every useProfile() instance (Settings tab, sidebar footer, Home rail)
// fetches independently; this event tells the others to refetch after a
// mutation so the avatar/name change shows up everywhere without a remount.
export const PROFILE_UPDATED_EVENT = "smartflow:profile-updated";

function announceProfileUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  }
}

function mapRowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOrCreateProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load profile");
  }

  if (data) return mapRowToProfile(data as ProfileRow);

  const { data: created, error: createError } = await supabase
    .from("profiles")
    .insert({ user_id: userId })
    .select(PROFILE_COLUMNS)
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
    .select(PROFILE_COLUMNS)
    .single();

  if (error || !updated) {
    throw new Error(error?.message || "Failed to update profile");
  }

  announceProfileUpdated();
  return mapRowToProfile(updated as ProfileRow);
}

async function updateAvatarUrl(userId: string, avatarUrl: string | null): Promise<Profile> {
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("user_id", userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error || !updated) {
    throw new Error(error?.message || "Failed to update profile photo");
  }

  announceProfileUpdated();
  return mapRowToProfile(updated as ProfileRow);
}

export async function setAvatar(userId: string, image: Blob): Promise<Profile> {
  const objectPath = `${userId}/${AVATAR_OBJECT_NAME}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(objectPath, image, { upsert: true, contentType: "image/jpeg" });

  if (uploadError) {
    throw new Error(uploadError.message || "Failed to upload profile photo");
  }

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(objectPath);
  if (!data?.publicUrl) {
    throw new Error("Failed to resolve profile photo URL");
  }

  // The object path is stable (upsert), so bust caches with the upload time.
  return updateAvatarUrl(userId, `${data.publicUrl}?v=${Date.now()}`);
}

export async function clearAvatar(userId: string): Promise<Profile> {
  const { error: removeError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .remove([`${userId}/${AVATAR_OBJECT_NAME}`]);

  if (removeError) {
    throw new Error(removeError.message || "Failed to remove profile photo");
  }

  return updateAvatarUrl(userId, null);
}
