# 09 — Shields glyph, shields UP (C1 / C2)

**id:** C1 (master) / C2 (up state)
**Place at:** `extensions/ziy-shields/icons/glyph-48.svg` (master) · `shield-{16,32,48,96}.png` (rasters)

## The prompt — paste this as-is

> Generate a single centered flat vector icon on a plain white background: an armoured shield — a flat-topped geometric shield with a sealed closed eye on its face — solid deep teal `#0b6e6e` with the eye in off-white `#fafafb` and one central armour seam line, reads as "protected and holding". 18% padding, sharp corners, soft even lighting, flat, no drop shadow, no glow, no outline halo, no text, no animal or beast motif, no warm accent. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

48-grid. **The shield is the A1 path scaled to 48** — do not redraw it:

```
A1: M32 3 57 11v20c0 14.5-11.2 24.6-25 30C19.2 55.6 8 45.5 8 31V11L32 3Z   (64-grid)
× 0.75: M24 2.25 42.75 8.25v15c0 10.875-8.4 18.45-18.75 22.5C14.4 41.7 6 34.125 6 23.25v-15L24 2.25Z
```

- **Shield fill:** `#0b6e6e` (flat, no gradient — the extension toolbar glyphs stay
  flat so they survive 16px).
- **Lid:** two swallow-tail strokes, `stroke-width 2.5`, round caps, `#fafafb`.
- **Armour seam:** one `#ffffff` stroke at 34% opacity, `stroke-width 1.8`, drawn
  at the keyline radius — the inner offset of the shield, so the seam reads as the
  plate's own edge rather than a decoration.
- **16 / 32 / 96:** the same drawing scaled. **96 adds the seam only** (it is the
  one size with room for it to be legible); drop the seam at 16 and 32.
- **16px floor:** shield + lid only, lid sw 0.85.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

## The white-background note

Plain white background; crop it. Extension glyphs are fully transparent outside the
geometry — no tile, no badge, no background colour. Sharp corners only.

## Why this is the "up" state

C2 means "armour on": filled shield, the eye present, the seam showing. It has to
differ from C3 (down) **and** from the toolbar background at ≥3:1 each
(`icon.md` §4.5). `#0b6e6e` against `#ffffff` is 6.05:1 and against `#fafafb` is
5.80:1, so it clears the bar on both light surfaces.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG (48-grid master) · [ ] rasterised at 16/32/48/96
