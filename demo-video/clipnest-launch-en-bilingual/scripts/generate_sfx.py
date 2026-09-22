from pathlib import Path
import wave

import numpy as np


SR = 48_000
ROOT = Path(__file__).resolve().parents[1]


def write(name: str, mono: np.ndarray, pan: float = 0.0) -> None:
    left = mono * np.sqrt((1 - pan) / 2)
    right = mono * np.sqrt((1 + pan) / 2)
    stereo = np.column_stack([left, right])
    peak = np.max(np.abs(stereo))
    stereo = stereo / max(peak, 1e-9) * 0.72
    pcm = np.int16(np.clip(stereo, -1, 1) * 32767)
    with wave.open(str(ROOT / name), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(SR)
        out.writeframes(pcm.tobytes())


def main() -> None:
    t = np.arange(int(1.2 * SR)) / SR
    chime = (
        np.sin(2 * np.pi * 880 * t)
        + 0.55 * np.sin(2 * np.pi * 1763 * t)
        + 0.22 * np.sin(2 * np.pi * 2637 * t)
    ) * np.exp(-4.2 * t)
    write("sfx-chime.wav", chime, 0.15)

    rng = np.random.default_rng(9378)
    t = np.arange(int(0.75 * SR)) / SR
    noise = rng.normal(0, 1, len(t))
    smooth = np.convolve(noise, np.ones(65) / 65, mode="same")
    whoosh = smooth * np.sin(np.pi * np.clip(t / 0.75, 0, 1)) ** 2
    write("sfx-whoosh.wav", whoosh, -0.25)

    t = np.arange(int(0.18 * SR)) / SR
    click = (np.sin(2 * np.pi * 1240 * t) + 0.35 * np.sin(2 * np.pi * 2480 * t)) * np.exp(-42 * t)
    write("sfx-click.wav", click, 0.3)


if __name__ == "__main__":
    main()

