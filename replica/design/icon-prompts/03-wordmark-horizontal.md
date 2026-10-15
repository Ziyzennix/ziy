# 03 — Wordmark, horizontal lockup (D1)

**id:** D1
**Place at:** `brand/wordmark.svg`
**Rasters at:** `brand/wordmark-512.png`, `brand/wordmark-1024.png`

## The prompt — paste this as-is

> Generate a single centered flat vector horizontal lockup on a plain white background: a geometric flat-topped shield mark at left, then the three-letter wordmark "Ziy" in a geometric sans-serif, bold, tight negative letter-spacing, ink `#202124`, sharing one baseline and one cap-height rule with the mark. Sharp corners, no tile, no animal shapes, no drop shadow, no glow, no halo, no other words or text. Soft even studio lighting. 18% padding. One lockup only — not a grid of options, not a mockup, no surrounding UI, no device frame.

## The vector stub — rebuild as clean SVG

64-tall grid.

- **Mark:** the §3 A1 shield geometry, scaled to 0.8125 and translated by `(2, 6)`
  — `transform="translate(2 6) scale(0.8125)"`. It keeps the A1 lid strokes,
  the `#0b6e6e` → `#08504f` gradient, and the `#ffffff` at 34% keyline.
- **Text:** starts at x 70, baseline y 45, Inter 700 (fallback: a geometric
  sans-serif), size 40, letter-spacing −1.4, fill `#202124`.
- **One rule:** the mark's optical centre and the text's x-height share a
  baseline, and the cap-height of the letters matches the mark's top edge so the
  lockup sits on one line.

**Accessibility:** `role="img"`, `<title>`, `aria-label`. Nothing that names
another product.

**Rasters:** 512 and 1024 wide. Transparent background, sharp corners.

## The white-background note

Plain white background from the model; crop it, don't scale the lockup up to
fill. Wordmark lockups are **sharp and transparent** — no tile, ever.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised at 512/1024
