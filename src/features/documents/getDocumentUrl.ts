import { supabase } from "@/integrations/supabase/client";

export async function getDocumentSignedUrl(path: string) {
  const { data, error } = await supabase.storage
    .from("user-documents")
    .createSignedUrl(path, 60 * 10);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Failed to generate signed URL");
  }
  return { url: data.signedUrl };
}
