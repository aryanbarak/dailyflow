import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Eraser,
  ExternalLink,
  Loader2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Type,
} from "lucide-react";
import { getDocumentSignedUrl } from "@/features/documents/getDocumentUrl";
import { useToast } from "@/hooks/use-toast";

let workerSrcUrl: string;
try {
  workerSrcUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.js",
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

type Point = { x: number; y: number };

type DrawAnnotation = { id: string; type: "draw"; page: number; points: Point[] };
type TextAnnotation = {
  id: string;
  type: "text";
  page: number;
  x: number;
  y: number;
  text: string;
  fontSize?: number;
};
type Annotation = DrawAnnotation | TextAnnotation;

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
  const [pageNumber, setPageNumber] = useState(1);
  const [viewMode, setViewMode] = useState<"single" | "scroll">("scroll");
  const [tool, setTool] = useState<"pan" | "draw" | "text">("pan");
  const [isDrawing, setIsDrawing] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [textDraft, setTextDraft] = useState<{ page: number; x: number; y: number; value: string } | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const pageContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const currentStrokeRef = useRef<Point[]>([]);

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

  const createAnnotationId = useCallback(
    () => `anno_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  useEffect(() => {
    if (!open || !documentPath) {
      setSignedUrl(null);
      setError(null);
      setScale(1);
      setNumPages(0);
      setPageNumber(1);
      setTool("pan");
      setIsDrawing(false);
      setCurrentStroke([]);
      setTextDraft(null);
      setIsLoading(false);
      return;
    }

    setSignedUrl(null);
    setError(null);
    setScale(1);
    setNumPages(0);
    setPageNumber(1);
    setTool("pan");
    setIsDrawing(false);
    setCurrentStroke([]);
    setTextDraft(null);
    if (isPdf) setViewMode("scroll");
  }, [open, docKey, documentPath, isPdf]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, pageSize.width, pageSize.height);
    if (!pageSize.width || !pageSize.height) return;

    const pageAnnotations = annotations.filter((annotation) => annotation.page === pageNumber);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#14b8a6";
    ctx.fillStyle = "#0f172a";
    ctx.font = "12px system-ui";
    ctx.textBaseline = "top";
    for (const annotation of pageAnnotations) {
      if (annotation.type === "draw") {
        if (annotation.points.length < 2) continue;
        ctx.beginPath();
        annotation.points.forEach((point, index) => {
          const x = point.x;
          const y = point.y;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      } else {
        const x = annotation.x;
        const y = annotation.y;
        if (annotation.fontSize) {
          ctx.font = `${annotation.fontSize}px system-ui`;
        } else {
          ctx.font = "12px system-ui";
        }
        ctx.fillText(annotation.text, x, y);
      }
    }

    if (tool === "draw" && isDrawing && currentStrokeRef.current.length > 1) {
      ctx.beginPath();
      currentStrokeRef.current.forEach((point, index) => {
        const x = point.x;
        const y = point.y;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [annotations, isDrawing, pageNumber, pageSize.height, pageSize.width, tool]);

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

  const updateOverlaySize = useCallback(() => {
    const container = pageContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Track rendered page size in CSS pixels for overlay sizing.
    setPageSize({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => {
    const container = pageContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => updateOverlaySize());
    observer.observe(container);
    window.addEventListener("resize", updateOverlaySize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverlaySize);
    };
  }, [updateOverlaySize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pageSize.width || !pageSize.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(pageSize.width * dpr);
    canvas.height = Math.round(pageSize.height * dpr);
    canvas.style.width = `${pageSize.width}px`;
    canvas.style.height = `${pageSize.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawCanvas();
  }, [pageSize, redrawCanvas]);

  useEffect(() => {
    redrawCanvas();
  }, [annotations, currentStroke, isDrawing, pageNumber, scale, pageSize, tool, redrawCanvas]);

  useEffect(() => {
    currentStrokeRef.current = currentStroke;
  }, [currentStroke]);

  useEffect(() => {
    setTextDraft(null);
  }, [pageNumber, tool, viewMode]);

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

  const handleClearPage = () => {
    setAnnotations((prev) => prev.filter((annotation) => annotation.page !== pageNumber));
    setCurrentStroke([]);
    setTextDraft(null);
  };

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // Store annotations in CSS pixel space to match the overlay canvas.
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return {
      x: Math.max(0, Math.min(rect.width, x)),
      y: Math.max(0, Math.min(rect.height, y)),
    };
  };

  const scheduleRedraw = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      redrawCanvas();
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === "text") {
      if (!pageSize.width || !pageSize.height) return;
      const point = getPoint(event);
      setTextDraft({ page: pageNumber, x: point.x, y: point.y, value: "" });
      return;
    }
    if (tool !== "draw") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    setIsDrawing(true);
    setCurrentStroke([point]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool !== "draw" || !isDrawing) return;
    const point = getPoint(event);
    setCurrentStroke((prev) => [...prev, point]);
    scheduleRedraw();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool !== "draw") return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setIsDrawing(false);
    if (currentStrokeRef.current.length > 1) {
      setAnnotations((prev) => [
        ...prev,
        { id: createAnnotationId(), type: "draw", page: pageNumber, points: currentStrokeRef.current },
      ]);
    }
    setCurrentStroke([]);
  };

  const commitDraftText = () => {
    if (!textDraft) return;
    const trimmed = textDraft.value.trim();
    if (!trimmed) {
      setTextDraft(null);
      return;
    }
    setAnnotations((prev) => [
      ...prev,
      {
        id: createAnnotationId(),
        type: "text",
        page: textDraft.page,
        x: textDraft.x,
        y: textDraft.y,
        text: trimmed,
      },
    ]);
    setTextDraft(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw]">
        <DialogHeader>
          <DialogTitle>{document.name}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {formatBytes(document.size)} - {formatDate(document.createdAt)}
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

          {isPdf && viewMode === "single" && numPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span>
                Page {pageNumber} / {numPages || 1}
              </span>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}

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
            {isPdf && (
              <Button
                variant={tool === "draw" ? "default" : "secondary"}
                size="sm"
                disabled={viewMode === "scroll"}
                title={viewMode === "scroll" ? "Switch to Single to annotate" : undefined}
                onClick={() => {
                  setViewMode("single");
                  setTool((value) => (value === "draw" ? "pan" : "draw"));
                  setIsDrawing(false);
                }}
              >
                <Pencil className="w-4 h-4 mr-1" />
                Draw
              </Button>
            )}
            {isPdf && (
              <Button
                variant={tool === "text" ? "default" : "secondary"}
                size="sm"
                disabled={viewMode === "scroll"}
                title={viewMode === "scroll" ? "Switch to Single to annotate" : undefined}
                onClick={() => {
                  setViewMode("single");
                  setTool((value) => (value === "text" ? "pan" : "text"));
                  setIsDrawing(false);
                }}
              >
                <Type className="w-4 h-4 mr-1" />
                Text
              </Button>
            )}
            {isPdf && (
              <Button variant="secondary" size="sm" onClick={handleClearPage}>
                <Eraser className="w-4 h-4 mr-1" />
                Clear
              </Button>
            )}
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
            {!isLoading && !error && signedUrl && isPdf && pdfFile && (
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
                    setPageNumber((p) => Math.min(Math.max(1, p), pdf.numPages));
                  }}
                  onLoadError={(err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message);
                    console.error("Document load error:", err);
                  }}
                >
                  {viewMode === "single" && numPages > 0 ? (
                    <div className="relative inline-block">
                      <div ref={pageContainerRef} className="relative">
                        <Page
                          pageNumber={pageNumber}
                          scale={scale}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          className="my-3"
                          onRenderSuccess={updateOverlaySize}
                        />
                      </div>
                      {textDraft && (
                        <textarea
                          autoFocus
                          className="absolute rounded border border-border bg-white/95 px-2 py-1 text-xs text-foreground shadow-sm outline-none"
                          style={{
                            left: `${textDraft.x}px`,
                            top: `${textDraft.y}px`,
                            width: "240px",
                            minHeight: "32px",
                          }}
                          value={textDraft.value}
                          onChange={(event) =>
                            setTextDraft((prev) =>
                              prev ? { ...prev, value: event.target.value } : prev,
                            )
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitDraftText();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setTextDraft(null);
                            }
                          }}
                          onBlur={commitDraftText}
                          onClick={(event) => event.stopPropagation()}
                        />
                      )}
                      <canvas
                        ref={canvasRef}
                        className="absolute inset-0"
                        style={{
                          pointerEvents: tool === "pan" ? "none" : "auto",
                          cursor: tool === "text" ? "text" : tool === "draw" ? "crosshair" : "default",
                        }}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                      />
                    </div>
                  ) : (
                    numPages > 0 &&
                    Array.from({ length: numPages }, (_, index) => (
                      <Page
                        key={`page:${docKey}:${index + 1}`}
                        pageNumber={index + 1}
                        scale={scale}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        className="my-3"
                      />
                    ))
                  )}
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



