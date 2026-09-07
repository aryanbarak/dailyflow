import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarEvent } from "@/features/calendar/calendarService";
import { SchedulePicker } from "@/features/scheduling/components/SchedulePicker";

type CalendarFormMode = "create" | "edit";

interface CalendarFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CalendarFormMode;
  initialEvent?: CalendarEvent | null;
  defaultDate?: string;
  onSubmit: (payload: {
    title: string;
    dateTimeStart: string;
    dateTimeEnd?: string;
    location?: string;
    notes?: string;
    type?: string;
    recurrenceRule?: string;
    recurrenceEndDate?: string;
  }) => Promise<void> | void;
  isSaving?: boolean;
}

function formatInputDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatInputTime(date: Date) {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function parseDateInput(value: string) {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const parts = isoMatch
    ? { year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) }
    : slashMatch
      ? { year: Number(slashMatch[3]), month: Number(slashMatch[2]), day: Number(slashMatch[1]) }
      : null;
  if (!parts) return null;
  const { year, month, day } = parts;
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function buildDateTime(date: Date, time: string) {
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    throw new Error("Invalid time");
  }
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error("Invalid time");
  }
  const localDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0,
  );
  return localDate.toISOString();
}

export function CalendarFormDialog({
  open,
  onOpenChange,
  mode,
  initialEvent,
  defaultDate,
  onSubmit,
  isSaving = false,
}: CalendarFormDialogProps) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(formatInputDate(new Date()));
  const [startTime, setStartTime] = useState(formatInputTime(new Date()));
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [eventType, setEventType] = useState("personal");
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isBusy = isSaving || isSubmitting;

  const dialogTitle = useMemo(
    () => (mode === "edit" ? "Edit Event" : "New Event"),
    [mode],
  );

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialEvent) {
      const start = new Date(initialEvent.dateTimeStart);
      const end = initialEvent.dateTimeEnd ? new Date(initialEvent.dateTimeEnd) : null;
      setTitle(initialEvent.title);
      setDate(formatInputDate(start));
      setStartTime(formatInputTime(start));
      setEndTime(end ? formatInputTime(end) : "");
      setLocation(initialEvent.location ?? "");
      setNotes(initialEvent.notes ?? "");
      setEventType(initialEvent.type ?? "personal");
      // CORE-W5 fix: restore the event's actual schedule instead of always
      // resetting to none -- editing a recurring event used to silently
      // discard its rule (and the rule never even reached the DB before
      // this feature, so there was nothing real to restore either way).
      setRecurrenceRule(initialEvent.recurrenceRule ?? null);
      setRecurrenceEndDate(initialEvent.recurrenceEndDate ?? null);
      setError(null);
      return;
    }
    const fallbackDate = defaultDate ? parseDateInput(defaultDate) : null;
    const now = fallbackDate ?? new Date();
    setTitle("");
    setDate(formatInputDate(now));
    setStartTime(formatInputTime(now));
    setEndTime("");
    setLocation("");
    setNotes("");
    setEventType("personal");
    setRecurrenceRule(null);
    setRecurrenceEndDate(null);
    setError(null);
  }, [initialEvent, mode, open]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("Event title is required.");
      return;
    }
    const parsedDate = parseDateInput(date);
    if (!parsedDate) {
      setError("Event date is required.");
      return;
    }
    let start: string;
    let end: string | undefined;
    try {
      start = buildDateTime(parsedDate, startTime || "09:00");
      end = endTime ? buildDateTime(parsedDate, endTime) : undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid date or time";
      setError(message);
      return;
    }
    if (import.meta.env.DEV) {
      console.debug("[calendar] save", {
        rawDate: date,
        parsedDate: formatInputDate(parsedDate),
        start,
        end,
      });
    }
    if (end && new Date(end) <= new Date(start)) {
      setError("End time must be after start time.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        dateTimeStart: start,
        dateTimeEnd: end,
        location,
        notes,
        type: eventType,
        recurrenceRule: recurrenceRule ?? undefined,
        recurrenceEndDate: recurrenceEndDate ?? undefined,
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>End Time</Label>
            <Input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Location</Label>
              <Input value={location} onChange={(event) => setLocation(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="work">Work</SelectItem>
                  <SelectItem value="family">Family</SelectItem>
                  <SelectItem value="health">Health</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          <SchedulePicker
            granularity="datetime"
            recurrenceRule={recurrenceRule}
            recurrenceEndDate={recurrenceEndDate}
            onChange={(result) => {
              setRecurrenceRule(result.recurrenceRule);
              setRecurrenceEndDate(result.recurrenceEndDate);
              if (result.resolvedDateTime) {
                const resolved = new Date(result.resolvedDateTime);
                setDate(formatInputDate(resolved));
                setStartTime(formatInputTime(resolved));
              }
            }}
          />
          <Button className="w-full" onClick={handleSubmit} disabled={isBusy}>
            {mode === "edit" ? "Save Changes" : "Create Event"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
