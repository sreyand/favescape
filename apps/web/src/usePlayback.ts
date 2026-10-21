import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { PlaybackState, Track } from "./types";

export function usePlayback(
  tracks: Track[],
  onError: (message: string) => void,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const desiredPlay = useRef(false);
  const restoreTime = useRef(0);
  const hydrated = useRef(false);
  const lastSaved = useRef(0);
  const lastSaveError = useRef(0);
  const shuffleVisited = useRef(new Set<string>());
  const currentTrack = tracks.find((t) => t.id === currentId) ?? null;
  const savedState = useRef<PlaybackState>({
    trackIds: [],
    currentTrackId: null,
    position: 0,
    volume: 0.7,
  });
  savedState.current = {
    trackIds: queueIds,
    currentTrackId: currentId,
    position: time,
    volume,
    shuffle,
    repeat,
  };

  const persist = useCallback(() => {
    if (!hydrated.current) return;
    void api.playback(savedState.current).catch(() => {
      if (Date.now() - lastSaveError.current > 60000) {
        lastSaveError.current = Date.now();
        errorRef.current(
          "The playback queue could not be saved. Check that the local music server is running.",
        );
      }
    });
  }, []);
  const restore = useCallback((state: PlaybackState) => {
    hydrated.current = true;
    desiredPlay.current = false;
    audioRef.current?.pause();
    setPlaying(false);
    setQueueIds(state.trackIds ?? []);
    setCurrentId(state.currentTrackId ?? null);
    currentIdRef.current = state.currentTrackId ?? null;
    shuffleVisited.current = new Set(
      state.currentTrackId ? [state.currentTrackId] : [],
    );
    restoreTime.current = state.position ?? 0;
    setTime(state.position ?? 0);
    if (audioRef.current && audioRef.current.readyState >= 1)
      audioRef.current.currentTime = state.position ?? 0;
    setVolume(Math.min(1, Math.max(0, state.volume ?? 0.7)));
    setShuffle(state.shuffle ?? false);
    setRepeat(state.repeat ?? false);
  }, []);
  const hydrate = useCallback(
    (state: PlaybackState) => {
      if (!hydrated.current) restore(state);
    },
    [restore],
  );
  const play = useCallback((id: string, ids?: string[]) => {
    const track = tracksRef.current.find((t) => t.id === id);
    if (!track?.audioUrl) {
      errorRef.current(
        "Relink this track to a local audio file before playing.",
      );
      return;
    }
    if (ids) {
      setQueueIds([...new Set(ids.includes(id) ? ids : [id, ...ids])]);
      shuffleVisited.current = new Set([id]);
    } else
      setQueueIds((previous) =>
        previous.includes(id) ? previous : [...previous, id],
      );
    shuffleVisited.current.add(id);
    desiredPlay.current = true;
    if (currentIdRef.current === id) {
      void audioRef.current?.play().catch((error) => {
        if (error.name !== "AbortError")
          errorRef.current(
            "Your browser could not play this file. Try MP3 or WAV.",
          );
      });
    } else {
      restoreTime.current = 0;
      setTime(0);
      currentIdRef.current = id;
      setCurrentId(id);
    }
  }, []);
  const next = useCallback(() => {
    const playable = queueIds.filter((id) =>
      tracksRef.current.some((t) => t.id === id && t.audioUrl),
    );
    const index = playable.indexOf(currentId ?? "");
    let nextId: string | undefined;
    if (shuffle) {
      let remaining = playable.filter((id) => !shuffleVisited.current.has(id));
      if (!remaining.length && repeat) {
        shuffleVisited.current = new Set(currentId ? [currentId] : []);
        remaining = playable.filter((id) => !shuffleVisited.current.has(id));
        if (!remaining.length) remaining = playable;
      }
      nextId = remaining[Math.floor(Math.random() * remaining.length)];
    } else nextId = playable[index + 1] ?? (repeat ? playable[0] : undefined);
    if (nextId) {
      if (nextId === currentId && audioRef.current)
        audioRef.current.currentTime = 0;
      play(nextId);
    } else {
      desiredPlay.current = false;
      setPlaying(false);
      audioRef.current?.pause();
    }
  }, [queueIds, currentId, shuffle, repeat, play]);
  const nextRef = useRef(next);
  nextRef.current = next;
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!currentId) {
      const first =
        queueIds.find((id) =>
          tracksRef.current.some((t) => t.id === id && t.audioUrl),
        ) ?? tracksRef.current.find((t) => t.audioUrl)?.id;
      if (first) play(first);
      return;
    }
    if (!audio) return;
    if (audio.paused) {
      desiredPlay.current = true;
      void audio
        .play()
        .catch(() =>
          errorRef.current("Playback is unavailable for this file."),
        );
    } else {
      desiredPlay.current = false;
      audio.pause();
    }
  }, [currentId, queueIds, play]);
  const seek = useCallback((value: number) => {
    if (audioRef.current && Number.isFinite(value)) {
      audioRef.current.currentTime = value;
      setTime(value);
    }
  }, []);
  const previous = useCallback(() => {
    if ((audioRef.current?.currentTime ?? 0) > 3) {
      seek(0);
      return;
    }
    const index = queueIds.indexOf(currentId ?? "");
    const id = queueIds[Math.max(0, index - 1)];
    if (id) play(id);
  }, [queueIds, currentId, play, seek]);
  const replaceQueue = useCallback((ids: string[]) => {
    const unique = [...new Set(ids)];
    const current = currentIdRef.current;
    if (current && !unique.includes(current)) {
      const oldIndex = savedState.current.trackIds.indexOf(current);
      const next =
        unique[Math.min(Math.max(0, oldIndex), unique.length - 1)] ?? null;
      const resume = !!audioRef.current && !audioRef.current.paused;
      audioRef.current?.pause();
      desiredPlay.current = resume && !!next;
      restoreTime.current = 0;
      currentIdRef.current = next;
      setCurrentId(next);
      setTime(0);
    }
    setQueueIds(unique);
  }, []);
  const stop = useCallback(() => {
    desiredPlay.current = false;
    audioRef.current?.pause();
    currentIdRef.current = null;
    setCurrentId(null);
    setTime(0);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => {
      setTime(audio.currentTime);
      if (Date.now() - lastSaved.current > 5000) {
        lastSaved.current = Date.now();
        persist();
      }
    };
    const metadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      if (restoreTime.current > 0) {
        audio.currentTime = Math.min(
          restoreTime.current,
          audio.duration || restoreTime.current,
        );
        restoreTime.current = 0;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const ended = () => nextRef.current();
    const failed = () => {
      setPlaying(false);
      desiredPlay.current = false;
      errorRef.current(
        "This file could not be played. Check its format or relink the original file.",
      );
    };
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("loadedmetadata", metadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", failed);
    return () => {
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("loadedmetadata", metadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
      audio.pause();
    };
  }, [persist]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack?.audioUrl) {
      audio.removeAttribute("src");
      audio.load();
      setDuration(0);
      return;
    }
    audio.src = currentTrack.audioUrl;
    audio.load();
    if (desiredPlay.current)
      void audio.play().catch((error) => {
        if (error.name !== "AbortError") {
          setPlaying(false);
          errorRef.current(
            "Playback could not start. Try pressing play again.",
          );
        }
      });
  }, [currentTrack?.id, currentTrack?.audioUrl]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    const timer = setTimeout(persist, 500);
    return () => clearTimeout(timer);
  }, [currentId, queueIds, volume, shuffle, repeat, persist]);
  useEffect(() => {
    const save = () => {
      if (hydrated.current)
        void fetch("/api/playback", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savedState.current),
          keepalive: true,
        }).catch(() => {});
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
  return {
    audioRef,
    currentTrack,
    currentId,
    playing,
    time,
    duration,
    volume,
    setVolume,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    queueIds,
    play,
    toggle,
    next,
    previous,
    seek,
    hydrate,
    restore,
    replaceQueue,
    stop,
  };
}
export type Player = ReturnType<typeof usePlayback>;
export function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
