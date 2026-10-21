export type Point = { x: number; y: number };
export type AudioFeatures = {
  tempo: number | null;
  brightness: number | null;
  rms: number | null;
};
export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  genres: string[];
  duration: number;
  artwork: string | null;
  color: string;
  audioUrl: string | null;
  isDemo: boolean;
  addedAt: string;
  enjoyment: number | null;
  moodRatings: Record<string, number>;
  moodNotes: Record<string, string>;
  analysisStatus: "pending" | "running" | "ready" | "failed";
  analysisError: string | null;
  features: AudioFeatures | null;
  position: Point | null;
};
export type Mood = {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
};
export type Connection = {
  id: string;
  sourceId: string;
  targetId: string;
  reason: string;
  origin: "user" | "model";
};
export type Group = { id: string; name: string; trackIds: string[] };
export type PlaybackState = {
  trackIds: string[];
  currentTrackId: string | null;
  position: number;
  volume: number;
  shuffle?: boolean;
  repeat?: boolean;
};
export type Library = {
  tracks: Track[];
  moods: Mood[];
  connections: Connection[];
  groups: Group[];
  layoutRevision: number;
  playback: PlaybackState;
};
export type TasteSession = {
  id: string;
  moodId: string;
  trackIds: string[];
  requestedDuration: number;
  actualDuration: number;
  reasons: Record<string, string>;
  message: string;
  seed: number;
  method: string;
};
export type Toast = { id: number; message: string; kind?: "error" | "success" };
