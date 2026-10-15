# 00 — README: how to use this prompt set

One file per icon. Work through them **one at a time, in order** — each prompt is
self-contained so you never have to remember a previous one.

## The order, and why

| # | icon | why here |
| --- | --- | --- |
| 00 | this file | — |
| 01 | **App icon master (A1)** | the co-owner's cat — everything else reuses the shield path |
| 02 | **Mascot master** ← your cat, start here if you want | the same cat as a regenerated master image |
| 03 | Wordmark, horizontal (D1) | about, splash, first run, marketing |
| 04 | Wordmark, stacked (D2) | about sheet, splash, store listing |
| 05 | Wordmark, mono (D3) | dark backgrounds |
| 06 | App icon, dark (A2) | pairs against the final A1 geometry |
| 07 | App icon, inactive (A2) | pairs against the final A1 geometry |
| 08 | Toolbar set, 16/24/32 (B1) | the most-seen surface; fixes the small-size simplifications |
| 09 | Shields, up (C1/C2) | the 8 extension glyphs all derive from the shield |
| 10 | Shields, down (C3) | must pair frame-for-frame with 09 |
| 11 | Shields, count badge (C4) | the empty pill slot |
| 12 | News glyph (C5) | |
| 13 | Talk glyph (C6) | |
| 14 | Playlist glyph (C7) | |
| 15 | Sync glyph (C8) | |
| 16 | Desktop menu glyph (C9) | |
| 17 | NTP glyph (C10) | |

**Start with 01 or 02.** 01 if you want the app icon locked down first; 02 if you
want your cat in the system first (the mascot is independent of the shield).
Then 03–05 (the wordmarks), then 06–07 (the A1 variants), then the glyphs.

## How to read each file

Each file has the same five parts:

1. **The id** and **the target path** — exactly where the file lands, and exactly
   what it is called. Do not rename it: the build and the manifests read the name.
2. **ONE paste-ready prompt.** Paste it as-is. It contains style, subject,
   geometry, palette, background, composition, lighting, what to avoid, and the
   corner behaviour. There is nothing to add.
3. **The vector stub.** The image the model gives you is a *sketch*. The stub is
   what you rebuild as clean SVG by hand: grid, path, stroke weights, radii. The
   shipped PNG is rasterised from that SVG.
4. **The white-background note.** Image models cannot do reliable alpha, so every
   prompt asks for a plain white background. Crop the white off — never scale the
   mark up to fill.
5. **The checklist.** Tick as you go.

## The palette — the only values to use, in every prompt

| token | hex | role |
| --- | --- | --- |
| gloam teal | `#0b6e6e` | primary fill, light surfaces |
| gloam teal dark | `#08504f` | gradient floor, shaded facets |
| glow teal | `#2dd4bf` | stroke/fill on dark surfaces |
| ink | `#202124` | glyph on light surfaces |
| surface / paper | `#fafafb` / `#ffffff` | glyph on dark fills, tile background |
| muted | `#5c5f66` | the "off" state |

**Never:** violet, cobalt, or gradient work outside the teal family. No drop
shadows, glow, or outline halo in a toolbar or app glyph.

**The warm-family ban applies to the BRAND MARK only — never to the cat.**
Co-owner decision, 2026-10-15: their cat keeps its own natural palette exactly
as their reference has it, and the cat is the app icon. So the ban reads:
the shield, the toolbar icons, the extension glyphs and the hicolor entries are
teal-only, with no orange, red-orange, amber or yellow anywhere. The mascot
prompt (02) and the app-icon prompt (01) instead **preserve the cat's measured
ginger family** (see the table in `brand/MASCOT.md`): orange facets, tabby
browns, creams and whites, exactly as the reference has them. Never recolour
the cat into teal.

## The clean-room rule that binds every file

No competitor name, mark, silhouette, animal, colour family or typography may
appear in any prompt, description, filename, `<title>` or `aria-label` of the
asset it produces. Two guards police this and the new icons must pass both:

- `tools/verify.sh` greps every `*.svg` under `brand/` and
  `replica/design/brand/` (case-insensitive) for competitor names.
- `tools/lib/cleanroom-scan.py` scans shipped code (`extensions/`, `shell/`,
  `tools/`) for banned names as string literals. If you edit a `manifest.json`
  `icons{}` block, add no name-bearing comment or string.

**The cat is exempt from the "no animal silhouette" rule** — it is Ziy's own
cat, and the co-owner has ruled that it is THE app icon (`brand/ziy.png`, the
master PNG used as-is). So the shield's job narrows to *function*: the
shields-extension toolbar icons and the browser-chrome mark. Files 01 and 02
are the only animal prompts in this set, and both describe the co-owner's cat
rather than any other cat.

## The technical rules the stub obeys

- **Format.** Master is SVG (`viewBox` square, `role="img"`, inline `<title>`,
  `aria-label`). Shipped rasters are **PNG with alpha**, at exactly the pixel size
  the target slot names.
- **Transparent background** outside the geometry. Corner pixels
  `rgba(0,0,0,0)`. Only the app-icon *tile* variants (48/96) may carry a rounded
  teal tile.
- **Pixel-per-size.** Each size gets its own render. A 256px source copied into
  the 22px slot gets resampled with a warn and the proof goes dirty.
- **Rhythm.** 2px-equivalent stroke at 48px (≈4.17% of the size), round caps and
  joins, 10% optical padding, geometry on integers or half-integers so the raster
  is crisp at 16, 32 and 96.
- **Minimum at 16px.** No stroke thinner than 1 grid unit, no detail smaller than
  ~4% of the canvas. If the eye lid closes to a smudge at 16px, drop the keyline
  and lid-dot rather than thinning the lid.
- **Safe padding.** 10% inset on all four sides, measured on the *optical* box.
- **Optical centring.** A shield's point pulls the eye down, so nudge the drawing
  up by ~1 grid unit at 64.
