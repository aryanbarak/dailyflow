// CORE-W2 (2026-09-06, CORE audit item ۳-۴): Settings editor for the user
// persona document. A plain, user-owned textarea -- the machine never
// writes here (migration header explains why); whatever is saved is what
// the chat assistant receives as ground truth about the user.
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/i18n";
import { PERSONA_MAX_CHARS, personaService } from "./personaService";

interface PersonaServiceLike {
  getPersona(userId: string): Promise<string>;
  savePersona(userId: string, content: string): Promise<void>;
}

interface PersonaCardProps {
  service?: PersonaServiceLike;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function PersonaCard({ service = personaService }: PersonaCardProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { t } = useT();
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setContent(await service.getPersona(userId));
    } catch {
      // A failed read leaves an empty editor; saving later still works.
    } finally {
      setLoaded(true);
    }
  }, [service, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!userId) return;
    setSaveState("saving");
    try {
      await service.savePersona(userId, content);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <Card className="glass-card">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="icon-tile w-10 h-10 rounded-lg flex items-center justify-center shrink-0">
            <UserRound className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">{t("persona_card_title")}</h3>
            <p className="text-sm text-muted-foreground">{t("persona_card_desc")}</p>
          </div>
        </div>

        {!loaded ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("persona_card_title")} />
        ) : (
          <div className="space-y-3">
            <Textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setSaveState("idle");
              }}
              maxLength={PERSONA_MAX_CHARS}
              rows={10}
              placeholder={t("persona_placeholder")}
              aria-label={t("persona_card_title")}
              className="font-mono text-sm leading-relaxed"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleSave} disabled={saveState === "saving"} size="sm" className="gap-1.5">
                {saveState === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("persona_save")}
              </Button>
              {saveState === "saved" && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400" role="status">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("persona_saved")}
                </span>
              )}
              {saveState === "error" && (
                <span className="text-sm text-destructive" role="status">{t("persona_save_error")}</span>
              )}
              <span className="text-xs text-muted-foreground ms-auto" dir="ltr">
                {content.length}/{PERSONA_MAX_CHARS}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
