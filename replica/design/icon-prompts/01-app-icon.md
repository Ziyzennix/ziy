# 01 — App icon master (A1) — the co-owner's cat

**id:** A1
**Place at:** `brand/ziy.png` (the master PNG itself) · `brand/logo.svg`
**Rasters at:** `brand/logo-{16,22,24,32,48,64,96,128,256}.png` and `brand/ziy.png`

## The decision this file encodes (co-owner, 2026-10-15)

**The cat is the app icon, used as shipped.** The co-owner's raster
`replica/design/app_icon.png` (1103×1104 RGBA, real transparent background) IS
the icon. No trace, no recolour, no resample: `build-shell.sh` §5 prefers
`brand/logo.svg` as `ICON_SOURCE` for `build/ziy/chrome/icons/default/ziy.svg`,
and that file is a one-line passthrough whose whole content is this same PNG
embedded base64 as a single `<image>`, so the SVG slot and the PNG slots are the
same pixels. `shell/brand-fallback/render-icons.py` copies `brand/ziy.png`
unchanged into every size slot.

This supersedes the earlier sealed-eye shield as the app icon. The shield is not
deleted: it keeps its job as the shields-extension toolbar icon and the
browser-chrome mark (files 08, 09, 10 below).

## The prompt — paste this as-is, with the reference PNG attached

> Using the attached cat image as the subject reference, generate a single centered
> flat illustration of that same cat: keep its exact character, head-on pose, upright
> triangular ears, low-poly geometric facet language, amber eyes and white chin bib,
> and keep the cat's natural ginger/orange palette exactly as the reference has it —
> do not recolour. Keep the facets flat and geometric — sharp polygon edges, no soft
> shading, no gradients, no drop shadow, no outer glow, no outline halo, no tile, no
> rounded-square background, no text or letters. Transparent background: nothing
> around the cat, no floor, no shadow on the ground. The cat fills about 86% of the
> frame with 7% pad. One icon only — not a grid of options, not a mockup, no
> surrounding UI.

Two clauses do the work, and both must stay:

1. **"keep the cat's natural ginger/orange palette exactly as the reference has it
   — do not recolour"** — the hard constraint. An earlier version of this prompt
   forced the teal recolor; that instruction is deleted, along with the two
   drift-correction lines that used to push the result back toward teal
   ("the teals are all cyan-leaning…" and "zero warm colours: no orange, no
   amber, no yellow, no red anywhere in the image"). If the model drifts toward
   teal or greys the cat, add: *"the palette is the reference cat's own warm
   family: orange and amber facets, brown tabby stripes, cream bib, white eye
   whites; nothing cool, nothing desaturated."*
2. **"keep its exact character, head-on pose, upright triangular ears, low-poly
   geometric facet language, amber eyes and white chin bib"** — what makes it
   *this* cat rather than a generic one.

The flat-facet / no-shadow / no-tile / no-gradient / no-text constraints are
unchanged and still apply.

## What "placed" means for this icon

Because the master is the co-owner's raster, placement is a byte copy, not a
re-derivation:

```
cp replica/design/app_icon.png brand/ziy.png
for s in 16 22 24 32 48 64 96 128 256; do cp replica/design/app_icon.png brand/logo-$s.png; done
./tools/build-shell.sh --force        # installs the cat into build/ziy
./tools/install-desktop.sh --dry-run  # would install the cat at all 9 hicolor sizes
```

`brand/logo.svg` stays in place as the passthrough SVG the build reads as
`ICON_SOURCE` — its entire content is the PNG embedded base64 as a single
`<image>`, no geometry of its own.

**Accessibility:** `role="img"`, a `<title>` and an `aria-label`, no competitor
name anywhere:

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 1103 1104" width="1103" height="1104" role="img"
     aria-label="Ziy the cat: a friendly head-on ginger cat face with amber eyes and a white chin bib">
  <title>Ziy the cat — the co-owner's own cat, the app icon</title>
  <image x="0" y="0" width="1103" height="1104" xlink:href="data:image/png;base64,…"/>
</svg>
```

## Legibility by size

The master is 1103×1104, above every hicolor slot, so every slot is the same
image resampled — one asset, no per-size redraw. Measured from the master:

| size | opaque coverage | corner alpha | warm-family pixels |
| --- | --- | --- | --- |
| 16px | 43.0% | all four `0` | 98.2% |
| 24px | 42.4% | all four `0` | 93.0% |
| 32px | 42.9% | all four `0` | 92.7% |
| 48px | 42.8% | all four `0` | 91.5% |
| 96px | 42.8% | all four `0` | 91.0% |
| 256px | 42.8% | all four `0` | 90.6% |

At 16px the readable elements are the ones that survive: the silhouette with
both upright ears, the two amber eyes, and the white chin bib. Fine tabby detail
softens, which is why the traced `mascot-simple` variant exists for vector
surfaces that need small-size simplification.

## Why the cat, and not the shield

The app icon is the mark the launcher, taskbar, window, About and store listing
carry — and it is the co-owner's own cat, in their own colours. The shield
keeps the surfaces where *function* has to be legible at 16px without emotion:
the shields-extension toolbar icons and the browser-chrome mark. That split is
written down in `brand/MASCOT.md` under "Palette policy (co-owner decision
2026-10-15)".

## Checklist

- [ ] reference PNG attached · [ ] cat's natural palette preserved (no recolor)
  · [ ] placed as `brand/ziy.png` (byte copy) · [ ] `brand/logo.svg` is the
  base64 passthrough · [ ] rasters at every size slot are identical bytes
  · [ ] `install-desktop.sh --dry-run` shows all 9 sizes
