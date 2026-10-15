#!/usr/bin/env python3
"""Rasterise the shell's fallback mark at the sizes the app dir needs.

brand/ is owned by the design worker. Until it lands, Ziy boots with the
geometric shield/lion mark in shell/brand-fallback/logo.svg; when brand/logo.svg
appears, this script takes it instead so the same command produces the final
sizes. Rasterisation uses only what is guaranteed on this box: cairosvg when
present, otherwise a Pillow fallback that draws an equivalent mark directly.

The co-owner's decision (2026-10-15) is that their master PNG IS the icon, so
when brand/ziy.png exists it is copied unchanged into every size slot — no
rasterise, no resample, no recode. Every consumer of a size slot then reads
identical bytes.

    python3 shell/brand-fallback/render-icons.py <outdir>
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

SIZES = (16, 22, 24, 32, 48, 64, 96, 128, 256)

FALLBACK_SVG = Path(__file__).with_name("logo.svg")
BRAND_SVG = Path(__file__).resolve().parent.parent.parent / "brand" / "logo.svg"
BRAND_PNG = Path(__file__).resolve().parent.parent.parent / "brand" / "ziy.png"


def passthrough_brand_png(png: Path, outdir: Path) -> list[Path]:
    """Copy the master PNG to every size slot, byte for byte."""
    written = []
    for size in SIZES:
        out = outdir / f"logo-{size}.png"
        shutil.copyfile(png, out)
        written.append(out)
    for name in ("logo.png", "ziy.png"):
        out = outdir / name
        shutil.copyfile(png, out)
        written.append(out)
    return written


def source_svg() -> Path:
    if BRAND_SVG.exists():
        return BRAND_SVG
    return FALLBACK_SVG


def render_with_cairosvg(svg: Path, outdir: Path) -> list[Path]:
    import cairosvg  # type: ignore

    written = []
    stem = "logo"
    for size in SIZES:
        out = outdir / f"{stem}-{size}.png"
        cairosvg.svg2png(
            url=str(svg), write_to=str(out), output_width=size, output_height=size
        )
        written.append(out)
    out = outdir / "logo.png"
    cairosvg.svg2png(url=str(svg), write_to=str(out), output_width=256, output_height=256)
    written.append(out)
    return written


def render_with_pillow(outdir: Path) -> list[Path]:
    """Draw the same mark with Pillow primitives — no SVG dependency."""
    from PIL import Image, ImageDraw

    bg = (12, 6, 48, 255)        # #0E0630
    edge = (76, 46, 255, 255)    # #4C2EFF
    deep = (38, 17, 143, 255)    # #26118F
    mane = (255, 107, 53, 255)   # #FF6B35
    light = (108, 85, 255, 255)  # #6C55FF

    written = []
    for size in SIZES + (256,):
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)

        def xy(n: float) -> float:
            # The SVG is authored on a 96x96 grid.
            return n * size / 96.0

        # Shield: a polygon approximating the rounded SVG path.
        shield = [
            (xy(48), xy(4)), (xy(88), xy(18)), (xy(88), xy(48)),
            (xy(88), xy(60)), (xy(78), xy(72)), (xy(62), xy(81)),
            (xy(48), xy(92)), (xy(34), xy(81)), (xy(18), xy(72)),
            (xy(8), xy(60)), (xy(8), xy(48)), (xy(8), xy(18)),
        ]
        d.polygon(shield, fill=deep, outline=bg)
        inner = [
            (xy(48), xy(12)), (xy(80), xy(23)), (xy(80), xy(48)),
            (xy(80), xy(62)), (xy(70), xy(73)), (xy(55), xy(80)),
            (xy(48), xy(84)), (xy(41), xy(80)), (xy(26), xy(73)),
            (xy(16), xy(62)), (xy(16), xy(48)), (xy(16), xy(23)),
        ]
        d.polygon(inner, outline=light)

        # Lion head.
        r = xy(15)
        cx, cy = xy(46), xy(50)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=mane)
        d.polygon([(xy(46), xy(30)), (xy(34), xy(20)), (xy(44), xy(34))], fill=mane)
        d.polygon([(xy(60), xy(42)), (xy(74), xy(34)), (xy(62), xy(50))], fill=mane)
        d.polygon([(xy(32), xy(44)), (xy(20), xy(38)), (xy(30), xy(52))], fill=mane)

        # Face.
        if size >= 24:
            er = max(1, xy(2.4))
            for ex in (xy(41), xy(51)):
                d.ellipse([ex - er, cy - er, ex + er, cy + er], fill=bg)
            d.polygon(
                [(xy(43), xy(56)), (xy(46), xy(59)), (xy(49), xy(56))], fill=bg
            )

        name = "logo.png" if size == 256 else f"logo-{size}.png"
        out = outdir / name
        img.save(out)
        written.append(out)
    return written


def main() -> int:
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    outdir.mkdir(parents=True, exist_ok=True)
    if BRAND_PNG.exists():
        # The master PNG is the icon: identical bytes in every slot.
        written = passthrough_brand_png(BRAND_PNG, outdir)
        how = f"passthrough: {BRAND_PNG.name}"
    else:
        try:
            written = render_with_cairosvg(source_svg(), outdir)
            how = "cairosvg"
        except ImportError:
            written = render_with_pillow(outdir)
            how = "pillow-fallback"
    # The .desktop entry and the XDG icon theme want a plain "ziy.png" too, at
    # the largest size either backend produced.
    copied = list(written)
    biggest = max(written, key=lambda p: p.stat().st_size)
    if biggest.name != "ziy.png":
        dst = outdir / "ziy.png"
        shutil.copyfile(biggest, dst)
        copied.append(dst)
    # Both backends can produce the same path twice (256 == the "logo.png"
    # render); keep the first occurrence only.
    seen = set()
    copied = [p for p in copied if not (p in seen or seen.add(p))]
    print(f"render-icons.py: wrote {len(copied)} files with {how}:")
    for p in copied:
        print(f"  {p} ({p.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
