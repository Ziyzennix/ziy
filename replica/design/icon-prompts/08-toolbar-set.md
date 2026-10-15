# 08 — Toolbar / window icon set, 16 / 24 / 32 (B1)

**id:** B1
**Place at:** `extensions/ziy-shell/icons/icon-16.svg`, `icon-24.svg`, `icon-32.svg` (+ `-dark.svg`, `-inactive.svg`, `-light.svg`)
**Rasters at:** the matching `icon-{16,24,32}-{light,dark,inactive}.png` if a surface needs rasters

## The prompt — paste this as-is

> Generate a single centered flat vector toolbar icon on a plain white background: a solid geometric shield silhouette whose face carries the sealed closed-eye motif reduced to two parallel swallow-tail strokes. Deep teal `#0b6e6e` fill with white `#fafafb` eye strokes for the light theme; glow teal `#2dd4bf` fill for the dark theme; 70%-opacity grey `#5c5f66` for the inactive state. 20% padding, no rounded tile, no grain, no drop shadow, no glow, no halo, no text, no animal shapes. Must stay crisp at 16px. One icon only — not a grid, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

**Draw 16 once; 24 and 32 are the same geometry scaled — do not re-draw.**

**16-grid:**

- **Shield:** `M8 1 14 2.7v5.1c0 4-3.1 6.8-6 8.2C5.1 14.6 2 11.8 2 7.8V2.7L8 1Z`
  - light `#0b6e6e` · dark `#2dd4bf` · inactive `#5c5f66` at 70% opacity
- **Lid:** two swallow-tail strokes, `stroke-width 1.15`, round caps
  - light `#fafafb` · dark `#04211c` (the dark-theme on-accent value — a glow teal
    fill needs a dark glyph for ≥3:1) · inactive `#fafafb` at 70%
- **Drop the keyline under 32px.** At 16 the 1-unit keyline and the lid-dot both
  turn into noise. The shield outline + the two lid strokes are the icon. This is
  the §4.4 rule: if a detail closes to a smudge at 16px, drop the detail rather
  than thinning the strokes.
- **24 and 32:** identical paths scaled by 1.5 and 2. At 32 the keyline may come
  back (1 unit at 16 → 2 units at 32) if you want the larger sizes to match the
  app icon's language more closely; keep the same lid weight ratio.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 16 and 32 are the toolbar pair the extension action renderer loads;
24 is for menus and panel headers.

## The white-background note

Plain white background from the crop. Toolbar glyphs are **fully transparent
outside the geometry**, sharp, no tile — a 24px icon with a rounded tile behind it
reads as a button, not a glyph.

## The small-size simplification, spelled out

| size | shield | lid | keyline | dot |
| --- | --- | --- | --- | --- |
| 16 | filled | sw 1.15 | **off** | **off** |
| 24 | filled | sw 1.6 | off | off |
| 32 | filled | sw 2.2 | on (sw 1, 34%) | on (r 0.5) |

Never thin the lid to fit — drop the ornament first.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG (16, scaled to 24/32) ·
  [ ] light / dark / inactive variants · [ ] rasterised
