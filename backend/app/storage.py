import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("FAVESCAPE_DATA_DIR", ROOT / ".data")).resolve()
DB = DATA / "favescape.sqlite3"
PIPELINE_VERSION = "spectral-onset-v1"

STARTER_MOODS = [
    {"id": "euphoric", "label": "Euphoric", "color": "#F25840", "x": 0.29, "y": 0.25},
    {"id": "dreamy", "label": "Dreamy", "color": "#1D56BB", "x": 0.77, "y": 0.30},
    {"id": "calm", "label": "Calm", "color": "#398D73", "x": 0.54, "y": 0.76},
    {"id": "restless", "label": "Restless", "color": "#E5A526", "x": 0.20, "y": 0.64},
    {"id": "melancholy", "label": "Melancholy", "color": "#9370A6", "x": 0.79, "y": 0.72},
    {"id": "angry", "label": "Angry", "color": "#CA584B", "x": 0.51, "y": 0.18},
]


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix=""):
    return prefix + uuid.uuid4().hex


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


@contextmanager
def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_state(conn, key, default):
    row = conn.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def set_state(conn, key, value):
    conn.execute("INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, encode(value)))


def raw_track(conn, track_id):
    return conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()


def safe_audio_path(storage_name):
    if not storage_name:
        return None
    candidate = (DATA / storage_name).resolve()
    if not candidate.is_relative_to(DATA) or not candidate.is_file():
        return None
    return candidate


def serialize_track(row):
    track = json.loads(row["payload"])
    track["audioUrl"] = f"/api/tracks/{track['id']}/audio" if safe_audio_path(row["storage_name"]) else None
    return track


def save_track(conn, track):
    conn.execute("UPDATE tracks SET payload=? WHERE id=?", (encode(track), track["id"]))


def all_tracks(conn):
    return [serialize_track(row) for row in conn.execute("SELECT * FROM tracks ORDER BY rowid")]


def objects(conn, table):
    # Table is an internal constant, never a user-controlled string.
    return [json.loads(r[0]) for r in conn.execute(f"SELECT payload FROM {table} ORDER BY rowid")]


def enqueue(conn, track_id, source_hash, force=False):
    key = f"{source_hash}:{PIPELINE_VERSION}"
    current = conn.execute("SELECT * FROM jobs WHERE track_id=? AND input_key=?", (track_id, key)).fetchone()
    if current and current["state"] in ("queued", "running", "succeeded") and not force:
        return current["id"]
    if current:
        job_id = current["id"]
        conn.execute("UPDATE jobs SET state='queued',error=NULL,updated_at=? WHERE id=?", (now(), job_id))
    else:
        job_id = uid("job_")
        conn.execute("INSERT INTO jobs(id,track_id,input_key,state,created_at,updated_at) VALUES(?,?,?,'queued',?,?)", (job_id, track_id, key, now(), now()))
    row = raw_track(conn, track_id)
    if row:
        track = json.loads(row["payload"])
        track.update(analysisStatus="pending", analysisError=None)
        save_track(conn, track)
    return job_id


def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
        # API and worker may start together. Hold the migration/seed lock for
        # the entire transaction instead of executescript's implicit commit.
        conn.execute("BEGIN IMMEDIATE")
        migration_dir = Path(__file__).parent / "migrations"
        for path in sorted(migration_dir.glob("*.sql")):
            version = int(path.name.split("_")[0])
            if not conn.execute("SELECT 1 FROM schema_migrations WHERE version=?", (version,)).fetchone():
                for statement in path.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        conn.execute(statement)
                conn.execute("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)", (version, now()))
        for mood in STARTER_MOODS:
            conn.execute("INSERT OR IGNORE INTO moods(id,payload) VALUES(?,?)", (mood["id"], encode(mood)))
        if get_state(conn, "seeded", False):
            relink_demo_audio(conn)
            return
        catalog = ROOT / "fixtures" / "demo-catalog.json"
        if not catalog.is_file():
            return
        data = json.loads(catalog.read_text(encoding="utf-8-sig"))
        items = data.get("tracks", []) if isinstance(data, dict) else data
        if isinstance(data, dict):
            for mood in data.get("moods", []):
                conn.execute("INSERT OR REPLACE INTO moods(id,payload) VALUES(?,?)", (mood["id"], encode(mood)))
        # Seeding is allowed only for the untouched initial database.
        if conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]:
            set_state(conn, "seeded", True)
            return
        from .models import Track
        for item in items:
            path = DATA / "demo-audio" / f"{item['id']}.wav"
            source_hash = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
            track = Track.model_validate({
                "id": item["id"], "title": item["title"], "artist": item["artist"],
                "album": item.get("album", "Favescape demo sessions"), "genres": item.get("genres", []),
                "duration": item.get("duration", 30), "artwork": item.get("artwork"),
                "color": item.get("color", "#164DBB"), "audioUrl": None, "isDemo": True,
                "addedAt": now(), "enjoyment": item.get("enjoyment"), "moodRatings": item.get("moodRatings", {}),
                "moodNotes": item.get("moodNotes", {}), "analysisStatus": "pending", "analysisError": None,
                "features": None, "position": item.get("position"),
            }).model_dump()
            conn.execute("INSERT OR IGNORE INTO tracks(id,payload,source_hash,storage_name) VALUES(?,?,?,?)", (track["id"], encode(track), source_hash, f"demo-audio/{item['id']}.wav" if path.is_file() else None))
            if source_hash:
                enqueue(conn, track["id"], source_hash)
            for mood_id, score in track["moodRatings"].items():
                event = {"id": uid("rating_"), "trackId": track["id"], "moodId": mood_id, "score": score, "note": "Illustrative demo rating", "createdAt": now()}
                conn.execute("INSERT INTO rating_history(id,track_id,payload) VALUES(?,?,?)", (event["id"], track["id"], encode(event)))
        set_state(conn, "seeded", True)


def relink_demo_audio(conn):
    """A first launch can overlap demo generation; attach later-created files."""
    for row in conn.execute("SELECT * FROM tracks").fetchall():
        track = json.loads(row["payload"])
        if not track.get("isDemo") or safe_audio_path(row["storage_name"]):
            continue
        path = DATA / "demo-audio" / f"{track['id']}.wav"
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            conn.execute("UPDATE tracks SET source_hash=?,storage_name=? WHERE id=?", (digest, f"demo-audio/{track['id']}.wav", track["id"]))
            enqueue(conn, track["id"], digest)


def library(conn):
    from .models import Playback

    return {
        "tracks": all_tracks(conn), "moods": objects(conn, "moods"),
        "connections": objects(conn, "connections"), "groups": objects(conn, "groups"),
        "layoutRevision": get_state(conn, "layoutRevision", 0),
        "playback": Playback.model_validate(get_state(conn, "playback", {})).model_dump(),
    }
