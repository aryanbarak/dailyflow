import { supabase } from "@/integrations/supabase/client";
import { createId } from "@/lib/id";
import { safeGet, safeSet, safeRemove, storageKey } from "@/lib/storage";

export interface CalendarEvent {
  id: string;
  title: string;
  dateTimeStart: string;   // ISO UTC string — e.g. "2026-05-23T12:30:00.000Z"
  dateTimeEnd?: string;    // ISO UTC string
  location?: string;
  notes?: string;
  color?: string;
  type?: string;
  allDay?: boolean;
  // CORE-W5 (2026-09-06, CORE audit item 1-4): a real RFC 5545 RRULE
  // property list (see src/features/scheduling/occurrences.ts). Was
  // previously accepted by CalendarFormDialog but silently dropped before
  // ever reaching this service -- now threaded through Supabase AND the
  // localStorage fallback path below.
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

const EVENTS_KEY = storageKey("events");

// Shape of a row returned from Supabase
type DbRow = {
  id: string;
  user_id: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  color: string | null;
  type: string | null;
  all_day: boolean;
  recurrence_rule: string | null;
  recurrence_end_date: string | null;
  created_at: string;
  updated_at: string;
};

function dbRowToEvent(row: DbRow): CalendarEvent {
  const st = row.start_time ?? "00:00";
  return {
    id: row.id,
    title: row.title,
    dateTimeStart: `${row.date}T${st}:00.000Z`,
    dateTimeEnd: row.end_time ? `${row.date}T${row.end_time}:00.000Z` : undefined,
    location: row.location ?? undefined,
    notes: row.description ?? undefined,
    color: row.color ?? undefined,
    type: row.type ?? undefined,
    allDay: row.all_day,
    recurrenceRule: row.recurrence_rule,
    recurrenceEndDate: row.recurrence_end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type EventInput = Omit<CalendarEvent, "id" | "createdAt" | "updatedAt">;

function toInsertRow(userId: string, input: EventInput) {
  return {
    user_id: userId,
    title: input.title.trim(),
    date: input.dateTimeStart.slice(0, 10),
    start_time: input.dateTimeStart.slice(11, 16),
    end_time: input.dateTimeEnd ? input.dateTimeEnd.slice(11, 16) : null,
    location: input.location?.trim() || null,
    description: input.notes?.trim() || null,
    color: input.color || null,
    type: input.type || null,
    all_day: input.allDay ?? false,
    recurrence_rule: input.recurrenceRule ?? null,
    recurrence_end_date: input.recurrenceEndDate ?? null,
  };
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function readLocal(): CalendarEvent[] {
  return safeGet<CalendarEvent[]>(EVENTS_KEY, []);
}

function localFallbackRange(events: CalendarEvent[], start?: Date, end?: Date): CalendarEvent[] {
  if (!start || !end) return events;
  const s = start.getTime();
  const e = end.getTime();
  return events.filter((ev) => {
    const t = new Date(ev.dateTimeStart).getTime();
    return t >= s && t <= e;
  });
}

function buildDbUpdates(updates: Partial<Omit<CalendarEvent, "id" | "createdAt">>) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) row.title = updates.title.trim();
  if (updates.dateTimeStart !== undefined) {
    row.date = updates.dateTimeStart.slice(0, 10);
    row.start_time = updates.dateTimeStart.slice(11, 16);
  }
  if ("dateTimeEnd" in updates) {
    row.end_time = updates.dateTimeEnd ? updates.dateTimeEnd.slice(11, 16) : null;
  }
  if ("location" in updates) row.location = updates.location?.trim() || null;
  if ("notes" in updates) row.description = updates.notes?.trim() || null;
  if ("color" in updates) row.color = updates.color ?? null;
  if ("type" in updates) row.type = updates.type ?? null;
  if ("allDay" in updates) row.all_day = updates.allDay ?? false;
  if ("recurrenceRule" in updates) row.recurrence_rule = updates.recurrenceRule ?? null;
  if ("recurrenceEndDate" in updates) row.recurrence_end_date = updates.recurrenceEndDate ?? null;
  return row;
}

function updateLocal(
  id: string,
  updates: Partial<Omit<CalendarEvent, "id" | "createdAt">>,
): CalendarEvent | null {
  const events = readLocal();
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const base = events[idx];
  const updated: CalendarEvent = {
    ...base,
    ...updates,
    title: updates.title ? updates.title.trim() : base.title,
    location: "location" in updates ? updates.location?.trim() || undefined : base.location,
    notes: "notes" in updates ? updates.notes?.trim() || undefined : base.notes,
    updatedAt: new Date().toISOString(),
  };
  events[idx] = updated;
  safeSet(EVENTS_KEY, events);
  return updated;
}

export const calendarService = {
  async getAll(): Promise<CalendarEvent[]> {
    const userId = await currentUserId();
    if (!userId) return readLocal();
    try {
      const { data, error } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", userId)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true, nullsFirst: true });
      if (error) throw error;
      const seen = new Set<string>();
      return (data as DbRow[])
        .map(dbRowToEvent)
        .filter((e) => {
          const key = `${e.title}|${e.dateTimeStart}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    } catch {
      return readLocal();
    }
  },

  async getRange(start?: Date, end?: Date): Promise<CalendarEvent[]> {
    const userId = await currentUserId();
    if (!userId) return localFallbackRange(readLocal(), start, end);
    try {
      let query = supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", userId);
      if (start && end) {
        query = query
          .gte("date", start.toISOString().slice(0, 10))
          .lte("date", end.toISOString().slice(0, 10));
      }
      const { data, error } = await query
        .order("date", { ascending: true })
        .order("start_time", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data as DbRow[]).map(dbRowToEvent);
    } catch {
      return localFallbackRange(readLocal(), start, end);
    }
  },

  async create(input: EventInput): Promise<CalendarEvent> {
    const userId = await currentUserId();
    if (userId) {
      try {
        const { data, error } = await supabase
          .from("calendar_events")
          .insert(toInsertRow(userId, input))
          .select()
          .single();
        if (error) throw error;
        return dbRowToEvent(data as DbRow);
      } catch {
        // fall through to localStorage
      }
    }
    const now = new Date().toISOString();
    const event: CalendarEvent = {
      id: createId(),
      title: input.title.trim(),
      dateTimeStart: input.dateTimeStart,
      dateTimeEnd: input.dateTimeEnd,
      location: input.location?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      color: input.color,
      type: input.type,
      allDay: input.allDay,
      recurrenceRule: input.recurrenceRule ?? null,
      recurrenceEndDate: input.recurrenceEndDate ?? null,
      createdAt: now,
      updatedAt: now,
    };
    safeSet(EVENTS_KEY, [event, ...readLocal()]);
    return event;
  },

  async update(
    id: string,
    updates: Partial<Omit<CalendarEvent, "id" | "createdAt">>,
  ): Promise<CalendarEvent | null> {
    try {
      const { data, error } = await supabase
        .from("calendar_events")
        .update(buildDbUpdates(updates))
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return dbRowToEvent(data as DbRow);
    } catch {
      return updateLocal(id, updates);
    }
  },

  async remove(id: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return true;
    } catch {
      const events = readLocal();
      const next = events.filter((e) => e.id !== id);
      if (next.length === events.length) return false;
      safeSet(EVENTS_KEY, next);
      return true;
    }
  },
};

// Called once on first authenticated load to move localStorage events into Supabase.
// Clears localStorage only on success — safe to retry if it fails.
export async function migrateLocalStorageEvents(userId: string): Promise<void> {
  const events = readLocal();
  if (events.length === 0) return;
  const rows = events.map((e) => ({
    user_id: userId,
    title: e.title.trim(),
    date: e.dateTimeStart.slice(0, 10),
    start_time: e.dateTimeStart.slice(11, 16),
    end_time: e.dateTimeEnd ? e.dateTimeEnd.slice(11, 16) : null,
    location: e.location?.trim() || null,
    description: e.notes?.trim() || null,
    color: e.color || null,
    type: e.type || null,
    all_day: e.allDay ?? false,
    recurrence_rule: e.recurrenceRule ?? null,
    recurrence_end_date: e.recurrenceEndDate ?? null,
  }));
  // Mark migrated before insert so repeated Supabase failures can't create duplicates.
  // If insert fails, the localStorage data is still intact and readable as fallback.
  safeRemove(EVENTS_KEY);
  const { error } = await supabase.from("calendar_events").insert(rows);
  if (error) throw error;
}

function parseLocalDate(date: string) {
  const [yearStr, monthStr, dayStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) throw new Error("Invalid date");
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export async function createCalendarEventFromFamily(input: {
  title: string;
  date: string;
  childName: string;
}): Promise<{ id: string }> {
  const dateTimeStart = parseLocalDate(input.date).toISOString();
  const event = await calendarService.create({
    title: `${input.childName} - ${input.title}`,
    dateTimeStart,
  });
  return { id: event.id };
}

export async function deleteCalendarEventById(id: string): Promise<void> {
  await calendarService.remove(id);
}
