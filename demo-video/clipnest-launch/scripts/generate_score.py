from pathlib import Path
import wave

import numpy as np


SR = 48_000
DURATION = 34.0
TAU = np.pi * 2
OUT = Path(__file__).resolve().parents[1] / "underscore-v3.wav"


def env(length: int, attack: float, release: float) -> np.ndarray:
    curve = np.ones(length, dtype=np.float64)
    a = min(length, int(attack * SR))
    r = min(length, int(release * SR))
    if a:
        curve[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if r:
        curve[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return curve


def add_tone(track: np.ndarray, start: float, length: float, freq: float, amp: float, pan: float, kind: str) -> None:
    begin = int(start * SR)
    count = min(int(length * SR), len(track) - begin)
    if count <= 0:
        return
    t = np.arange(count) / SR
    if kind == "pad":
        mono = (
            np.sin(TAU * freq * t)
            + 0.32 * np.sin(TAU * freq * 2.002 * t + 0.2)
            + 0.12 * np.sin(TAU * freq * 3.006 * t + 0.7)
        )
        mono *= env(count, 1.2, 1.8)
    elif kind == "glass":
        mono = (
            np.sin(TAU * freq * t)
            + 0.55 * np.sin(TAU * freq * 2.71 * t)
            + 0.2 * np.sin(TAU * freq * 4.08 * t)
        ) * np.exp(-3.1 * t)
        mono *= env(count, 0.008, 0.3)
    else:
        mono = np.sin(TAU * freq * t) * np.exp(-5.5 * t)
        mono *= env(count, 0.005, 0.15)
    mono *= amp
    left = np.sqrt((1 - pan) / 2)
    right = np.sqrt((1 + pan) / 2)
    track[begin : begin + count, 0] += mono * left
    track[begin : begin + count, 1] += mono * right


def main() -> None:
    track = np.zeros((int(DURATION * SR), 2), dtype=np.float64)
    chords = [
        (0.0, [146.83, 185.00, 220.00, 277.18]),
        (6.0, [123.47, 146.83, 185.00, 220.00]),
        (12.0, [98.00, 123.47, 146.83, 185.00]),
        (18.0, [110.00, 138.59, 164.81, 220.00]),
        (24.0, [123.47, 146.83, 185.00, 246.94]),
        (30.0, [110.00, 138.59, 164.81, 220.00]),
    ]
    for start, notes in chords:
        for index, note in enumerate(notes):
            add_tone(track, start, 7.0, note, 0.055, -0.55 + index * 0.36, "pad")

    pulse = 0.625
    for beat in range(4, 54):
        start = beat * pulse
        root = [73.42, 61.74, 49.00, 55.00, 61.74, 55.00][min(5, int(start // 6))]
        add_tone(track, start, 0.55, root, 0.07 if beat % 4 else 0.11, 0, "pulse")

    melody = [
        (0.35, 587.33), (2.5, 739.99), (4.55, 880.00),
        (6.4, 739.99), (8.0, 659.25), (9.8, 587.33),
        (12.25, 493.88), (13.8, 587.33), (15.3, 739.99),
        (17.0, 659.25), (18.6, 739.99), (20.2, 880.00),
        (22.0, 1174.66),
        (24.8, 880.00), (27.4, 739.99), (29.8, 880.00),
        (32.0, 1174.66),
    ]
    for index, (start, note) in enumerate(melody):
        add_tone(track, start, 1.5, note, 0.12, -0.5 if index % 2 == 0 else 0.5, "glass")

    rng = np.random.default_rng(20260923)
    for beat in range(10, 54):
        start = beat * pulse + pulse / 2
        begin = int(start * SR)
        count = min(int(0.11 * SR), len(track) - begin)
        if count <= 0:
            continue
        noise = rng.normal(0, 1, count)
        noise = np.concatenate([[0], np.diff(noise)])
        noise *= np.exp(-38 * np.arange(count) / SR) * 0.008
        track[begin : begin + count, 0] += noise * 0.85
        track[begin : begin + count, 1] += noise

    fade = np.ones(len(track))
    fade[: int(0.4 * SR)] = np.linspace(0, 1, int(0.4 * SR))
    fade[-int(1.6 * SR) :] = np.linspace(1, 0, int(1.6 * SR))
    track *= fade[:, None]
    peak = np.max(np.abs(track))
    track = track / max(peak, 1e-9) * 0.88
    pcm = np.int16(np.clip(track, -1, 1) * 32767)
    with wave.open(str(OUT), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(SR)
        audio.writeframes(pcm.tobytes())
    print(OUT)


if __name__ == "__main__":
    main()
