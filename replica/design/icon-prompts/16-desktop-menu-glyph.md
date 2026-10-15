# 16 — Desktop menu glyph (C9)

**id:** C9
**Place at:** `extensions/ziy-desktop/icons/glyph-48.svg` (master) · `menu-{16,32,48,96}.png` (rasters)

## The prompt — paste this as-is

> Generate a single centered flat vector icon on a plain white background: three equal horizontal bars in deep teal `#0b6e6e`, stacked with generous even gaps, round caps, no enclosing shape behind them. Extreme legibility at 16px. 20% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text, no animal shapes, no warm accent. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

48-grid.

- **Bars:** three strokes, sw 3.2, round caps, `#0b6e6e`
  - y 18, x 14 → 34
  - y 24, x 14 → 34
  - y 30, x 14 → 34
- **No enclosing circle.** The current placeholder wraps the bars in a filled
  circle; that circle disappears. The bars alone are the mark — at 16px three bars
  inside a circle is a grey dot with a slit in it.

**At 16px:** same three bars, sw 1.3, x 4 → 12, y 5 / 8 / 11. Nothing else.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 16/32/48/96, each its own render.

## The white-background note

Plain white background; crop it. Fully transparent outside the bars — no circle,
no tile, no background plate. This is the one glyph in the set whose power comes
from what is *not* drawn.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG (48-grid master) · [ ] rasterised at 16/32/48/96
