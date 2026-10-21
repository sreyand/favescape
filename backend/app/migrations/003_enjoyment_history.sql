CREATE TABLE IF NOT EXISTS enjoyment_history(id TEXT PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_enjoyment_history_track ON enjoyment_history(track_id);
