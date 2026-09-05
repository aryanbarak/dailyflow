// Client-side avatar preparation: validate the picked file, center-crop it
// to a square and downscale to AVATAR_SIZE px, and re-encode as JPEG so the
// stored object is always small ('avatars' bucket caps objects at 2 MB and
// only accepts jpeg/png/webp — see the profile_avatar migration).

export const AVATAR_SIZE = 512;
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export type AvatarImageError = "not_an_image" | "too_large" | "decode_failed";

export class AvatarImageProcessingError extends Error {
  readonly reason: AvatarImageError;

  constructor(reason: AvatarImageError) {
    super(reason);
    this.name = "AvatarImageProcessingError";
    this.reason = reason;
  }
}

export function validateAvatarFile(file: File): AvatarImageError | null {
  if (!file.type.startsWith("image/")) return "not_an_image";
  if (file.size > MAX_SOURCE_BYTES) return "too_large";
  return null;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AvatarImageProcessingError("decode_failed"));
    };
    img.src = url;
  });
}

export async function processAvatarImage(file: File): Promise<Blob> {
  const invalid = validateAvatarFile(file);
  if (invalid) throw new AvatarImageProcessingError(invalid);

  const img = await loadImageElement(file);
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  if (!sourceWidth || !sourceHeight) {
    throw new AvatarImageProcessingError("decode_failed");
  }

  const cropSize = Math.min(sourceWidth, sourceHeight);
  const cropX = (sourceWidth - cropSize) / 2;
  const cropY = (sourceHeight - cropSize) / 2;
  const targetSize = Math.min(AVATAR_SIZE, cropSize);

  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarImageProcessingError("decode_failed");

  // JPEG has no alpha channel: flatten transparent PNG/WebP sources onto
  // white instead of the default black.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, targetSize, targetSize);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new AvatarImageProcessingError("decode_failed"));
      },
      "image/jpeg",
      0.85,
    );
  });
}
