# 02 — Mascot master (A3) — your cat, in its own natural palette  ← CURRENT ASSET TO UPGRADE

**id:** A3 (personality asset, not in `icon.md`'s §2 inventory — added because the mascot is now the co-owner's cat)
**Place at:** `brand/mascot.svg`
**Rasters at:** `brand/mascot-{48,96,128,256,512}.png` and `brand/mascot-simple.svg` + `brand/mascot-simple-{48,96,128,256,512}.png`
**Status:** this is the asset that already exists as `replica/design/app_icon.png`. **Upgrade it.**

> **This is the file to send first if you want to start with your cat.**
> The shipped mascot is the traced rebuild of your cat — 281 facets with the
> geometry from your art and the palette from your art too (the teal-recolour
> version was wrong and was replaced on 2026-10-15). This prompt upgrades it
> from your art directly, so the next version comes from you rather than from a
> re-trace.

## What you are turning in

Your cat at `replica/design/app_icon.png` (1103×1104, RGBA, transparent
background — the corners sample `rgba(0,0,0,0)`, and 56.1% of the alpha channel is
fully transparent). Give it to the image model as the subject reference along with
the prompt below.

## The prompt — paste this as-is, with your PNG attached

> Using the attached cat image as the subject reference, generate a single centered flat vector illustration of that same cat: keep its exact character, head-on pose, upright triangular ears, low-poly geometric facet language, amber eyes and white chin bib. Keep the cat's natural ginger/orange palette exactly as the reference has it — do not recolour: orange facets in `#e58125`, `#cb4814`, `#cb5918`, `#df5522`, `#df6223` and `#f5a242`; tabby and shadow browns `#ae3817`, `#8f1e14`, `#923123` and `#541623`; warm greys `#d5cbb9` and `#d79e6a`; creams `#f5e7c9`, `#f4ca97` and `#f8d7a6`; white `#fefefb` for the eye whites. Keep the facets flat and geometric — sharp polygon edges, no soft shading, no gradients, no drop shadow, no outer glow, no outline halo, no tile, no rounded-square background, no text or letters. Transparent background: nothing around the cat, no floor, no shadow on the ground. The cat fills about 86% of the frame with 7% pad…

## The prompt phrasing that preserves YOUR cat, in YOUR colours

Four phrases do the work. Keep them, in this order:

1. **"Using the attached cat image as the subject reference"** — anchors identity.
   Without this the model invents a cat.
2. **"keep its exact character, head-on pose, upright triangular ears, low-poly
   geometric facet language, amber eyes and white chin bib"** — what makes it
   *your* cat rather than a generic one.
3. **"Keep the cat's natural ginger/orange palette exactly as the reference has it
   — do not recolour"** + the explicit hex list — the hard constraint. List the
   hexes in the prompt; a model told only "ginger" will pick a different orange
   ramp and your cat stops being your cat. **Never** tell it to recolour into the
   Ziy teal family: the palette ban applies to the brand mark (shield, toolbar
   icons, extension glyphs), not to the cat.
4. **"Keep the facets flat and geometric — sharp polygon edges, no soft shading,
   no gradients"** — kills the soft-render look that would otherwise come back.

If the result drifts toward cool greys or teals, add: *"the palette is the
reference cat's own warm family: orange and amber facets, brown tabby stripes,
cream bib, white eye whites; nothing cool, nothing desaturated."*

## The vector stub — how to rebuild it as clean SVG

The model gives you a flat raster. Because it is flat, you can trace it properly:

1. Crop the white (there should be none — the prompt asks for transparent).
2. Quantise the subject to its flat colour regions (Pillow `MEDIANCUT`, 16–24
   colours, on the alpha-masked subject pasted onto white).
3. Take a connected component per colour, trace each component's boundary
   (Moore-Neighbour tracing), simplify with Douglas-Peucker. **Each component is
   one real facet** — all its pixels share a colour, so the trace is the facet,
   not a tone band.
4. Emit each trace as a `<polygon>`; fill it from **the measured source palette**
   by nearest luminance: `#541623` / `#8f1e14` for the darkest and shaded facets,
   `#ae3817` / `#923123` the tabby browns, `#e58125` / `#cb4814` / `#cb5918` /
   `#df5522` / `#df6223` / `#f5a242` the orange facets, `#d5cbb9` / `#d79e6a` the
   warm greys, `#f5e7c9` / `#f4ca97` / `#f8d7a6` / `#fefefb` the cream bib, muzzle
   and eye whites. **Never** map onto a teal ramp — that is what the pre-2026-10-15
   version did, and it is the mistake this file exists to prevent.
5. Keep the tabby stripes and the mouth as `<path>` strokes in `#8f1e14` at
   ~72% opacity, `stroke-width 1.4`, round caps.

A `viewBox` of `0 0 100 100` keeps the numbers small and the file readable.
30–60 facets is the sweet spot; the current shipped master has 281 because it was
auto-traced at high resolution, and it can be reduced by hand.

**Accessibility (clean-room guard applies — no competitor names):**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"
     role="img" aria-label="Ziy the cat: a friendly head-on low-poly geometric cat face in warm ginger facets with a cream chin bib">
  <title>Ziy the cat — flat low-poly mascot</title>
```

**The simplified variant for small sizes** (`brand/mascot-simple.svg`): same
silhouette, same facet boundaries, but collapsed to **three** tones —
`#8f1e14` for the shaded facets, `#e58125` for the head mass, `#fefefb` for the
bib and eye whites. At 96px the facet ramp's mid oranges merge into mush; the
3-tone version still reads as a cat. Rasterise both at 48/96/128/256/512.

## The white-background note

This prompt asks for a **transparent** background, not white — the cat is a
floating personality asset and a white box around it would look like a tile. If
the model gives you a white or coloured background anyway, key it out on the
**alpha** (the cat's facets are separated from each other by real seams, so a
luminance key is safe here), or paste the subject onto a transparent layer using
its own alpha.

## What it must never become

The app icon slot belongs to the co-owner's cat itself — `brand/ziy.png`, their
master PNG used as-is (co-owner decision 2026-10-15) — so this traced vector must
never be installed there: no `brand/logo*`, no `hicolor/*/apps/`, no
`manifest.json` `icons{}` entry. The shields extension keeps its own shield for
the toolbar and browser-chrome surfaces. `brand/MASCOT.md` has the full split.

## Checklist

- [ ] sent with the reference PNG · [ ] placed · [ ] rebuilt as SVG ·
  [ ] palette preserved from the reference (no recolor) · [ ] rasterised at
  48/96/128/256/512 · [ ] simplified variant made and readable at 96px
