import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Globe, ExternalLink, Grid, List, MoreVertical, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface WebLink {
  id: number;
  name: string;
  url: string;
  category: string;
  note?: string;
  favicon?: string;
}

const links: WebLink[] = [
  { id: 1, name: "Google Drive", url: "https://drive.google.com", category: "Work", note: "Personal documents" },
  { id: 2, name: "Netflix", url: "https://netflix.com", category: "Entertainment" },
  { id: 3, name: "GitHub", url: "https://github.com", category: "Work", note: "Code repositories" },
  { id: 4, name: "Spotify", url: "https://spotify.com", category: "Entertainment" },
  { id: 5, name: "Gmail", url: "https://gmail.com", category: "Work" },
  { id: 6, name: "Amazon", url: "https://amazon.com", category: "Shopping" },
  { id: 7, name: "YouTube", url: "https://youtube.com", category: "Entertainment" },
  { id: 8, name: "Bank Account", url: "https://bank.com", category: "Finance", note: "Monthly statements" },
];

const categories = ["All", "Work", "Entertainment", "Shopping", "Finance"];

export default function LinksPage() {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const filteredLinks = selectedCategory === "All" 
    ? links 
    : links.filter(l => l.category === selectedCategory);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "Work": return "bg-info/20 text-info";
      case "Entertainment": return "bg-purple-500/20 text-purple-400";
      case "Shopping": return "bg-warning/20 text-warning";
      case "Finance": return "bg-success/20 text-success";
      default: return "bg-secondary text-muted-foreground";
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Web Links</h1>
          <p className="text-muted-foreground">Quick access to your websites</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-glow">
              <Plus className="w-4 h-4" />
              Add Link
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Website</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input placeholder="Website name" />
              </div>
              <div className="space-y-2">
                <Label>URL</Label>
                <Input placeholder="https://example.com" />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="work">Work</SelectItem>
                    <SelectItem value="entertainment">Entertainment</SelectItem>
                    <SelectItem value="shopping">Shopping</SelectItem>
                    <SelectItem value="finance">Finance</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Note (optional)</Label>
                <Textarea placeholder="Add a note..." />
              </div>
              <Button className="w-full" onClick={() => setIsDialogOpen(false)}>
                Save Link
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {/* Filters */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex items-center justify-between mb-6"
      >
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm transition-all whitespace-nowrap",
                selectedCategory === cat 
                  ? "bg-primary text-primary-foreground" 
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button 
            variant={viewMode === "grid" ? "secondary" : "ghost"} 
            size="icon"
            onClick={() => setViewMode("grid")}
          >
            <Grid className="w-4 h-4" />
          </Button>
          <Button 
            variant={viewMode === "list" ? "secondary" : "ghost"} 
            size="icon"
            onClick={() => setViewMode("list")}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </motion.div>

      {/* Links */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className={cn(
          viewMode === "grid" 
            ? "grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" 
            : "space-y-3"
        )}
      >
        {filteredLinks.map((link) => (
          <Card 
            key={link.id} 
            className={cn(
              "group cursor-pointer hover:bg-card-hover transition-all",
              viewMode === "list" && "flex items-center"
            )}
          >
            <CardContent className={cn(
              "pt-6",
              viewMode === "list" && "flex items-center gap-4 py-4 w-full"
            )}>
              <div className={cn(
                "flex items-start gap-3",
                viewMode === "grid" && "flex-col"
              )}>
                <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Globe className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className={cn("flex-1 min-w-0", viewMode === "grid" && "w-full")}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-sm truncate">{link.name}</h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 shrink-0"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Edit2 className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mb-2">{link.url}</p>
                  <Badge variant="secondary" className={cn("text-xs", getCategoryColor(link.category))}>
                    {link.category}
                  </Badge>
                </div>
              </div>
              {link.note && viewMode === "grid" && (
                <p className="text-xs text-muted-foreground mt-3 truncate">{link.note}</p>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Add New Card */}
        {viewMode === "grid" && (
          <Card 
            className="border-dashed hover:bg-card-hover transition-colors cursor-pointer" 
            onClick={() => setIsDialogOpen(true)}
          >
            <CardContent className="pt-6 flex flex-col items-center justify-center h-full min-h-[140px]">
              <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center mb-3">
                <Plus className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Add Website</p>
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
