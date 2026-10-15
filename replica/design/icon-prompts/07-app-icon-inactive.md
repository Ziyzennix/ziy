# 07 — App icon, inactive variant (A2-inactive)

**id:** A2 (inactive)
**Place at:** `brand/logo-inactive.svg`
**Rasters at:** `brand/logo-inactive-{16,22,24,32,48,64,96,128,256}.png`

## The prompt — paste this as-is

> Generate a single centered flat vector app icon outline on a plain white background: the flat-topped geometric shield with a sealed closed eye, drawn purely as outlines — identical shape to a teammate icon but flat muted grey `#5c5f66`, with the eyelid strokes at 60% opacity and no accent colour anywhere. Equal 2px-equivalent strokes, only a faint wash inside. 18% padding, sharp corners, soft even lighting, no drop shadow, no glow, no halo, no text, no animal shapes, no warm accent, no teal. One icon only — not a grid, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

Identical geometry and optical centre to `06-app-icon-dark.md` (which is itself
identical to A1). Three changes:

- **Shield:** `fill="#5c5f66" fill-opacity=".18" stroke="#5c5f66" stroke-width="3"`
- **Sealed eye, lid strokes:** `stroke="#5c5f66" stroke-width="2.4" stroke-opacity=".6"`
- **Crease dot:** `<circle cx="32" cy="25.5" r="3.1" fill="#5c5f66" fill-opacity=".6"/>`
- Same `translate(0 -1)`.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** all nine sizes, each its own render.

## The white-background note

Plain white background from the model; crop it. On a white sketch a 60%-opacity
grey lid may be nearly invisible — preview on `#ffffff` *and* on `#fafafb`, and
judge there. Corners must be `rgba(0,0,0,0)`.

## The state rule

This is the **inactive** state only — the window or taskbar slot is alive but
unfocused. `#5c5f66` on paper is 6.13:1, so it stays legible without competing.
Never use it for an error state, and never let it be the *only* thing
distinguishing a state (see `icon.md` §4.5).

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised at all nine sizes
