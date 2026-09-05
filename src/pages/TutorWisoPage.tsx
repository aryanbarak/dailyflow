import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { isTutorApiConfigured, runTutorRequest } from "@/lib/tutor/runner";

type TabId = "wissensbasis" | "trainingsfragen" | "pruefung";

type WisoKnowledgeItem = {
  topic?: string;
  explain_de?: string;
  explain_fa?: string;
  typische_pruefungsfallen?: string[];
};

type WisoQuestion = {
  id?: string;
  frage?: string;
  optionen?: Record<string, string>;
  richtige_antwort?: string;
  erklaerung_de?: string;
  erklaerung_fa?: string;
  fehleranalyse?: string[];
};

type WisoTrainingTopic = {
  topic?: string;
  fragen?: WisoQuestion[];
};

type WisoSimulation = {
  rahmen?: {
    exam_name?: string;
    anzahl_fragen?: number;
    punkte_gesamt?: number;
    zeit_minuten?: number;
  };
  fragen?: WisoQuestion[];
};

type WisoSections = {
  wissensbasis?: WisoKnowledgeItem[];
  trainingsfragen?: WisoTrainingTopic[];
  pruefungssimulation?: WisoSimulation;
};

const FALLBACK_SECTIONS: WisoSections = {
  wissensbasis: [
    {
      topic: "arbeitsrecht",
      explain_de:
        "AR-A Rechtsquellen / Hierarchie / Guenstigkeitsprinzip\nAR-B Arbeitsvertrag / Formfreiheit / Nachweisgesetz\nAR-C Rechte und Pflichten (AN/AG)\nAR-D Probezeit\nAR-E Befristung\nAR-F Arbeitszeitgesetz\nAR-G Urlaub\nAR-H Krankheit\nAR-I Kuendigung\nAR-J Kuendigungsschutz (KSchG)\nAR-K Abmahnung\nAR-L Sonderkuendigungsschutz\nAR-M Betriebsrat Basics\nAR-N Datenschutz im Arbeitsverhaeltnis\n\nPruefungslogik: Rechtsquelle -> Tatbestand -> Rechtsfolge.",
      explain_fa:
        "در AP2-WISO برای Arbeitsrecht باید همیشه از منطق «مبنای قانونی -> تحقق شرایط -> نتیجه حقوقی» استفاده کنید. خطاهای رایج زمانی رخ می‌دهد که مهلت‌ها، فرم قانونی و حوزه شمول قانون بررسی نشود.",
      typische_pruefungsfallen: [
        "Normenhierarchie ohne Guenstigkeitsprinzip anwenden.",
        "Formfreiheit mit fehlender Nachweispflicht verwechseln.",
        "Probezeit und Befristung gleichsetzen.",
        "Kuendigung per E-Mail als wirksam bewerten.",
      ],
    },
  ],
  trainingsfragen: [
    {
      topic: "arbeitsrecht",
      fragen: [
        {
          id: "arbeitsrecht_v1_q012",
          frage: "Fallfrage: Welche Form ist fuer eine ordentliche Kuendigung erforderlich?",
          optionen: {
            A: "Muendlich reicht aus, wenn ein Zeuge dabei ist.",
            B: "E-Mail mit Firmenadresse reicht aus.",
            C: "Schriftform mit eigenhaendiger Unterschrift.",
            D: "WhatsApp mit Scan der Unterschrift.",
          },
          richtige_antwort: "C",
          erklaerung_de: "Eine ordentliche Kuendigung erfordert Schriftform mit eigenhaendiger Unterschrift.",
        },
      ],
    },
  ],
  pruefungssimulation: {
    rahmen: {
      exam_name: "WISO Pruefungssimulation",
      anzahl_fragen: 10,
      punkte_gesamt: 10,
      zeit_minuten: 60,
    },
    fragen: [
      {
        id: "arbeitsrecht_v1_q038",
        frage: "Fallfrage: Im Betrieb gibt es Streit zur Ruhezeit. Welche Option ist in der Regel richtig?",
        optionen: {
          A: "Sie gilt immer ohne weitere Voraussetzungen.",
          B: "Sie gilt nur mit vorheriger Zustimmung des Betriebsrats.",
          C: "Sie ist im Arbeitsrecht grundsaetzlich nie relevant.",
          D: "Zwischen zwei Einsaetzen ist Mindestruhezeit einzuhalten.",
        },
        richtige_antwort: "D",
        erklaerung_de:
          "Zwischen zwei Einsaetzen ist Mindestruhezeit einzuhalten. ist korrekt; die anderen Antworten sind AP2-typische Uebertreibungen oder lassen Voraussetzungen aus.",
        erklaerung_fa:
          "(1) موضوع سوال: Fallfrage درباره Ruhezeit در محیط کار است.\n(2) خواسته سوال: گزینه‌ای را انتخاب کنید که با قواعد حقوق کار AP2 هماهنگ‌تر است.\n(3) منطق پاسخ درست: گزینه درست D است چون الزام Mindestruhezeit بین دو شیفت یک قاعده قانونی پایه است. گزینه‌های دیگر یا مطلق‌گویی دارند یا شرط قانونی را حذف می‌کنند.\n(4) نکات امتحانی/دام‌ها:\n- به واژه‌های مطلق مثل immer/nie حساس باشید.\n- شرط‌های قانونی را حذف نکنید.",
        fehleranalyse: ["Nie/Immer-Fallen vermeiden.", "Voraussetzungen des Gesetzes immer pruefen."],
      },
    ],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStrList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => toStr(v)).filter((v) => v.length > 0);
}

export default function TutorWisoPage() {
  const [tab, setTab] = useState<TabId>("wissensbasis");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("WISO AP2 - Bundle");
  const [summary, setSummary] = useState("Wissensbasis, Trainingsfragen und Pruefungssimulation fuer WISO AP2.");
  const [sections, setSections] = useState<WisoSections>({});

  const configured = isTutorApiConfigured();

  const loadBundle = async () => {
    if (!configured) {
      setError("Tutor API not configured. Set VITE_TUTOR_API_URL.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const execution = await runTutorRequest({
        topic: "wiso",
        mode: "trace",
        lang: "de",
        params: { section: "bundle", topic: "arbeitsrecht", seed: 20260301, n_questions: 10 },
      });

      const result = execution.result;
      if (!isRecord(result)) throw new Error("Invalid WISO response");

      setTitle(toStr(result.title) || "WISO AP2 - Bundle");
      setSummary(toStr(result.summary) || "Wissensbasis, Trainingsfragen und Pruefungssimulation fuer WISO AP2.");

      if (isRecord(result.sections)) {
        const raw = result.sections;
        setSections({
          wissensbasis: Array.isArray(raw.wissensbasis) ? (raw.wissensbasis as WisoKnowledgeItem[]) : [],
          trainingsfragen: Array.isArray(raw.trainingsfragen) ? (raw.trainingsfragen as WisoTrainingTopic[]) : [],
          pruefungssimulation: isRecord(raw.pruefungssimulation) ? (raw.pruefungssimulation as WisoSimulation) : {},
        });
      } else {
        setSections({});
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBundle();
  }, []);

  const wissensbasis = useMemo(
    () => (sections.wissensbasis && sections.wissensbasis.length > 0 ? sections.wissensbasis : FALLBACK_SECTIONS.wissensbasis || []),
    [sections.wissensbasis],
  );
  const trainingsfragen = useMemo(
    () =>
      sections.trainingsfragen && sections.trainingsfragen.length > 0 ? sections.trainingsfragen : FALLBACK_SECTIONS.trainingsfragen || [],
    [sections.trainingsfragen],
  );
  const pruefung = useMemo(
    () => (sections.pruefungssimulation && Object.keys(sections.pruefungssimulation).length > 0 ? sections.pruefungssimulation : FALLBACK_SECTIONS.pruefungssimulation || {}),
    [sections.pruefungssimulation],
  );

  return (
    // DESIGN-AUDIT 0.6 (light mode): dark-by-design work surface -- see
    // TutorAppPage.tsx's comment; same treatment across the tutor suite.
    <div className="dark min-h-dvh bg-[var(--flow-bg-deep)] text-foreground">
    <div className="p-4 lg:p-6 max-w-[1500px] mx-auto space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-slate-700/60 bg-slate-950/60 px-3 py-2">
        <Link to="/tutor/app" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">
          Tutor
        </Link>
        <Link to="/tutor" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">
          Exam Bank (AP2)
        </Link>
        <Link to="/tutor/wiso" className="rounded border border-slate-400 bg-slate-900 px-3 py-1.5 text-sm font-medium">
          WISO
        </Link>
        <Link to="/tutor/ergaenzungspruefung" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">
          Ergänzungsprüfung
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <h1 className="text-4xl font-semibold text-emerald-300">{title}</h1>
        <Button variant="outline" onClick={() => void loadBundle()} disabled={loading}>
          {loading ? "Loading..." : "Reload"}
        </Button>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "wissensbasis" ? "secondary" : "outline"} onClick={() => setTab("wissensbasis")}>
          Wissensbasis
        </Button>
        <Button variant={tab === "trainingsfragen" ? "secondary" : "outline"} onClick={() => setTab("trainingsfragen")}>
          Trainingsfragen
        </Button>
        <Button variant={tab === "pruefung" ? "secondary" : "outline"} onClick={() => setTab("pruefung")}>
          Pruefungssimulation
        </Button>
      </div>

      <div className="rounded-md border p-3 text-lg text-muted-foreground">{summary}</div>

      {error && <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      {!error && tab === "wissensbasis" && (
        <div className="space-y-4">
          {wissensbasis.map((item, idx) => (
            <div key={`${item.topic || "topic"}-${idx}`} className="rounded-md border p-4 space-y-3">
              <h3 className="text-4xl font-semibold">{toStr(item.topic) || "Topic"}</h3>
              <p className="whitespace-pre-wrap text-lg text-muted-foreground">{toStr(item.explain_de)}</p>
              {toStrList(item.typische_pruefungsfallen).length > 0 && (
                <div className="rounded-md border border-exam/30 bg-exam/10 p-3">
                  <div className="font-medium mb-2">Typische Pruefungsfallen</div>
                  <ul className="list-disc pl-5 space-y-1">
                    {toStrList(item.typische_pruefungsfallen).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {toStr(item.explain_fa) && (
                <div className="rounded-md border border-exam/40 bg-exam/10 p-3" dir="rtl">
                  <div className="font-medium mb-2 text-right">توضیح فارسی</div>
                  <p className="whitespace-pre-wrap leading-8">{toStr(item.explain_fa)}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!error && tab === "trainingsfragen" && (
        <div className="space-y-4">
          {trainingsfragen.map((group, gidx) => (
            <div key={`${group.topic || "group"}-${gidx}`} className="rounded-md border p-4 space-y-3">
              <h3 className="text-3xl font-semibold">{toStr(group.topic) || "Thema"}</h3>
              {(group.fragen || []).map((frage, qidx) => (
                <div key={`${frage.id || "q"}-${qidx}`} className="rounded-md border p-3 space-y-2">
                  <div className="text-xl font-medium">{toStr(frage.id)} - {toStr(frage.frage)}</div>
                  {isRecord(frage.optionen) && (
                    <ul className="list-disc pl-6 space-y-1">
                      {Object.entries(frage.optionen).map(([k, v]) => (
                        <li key={`${frage.id || "q"}-${k}`}><strong>{k}:</strong> {toStr(v)}</li>
                      ))}
                    </ul>
                  )}
                  {toStr(frage.richtige_antwort) && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
                      <strong>Antwort:</strong> {toStr(frage.richtige_antwort)}
                    </div>
                  )}
                  {toStr(frage.erklaerung_de) && <div className="text-muted-foreground">{toStr(frage.erklaerung_de)}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!error && tab === "pruefung" && (
        <div className="space-y-4">
          <div className="rounded-md border p-4 space-y-2">
            <h3 className="text-3xl font-semibold">Pruefungssimulation</h3>
            <div className="text-xl">Name: {toStr(pruefung.rahmen?.exam_name) || "WISO Pruefungssimulation"}</div>
            <div className="text-xl">
              Fragen: {pruefung.rahmen?.anzahl_fragen ?? 0} | Punkte: {pruefung.rahmen?.punkte_gesamt ?? 0} | Zeit: {pruefung.rahmen?.zeit_minuten ?? 0} Minuten
            </div>
          </div>
          {(pruefung.fragen || []).map((q, idx) => (
            <div key={`${q.id || "sim"}-${idx}`} className="rounded-md border p-4 space-y-2">
              <div className="text-xl font-medium">{toStr(q.id)} - {toStr(q.frage)}</div>
              {isRecord(q.optionen) && (
                <ul className="list-disc pl-6 space-y-1">
                  {Object.entries(q.optionen).map(([k, v]) => (
                    <li key={`${q.id || "sim"}-${k}`}><strong>{k}:</strong> {toStr(v)}</li>
                  ))}
                </ul>
              )}
              {toStr(q.richtige_antwort) && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
                  <strong>Antwort:</strong> {toStr(q.richtige_antwort)}
                </div>
              )}
              {toStr(q.erklaerung_de) && <div className="text-muted-foreground">{toStr(q.erklaerung_de)}</div>}
              {toStr(q.erklaerung_fa) && (
                <div className="rounded-md border border-exam/40 bg-exam/10 p-3" dir="rtl">
                  <div className="font-medium mb-2 text-right">توضیح فارسی</div>
                  <p className="whitespace-pre-wrap leading-8">{toStr(q.erklaerung_fa)}</p>
                </div>
              )}
              {toStrList(q.fehleranalyse).length > 0 && (
                <div>
                  <div className="font-medium mb-1">Fehleranalyse</div>
                  <ul className="list-disc pl-6 space-y-1">
                    {toStrList(q.fehleranalyse).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
