# Ziy icon specification — generation brief for the co-owner

Doc-only. This file is the contract for every icon Ziy ships: what exists today,
what the co-owner must produce, and the exact paths the build consumes. §3 is a
**send-and-check-off checklist**: one self-contained, ready-to-paste prompt per
icon, plus the target path and the vector stub to rebuild it as clean SVG. No
image is generated from this file; icons are produced by an image model and then
hand-cleaned into their vector form.

Every prompt below targets an **original design in the Ziy system**. No
competitor name, mark, silhouette, animal or colour family may appear in any
prompt, description, filename, or `<title>` inside shipped assets. Two guards
police this and the new icons must pass both:

- `tools/verify.sh` §"no brand asset names a reference product" greps every
  `*.svg` under `brand/` and `replica/design/brand/` (case-insensitive) for
  competitor names. SVG `<title>`, `aria-label` and comments are all inside
  those files, so prompts must keep them clean. (Rasters are exempt — they carry
  no text.)
- `tools/lib/cleanroom-scan.py` scans shipped code (`extensions/`, `shell/`,
  `tools/`) for banned names as string literals. If you edit a `manifest.json`
  `icons{}` block, add no name-bearing comment or string.

---

## 0. Brand rationale recap

The Ziy mark is **a shield whose face is a sealed (closed, winking) eye**: the
"nothing leaks" promise as a single glyph. Flat, geometric, single-family, drawn
from straight chords and circular arcs on a 64-unit grid.

**Palette (the mark's only values — shield, toolbar icons, extension glyphs,
hicolor entries):**

| token | hex | role |
| --- | --- | --- |
| gloam teal (light) | `#0b6e6e` | primary fill, light surfaces |
| gloam teal (dark) | `#2dd4bf` | primary stroke/fill on dark surfaces |
| ink | `#202124` | glyph on light surfaces |
| surface / paper | `#fafafb` / `#ffffff` | glyph on dark fills, tile background |
| deep teal | `#08504f` | gradient floor of the shield |
| muted | `#5c5f66` | "off" state glyph |

**Never (for the mark):** violet, cobalt, or any cool accent outside the teal
family; any feline or animal silhouette; any browser's wordmark or letterform;
gradients outside the teal family; drop shadows in toolbar glyphs.

**The cat is exempt from the palette ban — co-owner decision 2026-10-15.** The
co-owner's own cat keeps its natural warm ginger palette exactly as their
reference has it, and that cat IS the app icon (`brand/ziy.png`, the master PNG
used as-is). The teal-only rule above binds the brand *mark*: the shield, the
toolbar icons, the extension glyphs and the hicolor entries — never the cat.
Full split in `brand/MASCOT.md` §"Palette policy".

**Rhythm:** 2px-equivalent stroke at 48px (≈4.17% of the size), round caps and
joins, 10% optical padding, all geometry on integers or half-integers so the
raster is crisp at 16, 32 and 96.

---

## 1. Inventory — what exists today (measured, not guessed)

### 1.1 The 8 extensions' icons

Every file below is a **Pillow-drawn algorithmic placeholder** (flat single
colour or two-colour blobs drawn with `ImageDraw` primitives — the ASCII renders
confirm it: vector-less rectangles, circles and polygons with anti-aliased but
keyline-free edges). None is a hand-drawn mark. Current state per extension:

| extension | files | sizes | what the placeholder actually is |
| --- | --- | --- | --- |
| `ziy-shell` | `icons/icon.svg`, `icons/icon-48.svg`, `icons/wordmark.svg` | SVG | **Design-phase brand, copy of `replica/design/brand/`** (sealed-eye shield). Dark-blue/violet era: CSS still references `--ziy-violet #4c2eff`, `--ziy-orange #ff6b35`, `--ziy-ink #0e0630`. |
| `ziy-shields` | `icons/shield-{16,32,48,96}.png`, `icons/shield-down-{16,32,48,96}.png` | 16/32/48/96 | plain-filled shield outline (up) / same outline in mid-grey (down). Two files, no keyline, no eye motif. |
| `ziy-news` | `icons/news-{16,32,48,96}.png` | 16/32/48/96 | a filled rectangle with a "feed" zigzag/rss-stack abstraction knocked out of it. |
| `ziy-talk` | `icons/talk-{16,32,48,96}.png` | 16/32/48/96 | a filled camera body (rounded rect + lens ring + viewfinder bump). |
| `ziy-playlist` | `icons/playlist-{16,32,48,96}.png` | 16/32/48/96 | a filled rounded rectangle with the left third solid (a play-list row abstraction). |
| `ziy-sync` | `icons/ziy-sync-{16,32,48,96}.png` | 16/32/48/96 | a filled rounded square with a chain-link glyph knocked out of it. |
| `ziy-desktop` | `icons/menu-{16,32,48,96}.png` | 16/32/48/96 | a filled circle with a hamburger (three bars) knocked out of it. |
| `ziy-ntp` | *(no `icons/` dir)* | — | **no icons at all**; the manifest points `icons` at `ui/icons/icon-48.svg` and `ui/icons/icon-96.svg`, which are near-copies of `replica/design/brand/icon-48.svg` / `icon-96.svg` (differing only in `<title>`, stroke 5 vs 4.8, and minor path offsets). No 16/32 raster exists — the NTP has no toolbar action, so nothing declares it. |

### 1.2 `shell/brand-fallback/` — the current fallback brand set

- `logo.svg` — a **different, pre-teal mark**: violet/navy shield (`#4C2EFF` → `#26118F` outline `#0E0630`) with an **orange `#FF6B35` lion-head glyph** inside. This is the shell's placeholder identity. It must be replaced, not extended.
- `render-icons.py` — the rasteriser the build calls. Two backends:
  - `cairosvg` (preferred): renders `SIZES = 16, 24, 32, 48, 64, 96, 128, 256` plus a 256px `logo.png`.
  - Pillow fallback: hard-codes the old violet/`#0E0630`/`#4C2EFF`/`#FF6B35` lion geometry on a 96-grid. **This is a trap for the new icons**: if cairosvg is missing on the co-owner's box, the Pillow path silently re-draws the old lion whatever `brand/logo.svg` says. Rasterise from the SVGs, or install cairosvg, before shipping.
  - Its source is `brand/logo.svg` when present, else `shell/brand-fallback/logo.svg`. `brand/` is currently empty (see 1.4).

### 1.3 `replica/design/brand/` — the design-phase brand

| file | content |
| --- | --- |
| `logo.svg` | 64-grid sealed-eye shield, teal gradient `#0b6e6e` → `#08504f`, white `.34`-opacity keyline, lid stroke `#f4f5f6` sw 3.4. **This is the current canonical mark.** |
| `wordmark.svg` | mark + `Ziy` in Inter 700, tracking −1.4, fill `#202124`. |
| `icon-16.svg` | 16-grid solid teal shield + single white keyline-safe lid. Toolbar/favicon use. |
| `icon-24.svg` | 24-grid variant for menus/panel headers. |
| `icon-48.svg` | 48-grid rounded-11px teal tile + outlined mark. |
| `icon-96.svg` | 96-grid rounded-22px teal tile + outlined mark. |
| `colors.md` | palette + rationale + the "no traced asset" declaration. |

`replica/design/tokens.css` and `tokens.json` exist but carry **UI tokens, not
icon assets** — do not treat them as icon sources.

### 1.4 Every `manifest.json` `icons{}` key

Firefox MV3 rules that bind these:

- `icons` (top level, the AMO/store listing): **48 is the required minimum**; 96 is conventional, 128 is store-preferred.
- `action.default_icon` (toolbar): **16 and 32** are the pair Firefox loads;
  48/96 in that key are accepted and used by some surfaces but ignored by the
  toolbar renderer.
- sidebar-only extensions need no `action` key at all.

| extension | top-level `icons{}` | `action.default_icon` | gaps |
| --- | --- | --- | --- |
| `ziy-shell` | *(none — no `icons{}`, no `action`)* | — | manifest declares no icon; the shell is the app-dir theme extension. No change required unless a toolbar/menu entry is wanted. |
| `ziy-shields` | 16/32/48/96 | 16/32/48/96 | complete. `shield-down-*` are **files only, referenced by nothing** — no manifest key, no `browser.action.setIcon` call anywhere in shipped code. |
| `ziy-news` | 16/32/48/96 | — (sidebar_action only) | complete. |
| `ziy-talk` | 16/32/48/96 | — (sidebar_action only) | complete. |
| `ziy-playlist` | 16/32/48/96 | 16/32/48/96 | complete. |
| `ziy-sync` | 16/32/48/96 | 16/32/48/96 | complete. Files are named `ziy-sync-*.png` (with the `ziy-` prefix); every other extension drops it. Rename for consistency or keep — either way the manifest must match. |
| `ziy-desktop` | 16/32/48/96 | 16/32/48/96 | complete. |
| `ziy-ntp` | 48/96 (SVG) | — | **no rasters at all**, and the SVG paths are stale copies. Needs `icon-16/32/48/96` rasters or SVG parity with the design set. |

### 1.5 Desktop entry + XDG icon tree

- `shell/ziy.desktop` has `Icon=ziy`. The name resolves through
  `~/.local/share/icons/hicolor/<size>/apps/ziy.png`, and through
  `hicolor/scalable/apps/ziy.svg` when installed.
- `tools/install-desktop.sh` installs **exactly** these sizes (it walks each
  `<size>x<size>/apps` slot and reports per-slot success), validated by
  `replica/proofs-desktop.md` §3:

  **16, 22, 24, 32, 48, 64, 96, 128, 256** (plus `scalable/apps/ziy.svg`).

- `install-desktop.sh` **resamples a mismatched source with a `warn`** into the
  slot's pixel size — `replica/proofs-desktop.md` §3.2 records the 22x22 slot
  once holding a 256px image and being resampled. The new set must ship true
  pixel-per-size PNGs so no warn is emitted and the proof stays clean.
- Two source layouts are accepted: hicolor `<size>x<size>/apps/ziy.png` (what
  `build-shell.sh` writes into `build/share/icons/hicolor/`) or a flat dir of
  `logo-<size>.png` (`logo.png` = 256). `render-icons.py` writes the flat form.
- `shell/chrome/userChrome.css` line 77 brands the app-menu button from
  `chrome://branding/content/icon16.png` — that is the **app-dir** icon, not a
  brand PNG; it is satisfied by `render-icons.py` output and needs no new file,
  but the mark it draws is the fallback lion until `brand/logo.svg` lands.

### 1.6 The paths the build already reads (do not invent new ones)

| path | written by | consumed by |
| --- | --- | --- |
| `brand/logo.svg` | **co-owner (new)** | `build-shell.sh` prefers it for `chrome/icons/default/ziy.svg` + `ziy.png`; `render-icons.py` picks it as its SVG source |
| `brand/logo-<size>.png` | rasterised from `logo.svg` | `build-shell.sh` §10 copies to `build/share/icons/hicolor/<size>x<size>/apps/ziy.png` |
| `build/share/icons/hicolor/**` | `build-shell.sh` | `install-desktop.sh` (primary source) |
| `extensions/<id>/icons/*.png` | placeholders today | each `manifest.json` `icons{}` / `action.default_icon` |
| `replica/design/brand/*.svg` | design phase | reference; `verify.sh` scans these for banned names |

`brand/` is currently **empty** — nothing exists there yet. Everything the
co-owner lands there is additive; no placeholder is deleted.

---

## 2. Master inventory

Sizes are *named* where an existing key binds them. "Raster" = PNG at each
listed size; "SVG" = master source.

| id | icon | used by | states / variants | sizes required | file target path | placeholder today? |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | App icon — `ziy.png` master | `.desktop` entry, taskbar, window, About, store | light, dark, inactive (see A2) | **16, 22, 24, 32, 48, 64, 96, 128, 256** rasters + scalable SVG | `brand/logo.svg`, `brand/logo-{16,22,24,32,48,64,96,128,256}.png` → installed as `hicolor/<size>x<size>/apps/ziy.png` | yes — violet lion `shell/brand-fallback/logo.svg` |
| A2 | App icon — dark/inactive variants | window + taskbar on dark themes | dark-on-light, dark-on-dark, inactive (desaturated, no eye) | 16, 22, 24, 32, 48, 64, 96, 128, 256 | `brand/logo-dark.svg`, `brand/logo-inactive.svg` + rasters | no — none exist |
| B1 | Toolbar/window icon set | toolbar buttons, menu, titlebar | light, dark, inactive for the two token themes | 16, 32 (toolbar pair); 24 (menu) | `extensions/ziy-shell/icons/icon-{16,32,24}.svg`, `…-dark.svg`, `…-inactive.svg` + `_light.svg` | yes — violet-era SVGs + CSS vars |
| C0 | Extension master glyph (8 glyphs on one 48-grid) | all 8 extensions | — | 48 master + 16/32/48/96 | `extensions/<id>/icons/glyph-48.svg` | yes (Pillow blobs) |
| C1 | Shields glyph | `ziy-shields` | — | 16/32/48/96 | `extensions/ziy-shields/icons/shield-{16,32,48,96}.png` + `glyph-48.svg` | yes |
| C2 | Shields — up state | `ziy-shields` action | **shields up** (filled/armored) | 16/32/48/96 | `extensions/ziy-shields/icons/shield-{16,32,48,96}.png` | yes |
| C3 | Shields — down state | `ziy-shields` action | **shields down** (greyed/armor-off) | 16/32/48/96 | `extensions/ziy-shields/icons/shield-down-{16,32,48,96}.png` | yes |
| C4 | Shields — per-site / counting variant | `ziy-shields` popup + per-site override surfaces | small counting badge variant (shield + count slot) | 16, 32 | `extensions/ziy-shields/icons/shield-count-{16,32}.png` | **no — does not exist.** `shield-count` is referenced by nothing yet; see §5 |
| C5 | News glyph | `ziy-news` sidebar | — | 16/32/48/96 | `extensions/ziy-news/icons/news-{16,32,48,96}.png` + `glyph-48.svg` | yes |
| C6 | Talk glyph (camera) | `ziy-talk` sidebar | — | 16/32/48/96 | `extensions/ziy-talk/icons/talk-{16,32,48,96}.png` + `glyph-48.svg` | yes |
| C7 | Playlist glyph (play/queue) | `ziy-playlist` action + sidebar | play, queue | 16/32/48/96 | `extensions/ziy-playlist/icons/playlist-{16,32,48,96}.png`, `playlist-play-{16,32}.png`, `playlist-queue-{16,32}.png` + `glyph-48.svg` | yes (play only; queue missing) |
| C8 | Sync glyph (chain/link) | `ziy-sync` action | idle, syncing, error | 16/32/48/96 | `extensions/ziy-sync/icons/ziy-sync-{16,32,48,96}.png` (+ `-syncing`, `-error` later) + `glyph-48.svg` | yes |
| C9 | Desktop menu glyph | `ziy-desktop` action | — | 16/32/48/96 | `extensions/ziy-desktop/icons/menu-{16,32,48,96}.png` + `glyph-48.svg` | yes |
| C10 | NTP glyph | `ziy-ntp` | — | 16/32/48/96 | `extensions/ziy-ntp/icons/icon-{16,32,48,96}.png` (new dir; manifest `icons{}` points at `ui/icons/` today) | partially — stale SVG copies |
| D1 | Wordmark — horizontal lockup | About, splash, first-run, marketing | light on light, mono on dark | SVG + 512/1024 PNG | `brand/wordmark.svg`, `brand/wordmark-mono.svg` | yes (design-phase) |
| D2 | Wordmark — stacked lockup | About sheet, splash, store listing | light, mono | SVG + 512/1024 PNG | `brand/wordmark-stacked.svg`, `brand/wordmark-stacked-mono.svg` | no |
| D3 | Wordmark — mono (for dark backgrounds) | dark theme About, dark titlebar | — | SVG + 512 PNG | `brand/wordmark-mono.svg` | no |

Counts: **17 icon ids** (A1, A2, B1, C1–C10, D1–D3) from **7 categories**
(brand app icon, toolbar set, extension glyphs, shields states, feature glyphs,
wordmark lockups, per-extension masters).

---

## 3. Generation checklist — one prompt per icon

Clean-room constraint (top of this doc) applies to every prompt below: no
competitor name, mark, silhouette, animal, colour family or typography in any
prompt, filename, `<title>` or `aria-label` of the asset it produces.

Send one prompt at a time, in the order of §6, save the image into the named
target path, tick the entry. Each prompt is self-contained: style, subject,
geometry, palette, background, composition, lighting, what to avoid, and the
corner/border behaviour are all inside it. The saved image is a sketch — the
**vector stub** under each prompt (stroke weights, radii, grid, proportions) is
what gets rebuilt by hand as clean SVG, and the shipped PNG is rasterised from
that SVG.

Rules baked into every prompt:

- **One icon per prompt:** a single centered icon. No grid of options, no
  mockup, no multiple icons, no surrounding UI, no device frames, no text
  labels. D1–D3 are the only exception — their letterforms *are* the icon.
- **Plain white background, not transparent:** image models cannot do reliable
  alpha, so every prompt asks for white. Prompt padding is generous (15–20%);
  the shipped vector still keeps the 10% safe inset of §4.6 — crop the white,
  never scale the mark up to fill.
- **Flat vector look:** no drop shadows, no outer glow, no outline halo, no
  gradients outside the teal family. Corners are sharp except where the prompt
  names a rounded tile.
- **Palette is exactly** `#0b6e6e` / `#2dd4bf` / `#202124` / `#fafafb` (+
  `#08504f` floor, `#5c5f66` muted) for the mark. **The cat is the exception**
  (co-owner decision 2026-10-15): A1 is the co-owner's own cat in its own
  natural ginger palette, and it keeps those colours exactly as their reference
  has them — no recolour.

### A1 — App icon master (light) — the co-owner's cat

- **Place at:** `brand/ziy.png` (the co-owner's master PNG, byte copy) · `brand/logo.svg` (the base64 `<image>` passthrough) · rasters `brand/logo-{16,22,24,32,48,64,96,128,256}.png` and `brand/ziy.png` → installed as `hicolor/<size>x<size>/apps/ziy.png`
- [ ] sent · [ ] placed · [ ] passthrough installed · [ ] every size slot byte-identical to the master

**Prompt** (see `replica/design/icon-prompts/01-app-icon.md` for the full text)

> Using the attached cat image as the subject reference, generate a single centered flat illustration of that same cat: keep its exact character, head-on pose, upright triangular ears, low-poly geometric facet language, amber eyes and white chin bib, and keep the cat's natural ginger/orange palette exactly as the reference has it — do not recolour. Keep the facets flat and geometric — sharp polygon edges, no soft shading, no gradients, no drop shadow, no outer glow, no outline halo, no tile, no rounded-square background, no text or letters. Transparent background: nothing around the cat, no floor, no shadow on the ground. The cat fills about 86% of the frame with 7% pad. One icon only — not a grid of options, not a mockup, no surrounding UI.

**Placement is a byte copy, not a redraw** (co-owner decision 2026-10-15): `cp replica/design/app_icon.png brand/ziy.png` and the same bytes into every `brand/logo-<size>.png`; `brand/logo.svg` is the same PNG embedded base64 as one `<image>` so the SVG slot matches the PNG slots. The shield is not deleted — it stays the shields-extension toolbar icon and the browser-chrome mark (§2 rows B1, C1–C4).

### A2 — App icon dark / inactive

- **Place at:** `brand/logo-dark.svg`, `brand/logo-inactive.svg` (both the same base64 cat passthrough as `logo.svg`) + rasters `brand/logo-dark-{16,22,24,32,48,64,96,128,256}.png`, `brand/logo-inactive-{…}.png` (identical bytes to the master, same as the light set)
- [ ] sent · [ ] placed · [ ] byte-identical to the master

The cat's own art is already surface-agnostic: real alpha, warm colours that read
on both `#fafafb` and `#17181a`, no baked tile. So the dark and inactive slots
carry the same master bytes rather than an outline redraw. The *grey inactive*
treatment stays where it semantically belongs: the toolbar/glyph set (B1, C3).

### B1 — Toolbar / window icon set (16, 32, 24)

- **Place at:** `extensions/ziy-shell/icons/icon-16.svg`, `icon-24.svg`, `icon-32.svg` (+ `-dark`, `-inactive`, `-light` variants)
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector toolbar icon on a plain white background: a solid geometric shield silhouette whose face carries the sealed closed-eye motif reduced to two parallel swallow-tail strokes. Deep teal `#0b6e6e` fill with white `#fafafb` eye strokes for the light theme; glow teal `#2dd4bf` fill for the dark theme; 70%-opacity grey `#5c5f66` for the inactive state. 20% padding, no rounded tile, no grain, no drop shadow, no glow, no halo, no text, no animal shapes. Must stay crisp at 16px. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 16-grid solid shield `M8 1 14 2.7v5.1c0 4-3.1 6.8-6 8.2C5.1 14.6 2 11.8 2 7.8V2.7L8 1Z`; lid sw 1.15 white; drop keyline under 32px. 24 and 32 are the same geometry scaled; do not re-draw.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C1/C2 — Shields glyph, shields **up** (filled / armored)

- **Place at:** `extensions/ziy-shields/icons/glyph-48.svg` (master) · `extensions/ziy-shields/icons/shield-{16,32,48,96}.png`
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector icon on a plain white background: an armoured shield — flat-topped geometric shield with a sealed closed eye on its face — solid deep teal `#0b6e6e` with the eye in off-white `#fafafb` and one central armour seam line, reads as "protected and holding". 18% padding, sharp corners, soft even lighting, no drop shadow, no glow, no outline halo, no text, no animal or beast motif, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 48-grid; A1 shield scaled to 48 (fill `#0b6e6e`), lid sw 2.5 white, seam as one white 34% stroke sw 1.8 at the keyline radius. 16/32/96 are the same drawing scaled; 96 adds the seam only.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C3 — Shields **down** (greyed / armor-off)

- **Place at:** `extensions/ziy-shields/icons/shield-down-{16,32,48,96}.png`
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector icon on a plain white background: the same armoured shield with sealed closed eye, but "armour off" — flat muted grey `#5c5f66` fill, the eye hollowed to a thin off-white `#fafafb` keyline pair, no armour seam, so it reads open. Identical geometry, centre and padding to the shields-up icon. No red, no X, no warning triangle, no warm accent. 18% padding, sharp corners, soft even lighting, no drop shadow, no glow, no halo, no text, no animal shapes. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** Same 48-grid path as C2 with fill `#5c5f66`, seam removed, lid sw 1.6 `#fafafb` at 100% so the closed eye survives as a line pair. Pairs with C2 at identical footprint.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C4 — Shields per-site / counting variant

- **Place at:** `extensions/ziy-shields/icons/shield-count-16.png`, `shield-count-32.png`
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector badge icon on a plain white background: the small armoured sealed-eye shield, solid deep teal `#0b6e6e`, with one rounded white pill slot at its lower-right corner outlined in teal — the pill stays empty, no number drawn. 20% padding, sharp shield corners, soft even lighting, no drop shadow, no glow, no halo, no text or digits inside, no animal shapes, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 16/32 only. 16-grid: shield at 12 units inset 2, pill 9×5 at corner (14,13) r 1.5, sw 1. Number is set in the UI layer, not the icon — the icon ships the empty slot so any glyph updates without a new render.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C5 — News glyph (feed)

- **Place at:** `extensions/ziy-news/icons/glyph-48.svg` (master) · `extensions/ziy-news/icons/news-{16,32,48,96}.png`
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector icon on a plain white background: a news-feed abstraction — one rounded-rectangle sheet in deep teal `#0b6e6e` holding three horizontal off-white `#fafafb` lines (two long, one short), plus a small circular emission node at the top-left corner radiating one short arc. Geometric, symmetric, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text or readable letters, no animal shapes, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 48-grid; sheet rect x6 y10 w36 h28 r3; lines sw 2 white, widths 22/22/14; node r 2.5 at (12,8) plus arc `M15 6a6 6 0 0 1 6 4` sw 1.6. At 16px drop to sheet + 2 lines.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C6 — Talk glyph (camera)

- **Place at:** `extensions/ziy-talk/icons/glyph-48.svg` (master) · `extensions/ziy-talk/icons/talk-{16,32,48,96}.png`
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector icon on a plain white background: a video-call camera abstraction — rounded-rectangle body in deep teal `#0b6e6e` with a circular off-white `#fafafb` lens ring in its centre and a wedge viewfinder bump pointing right. Geometric, symmetric, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text, no face, no animal or human features, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 48-grid; body rect x6 y14 w28 h20 r4; lens circle c (20,24) r 6.5 stroke sw 2.4 white fill none; wedge `M34 18l8-4v16l-8-4Z` fill `#0b6e6e`; all joins round.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C7 — Playlist glyph (play / queue)

- **Place at:** `extensions/ziy-playlist/icons/glyph-48.svg` (master) · `extensions/ziy-playlist/icons/playlist-{16,32,48,96}.png`, `playlist-play-{16,32}.png`, `playlist-queue-{16,32}.png`
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector icon on a plain white background: a media queue abstraction — three stacked rounded rows in deep teal `#0b6e6e`, the top row holding one solid right-pointing triangle in off-white `#fafafb` (play), the two lower rows holding short bars. The queue variant: three equal rows, each with a right-pointing chevron at its right edge. Geometric, even spacing, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text or readable letters, no animal shapes, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 48-grid; rows r2 h8 at y8/20/32, x6→42; play triangle `M20 12l10 6-10 6Z` white; queue chevron `M34 20l4 4-4 4` sw 2 round. 16px: two rows + triangle only.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C8 — Sync glyph (chain / link)

- **Place at:** `extensions/ziy-sync/icons/glyph-48.svg` (master) · `extensions/ziy-sync/icons/ziy-sync-{16,32,48,96}.png` (keep the `ziy-` prefix — that stem is what the manifest names; `-syncing`/`-error` are animation states, not new art)
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector icon on a plain white background: a link/chain abstraction — two interlocking rings outlined in deep teal `#0b6e6e`, lying on a horizontal axis, with a small teal dot at each joint; the overlap reads cleanly. Geometric, symmetric, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text, no animal shapes, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 48-grid; two r7 circles c (18,24) and (30,24), stroke sw 3, fill none, `#0b6e6e`; overlap knocked out with a 2px `#fafafb` band for legibility; joint dots r 1.6. Syncing/error variants are animation, not new art.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C9 — Desktop menu glyph

- **Place at:** `extensions/ziy-desktop/icons/glyph-48.svg` (master) · `extensions/ziy-desktop/icons/menu-{16,32,48,96}.png`
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector icon on a plain white background: three equal horizontal bars in deep teal `#0b6e6e`, stacked with generous even gaps, round caps, no enclosing shape behind them. Extreme legibility at 16px. 20% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text, no animal shapes, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 48-grid; bars sw 3.2, width 20, at y18/24/30, x14→34, round caps; no enclosing circle (the placeholder's circle disappears — the bars alone are the mark).

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### C10 — NTP glyph

- **Place at:** `extensions/ziy-ntp/icons/icon-{16,32,48,96}.png` (new dir), or the two stale SVGs `extensions/ziy-ntp/ui/icons/icon-{48,96}.svg` — then fix the manifest's `icons{}` either way
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector icon on a plain white background: a new-tab abstraction — one rounded-square outline in deep teal `#0b6e6e` with a solid teal plus sign centred inside it, nothing else. Geometric, symmetric, 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no text or letters, no animal shapes, no warm accent. One icon only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 48-grid; tile x8 y8 w32 h32 r7 stroke sw 3; plus: h-bar y24 x17→31, v-bar x24 y17→31, sw 3.4 round caps. This replaces the two stale SVG copies currently in `ui/icons/`.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### D1 — Wordmark, horizontal lockup

- **Place at:** `brand/wordmark.svg`, `brand/wordmark-mono.svg` (+ `wordmark-512.png`, `wordmark-1024.png`)
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector horizontal lockup on a plain white background: the geometric sealed-eye shield mark at left, then the three-letter wordmark "Ziy" in a geometric sans-serif, bold, tight negative letter-spacing, ink `#202124`, sharing one baseline and one cap-height rule with the mark. The mono variant: mark and letters all off-white `#fafafb`. 18% padding, sharp corners, no tile, soft even lighting, flat, no drop shadow, no glow, no halo, no other words or text, no animal shapes, no warm accent. One lockup only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 64-tall grid; mark occupies 0–64 at scale 0.8125 translate(2 6); text x 70, baseline y 45, font Inter 700 / fallback geometric sans, size 40, tracking −1.4. Mono variant: text and mark both `#fafafb`.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### D2 — Wordmark, stacked lockup

- **Place at:** `brand/wordmark-stacked.svg`, `brand/wordmark-stacked-mono.svg` (+ `wordmark-stacked-512.png`, `wordmark-stacked-1024.png`)
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector stacked lockup on a plain white background: the geometric sealed-eye shield mark centred above the three-letter wordmark "Ziy", both on one optical centre line with an even gap about a fifth of the mark height. Wordmark in a geometric sans-serif, bold, tight negative letter-spacing, ink `#202124`. Mono variant: mark and letters all off-white `#fafafb`. Nearly square canvas, 20% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no other words or text, no animal shapes, no warm accent. One lockup only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** 96-wide canvas; mark 48 units centred at y 6→54; text baseline y 78, size 30, tracking −1.0, centred. Mono: both `#fafafb`.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

### D3 — Wordmark, mono (for dark backgrounds)

- **Place at:** `brand/wordmark-mono.svg` (+ `wordmark-mono-512.png`)
- [ ] sent · [ ] placed · [ ] rebuilt as SVG · [ ] rasterised

**Prompt**

> Generate a single centered flat vector horizontal lockup on a plain white background: the geometric sealed-eye shield mark at left followed by the three-letter wordmark "Ziy", but every stroke and letterform in one flat off-white `#fafafb`, zero gradient, sharing one baseline and cap-height rule, so it reads on near-black and dark teal surfaces. 18% padding, soft even lighting, flat, no drop shadow, no glow, no halo, no other words or text, no animal shapes, no warm accent, no second colour anywhere. One lockup only — not a grid, not a mockup, no surrounding UI.

**Vector stub.** Single `fill="#fafafb"` group over the D1 geometry; check `#fafafb` on `#202124` ≈ 15.9:1 — no second value needed.

*White background: remove on import, or recreate as SVG; the master is the vector form.*

---

## 3.1 Where to place the files

Every folder below already exists with a `README.md` inside it. Drop the
finished asset in; nothing else needs editing except where a manifest key is
named. Replace the placeholder 1:1, don't delete anything else.

| folder | status | filenames that belong there |
| --- | --- | --- |
| `brand/` | **created** | `logo.svg`, `logo-{16,22,24,32,48,64,96,128,256}.png`, `ziy.png` (256), `logo-dark.svg`, `logo-inactive.svg`, `wordmark*.svg` |
| `replica/design/brand/` | existed (design-phase set) | reference masters only: `logo.svg`, `wordmark.svg`, `icon-{16,24,48,96}.svg` |
| `extensions/ziy-shell/icons/` | existed | `icon-{16,24,32}.svg` (+ `-dark`, `-inactive`, `-light`) |
| `extensions/ziy-shields/icons/` | existed | `shield-{16,32,48,96}.png`, `shield-down-{16,32,48,96}.png`, `shield-count-{16,32}.png`, `glyph-48.svg` |
| `extensions/ziy-news/icons/` | existed | `news-{16,32,48,96}.png`, `glyph-48.svg` |
| `extensions/ziy-talk/icons/` | existed | `talk-{16,32,48,96}.png`, `glyph-48.svg` |
| `extensions/ziy-playlist/icons/` | existed | `playlist-{16,32,48,96}.png`, `playlist-play-{16,32}.png`, `playlist-queue-{16,32}.png`, `glyph-48.svg` |
| `extensions/ziy-sync/icons/` | existed | `ziy-sync-{16,32,48,96}.png`, `glyph-48.svg` (keep the `ziy-` stem) |
| `extensions/ziy-desktop/icons/` | existed | `menu-{16,32,48,96}.png`, `glyph-48.svg` |
| `extensions/ziy-ntp/icons/` | **created** | `icon-{16,32,48,96}.png` |
| `extensions/ziy-ntp/ui/icons/` | existed (manifest target today) | the stale `icon-48.svg` / `icon-96.svg` — replace 1:1 or supersede via `icons/` + a manifest edit |

**The app icon the build actually reads** — there is no `shell/icons/` dir and
none is needed; the source of truth is the repo-root `brand/`:

- `tools/build-shell.sh:114-122` — `BRAND_SRC="$ROOT/brand"`; if `brand/logo.svg`
  exists it becomes `ICON_SOURCE` and is installed as
  `chrome/icons/default/ziy.svg`, else the violet lion fallback is used
  (`shell/brand-fallback/logo.svg`, line 118).
- `tools/build-shell.sh:255-259` — `chrome/icons/default/logo-<size>.png` (the
  output of `shell/brand-fallback/render-icons.py`, whose `BRAND_SVG` is
  `brand/logo.svg` at `shell/brand-fallback/render-icons.py:22`) is copied into
  `build/share/icons/hicolor/<size>x<size>/apps/ziy.png`.
- `tools/install-desktop.sh:77-85` then installs that hicolor tree into
  `~/.local/share/icons/hicolor/<size>/apps/ziy.png` and
  `hicolor/scalable/apps/ziy.svg`.

So: land the mark as `brand/logo.svg`, land rasters as `brand/logo-<size>.png`,
and rasterise from the SVG with `render-icons.py` (cairosvg present) — never the
Pillow fallback, which redraws the lion regardless of the SVG.

---

## 4. Technical acceptance per icon

Applies to every row in §2. Each check is a **state-the-check** instruction, not
a claim of passing — the co-owner runs it.

1. **Format.** Master is SVG (`viewBox` square, `role="img"`, inline `<title>`,
   `aria-label`); shipped rasters are **PNG with alpha** at exactly the pixel
   sizes the target slot names. No JPEG, no WebP, no ICO without a PNG beside it.
2. **Transparent background.** Corner pixels are `rgba(0,0,0,0)`. The app-icon
   *tile* variants (48/96) may carry the rounded teal tile; every toolbar glyph
   and the scalable mark must be fully transparent outside the geometry.
3. **Pixel-per-size.** Each hicolor slot holds its own native size. A single
   256px source copied into all slots is rejected: `install-desktop.sh`
   **resamples it with a `warn`** and writes the mismatch into its
   "could not do" report (`replica/proofs-desktop.md` §3.2 is the precedent).
4. **Minimum stroke contrast at 16px.** Visual check at 100% zoom on a
   `#fafafb` **and** a `#202124` surface: every stroke must stay
   distinguishable, not grey-on-grey. Rule: at 16px, no stroke may be thinner
   than 1 unit of its grid and no detail smaller than ~4% of the canvas. If the
   eye lid closes to a smudge at 16px, drop the keyline and lid-dot (see B1's
   construction note) rather than thinning the lid.
5. **Icon contrast on both surfaces.** ≥3:1 against the surface it sits on for
   glyphs carrying meaning (states C2 vs C3 must differ from each other **and**
   from the toolbar background at ≥3:1 each). Non-meaning decoration may be
   lower, but must never be the only thing distinguishing a state.
6. **Safe padding.** 10% inset on all four sides (at 16px: 1.6px; at 256px:
   25.6px). The mark's optical bounding box, not the SVG box, defines the inset.
7. **Optical centring.** Geometry centred on the *visual* centre: a shield's
   point pulls the eye down, so nudge the drawing up by ~1 grid unit at 64
   (the current `logo.svg` guards this with `translate(2 6)` in the wordmark).
8. **Corner behaviour.** Toolbar glyphs and the scalable mark: **sharp**,
   no tile. App-icon PNGs at 48/96 (and 128/256 where a tile is wanted):
   rounded tile (r ≈ 11 at 48, ≈ 22 at 96, ≈ 23% of size). Wordmark lockups:
   sharp, transparent.
9. **Clean-room guard.** No competitor name, mark, silhouette or trade dress in
   any `<title>`, `aria-label`, comment, or filename. `tools/verify.sh` greps
   the `replica/design/brand/` and `brand/` SVGs; `cleanroom-scan.py` greps
   shipped code (so `manifest.json` `icons{}` edits must stay name-free).

---

## 5. How the build picks them up

Exact target paths — **nothing new is needed in the build scripts**; the
co-owner replaces files 1:1 or adds new files the manifests/manifest keys
already expect.

### 5.1 App icon (desktop + taskbar + window)

| target | who reads it | what happens |
| --- | --- | --- |
| `brand/logo.svg` | `build-shell.sh` §5 prefers it over `shell/brand-fallback/logo.svg`; installs as `chrome/icons/default/ziy.svg` | the mark the app menu button and About page draw |
| `brand/logo-<size>.png` (16,22,24,32,48,64,96,128,256) | `build-shell.sh` §10 → `build/share/icons/hicolor/<size>x<size>/apps/ziy.png` | the XDG tree `install-desktop.sh` installs |
| `brand/ziy.png` (256) | `render-icons.py` writes the largest render; `build-shell.sh` installs it as the app dir's `ziy.png` | window icon fallback |
| `shell/brand-fallback/logo.svg` | fallback when `brand/logo.svg` is absent | **leave in place**; it is only used when `brand/` is empty |
| `~/.local/share/icons/hicolor/{16,22,24,32,48,64,96,128,256}x<size>/apps/ziy.png` + `hicolor/scalable/apps/ziy.svg` | `tools/install-desktop.sh` | launcher, taskbar, alt-tab, dock |

**Rasterisation trap:** `render-icons.py`'s Pillow fallback hard-codes the old
violet/orange lion geometry and ignores `brand/logo.svg`. Rasterise with
cairosvg (or any SVG rasteriser) directly from the new `logo.svg`; do not rely
on the Pillow path.

### 5.2 Toolbar / window set

`extensions/ziy-shell/icons/` is the shell extension's icon dir; its manifest
declares no `icons{}` today. If the shell grows a toolbar/action entry, add:

```json
"action": { "default_icon": { "16": "icons/icon-16.png",
                              "32": "icons/icon-32.png" } }
```

The dark/inactive variants are selected at runtime by
`browser.action.setIcon({path})` from `background/background.js` when a change
lands — nothing needs a new manifest key for them, only the files.

### 5.3 Extension toolbar icons

Flat convention for all eight: `extensions/<id>/icons/<stem>-<size>.png`,
`<stem>` = the existing filename stem (keep `ziy-sync` for `ziy-sync`, use
`icon` if the NTP's new dir is `icons/`). Sizes: **16, 32, 48, 96**.

- `ziy-shields` — `shield-*` (up) and `shield-down-*` (down) already exist in
  the manifest path convention and are consumed by `action.default_icon` +
  `icons{}`. `shield-count-*` is new: it is **not yet referenced**. To wire it,
  add to `action.default_icon` and call `browser.action.setIcon` from
  `background/background.js` on per-site overrides (the per-site write path at
  `extensions/ziy-shields/background/background.js:194` already stores the
  override). Until then it is a reserve asset.
- `ziy-ntp` — currently points at `ui/icons/icon-{48,96}.svg`. Either replace
  those two SVGs with the new drawing, or move to `icons/icon-<size>.png` and
  update the manifest's `icons{}` to `"16": "icons/icon-16.png"` etc. Both are
  manifest edits, not build changes.
- All other extensions: replace the PNG bytes in place; no manifest edit.

### 5.4 The no-delete rule

**No file may be deleted by hand.** The real icons replace placeholders **1:1**
at the same path. `render-icons.py`, `build-shell.sh` and `install-desktop.sh`
all select by *existence*, so an added `brand/logo.svg` supersedes the fallback
automatically and an added extension PNG supersedes its placeholder the moment
it overwrites the same filename. Rows that do not exist yet (A2 dark/inactive,
C4 count, C7 queue, D2/D3 lockups, C10 rasters) are pure additions.

---

## 6. Generation order

Send the §3 prompts in this order; tick each entry in §3 as you go. Dependency
order: **everything derives from the shield**, so the mark lands first and the
glyphs are cut from its geometry.

| # | batch | ids | prompts | why here |
| --- | --- | --- | --- | --- |
| 1 | **Brand mark** — master shield + horizontal wordmark | A1, D1 | 2 | every other icon reuses its shield path, lid stroke and teal pair |
| 2 | **App icon rasters** — all nine sizes + scalable | A1 | 0 (rasterise) | the shell and desktop integration stop showing the lion fallback |
| 3 | **Toolbar set** — 16/32/24, light/dark/inactive | B1 | 1 | the most-seen surface; establishes the small-size simplifications |
| 4 | **The 8 extension glyphs** — one 48-grid master each, then rasters | C1/C2, C5, C6, C7, C8, C9, C10 | 7 | each glyph is independent once B1 fixes the stroke rhythm |
| 5 | **Shields states** — down, per-site/count | C3, C4 | 2 | states derive from the glyph; they must pair frame-for-frame |
| 6 | **Wordmark lockups** — stacked, mono | D2, D3 | 2 | derived from D1, needed for About/store once the mark is frozen |
| 7 | **App icon variants** — dark, inactive | A2 | 1 | last, so they pair against the final A1 geometry |
| 8 | **Rasterisation pass** — regenerate all PNGs from final SVGs at 1×/2×/3× | all | 0 (rasterise) | one command, one rasteriser, one day: no hand-traced edges |

**Totals: 15 prompts** across §3 (A1, A2, B1, C1/C2, C3–C10, D1–D3) +
2 rasterisation passes (batches 2 and 8). `replica/design/brand/` contributes 5
design-phase SVGs as reference masters only — they are not prompts.
