# deep-fork.md — the Ziy engine-level fork plan

Companion documents: `architecture.md` (the design), `proofs-shell.md` (the
shipped shell mechanisms), `proofs-deep-fork.md` (every command and output this
document's claims rest on). Machine: Linux Mint (Ubuntu 24.04 noble base), 4-core
Haswell i5, 7.6 GB RAM (5.4 GB available), 110 GB free disk, 1 MB/s link.

**C++ patches written: 2** (`patches/0001-rfp-colorscheme-carveout.patch` and
`patches/0002-ziy-fingerprinting-option.patch`, §6.7). Both apply cleanly to the
156.0.1 source tree. **Neither has been compiled** — that is the first CI run's
job (`.github/workflows/build-gecko.yml`). The original note, preserved because
it was the accurate status when written: *nothing in
`/tmp/firefox-src/firefox-156.0.1` has been modified; no C++ file or patch file
exists; nothing has been compiled.* This document is the plan and the status of
the layers that landed (the byte-level omni.ja patcher, the newtab strip, and
now the first C++ patch) plus the decision for the C++ layer. Do not read any
section below as delivered, *compiled* C++ code.

---

## 0. Build policy (co-owner decision)

**This box is NEVER used to compile Gecko.** No `./mach build`, no
`./mach configure`, no `autoconf`, no `rustc`/`cargo` builds of Gecko
components, no `ccache`-heavy jobs. Not occasionally, not "just once for a
proof", not in the background. Compilation of Gecko happens ONLY:

* on CI — GitHub Actions, workflow `.github/workflows/build-gecko.yml`
  (`workflow_dispatch` or a `v*`/`gecko-*` tag push); or
* on a future self-hosted runner, registered by the co-owner as an explicit
  decision, never by default.

**Still allowed (they are light):** extract-and-patch work — `git apply` on
copies under `/tmp` — and verification. `git apply` on `/tmp` trees, byte-level
`omni.ja` patching, pref/layer checks and the shell build
(`tools/build-shell.sh`) are all sub-minute, CPU-light operations and stay in
play.

**If something unavoidable would take more than ~60 seconds of sustained CPU,**
it MUST be run `nohup` + `nice`/`ionice`, and that run MUST be declared in its
report. "Unavoidable" means there is no CI path and no lighter way to get the
fact — it does not include a Gecko compile, which is what this policy exists to
forbid.

**Why (the reason this is a hard rule, not a preference):** the co-owner uses
this machine interactively, and a heavy build lags it to unusability. The box
is a **4-core Haswell i5 with ~5.4 GB available RAM**, and the `libxul` link was
already a named OOM risk (§6.5, §6.6) — a multi-hour `./mach build` at `-j4`
would pin every core for 6–14 h and thrash swap while the co-owner is trying to
work. The trade was already made once and this rule records the outcome:
**local build is the on-box proof path of last resort; CI is the iteration
loop** (§6.6).

**Extracted source tree on disk — deletable:** `/tmp/firefox-src/` currently
holds **3.8 GB** (the checksum-verified `firefox-156.0.1.source.tar.xz`,
769 MB, plus the 3.0 GB extracted tree and 848 KB of `SHA512SUMS`). Inside it,
`firefox-156.0.1/obj-ziy/` is the aborted configure's objdir — 6.6 MB of
`config.status`, `config.log` and an `a.out`; no build output, no compiled
object. It is left in place because the tree is the patch-authoring reference
(§6.2, and the patch apply proof in `compile-readiness.md` §2).
**Deleting `/tmp/firefox-src` reclaims ~3.8 GB of the 110 GB free**; deleting
just `obj-ziy/` reclaims 6.6 MB. The tarball's SHA512 is recorded above and in
`proofs-deep-fork.md` §5, so it can always be re-fetched and re-verified.

**Guards:** any `tools/` or `shell/` script that would launch a local Gecko
build when run MUST carry a policy guard — a loud error naming
`replica/deep-fork.md` and `.github/workflows/build-gecko.yml`, then `exit 1`.

---

## 1. What we patch in omni.ja, and why that is the whole seam

The engine on this box is a shipped 156.0.1 release binary. We cannot rebuild
`libxul.so` from C++ on a whim, so the only engine code we can change today is
the code the engine ships as **stored (uncompressed) members inside two
containers**: `omni.ja` and `browser/omni.ja`. A stored member's bytes on disk
are its content, so a same-length rewrite leaves every central-directory offset
valid — only the member's CRC-32 must be recomputed and written into both the
central-directory header (offset +16 of the 46-byte header) and the local file
header (offset +14 of the 30-byte header). Container facts and the failure mode
of a length-changing edit (the engine reports "The installation seems to be
incomplete") are recorded in `proofs-shell.md` §1.1-1.3.

Two archives, two patch sets, because the members live in different containers:

| archive | member | why it is patched |
| --- | --- | --- |
| `omni.ja` | `modules/AppConstants.sys.mjs` | the signing/sideload constants exist only here (not in `firefox-bin` or `libxul.so`) |
| `browser/omni.ja` | `chrome/browser/builtin-addons/newtab/manifest.json` | Firefox's own new tab is a built-in add-on, and this is its manifest |

## 2. The generalized patcher: tools/lib/omni-ja.py

`shell/omni.ja.patch/patch-omni.py` (the original signing-only patcher) is
untouched and still works. The reusable tool is `tools/lib/omni-ja.py`, built on
the same container parsing, and it generalizes it:

* **Patch sets** — named built-ins (`ziy`, `ziy-browser`, `ziy-all`) or external
  TOML files, one `[[member]]` table with `[[member.replace]]` pattern/replacement
  pairs. Several members per archive, several archives per build.
* **Refusals** (each a build-time loud failure, exit 1 for a precondition, 2 for
  verification): the member is absent from the archive; the member is compressed
  (method != 0); a pattern occurs 0 or >1 times; the patched member's length
  changed; the input CRC disagrees; after patching, any byte outside the patched
  bodies and their CRC fields changed; the re-parsed container's entry count or
  offsets moved.
* **Verification pass** re-reads the written bytes: re-parses the container,
  recomputes every patched member's stored CRC against what is on disk, and
  confirms the new string is present and the old one gone.
* `--verify <archive>` re-checks an existing file without writing.

Length note: individual substitutions may differ in length only when the member's
net change is zero. The AppConstants pair is the documented case: signing
`true`→`false` is +1 byte, sideload `false`→`true` is -1 byte, they cancel
(proofs-shell.md §1.3), and the tool re-checks the whole file.

## 3. The newtab strip — three layers, each sufficient alone

Firefox's own new tab page is the built-in add-on `newtab@mozilla.org`, and it is
the only other `chrome_url_overrides.newtab` claimant in the product. Our NTP
(`ziy-ntp@ziy.app`) already claims that override, so leaving both registered is
an undocumented race. Three layers strip it, deliberately ordered so that any
one of them alone already makes ziy-ntp the only new tab page:

**(a) Byte layer — the omni.ja patch.** `browser/omni.ja`, member
`chrome/browser/builtin-addons/newtab/manifest.json`, equal-length bump:

```
"manifest_version": 2,   ->   "manifest_version": 3,
```

The built-in declares `background.scripts` (an MV2 form); under a bumped MV3
manifest the add-on installer rejects it, so Firefox's new tab never registers.
Every byte of it still ships; nothing moves. Applied at
`tools/build-shell.sh` step 7b via `tools/lib/omni-ja.py --patch ziy-browser`,
with an independent re-verification read of the written file (same contract as
the omni.ja one). Failure mode: if the string is absent (engine bump, or an
already-patched source) the build FAILS at 7b with a `PRECONDITION FAILED`
message naming the member — engine-bump protection.

**(b) Pref layer.** `browser.newtabpage.enabled=false` is what
`AboutNewTabRedirector.sys.mjs` reads to route `about:newtab` to the extension
override instead of the built-in, and
`browser.newtabpage.disableNewTabAsAddon=true` is what
`AboutNewTabResourceMapping.sys.mjs` reads to stop mapping the built-in's
resources at all (both modules read in `browser/omni.ja`). Also
`browser.newtabpage.activity-stream.selfLoading.enabled=false` and
`browser.startup.homepage.abouthome_cache.enabled=false`. Locked in
`shell/mozilla.cfg` and written as user prefs in
`tools/bootstrap-profile.py`.

**(c) Policy layer.** `shell/policies-gen.py` adds
`newtab@mozilla.org: {"installation_mode": "blocked"}` to ExtensionSettings, so
the built-in is refused as an add-on even if (a) and (b) both regressed.

Evidence (full commands and outputs in proofs-deep-fork.md §2): a boot of the
built Ziy on about:newtab with the bootstrapped profile writes no
`activity-stream.*` pref and creates no activity-stream file in the profile;
before the patch the same boot created three `activity-stream.*.json` files.

## 4. What stays in extensions, and what deliberately is not patched

**Stays in extensions:** everything that can be an extension — the new tab page
itself (ziy-ntp), shields, news, playlist, talk, sync, desktop chrome. The
extension layer is signed-off (MOZ_REQUIRE_SIGNING=false), so it is the cheapest
place to add behaviour.

**Deliberately NOT patched, with reasons:**

* **browser/extensions/newtab's ~4 MB of JS/CSS assets** (activity-stream
  bundles, TopSitesFeed, TopStoriesFeed, webcompat shims, etc.). Deleting or
  truncating them requires a length change, which is fatal to the container
  (§1). Layer (a) makes the add-on uninstallable at runtime instead, which is
  the only byte-safe option. Disk cost: the bytes ship but never execute.
* **Firefox Accounts / Sync at the JS level.** Pref-level removal is already done
  (`identity.fxaccounts.enabled=false`, locked; the DisableFirefoxAccounts policy
  covers the rest). A byte-level removal of the FxA modules would gain nothing
  over the policy+pref layer and would add an engine-bump failure point, so it is
  not worth the risk.
* **about:welcome / what's-new surfaces.** Already disabled at pref level
  (`browser.aboutwelcome.enabled=false`, `startup.homepage_welcome_url=""`,
  OverrideFirstRunPage policy). Byte-level removal has no byte-safe mechanism
  (those pages render from many members).
* **Sponsored content / snippets.** Pref level already covers it
  (`browser.newtabpage.activity-stream.showSponsored=false`,
  `showSponsoredTopSites=false`, `feeds.section.topstories=false`,
  `feeds.snippets=false`, `asrouter.providers.snippets=""`,
  `browser.topsites.sponsoredShortcuts.enabled=false`,
  `browser.topsites.contile.enabled=false`). With layer (a) the entire
  activity-stream machinery is inert, so there is no remaining sponsored surface
  to remove. Confirmed, not extended further.

## 5. Chrome skin (status: NOT DONE)

The seam is proven and in place: `build-shell.sh` installs
`shell/chrome/userChrome.css` into `<appdir>/browser/chrome/userChrome.css`, and
`tools/bootstrap-profile.py` writes
`toolkit.legacyUserProfileCustomizations.stylesheets=true`, which is what makes
Gecko read the file. What is NOT done: replacing the provisional violet tokens in
`shell/chrome/userChrome.css` with the real Ziy tokens from
`replica/design/tokens.css` (gloam teal accent, compact tab strip, dark/light
via `[data-theme="dark"]`), and adding `userContent.css`.

**Honest verification limitation:** headless mode on this engine does not render
browser chrome — the existing verify harness screenshots a `file://` probe page
for exactly this reason. The skin must therefore be verified by DOM/CSS
assertions on the loaded file plus, if the co-owner's display is available, a
headed screenshot. The two load-preconditions (the pref is true and the file
exists in the profile) are directly assertable.

## 6. The local C++ build path

### 6.1 Toolchain — installed and proven (no passwordless sudo; co-owner-provided sudo used for apt installs only)

| component | version | source |
| --- | --- | --- |
| clang / llvm | 19.1.1 (Ubuntu `1:19.1.1-1ubuntu1~24.04.2`) | apt, incl. llvm-objdump/objcopy/readelf/profdata/strip and libclang.so |
| rustc + cargo | 1.90.0 (1159e78c4 2025-09-14) | rustup in `$HOME` — the exact `MINIMUM_RUST_VERSION = "1.90.0"` from the tree's own `python/mozboot/mozboot/util.py` |
| cbindgen | 0.29.4 | `cargo install cbindgen --locked` |
| nasm / yasm | 2.16.01 / 1.3.0 | apt |
| ccache | 4.9.1 | apt |
| mercurial | 6.7.2 | apt |
| audio/video/x11 deps | — | apt: libasound2-dev, libpulse-dev, libx11-xcb-dev, libxcb-{shm0,keysyms1,glx0}-dev, libgtk-3-dev, libdrm-dev, libxkbcommon-dev, libudev-dev, libxtst-dev, libsecret-1-dev, python3-dev |
| system python | 3.12.3, stdlib only | preinstalled — no system pip anywhere in this path; mach creates its own vendored venv under `~/.mozbuild` |

`./mach bootstrap --application-choice=browser` finished with
**"Your system should be ready to build Firefox for Desktop!"** (the only warning
is the optional `watchman`, which mozboot catches and skips).

### 6.2 Source procurement

Mozilla's own release tarball, not a git clone (the clone died at ~17 MB on the
1 MB/s link; `curl -C -` makes the download resumable, which is the property that
matters here):

* URL: `https://ftp.mozilla.org/pub/firefox/releases/156.0.1/source/firefox-156.0.1.source.tar.xz`
* Size: **801,841,152 bytes**, fetched with
  `curl -C - --retry 20 --retry-delay 5 --retry-all-errors`.
* **SHA512 verified equal** to the published
  `80a32a79268b672206f5477ca6bfde620cb7419b27aac090e01f06df06990ee0bbd81bb5c4aa78ac1d0edb26b133b1c6fa11cb6522445eccd70c82e719a24d5b`.
* `sourcestamp.txt`: `20260921121718` / rev `6f2c158dfc7e9693f880fad2510ceb51a158c069`
  of `mozilla-release` — the exact source revision of the 156.0.1 engine we ship.

### 6.3 Configure/build status — and why the build never started

`mozconfig`: `MOZ_OBJDIR=@TOPSRCDIR@/obj-ziy`, `MOZ_PARALLEL_BUILD=4`,
`--disable-optimize`, `--disable-debug-symbols`, `--disable-tests`,
`--without-wasm-sandboxed-libraries`, and `PATH` including `/usr/lib/llvm-19/bin`
(Ubuntu keeps the llvm tools in a versioned directory).

`./mach configure` was run **13 times and never completed**. Two causes, in
order, and both are now understood:

1. **The release tarball is an incomplete source archive.** It ships ~3 GB but
   omits roughly 35 top-level subtrees. Each had to be extracted on demand:
   `browser/ toolkit/ modules/ config/ python/ mach/ GNUmakefile/ dom/ security/
   build/ configure.py/ intl/ testing/mozbase/{mozfile,mozshellutil,mozinfo,
   mozlog,mozprocess,moztest,mozsystemmonitor,manifestparser,mozcrash,mozversion}/
   testing/condprofile/`, plus a stale nested `firefox-156.0.1/firefox-156.0.1/`
   that was removed.
2. Missing system/tool deps, each installed and re-run: `llvm-objdump`, `alsa`,
   cbindgen, `libclang`, `x11-xcb`, and the wasi headers (worked around with
   `--without-wasm-sandboxed-libraries`).

The last failure, after 1:12 of work, is one more tarball gap:

```
1:11.82     ['OSError: Missing files: /tmp/firefox-src/firefox-156.0.1/testing/marionette/harness/marionette_harness/tests/harness_unit/python.toml']
1:12.87 E *** Fix above errors and then restart with "./mach build"
```

`obj-ziy/config.status` was written once at 1:02.47 but the same run then aborted,
so configure must be re-run to completion. **`./mach build` never started; no
C++ has been compiled.**

### 6.4 Exact next-step sequence (recorded verbatim)

> **SUPERSEDED — DO NOT RUN (§0, Build policy).** The local box is NEVER used to
> compile Gecko: no `./mach configure`, no `./mach build`, no autoconf, no
> rustc/cargo Gecko builds. The sequence below is preserved as the historical
> record of the 13-attempt local configure path and because it documents what
> the tarball gap was — **it is not an instruction.** The compile path is
> `.github/workflows/build-gecko.yml` (CI) or a future self-hosted runner. The
> only local actions still allowed here are light: extracting a subtree
> (`tar -xf` of a missing tree from the already-on-disk tarball is fine) and
> `git apply`/`git apply --check` against `/tmp` copies. A local build, if it is
> ever unavoidable, requires an explicit co-owner decision, `nohup` +
> `nice`/`ionice`, and a declared report line.

```bash
cd /tmp/firefox-src
tar -xf firefox-156.0.1.source.tar.xz --wildcards 'firefox-156.0.1/testing/marionette'
cd /tmp/firefox-src/firefox-156.0.1
PATH=$HOME/.cargo/bin:/usr/lib/llvm-19/bin:$PATH ./mach configure
PATH=$HOME/.cargo/bin:/usr/lib/llvm-19/bin:$PATH /usr/bin/time -v ./mach build
```

If configure exposes yet another missing subtree, extract it and re-run
configure; that has been the recurring pattern, not a one-off.

### 6.5 Honest numbers

**Spent:** download 801 MB at ~380 KB/s ≈ 35 min; sha512 5 s; on-demand
extraction ≈ 25 min across 13 tar invocations; apt toolchain ≈ 6 min;
rustup+cbindgen ≈ 6 min; 13 configure attempts ≈ 25 min.

**Remaining:** configure 2-3 min once the marionette subtree is extracted;
`./mach build` **6-14 h** on 4 Haswell cores for this fast config (Mozilla's own
figure is "over 120 minutes of CPU core time" on a modern machine; a Haswell i5
is roughly 2-3x slower per core, and the Rust toolchain is a large fixed cost).

**Risks, named:**
1. **Incomplete release tarball** (primary). A gap discovered mid-build rather
   than at configure costs hours; there is no complete-tree guarantee.
2. **libxul link OOM** at 5.4 GB available RAM. Swap exists
   (`/swapfile` 2 GB + zram 3.8 GB, ~1.9 GB in use), which converts a hard
   linker OOM into a thrash, but lowering `-j` does not help a single-process
   link. Disk (110 GB free) is not a risk.

### 6.6 Decision: how Ziy gets its first REAL C++ patch

**Recommended path: CI.** A GitHub-hosted Linux runner (4 CPU / 16 GB, free on
public repos) runs the same source and the same toolchain. It is the same shape
as the Windows/Android CI already planned for this project, it produces a
relinkable artifact, and it removes both named risks — the complete-tree problem
is solved by cloning with `git-cinnabar` or by extracting the full tarball on a
runner, and the link OOM by 16 GB of RAM. Cost: CI minutes only; no 6-14 h of
the co-owner's box.

**Local build (option b)** is the on-box proof path and is now nearly free of
setup cost — the toolchain, the checksum-verified source, and the mozconfig all
exist — but each clobber costs 6-14 h plus the tarball-repair risk.

> **THIS OPTION IS NOW CLOSED TO LOCAL USE (§0, Build policy).** "Run it for one
> proof build" was written before the co-owner's decision; the box is NEVER used
> to compile Gecko. The setup facts above remain true and are what make the
> *self-hosted runner* variant of option (b) attractive if the co-owner ever
> registers one explicitly (`runs-on: self-hosted` in the workflow is one
> uncomment away). Until then, CI only.

**Why `/mach artifact` is NOT a path to C++** (stated precisely, from the
official artifact-builds documentation): artifact mode downloads prebuilt C++
components and links them. It explicitly does not support modifying C, C++, or
Rust source: "If it's compiled to machine code, it can't be changed." A prebuilt
`libxul.so`/`omni.ja` cannot be relinked with new C++. Artifact builds rebuild
JS/CSS and Cargo components only, so they are useful for our extension work (and
for fast frontend iteration) and useless for an engine patch.

**Preferred first C++ patch target:** something prefs+JS genuinely cannot reach —
a fingerprint-protection delta (e.g. a behaviour the RFP pref layer cannot
express), or a first-party-only cookie partitioning default. Both are small,
localised C++ changes where a local build is a one-off cost and CI is the
iteration loop.

### 6.7 Gecko build CI — the recommended first-C++-patch path (now built)

**CI is now the recommended path, and it is a real workflow, not a plan.** The
decision above is delivered as
[`.github/workflows/build-gecko.yml`](../../.github/workflows/build-gecko.yml) —
a single job on `ubuntu-latest` that fetches the checksum-verified
156.0.1 source, installs the same toolchain this box has, applies the C++ patch
set in `patches/`, runs `./mach configure` → `./mach build` → `./mach package`,
uploads the tarball, then smoke-boots the built engine headless.

**Cost numbers (the honest ones).**

| item | number | basis |
| --- | --- | --- |
| runner minutes per build | **180–420** on public-repo free tier (0 $) | 3–7 h wall estimate below |
| wall clock on 4 CPU / 16 GB | **8–16 h**, the local estimate carried forward; GitHub's cores are slower per-thread than this box's Haswell but the count is the same | deep-fork.md §6.5 |
| hard job cap | **720 min (12h)** | set on the job; see the split note below |
| runner RAM | **16 GB** vs this box's ~5.4 GB available | the libxul link is a single ~5 GB process; §6.5 risk 2 |
| runner disk | ~14 GB usable | holds a ~3 GB extracted tree + objdir |
| local box cost for the same build | **6–14 h** + the tarball-repair risk | §6.5 |

**Why 12h and not 8h as the cap:** the estimate is a range whose top end is 14h,
and a cap below the low end wastes a run that was going to work. The split point
is documented in the workflow's final step: split at the **configure/build
boundary** into `toolchain-and-source` (a–e + g1, caching the extracted tree and
ccache) and `build-and-package` (g2–g4 + h + i). The ccache cache is what makes
that split cheap — only changed files recompile.

**Trigger discipline.** `workflow_dispatch` (manual) plus `push` **on tags
only**. NOT on every push: this is an 8–16 h job, and a branch-push trigger
would let a force-push sprint queue a dozen runs and eat the free tier the
repo's cheaper workflows depend on. This is the mitigation architecture.md §0.5
already committed to ("run the heavy workflows on release tags and manual
dispatch, not on every PR of every branch").

**What the artifact unlocks.** The job produces a **relinkable** engine: the
objdir survives the run, so a C++ patch is a recompile of the changed files plus
a relink of `libxul` — not a fresh 8–16 h build. The uploaded tarball plus the
ccache keyed on the patch-set hash is therefore the iteration loop for
fingerprint-protection-style deltas: write a patch, dispatch, get a built engine
back, repeat. That loop is the thing the local box cannot give us at acceptable
cost, and it is what makes C++ engine patches buildable at all.

**The local path stays as the on-box proof.** §6.4's recorded sequence
(extract the marionette subtree, `./mach configure`, `/usr/bin/time -v ./mach
build`) is the proof that the toolchain and mozconfig work on the co-owner's
hardware. It is NOT the iteration loop, and it is not required for the first
C++ patch. Run it once for the proof; iterate on CI.

**What landed with this section.**

- `.github/workflows/build-gecko.yml` — the workflow above. 19 steps, every
  command cited to this document, `proofs-deep-fork.md`, or Mozilla's own
  docs fetched 2026-10-15.
- `patches/` — the C++ patch set, with a README documenting the format, the
  gate, and the re-apply procedure. **The first patch is real**, not a
  scaffold: `0001-rfp-colorscheme-carveout.patch`, grounded in
  `nsRFPService.cpp:335` / `:296` / `:323` and `Document.cpp:21177`.
- `patches/0002-ziy-fingerprinting-option.patch` — declares the
  `--enable-ziy-fingerprinting` configure option, which is what makes the
  patch set switchable from `.mozconfig` rather than a header edit.

**The first patch is the thing §6.6 asked for, and it is a real finding, not a
contrived one.** Ziy locks `privacy.resistFingerprinting=true` **and** ships
`privacy.fingerprintingProtection.overrides="+AllTargets,-CSSPrefersColorScheme"`
(`shell/mozilla.cfg`, `ziy.js`). That carve-out **does not work**: in RFP mode
`nsRFPService::IsRFPEnabledFor()` returns `true` for every target at
`if (mode == FingerprintingProtectionType::RFP) { return true; }` *before* it
reaches the branch that reads the override set, so the overrides pref is only
consulted in FPP/Baseline mode. There is no pref or JSON array that can turn
off one target while RFP mode is on. That is exactly the "behaviour the RFP
pref layer cannot express" §6.6 named, and the patch restores the carve-out by
reading the engine's own pref in `HandleExceptionalRFPTargets()` — the one
function `IsRFPEnabledFor()` consults first.

**Status and what is NOT claimed.** Both patches are verified to `git apply
--check` cleanly against the 156.0.1 source tree, and the gate-off path is
verified byte-identical to stock source. **Neither patch has been compiled.**
The first CI run is the first compilation, and the first green run — not this
document, and not the local `git apply` check — is the proof that patch 0001 is
real. Expect the first run to surface something; the likely candidates are a
lint complaint about the `#ifdef` placement or an unused-variable warning.

**Patch strategy — authored in parallel, verified in batches.** Parallel
workers change who *writes* patches, not what *proves* them. Each C++ delta
needs three things: (a) a verified real problem in engine source, (b) a minimal
correct diff, and (c) a compile that proves it. Workers parallelise (a) and (b)
freely — N workers can each study a Brave patch area (privacy, networking,
WebRTC, storage partitioning, API-disabling) and emit authored, gated, cited
`.patch` files in the shape of `0001-rfp-colorscheme-carveout.patch` with no
build at all. Step (c) is the shared serial bottleneck: one Gecko build is
6–14 h on this box and 8–16 h on a runner regardless of how many workers wrote
patches, and every patch in a build compiles together, so a failing patch fails
the whole build loudly — which is the gate. So the honest thousand-patch answer
is: N *authored* patches is reachable with parallel workers, but N *verified*
patches costs N/|batch| real compiles. **"Authored but unverified" is a real,
documented state, and it must never be blurred into "verified"** — the status
line above is the model for how every patch is recorded until a CI run compiles
it.


## 7. Update-engine.sh story

Every bump re-runs the same four steps, in this order, and any of them failing
is a hard stop, not a warning:

1. Fetch and checksum-verify the new release tarball; record the new
   `sourcestamp.txt` revision in `replica/proofs-deep-fork.md`.
2. Re-run `tools/build-shell.sh`, which applies the omni.ja patches through
   `tools/lib/omni-ja.py`. If a patched member's string moved (the usual effect
   of an engine bump) the build fails at step 7 or 7b with a `PRECONDITION
   FAILED` naming the member and the expected pattern — re-derive that one
   substitution against the new member and re-run.
3. **NEW — apply the C++ patch set against the new source tree** (§6.7):

   ```sh
   for p in patches/*.patch; do
     [ -e "$p" ] || continue
     git apply --check "$p" || die "$p no longer applies to the new source; re-derive it"
   done
   ```

   Any failure is a hard stop naming the patch, same shape as the omni.ja
   refusals. A moved line is the EXPECTED failure mode of an engine bump, not
   a bug in the patch: re-derive it against the new source. An empty
   `patches/` is a clean no-op — stock Gecko is a legitimate build.
4. Boot-verify: `./tools/verify.sh` proves the suite still installs and the app
   still boots, and the newtab check proves our NTP is still the only new tab.
   With the C++ layer live, this must ALSO confirm each patch's behaviour is
   actually present in the shipped engine — a patch that applies but is
   compiled out (gate off) is the C++ equivalent of the silent no-op below.

This is why the patcher refuses rather than skips: a silent no-op would ship an
engine with Firefox's own new tab restored and nobody would know until a user
saw it. The C++ patch set inherits the same discipline: `git apply --check`
before anything is written, and a rejection stops the bump.
