// @vitest-environment jsdom
// Profile photo service (PROFILE-AVATAR-1): setAvatar uploads the processed
// image to the per-user folder of the public 'avatars' bucket, stores a
// cache-busted public URL on the profile row, and announces the mutation so
// every mounted useProfile() instance (sidebar, settings hero) refetches;
// clearAvatar removes the object and nulls the column.
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();
const removeMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => uploadMock(bucket, ...args),
        getPublicUrl: (...args: unknown[]) => getPublicUrlMock(bucket, ...args),
        remove: (...args: unknown[]) => removeMock(bucket, ...args),
      }),
    },
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            single: () => updateMock(values),
          }),
        }),
      }),
    }),
  },
}));

import { setAvatar, clearAvatar, PROFILE_UPDATED_EVENT } from "./profileService";
import { validateAvatarFile, MAX_SOURCE_BYTES } from "./avatarImage";

const PROFILE_ROW = {
  id: "p1",
  user_id: "user-1",
  display_name: "Aryan",
  bio: null,
  avatar_url: "https://cdn.example/avatars/user-1/avatar.jpg?v=1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ error: null });
  getPublicUrlMock.mockReturnValue({ data: { publicUrl: "https://cdn.example/avatars/user-1/avatar.jpg" } });
  removeMock.mockResolvedValue({ error: null });
  updateMock.mockResolvedValue({ data: PROFILE_ROW, error: null });
});

describe("setAvatar (task PROFILE-AVATAR-1)", () => {
  it("uploads to '<userId>/avatar.jpg' in the avatars bucket with upsert and stores a cache-busted public URL", async () => {
    const blob = new Blob(["x"], { type: "image/jpeg" });
    const profile = await setAvatar("user-1", blob);

    expect(uploadMock).toHaveBeenCalledWith(
      "avatars",
      "user-1/avatar.jpg",
      blob,
      { upsert: true, contentType: "image/jpeg" },
    );
    const written = updateMock.mock.calls[0][0] as { avatar_url: string };
    expect(written.avatar_url).toMatch(
      /^https:\/\/cdn\.example\/avatars\/user-1\/avatar\.jpg\?v=\d+$/,
    );
    expect(profile.avatarUrl).toBe(PROFILE_ROW.avatar_url);
  });

  it("announces the mutation so other useProfile() instances refetch", async () => {
    const listener = vi.fn();
    window.addEventListener(PROFILE_UPDATED_EVENT, listener);
    try {
      await setAvatar("user-1", new Blob(["x"], { type: "image/jpeg" }));
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(PROFILE_UPDATED_EVENT, listener);
    }
  });

  it("surfaces an upload failure without touching the profile row", async () => {
    uploadMock.mockResolvedValue({ error: { message: "denied" } });
    await expect(setAvatar("user-1", new Blob(["x"]))).rejects.toThrow("denied");
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("clearAvatar (task PROFILE-AVATAR-1)", () => {
  it("removes the stored object and nulls avatar_url", async () => {
    await clearAvatar("user-1");
    expect(removeMock).toHaveBeenCalledWith("avatars", ["user-1/avatar.jpg"]);
    expect(updateMock).toHaveBeenCalledWith({ avatar_url: null });
  });
});

describe("validateAvatarFile (task PROFILE-AVATAR-1)", () => {
  it("rejects non-image files and oversized sources, accepts a normal image", () => {
    expect(validateAvatarFile(new File(["x"], "a.txt", { type: "text/plain" }))).toBe("not_an_image");
    const big = new File([new Uint8Array(1)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: MAX_SOURCE_BYTES + 1 });
    expect(validateAvatarFile(big)).toBe("too_large");
    expect(validateAvatarFile(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBeNull();
  });
});
