import type { TutorExamQuestion } from "@/lib/tutor/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface ExamQuestionListProps {
  questions: TutorExamQuestion[];
  expandedId: string | null;
  onToggleAnswer: (questionId: string) => void;
}

function getQuestionText(question: TutorExamQuestion): string {
  return question.question || question.prompt || "Untitled question";
}

function getAnswerText(question: TutorExamQuestion): string {
  return question.answer_long || question.answer || question.answer_short || "No answer available.";
}

function getExplainText(question: TutorExamQuestion): string {
  return question.explain || "";
}

function getExplainFaText(question: TutorExamQuestion): string {
  return question.explain_fa || "";
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

function renderParagraph(block: string, key: string) {
  if (/^pseudocode/i.test(block)) {
    return (
      <h4 key={key} className="text-base font-semibold">
        {block}
      </h4>
    );
  }
  return (
    <p key={key} className="whitespace-pre-wrap text-base leading-relaxed">
      {block}
    </p>
  );
}

function renderStructuredText(text: string) {
  const blocks = sanitizeText(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return [
      <p key="empty" className="whitespace-pre-wrap text-base leading-relaxed">
        -
      </p>,
    ];
  }

  const rendered: JSX.Element[] = [];
  let codeParts: string[] = [];
  let codeIndex = 0;

  const flushCode = () => {
    if (codeParts.length === 0) return;
    rendered.push(
      <pre
        key={`code-${codeIndex}`}
        className="rounded-md border border-emerald-400/30 bg-black/[0.04] p-4 text-sm leading-7 font-mono whitespace-pre-wrap break-words overflow-x-hidden dark:bg-black/20"
      >
        {codeParts.join("\n\n")}
      </pre>,
    );
    codeParts = [];
    codeIndex += 1;
  };

  blocks.forEach((block, index) => {
    if (isCodeLikeBlock(block)) {
      codeParts.push(block);
      return;
    }
    flushCode();
    rendered.push(renderParagraph(block, `txt-${index}`));
  });
  flushCode();

  return rendered;
}

function getTags(question: TutorExamQuestion): string[] {
  const raw = question.tags;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return [];
}

export function ExamQuestionList({ questions, expandedId, onToggleAnswer }: ExamQuestionListProps) {
  return (
    <div className="space-y-4">
      {questions.map((question) => {
        const isOpen = question.id === expandedId;
        const explain = getExplainText(question);
        const explainFa = getExplainFaText(question);
        const tags = getTags(question);

        return (
          <Card key={question.id} className={cn("transition-colors", isOpen && "border-primary")}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {question.category && <Badge variant="secondary">{question.category}</Badge>}
                  {question.difficulty && <Badge variant="outline">{question.difficulty}</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">{question.id}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xl leading-snug">{getQuestionText(question)}</p>

              <Button
                type="button"
                variant="outline"
                className="w-full border-primary/25 text-primary hover:border-primary/40"
                onClick={() => onToggleAnswer(question.id)}
              >
                {isOpen ? "Hide answer" : "Show answer"}
              </Button>

              {isOpen && (
                <div className="space-y-3">
                  <section className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 dark:bg-emerald-950/30">
                    <div className="space-y-3">{renderStructuredText(getAnswerText(question))}</div>
                  </section>

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {explain && (
                    <section className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.07] p-4 dark:bg-emerald-950/20">
                      <h3 className="text-sm font-semibold mb-2">Explain</h3>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{sanitizeText(explain)}</p>
                    </section>
                  )}

                  {explainFa && (
                    <section className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 dark:bg-amber-950/20">
                      <h3 className="text-sm font-semibold mb-2 text-right">Explain (FA)</h3>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-right" dir="rtl">
                        {sanitizeText(explainFa)}
                      </p>
                    </section>
                  )}

                  {!explain && !explainFa && <Separator />}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
