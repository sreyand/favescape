import { useId, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Clock3,
  Disc3,
  Pause,
  Play,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { Track } from "../types";
import { formatTime } from "../usePlayback";
import "./LibraryView.css";

export type LibraryViewProps = {
  tracks: Track[];
  selectedId: string | null;
  currentId: string | null;
  playing: boolean;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onPlay: (id: string) => void;
  onToggle: () => void;
  onImport: () => void;
};

function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function RecordSleeve({
  track,
  small = false,
}: {
  track: Track;
  small?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (track.artwork && failedSource !== track.artwork) {
    return (
      <img
        className="library-view-art-image"
        src={track.artwork}
        alt=""
        loading="lazy"
        onError={() => setFailedSource(track.artwork)}
      />
    );
  }
  const color = track.color || "#1854c4";
  return (
    <svg
      className="library-view-art-image library-view-art-fallback"
      viewBox="0 0 200 200"
      aria-hidden="true"
    >
      <rect width="200" height="200" fill="#f8efcf" />
      <path d="M0 0H100V100H0ZM100 100H200V200H100Z" fill={color} />
      <circle
        cx="100"
        cy="100"
        r="72"
        fill="#f8efcf"
        stroke={color}
        strokeWidth="10"
      />
      <circle cx="100" cy="100" r="45" fill={color} />
      <circle cx="100" cy="100" r="6" fill="#f8efcf" />
      {!small && (
        <path
          d="M158 18Q160 36 178 38Q160 40 158 58Q156 40 138 38Q156 36 158 18Z"
          fill="#ed5039"
        />
      )}
    </svg>
  );
}

export function LibraryView({
  tracks,
  selectedId,
  currentId,
  playing,
  search,
  onSearch,
  onSelect,
  onPlay,
  onToggle,
  onImport,
}: LibraryViewProps) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [genre, setGenre] = useState<string | null>(null);
  const [sort, setSort] = useState<"recent" | "title" | "enjoyment">("recent");
  const searchId = useId();
  const sortId = useId();
  const genreId = useId();
  const viewId = useId();
  const genres = useMemo(
    () =>
      [...new Set(tracks.flatMap((track) => track.genres))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [tracks],
  );
  const activeGenre = genre && genres.includes(genre) ? genre : null;
  const filtered = useMemo(() => {
    const query = searchKey(search.trim());
    const result = tracks.filter(
      (track) =>
        (!activeGenre || track.genres.includes(activeGenre)) &&
        (!query ||
          searchKey(
            [track.title, track.artist, track.album, ...track.genres].join(" "),
          ).includes(query)),
    );
    return result.sort((a, b) => {
      if (sort === "title")
        return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
      if (sort === "enjoyment")
        return (
          (b.enjoyment ?? -1) - (a.enjoyment ?? -1) ||
          a.title.localeCompare(b.title)
        );
      return (
        b.addedAt.localeCompare(a.addedAt) || a.title.localeCompare(b.title)
      );
    });
  }, [tracks, search, activeGenre, sort]);
  const hasFilters = Boolean(search.trim() || activeGenre);

  function playTrack(track: Track) {
    onSelect(track.id);
    if (track.id === currentId) onToggle();
    else onPlay(track.id);
  }

  function renderPlayButton(track: Track, compact = false) {
    const active = currentId === track.id && playing;
    return (
      <button
        type="button"
        className={`library-view-play${compact ? " library-view-play--compact" : ""}${active ? " library-view-play--active" : ""}`}
        aria-label={`${active ? "Pause" : "Play"} ${track.title}`}
        title={
          !track.audioUrl
            ? "Select this track to relink its audio file"
            : `${active ? "Pause" : "Play"} ${track.title}`
        }
        onClick={(event) => {
          event.stopPropagation();
          playTrack(track);
        }}
      >
        {active ? (
          <Pause size={compact ? 16 : 21} fill="currentColor" />
        ) : (
          <Play size={compact ? 16 : 21} fill="currentColor" />
        )}
      </button>
    );
  }

  return (
    <section className="library-view" aria-label="Your music library">
      <div className="library-view-toolbar">
        <div className="library-view-search">
          <Search size={17} aria-hidden="true" />
          <label className="library-view-sr-only" htmlFor={searchId}>
            Search songs, artists, albums, or genres
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search your library"
            autoComplete="off"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              aria-label="Clear library search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="library-view-results-bar">
        <span aria-live="polite">
          {hasFilters
            ? `${filtered.length} of ${tracks.length}`
            : tracks.length}{" "}
          {tracks.length === 1 ? "track" : "tracks"}
        </span>
        <div className="library-view-controls">
          <label className="library-view-select" htmlFor={genreId}>
            <span className="library-view-sr-only">Filter library by genre</span>
            <select id={genreId} value={activeGenre ?? ""} onChange={(event) => setGenre(event.target.value || null)}>
              <option value="">All genres</option>
              {genres.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="library-view-select" htmlFor={sortId}>
            <span className="library-view-sr-only">Sort library</span>
            <select
              id={sortId}
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="recent">Recently added</option>
              <option value="title">Title A–Z</option>
              <option value="enjoyment">Most loved</option>
            </select>
          </label>
          <label className="library-view-select" htmlFor={viewId}>
            <span className="library-view-sr-only">Library display</span>
            <select id={viewId} value={view} onChange={(event) => setView(event.target.value as typeof view)}>
              <option value="grid">Grid</option>
              <option value="list">List</option>
            </select>
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="library-view-empty">
          <span className="library-view-empty-icon" aria-hidden="true">
            {tracks.length ? (
              <Search size={33} strokeWidth={1.2} />
            ) : (
              <Disc3 size={40} strokeWidth={1.1} />
            )}
          </span>
          <h3>
            {tracks.length
              ? "A little too specific?"
              : "Your world starts with a song."}
          </h3>
          <p>
            {tracks.length
              ? "Try another title, artist, or genre. Your favorites are still here."
              : "Add a few local audio files and start shaping your personal music landscape."}
          </p>
          {tracks.length ? (
            <button
              type="button"
              onClick={() => {
                onSearch("");
                setGenre(null);
              }}
            >
              Clear filters <ArrowUpRight size={15} />
            </button>
          ) : (
            <button type="button" onClick={onImport}>
              Add your first tracks <Plus size={16} />
            </button>
          )}
        </div>
      ) : view === "grid" ? (
        <div
          className="library-view-grid"
          role="list"
          aria-label="Record collection"
        >
          {filtered.map((track) => {
            const active = track.id === currentId;
            return (
              <article
                className={`library-view-record${track.id === selectedId ? " is-selected" : ""}${active ? " is-current" : ""}`}
                key={track.id}
                role="listitem"
              >
                <div className="library-view-record-sleeve">
                  <button
                    type="button"
                    className="library-view-art-select"
                    onClick={() => onSelect(track.id)}
                    aria-label={`View ${track.title} by ${track.artist}`}
                    aria-pressed={track.id === selectedId}
                  >
                    <RecordSleeve track={track} />
                  </button>
                  {!track.audioUrl && (
                    <span className="library-view-missing">Audio missing</span>
                  )}
                  {active && (
                    <span
                      className={`library-view-now-playing${playing ? " is-playing" : ""}`}
                      aria-label={playing ? "Now playing" : "Current track"}
                    >
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  {renderPlayButton(track)}
                </div>
                <button
                  type="button"
                  className="library-view-record-info"
                  onClick={() => onSelect(track.id)}
                  aria-label={`Inspect ${track.title}`}
                >
                  <span className="library-view-record-title">
                    {track.title}
                  </span>
                  <span className="library-view-record-artist">
                    {track.artist || "Unknown artist"}
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="library-view-list-wrap">
          <table className="library-view-table">
            <caption className="library-view-sr-only">
              Your library. Select a track to view and edit its details.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="library-view-number-col">
                  #
                </th>
                <th scope="col">Track / artist</th>
                <th scope="col" className="library-view-genre-col">
                  Genre
                </th>
                <th scope="col" className="library-view-time-col">
                  <Clock3 size={13} aria-label="Duration" />
                </th>
                <th scope="col">
                  <span className="library-view-sr-only">Playback</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((track, index) => (
                <tr
                  key={track.id}
                  className={`${track.id === selectedId ? "is-selected " : ""}${track.id === currentId ? "is-current" : ""}`}
                >
                  <td className="library-view-number-col">
                    {String(index + 1).padStart(2, "0")}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="library-view-list-track"
                      onClick={() => onSelect(track.id)}
                      aria-label={`View ${track.title} by ${track.artist}`}
                      aria-pressed={track.id === selectedId}
                    >
                      <span className="library-view-list-art">
                        <RecordSleeve track={track} small />
                      </span>
                      <span className="library-view-list-title">
                        <strong>
                          {track.title}
                        </strong>
                        <span>
                          {track.artist || "Unknown artist"}
                          {!track.audioUrl && " · Audio missing"}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="library-view-genre-col">
                    <span className="library-view-list-genre">
                      {track.genres[0] || "Untagged"}
                    </span>
                  </td>
                  <td className="library-view-time-col">
                    {formatTime(track.duration)}
                  </td>
                  <td>{renderPlayButton(track, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default LibraryView;
