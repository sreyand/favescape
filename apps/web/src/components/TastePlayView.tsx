import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, LoaderCircle, Map as MapIcon, MoreHorizontal, Play, ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { Mood, TasteSession, Track } from "../types";
import { formatTime } from "../usePlayback";
import "./MinimalTastePlay.css";

type Props = {
  moods: Mood[];
  tracks: Track[];
  session: TasteSession | null;
  sessions: TasteSession[];
  onGenerate: (moodId: string, durationMinutes: number) => Promise<void>;
  onLoad: (session: TasteSession) => void;
  onPlay: () => void;
  onEditQueue: (ids: string[]) => void;
  onMap: () => void;
  onSelect: (id: string) => void;
  currentId: string | null;
  onFeedback: (trackId: string, value: "great_fit" | "wrong_mood") => void;
  feedback: Record<string, string>;
};

export default function TastePlayView({ moods, tracks, session, sessions, onGenerate, onLoad, onPlay, onEditQueue, onMap, onSelect, currentId, onFeedback, feedback }: Props) {
  const [moodId, setMoodId] = useState(moods.find((mood) => mood.id === "dreamy")?.id ?? moods[0]?.id ?? "");
  const [minutes, setMinutes] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const chosenMoodId = moods.some((mood) => mood.id === moodId) ? moodId : (moods[0]?.id ?? "");
  const chosenMood = moods.find((mood) => mood.id === chosenMoodId);
  const matchingCount = tracks.filter((track) => (track.moodRatings[chosenMoodId] ?? 0) >= 3 && track.audioUrl).length;
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const queued = session?.trackIds.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track)) ?? [];
  const sessionMood = moods.find((mood) => mood.id === session?.moodId);
  const showSparseMessage = session && (queued.length === 0 || session.actualDuration < session.requestedDuration * 0.85);

  function move(trackId: string, direction: number) {
    if (!session) return;
    const ids = [...session.trackIds];
    const index = ids.indexOf(trackId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    onEditQueue(ids);
  }

  async function generate() {
    if (generating || !chosenMoodId || matchingCount === 0) return;
    setGenerating(true);
    setGenerationError("");
    try {
      await onGenerate(chosenMoodId, minutes);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "This mix could not be generated.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="minimal-tasteplay">
      <section className="mtp-builder" aria-labelledby="tasteplay-heading">
        <h2 id="tasteplay-heading" className="sr-only">TastePlay</h2>
        <form className="mtp-form" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
          <label>
            Mood
            <select value={chosenMoodId} onChange={(event) => setMoodId(event.target.value)} disabled={generating || moods.length === 0}>
              {moods.length === 0 && <option value="">Add a mood first</option>}
              {moods.map((mood) => <option key={mood.id} value={mood.id}>{mood.label}</option>)}
            </select>
          </label>
          <label>
            Length
            <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} disabled={generating}>
              {[5, 10, 20, 30].map((value) => <option key={value} value={value}>{value} minutes</option>)}
            </select>
          </label>
          <button className="primary-button mtp-generate" type="submit" disabled={generating || !chosenMoodId || matchingCount === 0}>
            {generating && <LoaderCircle className="spin" size={16} aria-hidden />}
            {generating ? "Generating…" : "Generate mix"}
          </button>
        </form>
        {matchingCount === 0 && <p className="mtp-note">Rate a few playable tracks 3/5 or higher for {chosenMood?.label.toLowerCase() ?? "a mood"} to make a mix.</p>}
        {generationError && <p className="mtp-note mtp-error" role="alert">{generationError}</p>}
      </section>

      <section className="mtp-playlist" aria-label="TastePlay playlist">
        {session ? <>
          <div className="mtp-playlist-heading">
            <div>
              <h3>{sessionMood?.label ?? "Your"} mix</h3>
              <p>{queued.length} tracks · {formatTime(session.actualDuration)}</p>
            </div>
            <div className="mtp-playlist-actions">
              <button className="primary-button" onClick={onPlay} disabled={!queued.some((track) => track.audioUrl)}><Play size={14} fill="currentColor" aria-hidden />Play mix</button>
              <button className="mtp-text-button" onClick={onMap}><MapIcon size={14} aria-hidden />See path</button>
            </div>
          </div>
          {showSparseMessage && session.message && <p className="mtp-note">{session.message}</p>}
          <ol className="mtp-tracks">
            {queued.map((track, index) => {
              const givenFeedback = feedback[`${session.id}-${track.id}`];
              const queueIndex = session.trackIds.indexOf(track.id);
              return <li key={track.id} className={currentId === track.id ? "mtp-current" : ""}>
                <span className="mtp-track-number" aria-hidden>{currentId === track.id ? "♫" : index + 1}</span>
                <button className="mtp-track-name" onClick={() => onSelect(track.id)}><strong>{track.title}</strong><span>{track.artist}</span></button>
                <span className="mtp-track-duration">{formatTime(track.duration)}</span>
                <details className="mtp-track-options">
                  <summary aria-label={`Options for ${track.title}`}><MoreHorizontal size={19} aria-hidden /></summary>
                  <div className="mtp-options-content">
                    <p>{session.reasons[track.id] ?? "Added by you."}</p>
                    <div className="mtp-feedback" role="group" aria-label={`Mood feedback for ${track.title}`}>
                      <button className={givenFeedback === "great_fit" ? "is-active" : ""} onClick={() => onFeedback(track.id, "great_fit")} aria-pressed={givenFeedback === "great_fit"}><ThumbsUp size={14} aria-hidden />Great fit</button>
                      <button className={givenFeedback === "wrong_mood" ? "is-active" : ""} onClick={() => onFeedback(track.id, "wrong_mood")} aria-pressed={givenFeedback === "wrong_mood"}><ThumbsDown size={14} aria-hidden />Wrong mood</button>
                    </div>
                    <div className="mtp-edit-actions">
                      <button onClick={() => move(track.id, -1)} disabled={queueIndex === 0}><ArrowUp size={14} aria-hidden />Move up</button>
                      <button onClick={() => move(track.id, 1)} disabled={queueIndex === session.trackIds.length - 1}><ArrowDown size={14} aria-hidden />Move down</button>
                      <button onClick={() => onEditQueue(session.trackIds.filter((id) => id !== track.id))}><X size={14} aria-hidden />Remove</button>
                    </div>
                  </div>
                </details>
              </li>;
            })}
          </ol>
          {queued.length === 0 && <p className="mtp-note">This mix is empty. Generate another when you’re ready.</p>}
        </> : <p className="mtp-empty">Choose a mood to make a mix from your library.</p>}

        {sessions.length > 0 && <details className="mtp-history">
          <summary><span>Previous mixes</span><span className="mtp-history-count">{sessions.length}</span><ChevronDown size={15} aria-hidden /></summary>
          <div className="mtp-history-list">
            {sessions.map((saved) => <button key={saved.id} onClick={() => onLoad(saved)}><span>{moods.find((mood) => mood.id === saved.moodId)?.label ?? "Your"} mix</span><small>{saved.trackIds.length} tracks · {formatTime(saved.actualDuration)}</small></button>)}
          </div>
        </details>}
      </section>
    </div>
  );
}
