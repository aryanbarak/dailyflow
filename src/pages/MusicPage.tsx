import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Play, Pause, SkipBack, SkipForward, Volume2, Music, MoreVertical, ListMusic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface Track {
  id: number;
  title: string;
  artist: string;
  duration: string;
}

interface Playlist {
  id: number;
  name: string;
  trackCount: number;
  color: string;
  tracks: Track[];
}

const playlists: Playlist[] = [
  {
    id: 1,
    name: "Morning Vibes",
    trackCount: 12,
    color: "from-amber-500 to-orange-600",
    tracks: [
      { id: 1, title: "Sunrise", artist: "Local File", duration: "3:24" },
      { id: 2, title: "Coffee Time", artist: "Local File", duration: "4:15" },
      { id: 3, title: "New Day", artist: "Local File", duration: "3:52" },
    ]
  },
  {
    id: 2,
    name: "Focus Mode",
    trackCount: 8,
    color: "from-blue-500 to-cyan-600",
    tracks: [
      { id: 1, title: "Deep Work", artist: "Local File", duration: "5:20" },
      { id: 2, title: "Concentration", artist: "Local File", duration: "4:45" },
    ]
  },
  {
    id: 3,
    name: "Evening Relax",
    trackCount: 15,
    color: "from-purple-500 to-pink-600",
    tracks: [
      { id: 1, title: "Calm Waters", artist: "Local File", duration: "4:10" },
      { id: 2, title: "Night Sky", artist: "Local File", duration: "3:58" },
    ]
  },
  {
    id: 4,
    name: "Workout Mix",
    trackCount: 20,
    color: "from-green-500 to-emerald-600",
    tracks: [
      { id: 1, title: "Energy Boost", artist: "Local File", duration: "3:30" },
      { id: 2, title: "Power Up", artist: "Local File", duration: "4:00" },
    ]
  },
];

export default function MusicPage() {
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handlePlayPlaylist = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    setCurrentTrack(playlist.tracks[0]);
    setIsPlaying(true);
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto pb-32">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Music</h1>
          <p className="text-muted-foreground">Your personal playlists</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-glow">
              <Plus className="w-4 h-4" />
              New Playlist
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Playlist</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Playlist Name</Label>
                <Input placeholder="My Playlist" />
              </div>
              <div className="space-y-2">
                <Label>Add Music</Label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                  <Music className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-2">
                    Drop music files or paste URLs
                  </p>
                  <Button variant="secondary" size="sm">
                    Browse Files
                  </Button>
                </div>
              </div>
              <Button className="w-full" onClick={() => setIsDialogOpen(false)}>
                Create Playlist
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {/* Playlists Grid */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
      >
        {playlists.map((playlist) => (
          <Card 
            key={playlist.id} 
            className="group cursor-pointer overflow-hidden hover:ring-2 hover:ring-primary/50 transition-all"
            onClick={() => setSelectedPlaylist(playlist)}
          >
            <div className={cn("h-32 bg-gradient-to-br flex items-center justify-center relative", playlist.color)}>
              <ListMusic className="w-12 h-12 text-white/80" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlayPlaylist(playlist);
                }}
                className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0"
              >
                <Play className="w-5 h-5 text-foreground fill-foreground ml-0.5" />
              </button>
            </div>
            <CardContent className="pt-4">
              <h3 className="font-medium truncate">{playlist.name}</h3>
              <p className="text-sm text-muted-foreground">{playlist.trackCount} tracks</p>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Track List */}
      {selectedPlaylist && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{selectedPlaylist.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {selectedPlaylist.tracks.map((track, i) => (
                  <button
                    key={track.id}
                    onClick={() => {
                      setCurrentTrack(track);
                      setIsPlaying(true);
                    }}
                    className={cn(
                      "w-full flex items-center gap-4 p-3 rounded-lg transition-colors text-left",
                      currentTrack?.id === track.id && selectedPlaylist 
                        ? "bg-primary/10 text-primary" 
                        : "hover:bg-secondary"
                    )}
                  >
                    <span className="text-sm text-muted-foreground w-6">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{track.title}</p>
                      <p className="text-xs text-muted-foreground">{track.artist}</p>
                    </div>
                    <span className="text-sm text-muted-foreground">{track.duration}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Player Bar */}
      {currentTrack && (
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-0 left-0 right-0 lg:left-64 bg-card border-t border-border p-4"
        >
          <div className="max-w-4xl mx-auto flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center">
              <Music className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentTrack.title}</p>
              <p className="text-xs text-muted-foreground">{currentTrack.artist}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon">
                <SkipBack className="w-5 h-5" />
              </Button>
              <Button 
                size="icon" 
                className="w-10 h-10 rounded-full"
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5 ml-0.5" />
                )}
              </Button>
              <Button variant="ghost" size="icon">
                <SkipForward className="w-5 h-5" />
              </Button>
            </div>
            <div className="hidden sm:flex items-center gap-2 w-32">
              <Volume2 className="w-4 h-4 text-muted-foreground" />
              <Slider defaultValue={[70]} max={100} className="w-full" />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
