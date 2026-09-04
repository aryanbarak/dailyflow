import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAzureTTS, type TtsLang } from "@/hooks/useAzureTTS";

type TabId = "info" | "lernkarten" | "tipps";

interface MepKarte {
  id: string;
  thema: string;
  frage: string;
  antwortDe: string;
  erklaerungFa: string;
  tipp: string;
}

// ─── Data ────────────────────────────────────────────────────────────────────

const MEP_KARTEN: readonly MepKarte[] = [
  {
    id: "k01",
    thema: "Pseudocode lesen und erklären",
    frage: "Was macht eine Funktion wie findMax?",
    antwortDe:
      "Diese Funktion sucht den größten Wert in einem Array. Sie startet mit dem ersten Element als Startwert für max. Danach wird jedes weitere Element mit dem aktuellen Maximum verglichen. Wenn ein Element größer ist, wird max aktualisiert. Am Ende wird der größte gefundene Wert zurückgegeben.",
    erklaerungFa:
      "این تابع بزرگ‌ترین عدد داخل یک آرایه را پیدا می‌کند.\nاول مقدار اولین عنصر را به عنوان max می‌گیرد.\nبعد تمام عناصر بعدی را یکی‌یکی مقایسه می‌کند.\nاگر عددی بزرگ‌تر باشد، max تغییر می‌کند.\nدر پایان max بزرگ‌ترین عدد آرایه است.\n\nنکته آزمون: اول هدف را توضیح بده، بعد مراحل — کد را کلمه‌به‌کلمه نخوان.",
    tipp: "Erst das Ziel erklären, dann die Schritte — nicht Zeile für Zeile vorlesen.",
  },
  {
    id: "k02",
    thema: "Maximum im Array",
    frage: "Wie findet man das Maximum in einem Array?",
    antwortDe:
      "Ich initialisiere die Variable max mit dem ersten Wert des Arrays. Danach durchlaufe ich alle Elemente mit einer Schleife. Bei jedem Element prüfe ich, ob es größer als max ist. Falls ja, aktualisiere ich max. Am Ende enthält max den größten Wert.",
    erklaerungFa:
      "من max را با اولین مقدار آرایه مقداردهی می‌کنم.\nسپس همه عناصر را با حلقه بررسی می‌کنم.\nاگر یک عنصر از max بزرگ‌تر بود، max را تغییر می‌دهم.\nدر پایان max بزرگ‌ترین مقدار است.\n\nنکته: max را با صفر شروع نکن — اگر همه اعداد منفی باشند جواب غلط می‌شود!",
    tipp: "max nie mit 0 initialisieren — bei negativen Arrays falsch! Immer mit zahlen[0] starten.",
  },
  {
    id: "k03",
    thema: "Minimum im Array",
    frage: "Wie findet man das Minimum in einem Array?",
    antwortDe:
      "Ich initialisiere die Variable min mit dem ersten Wert des Arrays. Danach vergleiche ich alle weiteren Elemente mit min. Wenn ein Element kleiner ist, aktualisiere ich min. Am Ende enthält min den kleinsten Wert. Die Schleife startet bei Index 1, weil Index 0 bereits als Startwert dient.",
    erklaerungFa:
      "برای کمینه، min را برابر اولین عنصر قرار می‌دهم.\nبعد همه عناصر را بررسی می‌کنم.\nاگر عددی کوچک‌تر از min بود، min را تغییر می‌دهم.\nدر پایان min کوچک‌ترین مقدار است.\n\nنکته: اگر پرسید «چرا i از 1 شروع می‌شود؟» — چون index 0 قبلاً به عنوان شروع استفاده شده است.",
    tipp: "Häufige MEP-Frage: \"Warum startet i bei 1?\" → weil zahlen[0] schon als Startwert dient.",
  },
  {
    id: "k04",
    thema: "Durchschnitt berechnen",
    frage: "Wie berechnet man den Durchschnitt eines Arrays?",
    antwortDe:
      "Ich initialisiere eine Variable summe mit 0. Danach addiere ich alle Werte des Arrays mit einer Schleife. Zum Schluss teile ich die Summe durch die Anzahl der Elemente. Das Ergebnis ist der Durchschnitt. Wichtig: summe muss als Real deklariert werden, sonst entsteht Ganzzahldivision.",
    erklaerungFa:
      "برای میانگین، اول summe را صفر می‌گذارم.\nبعد همه اعداد آرایه را جمع می‌کنم.\nدر پایان مجموع را بر تعداد عناصر تقسیم می‌کنم.\nنتیجه میانگین است.\n\nدانش امتحانی: برای اعشار بهتر است Real یا Double استفاده شود — با Integer تقسیم ممکن است نتیجه اشتباه شود.",
    tipp: "summe als Real deklarieren, nicht Integer — sonst Ganzzahldivision (z. B. 7/2 = 3 statt 3.5)!",
  },
  {
    id: "k05",
    thema: "Array und Index",
    frage: "Was ist ein Array und was ist ein Index?",
    antwortDe:
      "Ein Array speichert mehrere Werte unter einem gemeinsamen Namen. Die Werte haben meistens denselben Datentyp. Ein Index ist die Position eines Elements im Array. In den meisten Programmiersprachen beginnt der Index bei 0. Ein Array mit 6 Elementen hat die Indizes 0 bis 5 — der letzte gültige Index ist immer Länge minus 1.",
    erklaerungFa:
      "آرایه چند مقدار را زیر یک نام نگه می‌دارد.\nمعمولاً همه مقادیر از یک نوع هستند.\nIndex یعنی جایگاه یک عنصر در آرایه.\nدر بسیاری از زبان‌ها اندیس از صفر شروع می‌شود.\n\nنکته: اگر آرایه ۶ عنصر دارد، آخرین Index برابر ۵ است، نه ۶.",
    tipp: "Array mit 6 Elementen → Indizes 0–5. Letzter gültiger Index = Länge − 1.",
  },
  {
    id: "k06",
    thema: "For-Schleife (FUER)",
    frage: "Wann verwendet man eine For-Schleife?",
    antwortDe:
      "Eine For-Schleife verwendet man, wenn die Anzahl der Durchläufe bekannt ist. Zum Beispiel, wenn man alle Elemente eines Arrays durchlaufen möchte. Dabei läuft die Zählvariable meistens von 0 bis Länge minus 1. In IHK-Pseudocode: FUER i VON 0 BIS laenge(array) - 1 MIT SCHRITTWEITE 1.",
    erklaerungFa:
      "حلقه for وقتی استفاده می‌شود که تعداد تکرارها معلوم باشد.\nمثلاً وقتی می‌خواهیم همه عناصر آرایه را بررسی کنیم.\nمعمولاً شمارنده از 0 تا طول آرایه منهای ۱ می‌رود.\n\nنکته: در آرایه‌ها معمولاً for بهترین انتخاب است.",
    tipp: "IHK-Syntax: FUER i VON 0 BIS laenge(arr) - 1 MIT SCHRITTWEITE 1 ... NAECHSTES i",
  },
  {
    id: "k07",
    thema: "While / SOLANGE-Schleife",
    frage: "Wann verwendet man eine SOLANGE-Schleife?",
    antwortDe:
      "Eine SOLANGE-Schleife verwendet man, wenn die Anzahl der Durchläufe vorher nicht genau bekannt ist. Die Schleife läuft, solange die Bedingung wahr ist. Wichtig: Die Bedingung muss sich irgendwann ändern, sonst entsteht eine Endlosschleife. Beispiel: Datum schrittweise inkrementieren bis ein Enddatum erreicht ist.",
    erklaerungFa:
      "حلقه while یا SOLANGE وقتی استفاده می‌شود که تعداد تکرارها از قبل معلوم نیست.\nحلقه تا زمانی اجرا می‌شود که شرط درست باشد.\nباید شرط در طول برنامه تغییر کند، وگرنه حلقه بی‌نهایت می‌شود.\n\nنکته: به شرط توقف توجه کن.",
    tipp: "Endlosschleife prüfen: Ändert sich die Variable, die in der Bedingung vorkommt?",
  },
  {
    id: "k08",
    thema: "Lineare Suche",
    frage: "Wie funktioniert die lineare Suche?",
    antwortDe:
      "Bei der linearen Suche durchlaufe ich das Array von Anfang bis Ende. Ich vergleiche jedes Element mit dem Suchwert. Wenn ich den Wert finde, gebe ich die Position (Index) zurück. Wenn ich das Ende erreiche ohne Treffer, gebe ich -1 zurück. Laufzeit: O(n) — funktioniert auf sortierten und unsortierten Arrays.",
    erklaerungFa:
      "در جستجوی خطی، آرایه از اول تا آخر بررسی می‌شود.\nهر عنصر با مقدار موردنظر مقایسه می‌شود.\nاگر پیدا شد، موقعیت آن برگردانده می‌شود.\nاگر تا آخر پیدا نشد، ۱- برگردانده می‌شود.\n\nنکته: روی آرایه مرتب و نامرتب کار می‌کند، اما برای داده زیاد کند است (O(n)).",
    tipp: "Voraussetzung: keine. Laufzeit: O(n). Gibt -1 zurück wenn nicht gefunden.",
  },
  {
    id: "k09",
    thema: "Binäre Suche",
    frage: "Wie funktioniert die binäre Suche?",
    antwortDe:
      "Die binäre Suche funktioniert nur bei einem sortierten Array. Ich beginne mit dem mittleren Element. Wenn der Suchwert kleiner ist, suche ich links weiter; wenn er größer ist, rechts. Dadurch halbiert sich der Suchbereich bei jedem Schritt. Laufzeit: O(log n). Bei 1.000.000 Elementen nur ~20 Schritte.",
    erklaerungFa:
      "جستجوی دودویی فقط روی آرایه مرتب کار می‌کند.\nاول عنصر وسط بررسی می‌شود.\nاگر مقدار هدف کوچک‌تر بود، سمت چپ را می‌گردیم.\nاگر بزرگ‌تر بود، سمت راست را می‌گردیم.\nدر هر مرحله محدوده جستجو نصف می‌شود.\n\nنکته: چرا باید مرتب باشد؟ — بدون ترتیب نمی‌دانیم چپ یا راست برویم.",
    tipp: "Voraussetzung: Array MUSS sortiert sein! Laufzeit O(log n). Bei 1 Mio Elementen: ~20 Schritte.",
  },
  {
    id: "k10",
    thema: "Bubble Sort",
    frage: "Wie funktioniert Bubble Sort?",
    antwortDe:
      "Bei Bubble Sort werden immer zwei benachbarte Elemente verglichen. Wenn sie in der falschen Reihenfolge stehen, werden sie getauscht. Nach jedem Durchlauf wandert das größte Element nach rechts. Das wird wiederholt, bis das Array sortiert ist. Laufzeit: O(n²) — zwei verschachtelte Schleifen.",
    erklaerungFa:
      "در Bubble Sort همیشه دو عنصر کنار هم مقایسه می‌شوند.\nاگر ترتیب‌شان اشتباه باشد، جابه‌جا می‌شوند.\nبعد از هر دور، بزرگ‌ترین عنصر به سمت راست می‌رود.\nاین کار تا مرتب شدن آرایه تکرار می‌شود.\n\nنکته: برای نزولی کردن Bubble Sort فقط علامت مقایسه را برعکس می‌کنیم (> به <).",
    tipp: "Absteigende Sortierung: nur > zu < ändern. O(n²) wegen zwei verschachtelter Schleifen.",
  },
  {
    id: "k11",
    thema: "Fehler im Pseudocode finden",
    frage: "Welche typischen Fehler gibt es in Pseudocode?",
    antwortDe:
      "Typische Fehler: Falsche Schleifengrenzen (BIS laenge statt BIS laenge-1), falsche Abbruchbedingung, fehlende Variablenaktualisierung, falscher Vergleichsoperator (> statt <), falscher Datentyp. Bei Arrays: häufigstes Fehler ist der Off-by-One-Error — BIS laenge(array) führt zu IndexOutOfBoundsException.",
    erklaerungFa:
      "خطاهای رایج:\n• فرز اشتباه حلقه (تا length به جای length-1)\n• شرط توقف اشتباه\n• به‌روزرسانی نکردن متغیر\n• علامت مقایسه اشتباه\n• نوع داده اشتباه\n\nدر آرایه‌ها خطای مهم این است: تا length برویم در حالی که آخرین اندیس length-1 است → IndexOutOfBoundsException.\n\nنکته: اول فرز حلقه و Index را چک کن.",
    tipp: "Off-by-One: BIS laenge(arr) → FEHLER! Muss BIS laenge(arr) - 1 sein.",
  },
  {
    id: "k12",
    thema: "Methode, Parameter, Rückgabewert",
    frage: "Was ist eine Methode, ein Parameter und ein Rückgabewert?",
    antwortDe:
      "Eine Methode ist ein wiederverwendbarer Programmblock mit einer bestimmten Aufgabe. Ein Parameter ist ein Wert, der der Methode beim Aufruf übergeben wird. Ein Rückgabewert ist das Ergebnis, das die Methode zurückgibt. Beispiel: berechneSumme(a, b) — a und b sind Parameter, a+b ist der Rückgabewert.",
    erklaerungFa:
      "متد یک بخش قابل استفاده دوباره از برنامه است که یک کار مشخص انجام می‌دهد.\nپارامتر مقداری است که به متد داده می‌شود.\nمقدار برگشتی نتیجه‌ای است که متد برمی‌گرداند.\n\nمثال: berechneSumme(a, b) — a و b پارامتر هستند، a+b مقدار برگشتی است.\n\nنکته: syntax IHK: FUNKTION name(param : Typ) : RückgabeTyp",
    tipp: "IHK-Syntax: FUNKTION name(param : Typ) : RückgabeTyp ... RÜCKGABE ergebnis ... ENDE FUNKTION",
  },
  {
    id: "k13",
    thema: "Klasse und Objekt",
    frage: "Was ist der Unterschied zwischen Klasse und Objekt?",
    antwortDe:
      "Eine Klasse ist ein Bauplan oder eine Vorlage, die Attribute und Methoden definiert. Ein Objekt ist eine konkrete Instanz dieser Klasse — mit konkreten Werten. Analogie: Klasse = Kuchenform, Objekt = fertiger Kuchen. Oder: Klasse = class Auto, Objekt = meinAuto = new Auto().",
    erklaerungFa:
      "کلاس مثل نقشه یا قالب است — ساختار را تعریف می‌کند.\nآبجکت نمونه واقعی از آن کلاس است — با مقادیر مشخص.\n\nمثال: Auto یک کلاس است، اما ماشین قرمز من یک آبجکت از آن کلاس است.\n\nکلیدواژه: Klasse = Bauplan, Objekt = konkretes Exemplar.",
    tipp: "Kurze Formel: Klasse = Bauplan. Objekt = Instanz. Analogie: Kuchenform vs. Kuchen.",
  },
  {
    id: "k14",
    thema: "Kapselung",
    frage: "Was bedeutet Kapselung?",
    antwortDe:
      "Kapselung bedeutet, dass Daten (Attribute) geschützt werden, indem sie als private deklariert werden. Zugriff und Änderung erfolgen ausschließlich über Methoden — Getter (lesen) und Setter (setzen). Dadurch verhindert man direkten, unkontrollierten Zugriff von außen auf interne Daten.",
    erklaerungFa:
      "کپسوله‌سازی یعنی داده‌ها محافظت شوند.\nمعمولاً attribute ها private هستند.\nدسترسی به آنها فقط از طریق متدها (getter و setter) انجام می‌شود.\nاین کار از تغییر مستقیم و اشتباه جلوگیری می‌کند.\n\nکلیدواژه: private Attribute + Zugriff über Methoden.",
    tipp: "OOP-Säule 1. Schlüsselwörter: private + Getter/Setter. Schützt interne Daten vor direktem Zugriff.",
  },
  {
    id: "k15",
    thema: "Vererbung",
    frage: "Was bedeutet Vererbung?",
    antwortDe:
      "Vererbung bedeutet, dass eine Unterklasse Eigenschaften und Methoden einer Oberklasse übernimmt und erweitern kann. Dadurch wird Code wiederverwendet und Redundanz vermieden. Beispiel: Hund extends Tier — Hund erbt alle Attribute und Methoden von Tier und kann eigene hinzufügen.",
    erklaerungFa:
      "وراثت یعنی یک کلاس (زیرکلاس) ویژگی‌ها و متدهای کلاس دیگر (ابرکلاس) را به ارث می‌برد.\nاین کار باعث استفاده دوباره از کد می‌شود.\n\nمثال: Hund از Tier ارث می‌برد — تمام متدهای Tier در Hund هم هست.\n\nکوتاه: Unterklasse übernimmt von Oberklasse.",
    tipp: "OOP-Säule 2. Schlüsselwort: extends. Unterklasse übernimmt von Oberklasse + eigene Erweiterungen.",
  },
  {
    id: "k16",
    thema: "Polymorphismus",
    frage: "Was bedeutet Polymorphismus?",
    antwortDe:
      "Polymorphismus bedeutet, dass dieselbe Methode in verschiedenen Klassen unterschiedlich implementiert werden kann. Eine Oberklassen-Referenz kann auf ein Objekt einer Unterklasse zeigen und die überschriebene Methode aufrufen. Beispiel: tier.lautGeben() liefert bei Hund 'Wuff' und bei Katze 'Miau'.",
    erklaerungFa:
      "چندریختی یعنی یک متد با یک نام می‌تواند در کلاس‌های مختلف رفتار متفاوت داشته باشد.\nیک مرجع از نوع Oberklasse می‌تواند به آبجکت Unterklasse اشاره کند و متد override شده را صدا بزند.\n\nمثال: متد lautGeben در Hund صدای Wuff و در Katze صدای Miau می‌دهد.\n\nکلیدواژه: gleiche Methode, unterschiedliches Verhalten.",
    tipp: "OOP-Säule 3. Schlüsselwörter: überschreiben (override) + gleiche Methode, unterschiedliches Verhalten.",
  },
  {
    id: "k17",
    thema: "UML-Aktivitätsdiagramm",
    frage: "Was ist ein UML-Aktivitätsdiagramm?",
    antwortDe:
      "Ein UML-Aktivitätsdiagramm stellt einen Ablauf grafisch dar. Grundelemente: Startknoten (gefüllter Kreis ●), Aktionen (abgerundete Rechtecke), Entscheidungsknoten (Raute ◆ mit Bedingungen), Endknoten (Kreis mit Ring ⊙). Es ist die grafische Alternative zu Pseudocode — beide sind laut IHK gleichwertig.",
    erklaerungFa:
      "UML Activity Diagram جریان یک کار را به صورت تصویری نشان می‌دهد.\nشامل شروع (دایره توپر ●)، فعالیت‌ها (مستطیل گرد)، تصمیم‌گیری‌ها (لوزی ◆) و پایان (دایره با حلقه ⊙) است.\n\nمی‌تواند جایگزین شبه‌کد برای نمایش روند برنامه باشد.\n\nمهم: از سال ۲۰۲۵ Struktogramm حذف شده — فقط Pseudocode یا Aktivitätsdiagramm.",
    tipp: "NEU ab 2025: Struktogramme abgeschafft! Elemente merken: Start ● → Aktion → Raute ◆ → Ende ⊙",
  },
  {
    id: "k18",
    thema: "Laufzeit O(n)",
    frage: "Was bedeutet O(n)?",
    antwortDe:
      "O(n) bedeutet linearer Aufwand. Wenn die Anzahl der Elemente wächst, wächst die Laufzeit ungefähr proportional. Eine einzelne Schleife, die alle n Elemente genau einmal durchläuft, hat O(n). Beispiel: lineare Suche, Durchschnitt berechnen, Maximum finden.",
    erklaerungFa:
      "O(n) یعنی زمان اجرا خطی است.\nاگر تعداد عناصر زیاد شود، زمان اجرا هم تقریباً به همان نسبت زیاد می‌شود.\n\nمثال: جستجوی خطی — ممکن است همه n عنصر بررسی شوند.\n\nنکته: یک حلقه روی n عنصر معمولاً O(n) است.",
    tipp: "Eine Schleife über n Elemente → O(n). Beispiele: lineare Suche, Maximum/Minimum, Durchschnitt.",
  },
  {
    id: "k19",
    thema: "Laufzeit O(log n)",
    frage: "Was bedeutet O(log n)?",
    antwortDe:
      "O(log n) bedeutet, dass der Suchbereich bei jedem Schritt halbiert wird. Die Laufzeit wächst sehr langsam. Beispiel: binäre Suche. Bei 1.000.000 Elementen benötigt man nur ~20 Schritte statt 1.000.000. Voraussetzung: Die Daten müssen sortiert sein.",
    erklaerungFa:
      "O(log n) یعنی محدوده جستجو در هر مرحله کوچک‌تر می‌شود، معمولاً نصف می‌شود.\n\nمثال: جستجوی دودویی. برای ۱ میلیون عنصر فقط حدود ۲۰ مرحله لازم است!\n\nنکته: فقط وقتی داده مرتب باشد قابل استفاده است.",
    tipp: "Nur bei sortierten Daten! Bei n=1.000.000: ~20 Schritte statt 1.000.000 — extrem effizient.",
  },
  {
    id: "k20",
    thema: "Laufzeit O(n²)",
    frage: "Was bedeutet O(n²)?",
    antwortDe:
      "O(n²) bedeutet quadratischer Aufwand. Das entsteht bei zwei verschachtelten Schleifen, die beide alle n Elemente durchlaufen. Beispiel: Bubble Sort. Bei 1.000 Elementen sind ~1.000.000 Operationen nötig. Bei 10.000 Elementen ~100.000.000 — für große n sehr langsam.",
    erklaerungFa:
      "O(n²) یعنی زمان اجرا به صورت مربعی رشد می‌کند.\nمعمولاً وقتی دو حلقه تو در تو روی n عنصر داریم.\n\nمثال معروف: Bubble Sort. برای ۱۰۰۰ عنصر حدود ۱ میلیون عملیات!\n\nنکته: دو حلقه تو در تو معمولاً نشانه O(n²) است.",
    tipp: "Zwei verschachtelte Schleifen über n → O(n²). Bubble Sort ist das Parade-Beispiel.",
  },
  {
    id: "k21",
    thema: "Prüfungsstrategie MEP",
    frage: "Wie erklärt man einen Algorithmus in der MEP?",
    antwortDe:
      "Ich erkläre zuerst die Eingabe — was wird übergeben. Danach erkläre ich die Verarbeitung Schritt für Schritt. Anschließend erkläre ich die Ausgabe — was wird zurückgegeben. Wenn möglich, nenne ich ein kleines konkretes Beispiel. Ich spreche laut — auch wenn ich unsicher bin, fange ich mit dem ersten Satz an.",
    erklaerungFa:
      "در امتحان شفاهی:\n۱) اول ورودی را توضیح بده (چه چیزی وارد می‌شود)\n۲) بعد مرحله‌به‌مرحله پردازش را بگو\n۳) سپس خروجی را بیان کن (چه چیزی برمی‌گردد)\n۴) اگر ممکن بود، یک مثال کوچک بزن\n\nنکته: سکوت نکن — حتی اگر کامل نیستی، با جمله اول شروع کن.",
    tipp: "EVA: Eingabe → Verarbeitung → Ausgabe. Laut denken. Lieber falsch anfangen als schweigen.",
  },
];

const SCHLUESSEL_ANTWORTEN: readonly { nr: number; frage: string; antwort: string }[] = [
  {
    nr: 1,
    frage: "Was ist Bubble Sort?",
    antwort:
      "Vergleiche immer zwei benachbarte Elemente. Sind sie falsch sortiert, tausche sie. Das größte Element blubbert pro Runde ans Ende. Laufzeit: O(n²).",
  },
  {
    nr: 2,
    frage: "Warum startet der Index bei 1 bei der Max-Suche?",
    antwort:
      "Weil Element[0] bereits als Startwert für das Maximum verwendet wird — ein Selbstvergleich bei i=0 wäre unnötig.",
  },
  {
    nr: 3,
    frage: "Was ist der Unterschied zwischen linearer und binärer Suche?",
    antwort:
      "Linear prüft jedes Element, O(n), funktioniert unsortiert. Binär halbiert das sortierte Array, O(log n), nur auf sortierten Daten.",
  },
  {
    nr: 4,
    frage: "Was ist Kapselung?",
    antwort: "Attribute sind private. Zugriff nur über Methoden (Getter/Setter).",
  },
  {
    nr: 5,
    frage: "Klasse vs. Objekt?",
    antwort: "Klasse ist der Bauplan, Objekt die konkrete Instanz. Analogie: Kuchenform vs. fertiger Kuchen.",
  },
  {
    nr: 6,
    frage: "Was ist Polymorphismus?",
    antwort: "Gleiche Methode, unterschiedliches Verhalten je nach Klasse. Beispiel: tier.lautGeben() → Hund: Wuff, Katze: Miau.",
  },
  {
    nr: 7,
    frage: "Was bedeutet O(n²)?",
    antwort: "Zwei verschachtelte Schleifen über n Elemente — der Aufwand wächst quadratisch. Beispiel: Bubble Sort.",
  },
  {
    nr: 8,
    frage: "Wie erkenne ich eine Endlosschleife?",
    antwort:
      "Die Abbruchbedingung wird nie erreicht, weil die Variable in die falsche Richtung verändert wird. Beispiel: i = i - 1 statt i = i + 1.",
  },
  {
    nr: 9,
    frage: "Wie passe ich Bubble Sort auf absteigende Sortierung an?",
    antwort: "Das > im Vergleich zu < ändern: WENN zahlen[j] < zahlen[j+1] DANN tauschen.",
  },
  {
    nr: 10,
    frage: "Was ist ein UML-Aktivitätsdiagramm?",
    antwort:
      "Grafische Darstellung eines Ablaufs mit Start (●), Aktionen (Rechtecke), Entscheidungen (Raute ◆) und Ende (⊙) — Alternative zu Pseudocode (ab 2025 Pflicht statt Struktogramm).",
  },
];

// ─── Module-level TTS helper ─────────────────────────────────────────────────

function TtsBtn({
  id,
  text,
  lang,
  playingId,
  isAnyPlaying,
  onToggle,
}: Readonly<{
  id: string;
  text: string;
  lang: TtsLang;
  playingId: string | null;
  isAnyPlaying: boolean;
  onToggle: (id: string, text: string, lang: TtsLang) => void;
}>) {
  const isThis = playingId === id && isAnyPlaying;
  const flag = lang === "de" ? "🇩🇪" : "🇦🇫";
  return (
    <button
      type="button"
      onClick={() => onToggle(id, text, lang)}
      title={isThis ? "Stopp" : lang === "de" ? "Vorlesen" : "پخش فارسی"}
      className={cn(
        "shrink-0 rounded border px-2 py-0.5 text-xs font-medium transition-colors",
        isThis
          ? "border-exam/40 bg-exam/20 text-exam"
          : "border-slate-600 bg-slate-800 text-slate-400 hover:text-slate-200",
      )}
    >
      {isThis ? "⏸" : "▶"} {flag}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MepSimulationPage() {
  const [tab, setTab] = useState<TabId>("info");
  const [offeneKarte, setOffeneKarte] = useState<string | null>(null);
  const { isPlaying, play, stop } = useAzureTTS();
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlaying) setPlayingId(null);
  }, [isPlaying]);

  const handleToggle = useCallback(
    async (id: string, text: string, lang: TtsLang): Promise<void> => {
      if (playingId === id) {
        stop();
        setPlayingId(null);
        return;
      }
      stop();
      setPlayingId(id);
      await play(text, { lang, rate: 0.9, pitch: 1 });
      setPlayingId(null);
    },
    [playingId, play, stop],
  );

  const TABS: { id: TabId; label: string }[] = [
    { id: "info", label: "Überblick" },
    { id: "lernkarten", label: "Lernkarten (21)" },
    { id: "tipps", label: "10 Schlüsselantworten" },
  ];

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Link to="/tutor/ergaenzungspruefung" className="hover:text-slate-300 transition-colors">
            Ergänzungsprüfung
          </Link>
          <span>/</span>
          <span>MEP-Simulation</span>
        </div>
        <h1 className="text-3xl font-bold text-exam">MEP-Simulation</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Algorithmen & Datenstrukturen · 21 zweisprachige Lernkarten · Quellen: fachinformatiker.de, ap2-fiae.de
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg border border-slate-700/60 bg-slate-900/40 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-exam/20 text-exam border border-exam/40"
                : "text-muted-foreground hover:text-slate-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Überblick ──────────────────────────────────────────────────── */}
      {tab === "info" && (
        <div className="space-y-5">
          {/* MEP-Format */}
          <div className="rounded-md border border-exam/30 bg-exam/10 p-4 space-y-2">
            <h2 className="text-lg font-semibold text-exam">MEP-Format</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Dauer</div>
                <div className="font-medium">15 Minuten</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Gewichtung</div>
                <div className="font-medium">(schriftlich × 2 + MEP × 1) ÷ 3</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Bereich</div>
                <div className="font-medium">Entwicklung und Umsetzung von Algorithmen (EUA)</div>
              </div>
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">Struktogramme</div>
                <div className="font-medium text-rose-400">Abgeschafft ab 2025!</div>
              </div>
            </div>
          </div>

          {/* Statistik */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Themenstatistik (12 Prüfungen, Stand April 2026)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Thema</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Häufigkeit</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Priorität</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {[
                    ["Pseudocode / Algorithmus formulieren", "100 %", "🔴 Essentiell"],
                    ["Kontrollstrukturen (Sequenz, Verzweigung, Schleife)", "80–99 %", "🔴 Essentiell"],
                    ["UML-Aktivitätsdiagramm", "92 %", "🔴 Essentiell"],
                    ["OOP-Konzepte (4 Säulen)", "92 %", "🔴 Essentiell"],
                    ["Klassendiagramm / statische OO-Sicht", "83 %", "🟠 Sehr hoch"],
                    ["Sortieralgorithmen (Bubble Sort)", "sehr häufig", "🟠 Sehr hoch"],
                    ["Min/Max-Suche, Durchschnitt", "sehr häufig", "🟠 Sehr hoch"],
                    ["Suchalgorithmen (linear / binär)", "häufig", "🟠 Sehr hoch"],
                    ["Laufzeitanalyse (O-Notation)", "gelegentlich", "🟡 Möglich"],
                    ["Rekursion", "gelegentlich", "🟡 Möglich"],
                  ].map(([thema, haeuf, prior]) => (
                    <tr key={thema}>
                      <td className="py-2 pr-4">{thema}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{haeuf}</td>
                      <td className="py-2">{prior}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fragetypen */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Typische Fragetypen in der MEP</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Typ</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Beispiel</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Tipp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {[
                    ["Erklären", "Was ist Bubble Sort?", "2–3 Sätze Prinzip + Beispiel"],
                    ["Durchführen", "Sortieren Sie [3,1,4] mit Bubble Sort", "Ruhig, schrittweise, laut erklären"],
                    ["Schreiben", "Pseudocode für Max-Suche", "IHK-Syntax, Kommentare helfen"],
                    ["Fehler finden", "Was ist falsch in diesem Code?", "Schleifengrenzen, Off-by-One prüfen"],
                    ["Vergleichen", "Lineare vs. Binäre Suche", "Voraussetzung + Laufzeit + Einsatz"],
                    ["Bewerten", "Welcher Algorithmus für 1 Mio Elemente?", "Binäre Suche O(log n) — aber nur wenn sortiert!"],
                  ].map(([typ, bsp, tipp]) => (
                    <tr key={typ}>
                      <td className="py-2 pr-4 font-medium text-exam">{typ}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{bsp}</td>
                      <td className="py-2">{tipp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Krankenhaus-Szenario */}
          <div className="rounded-md border border-slate-700/60 bg-slate-900/40 p-4 space-y-2">
            <h2 className="text-lg font-semibold">Typisches Prüfungsformat (EUA)</h2>
            <p className="text-sm text-muted-foreground">
              Basierend auf dem rekonstruierten Szenario der Sommer-2025-Prüfung (Krankenhaus-Aufgabe, fachinformatiker.de):
            </p>
            <ol className="space-y-1 text-sm list-decimal list-inside">
              <li>Ein Szenario/Anhang beschreibt Klassen, Attribute, Methoden</li>
              <li>Du sollst Pseudocode für eine bestimmte Funktion schreiben</li>
              <li>Die Funktion nutzt Arrays, Schleifen, Bedingungen</li>
              <li>Optional: Min/Max, Durchschnitt, Schwellenwert</li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Die Sommer-2026-Prüfung (29.04.2026) galt laut Forum als anspruchsvoll, aber fair — Transferdenken war gefragt.
            </p>
          </div>
        </div>
      )}

      {/* ─── Lernkarten ─────────────────────────────────────────────────── */}
      {tab === "lernkarten" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Klicke eine Karte auf zum Aufklappen. 🇩🇪 = Antwort vorlesen · 🇦🇫 = فارسی پخش کن
          </p>
          {MEP_KARTEN.map((karte, idx) => {
            const istOffen = offeneKarte === karte.id;
            const deId = `${karte.id}-de`;
            const faId = `${karte.id}-fa`;
            return (
              <div key={karte.id} className="rounded-md border border-slate-700/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOffeneKarte(istOffen ? null : karte.id)}
                  className="w-full text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors"
                >
                  <span className="text-sm font-medium">
                    <span className="mr-2 font-mono text-xs text-exam/70">{idx + 1}.</span>
                    <span className="text-xs text-exam/60 mr-2">[{karte.thema}]</span>
                    {karte.frage}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs mt-0.5">{istOffen ? "▲" : "▼"}</span>
                </button>
                {istOffen && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-700/40 space-y-3">
                    {/* German answer */}
                    <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-sky-400">Antwort (Deutsch)</span>
                        <TtsBtn
                          id={deId}
                          text={karte.antwortDe}
                          lang="de"
                          playingId={playingId}
                          isAnyPlaying={isPlaying}
                          onToggle={handleToggle}
                        />
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-line">{karte.antwortDe}</p>
                    </div>
                    {/* Persian explanation */}
                    <div className="rounded-md border border-exam/30 bg-exam/5 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-exam">توضیح فارسی</span>
                        <TtsBtn
                          id={faId}
                          text={karte.erklaerungFa}
                          lang="fa"
                          playingId={playingId}
                          isAnyPlaying={isPlaying}
                          onToggle={handleToggle}
                        />
                      </div>
                      <p dir="rtl" className="font-fa text-sm leading-relaxed whitespace-pre-line text-right">
                        {karte.erklaerungFa}
                      </p>
                    </div>
                    {/* Tip */}
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                      <span className="text-xs font-medium text-emerald-400">Prüfungstipp: </span>
                      <span className="text-xs text-muted-foreground">{karte.tipp}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── 10 Schlüsselantworten ──────────────────────────────────────── */}
      {tab === "tipps" && (
        <div className="space-y-4">
          <div className="rounded-md border border-exam/30 bg-exam/10 p-4">
            <p className="text-sm font-medium text-exam">
              Diese 10 Antworten solltest du auswendig kennen — sie kommen in fast jeder MEP.
            </p>
          </div>
          {SCHLUESSEL_ANTWORTEN.map((item) => (
            <div key={item.nr} className="rounded-md border border-slate-700/60 p-4 space-y-2">
              <div className="flex items-start gap-3">
                <span className="shrink-0 rounded-full bg-exam/20 border border-exam/40 text-exam font-bold text-xs w-7 h-7 flex items-center justify-center">
                  {item.nr}
                </span>
                <div className="space-y-1.5">
                  <p className="font-medium text-sm">{item.frage}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.antwort}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Standard-Satz */}
          <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-sky-300">Standard-Satz zum Auswendiglernen</h3>
            <p className="text-sm leading-relaxed">
              „Ich initialisiere die Variable mit dem ersten Wert des Arrays. Danach durchlaufe ich alle Elemente mit
              einer Schleife. Bei jedem Element prüfe ich die Bedingung. Wenn die Bedingung erfüllt ist, aktualisiere
              ich die Variable. Am Ende enthält die Variable das gesuchte Ergebnis."
            </p>
            <p className="text-xs text-muted-foreground">
              Dieser Satz passt auf Maximum, Minimum, Durchschnitt und viele andere Array-Algorithmen.
            </p>
          </div>

          {/* Pseudocode-Syntax */}
          <div className="rounded-md border border-slate-700/60 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">IHK-Pseudocode Syntax (ab 2025)</h3>
            <pre className="text-xs bg-slate-950 rounded-md p-3 overflow-x-auto leading-relaxed text-slate-300">
              {`FUNKTION findMax(zahlen : Integer[]) : Integer
    max = zahlen[0]
    FUER i VON 1 BIS laenge(zahlen) - 1 MIT SCHRITTWEITE 1
        WENN zahlen[i] > max DANN
            max = zahlen[i]
        ENDE WENN
    NAECHSTES i
    RÜCKGABE max
ENDE FUNKTION`}
            </pre>
            <p className="text-xs text-muted-foreground">
              Syntaxfehler werden toleriert, solange die Logik korrekt ist.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
