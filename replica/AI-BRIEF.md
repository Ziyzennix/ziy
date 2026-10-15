# AI-BRIEF.md — READ THIS FIRST

**Project:** Ziy — a Brave-feature clone browser on Gecko.
**This file:** the single doc every worker reads before doing anything. It tells you what is
ALREADY on this box, what has been DECIDED, what has been PROVEN, and the mistakes that have
already cost someone hours. If you read one file, read this one.

Last verified against the disk and docs: **2026-10-15** (see §2 for what was ls'd/du'd by hand).

---

## 1. WHAT THIS PROJECT IS

- **Ziy** is a privacy-first browser clone built on the **Gecko engine**: a branded Firefox
  156.0.1 app dir (`build/ziy/`) plus an **MV3 WebExtension suite** (`extensions/ziy-*`).
- It is built **clean-room from `replica/recon.md`** (the Brave behavior record); every product
  decision traces to `replica/evidence.md`'s confidence classes (OBSERVED / OBSERVED-SOURCE /
  DOC-INFERRED / BUILT-EXERCISED / INFERRED).
- Proof-of-work lives in `replica/proofs-*.md` — one doc per workstream, every claim with
  commands and outputs. **Never claim something a proof doc does not already show.**

---

## 2. WHAT IS ALREADY ON THIS BOX — do NOT re-download this list

**`/tmp` was wiped by a reboot (2026-10-15).** Every row below is the EXACT current state, checked
by `ls`/`stat`/`du` at the timestamp in §2.3. Before ANY download, check this table and the
matching proof doc. **The knowledge survived the bytes**: wherever an asset is absent, the
column names the documents in `replica/` that record what it contained — re-read those before
re-fetching anything.

### 2.1 PRESENT on disk right now

| asset | path | size | provenance | reuse / delete |
| --- | --- | --- | --- | --- |
| Firefox 156.0.1 source tarball — **DOWNLOAD IN FLIGHT** | `/tmp/fxsrc/firefox-156.0.1.source.tar.xz` | **581,332,992 B of 801,841,152 B (72.5%)** at last check, mtime advancing every second (curl pid **12731**: `curl -sS -C - --retry 40 --retry-delay 2 --retry-all-errors --retry-max-time 7000 -o firefox-156.0.1.source.tar.xz https://ftp.mozilla.org/pub/firefox/releases/156.0.1/source/firefox-156.0.1.source.tar.xz`, cwd `/tmp/fxsrc`, stdout to `/tmp/fxsrc/curl.log` which stays 0 B because of `-sS`) | the recovery download after `/tmp/firefox-src` was lost; target digest sha512 `80a32a79…a24d5b` (`proofs-deep-fork.md` §5), sourcestamp `6f2c158dfc7e9693f880fad2510ceb51a158c069` | **Do NOT start a second download** (§5 rule 12). `curl -C -` resumes this exact file — ~220 MB left at ~1 MB/s ≈ **35–45 min**. When it finishes: `sha512sum firefox-156.0.1.source.tar.xz` must equal `80a32a79268b672206f5477ca6bfde620cb7419b27aac090e01f06df06990ee0bbd81bb5c4aa78ac1d0edb26b133b1c6fa11cb6522445eccd70c82e719a24d5b`, then extract ON DEMAND (`tar -xf … --wildcards 'firefox-156.0.1/<subtree>'` — the release tarball omits ~35 subtrees, see `deep-fork.md` §6.3) |
| Extracted source subsets (post-reboot) | `/tmp/verify/firefox-156.0.1/dom` (1.5 M), `/tmp/ziy-final/tree` (dom/canvas, dom/webgpu, toolkit/moz.configure), `/tmp/ziy-verify/tree`, `/tmp/ziy-src-check/dom_canvas_*.cpp` (1.5 M) | ~5 M total | the cpp-privacy `dom/` re-read and the fingerprint workstream's targeted files, re-created after the wipe | Safe scratch; keep while a proof doc still cites them, else delete |
| axe accessibility scanner | `/tmp/axe-core.tgz` (552 K) + `/tmp/package/axe.{js,min.js,d.ts}` + locales + ~25 `/tmp/axe-*.mjs` probes | ~2.8 M | axe-core extraction used for the a11y pass | Keep — the extraction IS the cache; no re-fetch |
| Throwaway Ziy profiles | 27 dirs: `/tmp/ziy-budget-profile`, `-budget-idle-profile`, `-gap3-pwd-profile`, `-gap4-dbg`, `-gap4-restore-profile`, `-gap4-prefs`, `-playlist-verify`, `-prefs-proof`, `-verify-root`, `-verify`, `-verify2`, `-final`, `-fp-verify`, `-src-check`, `-stock-prefs`, `-gap4b`, … | 37–132 M each, **~950 M total** | every e2e/proof run's `--profile /tmp/ziy-*` | **Safe to delete** once you have copied the evidence you need — disposable by design (reboot swept them once already) |
| Engine toolchain | clang/llvm **19.1.1** (`clang-19`, `llvm-config-19`), rustc+cargo **1.90.0** via rustup in `$HOME/.cargo` (15 binaries: cargo, cbindgen, cbindgen 0.29.4, rustc, rustfmt, clippy, rust-analyzer…), nasm 2.16.01, yasm 1.3.0, ccache 4.9.1, mercurial 6.7.2 | apt + rustup | installed deliberately (`proofs-deep-fork.md` §3, §6.1); rustc 1.90.0 is the tree's own `MINIMUM_RUST_VERSION` | **Do not reinstall — verified live just now.** Never run a Gecko compile (§3) |
| Node & Python | node **v26.10.0** at `~/.local/opt/node-v26.10.0-linux-x64/bin/node`, python3 **3.12.3** (stdlib; pip 26.2.1; PyYAML 6.0.1; Pillow 10.2.0; **no `zbar`**) | preinstalled | `npm test` = `node --test extensions/*/test` (package.json) | don't install other runtimes |
| The Ziy build | `build/ziy/` (app dir) + `build/verify`, `build/tmp`, `build/share` | **361 M** | `tools/build-shell.sh --force`, patched omni.ja included | **gitignored** — regenerate with `./tools/build-shell.sh --force`; never commit |

### 2.2 ABSENT — and the documents that outlived them

| asset | path | status | its OUTPUT still lives at | recover how |
| --- | --- | --- | --- | --- |
| Firefox 156.0.1 extracted **source tree** (3.0 GB + 6.6 MB `obj-ziy`) | `/tmp/firefox-src/firefox-156.0.1` | **ABSENT** | `patches/0001–0004*.patch` (all four apply/reverse cleanly to it), `replica/compile-readiness.md` §2–§3 (the apply + brace-balance evidence), `replica/deep-fork.md` §6, `replica/proofs-cpp-fingerprint.md`, `replica/proofs-cpp-privacy.md` (every citation re-grounded from a second tree) | **From the tarball that is downloading RIGHT NOW (§2.1) — see §5 rule 11.** Extract on demand; the known missing subtrees are listed in `deep-fork.md` §6.3 |
| The **first** tarball copy (769 MB, sha512-verified) | `/tmp/firefox-src/firefox-156.0.1.source.tar.xz` | **ABSENT** | `replica/proofs-deep-fork.md` §5 (the sha512 and the resumable download command) | the in-flight `/tmp/fxsrc` copy replaces it; verify sha512 before trusting |
| **brave-core tree** (`bc` sparse brave-core + `gs` go-sync, HEAD `436c2286`, 2026-10-12) | `/tmp/brave-src` | **ABSENT** | `replica/re-deep-core.md`, `re-deep-shields.md`, `re-deep-sync.md`, `re-deep-sync.assets.md` (the exact `git clone --filter=blob:none` + sparse-checkout commands), `replica/brave-prefs-notes.md` | only if you need NEW source reads; for what was already read, the `re-deep-*` docs are the record |
| Patch-apply scratch tree | `/tmp/ziy-apply-test` (230 MB `toolkit/` copy) | **ABSENT** | `replica/compile-readiness.md` §2 (the apply + bit-for-bit reverse evidence) | `cp -a` the `toolkit/` subtree again; never patch `/tmp/firefox-src` in place |
| Screens **tool** | `/tmp/screens-tool` | **ABSENT** | `replica/screens/*.png` (9 brave:// captures, 4 behavior captures) + `replica/screens/MANIFEST.md` (which 9 pages worked, which 3 never did, and why Brave's own `--screenshot` hangs) | Don't rebuild — the captures and the honest limits are the artifact |
| QR/zbar verification envs (`pyzbar`) | `/tmp/qrenv`, `/tmp/pzenv` | **ABSENT** | `replica/proofs-talk.md` §2 (the 5 silent bugs the decoder found) | only if re-proving the encoder; Pillow works today, `import zbar` does not |
| Ziy flow/verify profiles (pre-reboot set) | `/tmp/ziy-fix-*`, `-flow-*`, `-block-profile`, `-v4` | **ABSENT** | `replica/proofs-fix-events.md`, `proofs-shields.md`, `proofs-desktop.md` (all boot-log evidence) | recreate with `tools/e2e/*.py` when re-running a flow |

### 2.2a GitHub / git remote state — repo EXISTS, pushed 2026-10-15

| item | state |
| --- | --- |
| git repo at the project root | **PRESENT.** Initialised 2026-10-15 (`git init -b main`, git 2.43.0), one commit `786f85b` *"Ziy browser: Gecko-branded shell, 9-extension MV3 suite, tooling, replica record"*, branch `main`. |
| GitHub remote | **PRESENT and PUSHED — https://github.com/Ziyzennix/ziy** (PRIVATE). Created by the co-owner (`gh repo create ziy --private --source=. --remote=origin --push`); first push attempt was **rejected** because the OAuth token lacked the `workflow` scope, which GitHub requires to push `.github/workflows/build-gecko.yml`. The co-owner re-authorised (`gh auth refresh -h github.com -s workflow`), after which `git push -u origin main` succeeded. Local and remote `main` both at `786f85b`. |
| repo visibility | **PRIVATE**, verified after the push: `gh repo view --json visibility,isPrivate` → `"visibility": "PRIVATE"`, `"isPrivate": true`, `pushedAt 2026-10-15T15:20:21Z`. |
| Actions state | **ENABLED, no UI step needed.** `gh api repos/Ziyzennix/ziy/actions/permissions` → `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`. `gh api repos/Ziyzennix/ziy/actions/workflows` → **1 workflow, `state: "active"`**: `build-gecko` at `.github/workflows/build-gecko.yml` (id 385699008). Both endpoints returned 200 — nothing here is `unverified`. |
| Actions workflow dispatch | **AVAILABLE** — the workflow file landed and is active, and its `on:` block carries `workflow_dispatch` (input `note`, string) plus tag triggers. Dispatch manually with `gh workflow run build-gecko.yml --ref main` then `gh run watch`, or from `/actions/workflows/build-gecko.yml`. |
| `gh` CLI | **PRESENT and authenticated** as **`Ziyzennix`** (`gh` 2.45.0, https protocol, keyring). Token scopes are now `delete_repo, gist, read:org, repo, workflow` — **`workflow` is the scope any push touching `.github/workflows/` needs**; without it GitHub rejects the whole ref with `refusing to allow an OAuth App to create or update workflow ... without workflow scope`. Nothing else about the token changed. |
| git identity | **SET** (was absent — no `~/.gitconfig`): `user.name=Ziyzennix`, `user.email=70117583+Ziyzennix@users.noreply.github.com` (the GitHub noreply address derived from the account id). |
| `.gitignore` at the package root | **PRESENT, 3.9 K** (globs `build/` 355 MB, `replica/screens/*.png` + `behavior/` 4.8 MB, `*.xpi`, `node_modules/`). Verified live: `git ls-files build/` = **0**, `git ls-files replica/screens/` = **1** (`MANIFEST.md` only). |
| what the co-owner runs | **DONE.** Next actions are not git ones: decide the build host (self-hosted free vs 2,000 metered min/month) and dispatch `build-gecko.yml`. |
| push size | **41.5 MB** tracked, pushed in ~10 s (the link is faster than the documented 1 MB/s ceiling). `git count-objects -v` → 529 loose objects, 10.46 MiB packed. Largest tracked file **3.1 MB**; no file is anywhere near GitHub's 100 MB per-file limit. |
| what landed at the repo root | `.github`, `.gitignore`, `AGENTS.md`, `WATCHDOG.yml`, `brand`, `extensions`, `firefox-156.0.1`, `native`, `package.json`, `patches`, `replica`, `server`, `shell`, `tools` — **463 tracked files**. `firefox-156.0.1/` is the four upstream reference files (520 KB: `dom/canvas/ClientWebGLContext.cpp`, `dom/webgpu/Adapter.cpp`, `toolkit/components/resistfingerprinting/nsRFPService.cpp`, `toolkit/moz.configure`) the patch workstream cites; MPL-2.0 upstream source, not a build output and not a competitor asset. |
| clean-room | **VERIFIED after the push.** Zero tracked PNGs from Brave: `git ls-files` has no `screens`/`capture`/`behavior`/`brave`-screenshot binaries. All 72 tracked PNGs are Ziy-authored (`brand/` icons + `extensions/*/icons/` + `replica/design/` mocks). The three `brave`-**named** files are Ziy's own text: `ziy-shields/lib/filterlist/snapshots/brave-unbreak.txt` (a filter-list snapshot), `ziy-shields/test/brave-parity.test.js`, `replica/brave-prefs-notes.md`. |

### 2.3 Hardware / infra facts (re-measured 2026-10-15)

- **4 cores** (Haswell i5-4590), **7.6 GiB RAM with ~3.4 GiB available**, 5.8 GiB swap (2 GiB
  swapfile + 3.95 GiB zram), **228 GB disk with 115 GB free**, **~1 MB/s network**.
  Sources: `proofs-deep-fork.md` §7, `resource-budget.md` header, `deep-fork.md:6`, and
  `df -h /tmp` + `free -h` + `nproc` re-run for this file. Note `resource-budget.md`'s "5.4 GB
  available" was measured earlier in the session — the live number is lower now, and libxul's
  link is a single ~5 GB process, which is the OOM reason local Gecko compiles are forbidden (§3).
- **1 MB/s changes everything**: resumable `curl -C -` only, never plan a fresh 800 MB fetch,
  and never start a second download while one is in flight.

**Not on disk but already decided:** nothing about the repo remains undecided — it exists at `https://github.com/Ziyzennix/ziy`, PRIVATE, and `786f85b` is pushed on `main` (§2.2a). The old `fatal: not a git repository` state is history.

---

## 3. WHAT HAS BEEN DECIDED — do NOT re-decide

| decision | the rule | source |
| --- | --- | --- |
| **Cut list** | **AI assistant (Leo), crypto wallet, rewards/ads economy (BAT, notification ads, sponsored backgrounds), VPN, and the wallet sidebar** are all cut — not deferred, not partial. 36 `cut` + 12 `skip` rows in the matrix | co-owner 2026-10-14: `replica/fixes.md` §1.1/§1.5 and the ARCHIVED note at §4.6; `replica/parity.md` §1 (wallet 13, sidebar 4, rewards 11, vpn 5 all cut) |
| **Engine stack** | **Gecko by configuration + extensions.** NOT Chromium, NOT WebKit, NOT from scratch | `replica/architecture.md` §1 stack decision, `proofs.md` |
| **No local Gecko compile** | **This box NEVER compiles Gecko.** No `./mach build`/`configure`, no rustc/cargo Gecko builds, no ccache-heavy jobs. CI (`.github/workflows/build-gecko.yml`, manual/tag only) or a future self-hosted runner. Light work is fine: `git apply` on `/tmp` copies, omni.ja patching, pref/layer checks, `tools/build-shell.sh`. Anything >~60 s sustained CPU needs `nohup` + `nice`/`ionice` and a declared report line | `replica/deep-fork.md` §0 build policy (co-owner decision; the reason: the box is used interactively and the link+RAM make local build last resort) |
| **No user-requested features** | Parity rows only. Reviews (`fixes.md`, `reviews.csv`) **can deprioritize, never add**; the `user feedback` area (14 rows) is the only Ziy-own addition and is research backlog, not a build request | `replica/parity.md` §3, `fixes.md` §4 |
| **Extension lib pattern** | **UMD IIFE classic scripts.** Gecko loads `background.scripts[]` as one HTML document of plain classic scripts — `import`/`export` = SyntaxError, duplicate top-level `const` = parse-time kill, bare `module.exports` = ReferenceError. The exception is `ziy-sync`, whose libs are genuinely ESM (shared with `native/ziy-sync-agent/` and `server/`), which uses `"type": "module"` | `replica/proofs-fix-events.md` §1 (quotes `WebExtensionPolicy.cpp BackgroundPageHTML()`) and §2 |
| **Repo/build layout** | `build/`, `*.xpi`, `node_modules/`, `.ziy/`, `__pycache__/` are gitignored, as are `replica/screens/*.png` + `behavior/` (captures of Brave's own UI, clean-room rule); tracked input is `extensions/`, `shell/`, `tools/`, `server/`, `native/`, `brand/`. One suite id source of truth: `shell/extensions.list` (derived ids, `<id>.xpi` filenames) | `.gitignore` (comments), `shell/extensions.list` header; `replica/screens/MANIFEST.md` line 5 + `replica/evidence.md` clean-room paragraph |
| **Git remote EXISTS and is pushed — keep it clean** | The repo is **https://github.com/Ziyzennix/ziy, PRIVATE** (`786f85b` on `main`, 463 tracked files, pushed 2026-10-15). Commit and push as usual; do not create a second remote, do not rename. `.github/workflows/` pushes need the `workflow` OAuth scope — if a push is ever rejected with `refusing to allow an OAuth App to create or update workflow ... without workflow scope`, that is the cause and `gh auth refresh -h github.com -s workflow` is the fix (a browser step, needs the co-owner). `build-gecko.yml` is dispatch-only by design; never add a push/PR trigger to a private repo (burned minutes, §5 rule 10). `replica/compile-readiness.md` §1, §6; `replica/AI-BRIEF.md` §2.2a |
| **Naming** | product id `ziy` (lowercase); user-visible dirs `Ziy`; executable `ziy`; extension dir `ziy-<area>`; **add-on id `ziy-<area>@ziy.app`**; pref namespace `ziy.<area>.*`; message op `<area>.<verb>`; native host `ziy-<area>d` | `replica/architecture.md` §8 Naming conventions |
| **Search** | Engine picker with **Google default**; **no own search engine/index**. Option C (hybrid, local-first aggregator) is the plan's recommendation | `replica/recon.md` out-of-scope (index = `skip`), `replica/search-plan.md` §6 |
| **Icon / mascot** | **App icon = sealed-eye shield** (`brand/logo.svg`, A1); the **cat mascot (`brand/MASCOT.md`) is personality surfaces only** — welcome screen, about panel, empty/loading states — and MUST NEVER be the app icon, a toolbar icon, a hicolor entry, a manifest `icons{}` entry, a favicon, or a state indicator | `replica/design/icon.md` §0 (palette/glyph rules), `brand/MASCOT.md` |

Also decided by proof, not re-open: the newtab strip is three independent layers (omni.ja byte
patch + prefs + policy) — `replica/deep-fork.md` §3; MV3 has no `storage` manifest key, no
`externally_connectable`, `user_scripts` is MV2-only (`proofs.md`).

---

## 4. WHAT HAS BEEN PROVEN WORKING — do NOT re-prove it

| proven | evidence | where |
| --- | --- | --- |
| **verify.sh green**: 46 passed, 0 failed, 1 skipped; exit 0. The 1 SKIP is `--version` (the engine string can't be remapped from `App:Name`; the app-dir boot + branded screenshot pass instead) | `replica/deploy.md` §3 | `./tools/verify.sh` / `npm run verify` |
| **The suite is 9 ids** (not 8, not 11 — the 11 in `proofs-shell.md` §4 was written before `ziy-pwd` landed): ziy-shell, ziy-shields, ziy-ntp, ziy-news, ziy-playlist, ziy-talk, ziy-sync, ziy-desktop, ziy-pwd — all `@ziy.app` | `shell/extensions.list`; `proofs-must-gaps.md` §6 (suite 9 ids); a real boot shows 18 add-ons in `extensions.json`, all suite ids active with `installedDistroAddon` markers (`proofs-deep-fork.md` §2) | full-suite gate = `verify.sh` section 7 |
| **Four BLOCKER defects fixed** (D-1 import in classic background, D-2 duplicate top-level const, D-3 `webNavigation` without permission, D-4 `module.exports` in a page script) | `replica/test-report.md` (✅ FIXED markers) + `replica/proofs-fix-events.md` §3–§5 | F01 welcome tab now opens; F02–F07 pass on the real add-on origin |
| **Sync e2e**: 67/67 unit tests + the two-device end-to-end proof pass | `replica/proofs-sync.md` §1 | `bash tools/e2e-ziy-sync.sh` |
| **Shields blocking**: 5 of 5 trackers stopped, 0 reached the page; DNR static + webRequest residual both live | `proofs-shields.md` §7.3 | |
| **Shields counts (D-7)**: the 28 923-rule static ruleset is re-evaluated for counting (never blocking); `blocks=0` → non-zero | `proofs-must-gaps.md` §1 | |
| **Playlist decode**: a real mp4 decode + play + seek, reorder and resume survive a reload | `diff-summary.md` §4, `proofs-playlist.md` | |
| **Talk panel**: 17 in-browser panel checks; QR encoder proven by a real zbar decode of all 10 versions (that decode found 5 silent bugs) | `proofs-talk.md` §2, §4, §6 | |
| **News feeds**: NTP news integration rendering live | `proofs-ntp-news-integration.md`, `diff-summary.md` §4 | |
| **omni.ja patch**: byte-length-preserving `AppConstants` + newtab-strip patches written, applied to `build/ziy/browser/omni.ja`, re-verified from disk | `proofs-deep-fork.md` §1.1–1.5 | CRC must be recomputed in both headers (§5) |
| **3 C++ patches authored, none compiled**: `0001-rfp-colorscheme-carveout.patch`, `0002-ziy-fingerprinting-option.patch`, `0003-webgpu-adapter-strings.patch`, `0004-webgl-fake-extension.patch` — apply + reverse cleanly against the 156.0.1 tree | `compile-readiness.md` §2–§3; `deep-fork.md` §6.7 | |
| **Dead-pref finding**: 7+ dead pref names in Ziy's own shell (`dom.webbluetooth.enabled`, `dom.serial.enabled` (engine reads `dom.webserial.enabled`), `dom.nfc.enabled`, `dom.idle-detector.enabled`, `dom.filesystem.enabled` (engine: `dom.fs.enabled`), `dom.security.featurePolicy.enabled`, `network.cookie.lifetimePolicy`, `webgl.renderer-string-override`, `privacy.resistFingerprinting.randomizationOnRestart`) — shell bug, rename, no C++ patch | `proofs-cpp-privacy.md` §2.1; `proofs-cpp-fingerprint.md` §5a | |
| **Published resource budget** | `replica/resource-budget.md` | idle CPU reported as CANNOT ASSESS with the headless-compositor reason, not as a measured value |
| **Parity**: 60.4% deliverable score; must-rows 40 yes / 5 partial / 8 no of 53 (80.2% weighted) | `replica/parity.md`, `replica/diff-summary.md` | |

---

## 5. KNOWN MISTAKES AND TRAPS — do NOT repeat

1. **Bare-word `pkill` nearly killed the user's LibreOffice.** The project path contains
   `brave`, so a broad `pkill` pattern matched the user's own apps. **ALWAYS anchor to the
   throwaway profile path (`pgrep -f '/tmp/ziy-.*profile'`) or the exact executable, match first,
   then kill by PID** (`pgrep -f <profile> \| xargs -r kill -9`). `tools/verify.sh` only ever
   launches with an explicit `--profile /tmp/ziy-*` and only kills that anchored pattern.
   Sources: `recon-behavior.md` §Kill discipline, `proofs-shields.md` §7, `proofs-talk.md` §9, `proofs-desktop.md`.
2. **The 800 MB re-download.** `/tmp/firefox-src/firefox-156.0.1` was lost to a process restart
   and the whole release tarball was re-fetched. That is why §2 exists. Fetch once, verify
   sha512, extract on demand.
3. **`background.scripts` are CLASSIC scripts.** `import`/`export` (SyntaxError), a second
   top-level `const` of an owned name (parse-time `redeclaration of non-configurable global
   property X`), and bare `module.exports` (ReferenceError) each silently kill the whole event
   page. Use the UMD IIFE pattern; `ziy-sync` alone uses `"type": "module"`. Proof:
   `proofs-fix-events.md` §1.
4. **`webNavigation` is an API permission.** `<all_urls>` in `host_permissions` does NOT
   substitute. Without it `api.webNavigation` is `undefined` → TypeError at top level.
   `proofs-fix-events.md` §1, D-3.
5. **WebDriver BiDi boundaries.** There is no navigation to `moz-extension://`: BiDi refuses it,
   `browsingContext.create` with a URL lands on `about:blank`, and a `--screenshot` of an
   extension page needs the extension context. Working routes: an **iframe child context**
   (`tools/e2e/ziy-fix-iframe-probe.py` embeds the add-on's `ui/debug.html` in a `file://`
   page) and a **staged real bundle**. Extension background storage is NOT readable over the
   page's `window` — that is why the shields per-tab count stayed unobserved.
   Sources: `ziy-fix-iframe-probe.py` docstring, `proofs-shields.md` §6 caveats.
6. **`storage.local` is IndexedDB, letter-shifted.** It lives in
   `storage/default/moz-extension+++<uuid>/idb/*.sqlite` (table `object_data`) — **a JSON scan
   finds nothing even when the keys are present.** Keys are stored with a one-byte prefix
   (`0`/`0x30`) and every letter shifted down by one (`s` written as `t`); strip the prefix,
   shift back. Reader (the reference implementation): `tools/e2e/ziy-fix-shields-flows.py`
   `read_storage_local_keys()`.
7. **omni.ja patches must be length-preserving and CRC-correct.** Stored (method 0) members only;
   a length change means the engine reports "The installation seems to be incomplete". The CRC-32
   must be rewritten into BOTH the central-directory header (offset +16) and the local file
   header (offset +14) — `tools/lib/omni-ja.py` does this and re-verifies. Both `omni.ja` and
   `browser/omni.ja` are patched (AppConstants and newtab live in different containers).
   `proofs-deep-fork.md` §1, `deep-fork.md` §1–§2.
8. **`privacy.fingerprintingProtection.granularOverrides` must be a quoted JSON ARRAY.** Putting
   `true` in it crashes the graphics layer and hangs the build. Fixed with a loud preflight
   (`shell/mozilla.cfg:46` prints the offending name). `proofs-shell.md` §1.6.
9. **The 30 000 static-ruleset quota drops the WHOLE ruleset.** The first shipped ruleset was
   114 973 rules (3.8× the cap) and was silently dropped entirely, not trimmed — DNR looked dead
   while the residual tier kept blocking. `GUARANTEED_MINIMUM_STATIC_RULES` = 30 000;
   `MAX_NUMBER_OF_DYNAMIC_RULES` = 5000 (`extensions.dnr.max_number_of_dynamic_rules`);
   history-object quota per chain = 30 000 (`architecture.md` §4.3.4). `proofs-shields.md` §7.4, §45.
10. **CI runs on a PRIVATE repo.** `ubuntu-latest` = **2 CPU / 8 GB**, metered at 2,000 min/month
    (free for public repos and self-hosted runners — that asymmetry is the whole cost decision).
    A cold Gecko build is ~12–28 h ≈ 720–1 680 min = the whole monthly allowance. Trigger is
    `workflow_dispatch`/tag only. ccache is saved under a stable key with `if: always()`.
    `compile-readiness.md` §5, `proofs-fix-ci.md` §5–§7. **Actions were verified live on the pushed
    repo (2026-10-15): `actions/permissions` → `enabled: true, allowed_actions: "all"`, and
    `build-gecko.yml` is `state: "active"` — the "private repos block Actions until manually
    enabled" worry was FALSE for this repo. `gh workflow run build-gecko.yml --ref main` works
    without any UI step.** Separately: **a private repo is not the only thing that gates a push —
    the `workflow` OAuth scope does.** Pushing `.github/workflows/*` is rejected outright with
    `refusing to allow an OAuth App to create or update workflow ... without workflow scope`;
    `gh auth refresh -h github.com -s workflow` fixes it, but it is a browser device flow and
    needs the co-owner. Do not "fix" that rejection by dropping the workflow file.
11. **Verification-harness quirks.**
    - The op helper already wraps its argument in `body` (mirroring `ui/popup.js`'s
      `send(op, body)`) — pass op args **directionally**, do not nest a second `body`
      (`tools/e2e/ziy-fix-shields-flows.py` comment above F03).
    - From an iframe there is no `browser.tabs`, so `shields.state` without a tab id returns the
      GLOBAL rule — a per-site override is only visible to a caller that can pass a tab id
      (same file, F03 note).
    - Headless does not render browser chrome: the verify harness screenshots a `file://` probe
      page, and the userChrome skin needs DOM/CSS assertions (`deep-fork.md` §5).
    - A harness JSON storage scan finds nothing when the state is in IndexedDB — see trap 6.
    - `privacy.spoof_english` defaults to 0, which means RFP never spoofs `JSLocale`; the real
      name for reset-on-restart is `privacy.resistFingerprinting.randomization.daily_reset.enabled`
      (`proofs-cpp-fingerprint.md` §5b).
    - **A WebDriver BiDi harness needs the profile directory to exist BEFORE launch**, or the
      engine prints "Could not find profile folder" and exits without opening 2828. Also: a
      leftover browser holds 2828 and the next launch fails to bind it — kill the PARENT pid
      (its contentproc children do not carry the profile string). And `script.evaluate` needs the
      fixture's own context, found by URL match in `browsingContext.getTree` — tabs made with
      `browsingContext.create` do not reliably appear there in this profile.
    - **A `file://` fixture page has NO `browser`/`chrome` global**, so a fixture whose script
      starts `var b = browser || chrome` throws on its first line and never publishes anything.
      Read the page's state through a content script's own `window` bridge instead (a content
      script runs in the isolated world and page JS cannot see its API, by design).
    - **`JSON.stringify(x || {})` is a trap for boolean reads**: `false || {}` is `{}`, so the
      value you most care about reads back as "nothing happened". Read scalars with an explicit
      `undefined`->`null` fallback and check the result type.
    - **A content script at `run_at: document_start` must not touch `document.documentElement`
      unconditionally** — it is null on first execution, `observe(null)` throws, and the whole
      script dies silently. This is a real bug that cost a workstream its end-to-end proof
      (`content/spotify-adslot.js`, `proofs-blocking-strength.md` §5.4 item 7).
12. **`/tmp` is REBOOT-VOLATILE.** A reboot on 2026-10-15 wiped `/tmp/firefox-src`,
    `/tmp/brave-src`, `/tmp/ziy-apply-test`, `/tmp/qrenv`, `/tmp/pzenv`, `/tmp/screens-tool` and
    the whole pre-reboot profile set — nothing under `/tmp` survived except what a worker had
    re-created since and the `~/.cargo`/node toolchains (which live in `$HOME`). Rules that
    follow from it:
    - **Any asset worth keeping must be (a) consumed by a worker until its result is written
      into `replica/`** (a proof doc, a patch, an evidence row), **or (b) moved into the project
      tree.** Bytes that live only in `/tmp` are one reboot away from not existing.
    - **Before starting work that needs the engine source, CHECK whether the tree is still
      there** (`ls -d /tmp/firefox-src/firefox-156.0.1 /tmp/fxsrc/*.tar.xz`). If the tree is
      gone, re-extract from a still-present tarball; if there is no tarball, re-download with the
      documented resumable command:
      `curl -C - --retry 40 --retry-delay 2 --retry-all-errors --retry-max-time 7000 -o firefox-156.0.1.source.tar.xz https://ftp.mozilla.org/pub/firefox/releases/156.0.1/source/firefox-156.0.1.source.tar.xz`
      (the `-C -` is the property that matters at 1 MB/s — it survives a drop). The 800 MB at
      1 MB/s costs **~2 h and is acceptable ONE time**; verify the sha512 in §2.1 on arrival.
    - **NEVER start a second download while one is in flight.** As of this writing a download IS
      in flight (§2.1, curl pid 12731, ~70–75% complete, ~35–45 min left) — resume it, do not
      race it.

---

## 6. HOW TO START — the first five minutes, for any new worker

1. **Read this file.** Then read the ONE proof doc for your area (`replica/proofs-<area>.md`) and
   `replica/architecture.md` if you are touching structure or naming.
2. **Check §2 before any download or clone.** If the asset is present, reuse it. If it is absent,
   read the document named in §2.2 that outlived it BEFORE re-fetching — the knowledge may make
   the bytes unnecessary. On a 1 MB/s link use `curl -C - --retry 40 --retry-delay 2
   --retry-all-errors` and verify the sha512 you were given; never start a second download while
   one is in flight (§5 rule 12).
3. **Match the conventions that exist** — naming (§3), UMD classic scripts, `shell/extensions.list`
   for suite ids — rather than establishing a second one.
4. **Run the relevant suite before editing**: `npm test` (= `node --test extensions/*/test`), or
   the one extension's `extensions/<area>/test/`. Build with `./tools/build-shell.sh --force`.
5. **Use throwaway profiles and anchored kills** — `--profile /tmp/ziy-<purpose>`, then
   `pgrep -f '/tmp/ziy-<purpose>-profile' \| xargs -r kill -9`. Never a bare `pkill`.
6. **Write your findings into `replica/`** (`proofs-<area>.md`, and update `evidence.md` /
   `parity.md` if a row moved) so the next worker inherits them — that is the co-owner's rule
   this file exists to serve.
