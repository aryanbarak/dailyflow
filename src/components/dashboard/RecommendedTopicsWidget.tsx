import { useNavigate } from "react-router-dom";
import { IconTile } from "@/components/common/IconTile";
import {
  ArrowRight,
  Binary,
  BookOpen,
  BrainCircuit,
  Calculator,
  Database,
  GraduationCap,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Topic {
  title: string;
  minutes: number;
  level: "Beginner" | "Intermediate" | "Advanced";
  icon: React.ElementType;
  prompt: string;
}

const TOPICS: Topic[] = [
  {
    title: "Sorting Algorithms",
    minutes: 15,
    level: "Intermediate",
    icon: Layers,
    prompt: "Teach me about common sorting algorithms (Bubble Sort, Merge Sort, Quick Sort) for my FIAE exam. Explain how each works, their time complexity, and when to use which.",
  },
  {
    title: "OOP Fundamentals",
    minutes: 15,
    level: "Beginner",
    icon: BookOpen,
    prompt: "Teach me Object-Oriented Programming fundamentals: classes, objects, inheritance, polymorphism, encapsulation, and abstraction. Use Java or Python examples relevant to FIAE.",
  },
  {
    title: "Kaufmännisches Rechnen",
    minutes: 10,
    level: "Beginner",
    icon: Calculator,
    prompt: "Help me practice Kaufmännisches Rechnen for the WISO part of my IHK exam. Cover Dreisatz, Prozentrechnung, and Zinsrechnung with example problems.",
  },
  {
    title: "IHK Exam Strategy",
    minutes: 10,
    level: "Beginner",
    icon: GraduationCap,
    prompt: "Help me build a study plan and exam strategy for the IHK FIAE Abschlussprüfung Teil 2. What topics should I prioritize and how should I structure my preparation?",
  },
  {
    title: "Big O Notation",
    minutes: 10,
    level: "Beginner",
    icon: BrainCircuit,
    prompt: "Explain Big O notation to me from the basics. What does O(n), O(n²), O(log n) mean? Give me simple examples I can understand for my FIAE exam.",
  },
  {
    title: "Database Normalization",
    minutes: 12,
    level: "Intermediate",
    icon: Database,
    prompt: "Explain database normalization step by step — 1NF, 2NF, 3NF and BCNF. Give me practical examples of how to normalize a table for my FIAE exam.",
  },
  {
    title: "Recursion Basics",
    minutes: 15,
    level: "Intermediate",
    icon: Binary,
    prompt: "Help me understand recursion. Explain the concept, base case vs recursive case, and walk me through examples like factorial and Fibonacci for my FIAE exam.",
  },
];

export function RecommendedTopicsWidget() {
  const navigate = useNavigate();

  return (
    <Card className="glass-card card-accent">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
          <IconTile className="w-7 h-7 rounded-md"><GraduationCap className="w-3.5 h-3.5" /></IconTile>
          <div>
            <span>Recommended for You</span>
            <p className="text-[10px] font-normal text-muted-foreground mt-0.5">
              Suggested topics to explore
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {TOPICS.slice(0, 4).map((topic) => (
            <div
              key={topic.title}
              className="flex flex-col rounded-lg border border-border/50 bg-secondary/15 p-3 transition-colors hover:bg-secondary/30 hover:border-primary/25"
            >
              <IconTile className="w-8 h-8 rounded-md mb-2"><topic.icon className="w-4 h-4" /></IconTile>
              <p className="text-[13px] font-medium leading-snug mb-1">
                {topic.title}
              </p>
              <p className="text-[10px] text-muted-foreground mb-3">
                {topic.minutes} min · {topic.level}
              </p>
              <Button
                size="sm"
                className="mt-auto gap-1.5 text-xs h-7"
                onClick={() =>
                  navigate("/chat", {
                    state: { initialPrompt: topic.prompt },
                  })
                }
              >
                Start
                <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
