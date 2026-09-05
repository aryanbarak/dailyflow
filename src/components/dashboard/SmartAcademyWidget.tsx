import { useNavigate } from "react-router-dom";
import { IconTile } from "@/components/common/IconTile";
import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatePanel } from "@/components/common/StatePanel";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { useLearnAiActivity } from "@/hooks/useLearnAiActivity";

const MODE_LABELS: Record<string, string> = {
  fiae_algorithms: "Algorithms",
  general_it: "General IT",
  wiso: "WISO",
  planner: "Planner",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SmartAcademyWidget() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useLearnAiActivity();

  return (
    <Card className="glass-card card-accent h-full flex flex-col">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
          <IconTile className="w-7 h-7 rounded-md"><GraduationCap className="w-3.5 h-3.5" /></IconTile>
          Smart Academy
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 text-sm flex-1">
        {error ? (
          <StatePanel
            variant="error"
            title="Academy unavailable"
            description={error instanceof Error ? error.message : "Failed to load activity"}
          />
        ) : isLoading ? (
          <div className="space-y-2">
            <SkeletonBlock className="h-7 w-12" />
            <SkeletonBlock className="h-3 w-32" />
          </div>
        ) : data && data.totalQuestions > 0 ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <p className="text-2xl font-bold tracking-tight">
                {data.totalQuestions}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Questions asked
                {data.mostActiveMode && (
                  <> · {MODE_LABELS[data.mostActiveMode.mode] ?? data.mostActiveMode.mode}</>
                )}
              </p>
            </div>
            {data.lastQuestion && (
              <p className="text-[11px] text-muted-foreground truncate min-w-0" dir="auto">
                &ldquo;{data.lastQuestion.content}&rdquo; — {timeAgo(data.lastQuestion.createdAt)}
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2"
              onClick={() => navigate("/learn-ai")}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              Continue Learning
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Start learning with Flow AI
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2"
              onClick={() => navigate("/learn-ai")}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              Continue Learning
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
