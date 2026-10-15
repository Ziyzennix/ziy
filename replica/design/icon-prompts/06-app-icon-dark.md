# 06 — App icon, dark surface variant (A2-dark)

**id:** A2 (dark)
**Place at:** `brand/logo-dark.svg`
**Rasters at:** `brand/logo-dark-{16,22,24,32,48,64,96,128,256}.png`

## The prompt — paste this as-is

> Generate a single centered flat vector app icon outline on a plain white background: the flat-topped geometric shield with a sealed closed eye, drawn purely as outlines — equal 2px-equivalent strokes, no solid fill, only a faint 15% wash of the stroke colour inside. Dark variant: strokes in glow teal `#2dd4bf`. 18% padding, sharp corners, soft even lighting, no drop shadow, no glow, no halo, no text, no animal shapes, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

Same 64-grid geometry and the same optical centre as the A1 master
(`01-app-icon.md`) — this variant must **pair frame-for-frame** with it so the
light and dark icons swap without a jump. The only change is fills → strokes:

- **Shield:** the `M32 3 57 11v20…` path
  `fill="url(#ziy-dark-wash)" stroke="#2dd4bf" stroke-width="3" stroke-linejoin="round"`
  where the wash is a vertical linear gradient `#2dd4bf` at 15% (top) → 4% (bottom).
- **Sealed eye, lid strokes:** the A1 two swallow-tail paths,
  `stroke="#2dd4bf" stroke-width="2.4" stroke-linecap="round"` (2.4 here, not 3.4
  — strokes on an outline icon read lighter than strokes on a solid fill).
- **Crease dot:** a stroked circle, not a filled one —
  `<circle cx="32" cy="25.5" r="3.1" fill="none" stroke="#2dd4bf" stroke-width="2.4"/>`.
- **Optical centring:** the same `translate(0 -1)` as A1.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** all nine sizes, each its own render.

## The white-background note

Plain white background from the model; crop it. Because the icon is an outline on
white, the sketch may look faint — that is the point. Preview it on a dark surface
(`#202124` or `#08504f`) to judge it. Corners must be `rgba(0,0,0,0)`.

## Why the variant exists

Window and taskbar icons on dark themes need the mark drawn in glow teal or it
disappears. This is the same shield, the same eye, one swap.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised at all nine sizes
