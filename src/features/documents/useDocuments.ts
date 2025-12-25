import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Document,
  createDocument,
  deleteDocument,
  listDocuments,
  updateDocument,
  uploadToStorage,
  downloadDocument,
} from "@/features/documents/documentsService";

export function useDocuments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const getErrorMessage = useCallback((err: unknown) => {
    if (err instanceof Error && err.message) return err.message;
    if (err && typeof err === "object" && "message" in err) {
      const message = (err as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    return String(err);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setDocuments([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await listDocuments();
      setDocuments(data);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      toast({
        variant: "destructive",
        title: "Failed to load documents",
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast, getErrorMessage]);

  useEffect(() => {
    refresh();
  }, [refresh, user]);

  const createFromUpload = useCallback(
    async (file: File, meta?: { title?: string | null; description?: string | null }) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return;
      }
      setIsUploading(true);
      try {
        const { storagePath, fileName } = await uploadToStorage(user.id, file);
        const created = await createDocument({
          storagePath,
          fileName,
          mimeType: file.type || null,
          sizeBytes: file.size ?? null,
          title: meta?.title ?? null,
          description: meta?.description ?? null,
        });
        setDocuments((prev) => [created, ...prev]);
        toast({ title: "File uploaded" });
      } catch (err) {
        const message = getErrorMessage(err);
        toast({
          variant: "destructive",
          title: "Failed to upload document",
          description: message,
        });
      } finally {
        setIsUploading(false);
      }
    },
    [user, toast, getErrorMessage],
  );

  const updateMeta = useCallback(
    async (id: string, patch: { title?: string | null; description?: string | null }) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return;
      }
      try {
        const updated = await updateDocument(id, patch);
        setDocuments((prev) => prev.map((doc) => (doc.id === id ? updated : doc)));
        toast({ title: "Document updated" });
      } catch (err) {
        const message = getErrorMessage(err);
        toast({
          variant: "destructive",
          title: "Failed to update document",
          description: message,
        });
      }
    },
    [user, toast, getErrorMessage],
  );

  const remove = useCallback(
    async (doc: Document) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return;
      }
      setIsDeleting(true);
      try {
        await deleteDocument(doc.id);
        setDocuments((prev) => prev.filter((item) => item.id !== doc.id));
        toast({ title: "Document deleted" });
      } catch (err) {
        const message = getErrorMessage(err);
        toast({
          variant: "destructive",
          title: "Failed to delete document",
          description: message,
        });
      } finally {
        setIsDeleting(false);
      }
    },
    [user, toast, getErrorMessage],
  );

  const download = useCallback(
    async (doc: Document) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return;
      }
      try {
        const blob = await downloadDocument(doc.storagePath);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = doc.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        const message = getErrorMessage(err);
        toast({
          variant: "destructive",
          title: "Failed to download document",
          description: message,
        });
      }
    },
    [user, toast, getErrorMessage],
  );

  return {
    documents,
    isLoading,
    isUploading,
    isDeleting,
    error,
    refresh,
    createFromUpload,
    updateMeta,
    remove,
    download,
  };
}
