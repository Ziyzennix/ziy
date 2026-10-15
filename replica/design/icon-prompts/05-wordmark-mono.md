# 05 — Wordmark, mono (D3)

**id:** D3
**Place at:** `brand/wordmark-mono.svg`
**Rasters at:** `brand/wordmark-mono-512.png`

## The prompt — paste this as-is

> Generate a single centered flat vector horizontal lockup on a plain white background: a geometric flat-topped shield mark at left followed by the three-letter wordmark "Ziy", but every stroke, every shield facet and every letterform in one flat off-white `#fafafb`, zero gradient, sharing one baseline and one cap-height rule, so the whole lockup reads on near-black and dark teal surfaces. 18% padding, sharp corners, soft even lighting, flat, no drop shadow, no glow, no halo, no other words or text, no animal shapes, no warm accent, no second colour anywhere. One lockup only — not a grid, not a mockup, no surrounding UI.

## The vector stub — rebuild as clean SVG

Same geometry as `03-wordmark-horizontal.md` (64-tall grid, mark at
`translate(2 6) scale(0.8125)`, text x 70 baseline y 45 size 40 tracking −1.4),
with **one change**: a single `fill="#fafafb"` over the entire group, and the
keyline stroke changed to `#0b6e6e` at low opacity so the shield still reads as a
shield outline rather than a white blob.

Why one colour is enough: `#fafafb` on `#202124` is ≈15.9:1. No second value is
needed for AA anywhere.

**Accessibility:** `role="img"`, `<title>`, `aria-label`; no competitor names.

**Rasters:** 512. Transparent background, sharp corners.

## The white-background note

Plain white background from the model — which means a white lockup on a white
background is invisible in the sketch. That is expected: this variant exists to
be composited onto dark surfaces only. Preview it on `#202124` or on the dark
teal, and crop the white from the exported file. Confirm the corner pixels are
`rgba(0,0,0,0)` before shipping.

## Where it goes, and where it doesn't

Dark-theme About sheet, the dark titlebar, and any dark surface that needs the
wordmark. **Not** the light About sheet — that is `03-wordmark-horizontal.md`.

## Checklist

- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised at 512
