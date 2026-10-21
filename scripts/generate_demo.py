"""Synthesize Favescape's original demo audio using only Python's standard library.

No downloads, sampled recordings, or third-party music are used. The short,
original instrumental loops are a playback/analysis fixture, not commercial songs.
Run from anywhere: python scripts/generate_demo.py [--force]
"""

from __future__ import annotations

import argparse
from array import array
import json
import math
from pathlib import Path
import random
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 22050
TAU = 2 * math.pi
TABLE_SIZE = 4096
SINE = tuple(math.sin(TAU * i / TABLE_SIZE) for i in range(TABLE_SIZE))

# Original note/rhythm recipes. MIDI roots, mode, BPM, texture, and melodic
# offsets deliberately vary so the audio analysis can measure real differences.
RECIPES = {
    "demo-sugar-rush": (156, 60, "major", "bright", [12, 16, 19, 16, 14, 19, 21, 19]),
    "demo-afterglow": (124, 57, "minor", "warm", [12, 15, 19, 22, 19, 15, 10, 12]),
    "demo-orbit": (132, 62, "major", "bell", [12, 19, 16, 24, 21, 19, 16, 14]),
    "demo-blue-hour": (116, 55, "minor", "soft", [12, 15, 19, 17, 15, 10, 7, 10]),
    "demo-static-kiss": (168, 59, "minor", "bright", [12, 19, 15, 24, 22, 19, 15, 17]),
    "demo-sideways": (118, 53, "major", "warm", [12, 16, 19, 21, 16, 14, 12, 7]),
    "demo-neon-heart": (148, 60, "major", "bell", [12, 16, 19, 24, 21, 19, 14, 16]),
    "demo-night-swim": (108, 57, "minor", "soft", [19, 15, 12, 10, 12, 15, 17, 15]),
    "demo-soft-focus": (102, 62, "minor", "soft", [12, 15, 17, 19, 17, 15, 10, 12]),
    "demo-overdrive": (160, 52, "minor", "bright", [12, 12, 19, 15, 17, 19, 22, 19]),
    "demo-moonmilk": (98, 53, "major", "warm", [12, 16, 19, 14, 12, 9, 7, 9]),
    "demo-paper-stars": (138, 65, "major", "bell", [12, 19, 16, 21, 24, 19, 14, 16]),
}


def hz(midi: float) -> float:
    return 440 * 2 ** ((midi - 69) / 12)


def oscillate(phase: float) -> float:
    return SINE[int(phase) % TABLE_SIZE]


def note(buffer: array, start: float, duration: float, midi: int, gain: float,
         texture: str = "soft", attack: float = 0.008, release: float = 0.12) -> None:
    begin = int(start * SAMPLE_RATE)
    count = min(int(duration * SAMPLE_RATE), len(buffer) - begin)
    if count <= 0:
        return
    frequency = hz(midi)
    phase_step = frequency * TABLE_SIZE / SAMPLE_RATE
    attack_frames = max(1, int(attack * SAMPLE_RATE))
    release_frames = max(1, int(release * SAMPLE_RATE))
    for j in range(count):
        phase = j * phase_step
        base = oscillate(phase)
        if texture == "bright":
            tone = base * 0.63 + oscillate(phase * 2) * 0.22 + oscillate(phase * 3) * 0.1 + oscillate(phase * 5) * 0.05
        elif texture == "bell":
            tone = base * 0.68 + oscillate(phase * 2.006) * 0.22 + oscillate(phase * 3.01) * 0.1
        elif texture == "warm":
            tone = base * 0.8 + oscillate(phase * 2) * 0.14 + oscillate(phase * 3) * 0.06
        else:
            tone = base * 0.94 + oscillate(phase * 2) * 0.06
        envelope = min(1.0, j / attack_frames, (count - j) / release_frames)
        if texture == "bell":
            envelope *= math.exp(-2.3 * j / count)
        buffer[begin + j] += tone * gain * envelope


def kick(buffer: array, start: float, gain: float) -> None:
    begin = int(start * SAMPLE_RATE)
    count = min(int(0.28 * SAMPLE_RATE), len(buffer) - begin)
    phase = 0.0
    for j in range(count):
        t = j / SAMPLE_RATE
        frequency = 47 + 90 * math.exp(-t * 34)
        phase += frequency * TABLE_SIZE / SAMPLE_RATE
        envelope = math.exp(-t * 17) * min(1.0, t * 1600)
        buffer[begin + j] += oscillate(phase) * envelope * gain


def noise_hit(buffer: array, start: float, gain: float, rng: random.Random,
              duration: float = 0.07, clap: bool = False) -> None:
    begin = int(start * SAMPLE_RATE)
    count = min(int(duration * SAMPLE_RATE), len(buffer) - begin)
    previous = 0.0
    for j in range(count):
        t = j / SAMPLE_RATE
        sample = rng.uniform(-1, 1)
        high_pass = (sample - previous) * 0.5
        previous = sample
        envelope = math.exp(-t * (29 if clap else 65))
        if clap:
            envelope *= 0.65 + 0.35 * math.cos(TAU * 75 * t)
        buffer[begin + j] += high_pass * envelope * gain


def make_loop(track_id: str) -> array:
    bpm, root, mode, texture, melody = RECIPES[track_id]
    beat = 60 / bpm
    loop_seconds = beat * 16
    loop = array("f", [0.0]) * int(loop_seconds * SAMPLE_RATE)
    rng = random.Random(track_id)
    third = 4 if mode == "major" else 3
    progression = [0, -5, -3 if mode == "minor" else -3, -7]
    bright = texture == "bright"

    for bar in range(4):
        chord_root = root + progression[bar]
        # A quiet pad with a slow attack sits behind the rhythm.
        for interval in (0, third, 7, 14):
            note(loop, bar * beat * 4, beat * 3.95, chord_root + interval,
                 0.035 if texture == "soft" else 0.027, "soft", attack=0.15, release=0.35)
        for position in range(4):
            when = (bar * 4 + position) * beat
            kick(loop, when, 0.25 if texture == "soft" else 0.34)
            note(loop, when + beat * 0.15, beat * 0.65, chord_root - 12,
                 0.12 if texture == "soft" else 0.17, "warm", release=0.08)
            if position in (1, 3):
                noise_hit(loop, when, 0.13, rng, duration=0.14, clap=True)
            noise_hit(loop, when + beat * 0.5, 0.07 if texture == "soft" else 0.12, rng)
            if bright:
                noise_hit(loop, when + beat * 0.75, 0.04, rng, duration=0.035)
        # Original arpeggiated melody, with a little space in the softer recipes.
        for step in range(8):
            if texture == "soft" and step in (3, 7):
                continue
            when = (bar * 4 + step * 0.5) * beat + (0.015 if step % 2 else 0)
            pitch = root + melody[(step + bar * 2) % len(melody)]
            note(loop, when, beat * (0.7 if bright else 0.9), pitch,
                 0.09 if texture == "soft" else 0.105, texture)
            # Quiet delayed repeat; wrapping at the loop boundary keeps the seam clean.
            delay = when + beat * 0.75
            if delay < loop_seconds:
                note(loop, delay, beat * 0.55, pitch, 0.025, "soft")

    # Pads and percussion are normalized together, keeping a healthy headroom.
    peak = max(abs(v) for v in loop) or 1.0
    normalization = 0.77 / peak
    for j in range(len(loop)):
        loop[j] *= normalization
    return loop


def write_track(path: Path, track_id: str, duration: float) -> None:
    loop = make_loop(track_id)
    total = round(duration * SAMPLE_RATE)
    fade_in = int(0.04 * SAMPLE_RATE)
    fade_out = int(0.65 * SAMPLE_RATE)
    # Generate in chunks rather than retaining all twelve tracks in memory.
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(SAMPLE_RATE)
        for offset in range(0, total, SAMPLE_RATE):
            samples = array("h")
            for index in range(offset, min(offset + SAMPLE_RATE, total)):
                envelope = min(1.0, index / max(1, fade_in), (total - index) / max(1, fade_out))
                value = loop[index % len(loop)] * envelope
                samples.append(int(max(-0.98, min(0.98, value)) * 32767))
            if sys.byteorder != "little":
                samples.byteswap()
            audio.writeframes(samples.tobytes())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Regenerate existing demo files")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "fixtures" / "demo-catalog.json").read_text(encoding="utf-8"))
    destination = ROOT / ".data" / "demo-audio"
    destination.mkdir(parents=True, exist_ok=True)
    for track in catalog["tracks"]:
        path = destination / f"{track['id']}.wav"
        if path.exists() and not args.force:
            print(f"Exists: {path.name}")
            continue
        write_track(path, track["id"], track["duration"])
        print(f"Created: {path.name} ({track['duration']}s)", flush=True)
    print("Demo audio ready. Original procedural instrumentals; no commercial recordings.")


if __name__ == "__main__":
    main()
