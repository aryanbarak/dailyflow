import { createId } from "@/lib/id";
import { safeGet, safeSet, storageKey } from "@/lib/storage";

export interface CalendarEvent {
  id: string;
  title: string;
  dateTimeStart: string;
  dateTimeEnd?: string;
  location?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

const EVENTS_KEY = storageKey("events");

function readAll(): CalendarEvent[] {
  return safeGet<CalendarEvent[]>(EVENTS_KEY, []);
}

function writeAll(events: CalendarEvent[]) {
  safeSet(EVENTS_KEY, events);
}

export const calendarService = {
  getAll() {
    return readAll();
  },
  create(input: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const event: CalendarEvent = {
      id: createId(),
      title: input.title.trim(),
      dateTimeStart: input.dateTimeStart,
      dateTimeEnd: input.dateTimeEnd || undefined,
      location: input.location?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const events = [event, ...readAll()];
    writeAll(events);
    return event;
  },
  update(id: string, updates: Partial<Omit<CalendarEvent, "id" | "createdAt">>) {
    const events = readAll();
    const index = events.findIndex((event) => event.id === id);
    if (index === -1) return null;
    const updated: CalendarEvent = {
      ...events[index],
      ...updates,
      title: updates.title ? updates.title.trim() : events[index].title,
      location: updates.location !== undefined ? updates.location.trim() || undefined : events[index].location,
      notes: updates.notes !== undefined ? updates.notes.trim() || undefined : events[index].notes,
      updatedAt: new Date().toISOString(),
    };
    events[index] = updated;
    writeAll(events);
    return updated;
  },
  remove(id: string) {
    const events = readAll();
    const next = events.filter((event) => event.id !== id);
    if (next.length === events.length) return false;
    writeAll(next);
    return true;
  },
};
