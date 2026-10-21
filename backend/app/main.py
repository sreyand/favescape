import hashlib
import json
import math
import random
from contextlib import asynccontextmanager
from pathlib import Path

import mutagen
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import models as m
from . import storage as s

SUPPORTED = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".aif", ".aiff"}
MAX_AUDIO_BYTES = 100 * 1024 * 1024
ART_MIMES = {".jpg": "image/jpeg", ".png": "image/png"}


@asynccontextmanager
async def lifespan(app):
    s.initialize()
    yield


app = FastAPI(title="Favescape local API", version="0.1.0", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"], www_redirect=False)

LOCAL_BROWSER_ORIGINS = {
    f"http://{host}:{port}"
    for host in ("127.0.0.1", "localhost")
    for port in (5173, 4173, 8765)
}


@app.middleware("http")
async def local_request_limits(request: Request, call_next):
    # CORS alone cannot prevent simple cross-site POSTs (notably uploads).
    # Keep the local API usable from the app and CLI, not arbitrary websites.
    origin = request.headers.get("origin")
    if origin is not None and origin not in LOCAL_BROWSER_ORIGINS:
        return JSONResponse({"detail": "This local API only accepts requests from the Favescape app."}, status_code=403)
    # JSON maps are bounded separately from multi-file audio import.
    if request.url.path == "/api/import":
        try:
            if int(request.headers.get("content-length", 0)) > 16 * 1024 * 1024:
                return JSONResponse({"detail": "Map documents must be smaller than 16 MB."}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "Invalid content length."}, status_code=400)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def require_track(conn, track_id):
    row = s.raw_track(conn, track_id)
    if not row:
        raise HTTPException(404, "Track not found.")
    return row


def require_ids(conn, ids):
    known = {r[0] for r in conn.execute("SELECT id FROM tracks")}
    if any(track_id not in known for track_id in ids):
        raise HTTPException(422, "One or more tracks are no longer in the library.")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/library")
def get_library():
    with s.connect() as conn:
        return s.library(conn)


def read_metadata(path, filename):
    audio = mutagen.File(path, easy=True)
    length = float(audio.info.length) if audio is not None and getattr(audio, "info", None) is not None else 0
    if not length:
        try:
            length = float(sf.info(path).duration)
        except Exception as exc:
            raise ValueError("This file could not be decoded as supported audio.") from exc
    if not math.isfinite(length) or length <= 0 or length > 86400:
        raise ValueError("Audio duration must be between zero and 24 hours.")
    tags = audio.tags if audio is not None and audio.tags else {}
    def tag(name, default):
        values = tags.get(name, [])
        return str(values[0])[:200].strip() if values else default
    title = tag("title", Path(filename).stem[:200] or "Untitled track")
    artist = tag("artist", "Unknown artist")
    genres = [str(g)[:200].strip() for g in tags.get("genre", [])][:30]
    return title or "Untitled track", artist or "Unknown artist", tag("album", ""), [g for g in genres if g], length


def extract_art(path, track_id):
    try:
        audio = mutagen.File(path)
        art = None
        if hasattr(audio, "pictures") and audio.pictures:
            art = audio.pictures[0].data
        elif audio is not None and audio.tags:
            for key, value in audio.tags.items():
                if str(key).startswith("APIC"):
                    art = value.data
                    break
            if art is None and "covr" in audio.tags and audio.tags["covr"]:
                art = bytes(audio.tags["covr"][0])
        if art and len(art) < 8 * 1024 * 1024:
            suffix = ".png" if art.startswith(b"\x89PNG\r\n\x1a\n") else ".jpg" if art.startswith(b"\xff\xd8\xff") else None
            if suffix:
                (s.DATA / "artwork").mkdir(exist_ok=True)
                (s.DATA / "artwork" / f"{track_id}{suffix}").write_bytes(art)
                return f"/api/tracks/{track_id}/artwork"
    except Exception:
        # Artwork is optional and must not break playable imports.
        pass
    return None


@app.post("/api/tracks/import")
async def import_audio(files: list[UploadFile] = File(...)):
    if len(files) > 100:
        raise HTTPException(422, "Import at most 100 files at a time.")
    s.DATA.mkdir(parents=True, exist_ok=True)
    (s.DATA / "audio").mkdir(exist_ok=True)
    result, errors = [], []
    for uploaded in files:
        filename = Path(uploaded.filename or "untitled").name
        suffix = Path(filename).suffix.lower()
        path = None
        try:
            if suffix not in SUPPORTED:
                raise ValueError("Supported imports: MP3, WAV, FLAC, M4A/AAC, OGG, OPUS, AIFF.")
            track_id = s.uid("track_")
            path = s.DATA / "audio" / f"{track_id}{suffix}"
            digest = hashlib.sha256()
            total = 0
            with path.open("wb") as out:
                while chunk := await uploaded.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_AUDIO_BYTES:
                        raise ValueError("Files must be no larger than 100 MB.")
                    digest.update(chunk)
                    out.write(chunk)
            if not total:
                raise ValueError("The file is empty.")
            title, artist, album, genres, duration = read_metadata(path, filename)
            source_hash = digest.hexdigest()
            with s.connect() as conn:
                prior = conn.execute("SELECT * FROM tracks WHERE source_hash=? ORDER BY rowid LIMIT 1", (source_hash,)).fetchone()
                if prior:
                    prior_track = json.loads(prior["payload"])
                    if not s.safe_audio_path(prior["storage_name"]):
                        conn.execute("UPDATE tracks SET storage_name=? WHERE id=?", (path.relative_to(s.DATA).as_posix(), prior["id"]))
                        s.enqueue(conn, prior["id"], source_hash)
                        path = None
                    result.append(s.serialize_track(s.raw_track(conn, prior["id"])))
                    if path:
                        path.unlink(missing_ok=True)
                        path = None
                    continue
                artwork = extract_art(path, track_id)
                track = m.Track(
                    id=track_id, title=title, artist=artist, album=album, genres=genres,
                    duration=duration, artwork=artwork, addedAt=s.now(),
                ).model_dump()
                conn.execute("INSERT INTO tracks(id,payload,source_hash,storage_name) VALUES(?,?,?,?)", (track_id, s.encode(track), source_hash, path.relative_to(s.DATA).as_posix()))
                s.enqueue(conn, track_id, source_hash)
                result.append(s.serialize_track(s.raw_track(conn, track_id)))
                path = None
        except (ValueError, OSError, mutagen.MutagenError) as exc:
            errors.append(f"{filename}: {str(exc)[:300]}")
        finally:
            if path:
                path.unlink(missing_ok=True)
            await uploaded.close()
    return {"tracks": result, "errors": errors}


@app.get("/api/tracks/{track_id}")
def get_track(track_id: str):
    with s.connect() as conn:
        return s.serialize_track(require_track(conn, track_id))


@app.get("/api/tracks/{track_id}/audio")
def get_audio(track_id: str):
    with s.connect() as conn:
        row = require_track(conn, track_id)
        path = s.safe_audio_path(row["storage_name"])
    if not path:
        raise HTTPException(404, "The audio file is missing. Import the same file to relink it.")
    types = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".aif": "audio/aiff", ".aiff": "audio/aiff"}
    return FileResponse(path, media_type=types.get(path.suffix.lower(), "application/octet-stream"), headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/tracks/{track_id}/artwork")
def get_artwork(track_id: str):
    with s.connect() as conn:
        require_track(conn, track_id)
    for suffix, mime in ART_MIMES.items():
        path = s.safe_audio_path(f"artwork/{track_id}{suffix}")
        if path:
            return FileResponse(path, media_type=mime)
    raise HTTPException(404, "No embedded artwork is available.")


@app.patch("/api/tracks/{track_id}")
def update_track(track_id: str, patch: m.TrackPatch):
    changes = patch.model_dump(exclude_unset=True)
    if any(changes.get(k) is None for k in ("title", "artist", "genres") if k in changes):
        raise HTTPException(422, "Title, artist, and genres cannot be null.")
    with s.connect() as conn:
        track = s.serialize_track(require_track(conn, track_id))
        track.update(changes)
        s.save_track(conn, track)
        if "enjoyment" in changes:
            event = {"id": s.uid("enjoyment_"), "trackId": track_id, "score": changes["enjoyment"], "createdAt": s.now()}
            conn.execute("INSERT INTO enjoyment_history(id,track_id,payload) VALUES(?,?,?)", (event["id"], track_id, s.encode(event)))
        return track


@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str):
    with s.connect() as conn:
        row = require_track(conn, track_id)
        audio = s.safe_audio_path(row["storage_name"])
        conn.execute("DELETE FROM tracks WHERE id=?", (track_id,))
        for table in ("groups", "sessions", "connections"):
            for item in s.objects(conn, table):
                if table == "connections":
                    if track_id in (item["sourceId"], item["targetId"]):
                        conn.execute("DELETE FROM connections WHERE id=?", (item["id"],))
                else:
                    item["trackIds"] = [i for i in item["trackIds"] if i != track_id]
                    if table == "sessions":
                        item["actualDuration"] = sum(t["duration"] for t in s.all_tracks(conn) if t["id"] in item["trackIds"])
                        item["reasons"].pop(track_id, None)
                    conn.execute(f"UPDATE {table} SET payload=? WHERE id=?", (s.encode(item), item["id"]))
        playback = s.get_state(conn, "playback", m.Playback().model_dump())
        playback["trackIds"] = [i for i in playback["trackIds"] if i != track_id]
        if playback["currentTrackId"] == track_id:
            playback.update(currentTrackId=None, position=0)
        s.set_state(conn, "playback", playback)
    if audio and "audio" in audio.relative_to(s.DATA).parts:
        audio.unlink(missing_ok=True)
    for suffix in ART_MIMES:
        (s.DATA / "artwork" / f"{track_id}{suffix}").unlink(missing_ok=True)
    return {"ok": True}


@app.post("/api/tracks/{track_id}/mood-ratings")
def rate_mood(track_id: str, rating: m.MoodRating):
    with s.connect() as conn:
        track = s.serialize_track(require_track(conn, track_id))
        if not conn.execute("SELECT 1 FROM moods WHERE id=?", (rating.moodId,)).fetchone():
            raise HTTPException(422, "Mood not found.")
        track["moodRatings"][rating.moodId] = rating.score
        track["moodNotes"][rating.moodId] = rating.note
        s.save_track(conn, track)
        event = {"id": s.uid("rating_"), "trackId": track_id, **rating.model_dump(), "createdAt": s.now()}
        conn.execute("INSERT INTO rating_history(id,track_id,payload) VALUES(?,?,?)", (event["id"], track_id, s.encode(event)))
        return track


@app.delete("/api/tracks/{track_id}/mood-ratings/{mood_id}")
def delete_rating(track_id: str, mood_id: str):
    with s.connect() as conn:
        track = s.serialize_track(require_track(conn, track_id))
        track["moodRatings"].pop(mood_id, None)
        track["moodNotes"].pop(mood_id, None)
        s.save_track(conn, track)
        event = {"id": s.uid("rating_"), "trackId": track_id, "moodId": mood_id, "score": None, "note": "Rating removed", "createdAt": s.now()}
        conn.execute("INSERT INTO rating_history(id,track_id,payload) VALUES(?,?,?)", (event["id"], track_id, s.encode(event)))
        return track


@app.get("/api/tracks/{track_id}/rating-history")
def rating_history(track_id: str):
    with s.connect() as conn:
        require_track(conn, track_id)
        return {"events": [json.loads(r[0]) for r in conn.execute("SELECT payload FROM rating_history WHERE track_id=? ORDER BY rowid DESC", (track_id,))], "enjoymentEvents": [json.loads(r[0]) for r in conn.execute("SELECT payload FROM enjoyment_history WHERE track_id=? ORDER BY rowid DESC", (track_id,))]}


@app.post("/api/moods")
def create_mood(body: m.MoodCreate):
    with s.connect() as conn:
        moods = s.objects(conn, "moods")
        if any(mood["label"].casefold() == body.label.casefold() for mood in moods):
            raise HTTPException(409, "A mood with that name already exists.")
        if len(moods) >= 100:
            raise HTTPException(422, "A library can have at most 100 moods.")
        angle = len(moods) * 2.39996323
        mood = {"id": s.uid("mood_"), "label": body.label, "color": body.color or "#9370A6", "x": round(0.5 + 0.30 * math.cos(angle), 4), "y": round(0.5 + 0.30 * math.sin(angle), 4)}
        conn.execute("INSERT INTO moods(id,payload) VALUES(?,?)", (mood["id"], s.encode(mood)))
        return mood


@app.post("/api/groups")
def create_group(body: m.GroupCreate):
    with s.connect() as conn:
        require_ids(conn, body.trackIds)
        group = {"id": s.uid("group_"), "name": body.name, "trackIds": list(dict.fromkeys(body.trackIds))}
        conn.execute("INSERT INTO groups(id,payload) VALUES(?,?)", (group["id"], s.encode(group)))
        return group


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: str):
    with s.connect() as conn:
        conn.execute("DELETE FROM groups WHERE id=?", (group_id,))
    return {"ok": True}


@app.post("/api/connections")
def create_connection(body: m.ConnectionCreate):
    if body.sourceId == body.targetId:
        raise HTTPException(422, "Choose two different tracks.")
    with s.connect() as conn:
        require_ids(conn, [body.sourceId, body.targetId])
        for connection in s.objects(conn, "connections"):
            if {connection["sourceId"], connection["targetId"]} == {body.sourceId, body.targetId}:
                connection["reason"] = body.reason
                connection["origin"] = "user"
                conn.execute("UPDATE connections SET payload=? WHERE id=?", (s.encode(connection), connection["id"]))
                return connection
        connection = {"id": s.uid("connection_"), **body.model_dump(), "origin": "user"}
        conn.execute("INSERT INTO connections(id,payload) VALUES(?,?)", (connection["id"], s.encode(connection)))
        return connection


@app.delete("/api/connections/{connection_id}")
def delete_connection(connection_id: str):
    with s.connect() as conn:
        conn.execute("DELETE FROM connections WHERE id=?", (connection_id,))
    return {"ok": True}


@app.put("/api/positions")
def update_positions(body: m.Positions):
    with s.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        revision = s.get_state(conn, "layoutRevision", 0)
        if revision != body.revision:
            raise HTTPException(409, "This map changed. Refresh it before moving more tracks.")
        require_ids(conn, [p.trackId for p in body.positions])
        for position in body.positions:
            track = s.serialize_track(s.raw_track(conn, position.trackId))
            track["position"] = {"x": position.x, "y": position.y}
            s.save_track(conn, track)
        s.set_state(conn, "layoutRevision", revision + 1)
        return {"layoutRevision": revision + 1}


@app.delete("/api/positions")
def clear_positions():
    with s.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        for track in s.all_tracks(conn):
            track["position"] = None
            s.save_track(conn, track)
        revision = s.get_state(conn, "layoutRevision", 0) + 1
        s.set_state(conn, "layoutRevision", revision)
        return {"layoutRevision": revision}


@app.put("/api/playback")
def update_playback(body: m.Playback):
    if body.currentTrackId is not None and body.currentTrackId not in body.trackIds:
        raise HTTPException(422, "The current track must be in the queue.")
    with s.connect() as conn:
        require_ids(conn, body.trackIds)
        if body.currentTrackId:
            duration = s.serialize_track(s.raw_track(conn, body.currentTrackId))["duration"]
            body.position = min(body.position, duration)
        value = body.model_dump()
        s.set_state(conn, "playback", value)
        return value


@app.post("/api/tasteplay")
def generate_tasteplay(body: m.TasteRequest):
    with s.connect() as conn:
        mood_row = conn.execute("SELECT payload FROM moods WHERE id=?", (body.moodId,)).fetchone()
        if not mood_row:
            raise HTTPException(422, "Choose an existing mood.")
        mood = json.loads(mood_row[0])
        candidates = [t for t in s.all_tracks(conn) if t["audioUrl"] and t["moodRatings"].get(body.moodId, 0) >= 3]
        candidates.sort(key=lambda t: t["id"])
        seed = body.seed if body.seed is not None else random.SystemRandom().randrange(2147483647)
        rng = random.Random(seed)
        jitter = {t["id"]: rng.random() * 8 for t in candidates}
        target = body.durationMinutes * 60
        chosen, artist_counts, duration = [], {}, 0.0
        while candidates:
            ranked = sorted(candidates, key=lambda t: -(t["moodRatings"][body.moodId] * 100 + (t["enjoyment"] if t["enjoyment"] is not None else 3) * 8 + jitter[t["id"]] - artist_counts.get(t["artist"], 0) * 30))
            # Prefer quality ordering, but avoid a gross duration overshoot when a close alternative exists.
            acceptable = [t for t in ranked if not chosen or abs(target - (duration + t["duration"])) < abs(target - duration)]
            if not acceptable:
                break
            track = acceptable[0]
            chosen.append(track)
            duration += track["duration"]
            artist_counts[track["artist"]] = artist_counts.get(track["artist"], 0) + 1
            candidates.remove(track)
            if duration >= target:
                break
        if not chosen:
            message = f"No playable tracks have a fit rating of at least 3/5 for {mood['label']}. Rate a few songs to start this session."
        elif duration < target * 0.85:
            message = f"Your rated library has {len(chosen)} matching tracks ({round(duration / 60, 1)} minutes). More {mood['label'].lower()} ratings will give TastePlay more room."
        else:
            message = "Whole tracks, chosen from your mood ratings with enjoyment and artist variety as additional signals."
        reasons = {t["id"]: f"You rated this {t['moodRatings'][body.moodId]}/5 for {mood['label'].lower()}" + (f" and {t['enjoyment']}/5 for enjoyment." if t["enjoyment"] is not None else ".") for t in chosen}
        session = m.TasteSession(id=s.uid("session_"), moodId=body.moodId, trackIds=[t["id"] for t in chosen], requestedDuration=target, actualDuration=duration, reasons=reasons, message=message, seed=seed, method="mood-fit-variety-v1").model_dump()
        conn.execute("INSERT INTO sessions(id,payload) VALUES(?,?)", (session["id"], s.encode(session)))
        return session


@app.get("/api/sessions")
def get_sessions():
    with s.connect() as conn:
        return {"sessions": list(reversed(s.objects(conn, "sessions")))[0:100]}


@app.post("/api/feedback")
def record_feedback(body: m.FeedbackCreate):
    with s.connect() as conn:
        require_track(conn, body.trackId)
        if not conn.execute("SELECT 1 FROM moods WHERE id=?", (body.moodId,)).fetchone():
            raise HTTPException(422, "Mood not found.")
        if body.sessionId:
            row = conn.execute("SELECT payload FROM sessions WHERE id=?", (body.sessionId,)).fetchone()
            if not row:
                raise HTTPException(422, "Session not found.")
            session = json.loads(row[0])
            if session["moodId"] != body.moodId or body.trackId not in session["trackIds"]:
                raise HTTPException(422, "Feedback must refer to a track and mood in this session.")
        event = m.FeedbackEvent(id=s.uid("feedback_"), createdAt=s.now(), **body.model_dump()).model_dump()
        conn.execute("INSERT INTO feedback(id,track_id,payload) VALUES(?,?,?)", (event["id"], body.trackId, s.encode(event)))
        return event


@app.patch("/api/sessions/{session_id}")
def edit_session(session_id: str, body: m.SessionPatch):
    if len(set(body.trackIds)) != len(body.trackIds):
        raise HTTPException(422, "A session cannot contain duplicate tracks.")
    with s.connect() as conn:
        row = conn.execute("SELECT payload FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Session not found.")
        require_ids(conn, body.trackIds)
        session = json.loads(row[0])
        session["trackIds"] = body.trackIds
        tracks = {t["id"]: t for t in s.all_tracks(conn)}
        session["actualDuration"] = sum(tracks[i]["duration"] for i in body.trackIds)
        session["reasons"] = {i: session["reasons"].get(i, "Added by you.") for i in body.trackIds}
        conn.execute("UPDATE sessions SET payload=? WHERE id=?", (s.encode(session), session_id))
        return session


@app.get("/api/jobs")
def jobs():
    with s.connect() as conn:
        rows = conn.execute("SELECT id,track_id,state,error FROM jobs ORDER BY created_at DESC LIMIT 1000")
        return {"jobs": [{"id": row["id"], "trackId": row["track_id"], "state": row["state"], "error": row["error"]} for row in rows]}


@app.post("/api/tracks/{track_id}/analyze")
def analyze(track_id: str):
    with s.connect() as conn:
        row = require_track(conn, track_id)
        if not s.safe_audio_path(row["storage_name"]) or not row["source_hash"]:
            raise HTTPException(422, "Relink this track's audio before analyzing it.")
        job_id = s.enqueue(conn, track_id, row["source_hash"], force=True)
        return {"jobId": job_id}


@app.get("/api/export")
def export_map():
    with s.connect() as conn:
        value = s.library(conn)
        for track in value["tracks"]:
            row = s.raw_track(conn, track["id"])
            track["sourceHash"] = row["source_hash"]
            track["audioUrl"] = None
            if track["artwork"] and track["artwork"].startswith("/api/"):
                track["artwork"] = None
        document = {"schemaVersion": 1, "exportedAt": s.now(), **value, "sessions": s.objects(conn, "sessions"), "ratingHistory": s.objects(conn, "rating_history"), "feedback": s.objects(conn, "feedback"), "enjoymentHistory": s.objects(conn, "enjoyment_history")}
        return JSONResponse(document, headers={"Content-Disposition": 'attachment; filename="favescape-map.json"'})


def validate_document_references(doc: m.MapDocument):
    track_ids = {t.id for t in doc.tracks}
    mood_ids = {mood.id for mood in doc.moods}
    if len(track_ids) != len(doc.tracks) or len(mood_ids) != len(doc.moods):
        raise HTTPException(422, "Map contains duplicate track or mood IDs.")
    for table in (doc.connections, doc.groups, doc.sessions, doc.ratingHistory, doc.feedback, doc.enjoymentHistory):
        if len({v.id for v in table}) != len(table):
            raise HTTPException(422, "Map contains duplicate record IDs.")
    for track in doc.tracks:
        if not set(track.moodRatings).issubset(mood_ids) or not set(track.moodNotes).issubset(mood_ids):
            raise HTTPException(422, "A track refers to a missing mood.")
        if track.artwork and not (track.artwork.startswith("/artwork/") and ".." not in track.artwork and "\\" not in track.artwork):
            track.artwork = None
    for connection in doc.connections:
        if connection.sourceId not in track_ids or connection.targetId not in track_ids or connection.sourceId == connection.targetId:
            raise HTTPException(422, "A connection refers to missing or identical tracks.")
    for group in doc.groups:
        if not set(group.trackIds).issubset(track_ids):
            raise HTTPException(422, "A group refers to missing tracks.")
    for session in doc.sessions:
        if session.moodId not in mood_ids or not set(session.trackIds).issubset(track_ids) or len(set(session.trackIds)) != len(session.trackIds):
            raise HTTPException(422, "A session has invalid track or mood references.")
    if not set(doc.playback.trackIds).issubset(track_ids) or (doc.playback.currentTrackId and doc.playback.currentTrackId not in doc.playback.trackIds):
        raise HTTPException(422, "Playback queue refers to missing tracks.")
    for event in doc.ratingHistory:
        if event.trackId not in track_ids or event.moodId not in mood_ids:
            raise HTTPException(422, "Rating history refers to missing tracks or moods.")
    session_ids = {session.id for session in doc.sessions}
    for event in doc.feedback:
        if event.trackId not in track_ids or event.moodId not in mood_ids or (event.sessionId and event.sessionId not in session_ids):
            raise HTTPException(422, "Feedback refers to a missing track, mood, or session.")
    for event in doc.enjoymentHistory:
        if event.trackId not in track_ids:
            raise HTTPException(422, "Enjoyment history refers to a missing track.")


@app.post("/api/import")
def import_map(doc: m.MapDocument):
    validate_document_references(doc)
    with s.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        mood_map, track_map = {}, {}
        for mood in doc.moods:
            value = mood.model_dump()
            existing = conn.execute("SELECT payload FROM moods WHERE id=?", (mood.id,)).fetchone()
            new_id = mood.id
            if existing and json.loads(existing[0])["label"].casefold() != mood.label.casefold():
                new_id = s.uid("mood_")
            mood_map[mood.id] = new_id
            value["id"] = new_id
            conn.execute("INSERT OR REPLACE INTO moods(id,payload) VALUES(?,?)", (new_id, s.encode(value)))
        for exported in doc.tracks:
            item = exported.model_dump()
            source_hash = item.pop("sourceHash")
            existing = conn.execute("SELECT * FROM tracks WHERE source_hash=? ORDER BY rowid LIMIT 1", (source_hash,)).fetchone() if source_hash else None
            if existing is None:
                existing = s.raw_track(conn, exported.id)
                if existing and source_hash and existing["source_hash"] not in (None, source_hash):
                    existing = None
                    item["id"] = s.uid("track_")
            if existing:
                item["id"] = existing["id"]
            track_map[exported.id] = item["id"]
            item["moodRatings"] = {mood_map[k]: v for k, v in item["moodRatings"].items()}
            item["moodNotes"] = {mood_map[k]: v for k, v in item["moodNotes"].items()}
            item["audioUrl"] = None
            if item["analysisStatus"] in ("pending", "running"):
                item["analysisStatus"] = "failed"
                item["analysisError"] = "Import the matching audio file to run analysis."
            if existing:
                # Keep local measured analysis and artwork when merging personal annotations.
                local = json.loads(existing["payload"])
                for key in ("features", "analysisStatus", "analysisError", "artwork"):
                    item[key] = local.get(key)
                conn.execute("UPDATE tracks SET payload=?,source_hash=COALESCE(source_hash,?) WHERE id=?", (s.encode(item), source_hash, item["id"]))
            else:
                conn.execute("INSERT INTO tracks(id,payload,source_hash,storage_name) VALUES(?,?,?,NULL)", (item["id"], s.encode(item), source_hash))
        for table, values in (("groups", doc.groups), ("connections", doc.connections), ("sessions", doc.sessions), ("rating_history", doc.ratingHistory), ("feedback", doc.feedback), ("enjoyment_history", doc.enjoymentHistory)):
            for model in values:
                item = model.model_dump()
                if "trackIds" in item:
                    item["trackIds"] = list(dict.fromkeys(track_map[i] for i in item["trackIds"]))
                if table == "connections":
                    item["sourceId"], item["targetId"] = track_map[item["sourceId"]], track_map[item["targetId"]]
                    if item["sourceId"] == item["targetId"]:
                        continue
                if "moodId" in item:
                    item["moodId"] = mood_map[item["moodId"]]
                if table == "sessions":
                    item["reasons"] = {track_map[k]: v for k, v in item["reasons"].items() if k in track_map}
                    tracks = {t["id"]: t for t in s.all_tracks(conn)}
                    item["actualDuration"] = sum(tracks[i]["duration"] for i in item["trackIds"])
                if table in ("rating_history", "feedback", "enjoyment_history"):
                    item["trackId"] = track_map[item["trackId"]]
                    conn.execute(f"INSERT OR REPLACE INTO {table}(id,track_id,payload) VALUES(?,?,?)", (item["id"], item["trackId"], s.encode(item)))
                else:
                    conn.execute(f"INSERT OR REPLACE INTO {table}(id,payload) VALUES(?,?)", (item["id"], s.encode(item)))
        playback = doc.playback.model_dump()
        playback["trackIds"] = [track_map[i] for i in playback["trackIds"]]
        playback["currentTrackId"] = track_map.get(playback["currentTrackId"])
        s.set_state(conn, "playback", playback)
        s.set_state(conn, "layoutRevision", s.get_state(conn, "layoutRevision", 0) + 1)
        s.set_state(conn, "seeded", True)
        return s.library(conn)
