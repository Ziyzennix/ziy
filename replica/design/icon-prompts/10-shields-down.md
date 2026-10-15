# 10 — Shields glyph, shields DOWN (C3)

**id:** C3 (down state)
**Place at:** `extensions/ziy-shields/icons/shield-down-{16,32,48,96}.png`

## The prompt — paste this as-is

> Generate a single centered flat vector icon on a plain white background: the same armoured shield with sealed closed eye, but "armour off" — flat muted grey `#5c5f66` fill, the eye hollowed to a thin off-white `#fafafb` keyline pair, no armour seam, so it reads open. Identical geometry, centre and padding to the shields-up icon. No red, no X, no warning triangle, no warm accent. 18% padding, sharp corners, soft even lighting, flat, no drop shadow, no glow, no halo, no text, no animal shapes. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

Same 48-grid shield path as `09-shields-up.md`. Four changes:

- **Shield fill:** `#5c5f66` flat.
- **Lid:** the two swallow-tail strokes become a **thin keyline pair**,
  `stroke-width 1.6`, `#fafafb` at 100% — the closed eye survives as a line pair
  rather than a filled shape, so "eye still there, armour gone" reads at a glance.
- **Armour seam:** removed.
- Same centre, same padding, same footprint — C2 and C3 must pair frame-for-frame.

At 16px: shield + the 2 lid strokes only, lid sw 0.7.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 16/32/48/96, each its own render.

## The white-background note

Plain white background; crop it. Fully transparent outside the geometry, no tile.

## Why no red, no X, no triangle

"Shields down" is the *expected* state on a site the user chose not to protect. It
is not an error. Red would make every ordinary page look like a warning, and a
dashed/down grey already carries the meaning. Errors are a different glyph
(`icon.md` §4.5: a state must never be distinguished by colour alone — here the
fill and the seam presence do the work).

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised at 16/32/48/96
