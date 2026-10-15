# 17 — NTP glyph (C10)

**id:** C10
**Place at:** `extensions/ziy-ntp/icons/icon-{16,32,48,96}.png` (new dir) — and then fix the manifest's `icons{}` either way

> This icon has **no `icons/` dir today**. The NTP's `manifest.json` points `icons`
> at `ui/icons/icon-48.svg` and `ui/icons/icon-96.svg`, which are near-copies of the
> design-phase SVGs. Either replace those two SVGs with the new drawing, or create
> `icons/` with the rasters below and update the manifest to
> `"16": "icons/icon-16.png"` etc. Both are manifest edits, not build changes.

## The prompt — paste this as-is

> Generate a single centered flat vector icon on a plain white background: a new-tab abstraction — one rounded-square outline in deep teal `#0b6e6e` with a solid teal plus sign centred inside it, nothing else. Geometric, symmetric, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text or letters, no animal shapes, no warm accent. One icon only — not a grid of options, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

48-grid.

- **Tile:** square x 8, y 8, w 32, h 32, r 7, `fill="none" stroke="#0b6e6e" stroke-width="3"`.
- **Plus:**
  - horizontal bar: y 24, x 17 → 31
  - vertical bar: x 24, y 17 → 31
  - both sw 3.4, `#0b6e6e`, round caps, fill none

**At 16px:** tile + plus, tile sw 1.2, plus sw 1.6, r 2. Nothing else.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 16/32/48/96, each its own render. All four are needed — the NTP is
the one extension with no rasters at all today.

## The white-background note

Plain white background; crop it. The rounded tile here is the **subject** (an
outline, not a filled plate) — so the icon is transparent inside the tile and
outside it, with the plus as the only solid mass. Sharp edge case to watch: the
tile must not read as a button background. Keep it a stroke.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised at 16/32/48/96 ·
  [ ] manifest `icons{}` points at the new files
