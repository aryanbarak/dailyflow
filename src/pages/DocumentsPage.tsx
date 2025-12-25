import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload, FileText, Download, Trash2, Loader2, Eye } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDocuments } from "@/features/documents/useDocuments";
import { Document } from "@/features/documents/documentsService";
import {
  DocumentPreviewDialog,
  DocumentPreviewItem,
} from "@/components/documents/DocumentPreviewDialog";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function formatBytes(value: number | null) {
  if (!value && value !== 0) return "Unknown";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
}

function isPdf(mimeType: string | null, fileName: string) {
  if (mimeType?.includes("pdf")) return true;
  return fileName.toLowerCase().endsWith(".pdf");
}

export default function DocumentsPage() {
  const {
    documents,
    isLoading,
    isUploading,
    isDeleting,
    error,
    createFromUpload,
    updateMeta,
    remove,
    download,
  } = useDocuments();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [editTarget, setEditTarget] = useState<Document | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<DocumentPreviewItem | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const docParam = searchParams.get("doc");

  const sortedDocs = useMemo(() => {
    return documents
      .filter((doc) => isPdf(doc.mimeType, doc.fileName))
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [documents]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const isPdfFile = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdfFile) {
      setFormError("Only PDF files are supported.");
      setSelectedFile(null);
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFormError("File size must be 20MB or less.");
      setSelectedFile(null);
      event.target.value = "";
      return;
    }
    setFormError(null);
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setFormError("Please choose a file to upload.");
      return;
    }
    setFormError(null);
    await createFromUpload(selectedFile, {
      title: titleInput || null,
      description: descriptionInput || null,
    });
    setSelectedFile(null);
    setTitleInput("");
    setDescriptionInput("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await remove(deleteTarget);
    setDeleteTarget(null);
  };

  const handleView = (doc: Document) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("doc", doc.id);
    setSearchParams(nextParams);
    setSelectedDoc({
      id: doc.id,
      name: doc.title ?? doc.fileName,
      path: doc.storagePath,
      contentType: doc.mimeType,
      createdAt: doc.createdAt,
      size: doc.sizeBytes,
    });
    setIsViewerOpen(true);
  };

  const handleStartEdit = (doc: Document) => {
    setEditTarget(doc);
    setEditTitle(doc.title ?? doc.fileName);
    setEditDescription(doc.description ?? "");
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    await updateMeta(editTarget.id, {
      title: editTitle.trim() || null,
      description: editDescription.trim() || null,
    });
    setEditTarget(null);
  };

  useEffect(() => {
    if (!docParam) return;
    if (isLoading) return;

    const match = documents.find((doc) => doc.id === docParam);
    if (!match || !isPdf(match.mimeType, match.fileName)) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("doc");
      nextParams.delete("mode");
      setSearchParams(nextParams, { replace: true });
      return;
    }

    if (!selectedDoc || selectedDoc.id !== match.id) {
      setSelectedDoc({
        id: match.id,
        name: match.title ?? match.fileName,
        path: match.storagePath,
        contentType: match.mimeType,
        createdAt: match.createdAt,
        size: match.sizeBytes,
      });
    }
    if (!isViewerOpen) setIsViewerOpen(true);
  }, [docParam, documents, isLoading, isViewerOpen, searchParams, selectedDoc, setSearchParams]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Documents</h1>
          <p className="text-muted-foreground">Upload and manage your PDFs</p>
        </div>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              Upload Document
            </CardTitle>
            <CardDescription>PDFs up to 20MB</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <Input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              disabled={isUploading}
            />
            <Input
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              placeholder="Title (optional)"
              disabled={isUploading}
            />
            <Textarea
              value={descriptionInput}
              onChange={(event) => setDescriptionInput(event.target.value)}
              placeholder="Description (optional)"
              rows={3}
              disabled={isUploading}
            />
            <Button onClick={handleUpload} disabled={isUploading || !selectedFile} className="w-full">
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                "Upload document"
              )}
            </Button>
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                Selected: {selectedFile.name} - {formatBytes(selectedFile.size)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Your Files</CardTitle>
            <CardDescription>{sortedDocs.length} document(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading documents...
              </div>
            ) : sortedDocs.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                No documents yet. Upload your first file.
              </div>
            ) : (
              sortedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className={cn(
                    "flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3",
                    "bg-secondary/40",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{doc.title ?? doc.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.mimeType || "FILE"} - {formatBytes(doc.sizeBytes)} - {formatDate(doc.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => handleView(doc)}>
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleStartEdit(doc)}>
                      Rename
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => download(doc)}>
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isDeleting}
                      onClick={() => setDeleteTarget(doc)}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{deleteTarget?.title ?? deleteTarget?.fileName}" from your storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DocumentPreviewDialog
        document={selectedDoc}
        open={isViewerOpen}
        onOpenChange={(open) => {
          setIsViewerOpen(open);
          if (!open) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.delete("doc");
            nextParams.delete("mode");
            setSearchParams(nextParams, { replace: true });
            setSelectedDoc(null);
          }
        }}
      />

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdit}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
