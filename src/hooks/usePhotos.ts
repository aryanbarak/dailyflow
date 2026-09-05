import { useCallback, useEffect, useState } from "react";
import { createId } from "@/lib/id";
import { toast } from "sonner";
import { useAuth } from "@/providers/AuthProvider";
import { photosService, type Photo, type PhotoPatch } from "@/features/photos/photosService";
import { getErrorMessage } from "@/lib/errors";

const PHOTOS_API = "https://api.barakzai.cloud";

export type UploadStatus = "pending" | "uploading" | "done" | "error";

export interface UploadProgress {
  fileId: string;
  fileName: string;
  status: UploadStatus;
  error?: string;
}

async function generateThumbnailAndDimensions(file: File): Promise<{
  thumb: Blob | null;
  width: number | null;
  height: number | null;
}> {
  try {
    const bitmap = await createImageBitmap(file);
    const origW = bitmap.width;
    const origH = bitmap.height;
    const MAX_W = 600;
    const scale = origW > MAX_W ? MAX_W / origW : 1;
    const w = Math.round(origW * scale);
    const h = Math.round(origH * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { thumb: null, width: origW, height: origH };
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const thumb = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    });
    return { thumb, width: origW, height: origH };
  } catch {
    return { thumb: null, width: null, height: null };
  }
}

async function uploadToWorker(
  file: File,
  thumb: Blob | null,
  uuid: string,
  accessToken: string,
): Promise<{ key: string; thumbKey: string }> {
  const form = new FormData();
  form.append("file", file);
  if (thumb) form.append("thumb", thumb, `${uuid}_thumb.jpg`);
  form.append("uuid", uuid);

  const res = await fetch(`${PHOTOS_API}/photos/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Upload failed: ${text}`);
  }
  return res.json() as Promise<{ key: string; thumbKey: string }>;
}

async function deleteFromWorker(key: string, accessToken: string): Promise<void> {
  const url = new URL(`${PHOTOS_API}/photos/delete`);
  url.searchParams.set("key", key);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Delete failed: ${text}`);
  }
}

export function usePhotos() {
  const { user, session } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<UploadProgress[]>([]);
  const [aiTaggingIds, setAiTaggingIds] = useState<Set<string>>(new Set());;

  const refresh = useCallback(async () => {
    if (!user) {
      setPhotos([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await photosService.listPhotos(user.id);
      setPhotos(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAiTagging = useCallback(async (photo: Photo, token: string) => {
    setAiTaggingIds((prev) => new Set(prev).add(photo.id));
    try {
      const res = await fetch(`${PHOTOS_API}/photos/analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ key: photo.r2Key }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { tags?: string[] };
      const aiTags = data.tags ?? [];
      if (aiTags.length > 0) {
        const merged = [...new Set([...photo.tags, ...aiTags])];
        const updated = await photosService.updatePhoto(photo.id, { tags: merged });
        setPhotos((prev) => prev.map((p) => (p.id === photo.id ? updated : p)));
      }
    } catch {
      // fire-and-forget, silently ignore
    } finally {
      setAiTaggingIds((prev) => {
        const next = new Set(prev);
        next.delete(photo.id);
        return next;
      });
    }
  }, []);

  const upload = useCallback(
    async (files: File[], albumId?: string | null) => {
      if (!user || !session) {
        toast.error("You must be signed in to upload photos");
        return;
      }
      const token = session.access_token;
      const queue: UploadProgress[] = files.map((f) => ({
        fileId: createId(),
        fileName: f.name,
        status: "pending" as UploadStatus,
      }));
      setUploadQueue(queue);

      await Promise.all(
        files.map(async (file, idx) => {
          const fileId = queue[idx].fileId;

          const updateStatus = (status: UploadStatus, errMsg?: string) => {
            setUploadQueue((prev) =>
              prev.map((q) => (q.fileId === fileId ? { ...q, status, error: errMsg } : q)),
            );
          };

          updateStatus("uploading");
          try {
            const uuid = createId();
            const { thumb, width, height } = await generateThumbnailAndDimensions(file);
            const { key, thumbKey } = await uploadToWorker(file, thumb, uuid, token);
            const photo = await photosService.insertPhoto({
              userId: user.id,
              r2Key: key,
              thumbKey: thumbKey || null,
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type || null,
              width,
              height,
              albumId: albumId ?? null,
            });
            setPhotos((prev) => [photo, ...prev]);
            updateStatus("done");
            void runAiTagging(photo, token);
          } catch (err) {
            updateStatus("error", getErrorMessage(err));
          }
        }),
      );

      setTimeout(() => setUploadQueue([]), 3000);
    },
    [user, session, runAiTagging],
  );

  const remove = useCallback(
    async (photo: Photo) => {
      if (!session) {
        toast.error("Not signed in");
        return;
      }
      try {
        await deleteFromWorker(photo.r2Key, session.access_token);
        await photosService.deletePhoto(photo.id);
        setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
        toast("Photo deleted");
      } catch (err) {
        toast.error(getErrorMessage(err));
      }
    },
    [session],
  );

  const update = useCallback(async (id: string, patch: PhotoPatch) => {
    try {
      const updated = await photosService.updatePhoto(id, patch);
      setPhotos((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }, []);

  return { photos, isLoading, error, uploadQueue, aiTaggingIds, upload, remove, update, refresh };
}
