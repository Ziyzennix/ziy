# Ziy brand — colours and asset index

Everything here is **original Ziy work**: a shield with a sealed eye, drawn for
this project. No other browser's mark, silhouette, animal, orange family, or
typographic treatment is traced or referenced.

## The one signature colour

**Gloam teal `#0b6e6e`** (dark theme `#2dd4bf`).

Why teal, and not the reference accent recorded in the recon (`#434fcf`, a
cobalt indigo):

1. **It is not taken.** Chrome-blue, red, orange and violet are all already
   branded by other vendors in this category. A deep cyan-teal is unclaimed on
   a browser toolbar, so it reads as *ours* at 16px.
2. **It means the product.** Teal is the colour of "sealed" — wax, watertight
   joins, cold storage. Ziy's promise is "nothing leaks"; the hue carries the
   promise before a word is read.
3. **It survives contrast.** One value does two jobs: as text on the measured
   neutrals (`#ffffff`, `#fafafb`, `#e6f2f2`) it clears 4.5:1 on all of them
   (6.05 / 5.80 / 5.29), and as a fill behind white text it gives 6.05:1. No
   second accent hue is needed for AA anywhere in the suite.
4. **It sits opposite the measured greys.** The reference screens' neutrals are
   warm (`#ffffff`, `#fafafb`, `#e4e4e5`, `#202124`); a cool accent against a
   warm grey field keeps the accent legible at small sizes.

The recorded accent of the original remains a **role** (`accent`) in
`tokens.json` with a comment; it is never a value Ziy ships.

## Palette

| role | light | dark | notes |
| --- | --- | --- | --- |
| accent | `#0b6e6e` | `#2dd4bf` | signature; focus rings, active states |
| accent-hover | `#095a5a` | `#5ee0d0` | 8.01:1 / 10.53:1 with `on-accent` |
| accent-active | `#08504f` | `#7ae7da` | pressed |
| accent-bg | `#e6f2f2` | `#14302e` | selected rows, banners, "on" fills |
| on-accent | `#ffffff` | `#04211c` | text on accent fills |
| danger | `#b3261e` | `#f87171` | destructive, blocked, error |
| success | `#1a7a4d` | `#4ade80` | verified, saved, restored |
| warning | `#8a5a00` | `#fbbf24` | certificate, rate-limit, trial |
| text | `#202124` | `#f4f5f6` | body |
| text-muted | `#5c5f66` | `#a1a6ad` | meta, secondary |
| border / border-input | `#e4e4e5` / `#767b82` | `#3a3d41` / `#868e98` | hairlines vs. inputs |

Neutral greys were **measured**, not chosen: `#ffffff`, `#fafafb`, `#f0f0f0`,
`#e4e4e5`, `#c9c9ca`, `#8b8b8b`, `#202124`, `#1c1c1d` all appear in
`replica/screens/*.png` (see `tokens.json` `_measurement-note`).

## Assets

| file | use | notes |
| --- | --- | --- |
| `logo.svg` | About, splash, first-run | 64px grid, gradient fill, sealed-eye shield |
| `wordmark.svg` | About, docs, marketing | mark + `Ziy` in Inter 700, `-1.4` tracking |
| `icon-16.svg` | toolbar/favicon | solid fill, 1:1 keyline-safe at 16px |
| `icon-24.svg` | menu, panel headers | |
| `icon-48.svg` | `.desktop` entry, taskbar | rounded 11px tile |
| `icon-96.svg` | About sheet, store listing | rounded 22px tile |

Raster export rule (for `brand/` when build runs): render the SVGs at 1×/2×/3×
with the same rasteriser the shell build uses; never hand-trace PNG edges.
Icons ship with `aria-label` and an inline `<title>`.

## Font

**Inter** (open, SIL OFL) for everything; `ui-monospace` stack for codes
(recovery phrases, addresses, filter-list counts). No licensed or bundled font
from the reference product.
