import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TutorRunLang, TutorRunMode, TutorVariant } from "@/lib/tutor/types";

interface TutorControlPanelProps {
  topics: string[];
  topic: string;
  mode: TutorRunMode;
  lang: TutorRunLang;
  variants: TutorVariant[];
  selectedVariant: string;
  statusText: string;
  topicHint?: string;
  paramsText: string;
  paramsOpen: boolean;
  apiConfigured: boolean;
  isRunning: boolean;
  onTopicChange: (value: string) => void;
  onModeChange: (value: TutorRunMode) => void;
  onLangChange: (value: TutorRunLang) => void;
  onVariantChange: (value: string) => void;
  onParamsTextChange: (value: string) => void;
  onToggleParamsOpen: () => void;
  onRun: () => void;
  onTest: () => void;
  onExportPdf: () => void;
  onRequestPreview: () => void;
  onPresetTrace: () => void;
  onPresetQuiz: () => void;
  onPresetPseudocode: () => void;
  onPresetExplainFa: () => void;
}

const MODES: TutorRunMode[] = ["pseudocode", "trace", "quiz", "exam", "explain"];
const LANGS: TutorRunLang[] = ["de", "fa"];

export function TutorControlPanel(props: TutorControlPanelProps) {
  const {
    topics,
    topic,
    mode,
    lang,
    variants,
    selectedVariant,
    statusText,
    topicHint,
    paramsText,
    paramsOpen,
    apiConfigured,
    isRunning,
    onTopicChange,
    onModeChange,
    onLangChange,
    onVariantChange,
    onParamsTextChange,
    onToggleParamsOpen,
    onRun,
    onTest,
    onExportPdf,
    onRequestPreview,
    onPresetTrace,
    onPresetQuiz,
    onPresetPseudocode,
    onPresetExplainFa,
  } = props;

  const statusTone =
    statusText === "SUCCESS"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : statusText === "FAILED"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-200"
        : statusText === "RUNNING"
          ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-200"
          : "border-border bg-muted/20 text-muted-foreground";

  return (
    <Card className="h-full border-border bg-card dark:border-slate-700/70 dark:bg-[#090d1a]">
      <CardHeader className="pb-3">
        <CardTitle className="text-xl font-semibold">FIAE Tutor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4 px-3 sm:px-6">
        <div className="space-y-2">
          <Label>Topic</Label>
          <Select value={topic} onValueChange={onTopicChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select topic" />
            </SelectTrigger>
            <SelectContent>
              {topics.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Mode</Label>
          <Select value={mode} onValueChange={(value) => onModeChange(value as TutorRunMode)}>
            <SelectTrigger>
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Language</Label>
          <Select value={lang} onValueChange={(value) => onLangChange(value as TutorRunLang)}>
            <SelectTrigger>
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {LANGS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {topicHint && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm leading-6">
            {topicHint}
          </div>
        )}

        {variants.length > 0 && (
          <div className="space-y-2">
            <Label>Variant</Label>
            <Select value={selectedVariant} onValueChange={onVariantChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select variant" />
              </SelectTrigger>
              <SelectContent>
                {variants.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label || item.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Button variant="outline" size="sm" onClick={onToggleParamsOpen}>
            {paramsOpen ? "Hide Params JSON" : "Show Params JSON"}
          </Button>
          {paramsOpen && (
            <Textarea
              value={paramsText}
              onChange={(event) => onParamsTextChange(event.target.value)}
              className="min-h-[180px] font-mono text-xs"
            />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button className="w-full" onClick={onRun} disabled={!apiConfigured || isRunning}>
            Run
          </Button>
          <Button className="w-full" variant="secondary" onClick={onTest} disabled={!apiConfigured || isRunning}>
            Test
          </Button>
          <Button className="w-full" variant="outline" onClick={onExportPdf}>
            Export PDF
          </Button>
          <Button className="w-full" variant="outline" onClick={onRequestPreview}>
            Request
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Demo presets</Label>
          <div className="grid grid-cols-1 gap-2">
            <Button variant="outline" size="sm" onClick={onPresetTrace}>
              Trace Demo
            </Button>
            <Button variant="outline" size="sm" onClick={onPresetQuiz}>
              Quiz Demo
            </Button>
            <Button variant="outline" size="sm" onClick={onPresetPseudocode}>
              Pseudocode Demo
            </Button>
            <Button variant="outline" size="sm" onClick={onPresetExplainFa}>
              Explain Demo (FA)
            </Button>
          </div>
        </div>

        {!apiConfigured && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
            Tutor API not configured. Set <code>VITE_TUTOR_API_URL</code> to enable Run/Test.
          </div>
        )}

        <div className={`rounded-md border px-3 py-2 text-xs font-medium ${statusTone}`}>
          Status: {statusText}
        </div>
      </CardContent>
    </Card>
  );
}
