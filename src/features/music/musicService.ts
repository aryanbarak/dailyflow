import { supabase } from '@/integrations/supabase/client';

// ── Interfaces ──

export interface MusicTrack {
  youtubeId: string;
  title: string;
  artist?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

export interface Playlist {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
  trackCount: number;
}

export interface PlaylistTrack extends MusicTrack {
  id: string;
  playlistId: string;
  position: number;
  addedAt: string;
}

export interface HistoryEntry extends MusicTrack {
  id: string;
  playedAt: string;
}

export interface LikedTrack extends MusicTrack {
  id: string;
  likedAt: string;
}

// ── Helpers ──

type Row = Record<string, unknown>;

async function getUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

function s(v: unknown): string { return (v ?? '') as string; }
function sn(v: unknown): string | undefined { return v == null ? undefined : v as string; }
function nn(v: unknown): number | undefined { return v == null ? undefined : v as number; }

function mapPlaylist(row: Row): Playlist {
  return {
    id: s(row.id), userId: s(row.user_id), name: s(row.name),
    description: (row.description as string) ?? null,
    coverUrl: (row.cover_url as string) ?? null,
    createdAt: s(row.created_at), updatedAt: s(row.updated_at),
    trackCount: 0,
  };
}

function mapTrack(row: Row): PlaylistTrack {
  return {
    id: s(row.id), playlistId: s(row.playlist_id),
    youtubeId: s(row.youtube_id), title: s(row.title),
    artist: sn(row.artist), thumbnailUrl: sn(row.thumbnail_url),
    durationSeconds: nn(row.duration_seconds),
    position: (row.position as number) ?? 0, addedAt: s(row.added_at),
  };
}

function mapHistory(row: Row): HistoryEntry {
  return {
    id: s(row.id), youtubeId: s(row.youtube_id), title: s(row.title),
    artist: sn(row.artist), thumbnailUrl: sn(row.thumbnail_url),
    durationSeconds: nn(row.duration_seconds), playedAt: s(row.played_at),
  };
}

function mapLiked(row: Row): LikedTrack {
  return {
    id: s(row.id), youtubeId: s(row.youtube_id), title: s(row.title),
    artist: sn(row.artist), thumbnailUrl: sn(row.thumbnail_url),
    durationSeconds: nn(row.duration_seconds), likedAt: s(row.liked_at),
  };
}

// ── Service ──

export const musicService = {
  // PLAYLISTS
  async getPlaylists(): Promise<Playlist[]> {
    const userId = await getUserId();
    const { data, error } = await supabase
      .from('playlists').select('*')
      .eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) throw error;
    const playlists = (data ?? []).map(r => mapPlaylist(r as Row));
    if (playlists.length > 0) {
      const { data: counts } = await supabase
        .from('playlist_tracks').select('playlist_id')
        .in('playlist_id', playlists.map(p => p.id));
      const cmap = new Map<string, number>();
      for (const r of (counts ?? [])) { const pid = s((r as Row).playlist_id); cmap.set(pid, (cmap.get(pid) ?? 0) + 1); }
      for (const p of playlists) p.trackCount = cmap.get(p.id) ?? 0;
    }
    return playlists;
  },

  async createPlaylist(name: string, description?: string): Promise<Playlist> {
    const userId = await getUserId();
    const { data, error } = await supabase
      .from('playlists').insert({ user_id: userId, name, description: description ?? null })
      .select().single();
    if (error) throw error;
    return { ...mapPlaylist(data as Row), trackCount: 0 };
  },

  async updatePlaylist(id: string, updates: { name?: string; description?: string; coverUrl?: string }): Promise<void> {
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.coverUrl !== undefined) patch.cover_url = updates.coverUrl;
    const { error } = await supabase.from('playlists').update(patch).eq('id', id);
    if (error) throw error;
  },

  async deletePlaylist(id: string): Promise<void> {
    const { error } = await supabase.from('playlists').delete().eq('id', id);
    if (error) throw error;
  },

  // PLAYLIST TRACKS
  async getPlaylistTracks(playlistId: string): Promise<PlaylistTrack[]> {
    const { data, error } = await supabase
      .from('playlist_tracks').select('*')
      .eq('playlist_id', playlistId).order('position');
    if (error) throw error;
    return (data ?? []).map(r => mapTrack(r as Row));
  },

  async addTrackToPlaylist(playlistId: string, track: MusicTrack): Promise<PlaylistTrack> {
    const userId = await getUserId();
    const { data: last } = await supabase
      .from('playlist_tracks').select('position')
      .eq('playlist_id', playlistId).order('position', { ascending: false }).limit(1);
    const nextPos = last && last.length > 0 ? ((last[0] as Row).position as number) + 1 : 0;
    const { data, error } = await supabase
      .from('playlist_tracks').insert({
        playlist_id: playlistId, user_id: userId, youtube_id: track.youtubeId, title: track.title,
        artist: track.artist ?? null, thumbnail_url: track.thumbnailUrl ?? null,
        duration_seconds: track.durationSeconds ?? null, position: nextPos,
      }).select().single();
    if (error) throw error;
    return mapTrack(data as Row);
  },

  async removeTrackFromPlaylist(trackId: string): Promise<void> {
    const { error } = await supabase.from('playlist_tracks').delete().eq('id', trackId);
    if (error) throw error;
  },

  // PLAY HISTORY
  async addToHistory(track: MusicTrack): Promise<void> {
    const userId = await getUserId();
    const { error } = await supabase.from('play_history').insert({
      user_id: userId, youtube_id: track.youtubeId, title: track.title,
      artist: track.artist ?? null, thumbnail_url: track.thumbnailUrl ?? null,
      duration_seconds: track.durationSeconds ?? null,
    });
    if (error) throw error;
    // Prune to last 50
    const { data: old } = await supabase
      .from('play_history').select('id').eq('user_id', userId)
      .order('played_at', { ascending: false }).range(50, 999);
    if (old && old.length > 0) {
      await supabase.from('play_history').delete().in('id', old.map(r => s((r as Row).id)));
    }
  },

  async getHistory(limit = 20): Promise<HistoryEntry[]> {
    const userId = await getUserId();
    const { data, error } = await supabase
      .from('play_history').select('*').eq('user_id', userId)
      .order('played_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map(r => mapHistory(r as Row));
  },

  // LIKED TRACKS
  async getLikedTracks(): Promise<LikedTrack[]> {
    const userId = await getUserId();
    const { data, error } = await supabase
      .from('liked_tracks').select('*').eq('user_id', userId)
      .order('liked_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(r => mapLiked(r as Row));
  },

  async likeTrack(track: MusicTrack): Promise<void> {
    const userId = await getUserId();
    const { error } = await supabase.from('liked_tracks').upsert({
      user_id: userId, youtube_id: track.youtubeId, title: track.title,
      artist: track.artist ?? null, thumbnail_url: track.thumbnailUrl ?? null,
      duration_seconds: track.durationSeconds ?? null,
    }, { onConflict: 'user_id,youtube_id', ignoreDuplicates: true });
    if (error) throw error;
  },

  async unlikeTrack(youtubeId: string): Promise<void> {
    const userId = await getUserId();
    const { error } = await supabase.from('liked_tracks').delete()
      .eq('user_id', userId).eq('youtube_id', youtubeId);
    if (error) throw error;
  },
};
