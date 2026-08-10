import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  FileText,
  Download,
  Trash2,
  Loader2,
  Eye,
  FolderOpen,
  Merge,
  Scissors,
  Minimize2,
  Scan,
  ImagePlus,
  PenLine,
  Volume2,
  Bot,
  Wrench,
  Search,
  HardDrive,
  Sparkles,
  ClipboardList,
  Music,
  Image as ImageIcon,
  File,
  Plus,
  Clock,
  Tag,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { updateLastOpened } from "@/features/documents/documentsService";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatePanel } from "@/components/common/StatePanel";
import { SkeletonListItem } from "@/components/common/Skeletons";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDocuments } from "@/features/documents/useDocuments";
import type { Document } from "@/features/documents/documentsService";
import { updateAiSummary, updateExtractedTasksCount, updateTags, updateDocumentType, downloadDocument } from "@/features/documents/documentsService";
import { documentAiService, type SummaryResult } from "@/features/documents/documentAiService";
import { triggerDocumentMemoryChunking } from "@/features/documents/documentMemoryExtractionTriggerClient";
import { triggerPersonalMemoryExtraction } from "@/features/personal-memory/personalMemoryExtractionTriggerClient";
import { documentMemoryExtractionErrorMessage } from "@/features/documents/documentMemoryExtractionPresentation";
import { getDocumentSignedUrl } from "@/features/documents/getDocumentUrl";
import { useTasks } from "@/hooks/useTasks";
import { PdfMerge } from "@/features/documents/components/PdfMerge";
import { PdfSplitTool } from "@/features/documents/components/PdfSplitTool";
import { PdfCompressTool } from "@/features/documents/components/PdfCompressTool";
import { PdfOcrTool } from "@/features/documents/components/PdfOcrTool";
import { ImageToPdfTool } from "@/features/documents/components/ImageToPdfTool";
import { TextEditorTool, type TextEditorHandle } from "@/features/documents/components/TextEditorTool";
import { TtsTool } from "@/features/documents/components/TtsTool";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function formatBytes(value: number | null) {
  if (!value && value !== 0) return "Unknown";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
}

function isPdf(mimeType: string | null, fileName: string) {
  return mimeType?.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");
}

function isHtml(mimeType: string | null, fileName: string) {
  return mimeType === 'text/html' || mimeType?.includes('html') || fileName.toLowerCase().endsWith('.html');
}

function isAudio(mime: string | null) { return !!mime?.startsWith('audio/'); }
function isImage(mime: string | null) { return !!mime?.startsWith('image/'); }
function isDoc(mime: string | null, fn: string) {
  return !!mime?.includes('word') || !!mime?.includes('opendocument') || fn.toLowerCase().endsWith('.docx') || fn.toLowerCase().endsWith('.doc');
}

type FileCategory = 'pdf' | 'image' | 'audio' | 'doc' | 'other';
function fileCategory(mime: string | null, fn: string): FileCategory {
  if (isPdf(mime, fn)) return 'pdf';
  if (isImage(mime)) return 'image';
  if (isAudio(mime)) return 'audio';
  if (isDoc(mime, fn) || isHtml(mime, fn)) return 'doc';
  return 'other';
}

const FILE_TYPE_ICON_COLORS: Record<FileCategory, string> = {
  pdf: 'bg-rose-500/15 text-rose-400',
  image: 'bg-amber-500/15 text-amber-400',
  audio: 'bg-violet-500/15 text-violet-400',
  doc: 'bg-blue-500/15 text-blue-400',
  other: 'bg-slate-500/15 text-slate-400',
};

const STORAGE_PIE_COLORS = ['#f43f5e', '#f59e0b', '#3b82f6', '#8b5cf6', '#64748b'];

function formatStorageSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function mimeLabel(mime: string | null, fn: string): string {
  if (!mime) return 'FILE';
  if (mime.includes('pdf')) return 'PDF';
  if (mime === 'text/plain') return 'TXT';
  if (mime.includes('html')) return 'HTML';
  if (mime.includes('json')) return 'JSON';
  if (mime.includes('word') || fn.endsWith('.docx')) return 'DOCX';
  if (mime.startsWith('image/')) return mime.split('/')[1]?.toUpperCase() ?? 'IMG';
  if (mime.startsWith('audio/')) return mime.split('/')[1]?.toUpperCase() ?? 'AUDIO';
  return 'FILE';
}

function isTextMime(mime: string | null): boolean {
  if (!mime) return false;
  return mime.startsWith('text/') || mime.includes('html') || mime.includes('json') || mime.includes('xml');
}

function FileTypeIcon({ cat }: { readonly cat: FileCategory }) {
  const cls = FILE_TYPE_ICON_COLORS[cat];
  const Icon = cat === 'pdf' ? FileText : cat === 'image' ? ImageIcon : cat === 'audio' ? Music : cat === 'doc' ? FileText : File;
  return (
    <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', cls)}>
      <Icon className="w-4 h-4" />
    </div>
  );
}

function ToolCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="glass-card card-accent">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          {icon} {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function DocumentsPage() {
  const { t } = useT();
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
    refresh,
  } = useDocuments();

  // Library tab state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("library");
  const editorRef = useRef<TextEditorHandle>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [editTarget, setEditTarget] = useState<Document | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Library search/filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | FileCategory>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // AI Workspace state
  const [aiSelectedDocId, setAiSelectedDocId] = useState<string | null>(null);
  const aiSelectedDoc = useMemo(
    () => (documents as Document[]).find(d => d.id === aiSelectedDocId) ?? null,
    [documents, aiSelectedDocId],
  );

  // AI preview state
  const [aiPreviewText, setAiPreviewText] = useState<string | null>(null);
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
  const [aiPreviewExpanded, setAiPreviewExpanded] = useState(false);

  // AI action states
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiSummaryResult, setAiSummaryResult] = useState<{ summary: string; points: string[] } | null>(null);
  const [aiTranslation, setAiTranslation] = useState<string | null>(null);
  const [aiTranslateLang, setAiTranslateLang] = useState<'de' | 'en' | 'fa'>('de');
  const [aiTasks, setAiTasks] = useState<Array<{ title: string; due_date_hint?: string; priority?: string; checked: boolean }>>([]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiQaPairs, setAiQaPairs] = useState<Array<{ q: string; a: string }>>([]);
  const [aiAutoTags, setAiAutoTags] = useState<string[] | null>(null);
  const { addTask } = useTasks();

  const sortedDocs = useMemo(
    () =>
      (documents as Document[])
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bTime - aTime;
        }),
    [documents],
  );
  const isInitialLoading = isLoading && sortedDocs.length === 0;

  // KPI stats
  const kpiStats = useMemo(() => {
    const all = sortedDocs;
    const pdfCount = all.filter(d => isPdf(d.mimeType, d.fileName)).length;
    const noteCount = all.filter(d => {
      const m = d.mimeType;
      return m === 'text/plain' || m === 'text/html' || m?.includes('html') || (d.title ?? d.fileName).toLowerCase().includes('note');
    }).length;
    const audioCount = all.filter(d => isAudio(d.mimeType)).length;
    const aiCount = all.filter(d => !!d.aiSummary).length;
    const totalBytes = all.reduce((s, d) => s + (d.sizeBytes ?? 0), 0);
    return { total: all.length, pdfCount, noteCount, audioCount, aiCount, totalBytes };
  }, [sortedDocs]);

  // Storage breakdown for donut chart
  const storageBreakdown = useMemo(() => {
    const cats: Record<FileCategory, number> = { pdf: 0, image: 0, doc: 0, audio: 0, other: 0 };
    for (const d of sortedDocs) {
      cats[fileCategory(d.mimeType, d.fileName)] += d.sizeBytes ?? 0;
    }
    return (['pdf', 'image', 'doc', 'audio', 'other'] as FileCategory[])
      .map((cat, i) => ({ name: cat.toUpperCase(), value: cats[cat], color: STORAGE_PIE_COLORS[i] }))
      .filter(s => s.value > 0);
  }, [sortedDocs]);

  // All unique tags with counts
  const allTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of sortedDocs) {
      for (const tag of d.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [sortedDocs]);

  // Recent documents (by lastOpenedAt or createdAt)
  const recentDocs = useMemo(() =>
    [...sortedDocs]
      .sort((a, b) => {
        const aT = new Date(a.lastOpenedAt ?? a.createdAt).getTime();
        const bT = new Date(b.lastOpenedAt ?? b.createdAt).getTime();
        return bT - aT;
      })
      .slice(0, 8)
  , [sortedDocs]);

  // Filtered + sorted docs for the main list
  const filteredDocs = useMemo(() => {
    let result = sortedDocs;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(d =>
        (d.title ?? d.fileName).toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q) ||
        d.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }
    if (typeFilter !== 'all') {
      result = result.filter(d => fileCategory(d.mimeType, d.fileName) === typeFilter);
    }
    if (tagFilter) {
      result = result.filter(d => d.tags.includes(tagFilter));
    }
    if (sortBy === 'name') {
      result = [...result].sort((a, b) => (a.title ?? a.fileName).localeCompare(b.title ?? b.fileName));
    } else if (sortBy === 'size') {
      result = [...result].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
    }
    return result;
  }, [sortedDocs, searchQuery, typeFilter, sortBy, tagFilter]);

  // Recent activity for sidebar
  const recentActivity = useMemo(() =>
    [...sortedDocs]
      .sort((a, b) => new Date(b.lastOpenedAt ?? b.createdAt).getTime() - new Date(a.lastOpenedAt ?? a.createdAt).getTime())
      .slice(0, 5)
  , [sortedDocs]);

  // Helper: get doc content as text (for text files) or blob (for PDFs)
  const getDocBlob = async (doc: Document): Promise<Blob> => {
    return downloadDocument(doc.storagePath);
  };

  const getDocText = async (doc: Document): Promise<string> => {
    const blob = await getDocBlob(doc);
    return blob.text();
  };

  const isDocPdf = (doc: Document) => isPdf(doc.mimeType, doc.fileName);
  const isDocText = (doc: Document) => isTextMime(doc.mimeType);

  // Helper: call AI with text or PDF depending on doc type
  const callAiForDoc = async (doc: Document, prompt: string, language?: string): Promise<string> => {
    if (isDocPdf(doc)) {
      const blob = await getDocBlob(doc);
      return documentAiService.callWithPdf(blob, doc.fileName, prompt, language);
    }
    if (isDocText(doc)) {
      const text = await getDocText(doc);
      return documentAiService.callWithText(text, prompt, language);
    }
    throw new Error('Unsupported file type for AI analysis');
  };

  // Reset AI state when doc changes + fetch preview
  const handleAiDocChange = (docId: string | null) => {
    setAiSelectedDocId(docId);
    setAiSummaryResult(null);
    setAiTranslation(null);
    setAiTasks([]);
    setAiQaPairs([]);
    setAiAutoTags(null);
    setAiPreviewText(null);
    setAiPreviewExpanded(false);

    if (!docId) return;
    const doc = (documents as Document[]).find(d => d.id === docId);
    if (!doc) return;
    if (isTextMime(doc.mimeType)) {
      setAiPreviewLoading(true);
      getDocumentSignedUrl(doc.storagePath)
        .then(({ url }) => fetch(url))
        .then(res => res.text())
        .then(text => setAiPreviewText(text))
        .catch(() => setAiPreviewText(null))
        .finally(() => setAiPreviewLoading(false));
    }
  };

  // AI Action: Generate Summary
  const handleAiSummarize = async () => {
    if (!aiSelectedDoc) return;
    setAiLoading('summary');
    try {
      let result: SummaryResult;
      if (isDocPdf(aiSelectedDoc)) {
        const blob = await getDocBlob(aiSelectedDoc);
        result = await documentAiService.generateSummaryFromPdf(blob, aiSelectedDoc.fileName, 'en');
      } else if (isDocText(aiSelectedDoc)) {
        const text = await getDocText(aiSelectedDoc);
        result = await documentAiService.generateSummaryFromText(text, 'en');
      } else {
        toast.error(t('docs_ai_unsupported'));
        return;
      }
      setAiSummaryResult({ summary: result.summary, points: result.keyPoints });
      await updateAiSummary(aiSelectedDoc.id, result.summary, result.keyPoints);
      toast.success(t('docs_ai_summary_done'));
    } catch (err) {
      console.error('[AI Summary]', err);
      toast.error(err instanceof Error ? err.message : t('docs_ai_error'));
    }
    finally { setAiLoading(null); }
  };

  // AI Action: Extract Tasks
  const handleAiExtractTasks = async () => {
    if (!aiSelectedDoc) return;
    setAiLoading('tasks');
    try {
      const prompt = 'Extract all action items and tasks from this document.\n\nRespond in this exact JSON format:\n{"tasks":[{"title":"...","due_date_hint":"...","priority":"normal"}]}\nReturn ONLY the JSON.';
      const raw = await callAiForDoc(aiSelectedDoc, prompt);
      try {
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean) as { tasks?: Array<{ title: string; due_date_hint?: string; priority?: string }> };
        setAiTasks((parsed.tasks ?? []).map(t2 => ({ ...t2, checked: true })));
      } catch {
        setAiTasks(raw.split('\n').filter(Boolean).map(p => ({ title: p.replace(/^[-•*]\s*/, ''), checked: true })));
      }
      toast.success(t('docs_ai_tasks_done'));
    } catch (err) { console.error('[AI action]', err); toast.error(err instanceof Error ? err.message : t('docs_ai_error')); }
    finally { setAiLoading(null); }
  };

  const handleAiAddTasks = async () => {
    if (!aiSelectedDoc) return;
    const toAdd = aiTasks.filter(t2 => t2.checked);
    for (const task of toAdd) {
      await addTask({ title: task.title, dueDate: task.due_date_hint ?? null });
    }
    await updateExtractedTasksCount(aiSelectedDoc.id, toAdd.length);
    toast.success(t('docs_ai_tasks_added', { count: String(toAdd.length) }));
    setAiTasks([]);
  };

  // AI Action: Translate
  const handleAiTranslate = async () => {
    if (!aiSelectedDoc) return;
    setAiLoading('translate');
    try {
      const langLabel = aiTranslateLang === 'de' ? 'German' : aiTranslateLang === 'fa' ? 'Persian/Farsi' : 'English';
      const prompt = `Translate the following document into ${langLabel}. Return ONLY the translated text, no JSON, no explanation.`;
      const result = await callAiForDoc(aiSelectedDoc, prompt, aiTranslateLang);
      setAiTranslation(result);
    } catch (err) { console.error('[AI action]', err); toast.error(err instanceof Error ? err.message : t('docs_ai_error')); }
    finally { setAiLoading(null); }
  };

  // AI Action: Ask Question
  const handleAiAsk = async () => {
    if (!aiSelectedDoc || !aiQuestion.trim()) return;
    const q = aiQuestion.trim();
    setAiQuestion('');
    setAiLoading('ask');
    try {
      const prompt = `Based on this document, answer the following question.\n\nQuestion: ${q}\n\nProvide a clear, concise answer.`;
      const result = await callAiForDoc(aiSelectedDoc, prompt);
      setAiQaPairs(prev => [...prev.slice(-2), { q, a: result }]);
    } catch (err) { console.error('[AI action]', err); toast.error(err instanceof Error ? err.message : t('docs_ai_error')); }
    finally { setAiLoading(null); }
  };

  // AI Action: Auto-Tag
  const handleAiAutoTag = async () => {
    if (!aiSelectedDoc) return;
    setAiLoading('tag');
    try {
      const prompt = `Analyze this document and suggest 1-3 tags from this list: Finance, School, Work, Medical, Legal, Study, Family, Personal, Ideas.\nDocument title: ${aiSelectedDoc.title ?? aiSelectedDoc.fileName}\n\nRespond in this exact JSON: {"tags":["tag1","tag2"]}\nReturn ONLY the JSON.`;
      const raw = await callAiForDoc(aiSelectedDoc, prompt);
      try {
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean) as { tags?: string[] };
        const tags = parsed.tags ?? [];
        setAiAutoTags(tags);
        if (tags.length > 0) {
          const merged = [...new Set([...aiSelectedDoc.tags, ...tags])];
          await updateTags(aiSelectedDoc.id, merged);
          toast.success(t('docs_ai_tags_applied'));
        }
      } catch {
        setAiAutoTags(['Personal']);
      }
    } catch (err) { console.error('[AI action]', err); toast.error(err instanceof Error ? err.message : t('docs_ai_error')); }
    finally { setAiLoading(null); }
  };

  // Task 16 (Document-Sourced Memory slice 1): toggles documents.type
  // between 'resume' and null -- the only recognized type in this slice,
  // gating the "Extract to personal memory" action below.
  const handleToggleResumeType = async () => {
    if (!aiSelectedDoc) return;
    try {
      await updateDocumentType(aiSelectedDoc.id, aiSelectedDoc.type === 'resume' ? null : 'resume');
      await refresh();
    } catch (err) {
      console.error('[Document type]', err);
      toast.error(err instanceof Error ? err.message : t('docs_ai_error'));
    }
  };

  // Task 16: one user-facing action sequencing two Worker calls -- chunk +
  // embed the resume (document-memory-extraction-endpoint.ts), then run
  // fact extraction over those chunks through the EXISTING personal-memory
  // pipeline (personal-memory-extraction-endpoint.ts, parameterized by
  // documentId -- see that file's own B1 comment). Whichever step fails,
  // its own taxonomy code is surfaced -- never a generic label.
  const handleExtractToPersonalMemory = async () => {
    if (!aiSelectedDoc) return;
    setAiLoading('memory-extract');
    try {
      const chunkResult = await triggerDocumentMemoryChunking(aiSelectedDoc.id);
      if (chunkResult.ok === false) {
        toast.error(documentMemoryExtractionErrorMessage(chunkResult.code, chunkResult.message, t));
        return;
      }
      const extractionResult = await triggerPersonalMemoryExtraction({}, aiSelectedDoc.id);
      if (extractionResult.ok === false) {
        toast.error(documentMemoryExtractionErrorMessage(extractionResult.code, extractionResult.message, t));
        return;
      }
      toast.success(t('doc_memory_success', { accepted: String(extractionResult.acceptedCount), dropped: String(extractionResult.droppedCount) }));
    } catch (err) {
      console.error('[Document memory extraction]', err);
      toast.error(err instanceof Error ? err.message : t('docs_ai_error'));
    } finally {
      setAiLoading(null);
    }
  };

  const handleDocClick = async (doc: Document) => {
    void updateLastOpened(doc.id).catch(() => {});
    void handleView(doc);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const isPdfFile = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
    const isHtmlFile = file.type.includes("html") || file.name.toLowerCase().endsWith(".html");
    if (!isPdfFile && !isHtmlFile) {
      setFormError(t('docs_file_type_error'));
      setSelectedFile(null);
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFormError(t('docs_file_size_error'));
      setSelectedFile(null);
      event.target.value = "";
      return;
    }
    setFormError(null);
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setFormError(t('docs_choose_file'));
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
    setIsUploadOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await remove(deleteTarget);
    setDeleteTarget(null);
  };

  const handleView = async (doc: Document) => {
    try {
      const { url } = await getDocumentSignedUrl(doc.storagePath);
      if (isHtml(doc.mimeType, doc.fileName)) {
        const res = await fetch(url);
        const html = await res.text();
        const win = window.open('', '_blank');
        if (!win) return;
        if (html.includes('<html')) {
          win.document.write(html);
        } else {
          win.document.write(`<!DOCTYPE html><html><head>
            <meta charset="utf-8">
            <title>${doc.title ?? 'Document'}</title>
            <style>
              body { font-family: Georgia, serif; max-width: 800px;
                     margin: 40px auto; padding: 20px; color: #1a1a1a;
                     line-height: 1.7; }
              h1 { font-size: 2em; } h2 { font-size: 1.5em; }
            </style>
          </head><body>${html}</body></html>`);
        }
        win.document.close();
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to open document.');
    }
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

  const handleOpenInEditor = async (doc: Document) => {
    try {
      const { url } = await getDocumentSignedUrl(doc.storagePath);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      let bodyContent = html;
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch?.[1]) bodyContent = bodyMatch[1].trim();
      if (!bodyContent || bodyContent.length < 5) bodyContent = '<p>Document appears to be empty.</p>';

      const title = doc.title ?? doc.fileName.replace(/\.html?$/i, '');
      setActiveTab('editor');
      editorRef.current?.loadFromLibrary(bodyContent, title);
    } catch (err) {
      console.error('[handleOpenInEditor] error:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to open file in editor.');
    }
  };

  const handleOpenInAi = (doc: Document) => {
    setAiSelectedDocId(doc.id);
    setActiveTab('ai');
  };

  function DocList() {
    if (error)
      return (
        <StatePanel
          variant="error"
          title={t('docs_unable_to_load')}
          description={error}
        />
      );
    if (isInitialLoading)
      return (
        <div className="space-y-3">
          {["sk-0", "sk-1", "sk-2", "sk-3"].map((id) => (
            <SkeletonListItem key={id} />
          ))}
        </div>
      );
    if (sortedDocs.length === 0)
      return (
        <StatePanel
          variant="empty"
          title={t('docs_no_documents')}
          description={t('docs_upload_first')}
        />
      );
    return (
      <div className="space-y-2">
        {sortedDocs.map((doc) => (
          <div
            key={doc.id}
            className={cn(
              "w-full flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors text-left",
              "bg-secondary/40 border-border/60 hover:bg-secondary/60",
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {doc.title ?? doc.fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(doc.sizeBytes)} · {formatDate(doc.createdAt)}
                </p>
                {doc.tags.length > 0 && (
                  <div className="flex gap-1 mt-0.5">
                    {doc.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{tag}</span>
                    ))}
                    {doc.tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{doc.tags.length - 2}</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {isHtml(doc.mimeType, doc.fileName) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleOpenInEditor(doc)}
                  title={t('docs_edit_in_editor')}
                >
                  <PenLine className="w-3.5 h-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">{t('docs_edit')}</span>
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleView(doc)}
                title={t('docs_view')}
              >
                <Eye className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">{t('docs_view')}</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleOpenInAi(doc)}
                title={t('docs_ai_workspace')}
              >
                <Bot className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">AI</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleStartEdit(doc)}
                title={t('docs_rename')}
              >
                <span className="hidden sm:inline">{t('docs_rename')}</span>
                <span className="inline sm:hidden text-xs">✎</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => download(doc)}
                title={t('docs_download')}
              >
                <Download className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">{t('docs_download')}</span>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(doc)}
                title={t('docs_delete')}
              >
                <Trash2 className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">{t('docs_delete')}</span>
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between py-5"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">{t('docs_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('docs_subtitle')}</p>
        </div>
        <Button className="gap-2" style={{ background: 'var(--gradient-primary)' }} onClick={() => setIsUploadOpen(true)}>
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">{t('docs_upload')}</span>
        </Button>
      </motion.div>

      <Tabs
        value={activeTab}
        className="space-y-6"
        onValueChange={setActiveTab}
      >
        {/* 5-tab navigation */}
        <div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 pb-1">
          <TabsList className="flex w-max gap-0.5 h-auto p-1">
            <TabsTrigger
              value="library"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm"
            >
              <FolderOpen size={13} /> {t('docs_tab_library')}
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm"
            >
              <Bot size={13} /> {t('docs_tab_ai')}
            </TabsTrigger>
            <TabsTrigger
              value="pdf-tools"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm"
            >
              <Wrench size={13} /> {t('docs_tab_pdf_tools')}
            </TabsTrigger>
            <TabsTrigger
              value="audio"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm"
            >
              <Volume2 size={13} /> {t('docs_tab_audio')}
            </TabsTrigger>
            <TabsTrigger
              value="editor"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm"
            >
              <PenLine size={13} /> {t('docs_tab_editor')}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── TAB 1: Library ──────────────────────────────────────── */}
        <TabsContent value="library">
          <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
          {/* Left column */}
          <div className="flex-1 min-w-0 space-y-4">

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-indigo-500/15"><FolderOpen className="w-4 h-4 text-indigo-400" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('docs_kpi_total')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{kpiStats.total}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-rose-500/15"><FileText className="w-4 h-4 text-rose-400" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('docs_kpi_pdf')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{kpiStats.pdfCount}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-blue-500/15"><PenLine className="w-4 h-4 text-blue-400" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('docs_kpi_notes')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{kpiStats.noteCount}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-violet-500/15"><Music className="w-4 h-4 text-violet-400" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('docs_kpi_audio')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{kpiStats.audioCount}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-emerald-500/15"><Sparkles className="w-4 h-4 text-emerald-400" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('docs_kpi_ai')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{kpiStats.aiCount}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-cyan-500/15"><HardDrive className="w-4 h-4 text-cyan-400" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('docs_kpi_storage')}</span>
                </div>
                <p className="text-lg font-bold tracking-tight">{formatStorageSize(kpiStats.totalBytes)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Search + filter */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('docs_search')}
                className="pl-10"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'pdf', 'image', 'doc', 'audio', 'other'] as const).map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => { setTypeFilter(cat); setTagFilter(null); }}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                    typeFilter === cat ? 'bg-primary text-primary-foreground' : 'bg-secondary/40 hover:bg-secondary/60 text-muted-foreground'
                  )}
                >
                  {t(`docs_filter_${cat}` as 'docs_filter_all')}
                </button>
              ))}
              <div className="ml-auto">
                <select
                  title={t('docs_sort')}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'date' | 'name' | 'size')}
                >
                  <option value="date">{t('docs_sort_date')}</option>
                  <option value="name">{t('docs_sort_name')}</option>
                  <option value="size">{t('docs_sort_size')}</option>
                </select>
              </div>
            </div>
            {tagFilter && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('docs_filtered_by_tag')}:</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{tagFilter}</span>
                <button type="button" onClick={() => setTagFilter(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
              </div>
            )}
          </div>

          {/* Recent Documents */}
          {!searchQuery && typeFilter === 'all' && !tagFilter && recentDocs.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-primary" /> {t('docs_recent')}</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {recentDocs.map(doc => {
                  const cat = fileCategory(doc.mimeType, doc.fileName);
                  return (
                    <motion.button
                      key={doc.id}
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      onClick={() => void handleDocClick(doc)}
                      className="glass-card card-accent rounded-xl p-3 text-left space-y-2 transition-colors hover:bg-secondary/40"
                    >
                      <div className="flex items-center gap-2">
                        <FileTypeIcon cat={cat} />
                        <p className="text-xs font-medium truncate flex-1">{doc.title ?? doc.fileName}</p>
                      </div>
                      {doc.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {doc.tags.slice(0, 2).map(tg => (
                            <span key={tg} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{tg}</span>
                          ))}
                          {doc.tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{doc.tags.length - 2}</span>}
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {doc.aiSummary && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400">✨ {t('docs_ai_summary')}</span>}
                        {doc.extractedTasksCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">📋 {doc.extractedTasksCount}</span>}
                      </div>
                      <p className="text-[10px] text-muted-foreground">{timeAgo(doc.lastOpenedAt ?? doc.createdAt)}</p>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          )}

          {/* All Documents */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{t('docs_all_documents')} ({filteredDocs.length})</h3>
            {error ? (
              <StatePanel variant="error" title={t('docs_unable_to_load')} description={error} />
            ) : isInitialLoading ? (
              <div className="space-y-3">{['sk-0','sk-1','sk-2','sk-3'].map(id => <SkeletonListItem key={id} />)}</div>
            ) : filteredDocs.length === 0 ? (
              <StatePanel variant="empty" title={t('docs_no_documents')} description={sortedDocs.length > 0 ? t('docs_no_results') : t('docs_upload_first')} />
            ) : (
              <div className="space-y-2">
                {filteredDocs.map(doc => {
                  const cat = fileCategory(doc.mimeType, doc.fileName);
                  return (
                    <div
                      key={doc.id}
                      className="w-full flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors text-left bg-secondary/40 border-border/60 hover:bg-secondary/60"
                    >
                      <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => void handleDocClick(doc)}>
                        <FileTypeIcon cat={cat} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{doc.title ?? doc.fileName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(doc.sizeBytes)} · {timeAgo(doc.lastOpenedAt ?? doc.createdAt)}
                          </p>
                          {doc.tags.length > 0 && (
                            <div className="flex gap-1 mt-0.5">
                              {doc.tags.slice(0, 2).map(tg => (
                                <span key={tg} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{tg}</span>
                              ))}
                              {doc.tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{doc.tags.length - 2}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isHtml(doc.mimeType, doc.fileName) && (
                          <Button variant="secondary" size="sm" onClick={() => void handleOpenInEditor(doc)} title={t('docs_edit_in_editor')}>
                            <PenLine className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => handleOpenInAi(doc)} title={t('docs_ai_workspace')}>
                          <Bot className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => download(doc)} title={t('docs_download')}>
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="destructive" size="sm" disabled={isDeleting} onClick={() => setDeleteTarget(doc)} title={t('docs_delete')}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          </div>

          {/* Right sidebar */}
          <div className="w-full lg:w-[280px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">

            {/* Storage Overview */}
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2"><HardDrive className="w-3.5 h-3.5 text-primary" /> {t('docs_storage_overview')}</h3>
                {storageBreakdown.length > 0 ? (
                  <>
                    <div className="h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={storageBreakdown} cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={2} dataKey="value">
                            {storageBreakdown.map((entry, i) => <Cell key={entry.name} fill={entry.color} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1">
                      {storageBreakdown.map(s => (
                        <div key={s.name} className="flex items-center justify-between text-[10px]">
                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />{s.name}</span>
                          <span className="text-muted-foreground">{formatStorageSize(s.value)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">{t('docs_no_documents')}</p>
                )}
                <p className="text-[10px] text-muted-foreground text-center">
                  {formatStorageSize(kpiStats.totalBytes)} / 1 GB
                </p>
              </CardContent>
            </Card>

            {/* Smart Tags */}
            {allTags.length > 0 && (
              <Card className="glass-card card-accent">
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2"><Tag className="w-3.5 h-3.5 text-primary" /> {t('docs_smart_tags')}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map(([tag, count]) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => { setTagFilter(tag === tagFilter ? null : tag); setTypeFilter('all'); }}
                        className={cn(
                          'text-[10px] px-2 py-1 rounded-full transition-colors',
                          tagFilter === tag ? 'bg-primary text-primary-foreground' : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/60'
                        )}
                      >
                        {tag} ({count})
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent Activity */}
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-primary" /> {t('docs_recent_activity')}</h3>
                {recentActivity.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('docs_no_activity')}</p>
                ) : (
                  <ul className="space-y-2">
                    {recentActivity.map(doc => (
                      <li key={doc.id} className="flex items-center gap-2">
                        <FileTypeIcon cat={fileCategory(doc.mimeType, doc.fileName)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">{doc.title ?? doc.fileName}</p>
                          <p className="text-[10px] text-muted-foreground">{timeAgo(doc.lastOpenedAt ?? doc.createdAt)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-2">
                <h3 className="text-sm font-semibold mb-1">{t('docs_quick_actions')}</h3>
                <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => setIsUploadOpen(true)}>
                  <Plus className="w-3.5 h-3.5 text-primary" /> {t('docs_quick_upload')}
                </Button>
                <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => setActiveTab('editor')}>
                  <PenLine className="w-3.5 h-3.5 text-blue-400" /> {t('docs_quick_note')}
                </Button>
                <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => setActiveTab('pdf-tools')}>
                  <Scan className="w-3.5 h-3.5 text-amber-400" /> {t('docs_quick_scan')}
                </Button>
              </CardContent>
            </Card>
          </div>
          </div>
        </TabsContent>

        {/* ── TAB 2: AI Workspace ─────────────────────────────────── */}
        <TabsContent value="ai">
          {sortedDocs.length === 0 ? (
            <Card className="glass-card card-accent">
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">{t('docs_ai_no_docs')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
              {/* Left: Document Selector + Info + Preview + Results */}
              <div className="flex-1 min-w-0 space-y-4">
                {/* Document selector */}
                <Card className="glass-card card-accent">
                  <CardContent className="p-4 space-y-3">
                    <h3 className="text-sm font-semibold">{t('docs_select_document')}</h3>
                    <select
                      title={t('docs_select_document')}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      value={aiSelectedDocId ?? ''}
                      onChange={e => handleAiDocChange(e.target.value || null)}
                    >
                      <option value="">{t('docs_select_placeholder')}</option>
                      {sortedDocs.map(doc => (
                        <option key={doc.id} value={doc.id}>{doc.title ?? doc.fileName}</option>
                      ))}
                    </select>
                  </CardContent>
                </Card>

                {/* Document info card */}
                {aiSelectedDoc && (
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-4">
                        <FileTypeIcon cat={fileCategory(aiSelectedDoc.mimeType, aiSelectedDoc.fileName)} />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-base font-semibold truncate">{aiSelectedDoc.title ?? aiSelectedDoc.fileName}</h4>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary font-bold tracking-wider">
                              {mimeLabel(aiSelectedDoc.mimeType, aiSelectedDoc.fileName)}
                            </span>
                            <span className="text-xs text-muted-foreground">{formatBytes(aiSelectedDoc.sizeBytes)}</span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">{formatDate(aiSelectedDoc.createdAt)}</span>
                          </div>
                          {aiSelectedDoc.tags.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-2">
                              {aiSelectedDoc.tags.map(tg => (
                                <span key={tg} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{tg}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Content preview */}
                {aiSelectedDoc && (
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-2">
                      <h4 className="text-sm font-semibold">{t('docs_content_preview')}</h4>
                      {aiPreviewLoading ? (
                        <div className="flex items-center gap-2 py-4">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{t('docs_loading_preview')}</span>
                        </div>
                      ) : aiPreviewText ? (
                        <>
                          <pre className="text-xs leading-relaxed text-muted-foreground bg-secondary/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto" dir="auto">
                            {aiPreviewExpanded ? aiPreviewText : aiPreviewText.slice(0, 800)}
                            {!aiPreviewExpanded && aiPreviewText.length > 800 && '…'}
                          </pre>
                          {aiPreviewText.length > 800 && (
                            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAiPreviewExpanded(!aiPreviewExpanded)}>
                              {aiPreviewExpanded ? t('docs_show_less') : t('docs_show_more')}
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                          <FileTypeIcon cat={fileCategory(aiSelectedDoc.mimeType, aiSelectedDoc.fileName)} />
                          <p className="text-xs text-center">{t('docs_preview_not_available')}</p>
                          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => download(aiSelectedDoc)}>
                            <Download className="w-3 h-3" /> {t('docs_download')}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Existing Summary display */}
                {aiSelectedDoc?.aiSummary && !aiSummaryResult && (
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-primary" /> {t('docs_ai_summary')}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">{aiSelectedDoc.aiSummary}</p>
                      {aiSelectedDoc.aiSummaryPoints.length > 0 && (
                        <ul className="space-y-1 mt-2">
                          {aiSelectedDoc.aiSummaryPoints.map((pt, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="text-primary mt-0.5">•</span>{pt}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Summary result (fresh) */}
                {aiSummaryResult && (
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-emerald-400" /> {t('docs_ai_summary')}</h4>
                      <p className="text-xs leading-relaxed">{aiSummaryResult.summary}</p>
                      {aiSummaryResult.points.length > 0 && (
                        <ul className="space-y-1 mt-2">
                          {aiSummaryResult.points.map((pt, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="text-emerald-400 mt-0.5">•</span>{pt}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Extracted tasks */}
                {aiTasks.length > 0 && (
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2"><ClipboardList className="w-3.5 h-3.5 text-emerald-400" /> {t('docs_ai_extracted_tasks')}</h4>
                      <div className="space-y-1.5">
                        {aiTasks.map((task, i) => (
                          <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={task.checked}
                              onChange={() => setAiTasks(prev => prev.map((t2, j) => j === i ? { ...t2, checked: !t2.checked } : t2))}
                              className="mt-0.5"
                            />
                            <span className={task.checked ? '' : 'text-muted-foreground line-through'}>{task.title}</span>
                            {task.priority === 'high' && <span className="text-[10px] text-rose-400 shrink-0">HIGH</span>}
                          </label>
                        ))}
                      </div>
                      <Button size="sm" variant="outline" className="w-full text-xs gap-1.5" onClick={() => void handleAiAddTasks()}>
                        <Plus className="w-3 h-3" /> {t('docs_ai_add_to_tasks')}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Translation result */}
                {aiTranslation && (
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-2">
                      <h4 className="text-sm font-semibold">{t('docs_ai_translation')}</h4>
                      <div className="max-h-[300px] overflow-y-auto rounded-lg bg-secondary/20 p-3">
                        <p className="text-xs leading-relaxed whitespace-pre-wrap" dir="auto">{aiTranslation}</p>
                      </div>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => { void navigator.clipboard.writeText(aiTranslation); toast.success(t('docs_ai_copied')); }}>
                        {t('docs_ai_copy')}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Q&A pairs */}
                {aiQaPairs.length > 0 && (
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-3">
                      <h4 className="text-sm font-semibold">{t('docs_ai_qa')}</h4>
                      {aiQaPairs.map((pair, i) => (
                        <div key={i} className="space-y-1 rounded-lg bg-secondary/20 p-3">
                          <p className="text-xs font-medium text-primary">Q: {pair.q}</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">{pair.a}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Auto-tag result */}
                {aiAutoTags && (
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-2">
                      <h4 className="text-sm font-semibold">{t('docs_ai_suggested_tags')}</h4>
                      <div className="flex gap-1.5 flex-wrap">
                        {aiAutoTags.map(tg => (
                          <span key={tg} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">{tg}</span>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">{t('docs_ai_tags_saved')}</p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Right: AI Actions panel */}
              <div className="w-full lg:w-[320px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
                <Card className="glass-card card-accent">
                  <CardContent className="p-4 space-y-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Bot className="w-3.5 h-3.5 text-primary" /> {t('docs_ai_actions')}
                    </h3>
                    {!aiSelectedDoc ? (
                      <p className="text-xs text-muted-foreground py-4 text-center">{t('docs_ai_select_first')}</p>
                    ) : (
                      <div className="space-y-2">
                        {/* Generate Summary */}
                        <Button
                          size="sm" variant="outline" className="w-full justify-start gap-2 text-xs"
                          disabled={aiLoading !== null}
                          onClick={() => void handleAiSummarize()}
                        >
                          {aiLoading === 'summary' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
                          {aiSelectedDoc.aiSummary ? t('docs_ai_regenerate_summary') : t('docs_ai_generate_summary')}
                        </Button>

                        {/* Extract Tasks */}
                        <Button
                          size="sm" variant="outline" className="w-full justify-start gap-2 text-xs"
                          disabled={aiLoading !== null}
                          onClick={() => void handleAiExtractTasks()}
                        >
                          {aiLoading === 'tasks' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5 text-emerald-400" />}
                          {t('docs_ai_extract_tasks')}
                        </Button>

                        {/* Translate */}
                        <div className="flex gap-1.5">
                          <Button
                            size="sm" variant="outline" className="flex-1 justify-start gap-2 text-xs"
                            disabled={aiLoading !== null}
                            onClick={() => void handleAiTranslate()}
                          >
                            {aiLoading === 'translate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="text-sm">🌐</span>}
                            {t('docs_ai_translate')}
                          </Button>
                          <select
                            title={t('docs_ai_translate_lang')}
                            className="rounded-lg border border-border bg-background px-2 py-1 text-xs w-[70px]"
                            value={aiTranslateLang}
                            onChange={e => setAiTranslateLang(e.target.value as 'de' | 'en' | 'fa')}
                          >
                            <option value="de">DE</option>
                            <option value="en">EN</option>
                            <option value="fa">FA</option>
                          </select>
                        </div>

                        {/* Auto-Tag */}
                        <Button
                          size="sm" variant="outline" className="w-full justify-start gap-2 text-xs"
                          disabled={aiLoading !== null}
                          onClick={() => void handleAiAutoTag()}
                        >
                          {aiLoading === 'tag' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Tag className="w-3.5 h-3.5 text-amber-400" />}
                          {t('docs_ai_auto_tag')}
                        </Button>

                        {/* Task 16: Document-Sourced Memory slice 1 -- resume marking + extraction */}
                        {isDocPdf(aiSelectedDoc) && (
                          <div className="border-t border-border/40 pt-2 space-y-2">
                            <Button
                              size="sm" variant="outline" className="w-full justify-start gap-2 text-xs"
                              disabled={aiLoading !== null}
                              onClick={() => void handleToggleResumeType()}
                            >
                              <FileText className="w-3.5 h-3.5 text-sky-400" />
                              {aiSelectedDoc.type === 'resume' ? t('doc_memory_unmark_resume') : t('doc_memory_mark_resume')}
                            </Button>
                            {aiSelectedDoc.type === 'resume' && (
                              <Button
                                size="sm" variant="outline" className="w-full justify-start gap-2 text-xs"
                                disabled={aiLoading !== null}
                                onClick={() => void handleExtractToPersonalMemory()}
                              >
                                {aiLoading === 'memory-extract' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5 text-violet-400" />}
                                {aiLoading === 'memory-extract' ? t('doc_memory_extracting') : t('doc_memory_extract_action')}
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Ask AI */}
                        <div className="border-t border-border/40 pt-3 space-y-2">
                          <p className="text-xs font-medium">{t('docs_ai_ask_title')}</p>
                          <div className="flex gap-1.5">
                            <Input
                              value={aiQuestion}
                              onChange={e => setAiQuestion(e.target.value)}
                              placeholder={t('docs_ai_ask_placeholder')}
                              className="text-xs flex-1"
                              onKeyDown={e => { if (e.key === 'Enter') void handleAiAsk(); }}
                              disabled={aiLoading !== null}
                            />
                            <Button
                              size="sm" variant="outline"
                              disabled={aiLoading !== null || !aiQuestion.trim()}
                              onClick={() => void handleAiAsk()}
                            >
                              {aiLoading === 'ask' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '→'}
                            </Button>
                          </div>
                        </div>

                        {/* Convert to Audio shortcut */}
                        {(isPdf(aiSelectedDoc.mimeType, aiSelectedDoc.fileName) || isHtml(aiSelectedDoc.mimeType, aiSelectedDoc.fileName)) && (
                          <Button
                            size="sm" variant="outline" className="w-full justify-start gap-2 text-xs"
                            onClick={() => setActiveTab('audio')}
                          >
                            <Volume2 className="w-3.5 h-3.5 text-violet-400" /> {t('docs_ai_convert_audio')}
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: PDF Tools ────────────────────────────────────── */}
        <TabsContent value="pdf-tools">
          <div className="space-y-6">
            <ToolCard
              title={t('docs_merge_title')}
              description={t('docs_merge_desc')}
              icon={<Merge className="w-4 h-4 text-primary" />}
            >
              <PdfMerge />
            </ToolCard>

            <ToolCard
              title={t('docs_split_title')}
              description={t('docs_split_desc')}
              icon={<Scissors className="w-4 h-4 text-primary" />}
            >
              <PdfSplitTool />
            </ToolCard>

            <ToolCard
              title={t('docs_compress_title')}
              description={t('docs_compress_desc')}
              icon={<Minimize2 className="w-4 h-4 text-primary" />}
            >
              <PdfCompressTool />
            </ToolCard>

            <ToolCard
              title={t('docs_ocr_title')}
              description={t('docs_ocr_desc')}
              icon={<Scan className="w-4 h-4 text-primary" />}
            >
              <PdfOcrTool
                onSave={(file, title) =>
                  createFromUpload(file, { title: title ?? null })
                }
              />
            </ToolCard>

            <ToolCard
              title={t('docs_img_pdf_title')}
              description={t('docs_img_pdf_desc')}
              icon={<ImagePlus className="w-4 h-4 text-primary" />}
            >
              <ImageToPdfTool />
            </ToolCard>
          </div>
        </TabsContent>

        {/* ── TAB 4: Audio ────────────────────────────────────────── */}
        <TabsContent value="audio">
          <ToolCard
            title={t('docs_tts_title')}
            description={t('docs_tts_desc')}
            icon={<Volume2 className="w-4 h-4 text-primary" />}
          >
            <TtsTool />
          </ToolCard>
        </TabsContent>

        {/* ── TAB 5: Text Editor ──────────────────────────────────── */}
        <TabsContent
          value="editor"
          forceMount
          className={activeTab === "editor" ? "" : "hidden"}
        >
          <TextEditorTool
            ref={editorRef}
            onSave={(file, title) =>
              createFromUpload(file, { title: title ?? null })
            }
          />
        </TabsContent>
      </Tabs>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('docs_delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('docs_delete_desc', { name: deleteTarget?.title ?? deleteTarget?.fileName ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('docs_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={isDeleting}>
              {t('docs_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit metadata dialog */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('docs_edit_document')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label htmlFor="edit-doc-title" className="text-sm font-medium">
                {t('docs_title_label')}
              </label>
              <Input
                id="edit-doc-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-doc-desc" className="text-sm font-medium">
                {t('docs_desc_label')}
              </label>
              <Textarea
                id="edit-doc-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>
                {t('docs_cancel')}
              </Button>
              <Button onClick={() => void handleSaveEdit()}>{t('docs_save')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload dialog */}
      <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('docs_upload')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">{t('docs_upload_desc')}</p>
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
            <Input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf,text/html,.html"
              onChange={handleFileChange}
              disabled={isUploading}
            />
            <Input
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder={t('docs_title_placeholder')}
              disabled={isUploading}
            />
            <Textarea
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              placeholder={t('docs_desc_placeholder')}
              rows={3}
              disabled={isUploading}
            />
            <Button
              onClick={() => void handleUpload()}
              disabled={isUploading || !selectedFile}
              className="w-full"
            >
              {isUploading ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t('docs_uploading')}</>
              ) : (
                t('docs_upload_btn')
              )}
            </Button>
            {selectedFile && (
              <p className="text-xs text-muted-foreground">{selectedFile.name} — {formatBytes(selectedFile.size)}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
