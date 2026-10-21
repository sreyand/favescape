import { useEffect, useId, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Heart,
  Link2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Star,
  Unlink,
  X,
} from "lucide-react";
import type { Connection, Mood, Track } from "../types";
import { formatTime } from "../usePlayback";
import "./MinimalTrack.css";
type Props = {
  track: Track | null;
  tracks: Track[];
  moods: Mood[];
  connections: Connection[];
  playing: boolean;
  isCurrent: boolean;
  onPlay: (id: string) => void;
  onToggle: () => void;
  onEnjoyment: (id: string, score: number | null) => void;
  onMood: (id: string, moodId: string, score: number, note?: string) => void;
  onRemoveMood: (id: string, moodId: string) => void;
  onConnect: (sourceId: string, targetId: string, reason: string) => void;
  onDisconnect: (id: string) => void;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onNewMood: () => void;
  onAnalyze: (id: string) => void;
};
export default function TrackInspector({
  track,
  tracks,
  moods,
  connections,
  playing,
  isCurrent,
  onPlay,
  onToggle,
  onEnjoyment,
  onMood,
  onRemoveMood,
  onConnect,
  onDisconnect,
  onSelect,
  onEdit,
  onNewMood,
  onAnalyze,
}: Props) {
  const [ratingMood, setRatingMood] = useState<string | null>(null);
  const [ratingOpen, setRatingOpen] = useState(false);
  const ratingPanelId = useId();
  const [note, setNote] = useState("");
  const [linking, setLinking] = useState(false);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    setRatingMood(null);
    setRatingOpen(false);
    setLinking(false);
    setTarget("");
    setNote("");
    setReason("");
  }, [track?.id]);
  const savedNote =
    ratingMood && track ? (track.moodNotes[ratingMood] ?? "") : "";
  useEffect(() => {
    setNote(savedNote);
  }, [ratingMood, track?.id, savedNote]);
  if (!track)
    return (
      <aside className="track-inspector empty-inspector">
        <p>Select a song from your map.</p>
      </aside>
    );
  const links = connections.filter(
    (c) => c.sourceId === track.id || c.targetId === track.id,
  );
  const ratedMoods = moods.filter((m) => track.moodRatings[m.id] != null);
  const currentMood = moods.find((m) => m.id === ratingMood);
  return (
    <aside className="track-inspector minimal-inspector" aria-label="Selected track">
      <div className="sleeve-wrap" style={{ background: track.color }}>
        {track.artwork ? (
          <img src={track.artwork} alt={`Artwork for ${track.title}`} />
        ) : (
          <div className="fallback-sleeve">
            <span>✦</span>
            <i />
          </div>
        )}
        <button
          className="sleeve-play"
          onClick={() => (isCurrent ? onToggle() : onPlay(track.id))}
          disabled={!track.audioUrl}
          aria-label={
            isCurrent && playing ? "Pause track" : `Play ${track.title}`
          }
        >
          {isCurrent && playing ? (
            <Pause size={23} fill="currentColor" />
          ) : (
            <Play size={23} fill="currentColor" />
          )}
        </button>
      </div>
      <div className="inspector-copy">
        <button
          className="icon-button inspector-edit"
          onClick={onEdit}
          aria-label="Edit track details"
        >
          <MoreHorizontal size={19} />
        </button>
      <h2 className="track-title">{track.title}</h2>
      <p className="track-artist">{track.artist}</p>
      <div className="track-meta-line">
        <span style={{ color: track.color }}>
          {track.genres.join(" / ") || "Untagged"}
        </span>
      </div>
      </div>
      {ratedMoods.length > 0 && (
        <div className="rated-mood-summary" aria-label="Rated moods">
          {ratedMoods.map((mood) => (
            <span
              key={mood.id}
              style={{ "--mood-color": mood.color } as React.CSSProperties}
              title={`${mood.label}: ${track.moodRatings[mood.id]} out of 5`}
            >
              <i aria-hidden="true" />
              {mood.label}
            </span>
          ))}
        </div>
      )}
      <button
        className="secondary-button rate-toggle"
        onClick={() => setRatingOpen(!ratingOpen)}
        aria-expanded={ratingOpen}
        aria-controls={ratingPanelId}
      >
        Rate this song
        <ChevronDown size={15} className={ratingOpen ? "is-expanded" : ""} />
      </button>
      {ratingOpen && (
      <div className="track-rating-panel" id={ratingPanelId}>
      <section className="enjoyment-section">
        <div>
          <Heart size={14} />
          <span>Your enjoyment</span>
          {track.enjoyment && <small>{track.enjoyment}/5</small>}
        </div>
        <div className="star-rating" role="group" aria-label="Enjoyment rating">
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              key={score}
              onClick={() =>
                onEnjoyment(track.id, track.enjoyment === score ? null : score)
              }
              aria-label={`Enjoyment ${score} out of 5`}
              aria-pressed={(track.enjoyment ?? 0) >= score}
            >
              <Star
                size={21}
                fill={(track.enjoyment ?? 0) >= score ? "currentColor" : "none"}
              />
            </button>
          ))}
        </div>
      </section>
      <section className="mood-section">
        <div className="section-heading">
          <h3>How does it feel?</h3>
          <button
            className="icon-button"
            onClick={onNewMood}
            aria-label="Create a mood"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="mood-rating-chips">
          {moods.map((m) => (
            <button
              key={m.id}
              className={`${track.moodRatings[m.id] != null ? "rated" : ""} ${ratingMood === m.id ? "editing" : ""}`}
              style={{ "--mood-color": m.color } as React.CSSProperties}
              onClick={() => setRatingMood(ratingMood === m.id ? null : m.id)}
              aria-expanded={ratingMood === m.id}
            >
              <i />
              {m.label}
              {track.moodRatings[m.id] != null && (
                <span>{track.moodRatings[m.id]}</span>
              )}
            </button>
          ))}
        </div>
        {currentMood && (
          <div className="mood-editor">
            <div className="mood-editor-heading">
              <span>
                Fit for <strong>{currentMood.label}</strong>
              </span>
              <button
                className="icon-button"
                onClick={() => setRatingMood(null)}
                aria-label="Close mood rating"
              >
                <X size={14} />
              </button>
            </div>
            <div
              className="fit-buttons"
              role="group"
              aria-label={`Fit for ${currentMood.label}`}
            >
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  className={
                    track.moodRatings[currentMood.id] === score
                      ? "selected"
                      : ""
                  }
                  onClick={() => onMood(track.id, currentMood.id, score, note)}
                  aria-label={`${currentMood.label} fit ${score} out of 5`}
                  aria-pressed={track.moodRatings[currentMood.id] === score}
                >
                  {score}
                </button>
              ))}
            </div>
            <div className="fit-labels">
              <span>A little</span>
              <span>Exactly this</span>
            </div>
            <label className="sr-only" htmlFor="mood-note">
              Mood note
            </label>
            <textarea
              id="mood-note"
              placeholder="What makes it feel that way? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={2}
            />
            <div className="mood-editor-actions">
              {track.moodRatings[currentMood.id] != null && (
                <button
                  className="text-button"
                  onClick={() => {
                    onRemoveMood(track.id, currentMood.id);
                    setRatingMood(null);
                  }}
                >
                  Clear rating
                </button>
              )}
              <button
                className="text-button blue-text"
                disabled={track.moodRatings[currentMood.id] == null}
                onClick={() => {
                  onMood(
                    track.id,
                    currentMood.id,
                    track.moodRatings[currentMood.id],
                    note,
                  );
                  setRatingMood(null);
                }}
              >
                <Check size={13} />
                Save note
              </button>
            </div>
          </div>
        )}
      </section>
      </div>
      )}
      <details className="inspector-details" key={track.id}>
        <summary>
          Track details <ArrowUpRight size={14} />
        </summary>
        <div className="track-detail-meta">
          <span>{track.album || "No album"}</span>
          <span>{formatTime(track.duration)}</span>
        </div>
        {track.features ? (
          <div className="audio-measures">
            <div>
              <span>Estimated tempo</span>
              <strong>
                {track.features.tempo
                  ? `${Math.round(track.features.tempo)} BPM`
                  : "Unavailable"}
              </strong>
            </div>
            <div>
              <span>Brightness</span>
              <strong>
                {track.features.brightness != null
                  ? `${Math.round(track.features.brightness)} Hz`
                  : "Unavailable"}
              </strong>
            </div>
            <div>
              <span>RMS amplitude</span>
              <strong>
                {track.features.rms != null
                  ? track.features.rms.toFixed(3)
                  : "Unavailable"}
              </strong>
            </div>
          </div>
        ) : (
          <div className="analysis-pending">
            <p>
              {track.analysisStatus === "failed"
                ? "Audio analysis failed. You can still listen and rate."
                : "Audio analysis is processing in the background."}
            </p>
            {track.analysisError && <p>{track.analysisError}</p>}
            <button className="text-button" onClick={() => onAnalyze(track.id)}>
              <RefreshCw size={13} />
              {track.analysisStatus === "failed"
                ? "Retry analysis"
                : "Queue analysis"}
            </button>
          </div>
        )}
      <section className="connections-section">
        <div className="section-heading">
          <h3>Connected sounds</h3>
          <button
            className="icon-button"
            onClick={() => setLinking(!linking)}
            aria-label="Connect another track"
          >
            <Link2 size={15} />
          </button>
        </div>
        {links.map((link) => {
          const other = tracks.find(
            (t) =>
              t.id ===
              (link.sourceId === track.id ? link.targetId : link.sourceId),
          );
          return other ? (
            <div className="connected-row" key={link.id}>
              <button onClick={() => onSelect(other.id)}>
                {other.artwork ? (
                  <img src={other.artwork} alt="" />
                ) : (
                  <i style={{ background: other.color }} />
                )}
                <span>
                  <strong>{other.title}</strong>
                  <small>{link.reason || other.artist}</small>
                </span>
              </button>
              <button
                className="icon-button"
                onClick={() => onDisconnect(link.id)}
                aria-label={`Remove connection to ${other.title}`}
              >
                <Unlink size={13} />
              </button>
            </div>
          ) : null;
        })}
        {linking && (
          <form
            className="connection-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (target) {
                onConnect(track.id, target, reason);
                setLinking(false);
                setTarget("");
                setReason("");
              }
            }}
          >
            <label>
              Connect to
              <select
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose a track</option>
                {tracks
                  .filter(
                    (t) =>
                      t.id !== track.id &&
                      !links.some(
                        (l) => l.sourceId === t.id || l.targetId === t.id,
                      ),
                  )
                  .map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.title} — {t.artist}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              What connects them?
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="The crunchy synths, maybe"
                maxLength={200}
              />
            </label>
            <button className="secondary-button" type="submit">
              Make a connection <Link2 size={14} />
            </button>
          </form>
        )}
      </section>
      </details>
    </aside>
  );
}
