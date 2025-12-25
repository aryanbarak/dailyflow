import { useCallback, useEffect, useState } from "react";
import { CalendarEvent, calendarService } from "@/features/calendar/calendarService";

export function useEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(() => {
    setEvents(calendarService.getAll());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addEvent = useCallback((input: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt">) => {
    const created = calendarService.create(input);
    setEvents((prev) => [created, ...prev]);
    return created;
  }, []);

  const updateEvent = useCallback((id: string, updates: Partial<Omit<CalendarEvent, "id" | "createdAt">>) => {
    const updated = calendarService.update(id, updates);
    if (!updated) return null;
    setEvents((prev) => prev.map((event) => (event.id === id ? updated : event)));
    return updated;
  }, []);

  const removeEvent = useCallback((id: string) => {
    const removed = calendarService.remove(id);
    if (removed) {
      setEvents((prev) => prev.filter((event) => event.id !== id));
    }
    return removed;
  }, []);

  return {
    events,
    isLoading,
    refresh,
    addEvent,
    updateEvent,
    removeEvent,
  };
}
