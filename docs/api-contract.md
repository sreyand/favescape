# Shared implementation contract

All API routes use `/api`. JSON uses camelCase; track duration and playback position are seconds. Mood/track coordinates are normalized to 0..1. The canonical frontend types are `apps/web/src/types.ts`; preserve them across components and backend serialization.

- `GET /api/library` → `Library` (tracks, moods, connections, groups, layoutRevision, playback).
- `POST /api/tracks/import` multipart field `files`, multiple uploads → `{ tracks: Track[], errors: string[] }`. Register playable files independently of optional feature analysis.
- `GET /api/tracks/{id}/audio` → private local audio supporting byte ranges. Track `audioUrl` points here.
- `PATCH /api/tracks/{id}` body `{title?,artist?,genres?,enjoyment?}` → `Track`.
- `DELETE /api/tracks/{id}` → `{ok:true}`; clean references.
- `POST /api/tracks/{id}/mood-ratings` body `{moodId,score,note?}` → `Track`.
- `DELETE /api/tracks/{id}/mood-ratings/{moodId}` → `Track`.
- `POST /api/moods` body `{label,color?}` → `Mood`.
- `POST /api/groups` body `{name,trackIds}` → `Group`; `DELETE /api/groups/{id}`.
- `POST /api/connections` body `{sourceId,targetId,reason?}` → `Connection`; `DELETE /api/connections/{id}`.
- `PUT /api/positions` body `{positions:[{trackId,x,y}],revision}` → `{layoutRevision:number}`; return HTTP 409 on stale revisions.
- `DELETE /api/positions` → `{layoutRevision:number}` to clear manual overrides.
- `PUT /api/playback` body `PlaybackState` → `PlaybackState`.
- Playback state also supports default-false `shuffle` and `repeat` preferences; old saved documents remain compatible.
- `POST /api/tasteplay` body `{moodId,durationMinutes,seed?}` → `TasteSession`. Require an explicit positive mood fit (>=3); unknown fit is not negative. Avoid duplicate tracks, prefer enjoyment, softly penalize artist repetition, explain insufficient coverage. Whole tracks only.
- `GET /api/sessions` → `{sessions:TasteSession[]}`; `PATCH /api/sessions/{id}` body `{trackIds}` → `TasteSession`.
- `POST /api/feedback` body `{trackId,moodId,sessionId?,value:'great_fit'|'wrong_mood'}` → saved event; explicit judgments stay separate from ratings and skips.
- `GET /api/export` → versioned map document. Contains source hashes for relinking but no file paths or raw audio. Includes moods, ratings, manual positions, groups, connections, sessions, playback.
- `POST /api/import` body exported JSON → `Library`; validate fully before transaction. Merge/relink by stable ID or source hash; imported entries without audio remain visible, with `audioUrl:null`.
- `GET /api/jobs` → `{jobs:[{id,trackId,state,error}]}`; `POST /api/tracks/{id}/analyze` queues or retries analysis.
- `GET /api/health` → `{status:'ok'}`.

Local SQLite store and opaque audio files live in ignored `.data/`. Backend binds to 127.0.0.1. Development frontend proxies `/api` to port 8765. Vite serves frontend on port 5173. Artwork is served from tracked `apps/web/public/artwork/`; uploaded embedded art can use an internally resolved API path. Feature worker can use soundfile/numpy/scipy/librosa; feature extraction failures must not prevent playback. Model training is outside this implementation.

Synthetic demo catalog comes from `fixtures/demo-catalog.json`. Its original generated audio is created locally by `scripts/generate_demo.py`, and its metadata/ratings are explicitly demo data. Do not use commercial song names with synthetic replacement audio. Default seed only when database is empty; avoid duplicating demo tracks on restart.
