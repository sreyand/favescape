# Original demo assets

The twelve demo songs and artists are fictional. Titles, artist names, album names,
genres, enjoyment scores, and mood associations are illustrative interface data.
They do not describe recordings by commercial artists.

`scripts/generate_demo.py` produces original procedural instrumental loops using
Python's standard library. It synthesizes pads, arpeggios, bass, kicks, claps, and
hi-hats; it does not download, sample, or imitate a named recording. These short
loops make playback, playlist generation, and real feature extraction available
without bundling other people's music.

Run from the repository root:

```powershell
python scripts/generate_demo.py
```

The script writes mono 16-bit, 22,050 Hz WAV files to the ignored
`.data/demo-audio/` directory. Files are 40–64 seconds long. Existing files are
preserved unless `--force` is supplied. The complete demo library is 10 minutes
16 seconds; individual mood-specific playlists are shorter and should report
insufficient coverage honestly when the requested length exceeds the candidates.

Artwork is original SVG geometry in `apps/web/public/artwork/`. The covers use
Favescape's cream, cobalt, tomato, butter yellow, and sage colors. They contain no
real album art, brand marks, or photography. The audio and artwork are generated
expressly as assets for this project; no third-party attribution is required for
their underlying samples or geometry because none are used.

The backend must label these tracks as demo content. It can compute actual audio
features from their WAV files; those measured features are distinct from the
catalog's illustrative human mood and enjoyment ratings.
