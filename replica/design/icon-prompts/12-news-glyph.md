# 12 — News glyph (C5)

**id:** C5
**Place at:** `extensions/ziy-news/icons/glyph-48.svg` (master) · `news-{16,32,48,96}.png` (rasters)

## The prompt — paste this as-is

> Generate a single centered flat vector icon on a plain white background: a news-feed abstraction — one rounded-rectangle sheet in deep teal `#0b6e6e` holding three horizontal off-white `#fafafb` lines (two long, one short), plus a small circular emission node at the top-left corner radiating one short arc. Geometric, symmetric, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text or readable letters, no animal shapes, no warm accent. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

48-grid.

- **Sheet:** rect x 6, y 10, w 36, h 28, r 3, fill `#0b6e6e`.
- **Lines:** three strokes, sw 2, `#fafafb`, round caps, y at 18 / 24 / 30,
  - long: x 11 → 31 (22 units)
  - long: x 11 → 31
  - short: x 11 → 25 (14 units)
- **Emission node:** circle r 2.5 at `(12, 8)`, fill `#0b6e6e`.
- **Arc:** `M15 6a6 6 0 0 1 6 4`, stroke sw 1.6, `#0b6e6e`, round cap, fill none.

**At 16px:** drop the node and the arc, keep the sheet + 2 lines. The emission
abstraction is 4% of the canvas at best and turns to a smudge.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 16/32/48/96, each its own render.

## The white-background note

Plain white background; crop it. Fully transparent outside the geometry — the
rounded sheet is the *subject*, not a tile. No background plate.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG (48-grid master) · [ ] rasterised at 16/32/48/96
