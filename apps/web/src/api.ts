import type {
  Library,
  Track,
  Mood,
  Group,
  Connection,
  PlaybackState,
  TasteSession,
  Point,
} from "./types";
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const body = await response.json();
      message =
        typeof body.detail === "string"
          ? body.detail
          : body.message || `Request failed (${response.status}).`;
    } catch {
      message =
        response.status === 502
          ? "The local music server is not running."
          : `Request failed (${response.status}).`;
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
export const api = {
  library: () => request<Library>("/library"),
  upload: (files: File[]) => {
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    return request<{ tracks: Track[]; errors: string[] }>("/tracks/import", {
      method: "POST",
      body,
    });
  },
  track: (
    id: string,
    patch: Partial<Pick<Track, "title" | "artist" | "genres" | "enjoyment">>,
  ) =>
    request<Track>(`/tracks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  removeTrack: (id: string) =>
    request<{ ok: boolean }>(`/tracks/${id}`, { method: "DELETE" }),
  moodRating: (id: string, moodId: string, score: number, note?: string) =>
    request<Track>(`/tracks/${id}/mood-ratings`, {
      method: "POST",
      body: JSON.stringify({ moodId, score, note }),
    }),
  removeMoodRating: (id: string, moodId: string) =>
    request<Track>(`/tracks/${id}/mood-ratings/${moodId}`, {
      method: "DELETE",
    }),
  addMood: (label: string, color?: string) =>
    request<Mood>("/moods", {
      method: "POST",
      body: JSON.stringify({ label, color }),
    }),
  group: (name: string, trackIds: string[]) =>
    request<Group>("/groups", {
      method: "POST",
      body: JSON.stringify({ name, trackIds }),
    }),
  removeGroup: (id: string) =>
    request<{ ok: boolean }>(`/groups/${id}`, { method: "DELETE" }),
  connect: (sourceId: string, targetId: string, reason: string) =>
    request<Connection>("/connections", {
      method: "POST",
      body: JSON.stringify({ sourceId, targetId, reason }),
    }),
  disconnect: (id: string) =>
    request<{ ok: boolean }>(`/connections/${id}`, { method: "DELETE" }),
  positions: (trackId: string, point: Point, revision: number) =>
    request<{ layoutRevision: number }>("/positions", {
      method: "PUT",
      body: JSON.stringify({ positions: [{ trackId, ...point }], revision }),
    }),
  resetPositions: () =>
    request<{ layoutRevision: number }>("/positions", { method: "DELETE" }),
  playback: (state: PlaybackState) =>
    request<PlaybackState>("/playback", {
      method: "PUT",
      body: JSON.stringify(state),
    }),
  tasteplay: (moodId: string, durationMinutes: number, seed?: number) =>
    request<TasteSession>("/tasteplay", {
      method: "POST",
      body: JSON.stringify({ moodId, durationMinutes, seed }),
    }),
  feedback: (
    trackId: string,
    moodId: string,
    sessionId: string,
    value: "great_fit" | "wrong_mood",
  ) =>
    request<{ id: string }>("/feedback", {
      method: "POST",
      body: JSON.stringify({ trackId, moodId, sessionId, value }),
    }),
  sessions: () => request<{ sessions: TasteSession[] }>("/sessions"),
  saveSession: (id: string, trackIds: string[]) =>
    request<TasteSession>(`/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ trackIds }),
    }),
  exportMap: () => request<unknown>("/export"),
  importMap: (document: unknown) =>
    request<Library>("/import", {
      method: "POST",
      body: JSON.stringify(document),
    }),
  analyze: (id: string) =>
    request<{ id: string }>(`/tracks/${id}/analyze`, { method: "POST" }),
};
