import {
  ListMusic,
  MoreHorizontal,
  Pause,
  Play,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { Player } from "../usePlayback";
import { formatTime } from "../usePlayback";
import "./MinimalTrack.css";
type Props = {
  player: Player;
  onSelect: () => void;
  onFavorite: () => void;
  onQueue: () => void;
  queueOpen: boolean;
};
export default function PlayerBar({
  player: p,
  onSelect,
  onQueue,
  queueOpen,
}: Props) {
  const track = p.currentTrack;
  return (
    <footer className="player-bar minimal-player" aria-label="Music player">
      <div className="now-playing">
        <button
          className="now-art"
          onClick={onSelect}
          disabled={!track}
          aria-label="Show current track"
        >
          {track?.artwork ? (
            <img src={track.artwork} alt="" />
          ) : (
            <span className="record-placeholder">✦</span>
          )}
        </button>
        <button className="now-copy" onClick={onSelect} disabled={!track}>
          <strong>{track?.title ?? "Nothing playing"}</strong>
          <span>{track ? track.artist : "Select a song"}</span>
        </button>
      </div>
      <div className="transport">
        <div className="transport-buttons">
          <button
            className="icon-button"
            onClick={p.previous}
            disabled={!track}
            aria-label="Previous track"
          >
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button
            className="main-play"
            onClick={p.toggle}
            aria-label={p.playing ? "Pause" : "Play"}
          >
            {p.playing ? (
              <Pause size={19} fill="currentColor" />
            ) : (
              <Play size={19} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            onClick={p.next}
            disabled={!track}
            aria-label="Next track"
          >
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>
        <div className="seek-row">
          <span>{formatTime(p.time)}</span>
          <input
            type="range"
            min="0"
            max={p.duration || 1}
            step="0.1"
            value={Math.min(p.time, p.duration || 1)}
            onChange={(e) => p.seek(Number(e.target.value))}
            disabled={!track}
            aria-label="Playback position"
            style={
              {
                "--range-progress": `${p.duration ? (p.time / p.duration) * 100 : 0}%`,
              } as React.CSSProperties
            }
          />
          <span>{formatTime(p.duration || track?.duration || 0)}</span>
        </div>
      </div>
      <div className="player-extras">
        <details
          className="playback-options"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary
            className="icon-button"
            aria-label="More playback options"
            title="More playback options"
          >
            <MoreHorizontal size={20} />
          </summary>
          <div className="playback-options-panel" role="group" aria-label="Playback options">
            <button
              className={`playback-option ${p.shuffle ? "active" : ""}`}
              onClick={() => p.setShuffle(!p.shuffle)}
              aria-pressed={p.shuffle}
            >
              <Shuffle size={16} />
              <span>Shuffle</span>
              <small>{p.shuffle ? "On" : "Off"}</small>
            </button>
            <button
              className={`playback-option ${p.repeat ? "active" : ""}`}
              onClick={() => p.setRepeat(!p.repeat)}
              aria-pressed={p.repeat}
            >
              <Repeat2 size={17} />
              <span>Repeat queue</span>
              <small>{p.repeat ? "On" : "Off"}</small>
            </button>
            <div className="playback-volume">
              <button
                className="icon-button"
                aria-label={p.volume ? "Mute" : "Unmute"}
                onClick={() => p.setVolume(p.volume ? 0 : 0.7)}
              >
                {p.volume === 0 ? (
                  <VolumeX size={18} />
                ) : p.volume < 0.5 ? (
                  <Volume1 size={18} />
                ) : (
                  <Volume2 size={18} />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={p.volume}
                onChange={(e) => p.setVolume(Number(e.target.value))}
                aria-label="Volume"
              />
            </div>
          </div>
        </details>
        <button
          className={`icon-button queue-toggle ${queueOpen ? "active" : ""}`}
          onClick={onQueue}
          aria-label={queueOpen ? "Close playback queue" : "Open playback queue"}
          aria-expanded={queueOpen}
        >
          <ListMusic size={19} />
          <span>{p.queueIds.length}</span>
        </button>
      </div>
    </footer>
  );
}
