# 14 — Playlist glyph (play / queue) (C7)

**id:** C7
**Place at:** `extensions/ziy-playlist/icons/glyph-48.svg` (master) · `playlist-{16,32,48,96}.png`, `playlist-play-{16,32}.png`, `playlist-queue-{16,32}.png` (rasters)

## The prompt — paste this as-is

> Generate a single centered flat vector icon on a plain white background: a media queue abstraction — three stacked rounded rows in deep teal `#0b6e6e`, the top row holding one solid right-pointing triangle in off-white `#fafafb` (play), the two lower rows holding short bars. Geometric, even spacing, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text or readable letters, no animal shapes, no warm accent. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

48-grid.

- **Rows:** three rounded rects, r 2, h 8, at y 8 / 20 / 32, x 6 → 42, fill `#0b6e6e`.
- **Play triangle:** `M20 12l10 6-10 6Z`, fill `#fafafb`.
- **Lower-row bars:** sw 2, `#fafafb`, round caps — short bars at x 12 → 30 on
  rows 2 and 3.
- **Queue variant:** the same three equal rows, each with a right-pointing chevron
  at its right edge — `M34 20l4 4-4 4`, sw 2, `#fafafb`, round caps, no play
  triangle. Three equal rows, three equal chevrons: "all queued", not "one
  playing".

**At 16px:** two rows + the play triangle only (play) / two rows + one chevron
(queue). The third row is 4% of the canvas and closes up.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** playlist at 16/32/48/96; the play and queue variants at 16/32.

## The white-background note

Plain white background; crop it. Fully transparent outside the geometry — no
enclosing plate, no tile.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG (48-grid master) · [ ] rasterised, play + queue variants
