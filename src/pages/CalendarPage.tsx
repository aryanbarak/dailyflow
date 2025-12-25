import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Calendar as CalendarIcon, MapPin, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEvents } from "@/hooks/useEvents";
import { CalendarEvent } from "@/features/calendar/calendarService";
import { formatDateTime, toDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";

type EventFilter = "all" | "today" | "week";

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

function buildDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

export default function CalendarPage() {
  const { events, addEvent, updateEvent, removeEvent } = useEvents();
  const [filter, setFilter] = useState<EventFilter>("week");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(formatInputDate(new Date()));
  const [startTime, setStartTime] = useState(formatInputTime(new Date()));
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const sortedEvents = useMemo(() => {
    return [...events].sort(
      (a, b) => new Date(a.dateTimeStart).getTime() - new Date(b.dateTimeStart).getTime(),
    );
  }, [events]);

  const filteredEvents = useMemo(() => {
    return sortedEvents.filter((event) => {
      const eventDate = new Date(event.dateTimeStart);
      if (filter === "today") {
        return toDateOnly(eventDate) === toDateOnly(today);
      }
      if (filter === "week") {
        return eventDate >= startOfWeek && eventDate <= endOfWeek;
      }
      return true;
    });
  }, [sortedEvents, filter, startOfWeek, endOfWeek, today]);

  const groupedEvents = useMemo(() => {
    return filteredEvents.reduce<Record<string, CalendarEvent[]>>((acc, event) => {
      const key = toDateOnly(event.dateTimeStart);
      acc[key] = acc[key] ? [...acc[key], event] : [event];
      return acc;
    }, {});
  }, [filteredEvents]);

  const openNewEvent = () => {
    setEditingEvent(null);
    setTitle("");
    setDate(formatInputDate(new Date()));
    setStartTime(formatInputTime(new Date()));
    setEndTime("");
    setLocation("");
    setNotes("");
    setError(null);
    setIsDialogOpen(true);
  };

  const openEditEvent = (event: CalendarEvent) => {
    const start = new Date(event.dateTimeStart);
    const end = event.dateTimeEnd ? new Date(event.dateTimeEnd) : null;
    setEditingEvent(event);
    setTitle(event.title);
    setDate(formatInputDate(start));
    setStartTime(formatInputTime(start));
    setEndTime(end ? formatInputTime(end) : "");
    setLocation(event.location ?? "");
    setNotes(event.notes ?? "");
    setError(null);
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!title.trim()) {
      setError("Event title is required.");
      return;
    }
    const start = buildDateTime(date, startTime || "09:00");
    const end = endTime ? buildDateTime(date, endTime) : undefined;
    if (editingEvent) {
      updateEvent(editingEvent.id, {
        title: title.trim(),
        dateTimeStart: start,
        dateTimeEnd: end,
        location,
        notes,
      });
    } else {
      addEvent({
        title: title.trim(),
        dateTimeStart: start,
        dateTimeEnd: end,
        location,
        notes,
      });
    }
    setIsDialogOpen(false);
  };

  const handleDelete = () => {
    if (deleteTarget) {
      removeEvent(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const orderedDays = Object.keys(groupedEvents).sort();

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Calendar</h1>
          <p className="text-muted-foreground">Your agenda at a glance</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-glow" onClick={openNewEvent}>
              <Plus className="w-4 h-4" />
              Add Event
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingEvent ? "Edit Event" : "New Event"}</DialogTitle>
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
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={location} onChange={(event) => setLocation(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
              <Button className="w-full" onClick={handleSave}>
                {editingEvent ? "Save Changes" : "Create Event"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as EventFilter)} className="mb-6">
        <TabsList className="bg-secondary">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="week">This Week</TabsTrigger>
        </TabsList>
      </Tabs>

      {orderedDays.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No events scheduled yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {orderedDays.map((dayKey) => (
            <Card key={dayKey}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-primary" />
                  {new Date(dayKey).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </CardTitle>
                <Badge variant="secondary">{groupedEvents[dayKey].length} event(s)</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {groupedEvents[dayKey].map((event) => (
                  <div
                    key={event.id}
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border border-border/60 p-3",
                      "bg-secondary/40",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium">{event.title}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(event.dateTimeStart)}</p>
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
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {event.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {event.location}
                          </span>
                        )}
                        {event.notes && <span>{event.notes}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{deleteTarget?.title}" from your calendar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
