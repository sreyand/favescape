# Local backend

From the repository root, using Python 3.12 or newer:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe scripts/generate_demo.py
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765
```

Run the analysis worker in a second terminal:

```powershell
.\.venv\Scripts\python.exe -m backend.worker
```

Use `--once` to drain queued analysis and exit. The API works without the worker: imports, playback, ratings, the mood map, and TastePlay remain available, while analysis shows as pending.

The default SQLite database, audio, artwork and worker lock are under `.data/`. Set `FAVESCAPE_DATA_DIR` to an absolute directory to use a separate library. Data is never uploaded to an external service. Do not expose the local server on a public network.

Browser request Origins are limited to the local app ports 5173/4173 and API port 8765 on `localhost` or `127.0.0.1`. Unrelated/null Origins and untrusted Host headers are rejected. This prevents arbitrary websites from submitting simple uploads to the local service; it is not account authorization for a hosted deployment. CLI requests without an Origin remain supported.

The initial analysis pipeline is `spectral-onset-v1`, an explainable numpy/scipy baseline. It analyzes entire clips up to 45 seconds, or three 15-second windows centered near 15%, 50% and 85% of a longer track. It reports linear RMS amplitude, mean spectral centroid in Hz, and an onset-autocorrelation tempo estimate in BPM. Tempo has half/double-time ambiguity; amplitude and brightness do not measure emotion. M4A/AAC playback depends on the browser; local analysis decoder support can be narrower. A failed analysis never disables playback.

SQLite migrations are tracked in `backend/app/migrations`. Jobs are persisted, keyed by source hash and analysis version, and recovered after worker restart. A filesystem lock enforces one worker per data directory.

TastePlay `mood-fit-variety-v1` uses only explicit mood fit >=3/5 and available local audio. It favors fit, then enjoyment, with a soft repeated-artist penalty and seeded tie variation. It uses whole songs and reports the actual duration and insufficient catalog coverage. It does not infer ratings, train a model, or treat skips as dislikes.

Exported maps contain no raw audio, local filesystem paths, or embedded cover bytes. Import validates the complete schema and cross-references before a transaction. Audio relinks by source SHA-256 when importing the exact matching file. Missing audio remains visible and can be relinked with normal audio import.
