# 15 — Sync glyph (chain / link) (C8)

**id:** C8
**Place at:** `extensions/ziy-sync/icons/glyph-48.svg` (master) · `ziy-sync-{16,32,48,96}.png` (rasters)

> **Keep the `ziy-` filename stem.** That is what the manifest names; every other
> extension drops it, but `ziy-sync` keeps it.

## The prompt — paste this as-is

> Generate a single centered flat vector icon on a plain white background: a link/chain abstraction — two interlocking rings outlined in deep teal `#0b6e6e`, lying on a horizontal axis, with a small teal dot at each joint; the overlap reads cleanly. Geometric, symmetric, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text, no animal shapes, no warm accent. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

48-grid.

- **Rings:** two circles, r 7, centres `(18, 24)` and `(30, 24)`,
  `fill="none" stroke="#0b6e6e" stroke-width="3"`.
- **Overlap knock-out:** a 2-unit band in `#fafafb` where the rings cross, so the
  overlap reads as two separate rings rather than a blob.
- **Joint dots:** r 1.6 at the two intersection points, fill `#0b6e6e`.

**At 16px:** one ring + one ring, no knock-out, no joint dots. The chain reads
from the silhouette alone at that size.

**Syncing / error are animation, not new art.** `-syncing` and `-error` are the
same drawing with a rotation or a colour change applied by the runtime, per
`icon.md` §3 C8. No separate file is needed.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 16/32/48/96, each its own render.

## The white-background note

Plain white background; crop it. Fully transparent outside the geometry — no
enclosing shape, no tile.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG (48-grid master) · [ ] rasterised at 16/32/48/96
