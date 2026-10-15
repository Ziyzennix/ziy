#!/usr/bin/env python3
"""Generate the Ziy Playlist test fixtures with gstreamer.

The playlist test suite classifies and (in the boot proof) decodes real
files, so the fixtures must be real files: tiny, but with a genuine container
and a genuine elementary stream, generated on this machine rather than
downloaded from a host that could disappear.

What it writes into extensions/ziy-playlist/test/fixtures/:

  tiny.mp4    H.264 in MP4, 10 frames at 30fps (0.33s), 320x240
  tiny.webm   VP8 in WebM, the same shape
  tone.mp3    MPEG-1 Layer III, ~0.5s mono
  tone.ogg    Vorbis in Ogg, ~1s mono
  tone.wav    PCM WAV, ~1s mono

Deterministic by construction: fixed frame counts and a fixed test pattern,
so re-running produces the same byte count. A missing gstreamer is a hard
error here, because a fixture-less suite would silently test nothing.

Usage:
  python3 tools/make-fixtures.py [--out DIR]

This is a TEST tool. It never runs in the shipped extension: the packer's
EXCLUDED_DIRS prunes test/, and tools/ is not referenced by manifest.json.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE.parent / "test" / "fixtures"

GST = "gst-launch-1.0"

# (filename, pipeline). Each is a full `gst-launch-1.0` command after the
# binary and before `! filesink`.
PIPELINES = [
    (
        "tiny.mp4",
        [
            "videotestsrc", "num-buffers=10", "!", "videoconvert", "!",
            "x264enc", "!", "mp4mux",
        ],
    ),
    (
        "tiny.webm",
        [
            "videotestsrc", "num-buffers=10", "!", "videoconvert", "!",
            "vp8enc", "!", "webmmux",
        ],
    ),
    (
        "tone.mp3",
        [
            "audiotestsrc", "num-buffers=20", "samplesperbuffer=1000", "!",
            "audioconvert", "!", "audioresample", "!",
            "audio/x-raw,format=S16LE,rate=44100,channels=1", "!",
            "lamemp3enc",
        ],
    ),
    (
        "tone.ogg",
        [
            "audiotestsrc", "num-buffers=44", "samplesperbuffer=1000", "!",
            "audioconvert", "!", "vorbisenc", "!", "oggmux",
        ],
    ),
    (
        "tone.wav",
        [
            "audiotestsrc", "num-buffers=44", "samplesperbuffer=1000", "!",
            "audioconvert", "!", "wavenc",
        ],
    ),
]


def build(out: Path) -> int:
    if shutil.which(GST) is None:
        print(f"fail: {GST} is not installed — the fixtures cannot be generated",
              file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)
    for name, pipeline in PIPELINES:
        target = out / name
        cmd = [GST, "-q", *pipeline, "!", "filesink", f"location={target}"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        # gstreamer's plugin scanner is noisy on this box about video
        # allocators; the pipeline either produced the file or it did not.
        if result.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
            print(f"fail: {name} was not produced", file=sys.stderr)
            for line in (result.stderr or "").splitlines():
                if "CRITICAL" in line or "ERROR" in line:
                    print("       " + line, file=sys.stderr)
            return 1
        print(f"  {name:<12} {target.stat().st_size:>8} bytes")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(DEFAULT_OUT),
                        help="output directory (default: test/fixtures)")
    args = parser.parse_args()
    return build(Path(args.out))


if __name__ == "__main__":
    sys.exit(main())
