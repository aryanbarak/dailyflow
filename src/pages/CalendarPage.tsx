import { useEffect, useMemo, useRef, useState } from "react";
import { IconTile } from "@/components/common/IconTile";
import { motion } from "framer-motion";
import { Plus, Calendar as CalendarIcon, CalendarDays, CheckSquare, Layers, ArrowUpRight, MapPin, Pencil, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatePanel } from "@/components/common/StatePanel";
import { SkeletonBlock, SkeletonListItem } from "@/components/common/Skeletons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarEvent, calendarService } from "@/features/calendar/calendarService";
import { CalendarFormDialog } from "@/features/calendar/CalendarFormDialog";
import { loadCalendarUiState, saveCalendarUiState } from "@/features/calendar/calendarUiState";
import { AlarmPicker } from "@/features/calendar/components/AlarmPicker";
import { getTasksAsEvents, type TaskAsEvent } from "@/features/tasks/taskCalendarBridge";
import { useTasks } from "@/hooks/useTasks";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDateTime, toDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";
import { SmartflowAsciiVisual } from "@/components/smartflow";
import { StatCard } from "@/components/common/StatCard";
import { AiSuggestionsCard } from "@/components/common/AiSuggestionsCard";
import { CollapsibleRail } from "@/components/common/CollapsibleRail";
import { useAiSuggestions } from "@/features/ai/useAiSuggestions";
import { localeFor, useT, type TranslationKey } from "@/i18n";

type EventFilter = "all" | "today" | "week";

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function formatDayKey(value: Date) {
  return toDateOnly(value);
}

function startOfWeekMonday(value: Date) {
  const date = startOfDay(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function startOfMonth(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addMonths(value: Date, amount: number) {
  const date = new Date(value);
  date.setMonth(date.getMonth() + amount);
  return date;
}

function parseDayKeyLocal(dayKey: string) {
  const [yearStr, monthStr, dayStr] = dayKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return new Date(NaN);
  return new Date(year, month - 1, day);
}

function isSameDay(a: Date, b: Date) {
  return toDateOnly(a) === toDateOnly(b);
}

function formatTime(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getEventWindow(event: CalendarEvent) {
  const start = event.dateTimeStart ? new Date(event.dateTimeStart) : null;
  const end = event.dateTimeEnd ? new Date(event.dateTimeEnd) : null;
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
  };
}

function getEventState(now: Date, start: Date | null, end: Date | null) {
  if (!start) return "future" as const;
  const nowMs = now.getTime();
  const startMs = start.getTime();
  if (end) {
    const endMs = end.getTime();
    if (endMs < nowMs) return "past" as const;
    if (startMs <= nowMs && endMs >= nowMs) return "current" as const;
  } else if (startMs < nowMs) {
    return "past" as const;
  }
  if (startMs >= nowMs && startMs - nowMs <= 24 * 60 * 60 * 1000) {
    return "upcoming" as const;
  }
  return "future" as const;
}

// DESIGN-AUDIT 1 (Calendar): category dots from the semantic flow tokens.
const CATEGORY_COLORS: Record<string, string> = {
  personal: 'bg-[var(--flow-review)]',
  work: 'bg-[var(--flow-analyze)]',
  study: 'bg-[var(--flow-study)]',
  family: 'bg-[var(--flow-plan)]',
  health: 'bg-[var(--flow-career)]',
};

const CATEGORY_LABELS: Record<string, string> = {
  personal: 'Personal',
  work: 'Work',
  family: 'Family',
  health: 'Health',
};

// I18N-SWEEP-1: category display names come from the shared common keys.
const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  personal: 'category_personal',
  work: 'category_work',
  family: 'category_family',
  health: 'category_health',
};

function getCategoryDotColor(event: CalendarEvent): string {
  if (event.type && CATEGORY_COLORS[event.type]) return CATEGORY_COLORS[event.type];
  if (event.color) return '';
  return 'bg-primary';
}

export default function CalendarPage() {
  const { t, lang } = useT();
  const locale = localeFor(lang);
  const queryClient = useQueryClient();
  const renderCount = useRef(0);
  renderCount.current += 1;
  if (import.meta.env.DEV) {
    // DEV diagnostics to track render churn.
    console.debug("[calendar] render", renderCount.current);
  }
  const initialUiState = useMemo(() => {
    const anchor = new Date();
    return loadCalendarUiState({
      activeTab: "week",
      viewAnchorDate: toDateOnly(anchor),
      selectedDay: null,
      searchQuery: "",
      hasLocationOnly: false,
      hasNotesOnly: false,
    });
  }, []);
  const [filter, setFilter] = useState<EventFilter>(initialUiState.activeTab);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialUiState.searchQuery);
  const [hasLocationOnly, setHasLocationOnly] = useState(initialUiState.hasLocationOnly);
  const [hasNotesOnly, setHasNotesOnly] = useState(initialUiState.hasNotesOnly);
  const [pendingScrollDay, setPendingScrollDay] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(initialUiState.selectedDay);
  const [viewAnchorDate, setViewAnchorDate] = useState<Date>(
    () => parseDayKeyLocal(initialUiState.viewAnchorDate),
  );
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => startOfWeekMonday(viewAnchorDate), [viewAnchorDate]);
  const weekEnd = useMemo(() => endOfDay(addDays(weekStart, 6)), [weekStart]);
  const rangeStart = useMemo(() => {
    if (filter === "today") return startOfDay(today);
    if (filter === "week") return weekStart;
    return null;
  }, [filter, today, weekStart]);
  const rangeEnd = useMemo(() => {
    if (filter === "today") return endOfDay(today);
    if (filter === "week") return weekEnd;
    return null;
  }, [filter, today, weekEnd]);
  const visibleMonthStart = useMemo(() => startOfMonth(viewAnchorDate), [viewAnchorDate]);
  const gridStart = useMemo(() => startOfWeekMonday(visibleMonthStart), [visibleMonthStart]);
  const gridEnd = useMemo(() => endOfDay(addDays(gridStart, 41)), [gridStart]);
  const monthWindowStart = useMemo(() => addDays(gridStart, -7), [gridStart]);
  const monthWindowEnd = useMemo(() => endOfDay(addDays(gridEnd, 7)), [gridEnd]);
  const tabQueryKey = useMemo(
    () => ["calendarEvents", filter, rangeStart?.toISOString(), rangeEnd?.toISOString()],
    [filter, rangeEnd, rangeStart],
  );
  const monthQueryKey = useMemo(
    () => ["calendarMonthEvents", monthWindowStart.toISOString(), monthWindowEnd.toISOString()],
    [monthWindowEnd, monthWindowStart],
  );

  const { data: rangeEvents = [], isLoading, error: rangeError } = useQuery({
    queryKey: tabQueryKey,
    queryFn: async () => {
      const started = performance.now();
      const result = filter === "all" || !rangeStart || !rangeEnd
        ? calendarService.getAll()
        : calendarService.getRange(rangeStart, rangeEnd);
      if (import.meta.env.DEV) {
        console.groupCollapsed("Calendar fetch");
        console.log("filter", filter);
        console.log("rangeStart", rangeStart?.toISOString() ?? "all");
        console.log("rangeEnd", rangeEnd?.toISOString() ?? "all");
        console.log("events", result.length);
        console.log("ms", (performance.now() - started).toFixed(1));
        console.groupEnd();
      }
      return result;
    },
    staleTime: 60_000,
  });

  const { data: monthEvents = [], error: monthError } = useQuery({
    queryKey: monthQueryKey,
    queryFn: async () => {
      const started = performance.now();
      const result = calendarService.getRange(monthWindowStart, monthWindowEnd);
      if (import.meta.env.DEV) {
        console.groupCollapsed("Calendar fetch (month)");
        console.log("visibleMonth", visibleMonthStart.toISOString());
        console.log("gridStart", gridStart.toISOString());
        console.log("gridEnd", gridEnd.toISOString());
        console.log("monthWindowStart", monthWindowStart.toISOString());
        console.log("monthWindowEnd", monthWindowEnd.toISOString());
        console.log("events", result.length);
        console.log("ms", (performance.now() - started).toFixed(1));
        console.groupEnd();
      }
      return result;
    },
    staleTime: 60_000,
  });

  const { data: taskEvents = [] } = useQuery<TaskAsEvent[]>({
    queryKey: ["taskEvents", monthWindowStart.toISOString(), monthWindowEnd.toISOString()],
    queryFn: () => getTasksAsEvents(
      monthWindowStart.toISOString().slice(0, 10),
      monthWindowEnd.toISOString().slice(0, 10),
    ),
    staleTime: 60_000,
  });

  const tasksByDay = useMemo(() => {
    return taskEvents.reduce<Record<string, TaskAsEvent[]>>((acc, task) => {
      acc[task.date] = acc[task.date] ? [...acc[task.date], task] : [task];
      return acc;
    }, {});
  }, [taskEvents]);

  const sortedRangeEvents = useMemo(() => {
    return [...rangeEvents].sort(
      (a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime(),
    );
  }, [rangeEvents]);

  const sortedMonthEvents = useMemo(() => {
    return [...monthEvents].sort(
      (a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime(),
    );
  }, [monthEvents]);

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sortedRangeEvents.filter((event) => {
      if (hasLocationOnly && !event.location?.trim()) return false;
      if (hasNotesOnly && !event.notes?.trim()) return false;
      if (!query) return true;
      const haystack = [
        event.title,
        event.location ?? "",
        event.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [hasLocationOnly, hasNotesOnly, searchQuery, sortedRangeEvents]);

  const filteredMonthEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sortedMonthEvents.filter((event) => {
      if (hasLocationOnly && !event.location?.trim()) return false;
      if (hasNotesOnly && !event.notes?.trim()) return false;
      if (!query) return true;
      const haystack = [
        event.title,
        event.location ?? "",
        event.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [hasLocationOnly, hasNotesOnly, searchQuery, sortedMonthEvents]);

  const eventsByDay = useMemo(() => {
    return filteredEvents.reduce<Record<string, CalendarEvent[]>>((acc, event) => {
      const key = toDateOnly(event.dateTimeStart);
      acc[key] = acc[key] ? [...acc[key], event] : [event];
      return acc;
    }, {});
  }, [filteredEvents]);

  const monthEventsByDay = useMemo(() => {
    return filteredMonthEvents.reduce<Record<string, CalendarEvent[]>>((acc, event) => {
      const key = toDateOnly(event.dateTimeStart);
      acc[key] = acc[key] ? [...acc[key], event] : [event];
      return acc;
    }, {});
  }, [filteredMonthEvents]);

  const monthEventStats = useMemo(() => {
    if (monthEvents.length === 0) {
      return { count: 0, minStart: null as string | null, maxStart: null as string | null };
    }
    let minStart = monthEvents[0].dateTimeStart;
    let maxStart = monthEvents[0].dateTimeStart;
    monthEvents.forEach((event) => {
      if (event.dateTimeStart < minStart) minStart = event.dateTimeStart;
      if (event.dateTimeStart > maxStart) maxStart = event.dateTimeStart;
    });
    return { count: monthEvents.length, minStart, maxStart };
  }, [monthEvents]);

  const calendarKpi = useMemo(() => {
    const todayKey = toDateOnly(today);
    const nowMs = today.getTime();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weekStartKey = toDateOnly(weekStart);
    const weekEndKey = toDateOnly(weekEnd);
    const eventsToday = monthEvents.filter(e => e.dateTimeStart.slice(0, 10) === todayKey).length;
    const eventsThisWeek = monthEvents.filter(e => {
      const dk = e.dateTimeStart.slice(0, 10);
      return dk >= weekStartKey && dk <= weekEndKey;
    }).length;
    const categoriesUsed = new Set(monthEvents.filter(e => e.type).map(e => e.type)).size;
    const upcoming = monthEvents.filter(e => {
      const ms = new Date(e.dateTimeStart).getTime();
      return ms > nowMs && ms <= nowMs + weekMs;
    }).length;
    return { eventsToday, eventsThisWeek, categoriesUsed, upcoming };
  }, [monthEvents, today, weekStart, weekEnd]);

  const { tasks: allTasks, toggleTaskCompleted } = useTasks();

  const todaysAgenda = useMemo(() => {
    const todayKey = toDateOnly(today);
    return monthEvents
      .filter(e => e.dateTimeStart.slice(0, 10) === todayKey)
      .sort((a, b) => a.dateTimeStart.localeCompare(b.dateTimeStart));
  }, [monthEvents, today]);

  const todaysTasks = useMemo(() => {
    const todayKey = toDateOnly(today);
    return allTasks.filter(t => t.dueDate === todayKey);
  }, [allTasks, today]);

  const tasksDoneToday = todaysTasks.filter(t => t.completed).length;
  const tasksTotalToday = todaysTasks.length;
  const tasksPct = tasksTotalToday > 0 ? Math.round((tasksDoneToday / tasksTotalToday) * 100) : 0;

  const upcomingEvents = useMemo(() => {
    const todayKey = toDateOnly(today);
    const limitDate = toDateOnly(addDays(today, 7));
    return monthEvents
      .filter(e => {
        const dk = e.dateTimeStart.slice(0, 10);
        return dk > todayKey && dk <= limitDate;
      })
      .sort((a, b) => a.dateTimeStart.localeCompare(b.dateTimeStart));
  }, [monthEvents, today]);

  // AI Suggestions — fetched from Gemini via worker (DESIGN-AUDIT phase 4:
  // shared hook, was an inline copy of the same fetch)
  const { suggestions: calSuggestions, isLoading: calSuggestionsLoading } = useAiSuggestions({
    endpoint: 'calendar',
    enabled: monthEvents.length > 0,
  });
  const [dialogDefaultDate, setDialogDefaultDate] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[calendar] month events", {
      visibleMonthDate: viewAnchorDate.toISOString(),
      gridStart: gridStart.toISOString(),
      gridEnd: gridEnd.toISOString(),
      count: monthEventStats.count,
      minStart: monthEventStats.minStart,
      maxStart: monthEventStats.maxStart,
    });
  }, [gridEnd, gridStart, monthEventStats, viewAnchorDate]);

  useEffect(() => {
    const prevMonthStart = startOfMonth(addMonths(viewAnchorDate, -1));
    const nextMonthStart = startOfMonth(addMonths(viewAnchorDate, 1));
    const prevGridStart = startOfWeekMonday(prevMonthStart);
    const prevGridEnd = endOfDay(addDays(prevGridStart, 41));
    const prevWindowStart = addDays(prevGridStart, -7);
    const prevWindowEnd = endOfDay(addDays(prevGridEnd, 7));
    const nextGridStart = startOfWeekMonday(nextMonthStart);
    const nextGridEnd = endOfDay(addDays(nextGridStart, 41));
    const nextWindowStart = addDays(nextGridStart, -7);
    const nextWindowEnd = endOfDay(addDays(nextGridEnd, 7));
    queryClient.prefetchQuery({
      queryKey: ["calendarMonthEvents", prevWindowStart.toISOString(), prevWindowEnd.toISOString()],
      queryFn: () => calendarService.getRange(prevWindowStart, prevWindowEnd),
      staleTime: 60_000,
    });
    queryClient.prefetchQuery({
      queryKey: ["calendarMonthEvents", nextWindowStart.toISOString(), nextWindowEnd.toISOString()],
      queryFn: () => calendarService.getRange(nextWindowStart, nextWindowEnd),
      staleTime: 60_000,
    });
  }, [queryClient, viewAnchorDate]);

  const openNewEvent = () => {
    setEditingEvent(null);
    setDialogDefaultDate(undefined);
    setIsDialogOpen(true);
  };

  const openNewEventOnDate = (date: string) => {
    setEditingEvent(null);
    setDialogDefaultDate(date);
    setIsDialogOpen(true);
  };

  const openEditEvent = (event: CalendarEvent) => {
    setEditingEvent(event);
    setIsDialogOpen(true);
  };

  const handleSave = async (payload: {
    title: string;
    dateTimeStart: string;
    dateTimeEnd?: string;
    location?: string;
    notes?: string;
    type?: string;
  }) => {
    if (editingEvent) {
      await calendarService.update(editingEvent.id, payload);
    } else {
      await calendarService.create(payload);
    }
    queryClient.invalidateQueries({ queryKey: tabQueryKey });
    queryClient.invalidateQueries({ queryKey: monthQueryKey });
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await calendarService.remove(deleteTarget.id);
      queryClient.invalidateQueries({ queryKey: tabQueryKey });
      queryClient.invalidateQueries({ queryKey: monthQueryKey });
      setDeleteTarget(null);
    }
  };

  const handleTodayClick = () => {
    const todayDate = new Date();
    const todayKey = toDateOnly(todayDate);
    setSelectedDay(todayKey);
    setViewAnchorDate(todayDate);
    if (filter === "week") {
      setPendingScrollDay(todayKey);
      return;
    }
    if (filter === "today") {
      setPendingScrollDay(todayKey);
      return;
    }
    if (eventsByDay[todayKey]) {
      setPendingScrollDay(todayKey);
      return;
    }
    const nextKey = orderedDays.find((day) => day >= todayKey) ?? orderedDays[0];
    setPendingScrollDay(nextKey ?? null);
  };
  useEffect(() => {
    if (!pendingScrollDay) return;
    const target = dayRefs.current[pendingScrollDay];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingScrollDay(null);
  }, [pendingScrollDay, eventsByDay, filter, viewAnchorDate]);

  useEffect(() => {
    saveCalendarUiState({
      activeTab: filter,
      viewAnchorDate: formatDayKey(viewAnchorDate),
      selectedDay,
      searchQuery,
      hasLocationOnly,
      hasNotesOnly,
    });
  }, [filter, viewAnchorDate, selectedDay, searchQuery, hasLocationOnly, hasNotesOnly]);

  const handleClearFilters = () => {
    setSearchQuery("");
    setHasLocationOnly(false);
    setHasNotesOnly(false);
  };

  const resetSecondaryFilters = () => {
    setSearchQuery("");
    setHasLocationOnly(false);
    setHasNotesOnly(false);
  };

  const dayScopedEvents = useMemo(() => {
    if (!selectedDay) return eventsByDay;
    if (monthEventsByDay[selectedDay]) {
      return { [selectedDay]: monthEventsByDay[selectedDay] };
    }
    // Day has tasks but no calendar events — include it with an empty events array
    // so the day card renders and tasks are shown.
    if (tasksByDay[selectedDay]?.length) {
      return { [selectedDay]: [] as typeof monthEventsByDay[string] };
    }
    return {};
  }, [eventsByDay, monthEventsByDay, selectedDay, tasksByDay]);

  const orderedDays = Object.keys(dayScopedEvents).sort();
  const hasAnyEvents = selectedDay ? monthEvents.length > 0 : rangeEvents.length > 0;
  const isFiltering = !!searchQuery.trim() || hasLocationOnly || hasNotesOnly;
  const selectedDayKey = selectedDay ?? formatDayKey(new Date());
  const now = new Date();
  const selectedDayHasEvents = !!(selectedDay && (
    monthEventsByDay[selectedDay]?.length || tasksByDay[selectedDay]?.length
  ));

  const weekStripDays = useMemo(() => {
    const anchor = weekStart;
    return Array.from({ length: 7 }, (_, idx) => addDays(anchor, idx));
  }, [weekStart]);

  const monthLabel = useMemo(() => {
    return viewAnchorDate.toLocaleDateString(locale, { month: "long", year: "numeric" });
  }, [viewAnchorDate, locale]);

  const monthGridDays = useMemo(() => {
    return Array.from({ length: 42 }, (_, idx) => addDays(gridStart, idx));
  }, [gridStart]);

  // I18N-SWEEP-1: localized short weekday names, Monday-first (2024-01-01
  // is a Monday, used purely as a formatting anchor).
  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, idx) => formatter.format(new Date(2024, 0, idx + 1)));
  }, [locale]);

  const handleSelectDay = (day: Date) => {
    const key = formatDayKey(day);
    resetSecondaryFilters();
    setSelectedDay(key);
    setViewAnchorDate(day);
    setPendingScrollDay(key);
    if (import.meta.env.DEV) {
      console.debug("[calendar] select day", key);
    }
  };

  const handlePrevMonth = () => {
    const target = startOfMonth(addMonths(viewAnchorDate, -1));
    resetSecondaryFilters();
    setViewAnchorDate(target);
    if (import.meta.env.DEV) {
      console.debug("[calendar] prev month", { target });
    }
  };

  const handleNextMonth = () => {
    const target = startOfMonth(addMonths(viewAnchorDate, 1));
    resetSecondaryFilters();
    setViewAnchorDate(target);
    if (import.meta.env.DEV) {
      console.debug("[calendar] next month", { target });
    }
  };

  const handlePrevWeek = () => {
    const next = addDays(viewAnchorDate, -7);
    resetSecondaryFilters();
    setViewAnchorDate(next);
    if (import.meta.env.DEV) {
      console.debug("[calendar] prev week", next.toISOString());
    }
  };

  const handleNextWeek = () => {
    const next = addDays(viewAnchorDate, 7);
    resetSecondaryFilters();
    setViewAnchorDate(next);
    if (import.meta.env.DEV) {
      console.debug("[calendar] next week", next.toISOString());
    }
  };

  const calendarError = rangeError ?? monthError;
  const calendarErrorMessage = calendarError instanceof Error
    ? calendarError.message
    : t("calendar_load_error");
  const isInitialLoading = isLoading && rangeEvents.length === 0;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between py-5"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">{t("calendar_title")}</h1>
          <p className="text-sm text-muted-foreground">{t("calendar_subtitle")}</p>
        </div>
        <Button className="gap-2" style={{ background: 'var(--gradient-primary)' }} onClick={openNewEvent}>
          <Plus className="w-4 h-4" />
          {t("calendar_add_event")}
        </Button>
      </motion.div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
      {/* Left column — main calendar content */}
      <div className="flex-1 min-w-0 space-y-4">

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={CalendarIcon} label={t("calendar_events_today")} value={calendarKpi.eventsToday} />
        <StatCard icon={CalendarDays} label={t("calendar_this_week")} value={calendarKpi.eventsThisWeek} />
        <StatCard icon={Layers} label={t("calendar_categories")} value={calendarKpi.categoriesUsed} />
        <StatCard icon={ArrowUpRight} label={t("calendar_upcoming")} value={calendarKpi.upcoming} />
      </div>

      <CalendarFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        mode={editingEvent ? "edit" : "create"}
        initialEvent={editingEvent}
        defaultDate={dialogDefaultDate}
        onSubmit={handleSave}
      />

      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as EventFilter)}>
            <TabsList className="bg-secondary">
              <TabsTrigger value="all">{t("all")}</TabsTrigger>
              <TabsTrigger value="today">{t("today")}</TabsTrigger>
              <TabsTrigger value="week">{t("calendar_this_week")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="secondary" size="sm" onClick={handleTodayClick}>
            {t("calendar_go_to_today")}
          </Button>
          {filter === "week" && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  handlePrevWeek();
                }}
              >
                {t("calendar_prev_week")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  handleNextWeek();
                }}
              >
                {t("calendar_next_week")}
              </Button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handlePrevMonth}>
              {t("calendar_prev_month")}
            </Button>
            <span className="text-sm font-medium">{monthLabel}</span>
            <Button variant="secondary" size="sm" onClick={handleNextMonth}>
              {t("calendar_next_month")}
            </Button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {weekStripDays.map((day) => {
              const key = formatDayKey(day);
              const isSelected = key === selectedDayKey;
              const isToday = key === formatDayKey(new Date());
              return (
                <Button
                  key={key}
                  variant={isSelected ? "default" : "secondary"}
                  size="sm"
                  className={isToday && !isSelected ? "border border-primary" : ""}
                  onClick={() => handleSelectDay(day)}
                >
                  <span className="me-1">{day.toLocaleDateString(locale, { weekday: "short" })}</span>
                  {day.getDate()}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/60 p-2">
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-muted-foreground">
            {weekdayLabels.map((label) => (
              <div key={label} className="py-1">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {monthGridDays.map((day) => {
              const key = formatDayKey(day);
              const count = monthEventsByDay[key]?.length ?? 0;
              const taskCount = tasksByDay[key]?.length ?? 0;
              const hasOverdue = tasksByDay[key]?.some(t => t.isOverdue) ?? false;
              const isSelected = selectedDay === key;
              const isToday = key === formatDayKey(new Date());
              const isCurrentMonth = day.getMonth() === viewAnchorDate.getMonth();
              return (
                <Button
                  key={key}
                  variant={isSelected ? "default" : "secondary"}
                  className={cn(
                    "h-11 flex-col items-start justify-start px-1 py-1 text-start gap-0.5",
                    !isCurrentMonth && "opacity-60",
                    isToday && !isSelected && "border border-primary",
                  )}
                  onClick={() => handleSelectDay(day)}
                >
                  <span className="text-xs font-semibold">{day.getDate()}</span>
                  <div className="flex items-center gap-0.5 flex-wrap">
                    {(monthEventsByDay[key] ?? []).slice(0, 3).map((ev, i) => (
                      <span
                        key={i}
                        className={cn("w-1.5 h-1.5 rounded-full", getCategoryDotColor(ev))}
                        style={ev.color && !ev.type ? { backgroundColor: ev.color } : undefined}
                      />
                    ))}
                    {taskCount > 0 && (
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        hasOverdue ? "bg-destructive" : "bg-[var(--flow-career)]",
                      )} />
                    )}
                  </div>
                </Button>
              );
            })}
          </div>
        </div>
        {/* Category legend */}
        <div className="flex flex-wrap items-center gap-4 mt-2">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full", CATEGORY_COLORS[key])} />
              <span className="text-[11px] text-muted-foreground">
                {CATEGORY_LABEL_KEYS[key] ? t(CATEGORY_LABEL_KEYS[key]) : label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {calendarError ? (
        <StatePanel
          variant="error"
          title={t("calendar_failed_title")}
          description={calendarErrorMessage}
        />
      ) : isInitialLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, idx) => (
            <Card key={idx}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  <SkeletonBlock className="h-4 w-36" />
                </CardTitle>
                <SkeletonBlock className="h-5 w-16 rounded-full" />
              </CardHeader>
              <CardContent className="space-y-3">
                <SkeletonListItem />
                <SkeletonListItem />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !hasAnyEvents ? (
        <StatePanel
          variant="empty"
          title={t("calendar_empty_title")}
          description={t("calendar_empty_desc")}
          actionLabel={t("calendar_add_event")}
          onAction={openNewEvent}
        />
      ) : filter === "week" && orderedDays.length === 0 && !selectedDay ? (
        <StatePanel
          variant="empty"
          title={t("calendar_empty_week_title")}
          description={t("calendar_empty_week_desc")}
          actionLabel={t("calendar_add_event")}
          onAction={openNewEvent}
        />
      ) : orderedDays.length === 0 && !selectedDay ? (
        <StatePanel
          variant="empty"
          title={t("calendar_empty_filtered_title")}
          description={t("calendar_empty_filtered_desc")}
          actionLabel={isFiltering ? t("calendar_clear_filters") : undefined}
          onAction={isFiltering ? handleClearFilters : undefined}
        />
      ) : (
        <div ref={listContainerRef} className="space-y-6 max-h-[70vh] overflow-auto pr-1">
          {selectedDay && !selectedDayHasEvents ? (
            <Card ref={(node) => { dayRefs.current[selectedDayKey] = node; }}>
              <CardHeader className="flex flex-row items-center justify-between sticky top-0 z-10 bg-card/95 backdrop-blur">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-primary" />
                  {new Date(selectedDayKey).toLocaleDateString(locale, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </CardTitle>
                <Badge variant="secondary">{t("calendar_events_count", { count: 0 })}</Badge>
              </CardHeader>
              <CardContent className="py-6 text-sm text-muted-foreground">
                No events on this day.
              </CardContent>
            </Card>
          ) : (
            orderedDays.map((dayKey) => (
              <Card key={dayKey} ref={(node) => { dayRefs.current[dayKey] = node; }}>
                <CardHeader className="flex flex-row items-center justify-between sticky top-0 z-10 bg-card/95 backdrop-blur">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-primary" />
                    {parseDayKeyLocal(dayKey).toLocaleDateString(locale, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </CardTitle>
                  <Badge variant={(dayScopedEvents[dayKey].length + (tasksByDay[dayKey]?.length ?? 0)) >= 3 ? "default" : "secondary"}>
                    {dayScopedEvents[dayKey].length > 0 && t("calendar_events_count", { count: dayScopedEvents[dayKey].length })}
                    {dayScopedEvents[dayKey].length > 0 && (tasksByDay[dayKey]?.length ?? 0) > 0 && " · "}
                    {(tasksByDay[dayKey]?.length ?? 0) > 0 && `${tasksByDay[dayKey].length} task(s)`}
                    {dayScopedEvents[dayKey].length === 0 && (tasksByDay[dayKey]?.length ?? 0) === 0 && t("calendar_events_count", { count: 0 })}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(tasksByDay[dayKey] ?? []).map(task => (
                    <div key={task.id} className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm",
                      task.isOverdue ? "border-destructive/30 bg-destructive/5" : "border-career/30 bg-career/5",
                    )}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("text-xs font-semibold", task.isOverdue ? "text-destructive" : "text-[var(--flow-career)]")}>
                          ✓ Task
                        </span>
                        <span className="truncate">{task.title}</span>
                      </div>
                      <AlarmPicker
                        sourceType="task"
                        sourceId={task.id}
                        sourceTitle={task.title}
                        eventAt={`${task.date}T09:00:00`}
                      />
                    </div>
                  ))}
                  {dayScopedEvents[dayKey].map((event) => {
                    const { start, end } = getEventWindow(event);
                    const isTodayEvent = start ? isSameDay(start, now) : false;
                    const eventState = getEventState(now, start, end);
                    const timeStart = formatTime(event.dateTimeStart);
                    const timeEnd = event.dateTimeEnd ? formatTime(event.dateTimeEnd) : null;
                    const timeLabel = timeStart
                      ? timeEnd
                        ? `${timeStart}\u2013${timeEnd}`
                        : timeStart
                      : t("calendar_all_day");
                    return (
                      <div
                        key={event.id}
                        className={cn(
                          "flex flex-col gap-2 rounded-lg border border-border/60 p-3",
                          "bg-secondary/40",
                          eventState === "current" && "border-l-4 border-l-primary ring-1 ring-primary/30",
                          eventState === "past" && "opacity-70",
                          isTodayEvent && eventState !== "current" && "border-l-4 border-l-primary/60",
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <div className="min-w-[64px] text-sm font-semibold text-foreground">
                              {timeLabel}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">{event.title}</p>
                                {eventState === "current" && <Badge variant="secondary">{t("calendar_now")}</Badge>}
                                {isTodayEvent && eventState !== "current" && (
                                  <Badge variant="secondary">{t("today")}</Badge>
                                )}
                                {eventState === "upcoming" && <Badge variant="outline">{t("calendar_upcoming")}</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground">{formatDateTime(event.dateTimeStart)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => openEditEvent(event)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(event)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        {(event.location || event.notes) && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {event.location && (
                              <Badge variant="secondary" className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                <span className="max-w-[220px] truncate">{event.location}</span>
                              </Badge>
                            )}
                            {event.notes && (
                              <Badge variant="secondary" className="flex items-center gap-1">
                                <StickyNote className="w-3 h-3" />
                                Notes
                              </Badge>
                            )}
                          </div>
                        )}
                        <AlarmPicker
                          sourceType="calendar_event"
                          sourceId={event.id}
                          sourceTitle={event.title}
                          eventAt={event.dateTimeStart}
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      </div>

      {/* Right sidebar */}
      <CollapsibleRail>
        {/* Today's Agenda — events + tasks */}
        <Card className="glass-card card-accent">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconTile className="w-7 h-7 rounded-md"><CalendarIcon className="w-3.5 h-3.5" /></IconTile>
                <span className="text-sm font-semibold">{t("calendar_todays_agenda")}</span>
              </div>
              {tasksTotalToday > 0 && (
                <div className="flex flex-col items-center shrink-0">
                  <div className="relative w-11 h-11">
                    <svg viewBox="0 0 44 44" className="w-full h-full -rotate-90">
                      <circle cx="22" cy="22" r="18" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                      <circle
                        cx="22" cy="22" r="18" fill="none"
                        stroke="hsl(var(--primary))"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${(tasksDoneToday / tasksTotalToday) * 113.1} 113.1`}
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                      {tasksDoneToday}/{tasksTotalToday}
                    </span>
                  </div>
                  <p className="text-[9px] text-muted-foreground">Tasks</p>
                </div>
              )}
            </div>

            {/* Events section */}
            {todaysAgenda.length > 0 && (
              <ul className="space-y-1.5">
                {todaysAgenda.map(ev => {
                  const timeStart = formatTime(ev.dateTimeStart);
                  const timeEnd = ev.dateTimeEnd ? formatTime(ev.dateTimeEnd) : null;
                  const dotColor = ev.type && CATEGORY_COLORS[ev.type] ? CATEGORY_COLORS[ev.type] : 'bg-primary';
                  const badgeLabel = ev.type && CATEGORY_LABEL_KEYS[ev.type] ? t(CATEGORY_LABEL_KEYS[ev.type]) : null;
                  return (
                    <li key={ev.id} className="flex items-start gap-3 rounded-lg bg-secondary/20 px-3 py-2">
                      <div className="min-w-[44px] text-[11px] font-medium text-muted-foreground pt-0.5">
                        {timeStart ?? 'All day'}
                        {timeEnd && (
                          <span className="block text-[10px]">{timeEnd}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{ev.title}</p>
                        {ev.location && (
                          <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                            <MapPin className="w-2.5 h-2.5 shrink-0" />
                            {ev.location}
                          </p>
                        )}
                      </div>
                      {badgeLabel && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={cn("w-2 h-2 rounded-full", dotColor)} />
                          <span className="text-[10px] text-muted-foreground">{badgeLabel}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Tasks section */}
            {tasksTotalToday > 0 && (
              <>
                {todaysAgenda.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border/40" />
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <CheckSquare className="w-2.5 h-2.5" /> Tasks
                    </span>
                    <div className="h-px flex-1 bg-border/40" />
                  </div>
                )}
                <ul className="space-y-1.5">
                  {todaysTasks.map(task => (
                    <li key={task.id} className="flex items-center gap-2.5 rounded-lg bg-secondary/20 px-3 py-2">
                      <Checkbox
                        checked={task.completed}
                        onCheckedChange={() => toggleTaskCompleted(task.id)}
                        className="shrink-0"
                      />
                      <span className={cn(
                        "text-xs font-medium truncate flex-1 min-w-0",
                        task.completed && "line-through text-muted-foreground"
                      )}>
                        {task.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {todaysAgenda.length === 0 && tasksTotalToday === 0 && (
              <p className="text-xs text-muted-foreground">Nothing scheduled for today.</p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Events */}
        <Card className="glass-card card-accent">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <IconTile className="w-7 h-7 rounded-md"><CalendarDays className="w-3.5 h-3.5" /></IconTile>
                <span className="text-sm font-semibold">{t("calendar_upcoming_events")}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {upcomingEvents.length}
              </span>
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("calendar_no_upcoming")}</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {upcomingEvents.slice(0, 5).map(ev => {
                    const evDate = parseDayKeyLocal(ev.dateTimeStart.slice(0, 10));
                    const tomorrow = addDays(today, 1);
                    const dateLabel = isSameDay(evDate, tomorrow)
                      ? t('tomorrow')
                      : evDate.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
                    const timeStart = formatTime(ev.dateTimeStart);
                    const dotColor = ev.type && CATEGORY_COLORS[ev.type] ? CATEGORY_COLORS[ev.type] : 'bg-primary';
                    const badgeLabel = ev.type && CATEGORY_LABEL_KEYS[ev.type] ? t(CATEGORY_LABEL_KEYS[ev.type]) : null;
                    return (
                      <li key={ev.id} className="flex items-start gap-3 rounded-lg bg-secondary/20 px-3 py-2">
                        <div className="min-w-[48px] pt-0.5">
                          <p className="text-[11px] font-medium text-muted-foreground">{dateLabel}</p>
                          {timeStart && (
                            <p className="text-[10px] text-muted-foreground">{timeStart}</p>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{ev.title}</p>
                        </div>
                        {badgeLabel && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={cn("w-2 h-2 rounded-full", dotColor)} />
                            <span className="text-[10px] text-muted-foreground">{badgeLabel}</span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {upcomingEvents.length > 5 && (
                  <button
                    type="button"
                    onClick={() => { setFilter('all'); handleTodayClick(); }}
                    className="text-[11px] text-primary hover:underline"
                  >
                    View all {upcomingEvents.length} events →
                  </button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card hidden overflow-hidden lg:block">
          <CardContent className="relative h-[260px] p-0">
            <SmartflowAsciiVisual
              variant="tetrahedron"
              className="pointer-events-none absolute -right-14 top-1/2 h-[360px] w-[360px] -translate-y-1/2 opacity-45"
            />
          </CardContent>
        </Card>

        {/* AI Suggestions — Gemini-generated (DESIGN-AUDIT phase 4: shared card) */}
        {(calSuggestionsLoading || calSuggestions.length > 0) && (
          <AiSuggestionsCard
            title={t("ai_suggestions")}
            subtitle={t("ai_based_on_schedule")}
            isLoading={calSuggestionsLoading}
            rows={calSuggestions.map(s => ({
              text: s.text,
              kind: s.type === 'recommendation' ? 'action' as const : 'idea' as const,
              onClick: s.suggestedDate
                ? () => openNewEventOnDate(s.suggestedDate!)
                : undefined,
            }))}
          />
        )}
      </CollapsibleRail>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("calendar_delete_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("calendar_delete_desc", { title: deleteTarget?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}



