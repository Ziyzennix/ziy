# Ziy the cat — the mascot

**What this is:** the personality asset. The co-owner's own cat, in their cat's
own natural ginger palette, as flattened vector geometry.

## Palette policy (co-owner decision 2026-10-15)

**The mascot keeps its NATURAL colours.** The palette is measured from the
co-owner's own art (`replica/design/app_icon.png`, 1103×1104 RGBA), not invented:

| role | measured hex | share of opaque pixels |
| --- | --- | --- |
| orange facet, lit | `#e58125` | 9.53% |
| orange facet, mid | `#cb4814` / `#cb5918` | 5.84% / 5.74% |
| tabby stripe brown | `#ae3817` | 8.24% |
| dark brown | `#8f1e14` / `#923123` | 7.70% / 4.39% |
| shadow brown | `#541623` | 4.65% |
| warm grey (whiskers, chin) | `#d5cbb9` / `#d79e6a` | 5.90% / 3.85% |
| cream (bib, muzzle) | `#f5e7c9` / `#f4ca97` / `#f8d7a6` | 5.34% / 4.16% / 4.09% |
| white (eye whites) | `#fefefb` | 5.30% |

(Percentages are of the 521,840 opaque pixels, `Pillow` `MEDIANCUT` at 20
colours over the alpha-masked subject.)

**The palette rule applies ONLY to the brand MARK** — `brand/logo.svg`, the
toolbar icons, the extension glyphs and the hicolor entries — and **never to the
cat.** The cat's warm family is not a brand-palette violation; it is the
co-owner's art arriving intact.

**Why the earlier teal version was wrong, and that it is superseded.** The
first `brand/mascot.svg` recoloured every facet into the Ziy teal ramp
(`#08504f`…`#2dd4bf`) on the theory that the "no warm accent" rule bound every
asset. It does not: that rule exists so the *shield* stays an original
geometric glyph, not so the co-owner's own cat is repainted. The teal mascot
looked like a generic brand blob, not like anyone's cat. It is **superseded by
the natural-palette version below** — same traced geometry, same 281 facets,
true colours. Any audit that asserted "zero warm-orange pixels in the mascot"
was applying the brand-mark rule to the wrong asset and is **retired**.

**The split, in one line each:**

| surface | what it is | palette |
| --- | --- | --- |
| `brand/ziy.png`, `brand/logo*.svg/png`, the hicolor tree | **the co-owner's cat** — the app icon | the cat's natural ginger palette (the master PNG itself, unchanged) |
| `extensions/ziy-shields/icons/*` | the sealed-eye **shield** — the shields-extension toolbar icon and browser-chrome mark | the Ziy teal family, unchanged |
| `extensions/ziy-*/icons/*` (news, talk, playlist, sync, desktop, key) | feature glyphs | the Ziy teal family, unchanged |
| `brand/mascot*.svg` + rasters | the personality mascot (traced vector) | the cat's natural ginger palette |

## The files

| file | use |
| --- | --- |
| `brand/mascot.svg` | the master. 281 measured `<polygon>` facets, 7-step teal ramp, 8 strokes (tabby stripes + mouth). Use at 256px and above, or any size where the full facet language should show. |
| `brand/mascot-simple.svg` | the 3-tone simplification (deep teal / gloam teal / off-white) for small sizes: the about panel, the loading state, the 96–128px surfaces. Same silhouette, same facet boundaries, fewer tones so nothing turns to mush. |
| `brand/mascot-{48,96,128,256,512}.png` | rasters of `mascot.svg` |
| `brand/mascot-simple-{48,96,128,256,512}.png` | rasters of `mascot-simple.svg` |

Both SVGs are `viewBox="0 0 100 100"`, transparent background, `role="img"`,
inline `<title>` and `aria-label` with no competitor name anywhere.

## What the mascot is FOR

Personality surfaces — the places a brand speaks instead of a control:

- the **welcome screen** (first run)
- the **about panel**
- **empty states** (no results, no blocked items yet, nothing synced)
- **loading / busy states**
- the **"no results" states** for the shields, news, playlist and sync panels

It is decoration that carries mood. It is never a control, never a status.

**The cat is ALSO the app icon** (co-owner decision 2026-10-15). `brand/ziy.png`
is the co-owner's master PNG used as-is, and `build-shell.sh` installs it into
`chrome/icons/default/ziy.svg` + `ziy.png` and into every hicolor size slot. The
mascot-as-app-icon is the same cat; the *traced* vector (`brand/mascot.svg`)
stays the personality asset. What did NOT change: the cat is still not a state
indicator, still not a favicon, and the shields extension keeps its own shield.

## What the mascot must NEVER be used for

Hard prohibition, enforced by the acceptance checks in `replica/design/icon.md` §4:

- **not a second app icon** — the app icon slot is the co-owner's cat itself
  (`brand/ziy.png`); do not ship a *traced* second cat in `brand/logo*` or in
  `hicolor/*/apps/` under a mascot name
- **not a second toolbar icon** — no `action.default_icon` entry pointing at the
  cat; the shields extension's toolbar icons stay the shield
- **not any `manifest.json` `icons{}` entry** in any of the 8 extensions
- not a favicon, not a notification icon, not a permission prompt icon
- not a state indicator, not an error icon, not a "shields down" substitute

The shields-extension toolbar icons and the browser-chrome mark stay the sealed-eye
shield: the cat carries *identity* (app icon, welcome, about), the shield carries
*function* (toolbar, shields state). The mascot sharing a state slot would make
the cat a status light.

## Usage rules

1. **Never beside the shield in a control slot.** The sealed-eye shield and the
   cat are two different voices; put them on the same toolbar surface and both
   get quieter. Pick one: shield for function, cat for identity/mood.
2. **Never as a state indicator.** The cat is the same in every state. If a
   surface needs to say "shields up", "syncing", "error", it must use the glyph
   set — the cat stays neutral.
3. **Alt text is fresh copy each time, and it names the cat.** Write it for the
   surface, not a fixed string: "Ziy the cat, waiting for your first search",
   "Ziy the cat, nothing blocked yet", "Ziy the cat says this list is empty".
   The rule is the *pattern* (`Ziy the cat …` + what the surface is doing), so a
   screen reader gets the mood instead of "image".
4. **Decorative-only surfaces:** if the surrounding text already says it, mark
   the mascot `aria-hidden="true"` and drop the alt text rather than repeating.
5. **Small sizes:** switch to `mascot-simple` below 160px. At 96px the 7-step
   ramp's two mid-oranges merge; the 3-tone version holds.
6. **No tile, no shadow, no background rectangle.** Transparent, flat, straight
   onto the surface colour.
7. **The palette is the cat's own.** The measured ginger family listed above —
   orange facets, tabby-stripe browns, creams, whites. The Ziy teal family is for
   the **brand mark only** (shield, toolbar, glyphs). Never repaint the cat.

## Which asset shipped, and why

**`brand/ziy.png` — the app icon — is the co-owner's raster, byte for byte.**

Co-owner decision, 2026-10-15: *their cat is the app icon, used as shipped.* No
conversion, no recode, no resample. `build-shell.sh` §5 prefers
`$BRAND_SRC/logo.svg` as `ICON_SOURCE` for `chrome/icons/default/ziy.svg`; that
file is a one-line passthrough whose entire content is this same PNG embedded
base64 as a single `<image>`, so the SVG and the PNG slots are the same pixels.
`shell/brand-fallback/render-icons.py` copies `brand/ziy.png` into every size
slot it writes (16, 22, 24, 32, 48, 64, 96, 128, 256, plus `logo.png` and
`ziy.png`) — the passthrough came first here, and any earlier trace/recolour
pipeline is retired.

**The traced vector (`brand/mascot.svg`) still ships** as the personality
mascot — 281 measured `<polygon>` facets, same geometry, same stripes and mouth
as strokes — but its ramp is now the cat's own measured ginger palette
(`#e58125` facets, `#ae3817`/`#8f1e14`/`#541623` tabby and shadow browns,
`#f5e7c9`/`#fefefb` cream and whites) rather than the teal ramp it carried
before 2026-10-15.

**The transparency check that used to block this is gone.** It used to be read
as a *reason to recolour*; it is in fact a *reason the raster can ship*: the
corners sample `rgba(0,0,0,0)`, the alpha channel is 56.1% fully transparent,
the white muzzle is separated by real alpha, and the subject covers ~42.8% of
the frame at every raster size with the four corners fully transparent. The
1103×1104 master is above every hicolor slot, and where a slot needs a smaller
image the OS resamples the same master — one asset, no redraw per size.

## The reference-only assets

| file | what it is | status |
| --- | --- | --- |
| `replica/design/app_icon.png` | the co-owner's cat, RGBA, 1103×1104. Real transparency (56.1% fully transparent / 41.2% opaque / 2.7% partial), 90.6% of opaque pixels in the warm-ginger family, zero pixels near the brand teals. Identical bytes are now installed as `brand/ziy.png`, `brand/logo-{16…256}.png`, `build/ziy/chrome/icons/default/ziy.png` and every `build/share/icons/hicolor/*/apps/ziy.png`. | **the master** — shipped as `brand/ziy.png` |
| `replica/design/app icon.jpeg` | the earlier JPEG: 2048×2048 low-poly cat in a rounded tile with a baked drop shadow, RGB only, cream muzzle = page background | reference only — never shipped |

## Re-running the build

The app icon needs no re-derivation at all — the master PNG is copied:

```
cp replica/design/app_icon.png brand/ziy.png
for s in 16 22 24 32 48 64 96 128 256; do cp replica/design/app_icon.png brand/logo-$s.png; done
./tools/build-shell.sh --force          # renders + installs the cat into build/ziy
./tools/install-desktop.sh --dry-run    # would install the cat at all 9 hicolor sizes
```

Then re-run the audits that still apply: warm-ginger pixels **present** (they are
the point), the clean-room guard clean on every SVG, and a byte comparison of
each installed icon against the master PNG's md5.
