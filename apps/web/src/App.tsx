import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  Disc3,
  FileJson,
  FolderHeart,
  Headphones,
  Library as LibraryIcon,
  ListMusic,
  LoaderCircle,
  Map as MapIcon,
  Music2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { api, ApiError } from "./api";
import type { Library, Point, TasteSession, Toast, Track } from "./types";
import { usePlayback, formatTime } from "./usePlayback";
import MusicMap from "./components/MusicMap";
import TrackInspector from "./components/TrackInspector";
import PlayerBar from "./components/PlayerBar";
import TastePlayView from "./components/TastePlayView";
import LibraryView from "./components/LibraryView";
import Dialog from "./components/Dialog";

type Tab = "map" | "library" | "tasteplay";
type Modal = "import" | "edit" | "mood" | "group" | "about" | null;
const EMPTY: Library = {
  tracks: [],
  moods: [],
  connections: [],
  groups: [],
  layoutRevision: 0,
  playback: { trackIds: [], currentTrackId: null, position: 0, volume: 0.7 },
};

export default function App() {
  const [library, setLibrary] = useState<Library>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("map");
  const [mode, setMode] = useState<"mood" | "sound" | "metrics">("mood");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [genre, setGenre] = useState("All tracks");
  const [activeMoodId, setActiveMoodId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [search, setSearch] = useState("");
  const [mapSearchOpen, setMapSearchOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [session, setSession] = useState<TasteSession | null>(null);
  const [sessions, setSessions] = useState<TasteSession[]>([]);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [queueSessionId, setQueueSessionId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [importing, setImporting] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const mapImportRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef(0);
  const positionChain = useRef(Promise.resolve());
  const notify = useCallback(
    (message: string, kind: Toast["kind"] = "success") => {
      const id = Date.now() + Math.random();
      setToasts((items) => [...items.slice(-2), { id, message, kind }]);
      setTimeout(
        () => setToasts((items) => items.filter((item) => item.id !== id)),
        kind === "error" ? 8000 : 4000,
      );
    },
    [],
  );
  const player = usePlayback(library.tracks, (message) =>
    notify(message, "error"),
  );
  const hydrateRef = useRef(player.hydrate);
  hydrateRef.current = player.hydrate;
  const reload = useCallback(async () => {
    const data = await api.library();
    revisionRef.current = data.layoutRevision;
    setLibrary(data);
    return data;
  }, []);
  useEffect(() => {
    let cancelled = false;
    api
      .library()
      .then((data) => {
        if (cancelled) return;
        revisionRef.current = data.layoutRevision;
        setLibrary(data);
        hydrateRef.current(data.playback);
        setSelectedId(data.tracks[0]?.id ?? null);
        setLoadError("");
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void api
      .sessions()
      .then((data) => {
        if (!cancelled) setSessions(data.sessions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const pending = library.tracks.some(
    (t) => t.analysisStatus === "pending" || t.analysisStatus === "running",
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      void reload().catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [pending, reload]);
  const selected = library.tracks.find((t) => t.id === selectedId) ?? null;
  const genres = useMemo(
    () => ["All tracks", ...new Set(library.tracks.flatMap((t) => t.genres))],
    [library.tracks],
  );
  const visible = useMemo(
    () =>
      library.tracks.filter((track) => {
        if (genre !== "All tracks" && !track.genres.includes(genre))
          return false;
        if (
          groupId &&
          !library.groups
            .find((group) => group.id === groupId)
            ?.trackIds.includes(track.id)
        )
          return false;
        const needle = search.trim().toLowerCase();
        return (
          !needle ||
          `${track.title} ${track.artist} ${track.genres.join(" ")}`
            .toLowerCase()
            .includes(needle)
        );
      }),
    [library, genre, groupId, search],
  );
  const queueTracks = player.queueIds
    .map((id) => library.tracks.find((track) => track.id === id))
    .filter((t): t is Track => !!t);
  const demoOnly =
    library.tracks.length > 0 && library.tracks.every((track) => track.isDemo);

  function replaceTrack(track: Track) {
    setLibrary((current) => ({
      ...current,
      tracks: current.tracks.map((old) => (old.id === track.id ? track : old)),
    }));
  }
  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
        "error",
      );
    }
  }
  function playTrack(id: string, ids?: string[]) {
    setSelectedId(id);
    setQueueSessionId(null);
    player.play(id, ids ?? visible.filter((t) => t.audioUrl).map((t) => t.id));
  }
  async function upload(files: File[]) {
    if (!files.length) return;
    setImporting(true);
    setDropActive(false);
    await run(async () => {
      const result = await api.upload(files);
      await reload();
      if (result.tracks.length) {
        setSelectedId(result.tracks[0].id);
        setModal(null);
        notify(
          `${result.tracks.length} track${result.tracks.length === 1 ? "" : "s"} added. Your world just got bigger.`,
        );
      }
      if (result.errors.length) notify(result.errors.join(" "), "error");
    });
    setImporting(false);
  }
  const enjoyment = (id: string, score: number | null) =>
    void run(async () =>
      replaceTrack(await api.track(id, { enjoyment: score })),
    );
  const moodRating = (
    id: string,
    moodId: string,
    score: number,
    note?: string,
  ) =>
    void run(async () =>
      replaceTrack(await api.moodRating(id, moodId, score, note)),
    );
  function savePosition(id: string, point: Point) {
    setLibrary((current) => ({
      ...current,
      tracks: current.tracks.map((t) =>
        t.id === id ? { ...t, position: point } : t,
      ),
    }));
    positionChain.current = positionChain.current
      .then(async () => {
        try {
          const result = await api.positions(id, point, revisionRef.current);
          revisionRef.current = result.layoutRevision;
          setLibrary((current) => ({
            ...current,
            layoutRevision: result.layoutRevision,
          }));
        } catch (error) {
          await reload();
          notify(
            error instanceof ApiError && error.status === 409
              ? "The map changed elsewhere. Reloaded the saved arrangement."
              : "Could not save that position. Restored the saved map.",
            "error",
          );
        }
      })
      .catch(() => {});
  }
  async function generate(moodId: string, duration: number) {
    await run(async () => {
      const result = await api.tasteplay(moodId, duration);
      setSession(result);
      setActiveMoodId(moodId);
      setSessions((current) => [
        result,
        ...current.filter((s) => s.id !== result.id),
      ]);
      notify("Your next journey is ready.");
    });
  }
  function startSession() {
    if (!session) return;
    const first = session.trackIds.find((id) =>
      library.tracks.some((t) => t.id === id && t.audioUrl),
    );
    if (first) {
      if (first === player.currentId) player.seek(0);
      player.play(first, session.trackIds);
      setQueueSessionId(session.id);
      setSelectedId(first);
    }
  }
  function editSession(ids: string[]) {
    if (!session) return;
    void run(async () => {
      const updated = await api.saveSession(session.id, ids);
      setSession(updated);
      setSessions((current) =>
        current.map((s) => (s.id === updated.id ? updated : s)),
      );
      if (queueSessionId === updated.id) player.replaceQueue(ids);
    });
  }
  function editPlaybackQueue(ids: string[]) {
    player.replaceQueue(ids);
    if (session && queueSessionId === session.id) editSession(ids);
  }
  function moveQueue(index: number, direction: number) {
    const ids = [...player.queueIds];
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    editPlaybackQueue(ids);
  }
  async function exportMap() {
    await run(async () => {
      const data = await api.exportMap();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `favescape-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Map exported. Audio stays on your computer.");
    });
  }
  async function importMap(file: File) {
    await run(async () => {
      const data = await api.importMap(JSON.parse(await file.text()));
      setLibrary(data);
      revisionRef.current = data.layoutRevision;
      player.restore(data.playback);
      setQueueSessionId(null);
      setSession(null);
      setSelectedId(data.tracks[0]?.id ?? null);
      setSessions((await api.sessions()).sessions);
      notify(
        "Map imported. Add matching audio files to relink missing tracks.",
      );
    });
  }
  function navigate(value: Tab) {
    setTab(value);
    setSearch("");
    setGenre("All tracks");
    setGroupId("");
  }
  return (
    <div
      className={`app ${dropActive ? "drop-active" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropActive(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <audio ref={player.audioRef} preload="metadata" />
      <input
        ref={importRef}
        className="sr-only"
        type="file"
        multiple
        accept="audio/*,.flac,.aiff,.aif,.m4a"
        aria-label="Import local audio"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []));
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={mapImportRef}
        className="sr-only"
        type="file"
        accept=".json,application/json"
        aria-label="Import a saved map"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importMap(file);
          e.currentTarget.value = "";
        }}
      />
      <header className="app-header">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("map");
          }}
          aria-label="Favescape home"
        >
          Favescape<span>✦</span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={tab === "map" ? "active" : ""}
            onClick={() => navigate("map")}
          >
            <MapIcon size={16} />
            <span>My map</span>
          </button>
          <button
            className={tab === "library" ? "active" : ""}
            onClick={() => navigate("library")}
          >
            <LibraryIcon size={16} />
            <span>Library</span>
          </button>
          <button
            className={tab === "tasteplay" ? "active" : ""}
            onClick={() => navigate("tasteplay")}
          >
            <Sparkles size={16} />
            <span>TastePlay</span>
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="primary-button import-button"
            onClick={() => setModal("import")}
            disabled={importing}
          >
            {importing ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Plus size={18} />
            )}
            <span>Add tracks</span>
          </button>
        </div>
      </header>
      {loading ? (
        <main className="loading-state">
          <Disc3 size={40} className="spin" />
          <h1>Finding your frequency.</h1>
          <p>Opening your little world of sound…</p>
        </main>
      ) : loadError ? (
        <main className="loading-state">
          <Headphones size={38} />
          <h1>Let’s get connected.</h1>
          <p>{loadError}</p>
          <button
            className="primary-button"
            onClick={() =>
              void run(async () => {
                const data = await reload();
                hydrateRef.current(data.playback);
                setSelectedId(data.tracks[0]?.id ?? null);
                setLoadError("");
              })
            }
          >
            <RefreshCw size={16} />
            Try again
          </button>
          <p className="tiny-note">
            Start the app with <code>npm run dev</code> to launch the local
            music server.
          </p>
        </main>
      ) : (
        <main className="app-main">
          <div className="page-heading">
            <h1>
              {tab === "map"
                ? "Your music, mapped."
                : tab === "library"
                  ? "Your library."
                  : "Find your feeling."}
            </h1>
            <span
              className="collection-context"
              title={demoOnly
                ? "Original demo music with illustrative ratings. Add your own tracks to make it personal."
                : "Your personal local music library"}
            >
              {demoOnly && <span className="demo-dot" />}
              {demoOnly ? "Demo collection" : `${library.tracks.length} tracks`}
            </span>
          </div>
          <div className={`workspace workspace--${tab}`}>
            <div className="main-column">
              {tab === "map" && (
                <>
                  <div className="map-toolbar minimalist-toolbar">
                    <label className="quiet-select">
                      <span className="sr-only">Map view</span>
                      <select
                        aria-label="Map view"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as "mood" | "sound" | "metrics")}
                      >
                        <option value="mood">Mood map</option>
                        <option value="sound">Sound map</option>
                        <option value="metrics">Audio metrics</option>
                      </select>
                      <ChevronDown size={12} />
                    </label>
                    <label className="quiet-select genre-select">
                      <span className="sr-only">Filter by genre</span>
                      <select aria-label="Filter by genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
                        {genres.map((value) => (
                          <option key={value} value={value}>
                            {value === "All tracks" ? "All genres" : value}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={12} />
                    </label>
                    <div className="toolbar-spacer" />
                    <button
                      className={`icon-button ${mapSearchOpen ? "active" : ""}`}
                      onClick={() => {
                        setMapSearchOpen(!mapSearchOpen);
                        if (mapSearchOpen) setSearch("");
                      }}
                      aria-label="Search the map"
                      aria-expanded={mapSearchOpen}
                    >
                      <Search size={17} />
                    </button>
                    <details
                      className="map-options"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.currentTarget.open = false;
                          event.currentTarget.querySelector("summary")?.focus();
                        }
                      }}
                    >
                      <summary aria-label="More map options"><Settings2 size={16} /></summary>
                      <div className="map-options-panel">
                        <label>
                          Collection
                          <select aria-label="Collection" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                            <option value="">All my sounds</option>
                            {library.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                          </select>
                        </label>
                        <label>
                          Highlight a mood
                          <select aria-label="Highlight a mood" value={activeMoodId ?? ""} onChange={(e) => setActiveMoodId(e.target.value || null)}>
                            <option value="">All moods</option>
                            {library.moods.map((mood) => <option key={mood.id} value={mood.id}>{mood.label}</option>)}
                          </select>
                        </label>
                        <hr />
                        <button onClick={() => void run(async () => {
                          const result = await api.resetPositions();
                          revisionRef.current = result.layoutRevision;
                          await reload();
                          notify("Arrangement reset.");
                        })}>
                          <RefreshCw size={14} />Reset arrangement
                        </button>
                        <button onClick={() => setModal("group")}><FolderHeart size={14} />Create collection</button>
                        <button onClick={() => void exportMap()}><ArrowDownToLine size={14} />Export map</button>
                        <button onClick={() => mapImportRef.current?.click()}><FileJson size={14} />Import map</button>
                        <hr />
                        <button onClick={() => setModal("about")}><CircleHelp size={14} />About Favescape</button>
                      </div>
                    </details>
                  </div>
                  {mapSearchOpen && (
                    <label className="map-search">
                      <Search size={17} />
                      <input
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Find a track, artist, or genre…"
                      />
                      <button
                        className="icon-button"
                        onClick={() => {
                          setMapSearchOpen(false);
                          setSearch("");
                        }}
                        aria-label="Close search"
                      >
                        <X size={16} />
                      </button>
                    </label>
                  )}
                  {visible.length > 0 ? (
                    <MusicMap
                      tracks={visible}
                      moods={library.moods}
                      connections={library.connections}
                      mode={mode}
                      selectedId={selectedId}
                      currentTrackId={player.currentId}
                      activeMoodId={activeMoodId}
                      pathTrackIds={session?.trackIds ?? []}
                      onSelect={setSelectedId}
                      onPlay={(id) => playTrack(id)}
                      onPositionChange={savePosition}
                    />
                  ) : (
                    <div className="map-empty">
                      <Music2 size={36} />
                      <h2>
                        {library.tracks.length
                          ? "No tracks in this little corner."
                          : "Your world starts with a song."}
                      </h2>
                      <p>
                        {library.tracks.length
                          ? "Try a different filter or add something new."
                          : "Import some local music, then give it a mood."}
                      </p>
                      <button
                        className="primary-button"
                        onClick={() =>
                          library.tracks.length
                            ? (setGenre("All tracks"),
                              setGroupId(""),
                              setSearch(""))
                            : setModal("import")
                        }
                      >
                        {library.tracks.length
                          ? "Clear filters"
                          : "Add your first tracks"}
                        <Plus size={16} />
                      </button>
                    </div>
                  )}
                  {session && (
                    <div className="map-session-strip">
                      <span>
                        <Sparkles size={14} />
                        <strong>
                          {
                            library.moods.find((m) => m.id === session.moodId)
                              ?.label
                          }{" "}
                          mix
                        </strong>{" "}
                        · {session.trackIds.length} stops on your map
                      </span>
                      <button onClick={startSession}>
                        <Play size={13} fill="currentColor" />
                        Play the journey
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => setSession(null)}
                        aria-label="Hide playlist path"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <details className="map-track-alternative">
                    <summary>
                      <ListMusic size={14} />
                      Track list <span>{visible.length}</span>
                    </summary>
                    <div>
                      {visible.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setSelectedId(t.id)}
                          className={selectedId === t.id ? "selected" : ""}
                        >
                          <span>
                            <strong>{t.title}</strong>
                            <small>{t.artist}</small>
                          </span>
                          <span>{formatTime(t.duration)}</span>
                        </button>
                      ))}
                    </div>
                  </details>
                </>
              )}
              {tab === "library" && (
                <>
                  <LibraryView
                    tracks={library.tracks}
                    selectedId={selectedId}
                    currentId={player.currentId}
                    playing={player.playing}
                    search={search}
                    onSearch={setSearch}
                    onSelect={setSelectedId}
                    onPlay={(id) =>
                      playTrack(
                        id,
                        library.tracks
                          .filter((t) => t.audioUrl)
                          .map((t) => t.id),
                      )
                    }
                    onToggle={player.toggle}
                    onImport={() => setModal("import")}
                  />
                  <details className="library-options">
                    <summary>Library options <ChevronDown size={12} /></summary>
                    <div className="library-bottom-tools">
                    <button
                      className="text-button"
                      onClick={() => setModal("group")}
                    >
                      <FolderHeart size={14} />
                      Create collection
                    </button>
                    <button
                      className="text-button"
                      onClick={() => void exportMap()}
                    >
                      <ArrowDownToLine size={14} />
                      Export map
                    </button>
                    <button
                      className="text-button"
                      onClick={() => mapImportRef.current?.click()}
                    >
                      <FileJson size={14} />
                      Import map
                    </button>
                    </div>
                  </details>
                  {library.groups.length > 0 && (
                    <div className="saved-collections">
                      <h3>Your collections</h3>
                      {library.groups.map((group) => (
                        <div key={group.id}>
                          <button
                            onClick={() => {
                              setGroupId(group.id);
                              setTab("map");
                            }}
                          >
                            <FolderHeart size={15} />
                            {group.name}
                            <span>{group.trackIds.length}</span>
                            <ArrowRight size={14} />
                          </button>
                          <button
                            className="icon-button"
                            onClick={() =>
                              void run(async () => {
                                await api.removeGroup(group.id);
                                await reload();
                              })
                            }
                            aria-label={`Delete collection ${group.name}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {tab === "tasteplay" && (
                <TastePlayView
                  moods={library.moods}
                  tracks={library.tracks}
                  session={session}
                  sessions={sessions}
                  feedback={feedback}
                  onFeedback={(trackId, value) =>
                    void run(async () => {
                      if (!session) return;
                      await api.feedback(
                        trackId,
                        session.moodId,
                        session.id,
                        value,
                      );
                      setFeedback((current) => ({
                        ...current,
                        [`${session.id}-${trackId}`]: value,
                      }));
                      notify(
                        value === "great_fit"
                          ? "A good feeling, noted."
                          : "Noted. Your feedback stays separate from ratings.",
                      );
                    })
                  }
                  onGenerate={generate}
                  onLoad={(value) => {
                    setSession(value);
                    setActiveMoodId(value.moodId);
                  }}
                  onPlay={startSession}
                  onEditQueue={editSession}
                  onMap={() => {
                    setTab("map");
                    setSearch("");
                    setGenre("All tracks");
                    setMode("mood");
                  }}
                  onSelect={setSelectedId}
                  currentId={player.currentId}
                />
              )}
            </div>
            <TrackInspector
              track={selected}
              tracks={library.tracks}
              moods={library.moods}
              connections={library.connections}
              playing={player.playing}
              isCurrent={selectedId === player.currentId}
              onPlay={(id) => playTrack(id)}
              onToggle={player.toggle}
              onEnjoyment={enjoyment}
              onMood={moodRating}
              onRemoveMood={(id, moodId) =>
                void run(async () =>
                  replaceTrack(await api.removeMoodRating(id, moodId)),
                )
              }
              onConnect={(sourceId, targetId, reason) =>
                void run(async () => {
                  await api.connect(sourceId, targetId, reason);
                  await reload();
                  notify("A new connection in your world.");
                })
              }
              onDisconnect={(id) =>
                void run(async () => {
                  await api.disconnect(id);
                  await reload();
                })
              }
              onSelect={setSelectedId}
              onEdit={() => setModal("edit")}
              onNewMood={() => setModal("mood")}
              onAnalyze={(id) =>
                void run(async () => {
                  await api.analyze(id);
                  await reload();
                  notify("Analysis queued. Keep listening.");
                })
              }
            />
          </div>
        </main>
      )}
      <PlayerBar
        player={player}
        onSelect={() => {
          if (player.currentId) setSelectedId(player.currentId);
        }}
        onFavorite={() => {
          if (player.currentTrack)
            enjoyment(
              player.currentTrack.id,
              player.currentTrack.enjoyment === 5 ? null : 5,
            );
        }}
        onQueue={() => setQueueOpen(!queueOpen)}
        queueOpen={queueOpen}
      />
      {queueOpen && (
        <aside className="queue-panel" aria-label="Playback queue">
          <div className="queue-heading">
            <div>
              <span className="section-kicker">KEEP THE FEELING GOING</span>
              <h2>Up next.</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => setQueueOpen(false)}
              aria-label="Close playback queue"
            >
              <X size={20} />
            </button>
          </div>
          {queueTracks.length ? (
            <>
              <p className="section-hint">
                {queueTracks.length} tracks ·{" "}
                {formatTime(
                  queueTracks.reduce((sum, t) => sum + t.duration, 0),
                )}
              </p>
              <ol>
                {queueTracks.map((track, index) => (
                  <li
                    key={track.id}
                    className={
                      track.id === player.currentId ? "is-current" : ""
                    }
                  >
                    <button
                      className="queue-track"
                      onClick={() => {
                        player.play(track.id);
                        setSelectedId(track.id);
                      }}
                    >
                      {track.artwork ? (
                        <img src={track.artwork} alt="" />
                      ) : (
                        <i style={{ background: track.color }} />
                      )}
                      <span>
                        <strong>{track.title}</strong>
                        <small>{track.artist}</small>
                      </span>
                      {track.id === player.currentId ? (
                        <span className="queue-playing">♫</span>
                      ) : (
                        <Play size={13} />
                      )}
                    </button>
                    <div className="queue-row-actions">
                      <button
                        className="icon-button"
                        onClick={() => moveQueue(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${track.title} up`}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => moveQueue(index, 1)}
                        disabled={index === queueTracks.length - 1}
                        aria-label={`Move ${track.title} down`}
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() =>
                          editPlaybackQueue(
                            player.queueIds.filter((id) => id !== track.id),
                          )
                        }
                        aria-label={`Remove ${track.title} from queue`}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="queue-empty">
              <Disc3 size={50} />
              <p>
                Your next favorite moment
                <br />
                starts with a song.
              </p>
              <button
                className="secondary-button"
                onClick={() => {
                  setQueueOpen(false);
                  navigate("tasteplay");
                }}
              >
                Make a TastePlay mix <ArrowRight size={14} />
              </button>
            </div>
          )}
        </aside>
      )}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.kind === "error" ? "error" : ""}`}
          >
            {toast.kind === "error" ? (
              <CircleHelp size={16} />
            ) : (
              <Check size={16} />
            )}
            <span>{toast.message}</span>
            <button
              className="icon-button"
              onClick={() =>
                setToasts((items) => items.filter((t) => t.id !== toast.id))
              }
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {dropActive && (
        <div className="file-drop-overlay">
          <Upload size={44} />
          <h2>Drop a little more you.</h2>
          <p>Local audio files become part of your world.</p>
        </div>
      )}
      {modal === "import" && (
        <Dialog title="Bring your favorites." onClose={() => setModal(null)}>
          <p className="dialog-intro">
            Add audio files from your computer. Your music, ratings, and map
            stay right here.
          </p>
          <button
            className="import-drop"
            onClick={() => importRef.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <LoaderCircle size={34} className="spin" />
            ) : (
              <Upload size={34} />
            )}
            <strong>
              {importing
                ? "Making room for your music…"
                : "Choose files or drop them here"}
            </strong>
            <span>
              MP3, WAV, FLAC, M4A, OGG & AIFF
              <br />
              Playback depends on your browser’s format support.
            </span>
          </button>
          <div className="import-footnote">
            <Headphones size={17} />
            <p>
              Use music files you’ve lawfully obtained. Subscription downloads
              stay inside their streaming apps.
            </p>
          </div>
          <button
            className="text-button"
            onClick={() => {
              setModal(null);
              mapImportRef.current?.click();
            }}
          >
            <FileJson size={15} />
            Bringing a saved Favescape map instead?
          </button>
        </Dialog>
      )}
      {modal === "edit" && selected && (
        <Dialog title="The track details." onClose={() => setModal(null)}>
          <MetadataForm
            key={selected.id}
            track={selected}
            onSave={(patch) =>
              void run(async () => {
                replaceTrack(await api.track(selected.id, patch));
                setModal(null);
                notify("Track details saved.");
              })
            }
            onRemove={() =>
              void run(async () => {
                await api.removeTrack(selected.id);
                if (player.currentId === selected.id) player.stop();
                player.replaceQueue(
                  player.queueIds.filter((id) => id !== selected.id),
                );
                const [data, saved] = await Promise.all([
                  reload(),
                  api.sessions(),
                ]);
                setSessions(saved.sessions);
                setSession((current) =>
                  current
                    ? (saved.sessions.find((s) => s.id === current.id) ?? null)
                    : null,
                );
                setSelectedId(
                  data.tracks.find((t) => t.id !== selected.id)?.id ?? null,
                );
                setModal(null);
                notify("Track removed from your library.");
              })
            }
          />
        </Dialog>
      )}
      {modal === "mood" && (
        <Dialog title="Name a feeling." onClose={() => setModal(null)}>
          <MoodForm
            onSave={(label, color) =>
              void run(async () => {
                await api.addMood(label, color);
                await reload();
                setModal(null);
                notify("A new feeling for your map.");
              })
            }
          />
        </Dialog>
      )}
      {modal === "group" && (
        <Dialog title="A little collection." onClose={() => setModal(null)}>
          <GroupForm
            tracks={library.tracks}
            onSave={(name, ids) =>
              void run(async () => {
                await api.group(name, ids);
                await reload();
                setModal(null);
                notify("Collection saved. Find it above your map.");
              })
            }
          />
        </Dialog>
      )}
      {modal === "about" && (
        <Dialog title="A world of your own." onClose={() => setModal(null)}>
          <div className="about-content">
            <p>
              Favescape is a personal music map and player. Bring your songs,
              give them a feeling, and see where they connect.
            </p>
            <h3>Three ways to see your music</h3>
            <p>
              <strong>Mood</strong> follows your ratings. A song can belong to
              more than one feeling. <strong>Sound</strong> arranges measured
              audio features. <strong>Metrics</strong> plots estimated tempo and
              brightness directly.
            </p>
            <h3>TastePlay follows your lead</h3>
            <p>
              Your mood-fit and enjoyment ratings shape a mix from your local
              library. The first version uses an explainable scoring system. It
              doesn’t train a model or guess your emotions.
            </p>
            <h3>The demo is original</h3>
            <p>
              The opening collection contains twelve original procedural synth
              loops, fictional artists, original geometric sleeves, and
              illustrative personal ratings. Add your own music to make the map
              yours.
            </p>
            <div className="about-local">
              <Headphones size={20} />
              <span>
                Your audio stays on this computer. Exporting a map shares its
                data, not its audio files.
              </span>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function MetadataForm({
  track,
  onSave,
  onRemove,
}: {
  track: Track;
  onSave: (patch: Partial<Pick<Track, "title" | "artist" | "genres">>) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [genres, setGenres] = useState(track.genres.join(", "));
  const [confirm, setConfirm] = useState(false);
  return (
    <form
      className="edit-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSave({
          title: title.trim(),
          artist: artist.trim(),
          genres: genres
            .split(",")
            .map((g) => g.trim())
            .filter(Boolean),
        });
      }}
    >
      <label>
        Title
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </label>
      <label>
        Artist
        <input
          required
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          maxLength={200}
        />
      </label>
      <label>
        Genres
        <input
          value={genres}
          onChange={(e) => setGenres(e.target.value)}
          placeholder="Hyperpop, EDM"
          maxLength={300}
        />
        <small>Separate tags with a comma.</small>
      </label>
      <button className="primary-button" type="submit">
        Save details <Check size={15} />
      </button>
      <div className="remove-track-section">
        {confirm ? (
          <>
            <p>Remove this track and its personal ratings from the library?</p>
            <button className="danger-button" type="button" onClick={onRemove}>
              Remove track
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setConfirm(false)}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            className="text-button"
            type="button"
            onClick={() => setConfirm(true)}
          >
            Remove from library
          </button>
        )}
      </div>
    </form>
  );
}
function MoodForm({
  onSave,
}: {
  onSave: (label: string, color: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#7258a3");
  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (label.trim()) onSave(label.trim(), color);
      }}
    >
      <p className="dialog-intro">
        A feeling can be as specific as you like. “Window-seat nostalgia”
        counts.
      </p>
      <label>
        Mood name
        <input
          autoFocus
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={40}
          placeholder="What would you call it?"
        />
      </label>
      <label className="color-field">
        A color for the feeling
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <button className="primary-button" type="submit">
        Add this feeling <Plus size={16} />
      </button>
    </form>
  );
}
function GroupForm({
  tracks,
  onSave,
}: {
  tracks: Track[];
  onSave: (name: string, ids: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && ids.length) onSave(name.trim(), ids);
      }}
    >
      <label>
        Collection name
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Music for the last train home"
        />
      </label>
      <div className="group-track-picker">
        {tracks.map((t) => (
          <label key={t.id}>
            <input
              type="checkbox"
              checked={ids.includes(t.id)}
              onChange={(e) =>
                setIds((current) =>
                  e.target.checked
                    ? [...current, t.id]
                    : current.filter((id) => id !== t.id),
                )
              }
            />
            {t.artwork && <img src={t.artwork} alt="" />}
            <span>
              <strong>{t.title}</strong>
              <small>{t.artist}</small>
            </span>
          </label>
        ))}
      </div>
      <button className="primary-button" type="submit" disabled={!ids.length}>
        Save {ids.length} track{ids.length === 1 ? "" : "s"}{" "}
        <FolderHeart size={15} />
      </button>
    </form>
  );
}
