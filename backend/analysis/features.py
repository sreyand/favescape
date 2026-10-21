"""Small, inspectable baseline for local audio analysis.

RMS is linear waveform amplitude, spectral centroid is in Hz, and tempo is
estimated in BPM using positive spectral flux and autocorrelation. Tempo has
half/double-time ambiguity. None of these measurements is an emotion label.
"""

import math

import numpy as np
import soundfile as sf
from scipy import signal

TARGET_SR = 22050


def _segments(path):
    with sf.SoundFile(path) as audio:
        if audio.frames <= 0 or audio.samplerate <= 0:
            raise ValueError("Audio contains no samples.")
        duration = audio.frames / audio.samplerate
        # Analyze the full short clip, or three representative 15-second windows.
        windows = [(0, duration)] if duration <= 45 else [(max(0, duration * center - 7.5), 15) for center in (0.15, 0.50, 0.85)]
        for start, length in windows:
            audio.seek(int(start * audio.samplerate))
            wave = audio.read(int(length * audio.samplerate), dtype="float32", always_2d=True).mean(axis=1)
            if audio.samplerate != TARGET_SR:
                divisor = math.gcd(audio.samplerate, TARGET_SR)
                wave = signal.resample_poly(wave, TARGET_SR // divisor, audio.samplerate // divisor)
            if len(wave) >= 2048:
                yield np.nan_to_num(wave)


def extract(path):
    power, centroids, envelopes = [], [], []
    for wave in _segments(path):
        power.append(float(np.mean(np.square(wave, dtype=np.float64))))
        frequencies, _, transform = signal.stft(wave, fs=TARGET_SR, nperseg=2048, noverlap=1536, boundary=None)
        magnitude = np.abs(transform)
        energy = magnitude.sum(axis=0)
        audible = energy > 1e-7
        if np.any(audible):
            centroids.append(float(np.mean((frequencies[:, None] * magnitude[:, audible]).sum(axis=0) / energy[audible])))
        difference = np.diff(magnitude, axis=1)
        envelope = np.maximum(difference, 0).sum(axis=0)
        envelopes.append(envelope)
    if not power:
        raise ValueError("Audio is too short to analyze (at least 0.1 seconds is needed).")
    rms = float(math.sqrt(np.mean(power)))
    brightness = float(np.mean(centroids)) if centroids else None
    tempos = []
    rate = TARGET_SR / 512
    for envelope in envelopes:
        if len(envelope) < rate * 3 or float(np.max(envelope)) < 1e-7:
            continue
        envelope = envelope - np.mean(envelope)
        correlation = signal.fftconvolve(envelope, envelope[::-1], mode="full")[len(envelope) - 1:]
        low, high = max(1, int(rate * 60 / 200)), min(len(correlation) - 1, int(rate * 60 / 60))
        if high <= low:
            continue
        lags = np.arange(low, high + 1)
        # Normalize the number of overlapping frames and gently favor ~120 BPM.
        normalized = correlation[lags] / np.maximum(1, len(envelope) - lags)
        bpm = 60 * rate / lags
        prior = np.exp(-0.5 * (np.log2(bpm / 120) / 0.9) ** 2)
        lag = lags[int(np.argmax(normalized * prior))]
        if correlation[lag] > 0:
            tempos.append(60 * rate / lag)
    tempo = round(float(np.median(tempos)), 1) if tempos else None
    return {"tempo": tempo, "brightness": round(brightness, 2) if brightness is not None else None, "rms": round(rms, 6)}
