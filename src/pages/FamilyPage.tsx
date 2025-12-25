import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Calendar, FileText, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface Child {
  id: number;
  name: string;
  age: number;
  color: string;
  initials: string;
  schedule: { day: string; activity: string }[];
  notes: string[];
  events: { title: string; date: string }[];
}

const children: Child[] = [
  {
    id: 1,
    name: "Emma",
    age: 8,
    color: "bg-pink-500",
    initials: "EM",
    schedule: [
      { day: "Mon", activity: "Piano Lessons" },
      { day: "Wed", activity: "Swimming" },
      { day: "Fri", activity: "Art Class" },
    ],
    notes: ["Allergic to peanuts", "Prefers reading over TV"],
    events: [
      { title: "School Play", date: "Dec 20" },
      { title: "Birthday Party", date: "Jan 15" },
    ],
  },
  {
    id: 2,
    name: "Lucas",
    age: 5,
    color: "bg-blue-500",
    initials: "LU",
    schedule: [
      { day: "Tue", activity: "Soccer Practice" },
      { day: "Thu", activity: "Playdate" },
      { day: "Sat", activity: "Little League" },
    ],
    notes: ["Loves dinosaurs", "Bedtime: 7:30 PM"],
    events: [
      { title: "Soccer Tournament", date: "Dec 18" },
      { title: "Doctor Checkup", date: "Jan 5" },
    ],
  },
];

export default function FamilyPage() {
  const [selectedChild, setSelectedChild] = useState<Child>(children[0]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Family</h1>
          <p className="text-muted-foreground">Manage your kids' activities</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-glow">
              <Plus className="w-4 h-4" />
              Add Child
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Child Profile</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input placeholder="Child's name" />
              </div>
              <div className="space-y-2">
                <Label>Age</Label>
                <Input type="number" placeholder="Age" />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea placeholder="Important notes..." />
              </div>
              <Button className="w-full" onClick={() => setIsDialogOpen(false)}>
                Add Profile
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {/* Child Profile Cards */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide"
      >
        {children.map((child) => (
          <button
            key={child.id}
            onClick={() => setSelectedChild(child)}
            className={cn(
              "flex items-center gap-3 p-4 rounded-xl transition-all min-w-fit",
              selectedChild.id === child.id 
                ? "bg-primary/10 ring-2 ring-primary" 
                : "bg-secondary hover:bg-card-hover"
            )}
          >
            <Avatar className="w-12 h-12">
              <AvatarFallback className={cn("text-white font-medium", child.color)}>
                {child.initials}
              </AvatarFallback>
            </Avatar>
            <div className="text-left">
              <p className="font-medium">{child.name}</p>
              <p className="text-xs text-muted-foreground">{child.age} years old</p>
            </div>
            <div className={cn("w-3 h-3 rounded-full ml-2", child.color)} />
          </button>
        ))}
      </motion.div>

      {/* Child Details */}
      <motion.div 
        key={selectedChild.id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Tabs defaultValue="schedule" className="space-y-6">
          <TabsList className="bg-secondary">
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>

          <TabsContent value="schedule">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Weekly Schedule
                </CardTitle>
                <Button variant="ghost" size="sm">
                  <Edit2 className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {selectedChild.schedule.map((item, i) => (
                    <div key={i} className="p-4 rounded-lg bg-secondary">
                      <Badge variant="outline" className="mb-2">{item.day}</Badge>
                      <p className="text-sm font-medium">{item.activity}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Important Notes
                </CardTitle>
                <Button variant="ghost" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Note
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {selectedChild.notes.map((note, i) => (
                    <div key={i} className="p-4 rounded-lg bg-secondary flex items-start gap-3">
                      <div className={cn("w-2 h-2 rounded-full mt-2", selectedChild.color)} />
                      <p className="text-sm">{note}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Upcoming Events
                </CardTitle>
                <Button variant="ghost" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Event
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {selectedChild.events.map((event, i) => (
                    <div key={i} className="p-4 rounded-lg bg-secondary flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", selectedChild.color + "/20")}>
                          <Calendar className={cn("w-5 h-5", selectedChild.color.replace("bg-", "text-"))} />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{event.title}</p>
                          <p className="text-xs text-muted-foreground">{event.date}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
