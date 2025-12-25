import { useEffect, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Download,
  ExternalLink,
  Loader2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { getDocumentSignedUrl } from "@/features/documents/getDocumentUrl";
import { useToast } from "@/hooks/use-toast";

let workerSrcUrl: string;
try {
  workerSrcUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
} catch {
  workerSrcUrl = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.js",
    import.meta.url,
  ).toString();
}
pdfjs.GlobalWorkerOptions.workerSrc = workerSrcUrl;

export interface DocumentPreviewItem {
  id: string;
  name: string;
  path: string;
  contentType: string | null;
  createdAt?: string;
  size?: number | null;
}

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentPreviewItem | null;
}

function formatBytes(value: number | null | undefined) {
  if (!value && value !== 0) return "Unknown";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(value?: string) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
}

export function DocumentPreviewDialog({
  open,
  onOpenChange,
  document,
}: DocumentPreviewDialogProps) {
  const { toast } = useToast();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [numPages, setNumPages] = useState(0);

  const docKey = useMemo(
    () => `${document?.id ?? ""}:${document?.path ?? ""}`,
    [document?.id, document?.path],
  );
  const documentPath = document?.path ?? null;
  const isPdf = useMemo(() => {
    if (!document) return false;
    if (document.contentType?.includes("pdf")) return true;
    return document.name.toLowerCase().endsWith(".pdf");
  }, [document]);
  const pdfFile = useMemo(
    () => (signedUrl ? { url: signedUrl } : null),
    [signedUrl],
  );

  useEffect(() => {
    if (!open || !documentPath) {
      setSignedUrl(null);
      setError(null);
      setScale(1);
      setNumPages(0);
      setIsLoading(false);
      return;
    }

    setSignedUrl(null);
    setError(null);
    setScale(1);
    setNumPages(0);
  }, [open, docKey, documentPath, isPdf]);

  useEffect(() => {
    if (!open || !documentPath) return;
    let alive = true;
    const controller = new AbortController();
    setIsLoading(true);

    const loadPreview = async () => {
      try {
        const { url } = await getDocumentSignedUrl(documentPath);
        if (!alive) return;
        setSignedUrl(url);
        setError(null);
      } catch (err) {
        if (!alive) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        console.error("Document preview load failed:", err);
        toast({
          variant: "destructive",
          title: "Failed to load preview",
          description: message,
        });
      } finally {
        if (alive) setIsLoading(false);
      }
    };

    void loadPreview();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [open, documentPath, toast]);

  const handleDownload = () => {
    if (!signedUrl) return;
    const link = document?.name ?? "document";
    const a = window.document.createElement("a");
    a.href = signedUrl;
    a.download = link;
    a.target = "_blank";
    a.rel = "noreferrer";
    window.document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!document) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw]">
        <DialogHeader>
          <DialogTitle>{document.name}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {formatBytes(document.size)} · {formatDate(document.createdAt)}
          </div>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 border border-border/60 rounded-md px-3 py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setScale((s) => Math.min(3, s + 0.2))}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="secondary" size="icon" onClick={() => setScale(1)}>
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              disabled={!signedUrl}
              onClick={() => signedUrl && window.open(signedUrl, "_blank")}
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={handleDownload}
              disabled={!signedUrl}
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Single scroll container keeps PDF scrolling stable without nested overflow. */}
        <div className="min-h-[60vh] max-h-[75vh] overflow-auto rounded-md border border-border/60 bg-muted/20">
          <div className="p-4">
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
              <div className="w-full">
                <Document
                  key={docKey}
                  file={pdfFile}
                  onSourceError={(err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message);
                    console.error("Document source error:", err);
                  }}
                  onLoadSuccess={(pdf) => {
                    setNumPages(pdf.numPages);
                  }}
                  onLoadError={(err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message);
                    console.error("Document load error:", err);
                  }}
                >
                  {numPages > 0 &&
                    Array.from({ length: numPages }, (_, index) => (
                      <Page
                        key={`page:${docKey}:${index + 1}`}
                        pageNumber={index + 1}
                        scale={scale}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        className="my-3"
                      />
                    ))}
                </Document>
              </div>
            )}
            {!isLoading && !error && signedUrl && !isPdf && (
              <div className="text-sm text-muted-foreground">
                Preview supports PDFs only.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
