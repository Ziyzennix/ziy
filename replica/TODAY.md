# TODAY.md — the delta for the next Ziy session

**Written:** 2026-10-16 (end of day) · **Reads after:** `replica/HANDOFF.md` (yesterday's
baseline) and `replica/AI-BRIEF.md`. This file is the DELTA only — the baseline sections in
HANDOFF are not repeated here.

---

## 1. TODAY'S WINS

- **Chrome redesign shipped and gated.** `shell/chrome/userChrome.css` rewritten to the shipped
  gloam-teal tokens (`--focus: #0b6e6e`; zero occurrences of the retired violet/orange hexes —
  `grep -c '4c2eff\|ff6b35'` → 0), with dark mode on the engine's real selector
  `:root[lwt-toolbar="dark"]`. `shell/chrome/ziy-menu.svg` is the app-menu icon, resolved via a
  relative `url("ziy-menu.svg")` (the seal-eye shield, not the cat, not Mozilla's 722 B glyph).
  `shell/chrome/userContent.css` rewritten against the engine's **real** token names.
  Proof: `replica/proofs-chrome-redesign.md` (§1 palette, §5 menu icon, §9.4 tokens).
- **Searches-policy fix.** `shell/policies-gen.py`'s `SearchEngines` no longer removes engines
  the onboarding catalog offers (`DuckDuckGo`/`Bing` dropped from `Remove`; `Amazon.com`/`eBay`
  kept; `Default`/`DefaultPrivate: "Google"` added). A user's onboarding pick no longer silently
  falls back to the default. Proof: `replica/proofs-chrome-redesign.md` §9.2.
- **Android verdict — GeckoView + Kotlin, Flutter REJECTED.** `replica/research-android.md`:
  `webview_flutter` is backed by the system WebView = Chromium (the engine we rejected), no
  maintained Mozilla Flutter×GeckoView bridge exists (the one third-party bridge is pre-1.0),
  so the app shell is Kotlin. Spec only — nothing was run on Android.
- **Test numbers, measured today:**
  - `npm test` → **673 tests, 673 pass, 0 fail** (run live just now; `replica/AGENTS.md:307`
    still records the stale 628 — update it).
  - `node --test server/test` → **16** (`AGENTS.md:323`; `replica/proofs-fix-events.md:557`).
  - `node --test native/ziy-pwd/test` → **35** (`AGENTS.md:324`).
  - `bash replica/test/regressions.sh all` → **10 passed, 0 failed, 0 blocked**
    (recorded in `replica/HANDOFF.md` §3 — the authoritative live verdict; supersedes
    `test-report.md`'s old 5/4/0).
  - `./tools/verify.sh` → **48 passed, 0 failed, 2 skipped**, exit 0, on the rebuilt tree
    (`replica/deploy.md` §3, re-measured 2026-10-16).

## 2. IN FLIGHT RIGHT NOW — four live workers, do NOT restart any

- **settle-gate — LANDED, verify it.** The rebuild (`build/ziy/` mtime 2026-10-16 00:36) and the
  three stale-doc corrections are on disk: `replica/HANDOFF.md` (00:50), `replica/deploy.md`
  (00:51), `replica/AI-BRIEF.md` (00:51) — the last carries the `> 2026-10-16 correction` block
  (two commits, not one) and the new `48/0/2` gate row.
- **firefox-hate — LANDED, verify it.** `replica/research-firefox-hate.md` (00:54) — ranked
  user-hate themes from a 880-comment corpus + the 204 Firefox-mentioning rows of
  `replica/reviews.csv`. Raw cache in `replica/research-cache/`.
- **native-expand — IN FLIGHT.** `replica/native-expansion.md` is **not on disk**. Do not
  restart; when it lands, read its recommended sequencing before ordering tomorrow's C++ work.
- **feature-wants — IN FLIGHT.** `replica/research-feature-wants.md` is **not on disk**. Do not
  restart.

## 3. THE NEXT ACTIONS (ordered)

1. **Push the repo.** `git add -A && git commit && git push` — but `.github/workflows/` needs
   the `workflow` OAuth scope first: **`gh auth refresh -h github.com -s workflow`** (a browser
   device flow — **needs the co-owner**). HEAD is still `99d407f`; `git status --porcelain` = 38
   entries (20 modified + 18 untracked, incl. `packaging/`, `shell/chrome/`,
   `replica/research-cache/`, `replica/proofs-chrome-redesign.md`,
   `replica/research-android.md`). Delete the stray empty root dirs first:
   `chrome/ not/ or/ but/ firefox/ firefox/.patchwork/` (`replica/HANDOFF.md` §5).
2. **Packaging workflows' first real run.** `packaging/linux/make-tarball.sh` + `make-deb.sh`
   against the built `build/ziy` (app dir rebuilt 00:36, teal chrome installed — the launch
   blockers table's row 1 is stale: `packaging/linux/` now has both scripts).
   `packaging/windows/` and `packaging/android/` are still empty dirs.
3. **Compliance notice pass** — `replica/deploy.md` §5: MPL §3.2(a) source-availability notice
   (row 4, `replica/research-legal.md` §2.4), the not-affiliated-with-Mozilla notice at equal
   prominence (row 6, §2.2), the four missing `extensions/ziy-shields/LICENSES` rows —
   `uabo-filters`, `urlhaus`, `antiadblock-warning-removal`, `brave-unbreak` (row 8, §6.1) — and
   the residual `Mozilla Firefox 156.0.1` version-string problem (row 7, §2.3).
4. **The Ko-fi page** — live *before* the first public build announcement: donation link, the
   "donations buy time, not influence" sentence, free download + build instructions beside it
   (`replica/premium-position.md` §2.5, §3, §6 item 6).
5. **The 5 C++ patches' first CI compile.** `patches/0001–0005` are apply-verified only, never
   compiled; the first compile is the first run of `.github/workflows/build-gecko.yml`
   (`gh workflow run build-gecko.yml --ref main && gh run watch`). Private-repo metering:
   ~2 000 min/month, a cold Gecko build ≈ 12–28 h — decide the host before dispatching.

## 4. THE THINGS NOT TO REDO

- **omni.ja byte-preserving member swap for the menu icon** — 5 same-length attempts failed
  (icon16.png is 722 B, a minimal shield SVG ~560; padding breaks the XML or the path data).
  The shipped fix is a relative `url()` in our own stylesheet. Record: `shell/chrome/userChrome.css`
  §9 comment + `replica/proofs-chrome-redesign.md` §5.
- **`[data-theme="dark"]` as a chrome dark-mode selector** — dead: only extension content pages
  (`ziy-shell/ui/welcome.js:122`, `ziy-sync/options`, `ziy-shields/ui/options`) ever set it.
  Chrome dark mode is `:root[lwt-toolbar="dark"]`, set by `LightweightThemeConsumer.sys.mjs`.
  Record: `replica/proofs-chrome-redesign.md` §9.1.
- **`--in-content-*` CSS tokens** — GONE from the engine (the only survivor anywhere in either
  omni.ja is `--in-content-zap-gradient`). `userContent.css` now retargets the real names
  (`--color-accent-primary`, `--background-color-canvas`, …) in the engine's `light-dark()`
  idiom. Record: `replica/proofs-chrome-redesign.md` §9.4.
- **Flutter for the Android app** — `webview_flutter` is Chromium; no maintained bridge.
  Record: `replica/research-android.md` §2.
- **Any `ziy-chrome.toml` patch set** — no such file exists and none is to be added;
  `tools/patches/` still holds exactly one file, `newtab-strip.toml` (725 B). Record:
  `replica/proofs-chrome-redesign.md` §0 + verification row 24; `shell/chrome/userChrome.css:533`.
- **Reverting the searches-policy tightening** — removing `DuckDuckGo`/`Bing` from `Remove` was
  the fix, not the defect (`replica/proofs-chrome-redesign.md` §9.2; `shell/policies-gen.py:421`).

## 5. ONE-LINE STATE OF THE WORLD

Built and verified: the branded app dir + 9-extension suite + native helpers + blind server, the
redesigned teal chrome and shield menu icon installed and gated (verify 48/0/2, regressions
10/0/0, npm 673, server 16, native 35); at: nothing pushed since `99d407f` (38 local entries),
no packaged artifact yet, and the first `build-gecko.yml` compile of the 5 patches is unrun;
launch blockers: the packaging artifact, the user update channel, the four compliance notices +
the version string, the 4 LICENSES rows, and the Ko-fi page (`replica/deploy.md` §5).
