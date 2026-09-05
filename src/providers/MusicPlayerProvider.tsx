import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { createId } from "@/lib/id";
import {
  MusicPlayerContext,
  PRESETS,
  loadVolume,
  persistVolume,
  type ActiveTrack,
  type LocalTrack,
} from "@/hooks/useMusicPlayer";

const AUDIO_FORMATS = /\.(mp3|wav|ogg|m4a|flac)$/i;

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_FORMATS.test(file.name);
}

function makeLocalTrack(file: File): LocalTrack {
  return {
    type: "local",
    id: createId(),
    name: file.name.replace(/\.[^.]+$/, ""),
    objectUrl: URL.createObjectURL(file),
  };
}

function stopHtmlAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

export function MusicPlayerProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [currentTrack, setCurrentTrack] = useState<ActiveTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState<number>(loadVolume);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localTracksRef = useRef<LocalTrack[]>([]);
  const currentTrackRef = useRef<ActiveTrack | null>(null);
  const volumeRef = useRef<number>(loadVolume());

  useEffect(() => { localTracksRef.current = localTracks; }, [localTracks]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { volumeRef.current = volumeLevel; }, [volumeLevel]);

  useEffect(() => {
    const audio = new Audio();
    audio.volume = volumeRef.current / 100;
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => {
      if (currentTrackRef.current?.type === "local") setIsPlaying(true);
    };
    const onPause = () => {
      if (currentTrackRef.current?.type === "local") setIsPlaying(false);
    };
    const onEnded = () => {
      const ct = currentTrackRef.current;
      const lt = localTracksRef.current;
      if (ct?.type !== "local") return;
      const idx = lt.findIndex((t) => t.id === ct.id);
      const next = lt[idx + 1];
      if (next) {
        audio.src = next.objectUrl;
        audio.currentTime = 0;
        setCurrentTime(0);
        setDuration(0);
        setCurrentTrack(next);
        void audio.play();
      } else {
        setIsPlaying(false);
        setCurrentTime(0);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("loadedmetadata", onDurationChange);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("loadedmetadata", onDurationChange);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      stopHtmlAudio(audio);
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const track of localTracksRef.current) URL.revokeObjectURL(track.objectUrl);
    };
  }, []);

  const playYouTube = useCallback((videoId: string, title = "YouTube") => {
    stopHtmlAudio(audioRef.current);
    setCurrentTrack({ type: "youtube", videoId, title });
    setIsPlaying(true);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const playLocal = useCallback((track: LocalTrack) => {
    const audio = audioRef.current;
    if (!audio) return;

    setCurrentTrack(track);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    audio.pause();
    audio.src = track.objectUrl;
    audio.currentTime = 0;
    audio.volume = volumeRef.current / 100;
    void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, []);

  const pause = useCallback(() => {
    if (currentTrackRef.current?.type === "local") audioRef.current?.pause();
    if (currentTrackRef.current) setIsPlaying(false);
  }, []);

  const resume = useCallback(() => {
    const track = currentTrackRef.current;
    if (!track) return;
    if (track.type === "local") {
      void audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      return;
    }
    setIsPlaying(true);
  }, []);

  const stop = useCallback(() => {
    stopHtmlAudio(audioRef.current);
    setCurrentTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const setVolume = useCallback((v: number) => {
    const nextVolume = Math.max(0, Math.min(100, v));
    setVolumeLevel(nextVolume);
    persistVolume(nextVolume);
    if (audioRef.current) audioRef.current.volume = nextVolume / 100;
  }, []);

  const seek = useCallback((seconds: number) => {
    if (currentTrackRef.current?.type !== "local" || !audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const playNext = useCallback(() => {
    const ct = currentTrackRef.current;
    if (!ct) return;

    if (ct.type === "local") {
      const lt = localTracksRef.current;
      if (lt.length === 0) return;
      const idx = lt.findIndex((t) => t.id === ct.id);
      const next = lt[(idx + 1) % lt.length];
      if (next) {
        const audio = audioRef.current;
        if (audio) {
          audio.src = next.objectUrl;
          audio.currentTime = 0;
          void audio.play();
        }
        setCurrentTrack(next);
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(true);
      }
      return;
    }

    const idx = PRESETS.findIndex((p) => p.videoId === ct.videoId);
    const next = PRESETS[((idx < 0 ? 0 : idx) + 1) % PRESETS.length];
    setCurrentTrack({ type: "youtube", videoId: next.videoId, title: next.title });
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
  }, []);

  const playPrev = useCallback(() => {
    const ct = currentTrackRef.current;
    if (!ct) return;

    if (ct.type === "local") {
      const lt = localTracksRef.current;
      if (lt.length === 0) return;
      const idx = lt.findIndex((t) => t.id === ct.id);
      const prev = lt[(idx - 1 + lt.length) % lt.length];
      if (prev) {
        const audio = audioRef.current;
        if (audio) {
          audio.src = prev.objectUrl;
          audio.currentTime = 0;
          void audio.play();
        }
        setCurrentTrack(prev);
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(true);
      }
      return;
    }

    const idx = PRESETS.findIndex((p) => p.videoId === ct.videoId);
    const prev = PRESETS[((idx < 0 ? PRESETS.length : idx) - 1 + PRESETS.length) % PRESETS.length];
    setCurrentTrack({ type: "youtube", videoId: prev.videoId, title: prev.title });
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(true);
  }, []);

  const addLocalTracks = useCallback((files: File[]) => {
    const eligible = files.filter(isAudioFile);
    if (eligible.length === 0) return;
    const newTracks = eligible.map(makeLocalTrack);
    setLocalTracks((prev) => [...prev, ...newTracks]);
    if (!currentTrackRef.current && newTracks[0]) playLocal(newTracks[0]);
  }, [playLocal]);

  const removeLocalTrack = useCallback((id: string) => {
    setLocalTracks((prev) => {
      const hit = prev.find((t) => t.id === id);
      if (hit) URL.revokeObjectURL(hit.objectUrl);
      return prev.filter((t) => t.id !== id);
    });
    if (currentTrackRef.current?.type === "local" && currentTrackRef.current.id === id) stop();
  }, [stop]);

  const sourceType = currentTrack?.type ?? null;

  const ctxValue = useMemo(
    () => ({
      activeTrack: currentTrack,
      currentTrack,
      sourceType,
      isPlaying,
      volume: volumeLevel,
      currentTime,
      progress: currentTime,
      duration,
      localTracks,
      playYouTube,
      playLocal,
      pause,
      resume,
      stop,
      setVolume,
      seek,
      playNext,
      playPrev,
      addLocalTracks,
      removeLocalTrack,
    }),
    [
      currentTrack, sourceType, isPlaying, volumeLevel, currentTime, duration, localTracks,
      playYouTube, playLocal, pause, resume, stop, setVolume,
      seek, playNext, playPrev, addLocalTracks, removeLocalTrack,
    ],
  );

  return (
    <MusicPlayerContext.Provider value={ctxValue}>
      {children}
    </MusicPlayerContext.Provider>
  );
}
