import { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Image, FolderOpen, Clock, Upload, Plus, Search, Heart, Camera,
  Users, Tag, CalendarDays, Sparkles, X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/common/StatCard";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePhotos } from "@/hooks/usePhotos";
import { useAlbums } from "@/hooks/useAlbums";
import { MasonryGrid } from "@/components/photos/MasonryGrid";
import { PhotoUploader } from "@/components/photos/PhotoUploader";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";
import { AlbumCard } from "@/components/photos/AlbumCard";
import { TimelineView } from "@/components/photos/TimelineView";
import {
  PhotoSearchBar,
  DEFAULT_FILTER,
  type PhotoFilterState,
} from "@/components/photos/PhotoSearchBar";
import { type Photo, thumbUrl, photosService } from "@/features/photos/photosService";
import { useT } from "@/i18n";
import { toast } from "sonner";

type TabId = "all" | "timeline" | "favorites" | "albums" | "people";

function matchesSearch(photo: Photo, q: string): boolean {
  const ql = q.toLowerCase();
  return (
    photo.fileName.toLowerCase().includes(ql) ||
    (photo.caption?.toLowerCase().includes(ql) ?? false) ||
    (photo.location?.toLowerCase().includes(ql) ?? false) ||
    photo.tags.some((t) => t.toLowerCase().includes(ql)) ||
    photo.tags.some((t) => t.startsWith("person:") && t.slice(7).toLowerCase().includes(ql))
  );
}

function sortPhotos(photos: Photo[], sort: PhotoFilterState["sort"]): Photo[] {
  if (sort === "oldest") return [...photos].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (sort === "name") return [...photos].sort((a, b) => a.fileName.localeCompare(b.fileName));
  return photos;
}

function applyFilters(photos: Photo[], f: PhotoFilterState): Photo[] {
  let result = photos;
  if (f.filter === "tagged") result = result.filter((p) => p.tags.length > 0);
  else if (f.filter === "untagged") result = result.filter((p) => p.tags.length === 0);
  const q = f.search.trim().toLowerCase();
  if (q) result = result.filter((p) => matchesSearch(p, q));
  if (f.dateFrom) result = result.filter((p) => p.createdAt.slice(0, 10) >= f.dateFrom);
  if (f.dateTo) result = result.filter((p) => p.createdAt.slice(0, 10) <= f.dateTo);
  if (f.tags.length > 0) {
    const lower = new Set(f.tags.map((t) => t.toLowerCase()));
    result = result.filter((p) => p.tags.some((t) => lower.has(t.toLowerCase())));
  }
  return sortPhotos(result, f.sort);
}

function groupByDate(photos: Photo[]): Array<{ date: string; label: string; photos: Photo[] }> {
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    const d = p.createdAt.slice(0, 10);
    const arr = map.get(d);
    if (arr) arr.push(p); else map.set(d, [p]);
  }
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return [...map.entries()].map(([date, photos]) => {
    let label = new Date(date + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (date === today) label = `Today · ${label}`;
    else if (date === yesterday) label = `Yesterday · ${label}`;
    return { date, label: `${label} · ${photos.length} photo${photos.length > 1 ? 's' : ''}`, photos };
  });
}

function groupByMonth(photos: Photo[]): Array<{ month: string; label: string; photos: Photo[] }> {
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    const m = p.createdAt.slice(0, 7);
    const arr = map.get(m);
    if (arr) arr.push(p); else map.set(m, [p]);
  }
  return [...map.entries()].map(([month, photos]) => {
    const d = new Date(month + '-01T00:00:00');
    const label = d.toLocaleDateString('en', { year: 'numeric', month: 'long' });
    return { month, label: `${label} · ${photos.length} photo${photos.length > 1 ? 's' : ''}`, photos };
  });
}

// DESIGN-AUDIT 1: avatar palette from the flow tokens (8 distinct hues).
const PERSON_COLORS = ['bg-[var(--flow-primary)]', 'bg-[var(--flow-plan)]', 'bg-[var(--flow-analyze)]', 'bg-[var(--flow-career)]', 'bg-[var(--flow-study)]', 'bg-[var(--flow-blue)]', 'bg-[var(--flow-cyan)]', 'bg-[var(--flow-review)]'];

export default function PhotosPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>("all");
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [filterState, setFilterState] = useState<PhotoFilterState>(DEFAULT_FILTER);
  const [heroSearch, setHeroSearch] = useState("");
  const [personFilter, setPersonFilter] = useState<string | null>(null);

  const { photos, isLoading, uploadQueue, aiTaggingIds, upload, remove, update } = usePhotos();
  const { albums, create: createAlbum, remove: removeAlbum } = useAlbums();

  // ── Computed data ──
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const todayMD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const thisMonthCount = useMemo(() =>
    photos.filter(p => p.createdAt.slice(0, 10) >= monthStart).length
  , [photos, monthStart]);

  const personTags = useMemo(() => {
    const map = new Map<string, Photo[]>();
    for (const p of photos) {
      for (const tag of p.tags) {
        if (tag.startsWith('person:')) {
          const name = tag.slice(7);
          const arr = map.get(name);
          if (arr) arr.push(p); else map.set(name, [p]);
        }
      }
    }
    return [...map.entries()]
      .map(([name, photos]) => ({ name, count: photos.length, photos }))
      .sort((a, b) => b.count - a.count);
  }, [photos]);

  const familyCount = useMemo(() =>
    personTags.reduce((s, p) => s + p.count, 0)
  , [personTags]);

  const favCount = useMemo(() => photos.filter(p => p.isFavorite).length, [photos]);

  const onThisDay = useMemo(() =>
    photos.filter(p => {
      const d = p.createdAt.slice(5, 10);
      return d === todayMD && p.createdAt.slice(0, 4) !== String(now.getFullYear());
    })
  , [photos, todayMD]);

  const highlights = useMemo(() => {
    const items: string[] = [];
    if (personTags.length > 0) items.push(t('photos_hl_person', { name: personTags[0].name, count: String(personTags[0].count) }));
    const newest = photos.reduce<string | null>((best, p) => {
      const d = p.takenAt ?? p.createdAt;
      return !best || d > best ? d : best;
    }, null);
    if (newest) items.push(t('photos_hl_newest', { date: newest.slice(0, 10) }));
    const allNonPersonTags = photos.flatMap(p => p.tags).filter(tg => !tg.startsWith('person:'));
    if (allNonPersonTags.length > 0) {
      const freq = new Map<string, number>();
      for (const tg of allNonPersonTags) freq.set(tg, (freq.get(tg) ?? 0) + 1);
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) items.push(t('photos_hl_tag', { tag: top[0], count: String(top[1]) }));
    }
    const totalTagCount = photos.reduce((s, p) => s + p.tags.length, 0);
    if (totalTagCount > 0) items.push(t('photos_hl_total_tags', { count: String(totalTagCount) }));
    return items;
  }, [photos, personTags, t]);

  // ── Filtered photos ──
  const basePhotos = useMemo(() => {
    if (activeAlbumId) return photos.filter(p => p.albumId === activeAlbumId);
    if (personFilter) return photos.filter(p => p.tags.includes(`person:${personFilter}`));
    if (tab === 'favorites') return photos.filter(p => p.isFavorite);
    return photos;
  }, [photos, activeAlbumId, personFilter, tab]);

  const searchedPhotos = useMemo(() => {
    if (!heroSearch.trim()) return basePhotos;
    return basePhotos.filter(p => matchesSearch(p, heroSearch));
  }, [basePhotos, heroSearch]);

  const filteredPhotos = useMemo(
    () => applyFilters(searchedPhotos, filterState),
    [searchedPhotos, filterState],
  );

  const allTags = useMemo(
    () => [...new Set(photos.flatMap((p) => p.tags))].sort(),
    [photos],
  );

  const dateGroups = useMemo(() => groupByDate(filteredPhotos), [filteredPhotos]);
  const monthGroups = useMemo(() => groupByMonth(filteredPhotos), [filteredPhotos]);

  const isInAlbumView = activeAlbumId !== null;

  // ── Handlers ──
  function handleUpload(files: File[]) {
    upload(files, activeAlbumId ?? null);
    setShowUploader(false);
  }

  function handlePhotoDelete(photo: Photo) {
    remove(photo);
    if (lightboxIndex !== null && filteredPhotos.length === 1) setLightboxIndex(null);
  }

  async function handleCreateAlbum() {
    const name = newAlbumName.trim();
    if (!name) return;
    await createAlbum(name);
    setNewAlbumName("");
    setCreatingAlbum(false);
  }

  const handleToggleFavorite = useCallback(async (photo: Photo) => {
    const newVal = !photo.isFavorite;
    try {
      await photosService.toggleFavorite(photo.id, newVal);
      await update(photo.id, {}); // trigger refresh via hook
      toast.success(newVal ? t('photos_fav_added') : t('photos_fav_removed'));
    } catch { toast.error(t('photos_fav_error')); }
  }, [update, t]);

  const handleGenerateStory = useCallback(() => {
    const recent = photos.slice(0, 10).map(p => {
      const parts = [p.fileName];
      if (p.caption) parts.push(p.caption);
      if (p.tags.length) parts.push(`tags: ${p.tags.join(', ')}`);
      return `- ${parts.join(' — ')}`;
    }).join('\n');
    const prompt = `Create a warm family memory story based on these recent photos:\n${recent}\n\nMake it personal, emotional, and highlight family moments.`;
    sessionStorage.setItem('flowai_initial_message', prompt);
    navigate('/chat');
  }, [photos, navigate]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between py-5">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">
            {isInAlbumView ? (albums.find(a => a.id === activeAlbumId)?.name ?? t('photos_album')) : t('photos_title')}
          </h1>
          {isInAlbumView ? (
            <button type="button" onClick={() => { setActiveAlbumId(null); setTab('all'); }} className="text-sm text-muted-foreground hover:text-foreground">
              ← {t('photos_back_all')}
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">{t('photos_subtitle')}</p>
          )}
        </div>
        <Button className="gap-2" style={{ background: 'var(--gradient-primary)' }} onClick={() => setShowUploader(v => !v)}>
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">{t('photos_upload')}</span>
        </Button>
      </motion.div>

      {(showUploader || uploadQueue.length > 0) && (
        <PhotoUploader uploadQueue={uploadQueue} onUpload={handleUpload} />
      )}

      {!isInAlbumView && (
        <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
        {/* Left column */}
        <div className="flex-1 min-w-0 space-y-4">

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Camera}
            label={t('photos_kpi_total')}
            tileClassName="bg-[var(--flow-report-bg)]"
            iconClassName="text-[var(--flow-report)]"
            value={photos.length}
            sub={t('photos_total')}
          />
          <StatCard
            icon={Users}
            label={t('photos_kpi_family')}
            tileClassName="bg-[var(--flow-study-bg)]"
            iconClassName="text-[var(--flow-study)]"
            value={personTags.length}
            sub={t('photos_family_members')}
          />
          <StatCard
            icon={FolderOpen}
            label={t('photos_kpi_albums')}
            tileClassName="bg-[var(--flow-review-bg)]"
            iconClassName="text-[var(--flow-review)]"
            value={albums.length}
            sub={t('photos_photo_albums')}
          />
          <StatCard
            icon={CalendarDays}
            label={t('photos_kpi_month')}
            tileClassName="bg-[var(--flow-career-bg)]"
            iconClassName="text-[var(--flow-career)]"
            value={thisMonthCount}
            sub={t('photos_new_memories')}
          />
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={heroSearch}
            onChange={e => setHeroSearch(e.target.value)}
            placeholder={t('photos_search_placeholder')}
            className="pl-10 pr-8"
          />
          {heroSearch && (
            <button type="button" title={t('photos_clear_search')} onClick={() => setHeroSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {([
            { id: 'all' as TabId, label: t('photos_tab_all'), icon: Image },
            { id: 'timeline' as TabId, label: t('photos_tab_timeline'), icon: Clock },
            { id: 'favorites' as TabId, label: t('photos_tab_favorites'), icon: Heart },
            { id: 'albums' as TabId, label: t('photos_tab_albums'), icon: FolderOpen },
            { id: 'people' as TabId, label: t('photos_tab_people'), icon: Users },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTab(id); setPersonFilter(null); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
                tab === id ? 'bg-primary text-primary-foreground' : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/60'
              )}
            >
              <Icon className="w-3 h-3" /> {label}
            </button>
          ))}
        </div>

        {/* Person filter indicator */}
        {personFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('photos_filtered_by')}:</span>
            <Badge variant="outline" className="text-xs gap-1">{personFilter}</Badge>
            <button type="button" onClick={() => { setPersonFilter(null); setTab('all'); }} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
          </div>
        )}

        {/* TAB: All Photos */}
        {(tab === 'all' || personFilter) && (
          <>
            <PhotoSearchBar value={filterState} onChange={setFilterState} allTags={allTags} />
            {isLoading ? (
              <div className="columns-1 sm:columns-2 lg:columns-3 gap-3">
                {[0,1,2,3,4,5].map(k => <div key={k} className="rounded-lg bg-slate-800 animate-pulse mb-3 h-48" />)}
              </div>
            ) : filteredPhotos.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <Image className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">{t('photos_no_photos')}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {dateGroups.map(group => (
                  <div key={group.date}>
                    <p className="text-xs font-medium text-muted-foreground mb-2">{group.label}</p>
                    <MasonryGrid
                      photos={group.photos}
                      aiTaggingIds={aiTaggingIds}
                      onPhotoClick={(_p, idx) => {
                        const globalIdx = filteredPhotos.indexOf(group.photos[idx]);
                        setLightboxIndex(globalIdx >= 0 ? globalIdx : idx);
                      }}
                      onPhotoDelete={handlePhotoDelete}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* TAB: Timeline */}
        {tab === 'timeline' && !personFilter && (
          <>
            {monthGroups.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <Clock className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">{t('photos_no_photos')}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {monthGroups.map(group => (
                  <Card key={group.month} className="glass-card card-accent">
                    <CardContent className="p-4 space-y-3">
                      <h3 className="text-sm font-semibold">{group.label}</h3>
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {group.photos.slice(0, 8).map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              const idx = filteredPhotos.indexOf(p);
                              setLightboxIndex(idx >= 0 ? idx : 0);
                            }}
                            className="shrink-0 w-20 h-20 rounded-lg overflow-hidden"
                          >
                            <img src={thumbUrl(p)} alt={p.caption ?? p.fileName} className="w-full h-full object-cover" loading="lazy" />
                          </button>
                        ))}
                        {group.photos.length > 8 && (
                          <div className="shrink-0 w-20 h-20 rounded-lg bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground">
                            +{group.photos.length - 8}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* TAB: Favorites */}
        {tab === 'favorites' && !personFilter && (
          <>
            {filteredPhotos.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <Heart className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">{t('photos_no_favorites')}</p>
              </div>
            ) : (
              <MasonryGrid
                photos={filteredPhotos}
                aiTaggingIds={aiTaggingIds}
                onPhotoClick={(_p, idx) => setLightboxIndex(idx)}
                onPhotoDelete={handlePhotoDelete}
                onToggleFavorite={handleToggleFavorite}
              />
            )}
          </>
        )}

        {/* TAB: Albums */}
        {tab === 'albums' && !personFilter && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{albums.length} {t('photos_tab_albums')}</p>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { setCreatingAlbum(true); setNewAlbumName(''); }}>
                <Plus className="h-3 w-3" /> {t('photos_new_album')}
              </Button>
            </div>
            {creatingAlbum && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/20 border border-border">
                <Input autoFocus value={newAlbumName} onChange={e => setNewAlbumName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleCreateAlbum(); if (e.key === 'Escape') setCreatingAlbum(false); }}
                  placeholder={t('photos_album_name')} className="flex-1 h-8 text-sm" />
                <Button size="sm" className="h-8" onClick={() => void handleCreateAlbum()} disabled={!newAlbumName.trim()}>{t('photos_create')}</Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setCreatingAlbum(false)}>{t('photos_cancel')}</Button>
              </div>
            )}
            {albums.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {albums.map(album => (
                  <AlbumCard key={album.id} album={album}
                    coverPhoto={photos.find(p => p.albumId === album.id) ?? null}
                    photoCount={photos.filter(p => p.albumId === album.id).length}
                    onClick={() => { setActiveAlbumId(album.id); setTab('all'); }}
                    onDelete={() => removeAlbum(album.id)} />
                ))}
              </div>
            ) : !creatingAlbum && (
              <div className="text-center py-16 space-y-2">
                <FolderOpen className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">{t('photos_no_albums')}</p>
              </div>
            )}
          </div>
        )}

        {/* TAB: People */}
        {tab === 'people' && !personFilter && (
          <div className="space-y-4">
            {personTags.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <Users className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">{t('photos_no_people')}</p>
                <p className="text-xs text-muted-foreground">{t('photos_people_hint')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {personTags.map((person, idx) => (
                  <motion.button
                    key={person.name}
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    onClick={() => { setPersonFilter(person.name); setTab('all'); }}
                    className="glass-card card-accent rounded-xl p-4 text-left space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white', PERSON_COLORS[idx % PERSON_COLORS.length])}>
                        {person.name[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{person.name}</p>
                        <p className="text-[10px] text-muted-foreground">{person.count} {t('photos_photos')}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {person.photos.slice(0, 3).map(p => (
                        <div key={p.id} className="w-10 h-10 rounded-md overflow-hidden">
                          <img src={thumbUrl(p)} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      ))}
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        )}

        </div>

        {/* Right sidebar */}
        <div className="w-full lg:w-[280px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">

          {/* On This Day */}
          <Card className="glass-card card-accent border-career/20">
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><CalendarDays className="w-3.5 h-3.5 text-[var(--flow-career)]" /> {t('photos_on_this_day')}</h3>
              {onThisDay.length > 0 ? (
                <>
                  <div className="flex gap-2">
                    {onThisDay.slice(0, 3).map(p => (
                      <div key={p.id} className="w-16 h-16 rounded-lg overflow-hidden">
                        <img src={thumbUrl(p)} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('photos_years_ago', { count: String(onThisDay.length) })}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t('photos_no_this_day')}</p>
              )}
            </CardContent>
          </Card>

          {/* AI Highlights */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-primary" /> {t('photos_highlights')}</h3>
              {highlights.length > 0 ? (
                <ul className="space-y-1.5">
                  {highlights.map((h, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">•</span>{h}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t('photos_no_highlights')}</p>
              )}
              <Button variant="outline" size="sm" className="w-full text-xs gap-1.5" onClick={handleGenerateStory}>
                <Sparkles className="w-3 h-3" /> {t('photos_generate_story')}
              </Button>
            </CardContent>
          </Card>

          {/* People (avatar grid) */}
          {personTags.length > 0 && (
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="w-3.5 h-3.5 text-primary" /> {t('photos_tab_people')}</h3>
                <div className="flex flex-wrap gap-3">
                  {personTags.map((p, i) => (
                    <button key={p.name} type="button" onClick={() => { setPersonFilter(p.name); setTab('all'); }}
                      className="flex flex-col items-center gap-1 group" title={`${p.name} (${p.count})`}>
                      <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white transition-transform group-hover:scale-110', PERSON_COLORS[i % PERSON_COLORS.length])}>
                        {p.name[0].toUpperCase()}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{p.name}</span>
                      <span className="text-[9px] text-muted-foreground/60">({p.count})</span>
                    </button>
                  ))}
                </div>
                {personTags.length > 6 && (
                  <button type="button" onClick={() => setTab('people')} className="text-xs text-primary hover:underline w-full text-center">
                    {t('photos_view_all')} →
                  </button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Albums (compact) */}
          {albums.length > 0 && (
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2"><FolderOpen className="w-3.5 h-3.5 text-primary" /> {t('photos_tab_albums')}</h3>
                <div className="space-y-1.5">
                  {albums.slice(0, 4).map(album => (
                    <button key={album.id} type="button" onClick={() => { setActiveAlbumId(album.id); setTab('all'); }}
                      className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/30 transition-colors">
                      <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs flex-1 text-left truncate">{album.name}</span>
                      <span className="text-[10px] text-muted-foreground">{photos.filter(p => p.albumId === album.id).length}</span>
                    </button>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="w-full text-xs gap-1" onClick={() => { setCreatingAlbum(true); setTab('albums'); }}>
                  <Plus className="w-3 h-3" /> {t('photos_new_album')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold mb-1">{t('photos_quick_actions')}</h3>
              <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => setShowUploader(true)}>
                <Upload className="w-3.5 h-3.5 text-[var(--flow-report)]" /> {t('photos_upload')}
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => { setCreatingAlbum(true); setTab('albums'); }}>
                <Plus className="w-3.5 h-3.5 text-[var(--flow-review)]" /> {t('photos_create_album')}
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={() => setTab('favorites')}>
                <Heart className="w-3.5 h-3.5 text-[var(--flow-plan)]" /> {t('photos_tab_favorites')}
              </Button>
            </CardContent>
          </Card>
        </div>
        </div>
      )}

      {/* Album view (full width, no sidebar) */}
      {isInAlbumView && (
        <>
          <PhotoSearchBar value={filterState} onChange={setFilterState} allTags={allTags} />
          {isLoading ? (
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-3">
              {[0,1,2,3,4,5].map(k => <div key={k} className="rounded-lg bg-slate-800 animate-pulse mb-3 h-48" />)}
            </div>
          ) : filteredPhotos.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <Image className="h-12 w-12 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">{t('photos_no_photos')}</p>
            </div>
          ) : (
            <MasonryGrid
              photos={filteredPhotos}
              aiTaggingIds={aiTaggingIds}
              onPhotoClick={(_p, idx) => setLightboxIndex(idx)}
              onPhotoDelete={handlePhotoDelete}
              onToggleFavorite={handleToggleFavorite}
            />
          )}
        </>
      )}

      {lightboxIndex !== null && filteredPhotos[lightboxIndex] && (
        <PhotoLightbox
          photos={filteredPhotos}
          initialIndex={lightboxIndex}
          albums={albums}
          onClose={() => setLightboxIndex(null)}
          onDelete={handlePhotoDelete}
          onUpdate={update}
        />
      )}
    </div>
  );
}
