const WEEKDAY: Record<string, number> = {
  sunday: 0, sun: 0, sonntag: 0,
  monday: 1, mon: 1, montag: 1,
  tuesday: 2, tue: 2, dienstag: 2,
  wednesday: 3, wed: 3, mittwoch: 3,
  thursday: 4, thu: 4, donnerstag: 4,
  friday: 5, fri: 5, freitag: 5,
  saturday: 6, sat: 6, samstag: 6,
};

const PERSIAN_WEEKDAY: Array<[RegExp, number]> = [
  [/\u06cc\u06a9\u0634\u0646\u0628\u0647/, 0],
  [/\u062f\u0648\u0634\u0646\u0628\u0647/, 1],
  [/\u0633\u0647[\u200c\s-]?\u0634\u0646\u0628\u0647/, 2],
  [/\u0686\u0647\u0627\u0631\u0634\u0646\u0628\u0647/, 3],
  [/\u067e\u0646\u062c\u0634\u0646\u0628\u0647/, 4],
  [/\u062c\u0645\u0639\u0647/, 5],
  [/\u0634\u0646\u0628\u0647/, 6],
];

function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeDigits(value: string) {
  return value
    .replace(/[\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, ch => String(ch.charCodeAt(0) - 0x0660));
}

export function parseDeterministicDueDate(
  message: string,
  now: Date,
  timeZone: string,
): { value?: string | null; clarificationNeeded: boolean } {
  const text = normalizeDigits(message.toLowerCase());
  if (/\b(no due date|without due date|kein(?:e[nr]?)? termin)\b|\u0628\u062f\u0648\u0646\s+(?:\u0645\u0648\u0639\u062f|\u062a\u0627\u0631\u06cc\u062e)/i.test(text)) {
    return { value: null, clarificationNeeded: false };
  }
  if (text.includes("day after tomorrow") || text.includes("uebermorgen") || text.includes("\u00fcbermorgen") || /\u067e\u0633(?:\u200c|\s)?\u0641\u0631\u062f\u0627/.test(text)) {
    return { value: dateKey(addDays(now, 2), timeZone), clarificationNeeded: false };
  }
  if (/\b(today|heute)\b|\u0627\u0645\u0631\u0648\u0632/.test(text)) return { value: dateKey(now, timeZone), clarificationNeeded: false };
  if (/\b(tomorrow|morgen)\b|\u0641\u0631\u062f\u0627/.test(text)) return { value: dateKey(addDays(now, 1), timeZone), clarificationNeeded: false };

  const inDays = text.match(/\bin\s+([1-9][0-9]?)\s+days?\b|\bin\s+([1-9][0-9]?)\s+tagen?\b|(?:\u062a\u0627|\u062f\u0631)\s+([0-9]{1,2})\s+\u0631\u0648\u0632/);
  if (inDays) {
    const raw = inDays[1] ?? inDays[2] ?? inDays[3];
    return { value: dateKey(addDays(now, Number(raw)), timeZone), clarificationNeeded: false };
  }

  const iso = text.match(/\b(20[0-9]{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12][0-9]|3[01])\b/);
  if (iso) return { value: `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`, clarificationNeeded: false };

  const weekdayKey = Object.keys(WEEKDAY).find(key => new RegExp(`\\b${key}\\b`, "i").test(text));
  const persianWeekday = PERSIAN_WEEKDAY.find(([pattern]) => pattern.test(text));
  const target = weekdayKey ? WEEKDAY[weekdayKey] : persianWeekday?.[1];
  if (target !== undefined) {
    const delta = ((target - now.getUTCDay() + 7) % 7) || 7;
    return { value: dateKey(addDays(now, delta), timeZone), clarificationNeeded: false };
  }

  if (/\b(due|deadline|f\u00e4llig)\b|\u0645\u0648\u0639\u062f|\u062a\u0627\u0631\u06cc\u062e/i.test(text)) return { clarificationNeeded: true };
  return { clarificationNeeded: false };
}

// Task 22-fix (C1): ports of agent/worker/flow-write-policy.ts's own
// parseDeterministicTimeOfDay/parseDeterministicTimeRange/
// zonedDateTimeToUtcIso -- the Worker and this frontend bundle are two
// independently-deployed builds with no shared runtime (see this file's own
// existing parseDeterministicDueDate above, already duplicated the same
// way), so this is a deliberate, hand-synced port, not an import. Exists so
// intentValidator.ts can resolve a calendar event's start/end the same
// deterministic way the Worker's auto-write path already does, instead of
// trusting the model's own start/end fields (see intentValidator.ts's
// calendar target-override block for why).
export function parseDeterministicTimeOfDay(message: string): string | undefined {
  const text = normalizeDigits(message.toLowerCase());
  const persian = text.match(/\u0633\u0627\u0639\u062a\s+([01]?[0-9]|2[0-3])(?::([0-5][0-9]))?\s*(\u0635\u0628\u062d|\u0639\u0635\u0631|\u0628\u0639\u062f\s+\u0627\u0632\s+\u0638\u0647\u0631|\u0634\u0628)?/);
  const latin = text.match(/\b(?:at|um)\s+([01]?[0-9]|2[0-3])(?::([0-5][0-9]))?\s*(am|pm|uhr)?\b/);
  const compact = text.match(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/);
  const match = persian ?? latin ?? compact;
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const suffix = match[3];
  if ((suffix === "pm" || suffix === "\u0639\u0635\u0631" || suffix === "\u0628\u0639\u062f \u0627\u0632 \u0638\u0647\u0631" || suffix === "\u0634\u0628") && hour < 12) hour += 12;
  if ((suffix === "am" || suffix === "\u0635\u0628\u062d") && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const RANGE_CONNECTOR = /\bto\b|\buntil\b|\btill\b|\bbis\b|\u062a\u0627/i;

export function parseDeterministicTimeRange(message: string): { start?: string; end?: string } {
  const start = parseDeterministicTimeOfDay(message);
  if (!start) return {};
  const connectorIndex = message.search(RANGE_CONNECTOR);
  if (connectorIndex === -1) return { start };
  const tail = message.slice(connectorIndex).replace(RANGE_CONNECTOR, " ");
  const end = parseDeterministicTimeOfDay(tail) ?? parseDeterministicTimeOfDay(`at ${tail}`);
  return end && end !== start ? { start, end } : { start };
}

export function zonedDateTimeToUtcIso(dateKeyValue: string, timeOfDay: string, timeZone: string): string {
  const [year, month, day] = dateKeyValue.split("-").map(Number);
  const [hour, minute] = timeOfDay.split(":").map(Number);
  const desiredUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(desiredUtcMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const actualAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second ?? "0"),
  );
  return new Date(desiredUtcMs - (actualAsUtcMs - desiredUtcMs)).toISOString();
}
