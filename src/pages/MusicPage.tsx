import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Search, Upload, Trash2, Music2, ChevronDown, ChevronUp,
  Play, Pause, Plus, X, Heart,
  ListMusic, Clock, FolderOpen, SkipBack, SkipForward,
  Shuffle, Repeat, Volume2, Filter, Headphones,
  BookOpen, Moon, Dumbbell, Users, Zap, Brain, Timer,
  ExternalLink,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useMusicPlayer, parseVideoId, PRESETS } from "@/hooks/useMusicPlayer";
import { usePlaylistPlayer } from "@/contexts/PlaylistPlayerContext";
import { PlaylistsTab } from "@/components/music/PlaylistsTab";
import { PomodoroTimer } from "@/components/music/PomodoroTimer";
import { usePomodoroStore } from "@/features/music/pomodoroStore";
import { type MusicTrack, type PlaylistTrack, musicService } from "@/features/music/musicService";
import {
  usePlaylists, usePlayHistory, useLikedTracks, useAddToHistory,
  useLikeTrack, useUnlikeTrack, useCreatePlaylist, useAddTrackToPlaylist,
} from "@/features/music/useMusic";
import { useTasks } from "@/hooks/useTasks";
import { useT } from "@/i18n";
import { loadPlaylists } from "@/hooks/usePlaylists";
import { loadHistory as loadOldHistory } from "@/hooks/useMusicPlayer";
import { safeGet, storageKey } from "@/lib/storage";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface InvidiousVideo {
  type: string; videoId: string; title: string; author: string;
  lengthSeconds: number; videoThumbnails: Array<{ quality: string; url: string }>;
}

const SEARCH_API = "https://api.barakzai.cloud/search";

async function searchInvidious(query: string): Promise<InvidiousVideo[]> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${SEARCH_API}?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = (await res.json()) as { results?: InvidiousVideo[]; error?: string };
    if (data.error) throw new Error(data.error);
    return data.results ?? [];
  } catch { clearTimeout(tid); throw new Error("Search unavailable"); }
}

function fmtDuration(s: number): string {
  if (s <= 0) return "";
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}` : `${m}:${String(sec).padStart(2,"0")}`;
}
function fmtTime(s: number): string { return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; }

function videoToTrack(v: InvidiousVideo): MusicTrack {
  return { youtubeId: v.videoId, title: v.title, artist: v.author, thumbnailUrl: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`, durationSeconds: v.lengthSeconds > 0 ? v.lengthSeconds : undefined };
}

async function fetchYTInfo(id: string) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (!r.ok) return { title: `Video ${id}`, ok: false };
    const d = (await r.json()) as { title?: string };
    return { title: typeof d.title === "string" && d.title ? d.title : `Video ${id}`, ok: true };
  } catch { return { title: `Video ${id}`, ok: true }; }
}


// Quick Modes
const QUICK_MODES = [
  { id: 'deep-focus', icon: Zap, label: 'mf_mode_deep_focus', desc: 'mf_mode_deep_focus_desc', query: 'Deep Focus Coding Music', color: 'bg-[var(--flow-study-bg)] text-[var(--flow-study)]' },
  { id: 'study', icon: BookOpen, label: 'mf_mode_study', desc: 'mf_mode_study_desc', query: 'Study Music Concentration', color: 'bg-[var(--flow-review-bg)] text-[var(--flow-review)]' },
  { id: 'relax', icon: Headphones, label: 'mf_mode_relax', desc: 'mf_mode_relax_desc', query: 'Calm Relaxing Music', color: 'bg-[var(--flow-analyze-bg)] text-[var(--flow-analyze)]' },
  { id: 'sleep', icon: Moon, label: 'mf_mode_sleep', desc: 'mf_mode_sleep_desc', query: 'Sleep Music Deep Calm', color: 'bg-[var(--flow-study-bg)] text-[var(--flow-study)]' },
  { id: 'workout', icon: Dumbbell, label: 'mf_mode_workout', desc: 'mf_mode_workout_desc', query: 'Workout Motivation Music', color: 'bg-[var(--flow-plan-bg)] text-[var(--flow-plan)]' },
  { id: 'family', icon: Users, label: 'mf_mode_family', desc: 'mf_mode_family_desc', query: 'Kids Music Family Friendly', color: 'bg-[var(--flow-career-bg)] text-[var(--flow-career)]' },
] as const;

// ─── localStorage migration ─────────────────────────────────────────────────
const MIGRATION_KEY = storageKey("music-migrated-to-db");
async function migrateLS() {
  if (safeGet<boolean>(MIGRATION_KEY, false)) return;
  try {
    const ex = await musicService.getPlaylists();
    if (ex.length > 0) { localStorage.setItem(MIGRATION_KEY, "true"); return; }
    const old = loadPlaylists();
    for (const o of old) { const c = await musicService.createPlaylist(o.name); for (const v of o.videos) await musicService.addTrackToPlaylist(c.id, { youtubeId: v.videoId, title: v.title, thumbnailUrl: v.thumbnail }); }
    const oh = loadOldHistory();
    for (const h of [...oh].reverse()) await musicService.addToHistory({ youtubeId: h.videoId, title: h.title });
    if (old.length > 0 || oh.length > 0) toast.success("Playlists synced to cloud ☁️");
    localStorage.setItem(MIGRATION_KEY, "true");
  } catch (e) { console.error("[Music migration]", e); }
}

// ─── Now Playing Card ───────────────────────────────────────────────────────

function NowPlayingCard() {
  const { t } = useT();
  const { currentTrack, isPlaying, volume, currentTime, duration, pause, resume, setVolume, playNext, playPrev } = useMusicPlayer();
  const { isShuffled, toggleShuffle } = usePlaylistPlayer();

  if (!currentTrack) return null;

  const isYT = currentTrack.type === "youtube";
  const title = isYT ? currentTrack.title : currentTrack.name;
  const thumb = isYT ? `https://i.ytimg.com/vi/${currentTrack.videoId}/hqdefault.jpg` : null;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <Card className="glass-card card-accent overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <p className="text-xs font-semibold">{t('mf_now_playing')}</p>
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        {thumb && <div className="px-4 pb-3"><div className="rounded-lg overflow-hidden aspect-square relative"><img src={thumb} alt={title} className="w-full h-full object-cover" /></div></div>}
        <div className="px-4 pb-2">
          <p className="text-sm font-semibold truncate">{title}</p>
          {isYT && <p className="text-[11px] text-muted-foreground truncate">YouTube</p>}
        </div>
        <div className="px-4 pb-1">
          <div className="w-full h-1 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{fmtTime(currentTime)}</span><span>{duration > 0 ? fmtTime(duration) : '--:--'}</span></div>
        </div>
        <div className="flex items-center justify-center gap-3 px-4 pb-3">
          <button type="button" onClick={toggleShuffle} className={cn("p-1.5", isShuffled ? "text-primary" : "text-muted-foreground hover:text-foreground")} title="Shuffle"><Shuffle className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={playPrev} className="p-1.5 text-muted-foreground hover:text-foreground" title="Previous"><SkipBack className="w-4 h-4" /></button>
          <button type="button" onClick={isPlaying ? pause : resume} className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90" title={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button type="button" onClick={playNext} className="p-1.5 text-muted-foreground hover:text-foreground" title="Next"><SkipForward className="w-4 h-4" /></button>
          <button type="button" className="p-1.5 text-muted-foreground" title="Repeat"><Repeat className="w-3.5 h-3.5" /></button>
        </div>
        <div className="flex items-center gap-2 px-4 pb-4"><Volume2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><input type="range" min={0} max={100} value={volume} onChange={e => setVolume(Number(e.target.value))} className="flex-1 h-1 accent-primary" title="Volume" /></div>
      </CardContent>
    </Card>
  );
}

// ─── Local Tab ──────────────────────────────────────────────────────────────

function LocalTab() {
  const { localTracks, currentTrack, isPlaying, playLocal, pause, resume, removeLocalTrack, addLocalTracks } = useMusicPlayer();
  const [isDragging, setIsDragging] = useState(false);
  const handleFiles = useCallback((files: FileList | null) => { if (files) addLocalTracks(Array.from(files)); }, [addLocalTracks]);
  const activeId = currentTrack?.type === "local" ? currentTrack.id : null;
  return (
    <div className="space-y-4">
      <label htmlFor="local-file-input" className={cn("block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors", isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}>
        <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium">Drop audio files or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">MP3, WAV, OGG, M4A, FLAC</p>
        <input id="local-file-input" type="file" accept=".mp3,.wav,.ogg,.m4a,.flac,audio/*" multiple className="sr-only" onChange={e => handleFiles(e.target.files)} />
      </label>
      {localTracks.length === 0 ? <p className="text-center text-sm text-muted-foreground py-4">No tracks yet</p> : (
        <div className="space-y-1">{localTracks.map((track, idx) => {
          const isActive = track.id === activeId;
          return (<div key={track.id} className={cn("flex items-center gap-3 px-4 py-3 rounded-lg group", isActive ? "bg-primary/10 border border-primary/30" : "hover:bg-secondary/30")}>
            <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{isActive ? <Music2 className={cn("h-3.5 w-3.5", isPlaying && "text-primary animate-pulse")} /> : idx + 1}</span>
            <button type="button" className="flex-1 text-left min-w-0" onClick={() => { if (isActive) { if (isPlaying) pause(); else resume(); } else playLocal(track); }}>
              <p className={cn("text-sm font-medium truncate", isActive && "text-primary")}>{track.name}</p>
            </button>
            <button type="button" aria-label={`Remove ${track.name}`} className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive" onClick={() => removeLocalTrack(track.id)}><Trash2 className="h-4 w-4" /></button>
          </div>);
        })}</div>
      )}
    </div>
  );
}

// ─── Create Playlist Modal ──────────────────────────────────────────────────

function CreatePlaylistModal({ videoTitle, onConfirm, onCancel }: Readonly<{ videoTitle: string; onConfirm: (n: string) => void; onCancel: () => void }>) {
  const [name, setName] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-2xl space-y-4">
        <div className="flex items-start justify-between"><div><p className="font-semibold">New Playlist</p><p className="text-xs text-muted-foreground mt-0.5 truncate max-w-52" title={videoTitle}>Adding: {videoTitle}</p></div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancel}><X className="h-4 w-4" /></Button></div>
        <Input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); if (e.key === 'Escape') onCancel(); }} placeholder="Playlist name…" />
        <div className="flex gap-2 justify-end"><Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button><Button size="sm" onClick={() => { if (name.trim()) onConfirm(name.trim()); }} disabled={!name.trim()}>Create & Add</Button></div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MusicPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { playYouTube, currentTrack, isPlaying, pause, resume } = useMusicPlayer();
  const { setPlaylistLabel } = usePlaylistPlayer();
  const { tasks } = useTasks();
  const { linkedTaskTitle, running: pomodoroRunning, phase: pomodoroPhase } = usePomodoroStore();

  const { data: dbPlaylists = [] } = usePlaylists();
  const { data: likedTracks = [] } = useLikedTracks();
  const { data: playHistory = [] } = usePlayHistory();
  const { mutate: addToHistory } = useAddToHistory();
  const { mutate: likeTrack } = useLikeTrack();
  const { mutate: unlikeTrack } = useUnlikeTrack();
  const { mutate: createPlaylistMut } = useCreatePlaylist();
  const { mutate: addTrackToPlaylist } = useAddTrackToPlaylist();

  const likedIds = useMemo(() => new Set(likedTracks.map(t2 => t2.youtubeId)), [likedTracks]);

  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activePlaylistTracks, setActivePlaylistTracks] = useState<PlaylistTrack[]>([]);
  const [, setPlaylistIdx] = useState(0);
  const [createForVideo, setCreateForVideo] = useState<InvidiousVideo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<InvidiousVideo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [visibleVideoId, setVisibleVideoId] = useState<string | null>(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPlName, setNewPlName] = useState("");

  const activePlaylistTracksRef = useRef<PlaylistTrack[]>([]);
  const isShuffledRef = useRef(false);
  const shuffleOrderRef = useRef<number[]>([]);

  const { isShuffled } = usePlaylistPlayer();
  useEffect(() => { activePlaylistTracksRef.current = activePlaylistTracks; }, [activePlaylistTracks]);
  useEffect(() => { isShuffledRef.current = isShuffled; }, [isShuffled]);
  useEffect(() => { void migrateLS(); }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setSearchError(null); setIsSearching(false); return; }
    setIsSearching(true); let cancelled = false;
    const timer = setTimeout(() => { searchInvidious(q).then(r => { if (!cancelled) { setSearchResults(r); setSearchError(null); } }).catch(() => { if (!cancelled) { setSearchResults([]); setSearchError("Search unavailable."); } }).finally(() => { if (!cancelled) setIsSearching(false); }); }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery]);

  const activeVideoId = currentTrack?.type === "youtube" ? currentTrack.videoId : null;

  // KPI computed data
  const listeningMins = useMemo(() => Math.round(playHistory.reduce((s, h) => s + (h.durationSeconds ?? 0), 0) / 60), [playHistory]);
  const listeningLabel = listeningMins >= 60 ? `${Math.floor(listeningMins / 60)}h ${listeningMins % 60}m` : `${listeningMins}m`;

  // ─── Handlers ──
  const handlePlay = useCallback((videoId: string, title: string, artist?: string) => {
    playYouTube(videoId, title); addToHistory({ youtubeId: videoId, title, artist });
  }, [playYouTube, addToHistory]);

  const handlePlayAll = useCallback((playlistId: string, tracks: PlaylistTrack[], startIdx = 0) => {
    if (tracks.length === 0) return;
    const order = tracks.map((_, i) => i);
    if (isShuffledRef.current) { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
    shuffleOrderRef.current = order; setActivePlaylistId(playlistId); setActivePlaylistTracks(tracks);
    const first = order[startIdx] ?? 0; setPlaylistIdx(first);
    setPlaylistLabel(dbPlaylists.find(p => p.id === playlistId)?.name ?? 'Playlist');
    const tr = tracks[first]; if (tr) playYouTube(tr.youtubeId, tr.title);
  }, [playYouTube, setPlaylistLabel, dbPlaylists]);

  const handleVideoEnded = useCallback(() => {
    const tracks = activePlaylistTracksRef.current; if (tracks.length === 0) return;
    const order = isShuffledRef.current ? shuffleOrderRef.current : tracks.map((_, i) => i);
    setPlaylistIdx(curr => { const pos = order.indexOf(curr); if (pos + 1 >= order.length) { setActivePlaylistId(null); setActivePlaylistTracks([]); setPlaylistLabel(null); return 0; }
      const ni = order[pos + 1]; const nt = tracks[ni]; if (nt) playYouTube(nt.youtubeId, nt.title); return ni; });
  }, [playYouTube, setPlaylistLabel]);

  const handleAddToPlaylist = useCallback((video: InvidiousVideo, playlistId: string | "new") => {
    if (playlistId === "new") { setCreateForVideo(video); return; }
    addTrackToPlaylist({ playlistId, track: videoToTrack(video) });
    toast(`Added to "${dbPlaylists.find(p => p.id === playlistId)?.name ?? 'playlist'}"`);
  }, [addTrackToPlaylist, dbPlaylists]);

  const handleCreateAndAdd = useCallback((name: string) => {
    const video = createForVideo; setCreateForVideo(null);
    if (!name.trim() || !video) return;
    createPlaylistMut({ name: name.trim() }, { onSuccess: (c) => { addTrackToPlaylist({ playlistId: c.id, track: videoToTrack(video) }); toast(`Created "${name.trim()}"`); } });
  }, [createForVideo, createPlaylistMut, addTrackToPlaylist]);

  const handleNewPlaylist = () => {
    const n = newPlName.trim(); if (!n) return;
    createPlaylistMut({ name: n }); setNewPlName(""); setShowNewPlaylist(false);
  };

  const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
  const fadeUp = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-28">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between py-5">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">{t('mf_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('mf_subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowNewPlaylist(true)}><Plus className="w-3.5 h-3.5" /> {t('mf_new_playlist')}</Button>
          <Button className="gap-1.5 text-xs" style={{ background: 'var(--gradient-primary)' }} onClick={() => document.getElementById('mf-upload')?.click()}>
            <Upload className="w-3.5 h-3.5" /> {t('mf_upload_audio')}</Button>
        </div>
      </motion.div>

      {/* Tabs */}
      <Tabs defaultValue="youtube" className="mb-4">
        <TabsList><TabsTrigger value="youtube" className="gap-1.5 text-xs sm:text-sm"><Play className="w-3 h-3" /> YouTube</TabsTrigger>
          <TabsTrigger value="local" className="gap-1.5 text-xs sm:text-sm"><Music2 className="w-3 h-3" /> My Music</TabsTrigger>
          <TabsTrigger value="playlists" className="gap-1.5 text-xs sm:text-sm"><ListMusic className="w-3 h-3" /> Playlists</TabsTrigger>
        </TabsList>

      <div className="flex flex-col lg:flex-row gap-5 lg:items-start mt-5">
      <div className="flex-1 min-w-0 space-y-5">

      {/* Audio playback is handled by the global MiniPlayer (AppLayout level) */}
      {/* Now Playing info is shown in the sidebar NowPlayingCard */}

      {/* KPI Cards */}
      <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Timer, label: t('mf_kpi_listening'), value: listeningLabel, sub: t('mf_kpi_listening_sub'), color: 'bg-[var(--flow-study-bg)] text-[var(--flow-study)]' },
          { icon: Zap, label: t('mf_kpi_focus'), value: String(pomodoroRunning ? 1 : 0), sub: t('mf_kpi_focus_sub'), color: 'bg-[var(--flow-analyze-bg)] text-[var(--flow-analyze)]' },
          { icon: BookOpen, label: t('mf_kpi_study'), value: String(likedTracks.length), sub: t('mf_kpi_study_sub'), color: 'bg-[var(--flow-plan-bg)] text-[var(--flow-plan)]' },
          { icon: FolderOpen, label: t('mf_kpi_playlists'), value: String(dbPlaylists.length), sub: t('mf_kpi_playlists_sub'), color: 'bg-[var(--flow-report-bg)] text-[var(--flow-report)]' },
        ].map(kpi => (
          <motion.div key={kpi.label} variants={fadeUp}>
            <Card className="glass-card card-accent surface-elevated"><CardContent className="p-3.5">
              <div className="flex items-center gap-2.5 mb-2"><div className={cn("icon-tile w-8 h-8 rounded-md", kpi.color)}><kpi.icon className="w-4 h-4" /></div>
                <span className="text-[10px] font-medium text-muted-foreground">{kpi.label}</span></div>
              <p className="text-xl font-bold tracking-tight">{kpi.value}</p>
              <p className="text-[10px] text-muted-foreground">{kpi.sub}</p>
            </CardContent></Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Search */}
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t('mf_search')} className="pl-10 pr-10" />
        <Filter className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /></div>

      {/* Quick Modes */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t('mf_quick_modes')}</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_MODES.map(m => (
            <button key={m.id} type="button" onClick={() => setSearchQuery(m.query)}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                searchQuery === m.query ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 text-muted-foreground border-border hover:text-foreground")}>
              <m.icon className="w-3 h-3" /> {t(m.label)}
            </button>
          ))}
        </div>
      </div>

      {/* YouTube Tab Content */}
      <TabsContent value="youtube" className="mt-0 space-y-5">
        {/* Search results */}
        {isSearching && <div className="grid grid-cols-2 gap-3">{[0,1,2,3].map(i => <div key={i} className="rounded-lg bg-secondary/30 animate-pulse"><div className="aspect-video bg-secondary/50 rounded-t-lg" /><div className="p-3 space-y-2"><div className="h-3 bg-secondary/50 rounded w-4/5" /><div className="h-3 bg-secondary/50 rounded w-3/5" /></div></div>)}</div>}
        {!isSearching && searchError && <p className="text-sm text-[var(--flow-career)] text-center py-3">{searchError}</p>}
        {!isSearching && searchResults.length > 0 && (
          <div className="grid grid-cols-2 gap-3">{searchResults.map(v => (
            <button key={v.videoId} type="button" onClick={() => handlePlay(v.videoId, v.title, v.author)}
              className={cn("rounded-lg border text-left overflow-hidden transition-colors", activeVideoId === v.videoId ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/30 hover:border-primary/20")}>
              <div className="relative aspect-video"><img src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt={v.title} className="w-full h-full object-cover" loading="lazy" />{v.lengthSeconds > 0 && <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] font-mono px-1 rounded">{fmtDuration(v.lengthSeconds)}</span>}</div>
              <div className="p-2.5"><p className="text-xs font-medium line-clamp-2 leading-snug">{v.title}</p><p className="text-[11px] text-muted-foreground truncate mt-0.5">{v.author}</p></div>
            </button>
          ))}</div>
        )}

        {/* Main content when not searching */}
        {!searchQuery.trim() && (
          <>
            {/* Focus Session Card */}
            <Card className="glass-card card-accent border-primary/20">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2.5"><div className="icon-tile w-7 h-7 rounded-md bg-primary/15"><Zap className="w-3.5 h-3.5 text-primary" /></div>
                  <span className="text-sm font-semibold">{t('mf_focus_session')}</span></div>
                {linkedTaskTitle ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">{t('mf_current_task')}</p>
                    <p className="text-sm font-medium">{linkedTaskTitle}</p>
                    {pomodoroRunning && <p className="text-xs text-primary">{pomodoroPhase === 'focus' ? '🎯 Focus' : pomodoroPhase === 'break' ? '☕ Break' : '🌿 Long Break'}</p>}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('mf_no_focus_task')}</p>
                )}
                <p className="text-[10px] text-muted-foreground">{t('mf_focus_hint')}</p>
              </CardContent>
            </Card>

            {/* Recently Played + Top Playlists */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="glass-card card-accent"><CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">{t('mf_recently_played')}</h3>
                {playHistory.length === 0 ? <p className="text-xs text-muted-foreground text-center py-6">{t('mf_no_history')}</p> : (
                  <div className="space-y-1">{playHistory.slice(0, 5).map((h, idx) => (
                    <button key={h.id} type="button" onClick={() => handlePlay(h.youtubeId, h.title, h.artist)}
                      className={cn("w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors", activeVideoId === h.youtubeId ? "bg-primary/10" : "hover:bg-secondary/30")}>
                      <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{idx + 1}</span>
                      <img src={h.thumbnailUrl ?? `https://i.ytimg.com/vi/${h.youtubeId}/mqdefault.jpg`} alt="" className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" />
                      <div className="flex-1 min-w-0"><p className="text-xs font-medium truncate">{h.title}</p>{h.artist && <p className="text-[10px] text-muted-foreground truncate">{h.artist}</p>}</div>
                      {h.durationSeconds && <span className="text-[10px] text-muted-foreground shrink-0">{fmtDuration(h.durationSeconds)}</span>}
                    </button>
                  ))}</div>
                )}
              </CardContent></Card>
              <Card className="glass-card card-accent"><CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">{t('music_top_playlists')}</h3>
                {dbPlaylists.length === 0 ? <p className="text-xs text-muted-foreground text-center py-6">{t('mf_no_playlists')}</p> : (
                  <div className="grid grid-cols-2 gap-2">{dbPlaylists.slice(0, 6).map(pl => (
                    <button key={pl.id} type="button" onClick={() => { musicService.getPlaylistTracks(pl.id).then(tracks => handlePlayAll(pl.id, tracks)).catch(() => {}); }}
                      className="flex items-center gap-2 rounded-lg bg-secondary/20 p-2 hover:bg-secondary/40 transition-colors text-left">
                      <div className="w-10 h-10 rounded-md bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0"><Play className="w-3.5 h-3.5 text-primary" /></div>
                      <div className="min-w-0"><p className="text-xs font-medium truncate">{pl.name}</p><p className="text-[10px] text-muted-foreground">{pl.trackCount} tracks</p></div>
                    </button>
                  ))}</div>
                )}
              </CardContent></Card>
            </div>

            {/* Recommended */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('mf_recommended')}</h3>
              <p className="text-sm text-muted-foreground">{t('mf_recommended_hint')}</p>
            </div>

            {/* Study Audio */}
            <Card className="glass-card card-accent"><CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Brain className="w-3.5 h-3.5 text-primary" /> {t('mf_study_audio')}</h3>
              </div>
              <div className="text-center py-6"><BookOpen className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" /><p className="text-xs text-muted-foreground">{t('mf_no_study_audio')}</p>
                <Button variant="outline" size="sm" className="mt-3 text-xs gap-1.5" onClick={() => navigate('/documents')}>
                  <ExternalLink className="w-3 h-3" /> {t('mf_generate_study_audio')}</Button></div>
            </CardContent></Card>
          </>
        )}

        {/* YouTube URL + visible video */}
        <div className="border-t border-border/40 pt-4 space-y-3">
          {visibleVideoId && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Now Playing</p>
                <button type="button" onClick={() => setVisibleVideoId(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <X className="w-3 h-3" /> Close video
                </button>
              </div>
              <iframe
                src={`https://www.youtube.com/embed/${visibleVideoId}?autoplay=0&rel=0&enablejsapi=1`}
                className="w-full rounded-xl border border-border"
                style={{ height: '360px' }}
                allow="encrypted-media; fullscreen"
                allowFullScreen
                title="YouTube video"
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('mf_paste_url')}</p>
          <div className="flex gap-2">
            <Input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = parseVideoId(urlInput.trim());
                if (v) fetchYTInfo(v).then(r => { handlePlay(v, r.title); setVisibleVideoId(v); setUrlInput(''); });
              }
            }} placeholder="https://youtube.com/watch?v=…" className="flex-1" />
            <Button onClick={() => {
              const v = parseVideoId(urlInput.trim());
              if (v) fetchYTInfo(v).then(r => { handlePlay(v, r.title); setVisibleVideoId(v); setUrlInput(''); });
            }} disabled={!urlInput.trim()}>Play</Button>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="local" className="mt-0"><LocalTab /></TabsContent>
      <TabsContent value="playlists" className="mt-0"><PlaylistsTab activePlaylistId={activePlaylistId} activeVideoId={activeVideoId} isPlaying={isPlaying} onPlayAll={handlePlayAll} /></TabsContent>

      </div>

      {/* Right Sidebar */}
      <div className="w-full lg:w-[300px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
        <NowPlayingCard />

        <Card className="glass-card card-accent"><CardContent className="p-4">
          <button type="button" className="flex items-center justify-between w-full text-sm font-semibold mb-2">
            <span>{t('mf_pomodoro')}</span></button>
          <PomodoroTimer />
        </CardContent></Card>

        {/* Quick Actions */}
        <Card className="glass-card card-accent"><CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-semibold mb-1">{t('mf_quick_actions')}</h3>
          <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => document.getElementById('mf-upload')?.click()}><Upload className="w-3.5 h-3.5 text-primary" /> {t('mf_upload_audio')}</Button>
          <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => setShowNewPlaylist(true)}><Plus className="w-3.5 h-3.5 text-[var(--flow-report)]" /> {t('mf_new_playlist')}</Button>
          <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => navigate('/documents')}><Brain className="w-3.5 h-3.5 text-[var(--flow-study)]" /> {t('mf_generate_study_audio')}</Button>
        </CardContent></Card>

        {/* Audio Library */}
        <Card className="glass-card card-accent"><CardContent className="p-4 space-y-2">
          <h3 className="text-sm font-semibold">{t('mf_audio_library')}</h3>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-muted-foreground"><FolderOpen className="w-3 h-3" /> {t('mf_kpi_playlists')}</span><span>{dbPlaylists.length}</span></div>
            <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-muted-foreground"><Heart className="w-3 h-3" /> {t('mf_liked_songs')}</span><span>{likedTracks.length}</span></div>
            <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 text-muted-foreground"><Clock className="w-3 h-3" /> {t('mf_recently_added')}</span><span>{playHistory.length}</span></div>
          </div>
        </CardContent></Card>
      </div>
      </div>
      </Tabs>

      <input id="mf-upload" type="file" title="Upload audio" accept=".mp3,.wav,.ogg,.m4a,.flac,audio/*" multiple className="sr-only" onChange={() => toast("Switch to My Music tab to upload files")} />

      {showNewPlaylist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 w-80 shadow-2xl space-y-4">
            <p className="font-semibold">{t('mf_new_playlist')}</p>
            <Input autoFocus value={newPlName} onChange={e => setNewPlName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleNewPlaylist(); if (e.key === 'Escape') setShowNewPlaylist(false); }} placeholder="Playlist name…" />
            <div className="flex gap-2 justify-end"><Button variant="ghost" size="sm" onClick={() => setShowNewPlaylist(false)}>Cancel</Button><Button size="sm" onClick={handleNewPlaylist} disabled={!newPlName.trim()}>Create</Button></div>
          </div>
        </div>
      )}

      {createForVideo && <CreatePlaylistModal videoTitle={createForVideo.title} onConfirm={handleCreateAndAdd} onCancel={() => setCreateForVideo(null)} />}
    </div>
  );
}
