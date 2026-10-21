# TasteMap — project instructions and development plan

## Purpose and scope

These instructions apply to the entire repository. Read them before planning or changing the project. Preserve any established repository conventions unless they conflict with the product requirements below.

TasteMap is a personal music playback and visualization project. It lets someone explore the shape of their taste through songs, genres, enjoyment ratings, personal mood associations, and sonic similarities. The initial audience is a music fan exploring hyperpop, house, and EDM.

The core experience is: **import music → listen → rate enjoyment and mood → explore a personal map → play a mood-based TastePlay session.**

The mood map uses deliberate user ratings. Audio analysis adds a separate view of musical characteristics and can help sequence playback. Playback, ratings, the mood map, and a first rules-based TastePlay must work before adding a pretrained audio encoder. A possible future direction is focused discovery such as “find more music like this corner of my map,” informed by deliberate connections across people's maps.

## How to execute this plan

- If asked to build TasteMap, work through the MVP phases in order and complete their acceptance criteria. Work autonomously on routine, reversible implementation choices.
- If asked for a particular phase or feature, implement that scope and its necessary prerequisites.
- Inspect existing files before scaffolding. Reuse the current stack when practical; the stack below is the default for an empty repository.
- Keep the app runnable at each milestone. Record setup commands and completed work in `README.md` and `docs/progress.md`.
- Use fixtures to unblock the interface while audio processing is being developed. Clearly label their provenance.
- Do not present a phase as complete while its data is still mocked, unless the phase explicitly calls for fixtures.
- Do not implement the later recommendation roadmap automatically when the MVP is finished.
- Ask for clarification only when a missing decision materially blocks progress. Honor the user's latest instructions over this plan.

## Product and visual direction

- Working name: **Favescape**, following the user's selected repository. Earlier design references use TasteMap; retain their visual direction and use Favescape in the app.
- Feel: throwback music magazines, vintage record sleeves, and playful early internet graphics, expressed through a clean contemporary interface.
- Use warm ivory, cobalt blue, tomato red, butter yellow, and restrained sage accents. Define these as reusable design tokens.
- Pair expressive chunky or italic display typography with highly readable interface text. Choose appropriately licensed fonts.
- Use thin dark outlines, restrained hard shadows, subtle texture, and occasional star accents. Keep charts and labels sharp.
- The user's reference to Pepsi/Starry expressed a retro aesthetic. Do not interpret it as soda packaging, beverage branding, or an advertisement.
- The map is the main event. Avoid filling the screen with generic dashboard cards, decorative charts, or marketing sections.
- The user prefers a minimalist interface. Default screens should show the map, selected track, and essential playback. Use one concise toolbar; reveal ratings, detailed metrics, editing, and secondary playback controls on demand. Avoid repeated labels, slogans, helper sentences, badges, and duplicated actions.
- Support responsive layouts, visible keyboard focus, sufficient contrast, reduced motion, and a usable text alternative to the map.

## MVP experience

1. Import supported local audio files, see metadata, and play them without waiting for analysis.
2. Use play/pause, seeking, volume, previous/next, and an editable playback queue that persists while navigating the app.
3. Rate enjoyment separately from how well each song fits one or more moods. Optionally add a note.
4. Explore a mood map based on those ratings, with genre filters, search, a track inspector, pan/zoom, and a text alternative.
5. Generate a TastePlay session from the local library for a selected mood and approximate duration; inspect and edit its queue.
6. See the current track and the session's path on the map.
7. Explore measured audio features and a basic sound map as an additional view, with processing status and provenance visible.
8. Add or edit genre tags, named groups, manual positions, and intentional connections between tracks.
9. Save and reopen ratings, maps, and playlists. Reopening restores playback position without automatically starting sound.
10. Export and import a versioned map document containing ratings and playlist metadata, without bundling audio by default.

Initial scale: a collection of roughly 50–100 tracks. Prioritize a coherent experience at this scale over infrastructure for a global catalog.

## Defaults for an empty repository

- Frontend: React, TypeScript, and Vite.
- Player: one persistent HTML audio element controlled by shared playback state. Verify supported file types in the target browser; start with MP3 and add WAV/FLAC/AAC where the decoder and browser support them. Report unsupported playback honestly.
- Map: SVG for the initial dataset size, with a small focused interaction library if needed. Move to Canvas/WebGL only when measured rendering needs justify it.
- Backend: Python and FastAPI.
- Persistence: SQLite, with explicit schema migrations and a repository/service layer.
- Analysis: Python and librosa for measured audio features. A pretrained audio encoder is an optional later milestone after the core experience works.
- Layout: stable mood anchors driven by explicit ratings for the mood view; measured-feature layout for the initial sound view. Consider UMAP when introducing audio embeddings.
- File storage: local application data directories excluded from Git. Keep user files outside public web assets.
- Jobs: a persisted jobs table and one separate local worker process. The API enqueues work and returns a job ID; the frontend polls status.
- Development: document frontend, API, and worker startup. Pin compatible dependencies after checking current official documentation.

Start with a local single-user application. Accounts, public sharing, streaming catalog integration, managed storage, distributed queues, vector databases, billing, and custom model training are outside the MVP. TastePlay initially selects music already in the local library.

Suggested structure, adjusted to existing repository conventions:

```text
apps/web/                 React interface and map interactions
backend/app/             API, schemas, services, and persistence
backend/analysis/        Audio features, encoder adapter, and layout
backend/worker/          Persisted job processing
fixtures/                Clearly labeled synthetic metadata and permitted audio
docs/                    Setup, decisions, metric definitions, and progress
```

## Data model and provenance

Use stable IDs independent of display names and file paths. Keep these concepts separate even if some share tables initially:

- **Track:** title, artist, optional external catalog IDs, duration, and metadata provenance. Genre tags may overlap.
- **Audio source:** source type, internal file location, content hash, and whether the audio is a full track or an excerpt.
- **Analysis:** source hash, extraction version, encoder/checkpoint version, segment policy, measured features, optional embedding, and processing status.
- **Collection/map:** name, member tracks, display settings, active layout version, and revision.
- **Position:** generated coordinates and optional manual position override. Preserve both.
- **Group:** a user-named collection of tracks; membership may overlap with other groups.
- **Connection:** track pair, origin (`user` or `model`), optional reason, and optional model score with its method/version.
- **Mood:** stable ID, editable display name, and optional display color; provide starter moods and support user-defined moods.
- **Mood rating event:** track, mood, fit score from 1–5, optional note, and timestamp. Permit multiple moods per track. Show the latest active rating for each track/mood by default; retain history and support explicit removal/correction.
- **Enjoyment rating:** a separate 1–5 score with timestamp. Mood fit must never implicitly become enjoyment.
- **TastePlay session:** selected mood, duration request, generation method/version/seed, ordered track IDs, scoring reasons, and subsequent user edits.
- **Playback state:** current queue, track, position, volume, and repeat/shuffle preferences, separate from analysis and map coordinates.
- **Feedback:** an explicit similarity judgment or accepted/rejected suggestion, with collection context and timestamp.
- **Job:** type, state, progress, input/version keys, attempts, and a safe error message.

Keep imported genre metadata, user tags, model estimates, and measured audio values distinguishable. Missing analysis is `null` or unavailable, never a fabricated zero.

An unrated mood is unknown, not a score of zero or a negative training example. Do not confuse the user's current emotional state with the mood they associate with a song; V1 collects song mood fit.

Moving a dot for visual arrangement does not automatically mean “these songs sound alike.” Capture sonic judgments through explicit connection or feedback actions.

## API and job responsibilities

Suggested endpoints; adapt names to existing conventions:

- `GET /collections/{id}/map`: return nodes, positions, groups, visible connections, layout metadata, and analysis provenance.
- `POST /tracks/import`: validate and register supported audio; enqueue processing and return the track and job IDs.
- `GET /jobs/{id}`: return queued/running/succeeded/failed status and actionable failure details.
- `GET /tracks/{id}`: return metadata, analysis availability, measured features, and source information.
- `PATCH /tracks/{id}`: update editable metadata and user tags.
- `GET /tracks/{id}/audio`: serve the user's imported audio to the local player, with content type and range requests for seeking. Resolve storage paths internally; never expose arbitrary filesystem access.
- `POST /tracks/{id}/mood-ratings`: record a mood-fit event; provide correction/removal operations.
- `PUT /tracks/{id}/enjoyment`: save the separate enjoyment rating.
- `POST /tasteplay/sessions`: generate an ordered session and return track IDs and short reasons; exclude unavailable audio.
- `PATCH /tasteplay/sessions/{id}`: save queue edits and progress without regenerating the playlist.
- `PUT /collections/{id}/positions`: save manual position overrides with a revision check.
- `POST /collections/{id}/connections`: save an intentional connection and optional reason.
- `POST /collections/{id}/groups`: create a named group; also provide update/delete operations.
- `POST /collections/{id}/layout-jobs`: explicitly request layout generation or regeneration.
- `GET /collections/{id}/export` and `POST /collections/import`: exchange validated, versioned map documents.

Keep decoding and model inference outside normal API request handling. Persist work before acknowledging it. Jobs must recover sensibly after worker restart and deduplicate equivalent source/version inputs.

Validate file type, size, decodeability, and user-controlled paths. Use application-generated storage names. Handle unsupported and corrupt files without breaking the rest of a collection.

## Playback, mood, and TastePlay behavior

### Playback

- Build playback early with user-provided files or a clearly licensed fixture. Keep one player mounted across view changes.
- Analysis failure must not disable a valid playable file. Playback failure must produce an actionable message and allow moving to another track.
- Respect browser autoplay requirements. Start sound only after a user action; restoring state must not unexpectedly start playback.
- Keep imported audio local. The initial server binds to loopback and has no public audio-sharing feature.
- Store opaque track IDs in map/session exports. On another installation, identify missing files and provide an explicit relink flow instead of claiming playback is available.

### Mood map

- Starter moods can include euphoric, melancholy, restless, calm, angry, and dreamy. They are editable personal labels, not psychological diagnoses or universal audio properties.
- Place rated songs relative to stable labeled mood anchors, with fit strength affecting their pull. Allow multiple mood associations and show those memberships in the inspector.
- State that positions express personal ratings through a visual layout. Neighboring dots do not automatically establish sonic similarity.
- Keep unrated tracks in a visible unplaced list. Never assign a mood merely to fill the visualization.
- Allow mood highlighting over the sound map and enjoyment-based styling with a legend. Keep the active layout method visible.
- Preserve positions when filtering, playback changes, or unrelated metadata edits occur. Relayout only affected mood data when appropriate; preserve manual overrides.

### TastePlay V1

- Begin with one selected mood, approximate session duration, and an optional reproducible shuffle seed. Multi-mood requests and emotional journeys are later enhancements.
- Rank available tracks primarily by explicit fit for the selected mood; use enjoyment as a separate preference signal. Missing enjoyment is neutral, and missing mood fit is unknown.
- Avoid duplicate tracks and use a soft artist-repetition penalty. Define tie-breaking and minimum-fit behavior explicitly; expose any relaxation instead of silently filling a session with poor matches.
- When ratings are too sparse, explain that limitation and show the available candidates. Do not require a trained model or invent ratings.
- Generate whole-track playlists near the requested duration and show the actual duration. Do not abruptly cut songs to meet the target.
- Add an optional transition cost using available measured audio features only after the first scoring baseline works. Missing features must not prevent playlist generation.
- Explain choices simply, for example “You rated this 5/5 for dreamy.” Let users reorder, remove, or replace tracks before and during playback.
- Render the ordered playlist as a path over existing map positions. Generating a session must not move the underlying map.
- Collect explicit “great fit” or “wrong mood” feedback separately. A skip is ambiguous and must not automatically create a dislike or negative mood rating.
- This is an explainable scoring algorithm in V1. Label it accurately and save its version and inputs so a learned model can later be evaluated against it.

## Audio analysis and map integrity

### Measured features

- Begin with tempo, RMS amplitude, spectral centroid as a brightness proxy, and optional onset strength.
- Document units, aggregation, normalization, and limitations. Tempo estimation can have half/double-time errors; RMS is not perceived loudness or emotional energy.
- Treat “energy” as a clearly documented derived score if implemented. Explain its ingredients in the interface.
- Treat “distortion,” “chaos,” and similar subjective attributes as user tags or explicitly labeled experimental estimates until a method has been validated.
- Genre tags should support multiple values. House and hyperpop can also sit within broader electronic categories; do not force a mutually exclusive genre tree.

### Audio representations and similarity

- Establish a baseline using normalized measured features before introducing an encoder.
- After the MVP core works, optionally evaluate a pretrained music-oriented audio encoder, such as CLAP's music checkpoint, as an experiment. Verify exact model/checkpoint licensing and input requirements before integration. Do not make model downloads a prerequisite for first playback or mood mapping.
- Training an audio encoder from scratch is outside the MVP. Inference on a new song does not require retraining the encoder on that song.
- Analyze a documented set of excerpts rather than silently using only a track's intro. Record segment selection and aggregation so results are reproducible.
- Define behavior for short clips, silence, and decoding failures. Treat excerpt-based analysis as analysis of that excerpt.
- Keep an adapter boundary so a different encoder can replace the first candidate without rewriting the API or interface.
- Compute candidate neighbors using the original feature vectors or embeddings. At this scale, direct comparison is sufficient; a vector database is unnecessary.
- A similarity score is a model-dependent comparison, not a probability that two songs objectively sound alike. Do not display an invented “98% match.”

### Layout

- Similarity-map coordinates are a visual projection, with approximate local relationships. Its axes have no inherent energy, genre, or distortion meaning.
- A separate metric view can plot values such as tempo and brightness on labeled axes. Only label axes with values actually used to generate them.
- Compute connections from the original representation, not from distances in the two-dimensional projection.
- Color or size can encode documented metrics; provide a legend and usable alternatives to color alone.
- Generated clusters are exploratory and may not correspond to named genres. Distinguish user-named groups from automatically suggested clusters.
- Use fixed seeds where supported and persist generated coordinates. Do not recompute the map on every render or filter change.
- Preserve manual overrides. Make major regeneration explicit and reversible; keep a previous layout version available.
- Handle small collections without invalid projection parameters or crashes. Show unprocessed tracks in an explicit pending area or list.

### Audio access

Catalog search metadata and accessible audio are separate capabilities. Do not assume a streaming search API supplies audio, permits extraction, or allows model training.

Start with lawfully obtained user-provided local audio and fixtures with documented permissions. Buying a file, privately analyzing it, distributing audio, and training a shared model are distinct questions. Do not state that every private analysis requires explicit artist permission or that every purchased file permits arbitrary reuse. Before adding a provider, verify current API access and applicable terms for the intended use. Never work around access restrictions or silently scrape streams.

## Phased implementation

### Phase 0 — foundation and a playable sample

- Inspect the repository, scaffold missing pieces, establish design tokens, and define track/rating/session contracts.
- Create a small synthetic metadata fixture reflecting hyperpop, house, and EDM, plus a permitted playable sample. Keep fixture metadata distinct from measured data.
- Record the supported local import formats, source assumptions, and startup commands.

Acceptance: a fresh checkout opens the retro app shell and can play a permitted sample through a user-triggered action.

### Phase 1 — import, library, and playback

- Add local import, metadata extraction, database migrations, and persistent library search/filtering.
- Implement the persistent player, seeking, volume, previous/next, editable queue, and visible current-track state.
- Handle duplicate files, unsupported formats, missing audio, and playback failures. Do not wait for analysis to allow listening.

Acceptance: import real supported files, listen, seek, change views without interruption, and reopen the library with metadata and queue preserved.

### Phase 2 — mood and enjoyment ratings

- Add separate enjoyment and mood-fit controls to the track inspector and player context.
- Support starter/custom moods, multiple mood associations, optional notes, corrections, and rating history.
- Add genre tags and named groups without requiring audio analysis.

Acceptance: one song can be rated 5/5 for restless and 4/5 for euphoric while having a distinct enjoyment score; values survive reopening and unknown ratings stay unknown.

### Phase 3 — personal mood visualization

- Build the stable mood-anchor layout, genre and mood filters, pan/zoom, track inspector, legends, and text alternative.
- Connect selection and playback to map highlighting. Support intentional connections, manual positions, and named groups.
- Persist layouts and overrides with revisions; add versioned map export/import, including ratings and missing-file handling.

Acceptance: ratings visibly shape the map, multiple moods remain inspectable, unrated tracks remain available, filters preserve context, and edits/export-import round-trip correctly.

### Phase 4 — TastePlay baseline

- Implement the documented mood/enjoyment scoring baseline, duration target, variety rules, and sparse-rating behavior.
- Add session preview/editing, playback, a path on the existing map, and explicit mood-fit feedback.
- Save generated sessions, scoring reasons, generation version, and user edits.

Acceptance: choose a mood, inspect why tracks were selected, edit the playlist, and listen through it while following its map path. Missing analysis must not block this flow.

### Phase 5 — measured sound view and release polish

- Add persisted analysis jobs and a worker for measured audio features; cache by source hash and pipeline version.
- Add a measured-feature sound layout and an explicit metric view, with provenance and honest axis labels. Keep the mood view available independently.
- If useful in listening trials, introduce available feature-based transitions as a versioned TastePlay option and compare them with the baseline.
- Check the full import → playback → ratings → map → TastePlay → reopen experience with about 50–100 tracks, including partial failures and sparse ratings.
- Check responsive behavior, keyboard access, reduced motion, and labels. Document setup, formats, limitations, and remaining work.

Acceptance: all MVP behaviors above work with real local files; playback and personal ratings remain usable during failed/pending analysis; the app is understandable and runnable from a fresh checkout.

## Later roadmap — ML, comparison, and discovery

Implement only when requested after the playback, mood map, and TastePlay MVP has been evaluated.

1. Evaluate pretrained audio embeddings against measured-feature similarity and add an optional sound map if the results are useful. Support multiple mood selections and start/end mood journeys in TastePlay as separate product experiments.
2. Make the first custom ML experiment a small mood-fit classifier over frozen embeddings using explicit labels. Keep predictions distinct from user ratings and require confirmation before writing personal labels.
3. Evaluate on held-out songs; keep all excerpts/versions of a recording together to avoid leakage. Compare with simple label-frequency or nearest-neighbor baselines. Document class imbalance, uncertain predictions, and sample-size limitations.
4. Add a learned TastePlay ranking experiment only after sufficient contextual feedback exists. Compare it with the saved rules-based baseline using held-out judgments.
5. Add deliberate map sharing and comparison. Compare track overlap, sonic characteristics, enjoyment, and shared-track mood associations separately. Match canonical recordings rather than file hashes alone. Different map projections have arbitrary orientation; do not compare raw coordinates as taste similarity or invent a universal compatibility percentage.
6. Add accounts when needed for persistent multi-user sharing. Keep collections private by default; sharing a map does not imply uploading audio or consenting to training.
7. Explore focused discovery from overlapping curated neighborhoods when catalog coverage and permitted data access support it. Show suggestions separately from saved maps until accepted and explain their source.

Automatically generated maps alone do not supply independent human labels. Do not treat layout proximity, decorative dragging, or passive exposure as confirmed preference. Account for popularity and repeated suggestions when interpreting feedback. Use shared data for training only under the product's explicit consent rules, with documented deletion behavior.

## Engineering and completion standards

- Keep playback, personal ratings, TastePlay scoring, audio extraction, similarity scoring, map layout, persistence, and rendering as separate modules with explicit contracts.
- Use typed API schemas and validated import/export formats. Keep secrets and user audio out of Git and logs.
- Version analysis and layout artifacts so results can be traced and selectively recomputed.
- Handle loading, empty, partial, unavailable-model, and failure states. Keep playback, mood mapping, and the rules-based TastePlay baseline independent of encoder setup; label active analysis methods.
- Add meaningful checks for data round-trips, preserved edits, job state transitions/recovery, invalid inputs, and deterministic cached results. Avoid tests that merely mirror implementation details.
- Validate the actual import → playback → mood/enjoyment ratings → map → TastePlay → edit → reopen flow using permitted sample audio. Also exercise pending/failed analysis. Run relevant checks for the changed area and report what was checked.
- Document decisions and unresolved limitations. Do not invent model accuracy, similarity confidence, licensing permissions, or completed integrations.
- At handoff, state what works, how to run it, what was validated, and what remains. Update phase progress honestly.

## Reference starting points

Check current official documentation when implementing; these links do not lock dependency versions or guarantee a provider's availability.

- FastAPI: https://fastapi.tiangolo.com/
- Librosa features: https://librosa.org/doc/latest/feature.html
- CLAP audio representations and music checkpoints: https://github.com/LAION-AI/CLAP
- UMAP visualization: https://umap-learn.readthedocs.io/en/latest/basic_usage.html
