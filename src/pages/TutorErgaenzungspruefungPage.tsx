import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAzureTTS, type TtsLang } from "@/hooks/useAzureTTS";
import { OOP_QUESTIONS } from "./oopQuestions";
import { DATENBANKEN_QUESTIONS } from "./datenbankenQuestions";
import { NETZWERKE_QUESTIONS } from "./netzwerkeQuestions";
import { SOFTWAREENGINEERING_QUESTIONS } from "./softwareengineeringQuestions";

type TabId = "ueberblick" | "themen" | "vorbereitung" | "beispielfragen" | "sprachausgabe";

// ─── Data ────────────────────────────────────────────────────────────────────

const THEMEN = [
  {
    titel: "Algorithmen & Datenstrukturen",
    punkte: [
      "Sortieralgorithmen: Bubblesort, Insertionsort, Selectionsort, Quicksort — Komplexität O(n²) vs. O(n log n)",
      "Suchalgorithmen: Lineare Suche O(n), Binäre Suche O(log n) — Voraussetzungen",
      "Datenstrukturen: Stack (LIFO), Queue (FIFO), verkettete Listen, Bäume",
      "Rekursion: Basisfall + rekursiver Schritt, Abbruchbedingung, Stapeltiefe",
      "Komplexitätsanalyse: Best-Case / Average-Case / Worst-Case",
    ],
    farbe: "border-blue-500/40 bg-blue-500/10",
    fallen: [
      "O-Notation: O(1) ≠ 'immer schnell' — es ist die Wachstumsrate",
      "Binäre Suche setzt SORTIERTE Liste voraus",
      "Stack overflow bei zu tiefer Rekursion ohne korrekten Basisfall",
    ],
  },
  {
    titel: "Objektorientierte Programmierung (OOP)",
    punkte: [
      "Vier Grundprinzipien: Kapselung, Vererbung, Polymorphismus, Abstraktion",
      "Klassen vs. Instanzen — Konstruktoren, Attribute, Methoden",
      "Interfaces vs. abstrakte Klassen: Interface = Vertrag, Abstract = Teilimplementierung",
      "Entwurfsmuster: Singleton, Observer, Factory, Strategy, MVC",
      "SOLID-Prinzipien: Single Responsibility, Open/Closed, Liskov, Interface Segregation, Dependency Inversion",
    ],
    farbe: "border-violet-500/40 bg-violet-500/10",
    fallen: [
      "Polymorphismus ≠ Überladen (Overloading vs. Overriding)",
      "Vererbung: 'is-a' Beziehung, Komposition: 'has-a' Beziehung",
      "Interface kann keine Instanz erstellen — nur Klasse implementiert Interface",
    ],
  },
  {
    titel: "Datenbanken & SQL",
    punkte: [
      "Normalisierung: 1NF (atomare Werte), 2NF (kein partieller Schlüssel), 3NF (kein transitiver Schlüssel)",
      "SQL-Grundlagen: SELECT, WHERE, JOIN (INNER, LEFT, RIGHT), GROUP BY, HAVING",
      "Primärschlüssel vs. Fremdschlüssel — referenzielle Integrität",
      "Transaktionen: ACID (Atomicity, Consistency, Isolation, Durability)",
      "ER-Diagramm: Entitäten, Attribute, Beziehungen (1:1, 1:N, N:M)",
    ],
    farbe: "border-emerald-500/40 bg-emerald-500/10",
    fallen: [
      "WHERE filtert VOR Gruppierung, HAVING filtert NACH GROUP BY",
      "NULL ≠ 0 und NULL ≠ '' — IS NULL / IS NOT NULL verwenden",
      "JOIN ohne ON-Bedingung ergibt kartesisches Produkt (n×m Zeilen)",
    ],
  },
  {
    titel: "Netzwerke & IT-Sicherheit",
    punkte: [
      "OSI-Modell 7 Schichten: Physical → Data Link → Network → Transport → Session → Presentation → Application",
      "TCP/IP: Drei-Wege-Handshake (SYN, SYN-ACK, ACK), TCP vs. UDP",
      "IP-Adressen: IPv4 (32 Bit), IPv6 (128 Bit), Subnetting, CIDR-Notation",
      "HTTP/HTTPS: Methoden (GET, POST, PUT, DELETE), Statuscodes (2xx, 3xx, 4xx, 5xx)",
      "IT-Sicherheit: CIA-Triad (Confidentiality, Integrity, Availability), Verschlüsselung (symmetrisch/asymmetrisch), Firewall, VPN",
    ],
    farbe: "border-exam/40 bg-exam/10",
    fallen: [
      "TCP = verbindungsorientiert, zuverlässig; UDP = verbindungslos, schnell (Video, DNS)",
      "Port 80 = HTTP, Port 443 = HTTPS, Port 22 = SSH, Port 3306 = MySQL",
      "Subnetzmaske /24 = 254 Hosts, /30 = 2 Hosts",
    ],
  },
  {
    titel: "Softwareentwicklung & Projektmanagement",
    punkte: [
      "Vorgehensmodelle: Wasserfallmodell, Scrum (Sprint, Daily, Review, Retrospektive), Kanban",
      "Versionskontrolle: Git — commit, push, pull, branch, merge, rebase",
      "Testen: Unit-Tests, Integrationstests, Systemtests, Black-Box vs. White-Box",
      "UML-Diagramme: Klassendiagramm, Sequenzdiagramm, Anwendungsfalldiagramm, Aktivitätsdiagramm",
      "Lastenheft vs. Pflichtenheft: WAS soll gebaut werden vs. WIE es gebaut wird",
    ],
    farbe: "border-pink-500/40 bg-pink-500/10",
    fallen: [
      "Scrum ≠ Agile — Scrum ist ein Framework innerhalb der Agile-Methodik",
      "git merge erstellt Merge-Commit; git rebase schreibt History um",
      "Black-Box: kein Einblick in Code; White-Box: Kenntnis des internen Aufbaus",
    ],
  },
];

const BEISPIELFRAGEN = [
  {
    kategorie: "Algorithmen — MEP Prüfungsfragen",
    badge: "MEP",
    badgeColor: "bg-exam/20 text-exam border-exam/40",
    fragen: [
      {
        frage: "Wie funktioniert die Suche nach dem Maximum in einem Array?",
        antwort: "Ich initialisiere die Variable max mit dem ersten Wert des Arrays. Danach durchlaufe ich das gesamte Array mit einer Schleife. Bei jedem Element prüfe ich, ob es größer als max ist. Wenn ja, aktualisiere ich max. Am Ende enthält max den größten Wert des Arrays.\n\nPseudocode:\nmax = array[0]\nfür jedes element im array:\n    wenn element > max:\n        max = element",
      },
      {
        frage: "Warum initialisiert man max mit dem ersten Element und nicht mit 0?",
        antwort: "Wenn alle Zahlen negativ sind, wäre 0 falsch. Deshalb nimmt man das erste Element des Arrays als Startwert. So funktioniert der Algorithmus auch bei negativen Zahlen korrekt.",
      },
      {
        frage: "Wie funktioniert die Suche nach dem Minimum in einem Array?",
        antwort: "Ich initialisiere die Variable min mit dem ersten Wert des Arrays. Danach durchlaufe ich alle Elemente. Wenn ein Element kleiner als min ist, aktualisiere ich min. Am Ende enthält min den kleinsten Wert.\n\nPseudocode:\nmin = array[0]\nfür jedes element im array:\n    wenn element < min:\n        min = element",
      },
      {
        frage: "Was passiert, wenn das Array leer ist?",
        antwort: "Dann gibt es kein erstes Element. Deshalb muss man vor dem Zugriff prüfen, ob das Array leer ist. Wenn das Array leer ist, kann man zum Beispiel eine Fehlermeldung ausgeben.",
      },
      {
        frage: "Wie berechnet man den Durchschnitt eines Arrays?",
        antwort: "Ich initialisiere eine Variable summe mit 0. Danach addiere ich alle Werte des Arrays. Zum Schluss teile ich die Summe durch die Anzahl der Elemente. Das Ergebnis ist der Durchschnitt.\n\nPseudocode:\nsumme = 0\nfür jedes element im array:\n    summe = summe + element\ndurchschnitt = summe / anzahl",
      },
      {
        frage: "Was ist eine lineare Suche?",
        antwort: "Bei der linearen Suche durchlaufe ich das Array von Anfang bis Ende. Ich vergleiche jedes Element mit dem Suchwert. Wenn ich den Wert finde, gebe ich die Position zurück. Wenn ich das Ende erreiche, wurde der Wert nicht gefunden.",
      },
      {
        frage: "Was ist eine binäre Suche?",
        antwort: "Die binäre Suche funktioniert nur bei einem sortierten Array. Ich beginne mit dem mittleren Element. Wenn der Suchwert kleiner ist, suche ich links weiter. Wenn der Suchwert größer ist, suche ich rechts weiter. Dadurch wird der Suchbereich bei jedem Schritt halbiert.",
      },
      {
        frage: "Warum muss das Array bei der binären Suche sortiert sein?",
        antwort: "Nur bei einem sortierten Array kann ich entscheiden, ob ich links oder rechts weitersuchen muss. Wenn das Array nicht sortiert ist, funktioniert diese Entscheidung nicht zuverlässig.",
      },
      {
        frage: "Wie funktioniert Bubble Sort?",
        antwort: "Beim Bubble Sort werden benachbarte Elemente miteinander verglichen. Wenn zwei Elemente in der falschen Reihenfolge stehen, werden sie vertauscht. Dieser Vorgang wird mehrfach wiederholt. Nach jedem Durchlauf wandert das größte Element weiter nach rechts. Am Ende ist das Array sortiert.",
      },
      {
        frage: "Was ist der Unterschied zwischen for-Schleife und while-Schleife?",
        antwort: "Eine for-Schleife verwendet man meistens, wenn die Anzahl der Durchläufe bekannt ist. Eine while-Schleife verwendet man, wenn die Anzahl der Durchläufe vorher nicht genau bekannt ist.",
      },
      {
        frage: "Was ist eine Endlosschleife?",
        antwort: "Eine Endlosschleife ist eine Schleife, deren Bedingung niemals falsch wird. Das Programm läuft dann immer weiter. Das passiert oft durch einen Fehler in der Abbruchbedingung.",
      },
      {
        frage: "Was ist ein Array?",
        antwort: "Ein Array speichert mehrere Werte unter einem gemeinsamen Namen. Die Werte haben meistens denselben Datentyp. Auf einzelne Werte greift man über den Index zu.",
      },
      {
        frage: "Was ist ein Index?",
        antwort: "Ein Index ist die Position eines Elements im Array. In vielen Programmiersprachen beginnt der Index bei 0. Das erste Element hat also den Index 0.",
      },
      {
        frage: "Was ist eine Methode?",
        antwort: "Eine Methode ist ein wiederverwendbarer Programmblock. Sie löst eine bestimmte Aufgabe. Eine Methode kann Parameter bekommen und einen Rückgabewert liefern.",
      },
      {
        frage: "Was ist ein Parameter?",
        antwort: "Ein Parameter ist ein Wert, der einer Methode übergeben wird. Mit Parametern kann eine Methode mit unterschiedlichen Eingaben arbeiten.",
      },
      {
        frage: "Was ist ein Rückgabewert?",
        antwort: "Ein Rückgabewert ist das Ergebnis, das eine Methode zurückgibt. Zum Beispiel kann eine Methode zwei Zahlen addieren und die Summe zurückgeben.",
      },
      {
        frage: "Was bedeutet O(n)?",
        antwort: "O von n bedeutet, dass die Laufzeit linear mit der Anzahl der Elemente wächst. Wenn die Anzahl der Elemente größer wird, braucht der Algorithmus ungefähr entsprechend mehr Zeit. Ein Beispiel ist die lineare Suche.",
      },
      {
        frage: "Was bedeutet O(n²)?",
        antwort: "O von n Quadrat bedeutet, dass die Laufzeit quadratisch wächst. Das passiert oft bei zwei verschachtelten Schleifen. Ein Beispiel ist Bubble Sort.",
      },
      {
        frage: "Was ist der Unterschied zwischen Klasse und Objekt?",
        antwort: "Eine Klasse ist ein Bauplan. Ein Objekt ist ein konkretes Exemplar dieser Klasse. Beispiel: Auto ist eine Klasse, mein roter Golf ist ein Objekt.",
      },
      {
        frage: "Was ist Vererbung?",
        antwort: "Bei der Vererbung übernimmt eine Klasse Eigenschaften und Methoden einer anderen Klasse. Dadurch kann man Code wiederverwenden. Beispiel: Hund erbt von Tier.",
      },
      {
        frage: "Was ist Polymorphismus?",
        antwort: "Polymorphismus bedeutet, dass dieselbe Methode in verschiedenen Klassen unterschiedlich umgesetzt werden kann. Beispiel: Die Methode bewegen kann bei Hund und Vogel unterschiedlich funktionieren.",
      },
      {
        frage: "Was ist Kapselung?",
        antwort: "Kapselung bedeutet, dass Daten geschützt werden. Attribute sind oft privat und werden über Methoden gelesen oder geändert. Dadurch verhindert man falschen direkten Zugriff.",
      },
      {
        frage: "Was macht eine IF-Bedingung?",
        antwort: "Eine IF-Bedingung prüft, ob eine Bedingung wahr ist. Nur wenn die Bedingung wahr ist, wird der zugehörige Code ausgeführt.",
      },
      {
        frage: "Wie erklärst du einen Algorithmus in der mündlichen Prüfung?",
        antwort: "Ich erkläre zuerst die Eingabe. Dann erkläre ich die Verarbeitung Schritt für Schritt. Danach erkläre ich die Ausgabe. Wenn möglich, gebe ich ein kleines Beispiel.",
      },
      {
        frage: "Was soll man machen, wenn man eine Frage nicht sofort versteht?",
        antwort: "Man sollte ruhig bleiben und nachfragen. Zum Beispiel: Könnten Sie die Frage bitte noch einmal anders formulieren? Das ist besser, als sofort falsch zu antworten.",
      },
    ],
  },
  {
    kategorie: "OOP & Entwurfsmuster",
    badge: null,
    badgeColor: "",
    fragen: [
      {
        frage: "Was versteht man unter dem Observer-Muster? Nennen Sie ein Praxisbeispiel.",
        antwort: "Das Observer-Muster definiert eine 1-zu-n-Abhängigkeit: Wenn ein Objekt (Subject) seinen Zustand ändert, werden alle abhängigen Objekte (Observer) automatisch benachrichtigt. Praxisbeispiel: Event-Listener in GUI — Button-Klick löst alle registrierten Handler aus.",
      },
      {
        frage: "Erklären Sie den Unterschied zwischen Interface und abstrakter Klasse.",
        antwort: "Interface: Nur Methodensignaturen (Vertrag), keine Implementierung, Mehrfachimplementierung möglich. Abstrakte Klasse: Kann sowohl abstrakte als auch konkrete Methoden haben, nur Einfachvererbung. Interface nutzen wenn verschiedene Klassenhierarchien denselben Vertrag erfüllen sollen. Abstrakte Klasse wenn gemeinsame Implementierung geteilt wird.",
      },
    ],
  },
  {
    kategorie: "Datenbanken",
    badge: null,
    badgeColor: "",
    fragen: [
      {
        frage: "Was sind die drei Normalformen?",
        antwort: "Erste Normalform: Alle Attribute atomar — keine Komma-Listen in einem Feld. Zweite Normalform: Kein partieller Schlüsselabhängigkeit — gilt nur bei zusammengesetztem Primärschlüssel. Dritte Normalform: Kein transitive Abhängigkeit — kein Nicht-Schlüsselattribut bestimmt ein anderes Nicht-Schlüsselattribut.",
      },
      {
        frage: "Was bedeutet ACID bei Datenbanktransaktionen?",
        antwort: "A steht für Atomicity — Transaktion ganz oder gar nicht. C steht für Consistency — Datenbank bleibt in konsistentem Zustand. I steht für Isolation — parallele Transaktionen beeinflussen sich nicht. D steht für Durability — committete Daten bleiben auch nach einem Absturz erhalten. Praxisbeispiel: Banküberweisung — Abbuchung und Gutschrift müssen beide gelingen oder beide fehlschlagen.",
      },
    ],
  },
  {
    kategorie: "Netzwerke",
    badge: null,
    badgeColor: "",
    fragen: [
      {
        frage: "Erklären Sie den Drei-Wege-Handshake bei TCP.",
        antwort: "Erster Schritt: Client sendet SYN an Server mit Sequenznummer x. Zweiter Schritt: Server antwortet mit SYN-ACK, bestätigt x+1 und sendet eigene Sequenznummer y. Dritter Schritt: Client sendet ACK und bestätigt y+1. Erst danach können Daten übertragen werden. TCP ist verbindungsorientiert und garantiert Reihenfolge und Vollständigkeit.",
      },
      {
        frage: "Was ist der Unterschied zwischen TCP und UDP?",
        antwort: "TCP ist verbindungsorientiert, garantiert Lieferung und Reihenfolge, hat Fehlerkorrektur, ist aber langsamer. UDP ist verbindungslos, hat keinen Handshake, keine Garantie, ist aber sehr schnell. UDP wird bevorzugt bei Videostreaming, VoIP, DNS-Anfragen und Online-Gaming — dort ist Latenz wichtiger als Vollständigkeit.",
      },
    ],
  },
];

const VORBEREITUNGSTIPPS = [
  { titel: "Schwachstellenanalyse", text: "Analysieren Sie Ihre schriftlichen Prüfungsergebnisse. Welche Themengebiete hatten die meisten Fehler? Konzentrieren Sie die Vorbereitung auf diese Bereiche, nicht auf bereits beherrschte Themen.", icon: "🎯" },
  { titel: "Laut erklären üben", text: "Die Ergänzungsprüfung ist eine mündliche Prüfung. Üben Sie, Konzepte laut zu erklären — am besten jemandem ohne Informatikkenntnisse. Wenn Sie es einfach erklären können, haben Sie es verstanden.", icon: "🗣️" },
  { titel: "Definitionen auswendig kennen", text: "Kennen Sie die genauen Definitionen: Was ist Polymorphismus? Was ist eine Transaktion? Die Prüfer erwarten präzise Antworten, nicht ungefähre Beschreibungen.", icon: "📖" },
  { titel: "Praxisbeispiele vorbereiten", text: "Zu jedem Konzept ein konkretes Praxisbeispiel kennen. Observer-Muster gleich Event-Listener im Browser ist überzeugender als eine abstrakte Definition.", icon: "💡" },
  { titel: "Ruhe bewahren", text: "Bei unbekannten Fragen: laut denken, Prüfer zeigen was Sie wissen. Das kenne ich nicht genau, aber ich würde es so angehen — ist besser als Schweigen.", icon: "🧘" },
  { titel: "Zeit nutzen", text: "15 Minuten klingt kurz, ist aber ausreichend für 3-4 vertiefte Fragen. Antworten Sie vollständig aber präzise — schweifende Antworten kosten Zeit und Punkte.", icon: "⏱️" },
];

// ─── TTS Hook ────────────────────────────────────────────────────────────────

// Voices load asynchronously in most browsers; we wait for the voiceschanged
// event and then pick the best available de-DE voice.
function pickGermanVoice(): SpeechSynthesisVoice | null {
  const voices = globalThis.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Preference order: name-based quality ranking, then any de-DE, then any de-*
  const ranked = [
    // Chrome / Edge on Windows — highest quality neural voices
    voices.find((v) => /Microsoft Katja/i.test(v.name)),
    voices.find((v) => /Microsoft Conrad/i.test(v.name)),
    voices.find((v) => /Google Deutsch/i.test(v.name)),
    // macOS built-in
    voices.find((v) => /Anna/i.test(v.name) && v.lang.startsWith("de")),
    voices.find((v) => /Yannick/i.test(v.name) && v.lang.startsWith("de")),
    // Any local de-DE voice
    voices.find((v) => v.lang === "de-DE" && v.localService),
    // Any de-DE voice (may be remote/network)
    voices.find((v) => v.lang === "de-DE"),
    // Fallback: any German-ish locale
    voices.find((v) => v.lang.startsWith("de")),
  ];
  return ranked.find(Boolean) ?? null;
}

function useTTS() {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [germanVoices, setGermanVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const load = () => {
      const all = globalThis.speechSynthesis.getVoices();
      const de = all.filter((v) => v.lang.startsWith("de"));
      setGermanVoices(de);
      // Auto-select best voice only on first load
      setSelectedVoiceName((prev) => {
        if (prev) return prev;
        const best = pickGermanVoice();
        return best?.name ?? (de[0]?.name ?? "");
      });
    };
    load();
    globalThis.speechSynthesis.addEventListener("voiceschanged", load);
    return () => { globalThis.speechSynthesis.removeEventListener("voiceschanged", load); };
  }, []);

  const stop = useCallback(() => {
    globalThis.speechSynthesis.cancel();
    setPlayingKey(null);
  }, []);

  const speak = useCallback(
    (text: string, key: string) => {
      globalThis.speechSynthesis.cancel();
      if (playingKey === key) {
        setPlayingKey(null);
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "de-DE";
      utter.rate = 0.88;
      utter.pitch = 1;
      const voice = globalThis.speechSynthesis
        .getVoices()
        .find((v) => v.name === selectedVoiceName) ?? pickGermanVoice();
      if (voice) utter.voice = voice;
      utter.onend = () => setPlayingKey(null);
      utter.onerror = () => setPlayingKey(null);
      utterRef.current = utter;
      setPlayingKey(key);
      globalThis.speechSynthesis.speak(utter);
    },
    [playingKey, selectedVoiceName],
  );

  useEffect(() => () => { globalThis.speechSynthesis.cancel(); }, []);

  const supported = globalThis.window !== undefined && "speechSynthesis" in globalThis;
  return { playingKey, speak, stop, supported, germanVoices, selectedVoiceName, setSelectedVoiceName };
}

// ─── Speak Button ─────────────────────────────────────────────────────────────

function SpeakButton({ text, ttsKey, playingKey, speak, supported }: Readonly<{
  text: string;
  ttsKey: string;
  playingKey: string | null;
  speak: (t: string, k: string) => void;
  supported: boolean;
}>) {
  if (!supported) return null;
  const isPlaying = playingKey === ttsKey;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); speak(text, ttsKey); }}
      title={isPlaying ? "Stopp" : "Vorlesen (de)"}
      className={cn(
        "shrink-0 rounded p-1.5 transition-colors",
        isPlaying
          ? "text-exam bg-exam/20 hover:bg-exam/30"
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50",
      )}
    >
      {isPlaying ? (
        // pause icon
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      ) : (
        // speaker icon
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );
}

// ─── Persian TTS Button ───────────────────────────────────────────────────────

function FaPlayButton({ id, text, playingId, isAnyPlaying, onToggle }: Readonly<{
  id: string;
  text: string;
  playingId: string | null;
  isAnyPlaying: boolean;
  onToggle: (id: string, text: string) => void;
}>) {
  const isThis = playingId === id && isAnyPlaying;
  return (
    <button
      type="button"
      onClick={() => onToggle(id, text)}
      title={isThis ? "توقف" : "پخش به فارسی"}
      className={cn(
        "shrink-0 rounded border px-2 py-0.5 text-xs font-medium transition-colors",
        isThis
          ? "border-exam/40 bg-exam/20 text-exam"
          : "border-slate-600 bg-slate-800 text-slate-400 hover:text-slate-200",
      )}
    >
      {isThis ? "⏸" : "🔊"} FA
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TutorErgaenzungspruefungPage() {
  const [tab, setTab] = useState<TabId>("ueberblick");
  const [offeneFrage, setOffeneFrage] = useState<string | null>(null);
  const [offeneOopFrage, setOffeneOopFrage] = useState<string | null>(null);
  const { playingKey, speak, stop, supported, germanVoices, selectedVoiceName, setSelectedVoiceName } = useTTS();

  // Persian TTS for OOP explainFa
  const { isPlaying: faIsPlaying, play: faPlay, stop: faStop } = useAzureTTS();
  const [faPlayingId, setFaPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!faIsPlaying) setFaPlayingId(null);
  }, [faIsPlaying]);

  const handleFaToggle = useCallback(async (id: string, text: string): Promise<void> => {
    if (faPlayingId === id) {
      faStop();
      setFaPlayingId(null);
      return;
    }
    faStop();
    setFaPlayingId(id);
    await faPlay(text, { lang: "fa", rate: 0.9, pitch: 1 });
    setFaPlayingId(null);
  }, [faPlayingId, faPlay, faStop]);

  // Sprachausgabe tab state
  const [saText, setSaText] = useState("");
  const [saRate, setSaRate] = useState(0.9);
  const [saPitch, setSaPitch] = useState(1);
  const [saLang, setSaLang] = useState<TtsLang>("de");
  const [saVoices, setSaVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saVoiceName, setSaVoiceName] = useState("");
  const { isPlaying: saPlaying, progress: saProgress, play: saPlayAzure, stop: saStop } = useAzureTTS();

  useEffect(() => {
    const load = () => {
      const filtered = (globalThis.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang.startsWith(saLang));
      setSaVoices(filtered);
      setSaVoiceName(saLang === "de" ? (pickGermanVoice()?.name ?? filtered[0]?.name ?? "") : (filtered[0]?.name ?? ""));
    };
    load();
    globalThis.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => { globalThis.speechSynthesis?.removeEventListener("voiceschanged", load); };
  }, [saLang]);

  const saPlay = useCallback(async () => {
    await saPlayAzure(saText, { lang: saLang, rate: saRate, pitch: saPitch, webSpeechVoiceName: saVoiceName });
  }, [saPlayAzure, saText, saLang, saRate, saPitch, saVoiceName]);

  const tabs: { id: TabId; label: string }[] = [
    { id: "ueberblick", label: "Überblick" },
    { id: "themen", label: "Themen" },
    { id: "vorbereitung", label: "Vorbereitung" },
    { id: "beispielfragen", label: "Beispielfragen" },
    { id: "sprachausgabe", label: "🔊 Sprachausgabe" },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-[1500px] mx-auto space-y-4">
      {/* Nav */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700/60 bg-slate-950/60 px-3 py-2">
        <Link to="/tutor/app" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">Tutor</Link>
        <Link to="/tutor" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">Exam Bank (AP2)</Link>
        <Link to="/tutor/wiso" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">WISO</Link>
        <Link to="/tutor/ergaenzungspruefung" className="rounded border border-exam/60 bg-exam/10 px-3 py-1.5 text-sm font-medium text-exam">Ergänzungsprüfung</Link>
        <Link to="/tutor/mep-simulation" className="rounded border border-exam/40 bg-exam/10 px-3 py-1.5 text-sm font-medium text-exam hover:bg-exam/20">MEP-Simulation</Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-exam">Ergänzungsprüfung FIAE</h1>
        <p className="text-muted-foreground mt-1">Mündliche Ergänzungsprüfung nach § 36 BBiG — Vorbereitung, Themen und Beispielfragen</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Button key={t.id} variant={tab === t.id ? "secondary" : "outline"} onClick={() => setTab(t.id)} className={tab === t.id ? "border-exam/40" : ""}>
            {t.label}
          </Button>
        ))}
      </div>

      {/* ─── Überblick ───────────────────────────────────────── */}
      {tab === "ueberblick" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { titel: "Was ist die Ergänzungsprüfung?", text: "Eine mündliche Prüfung, die Auszubildende beantragen können, wenn sie die schriftliche AP2-Prüfung knapp nicht bestanden haben (45–49,5 Punkte von 100). Das Ergebnis fließt gewichtet in die Gesamtnote ein und kann zum Bestehen führen.", farbe: "border-exam/40 bg-exam/10" },
              { titel: "Zulassungsvoraussetzungen", text: "Gesamtpunktzahl im schriftlichen Teil zwischen 45 und unter 50 Punkten. Der Antrag muss fristgerecht beim IHK-Prüfungsausschuss gestellt werden. Die genaue Frist variiert je nach IHK-Bezirk.", farbe: "border-blue-500/40 bg-blue-500/10" },
              { titel: "Dauer & Ablauf", text: "Dauer: ca. 15 Minuten. Format: Fachgespräch mit 2-3 Prüfern des Prüfungsausschusses. Die Prüfer stellen Fragen aus allen Prüfungsbereichen des Ausbildungsberufs.", farbe: "border-emerald-500/40 bg-emerald-500/10" },
              { titel: "Bewertung & Gewichtung", text: "Das Ergebnis der mündlichen Prüfung wird mit dem schriftlichen Ergebnis verrechnet. Mit einer sehr guten mündlichen Leistung ist das Bestehen möglich.", farbe: "border-violet-500/40 bg-violet-500/10" },
              { titel: "Rechtsgrundlage", text: "§ 36 BBiG: Auf Antrag des Prüflings soll die Prüfung durch eine mündliche Prüfung ergänzt werden, wenn dies für das Bestehen der Prüfung den Ausschlag geben kann.", farbe: "border-rose-500/40 bg-rose-500/10" },
              { titel: "Tipp: Antrag stellen", text: "Den Antrag SOFORT nach Bekanntgabe der schriftlichen Ergebnisse stellen! Die Fristen sind kurz (oft 5 Werktage). Kontaktieren Sie Ihre IHK direkt.", farbe: "border-exam/40 bg-exam/10" },
            ].map((karte) => (
              <div key={karte.titel} className={cn("rounded-md border p-4 space-y-2", karte.farbe)}>
                <h3 className="font-semibold text-base">{karte.titel}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{karte.text}</p>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-exam/30 bg-exam/5 p-4 space-y-2">
            <h3 className="font-semibold text-exam">Prüfungsbereiche AP2 (FIAE)</h3>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              {[
                { bereich: "Entwicklung von Anwendungssystemen", punkte: "50 Punkte" },
                { bereich: "Planung und Organisation", punkte: "10 Punkte" },
                { bereich: "Wirtschafts- und Sozialkunde (WISO)", punkte: "10 Punkte" },
                { bereich: "Ganzheitliche Aufgabe I", punkte: "15 Punkte" },
                { bereich: "Ganzheitliche Aufgabe II", punkte: "15 Punkte" },
              ].map((row) => (
                <div key={row.bereich} className="flex items-start justify-between gap-2 rounded border border-slate-700/40 bg-slate-900/50 px-3 py-2">
                  <span className="text-muted-foreground">{row.bereich}</span>
                  <span className="shrink-0 font-mono text-exam">{row.punkte}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Themen ──────────────────────────────────────────── */}
      {tab === "themen" && (
        <div className="space-y-4">
          {THEMEN.map((thema) => (
            <Fragment key={thema.titel}>
              <div className={cn("rounded-md border p-4 space-y-3", thema.farbe)}>
                <h3 className="text-xl font-semibold">{thema.titel}</h3>
                <ul className="space-y-1.5">
                  {thema.punkte.map((punkt) => (
                    <li key={punkt} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 shrink-0 text-emerald-400">✓</span>
                      <span>{punkt}</span>
                    </li>
                  ))}
                </ul>
                {thema.fallen.length > 0 && (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3">
                    <div className="font-medium text-sm text-rose-300 mb-2">Typische Prüfungsfallen</div>
                    <ul className="space-y-1">
                      {thema.fallen.map((falle) => (
                        <li key={falle} className="text-sm text-muted-foreground">• {falle}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {thema.titel.includes("OOP") && (
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold text-violet-300">OOP Prüfungsfragen</h2>
                    <span className="rounded border border-violet-500/40 bg-violet-500/20 px-1.5 py-0.5 text-xs font-semibold text-violet-300">
                      {OOP_QUESTIONS.length} Fragen
                    </span>
                  </div>
                  {OOP_QUESTIONS.map((item, idx) => {
                    const oopKey = `themen-oop-${idx}`;
                    const istOffen = offeneOopFrage === oopKey;
                    const vollText = `Frage: ${item.question}. Antwort: ${item.answer}`;
                    return (
                      <div key={oopKey} className="rounded-md border border-slate-700/60 overflow-hidden">
                        <div className="flex items-center gap-1 pr-2">
                          <button
                            type="button"
                            onClick={() => setOffeneOopFrage(istOffen ? null : oopKey)}
                            className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                          >
                            <span className="text-sm font-medium">
                              <span className="mr-2 font-mono text-xs text-violet-400/70">{idx + 1}.</span>
                              {item.question}
                            </span>
                            <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                          </button>
                          <SpeakButton text={vollText} ttsKey={`${oopKey}-voll`} playingKey={playingKey} speak={speak} supported={supported} />
                        </div>
                        {istOffen && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-700/40">
                            <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-3 mt-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-violet-400">Musterantwort</span>
                                <SpeakButton text={item.answer} ttsKey={`${oopKey}-antwort`} playingKey={playingKey} speak={speak} supported={supported} />
                              </div>
                              <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {thema.titel.includes("Datenbanken") && (
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold text-emerald-300">Datenbanken Prüfungsfragen</h2>
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/20 px-1.5 py-0.5 text-xs font-semibold text-emerald-300">
                      {DATENBANKEN_QUESTIONS.length} Fragen
                    </span>
                  </div>
                  {DATENBANKEN_QUESTIONS.map((item, idx) => {
                    const dbKey = `themen-db-${idx}`;
                    const istOffen = offeneOopFrage === dbKey;
                    const vollText = `Frage: ${item.question}. Antwort: ${item.answer}`;
                    return (
                      <div key={dbKey} className="rounded-md border border-slate-700/60 overflow-hidden">
                        <div className="flex items-center gap-1 pr-2">
                          <button
                            type="button"
                            onClick={() => setOffeneOopFrage(istOffen ? null : dbKey)}
                            className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                          >
                            <span className="text-sm font-medium">
                              <span className="mr-2 font-mono text-xs text-emerald-400/70">{idx + 1}.</span>
                              {item.question}
                            </span>
                            <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                          </button>
                          <SpeakButton text={vollText} ttsKey={`${dbKey}-voll`} playingKey={playingKey} speak={speak} supported={supported} />
                        </div>
                        {istOffen && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-700/40">
                            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 mt-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-emerald-400">Musterantwort</span>
                                <SpeakButton text={item.answer} ttsKey={`${dbKey}-antwort`} playingKey={playingKey} speak={speak} supported={supported} />
                              </div>
                              <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {thema.titel.includes("Netzwerke") && (
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold text-exam">Netzwerke Prüfungsfragen</h2>
                    <span className="rounded border border-exam/40 bg-exam/20 px-1.5 py-0.5 text-xs font-semibold text-exam">
                      {NETZWERKE_QUESTIONS.length} Fragen
                    </span>
                  </div>
                  {NETZWERKE_QUESTIONS.map((item, idx) => {
                    const netKey = `themen-net-${idx}`;
                    const istOffen = offeneOopFrage === netKey;
                    const vollText = `Frage: ${item.question}. Antwort: ${item.answer}`;
                    return (
                      <div key={netKey} className="rounded-md border border-slate-700/60 overflow-hidden">
                        <div className="flex items-center gap-1 pr-2">
                          <button
                            type="button"
                            onClick={() => setOffeneOopFrage(istOffen ? null : netKey)}
                            className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                          >
                            <span className="text-sm font-medium">
                              <span className="mr-2 font-mono text-xs text-exam/70">{idx + 1}.</span>
                              {item.question}
                            </span>
                            <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                          </button>
                          <SpeakButton text={vollText} ttsKey={`${netKey}-voll`} playingKey={playingKey} speak={speak} supported={supported} />
                        </div>
                        {istOffen && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-700/40">
                            <div className="rounded-md border border-exam/30 bg-exam/10 p-3 mt-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-exam">Musterantwort</span>
                                <SpeakButton text={item.answer} ttsKey={`${netKey}-antwort`} playingKey={playingKey} speak={speak} supported={supported} />
                              </div>
                              <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {thema.titel.includes("Softwareentwicklung") && (
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold text-pink-300">Software-Engineering Prüfungsfragen</h2>
                    <span className="rounded border border-pink-500/40 bg-pink-500/20 px-1.5 py-0.5 text-xs font-semibold text-pink-300">
                      {SOFTWAREENGINEERING_QUESTIONS.length} Fragen
                    </span>
                  </div>
                  {SOFTWAREENGINEERING_QUESTIONS.map((item, idx) => {
                    const seKey = `themen-se-${idx}`;
                    const istOffen = offeneOopFrage === seKey;
                    const vollText = `Frage: ${item.question}. Antwort: ${item.answer}`;
                    return (
                      <div key={seKey} className="rounded-md border border-slate-700/60 overflow-hidden">
                        <div className="flex items-center gap-1 pr-2">
                          <button
                            type="button"
                            onClick={() => setOffeneOopFrage(istOffen ? null : seKey)}
                            className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                          >
                            <span className="text-sm font-medium">
                              <span className="mr-2 font-mono text-xs text-pink-400/70">{idx + 1}.</span>
                              {item.question}
                            </span>
                            <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                          </button>
                          <SpeakButton text={vollText} ttsKey={`${seKey}-voll`} playingKey={playingKey} speak={speak} supported={supported} />
                        </div>
                        {istOffen && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-700/40">
                            <div className="rounded-md border border-pink-500/30 bg-pink-500/10 p-3 mt-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-pink-400">Musterantwort</span>
                                <SpeakButton text={item.answer} ttsKey={`${seKey}-antwort`} playingKey={playingKey} speak={speak} supported={supported} />
                              </div>
                              <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Fragment>
          ))}

          {/* MEP Prüfungsfragen am Ende des Themen-Tabs */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-exam">Mündliche Prüfungsfragen (MEP)</h2>
              <span className="rounded border border-exam/40 bg-exam/20 px-1.5 py-0.5 text-xs font-semibold text-exam">
                {BEISPIELFRAGEN[0].fragen.length} Fragen
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Typische Fragen aus der mündlichen Ergänzungsprüfung — klicken zum Aufklappen, Lautsprecher zum Vorlesen.
            </p>
            {BEISPIELFRAGEN[0].fragen.map((item, idx) => {
              const key = `themen-mep-${idx}`;
              const istOffen = offeneFrage === key;
              const vollText = `Frage: ${item.frage}. Antwort: ${item.antwort}`;
              return (
                <div key={key} className="rounded-md border border-slate-700/60 overflow-hidden">
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => setOffeneFrage(istOffen ? null : key)}
                      className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="text-sm font-medium">
                        <span className="mr-2 font-mono text-xs text-exam/70">{idx + 1}.</span>
                        {item.frage}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                    </button>
                    <SpeakButton
                      text={vollText}
                      ttsKey={`${key}-voll`}
                      playingKey={playingKey}
                      speak={speak}
                      supported={supported}
                    />
                  </div>
                  {istOffen && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-700/40">
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 mt-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-emerald-400">Musterantwort</span>
                          <SpeakButton
                            text={item.antwort}
                            ttsKey={`${key}-antwort`}
                            playingKey={playingKey}
                            speak={speak}
                            supported={supported}
                          />
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-line">{item.antwort}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Vorbereitung ────────────────────────────────────── */}
      {tab === "vorbereitung" && (
        <div className="space-y-4">
          <div className="rounded-md border border-exam/30 bg-exam/5 p-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Die Ergänzungsprüfung ist eine Chance — nicht nur ein zweiter Versuch. Mit gezielter Vorbereitung in 1–2 Wochen können Sie die Lücken schließen, die zum Nichtbestehen geführt haben.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {VORBEREITUNGSTIPPS.map((tipp) => (
              <div key={tipp.titel} className="rounded-md border border-slate-700/60 bg-slate-900/60 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{tipp.icon}</span>
                  <h3 className="font-semibold">{tipp.titel}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{tipp.text}</p>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-slate-700/60 p-4 space-y-3">
            <h3 className="font-semibold text-lg">10-Tage-Plan</h3>
            <div className="space-y-2">
              {[
                { tag: "Tag 1–2", aufgabe: "Schriftliche Ergebnisse analysieren. Schwachbereiche identifizieren. Lernplan erstellen." },
                { tag: "Tag 3–4", aufgabe: "Algorithmen & Datenstrukturen: Sortierverfahren, Komplexität, Rekursion wiederholen." },
                { tag: "Tag 5–6", aufgabe: "OOP & Entwurfsmuster: Klassen, Interfaces, Observer, MVC, SOLID üben." },
                { tag: "Tag 7",   aufgabe: "Datenbanken: SQL-Joins, Normalisierung, ACID, ER-Diagramme." },
                { tag: "Tag 8",   aufgabe: "Netzwerke: OSI, TCP/IP, HTTP, Subnetting, IT-Sicherheit." },
                { tag: "Tag 9",   aufgabe: "Beispielfragen laut beantworten. Schwachstellen erneut prüfen." },
                { tag: "Tag 10",  aufgabe: "Generalprobe: Alle Themen kompakt wiederholen. Früh schlafen gehen." },
              ].map((row) => (
                <div key={row.tag} className="flex gap-3 text-sm">
                  <span className="shrink-0 w-20 font-mono text-exam">{row.tag}</span>
                  <span className="text-muted-foreground">{row.aufgabe}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Beispielfragen ──────────────────────────────────── */}
      {tab === "beispielfragen" && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-700/40 bg-slate-900/40 p-3">
            <p className="text-sm text-muted-foreground">
              Klicken Sie auf eine Frage für die Musterantwort.
              {supported && (
                <span className="ml-1">Das <strong className="text-slate-300">Lautsprecher-Symbol</strong> liest den Text auf Deutsch vor.</span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* Voice selector — only shown when multiple German voices are available */}
              {supported && germanVoices.length > 1 && (
                <select
                  value={selectedVoiceName}
                  onChange={(e) => setSelectedVoiceName(e.target.value)}
                  title="Deutsche Stimme auswählen"
                  className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-exam/50 max-w-[210px]"
                >
                  {germanVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              )}
              {supported && playingKey && (
                <Button variant="outline" size="sm" onClick={stop} className="shrink-0 border-rose-500/40 text-rose-400 hover:bg-rose-500/10">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="mr-1.5">
                    <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                  Vorlesen stoppen
                </Button>
              )}
            </div>
          </div>

          {BEISPIELFRAGEN.map((gruppe) => (
            <div key={gruppe.kategorie} className="space-y-2">
              {/* Kategorie-Header */}
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-exam">{gruppe.kategorie}</h3>
                {gruppe.badge && (
                  <span className={cn("rounded border px-1.5 py-0.5 text-xs font-semibold", gruppe.badgeColor)}>
                    {gruppe.badge}
                  </span>
                )}
              </div>

              {gruppe.fragen.map((item, idx) => {
                const key = `${gruppe.kategorie}-${idx}`;
                const istOffen = offeneFrage === key;
                const vollText = `Frage: ${item.frage}. Antwort: ${item.antwort}`;

                return (
                  <div key={key} className="rounded-md border border-slate-700/60 overflow-hidden">
                    {/* Frage-Zeile */}
                    <div className="flex items-center gap-1 pr-2">
                      <button
                        type="button"
                        onClick={() => setOffeneFrage(istOffen ? null : key)}
                        className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                      >
                        <span className="text-sm font-medium">{item.frage}</span>
                        <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                      </button>
                      <SpeakButton
                        text={vollText}
                        ttsKey={`${key}-voll`}
                        playingKey={playingKey}
                        speak={speak}
                        supported={supported}
                      />
                    </div>

                    {/* Antwort */}
                    {istOffen && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-700/40">
                        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 mt-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-emerald-400">Musterantwort</span>
                            <SpeakButton
                              text={item.antwort}
                              ttsKey={`${key}-antwort`}
                              playingKey={playingKey}
                              speak={speak}
                              supported={supported}
                            />
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-line">{item.antwort}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* OOP (25 Fragen) mit explainFa */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-violet-300">OOP Prüfungsfragen (25 Fragen)</h3>
              <span className="rounded border border-violet-500/40 bg-violet-500/20 px-1.5 py-0.5 text-xs font-semibold text-violet-300">OOP</span>
            </div>
            {OOP_QUESTIONS.map((item, idx) => {
              const key = `bsp-oop-${item.id}`;
              const istOffen = offeneFrage === key;
              const vollText = `Frage: ${item.question}. Antwort: ${item.answer}`;
              return (
                <div key={key} className="rounded-md border border-slate-700/60 overflow-hidden">
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => setOffeneFrage(istOffen ? null : key)}
                      className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="text-sm font-medium">
                        <span className="mr-2 font-mono text-xs text-violet-400/70">{idx + 1}.</span>
                        {item.question}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                    </button>
                    <SpeakButton text={vollText} ttsKey={`${key}-voll`} playingKey={playingKey} speak={speak} supported={supported} />
                  </div>
                  {istOffen && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-700/40 space-y-3">
                      <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-3 mt-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-violet-400">Musterantwort</span>
                          <SpeakButton text={item.answer} ttsKey={`${key}-antwort`} playingKey={playingKey} speak={speak} supported={supported} />
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                      </div>
                      <div className="rounded-md border border-exam/30 bg-exam/5 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-exam">توضیح فارسی</span>
                          <FaPlayButton
                            id={key}
                            text={item.explainFa}
                            playingId={faPlayingId}
                            isAnyPlaying={faIsPlaying}
                            onToggle={handleFaToggle}
                          />
                        </div>
                        <p dir="rtl" className="font-fa text-sm leading-relaxed whitespace-pre-line text-right">
                          {item.explainFa}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Datenbanken (25 Fragen) mit explainFa */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-emerald-300">Datenbanken Prüfungsfragen (25 Fragen)</h3>
              <span className="rounded border border-emerald-500/40 bg-emerald-500/20 px-1.5 py-0.5 text-xs font-semibold text-emerald-300">DB</span>
            </div>
            {DATENBANKEN_QUESTIONS.map((item, idx) => {
              const key = `bsp-db-${item.id}`;
              const istOffen = offeneFrage === key;
              const vollText = `Frage: ${item.question}. Antwort: ${item.answer}`;
              return (
                <div key={key} className="rounded-md border border-slate-700/60 overflow-hidden">
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => setOffeneFrage(istOffen ? null : key)}
                      className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="text-sm font-medium">
                        <span className="mr-2 font-mono text-xs text-emerald-400/70">{idx + 1}.</span>
                        {item.question}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                    </button>
                    <SpeakButton text={vollText} ttsKey={`${key}-voll`} playingKey={playingKey} speak={speak} supported={supported} />
                  </div>
                  {istOffen && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-700/40 space-y-3">
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 mt-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-emerald-400">Musterantwort</span>
                          <SpeakButton text={item.answer} ttsKey={`${key}-antwort`} playingKey={playingKey} speak={speak} supported={supported} />
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                      </div>
                      <div className="rounded-md border border-exam/30 bg-exam/5 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-exam">توضیح فارسی</span>
                          <FaPlayButton
                            id={key}
                            text={item.explainFa}
                            playingId={faPlayingId}
                            isAnyPlaying={faIsPlaying}
                            onToggle={handleFaToggle}
                          />
                        </div>
                        <p dir="rtl" className="font-fa text-sm leading-relaxed whitespace-pre-line text-right">
                          {item.explainFa}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Netzwerke (25 Fragen) mit explainFa */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-exam">Netzwerke Prüfungsfragen (25 Fragen)</h3>
              <span className="rounded border border-exam/40 bg-exam/20 px-1.5 py-0.5 text-xs font-semibold text-exam">NET</span>
            </div>
            {NETZWERKE_QUESTIONS.map((item, idx) => {
              const key = `bsp-net-${item.id}`;
              const istOffen = offeneFrage === key;
              const vollText = `Frage: ${item.question}. Antwort: ${item.answer}`;
              return (
                <div key={key} className="rounded-md border border-slate-700/60 overflow-hidden">
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => setOffeneFrage(istOffen ? null : key)}
                      className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="text-sm font-medium">
                        <span className="mr-2 font-mono text-xs text-exam/70">{idx + 1}.</span>
                        {item.question}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                    </button>
                    <SpeakButton text={vollText} ttsKey={`${key}-voll`} playingKey={playingKey} speak={speak} supported={supported} />
                  </div>
                  {istOffen && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-700/40 space-y-3">
                      <div className="rounded-md border border-exam/30 bg-exam/10 p-3 mt-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-exam">Musterantwort</span>
                          <SpeakButton text={item.answer} ttsKey={`${key}-antwort`} playingKey={playingKey} speak={speak} supported={supported} />
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                      </div>
                      <div className="rounded-md border border-exam/30 bg-exam/5 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-exam">توضیح فارسی</span>
                          <FaPlayButton
                            id={key}
                            text={item.explainFa}
                            playingId={faPlayingId}
                            isAnyPlaying={faIsPlaying}
                            onToggle={handleFaToggle}
                          />
                        </div>
                        <p dir="rtl" className="font-fa text-sm leading-relaxed whitespace-pre-line text-right">
                          {item.explainFa}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Software-Engineering (25 Fragen) mit explainFa */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-pink-300">Software-Engineering Prüfungsfragen (25 Fragen)</h3>
              <span className="rounded border border-pink-500/40 bg-pink-500/20 px-1.5 py-0.5 text-xs font-semibold text-pink-300">SE</span>
            </div>
            {SOFTWAREENGINEERING_QUESTIONS.map((item, idx) => {
              const key = `bsp-se-${item.id}`;
              const istOffen = offeneFrage === key;
              const vollText = `Frage: ${item.question}. Antwort: ${item.answer}`;
              return (
                <div key={key} className="rounded-md border border-slate-700/60 overflow-hidden">
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => setOffeneFrage(istOffen ? null : key)}
                      className="flex-1 text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="text-sm font-medium">
                        <span className="mr-2 font-mono text-xs text-pink-400/70">{idx + 1}.</span>
                        {item.question}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                    </button>
                    <SpeakButton text={vollText} ttsKey={`${key}-voll`} playingKey={playingKey} speak={speak} supported={supported} />
                  </div>
                  {istOffen && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-700/40 space-y-3">
                      <div className="rounded-md border border-pink-500/30 bg-pink-500/10 p-3 mt-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-pink-400">Musterantwort</span>
                          <SpeakButton text={item.answer} ttsKey={`${key}-antwort`} playingKey={playingKey} speak={speak} supported={supported} />
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer}</p>
                      </div>
                      <div className="rounded-md border border-exam/30 bg-exam/5 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-exam">توضیح فارسی</span>
                          <FaPlayButton
                            id={key}
                            text={item.explainFa}
                            playingId={faPlayingId}
                            isAnyPlaying={faIsPlaying}
                            onToggle={handleFaToggle}
                          />
                        </div>
                        <p dir="rtl" className="font-fa text-sm leading-relaxed whitespace-pre-line text-right">
                          {item.explainFa}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Sprachausgabe ───────────────────────────────────── */}
      {tab === "sprachausgabe" && (
        <div className="space-y-5 max-w-2xl">
          {/* Language selector */}
          <div className="flex gap-3">
            {(["de", "fa"] as TtsLang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => { saStop(); setSaLang(l); }}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                  saLang === l
                    ? "border-exam/60 bg-exam/10 text-exam"
                    : "border-slate-700 bg-slate-900 hover:bg-slate-800 text-muted-foreground",
                )}
              >
                <span className="text-lg">{l === "de" ? "🇩🇪" : "🇦🇫"}</span>
                {l === "de" ? "Deutsch" : "فارسی"}
              </button>
            ))}
          </div>

          {/* Fallback voice selector */}
          {supported && saVoices.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="sa-voice" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Fallback-Stimme (Web Speech)
              </label>
              <select
                id="sa-voice"
                title="Stimme auswählen"
                value={saVoiceName}
                onChange={(e) => setSaVoiceName(e.target.value)}
                className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-exam/50"
              >
                {saVoices.map((v) => (
                  <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Wird nur verwendet, wenn Azure TTS nicht erreichbar ist.</p>
            </div>
          )}

          {/* Text area */}
          <div className="space-y-1.5">
            <label htmlFor="sa-text" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Text eingeben / متن
            </label>
            <textarea
              id="sa-text"
              dir={saLang === "fa" ? "rtl" : "ltr"}
              value={saText}
              onChange={(e) => setSaText(e.target.value)}
              placeholder={saLang === "de" ? "Deutschen Text hier eingeben…" : "متن فارسی را اینجا بنویسید…"}
              rows={10}
              className={cn(
                "w-full rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm resize-y",
                "placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-exam/40",
                saLang === "fa" && "text-right",
              )}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {saText.length > 0 && (
                  <>{saText.length.toLocaleString()} Zeichen · {Math.ceil(saText.length / 1500)} Abschnitt{Math.ceil(saText.length / 1500) === 1 ? "" : "e"}</>
                )}
              </span>
              {saText.length > 0 && (
                <button type="button" onClick={() => setSaText("")} className="hover:text-slate-200 transition-colors">
                  Löschen
                </button>
              )}
            </div>
          </div>

          {/* Rate & Pitch sliders */}
          <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="sa-rate" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Geschwindigkeit / سرعت</label>
                <span className="font-mono text-xs text-slate-300">{saRate.toFixed(2)}×</span>
              </div>
              <input id="sa-rate" type="range" min={0.5} max={2} step={0.05} value={saRate}
                title="Geschwindigkeit"
                onChange={(e) => setSaRate(Number(e.target.value))}
                className="w-full accent-exam" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0.5×</span><span>1.0×</span><span>2.0×</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="sa-pitch" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tonhöhe / زیر و بمی</label>
                <span className="font-mono text-xs text-slate-300">{saPitch.toFixed(1)}</span>
              </div>
              <input id="sa-pitch" type="range" min={0.5} max={2} step={0.1} value={saPitch}
                title="Tonhöhe"
                onChange={(e) => setSaPitch(Number(e.target.value))}
                className="w-full accent-exam" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>بم / Tief</span><span>Normal</span><span>زیر / Hoch</span>
              </div>
            </div>
          </div>

          {/* Play / Stop */}
          <div className="flex gap-3">
            <Button size="lg" onClick={saPlay}
              disabled={saText.trim().length === 0 || saPlaying}
              className="flex-1 gap-2 bg-exam hover:bg-exam text-black font-semibold">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {saLang === "de" ? "Vorlesen" : "پخش"}
            </Button>
            <Button size="lg" variant="outline" onClick={saStop} disabled={!saPlaying}
              className="gap-2 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-30">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
              {saLang === "de" ? "Stopp" : "توقف"}
            </Button>
          </div>

          {/* Progress */}
          {saProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-exam">
                  <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-exam opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-exam" />
                  </span>
                  <span>{saLang === "de" ? "Abschnitt" : "بخش"} {saProgress.current} / {saProgress.total}</span>
                </div>
                <span className="text-xs text-muted-foreground rounded border border-slate-700 px-1.5 py-0.5">
                  {saProgress.engine === "azure" ? "Azure Neural TTS" : "Web Speech API"}
                </span>
              </div>
              <progress
                value={saProgress.current}
                max={saProgress.total}
                className="w-full h-1.5 rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-exam [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-exam"
              />
            </div>
          )}

          {/* Persian voice install guide */}
          {saLang === "fa" && saVoices.length === 0 && supported && (
            <div className="rounded-md border border-slate-700/60 bg-slate-900/40 p-4 text-sm space-y-2">
              <p className="font-medium text-slate-300">صدای فارسی برای Web Speech fallback یافت نشد</p>
              <p className="text-muted-foreground text-xs">Azure TTS به‌صورت خودکار استفاده می‌شود. اگر Azure در دسترس نباشد:</p>
              <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
                <li>Windows: تنظیمات → زمان و زبان → گفتار → اضافه کردن صدا → فارسی</li>
                <li>Mac: System Settings → Accessibility → Spoken Content → Manage Voices → Persian</li>
              </ul>
            </div>
          )}

          {!supported && (
            <p className="text-sm text-exam">Ihr Browser unterstützt keine Text-to-Speech-Funktion.</p>
          )}
        </div>
      )}
    </div>
  );
}
