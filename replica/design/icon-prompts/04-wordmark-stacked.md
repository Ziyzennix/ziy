# 04 — Wordmark, stacked lockup (D2)

**id:** D2
**Place at:** `brand/wordmark-stacked.svg`
**Rasters at:** `brand/wordmark-stacked-512.png`, `brand/wordmark-stacked-1024.png`

## The prompt — paste this as-is

> Generate a single centered flat vector stacked lockup on a plain white background: a geometric flat-topped shield mark centred above the three-letter wordmark "Ziy", both on one optical centre line with an even gap about a fifth of the mark height. The wordmark in a geometric sans-serif, bold, tight negative letter-spacing, ink `#202124`. Nearly square canvas, 20% padding, sharp corners, soft even lighting, flat, no drop shadow, no glow, no halo, no other words or text, no animal shapes, no warm accent. One lockup only — not a grid, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

96-wide canvas.

- **Mark:** 48 units, centred, occupying y 6 → 54. The A1 shield geometry scaled
  0.75, with `translate` to land it on the centre line.
- **Text:** baseline y 78, size 30, letter-spacing −1.0, centred on the mark's
  axis, fill `#202124`.
- **The gap** between the mark's bottom (y 54) and the text's cap height (y 78 −
  21 ≈ 57) is about 3 units, which is ~1/5 of the 48-unit mark height — the even
  rhythm that keeps the stack from looking like two stacked objects.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 512 and 1024. Transparent, sharp corners, no tile.

## The white-background note

Plain white background from the model; crop it. No tile, no rounded square, no
background colour — the lockup sits directly on the About sheet's surface.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised at 512/1024
