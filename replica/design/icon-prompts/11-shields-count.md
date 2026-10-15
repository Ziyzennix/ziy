# 11 — Shields per-site / counting badge (C4)

**id:** C4
**Place at:** `extensions/ziy-shields/icons/shield-count-16.png`, `shield-count-32.png`

## The prompt — paste this as-is

> Generate a single centered flat vector badge icon on a plain white background: the small armoured sealed-eye shield, solid deep teal `#0b6e6e`, with one rounded white pill slot at its lower-right corner outlined in teal — the pill stays empty, no number drawn. 20% padding, sharp shield corners, soft even lighting, flat, no drop shadow, no glow, no halo, no text or digits inside, no animal shapes, no warm accent. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

**16/32 only.**

**16-grid:**

- **Shield:** the B1 16-grid path `M8 1 14 2.7v5.1c0 4-3.1 6.8-6 8.2C5.1 14.6 2 11.8 2 7.8V2.7L8 1Z`
  **inset** to 12 units (scale 0.75) and translated 2 units right and 1 down, so
  the badge has the lower-right corner free.
- **Pill slot:** 9 × 5 at `(14, 13)`, radius 1.5, `stroke-width 1`
  - fill `#fafafb` (the slot reads as a knock-out), stroke `#0b6e6e`
- **No lid, no seam.** At 16 the badge is the shield silhouette + the slot; the
  closed eye would be 1px of mush inside a 12-unit shield.

**32-grid:** the same at 2×, with the lid strokes restored (sw 1.15, `#fafafb`)
since there is room.

**Why the pill is empty:** the number is set in the UI layer, not the icon. The
icon ships the empty slot so any glyph updates without a new render — and so a
count change never looks like an icon change.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 16 and 32.

## The white-background note

Plain white background; crop it. Transparent outside the geometry. Sharp shield
corners; the pill is the only rounded element.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised at 16/32
