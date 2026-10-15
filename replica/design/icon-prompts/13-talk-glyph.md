# 13 — Talk glyph (camera) (C6)

**id:** C6
**Place at:** `extensions/ziy-talk/icons/glyph-48.svg` (master) · `talk-{16,32,48,96}.png` (rasters)

## The prompt — paste this as-is

> Generate a single centered flat vector icon on a plain white background: a video-call camera abstraction — rounded-rectangle body in deep teal `#0b6e6e` with a circular off-white `#fafafb` lens ring in its centre and a wedge viewfinder bump pointing right. Geometric, symmetric, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text, no face, no animal or human features, no warm accent. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

48-grid.

- **Body:** rect x 6, y 14, w 28, h 20, r 4, fill `#0b6e6e`.
- **Lens ring:** circle c `(20, 24)`, r 6.5, `fill="none" stroke="#fafafb" stroke-width="2.4"`.
- **Wedge:** `M34 18l8-4v16l-8-4Z`, fill `#0b6e6e`.
- All joins round.

**At 16px:** body + a filled `#fafafb` dot for the lens (r 2). The ring is
0.7 units of stroke at 16 and closes up; the wedge keeps its silhouette but drops
to a plain triangle.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 16/32/48/96, each its own render.

## The white-background note

Plain white background; crop it. Fully transparent outside the geometry — the
rounded body is the subject, not a tile.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG (48-grid master) · [ ] rasterised at 16/32/48/96
