import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/common/StatePanel";
import { ExamBankToolbar } from "@/components/tutor/ExamBankToolbar";
import { ExamQuestionList } from "@/components/tutor/ExamQuestionList";
import { useTutorExamBankAp2 } from "@/hooks/useTutorExamBankAp2";
import type { TutorExamQuestion } from "@/lib/tutor/types";

function normalizeText(value: string | undefined): string {
  return (value || "").toLowerCase();
}

function matchesSearch(question: TutorExamQuestion, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const text = [
    question.id,
    question.category,
    question.difficulty,
    question.question,
    question.prompt,
    question.answer,
    question.answer_short,
    question.answer_long,
    question.explain,
    question.explain_fa,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes(q);
}

function pickQuestionText(question: TutorExamQuestion): string {
  return question.question || question.prompt || "";
}

function pickAnswerText(question: TutorExamQuestion): string {
  return question.answer_long || question.answer || question.answer_short || "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");
}

function isCodeLikeBlock(block: string): boolean {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const joined = lines.join("\n");
  return (
    /(^|\n)(FUNKTION|FUNCTION|FUER|FOR|WENN|IF|SONST|ELSE|ENDE|END|GIB|RETURN|AUSGABE|SOLANGE|WHILE)\b/i.test(joined) ||
    /(^|\n)\/\//.test(joined) ||
    lines.filter((line) => /[=<>+\-*/()[\]{}]/.test(line)).length >= 3
  );
}

function renderPrintableRichText(text: string, options?: { detectCode?: boolean; rtl?: boolean }): string {
  const detectCode = options?.detectCode ?? true;
  const rtl = options?.rtl ?? false;
  const blocks = sanitizeText(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (blocks.length === 0) return `<p class="text${rtl ? " rtl" : ""}">-</p>`;

  if (!detectCode) {
    return blocks.map((block) => `<p class="text${rtl ? " rtl" : ""}">${escapeHtml(block)}</p>`).join("");
  }

  const rendered: string[] = [];
  let codeParts: string[] = [];

  const flushCode = () => {
    if (codeParts.length === 0) return;
    rendered.push(`<pre class="code"><code>${escapeHtml(codeParts.join("\n\n"))}</code></pre>`);
    codeParts = [];
  };

  for (const block of blocks) {
    if (isCodeLikeBlock(block)) {
      codeParts.push(block);
      continue;
    }
    flushCode();
    rendered.push(
      /^pseudocode/i.test(block)
        ? `<h4 class="subhead">${escapeHtml(block)}</h4>`
        : `<p class="text${rtl ? " rtl" : ""}">${escapeHtml(block)}</p>`,
    );
  }
  flushCode();

  return rendered.join("");
}

export default function TutorPage() {
  const { data, isLoading, error } = useTutorExamBankAp2();
  const [viewMode, setViewMode] = useState<"browse" | "quiz" | "simulation" | "history">("browse");
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("all");
  const [category, setCategory] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const didLogCount = useRef(false);

  const questions = data?.exam.questions ?? [];

  useEffect(() => {
    if (!didLogCount.current && questions.length > 0) {
      console.log("[TutorPage] AP2 questions_count =", questions.length);
      didLogCount.current = true;
    }
  }, [questions.length]);

  const categories = useMemo(
    () =>
      Array.from(new Set(questions.map((item) => normalizeText(item.category)).filter(Boolean))).sort(),
    [questions],
  );
  const difficulties = useMemo(
    () =>
      Array.from(new Set(questions.map((item) => normalizeText(item.difficulty)).filter(Boolean))).sort(),
    [questions],
  );

  const filtered = useMemo(() => {
    return questions.filter((question) => {
      const diffOk = difficulty === "all" || normalizeText(question.difficulty) === difficulty;
      const catOk = category === "all" || normalizeText(question.category) === category;
      return diffOk && catOk && matchesSearch(question, search);
    });
  }, [questions, difficulty, category, search]);

  const categoryStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const item of questions) {
      const key = normalizeText(item.category);
      if (!key) continue;
      stats.set(key, (stats.get(key) ?? 0) + 1);
    }
    return Array.from(stats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [questions]);

  useEffect(() => {
    if (filtered.length === 0) {
      setExpandedId(null);
      return;
    }
    setExpandedId((prev) => (prev && filtered.some((item) => item.id === prev) ? prev : filtered[0].id));
  }, [filtered]);

  const handleExportPdf = () => {
    const win = window.open("", "_blank");
    if (!win) return;

    const rows = filtered
      .map((question, index) => {
        const questionText = escapeHtml(pickQuestionText(question));
        const answerHtml = renderPrintableRichText(pickAnswerText(question) || "No answer available.", {
          detectCode: true,
        });
        const explainDeRaw = sanitizeText(question.explain || "");
        const explainFaRaw = sanitizeText(question.explain_fa || "");
        const explainDeHtml = renderPrintableRichText(explainDeRaw, { detectCode: true });
        const explainFaHtml = renderPrintableRichText(explainFaRaw, { detectCode: false, rtl: true });
        const categoryText = escapeHtml(question.category || "n/a");
        const difficultyText = escapeHtml(question.difficulty || "n/a");
        const idText = escapeHtml(question.id);

        return `
          <article class="q">
            <div class="meta">
              <span class="chip">${categoryText}</span>
              <span class="chip">${difficultyText}</span>
              <span class="id">${idText}</span>
            </div>
            <h2>Question ${index + 1}</h2>
            <p class="text">${questionText}</p>
            <section class="box">
              <h3>Answer</h3>
              ${answerHtml}
            </section>
            ${
              explainDeRaw
                ? `<section class="box"><h3>Explain (DE)</h3>${explainDeHtml}</section>`
                : ""
            }
            ${
              explainFaRaw
                ? `<section class="box fa" dir="rtl" lang="fa"><h3>Explain (FA)</h3>${explainFaHtml}</section>`
                : ""
            }
          </article>
        `;
      })
      .join("");

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Exam Bank (AP2) Export</title>
        <style>
          body { font-family: Segoe UI, Tahoma, Arial, sans-serif; color: #111827; margin: 24px; }
          h1 { margin: 0 0 8px; font-size: 28px; }
          .sub { color: #374151; margin-bottom: 14px; }
          .meta-row { color: #4b5563; margin-bottom: 20px; }
          .q { border-top: 1px solid #d1d5db; padding: 14px 0 20px; break-inside: avoid; }
          .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
          .chip { border: 1px solid #cbd5e1; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
          .id { margin-left: auto; color: #6b7280; font-size: 12px; }
          h2 { margin: 0 0 8px; font-size: 24px; }
          h3 { margin: 0 0 8px; font-size: 16px; }
          .text { white-space: pre-wrap; line-height: 1.45; margin: 0; font-size: 18px; }
          .text.rtl {
            text-align: right;
            direction: rtl;
            unicode-bidi: plaintext;
            font-family: "Vazirmatn", "Noto Naskh Arabic", "Noto Sans Arabic", Tahoma, "Segoe UI", Arial, sans-serif;
          }
          .subhead { margin: 0 0 8px; font-size: 16px; font-weight: 700; }
          .code {
            margin: 0 0 10px;
            padding: 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            background: #f3f4f6;
            white-space: pre-wrap;
            overflow-x: visible;
            word-break: break-word;
            overflow-wrap: anywhere;
            line-height: 1.4;
            font-size: 15px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .code code { font-family: inherit; }
          .box { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; margin-top: 10px; background: #f9fafb; }
          .fa {
            text-align: right;
            direction: rtl;
            unicode-bidi: plaintext;
            font-family: "Vazirmatn", "Noto Naskh Arabic", "Noto Sans Arabic", Tahoma, "Segoe UI", Arial, sans-serif;
          }
          @media print {
            body { margin: 12mm; }
            .q, .box, .code { page-break-inside: avoid; break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>Exam Bank (AP2) Export</h1>
        <div class="sub">Generated from Dailyflow Tutor Bank</div>
        <div class="meta-row">
          Category filter: ${escapeHtml(category)} |
          Difficulty filter: ${escapeHtml(difficulty)} |
          Questions: ${filtered.length}
        </div>
        ${rows || "<p>No questions match the current filters.</p>"}
        <script>window.onload = () => window.print();</script>
      </body>
      </html>
    `;

    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  return (
    // DESIGN-AUDIT 0.6 (light mode): dark-by-design work surface -- see
    // TutorAppPage.tsx's comment; same treatment across the tutor suite.
    <div className="dark min-h-dvh bg-[var(--flow-bg-deep)] text-foreground">
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-6 space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold font-display tracking-tight">Tutor (AP2)</h1>
            <p className="text-muted-foreground">
              Static source: manifest, index, and exam bank from <code>/tutor</code>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportPdf}
            >
              Export PDF
            </Button>
          </div>
        </div>
        <div className="pt-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/tutor/app">Open Tutor App</Link>
          </Button>
        </div>
      </motion.div>

      {isLoading ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Loading tutor content...</CardContent>
        </Card>
      ) : error ? (
        <StatePanel
          variant="error"
          title="Tutor content unavailable"
          description={error}
        />
      ) : questions.length === 0 ? (
        <StatePanel
          variant="empty"
          title="No questions found"
          description="Exam bank is empty or schema did not pass validation."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={viewMode === "browse" ? "default" : "outline"}
              onClick={() => setViewMode("browse")}
            >
              Browse
            </Button>
            <Button
              size="sm"
              variant={viewMode === "quiz" ? "default" : "outline"}
              onClick={() => setViewMode("quiz")}
            >
              Quiz
            </Button>
            <Button
              size="sm"
              variant={viewMode === "simulation" ? "default" : "outline"}
              onClick={() => setViewMode("simulation")}
            >
              Simulation
            </Button>
            <Button
              size="sm"
              variant={viewMode === "history" ? "default" : "outline"}
              onClick={() => setViewMode("history")}
            >
              History
            </Button>
          </div>

          <ExamBankToolbar
            search={search}
            onSearchChange={setSearch}
            difficulty={difficulty}
            onDifficultyChange={setDifficulty}
            category={category}
            onCategoryChange={setCategory}
            difficulties={difficulties}
            categories={categories}
          />

          <div className="text-sm text-muted-foreground">
            Showing {filtered.length} of {questions.length} question(s)
          </div>

          <div className="flex flex-wrap gap-2">
            {categoryStats.map(([key, count]) => (
              <Badge
                key={key}
                variant={category === key ? "secondary" : "outline"}
                className="text-xs"
              >
                {key}:{count}
              </Badge>
            ))}
          </div>

          {viewMode !== "browse" ? (
            <StatePanel
              variant="empty"
              title={`${viewMode.charAt(0).toUpperCase()}${viewMode.slice(1)} mode`}
              description="This mode is shown in Tutor App. Use Browse here for full AP2 bank reading."
            />
          ) : filtered.length === 0 ? (
            <StatePanel
              variant="empty"
              title="No matching questions"
              description="Try a different search term or reset filters."
            />
          ) : (
            <ExamQuestionList
              questions={filtered}
              expandedId={expandedId}
              onToggleAnswer={(questionId) => {
                setExpandedId((prev) => (prev === questionId ? null : questionId));
              }}
            />
          )}
        </div>
      )}
    </div>
    </div>
  );
}
