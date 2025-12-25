import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface DocumentViewerDialogProps {
  path: string;
  open: boolean;
  onClose: () => void;
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function getExtension(path: string) {
  const parts = path.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1]?.toLowerCase() ?? "";
}

export function DocumentViewerDialog({ path, open, onClose }: DocumentViewerDialogProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extension = useMemo(() => getExtension(path), [path]);
  const isImage = IMAGE_EXTENSIONS.has(extension);
  const isPdf = extension === "pdf";

  useEffect(() => {
    if (!open || !path) {
      setSignedUrl(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    supabase.storage
      .from("user-documents")
      .createSignedUrl(path, 60 * 10)
      .then(({ data, error: signError }) => {
        if (!isMounted) return;
        if (signError || !data?.signedUrl) {
          setError(signError?.message || "Failed to load preview");
          setSignedUrl(null);
        } else {
          setSignedUrl(data.signedUrl);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : String(err));
        setSignedUrl(null);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, path]);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw]">
        <DialogHeader>
          <DialogTitle>Document Preview</DialogTitle>
        </DialogHeader>
        <div className="min-h-[60vh] flex items-center justify-center">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading preview...
            </div>
          )}
          {!isLoading && error && (
            <div className="text-sm text-destructive">{error}</div>
          )}
          {!isLoading && !error && signedUrl && isPdf && (
            <iframe title="PDF preview" src={signedUrl} className="w-full h-[70vh] rounded-md border border-border" />
          )}
          {!isLoading && !error && signedUrl && isImage && (
            <img src={signedUrl} alt="Document preview" className="max-w-full max-h-[70vh] rounded-md" />
          )}
          {!isLoading && !error && signedUrl && !isPdf && !isImage && (
            <div className="text-sm text-muted-foreground">
              Preview not available for this file type.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
