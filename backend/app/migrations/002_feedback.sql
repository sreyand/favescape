CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_feedback_track ON feedback(track_id);
