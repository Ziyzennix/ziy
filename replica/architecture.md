# Architecture: Ziy — a Brave-feature browser on the Gecko engine

**Product name: Ziy** (package id `ziy`; user-visible dirs `Ziy`; executable `ziy`).
Rationale: user-named. Short, pronounceable, no trademark collision with any
known browser (not "Brave", not a browser-name lookalike), and neutral enough
that a lion/shield family of marks — the visual language the recon found in
Brave's Shields panel — reads as "protected" rather than "copied".

Ziy is **not** a fork of Brave's code. It is a clean-room product, designed from
`replica/recon.md` only, that runs on Mozilla's **Gecko** engine (Firefox
156.0.1, installed on this machine) covered by our own branding and control
layer. The architecture is Brave's own product shape — engine + blocking engine
+ sync chain — rebuilt on Gecko's supported public
surfaces.

- Sources: `replica/recon.md` (52 screens, 29 flows, 22 entities), `replica/features.csv`,
  `replica/screens/` (design reference only, never shipped), `replica/brave-prefs-notes.md`.
- Every mechanism claim in §2 and §6 was verified on this machine (2026-10-14) against the
  installed Firefox 156.0.1; the verification commands and results are in `replica/proofs/`.
- **Platforms:** Linux desktop is the reference target and is proven here. Windows desktop and
  Android are required targets; what survives of this architecture on each is §0 (platform
  matrix) and §9 (per-platform sizing). Nothing in the Windows or Android columns was verified
  by running on those platforms — cells cite fetched Mozilla documents only, and anything
  unverified is marked `low — unverified` rather than guessed.

---

## 0. Platform matrix

**Product requirement:** Ziy ships for multiple platforms. Linux (desktop) is the
current and proven target; **Windows (desktop) and Android are required targets.**
This section states, mechanism by mechanism, whether each part of the §1
architecture exists on the other two targets — with a confidence level, and a
citation only where we actually verified the claim.

Confidence legend: `high` = read from a fetched Mozilla document (URL + fetch
date in §0.4) or verified on this machine; `medium` = follows from a verified
fact plus a documented pattern, but this exact cell was not re-verified;
`low — unverified` = not verified, and not guessed at.

**The shape of the answer:** Windows is the *same* product with different
packaging; Android is a *different* product that reuses the extension suite.

### 0.1 Mechanism by mechanism

| mechanism | Linux (desktop) — current, proven | Windows (desktop) — required | Android — required |
| --- | --- | --- | --- |
| **App-dir branding** (`application.ini`, `Vendor=Ziy`, our own copy of the install tree) | Verified on this machine: `ps` shows `-appDir <ziy>/browser`, `-greomni <ziy>/omni.ja`; screenshots render. **high** | Same mechanism, different tree shape. Firefox's default Windows install root is `C:\Program Files\Mozilla Firefox\`, and since the *versioned install directories* change each version lives in its own subdirectory (the docs' own example is `C:\Program Files\Mozilla Firefox\136.0.1a\firefox.exe`) with a launcher exe in the base dir. Our app-dir copy and `tools/update-engine.sh` must therefore resolve the **versioned** subdirectory, not a fixed path. **high** (layout) / high (mechanism — same engine files) | **Not possible.** Firefox for Android is one signed APK: no user-writable app dir, no `application.ini` to swap, no `-appDir` argument. The app-dir shell does not port. **high** |
| **Autoconfig** (`mozilla.cfg` + `general.config.filename`, locked prefs) | Verified: `browser/defaults/preferences/ziy.js` loads as `mXULAppDir/defaults/preferences`; `mozilla.cfg` at the GRE root is the documented autoconfig vehicle. **high** | Same mechanism. Autoconfig is engine-side, and the GRE root travels with our copied app dir. **high** (mechanism) / **medium** (exact file set not re-verified against a Windows install) | **Not possible as written.** A GeckoView app is an embedded library — no GRE root, no `mozilla.cfg` read. The equivalent is `GeckoRuntimeSettings`/prefs set programmatically from the Kotlin app. **low — unverified** for the settings API surface |
| **`policies.json` distribution** | Works. Policy templates: "On Linux, the file goes into `firefox/distribution` … or you can specify system-wide policy by placing the file in `/etc/firefox/policies`". Verified `distribution/policies.json` at our GRE root. **high** | Works. Policy templates: "On Windows, create a directory called `distribution` where the EXE is located and place the file there" — beside our copied `firefox.exe`, exactly the pattern we already use. (GPO `ADMX`/Intune templates also exist in `mozilla/policy-templates/windows`, but we do not need them for an app-dir distribution.) **high** | **Not possible.** There is no install tree to place a `distribution/` directory in; policy placement is documented for Windows/macOS/Linux only. **medium** |
| **`omni.ja` signing patch** (unsigned suite: flip `MOZ_REQUIRE_SIGNING` / `MOZ_ALLOW_ADDON_SIDELOAD` inside our own `omni.ja`) | Verified: the constants live only in the stored (uncompressed) `AppConstants.sys.mjs` inside `omni.ja`; two byte-length-preserving rewrites keep every zip offset valid. **high** | Same mechanism. The patch is a zip rewrite of the same file layout; Windows Firefox ships the same `omni.ja`. **high** (mechanism) / **medium** (not re-verified against a Windows `omni.ja` on this machine) | **Not possible.** There is no `omni.ja` in an embedder app. GeckoView's supported equivalent is `WebExtensionController.installBuiltIn()`, which installs a bundled `resource://` extension that **needs no signature** — a different, documented path to the same end. **high** |
| **Chrome branding** (`browser/chrome/` + profile `chrome/userChrome.css`) | Works: our app-dir `browser/chrome/` plus the bootstrap-written `chrome/userChrome.css`. **high** | Works, same files. userChrome.css is a profile-side mechanism, not OS-specific. **high** (mechanism) / **medium** (not verified on a Windows profile) | **Not possible.** userChrome.css is desktop-Firefox chrome; a GeckoView app draws its own UI. **high** |
| **`chrome_url_overrides.newtab`** (Ziy owns its NTP) | Verified capability (§1.3). **high** | Works — same manifest key, same engine. **high** (mechanism) | **Not possible.** BCD records `firefox_android: false` for `chrome_url_overrides` (`newtab` included): Firefox for Android has no extension-overridable new-tab page. A GeckoView Ziy app must draw its own home screen. **high** |
| **`sidebar_action` MV3 panels** (Talk, Bookmarks) | Verified capability (§1.3). **high** | Works, same API. **high** (mechanism) | **Not possible as a sidebar.** BCD records `firefox_android: false` for `sidebarAction`. Each panel becomes an app screen (GeckoView build) or a full-page extension page (companion build). **high** |
| **`declarativeNetRequest` + `webRequestBlocking`** (the Shields engine) | Verified on this machine (§1.3) — both available, which is why the engine keeps a DNR *and* an imperative path. **high** | Works. DNR has been in Firefox desktop since 113 and is the same code in a Windows build; the imperative `webRequest` path likewise. **high** (mechanism; not re-verified on a Windows box) | **Available, with two real caveats.** BCD records DNR mirroring desktop on `firefox_android` (since 113) and `webRequest` since 48, so a blocking engine *can* run there. What is **not** verified: the practical ruleset-size/performance ceiling on Android, and the companion path (installing our unsigned suite into someone else's Firefox for Android) needs an AMO-signed build. **medium** |
| **nativeMessaging agents** (`ziy-mediad`, `ziy-sync-agent`) | Verified mechanism: host manifests written to the documented per-user Linux location `~/.mozilla/native-messaging-hosts/`. **high** | Works, different plumbing: the native host manifest must be written into the Windows per-user Mozilla app-data tree (**exact path: low — unverified**, read MDN Native messaging before implementing) and the daemons must ship as Windows binaries/scripts. **medium** overall | **Not possible as-is.** GeckoView documents that no native manifest is needed — the *app* is the message peer (`WebExtension.setMessageDelegate`), and `nativeMessaging` requires the `geckoViewAddons` permission. Every agent becomes Kotlin/Java inside our own app. **high** |
| **Profiles under our own root** (`~/.ziy/profiles/…`) | Verified: the bootstrap owns `~/.ziy/profiles/default/` and the launcher passes `--profile`. **high** | Works, different root: **`%LOCALAPPDATA%\Ziy\profiles\`** (our naming convention keeps `Ziy` as the user-visible dir). `--profile` and profile handling are engine-level, not OS-level. **high** (mechanism) / the path string is our product decision, not a verified Mozilla path | **Not applicable.** A GeckoView app owns its profile through `GeckoRuntime`/`GeckoRuntimeSettings`; Firefox for Android has no user-selectable profile directory. Profiles would be an app-level feature. **medium** |
| **Desktop integration** (`.desktop` entry, default-browser registration, icons) | Works: `shell/ziy.desktop` + icon install. **high** | Same feature, different code: Start Menu shortcut, Windows "App Paths" registration, default-browser via the Windows shell APIs. **medium** | **Not applicable.** No desktop integration on Android — the OS surface is the launcher icon and share targets. **high** |
| **Installer / update stage** | tarball stage (`packaging/linux/`) | Installer stage (Inno Setup or NSIS) plus our own update path; the versioned install-dir layout means the updater must handle the `…\<version>\` subdirectory. **medium** | Play Store / APK sideload; GeckoView is a Maven dependency (`org.mozilla.geckoview:geckoview-<channel>:<version>` from `https://maven.mozilla.org/maven2/`, Java 17). **high** that GeckoView is consumed this way |

### 0.2 Android reality check

Stated plainly, because it is the difference between a roadmap and a fantasy:

**Our app-dir / signing-patch shell cannot exist on Android.** There is no install
tree, no `application.ini`, no `omni.ja`, no `mozilla.cfg`, no `policies.json`,
no userChrome.css, and no sidebar. The Linux shell is not a thing we "port"; it
is a thing that is absent.

The honest paths, in order of cost:

1. **(a) Ship the MV3 suite as a companion to Firefox for Android** — for whatever
   Firefox for Android's extension system actually supports. This is *not* an
   install of our own suite into someone else's app: Firefox for Android does not
   take arbitrary unsigned extensions, so this path requires AMO-signed builds of
   the modules that Android supports, and it can never own the new tab page, the
   toolbar, the sidebar, or the window chrome. Cost: small; value: small.
2. **(b) Build a GeckoView-based Ziy Android app** that loads our suite via
   `WebExtensionController.installBuiltIn` from the APK's `assets/`. This is a
   real program — its own app shell, its own tab/toolbar/menu UI, its own home
   screen, and re-implementations of the desktop-only mechanisms as app code.
   Scope is quarter-scale, and it comes **after** Linux and Windows, not instead
   of them.

**Not overpromising parity.** On Android, under either path, these recon
screens/flows are unreachable or substantially reduced:

| recon screen / flow | why it is unreachable on Android |
| --- | --- |
| S02–S05, S51 NTP widgets / F08 / F09 | no `chrome_url_overrides.newtab` on `firefox_android`; no extension-owned new tab |
| S06 browser window chrome, tab strip, S13 main menu, S24 shortcuts | the window and menu are the app's UI (GeckoView) or Firefox-for-Android's UI — not ours |
| S07–S12 Shields panel / F02–F07 | the panel is toolbar/sidebar chrome we do not own; *blocking* itself can still run (DNR + webRequest), but the panel surface does not exist |
| S43 Playlist / F27 | panel + native `ziy-mediad` blob storage |
| S22/S23 shell settings pages | chrome/settings are not ours to skin on Android |
| S49/S50 password manager and autofill pages | shell pages, not extension surfaces |
| S26 profile picker / F25 | no user-selectable profiles on Firefox for Android or in a GeckoView app's profile model |

The defensible Android story is therefore: **browse, block, sync-connected
browsing surfaces, and content features** (tabs, Shields blocking itself, News,
search) — with the panel/toolbar/NTP surfaces of the recon either dropped or
rebuilt as app UI inside a GeckoView program.

### 0.3 Linux column — what is actually verified here

Everything in the Linux column of §0.1 marked `high` was verified on this machine
(2026-10-14) against installed Firefox 156.0.1; commands and captured output live
in `replica/proofs/`. Nothing in the Windows or Android columns was verified by
running anything on those platforms — those cells cite fetched documents only.

### 0.4 Documents fetched for this section (dates of fetch: 2026-10-14)

| URL | what it told us |
| --- | --- |
| https://mozilla.github.io/policy-templates/ | `policies.json` placement per OS: on **Windows** the file goes in a `distribution` directory next to the EXE (on Linux, `firefox/distribution` or `/etc/firefox/policies`) — so our existing app-dir pattern ports to Windows unchanged |
| https://github.com/mozilla/policy-templates/tree/master/windows | Windows policy delivery also exists as GPO `firefox.admx`/`mozilla.admx` templates and Intune OMA-URIs; we neither need nor want them for an app-dir distribution |
| https://firefox-source-docs.mozilla.org/installation_dir_layout/index.html | Windows uses **versioned install directories**: each version gets its own complete subtree (`…\136.0.1a\firefox.exe`) with a launcher exe in the base dir — our Windows app-dir copy and `update-engine.sh` must resolve that versioned dir |
| https://mozilla.github.io/geckoview/ | GeckoView is a self-contained, bundled library ("the code you test is the code that will actually run") for building mobile browsers — the engine for the Android path |
| https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/geckoview-quick-start.html | GeckoView ships as a Gradle/Maven dependency (`org.mozilla.geckoview:geckoview-<channel>:<version>` from `https://maven.mozilla.org/maven2/`, Java 17), embedded in an Activity layout |
| https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html | Bundled extensions go in the APK's `assets/` and are installed with `installBuiltIn`/`ensureBuiltIn`; **no native manifest is needed** — the app is the message peer via `setMessageDelegate`, and `nativeMessaging` needs the `geckoViewAddons` permission |
| https://firefox-source-docs.mozilla.org/mobile/android/geckoview/design/managing-extensions.html | `installBuiltIn` accepts only `resource://` URIs and gives built-ins extra privileges (app messaging, **no signature needed**) — the supported Android equivalent of our signing-patch |
| https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/manifest/chrome_url_overrides.json | `chrome_url_overrides` (incl. `newtab`) is `version_added: false` on **firefox_android** — the NTP override mechanism is desktop-only |
| https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/sidebarAction.json | `sidebarAction` is `version_added: false` on **firefox_android** — the sidebar panel mechanism is desktop-only |
| https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/declarativeNetRequest.json | DNR mirrors desktop on `firefox_android` (Firefox ≥ 113) — the blocking engine can run on Android |
| https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/webRequest.json | `webRequest` is supported on `firefox_android` since 48 — the imperative path can run on Android too |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API | Confirms the API surface is namespace-level identical across Firefox builds (browsers all now use `browser` + promises), i.e. Android differences are *surface* differences, not API-shape differences |

Pages that blocked the fetch (bot challenge) and yielded nothing:
`https://support.mozilla.org/en-US/kb/install-firefox-windows`,
`https://support.mozilla.org/en-US/kb/extensions-android`,
`https://support.mozilla.org/en-US/kb/deploy-firefox-enterprise-environments`,
`https://addons.mozilla.org/en-US/android/`.

Not verified by this doc pass, and flagged `low — unverified` where it matters:
Windows native-messaging manifest path; autoconfig/settings API surface on
GeckoView; Android ruleset-size/performance ceilings; anything requiring a
Windows or Android machine.

Also fetched for the CI/build rows added in §0.5:

| URL | what it told us |
| --- | --- |
| https://docs.github.com/en/actions/reference/runners/github-hosted-runners | `ubuntu-latest` and `windows-latest` standard runners are **4 CPU / 16 GB RAM / 14 GB SSD** on x64; runner VMs run with passwordless `sudo` (Linux) / administrator with UAC disabled (Windows); GitHub Linux runners support hardware acceleration for Android SDK tools (relevant if Espresso/emulator tests are ever added); **on public repos the standard runners are free and unlimited** (private repos use an allotment of free minutes then per-minute billing), which is why the CI-for-heavy split is affordable. `ubuntu-slim` (1 CPU) explicitly exists for lightweight jobs, not heavyweight CI/CD. |
| https://docs.github.com/en/actions/how-tos/choose-what-workflows-do/use-secrets | Secrets are created at repo/environment/org level and referenced in workflows via the `secrets` context (`${{ secrets.NAME }}`); **secrets are not passed to the runner when a workflow is triggered from a fork**, they cannot be used directly in `if:` conditionals, and large secrets (>48 KB) require an encrypted-file-plus-passphrase workaround — all reasons the Android keystore path must be designed as secrets-in, file-out, and never a checked-in keystore. |
| https://github.com/actions/upload-artifact | `actions/upload-artifact` (v4+; latest v7) uploads files/directories/wildcards as run artifacts with `name`, `path`, `retention-days`, `if-no-files-found`, and an `artifact-digest` SHA-256 output — the mechanism behind every "artifacts:" claim in the §0.5 workflow table (portable zip + installer on Windows, unsigned + signed APK on Android). |
| https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/geckoview-quick-start.html | (re-fetched for §0.5) GeckoView is consumed as a Gradle/Maven dependency — `implementation "org.mozilla.geckoview:geckoview-${channel}:${version}"` with Mozilla's Maven repo and **Java 17 source/target compatibility** — i.e. the Android toolchain the CI job must stand up is SDK + Gradle + JDK 17, exactly the stack this workstation cannot host. |

### 0.5 Build & CI strategy (product decision: local-first + CI-for-heavy)

**The decision.** Small builds happen **on this machine** (4 Haswell cores,
5.4 GB RAM, 126 GB free disk — the §1.1 probe). Heavy platform builds happen on
**GitHub Actions**, not locally. The workstation cannot host the Android
SDK/Gradle/JDK stack or Windows cross-toolchains at acceptable speed; hosted
runners give clean, reproducible, matrix builds with the compute and the disk
the job actually needs.

What is built where:

| artifact | built where | runner | toolchain | notes |
| --- | --- | --- | --- | --- |
| **Linux desktop** (app dir + suite, `build/ziy/`) | **local, and also CI** | local box; CI job on `ubuntu-latest` | `tools/build-shell.sh` + a Firefox install | Local is the proven path (§1.1). The **CI job also runs `tools/build-shell.sh`** so every push/PR is verified off-box on a clean machine — the same script, no fork. |
| **unit tests + headless verify** | **local + CI** | `ubuntu-latest` | `npm test` + `tools/verify.sh` | The acceptance harness of §7.2, run identically in both places. This is the primary parity guard between local and CI Linux builds. |
| **Windows desktop + installer** | **CI only** | `windows-latest` (4 CPU / 16 GB / 14 GB SSD) | `tools/build-shell.ps1` (PowerShell port of `build-shell.sh`), then Inno Setup or NSIS on the runner | Not built locally — no Windows box, no Windows toolchain, no acceptable speed. Installer licensing: **both NSIS and Inno Setup are free** (no per-build fee), so neither choice costs money. |
| **Android APK** | **CI only** | `ubuntu-latest` | Android SDK setup action + Gradle + JDK 17; GeckoView as the Maven dependency `org.mozilla.geckoview:geckoview-<channel>:<version>` from `https://maven.mozilla.org/maven2/` (verified, §0.1 installer row) | Not built locally — the SDK/Gradle/JDK stack wants RAM and disk this box does not have. APK uploaded with `actions/upload-artifact`; **signing via repo secrets — signing keys NEVER go in the repo.** |

**Documented workflow shapes.** These files come **later, in the build plan** —
this section documents the shape only; nothing under `.github/workflows/` exists
yet.

| file | trigger | what it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push + PR | On `ubuntu-latest`: `npm ci`, **node tests** for the extension suite, then **`tools/verify.sh`** (the §7.2 headless acceptance harness) — plus the off-box `tools/build-shell.sh` verification of the Linux artifact row above. |
| `.github/workflows/build-windows.yml` | push / release / manual | On `windows-latest`: run `tools/build-shell.ps1` + `tools/build-extension.sh` + `tools/install-native.ps1` + `tools/bootstrap-profile.py`, then the Inno Setup/NSIS stage in `packaging/windows/`. **Artifacts:** portable zip + installer, uploaded via `actions/upload-artifact`. |
| `.github/workflows/build-android.yml` | push / release / manual | On `ubuntu-latest`: Android SDK setup action, Gradle build of the `android/` module (its own Gradle project), GeckoView dependency resolved from Mozilla's Maven repo, then `actions/upload-artifact`. **Artifacts:** **unsigned APK + signed APK variants**, the signed one gated on repo secrets. |

**§8 layout consequences.** `packaging/windows/` and `packaging/android/`
already exist in the layout tree (§8, `packaging/`). Two additions to record
here: (a) Android's shell is **not** a packaging variant — `packaging/android/`
is the **Gradle build stage for a real Kotlin GeckoView app**, a separate
`android/` module with its own Gradle project (§7.1 Android row, §0.2 path b);
(b) that app bundles the MV3 suite via `WebExtensionController.installBuiltIn()`
from the APK's `assets/` — **the documented no-signature path** (§0.1: bundled
`resource://` extensions need no signature), which is exactly why the Android
build needs our suite XPIs in `assets/`. The desktop **app-dir trick is
impossible on Android** (§0.1) and is not attempted.

**Honest tradeoffs.**

- **Runner minutes.** Three workflows × (build + test + artifact upload) on
  every push, for a repo where the local box already does Linux. The Linux CI
  job is the cheap one; the Windows and Android jobs are the expensive ones
  (SDK/Gradle downloads, installer execution). Mitigation when minutes matter:
  run the heavy workflows on release tags and manual dispatch, not on every PR
  of every branch. For a public repo the standard runners are free and
  unlimited, which is the reason this strategy is affordable at all.
- **Toolchain mirroring into workflows.** Every toolchain the CI job needs is
  re-declared in the workflow file — the Android SDK, JDK 17, Gradle's
  distribution, and the Inno Setup/NSIS installer binary. Download sizes are
  real (SDK + Gradle caches are the bulk of the Android job's minutes). The
  upside is that the workflow *is* the reproducible record: a fresh runner
  cannot silently depend on this box's state. Installer licensing again: **NSIS
  is free, Inno Setup is free** — neither adds a cost line; the choice is on
  features, not price.
- **Secrets handling.** Signing material (Android keystore + passwords) lives
  in GitHub Actions secrets, referenced as `${{ secrets.* }}` — never in the
  repo, never in a workflow file, never printed to logs; a forked repo's PR
  does not receive secrets at all. If the secrets are absent the workflow must
  still produce the **unsigned APK** artifact and skip or fail the signing step
  loudly rather than silently.
- **Parity risk between local and CI Linux builds.** Two boxes could drift:
  a different Firefox version here vs. there, a script that depends on this
  machine's layout, a subtle shell difference. Mitigation is structural, not
  vigilance: **local and CI run the same `tools/build-shell.sh` and the same
  `tools/verify.sh`** — the CI job is a re-run of the local commands on a clean
  `ubuntu-latest`, so a local-only dependency surfaces as a red CI run instead
  of a user's broken build.
- **The Android module is a real program, not a packaging variant.** This is
  the tradeoff most likely to be underestimated: the Android job is not "run
  the installers again" — it builds a quarter-scale application with its own UI
  (§0.2), and its CI cost is dominated by toolchain setup and Gradle caches, not
  by our code. Budget it accordingly (§9).

---

## 1. Stack decision

> **Scope of this section:** §1 describes the **desktop Linux** reference build —
> the one that exists and has been verified on this machine. The same decisions
> carry to Windows (§0.1, with path/script variants only); on Android most of
> them do not apply at all (§0.2). Read §0 first if you are targeting anything
> other than Linux desktop.

### 1.1 The engine question, answered from the probe

`/tmp/env-probe-report.md` measured this machine: 4 × Haswell cores, 5.4 GB
available RAM, 126 GB free disk, and **no passwordless sudo**. A from-source
Gecko build is 12–24 h+ and cannot even be toolchained (clang ≥ 19, rustup with
Mozilla's pin, nasm, autoconf2.13 all absent and un-installable unattended).

**Decision: Firefox 156.0.1 by configuration, not by patch.** We ship Ziy as:

1. **Our own application directory** — a controlled copy of the Firefox install
   tree with Ziy's own `application.ini`, `defaults`, `distribution/`, and a
   patched `omni.ja`. Verified on this box: the copy boots and runs as an
   independent app (`ps` showed `-appDir <ziy>/browser` with our own binary and
   GRE/omni paths; screenshots render).
2. **A profile we create and own** — never `~/.mozilla/firefox/…`. Ziy's
   launcher passes `--profile <ziy-data>/<profile>`; the bootstrap script creates
   the profile skeleton itself (Firefox's `--CreateProfile` is unusable headless
   on our binary and pollutes the user's `profiles.ini`).
3. **A WebExtension suite (Manifest V3)** — the product features.
4. **A small native layer** — where extensions cannot reach (sync
   server, media capture).

This is the exact Brave-on-Chromium pattern re-hosted on Gecko: a thin
"browser product" layer over a stock engine.

### 1.2 Why this and not the alternatives

| option | verdict | why |
| --- | --- | --- |
| From-source Gecko fork | rejected | no passwordless sudo for the toolchain; 4-core/5.4 GB; 12–24 h first build; the probe measured all of this |
| Firefox *Nightly/ESR* + unsigned extensions (no app dir) | rejected | still needs the signing bypass (§1.4); owning the app dir is strictly better because we also control branding, prefs and the distribution addons in one place |
| Ship as a plain AMO extension | rejected | cannot rebrand the shell, cannot set locked prefs, cannot install our own unsigned suite, cannot own the NTP |
| Chromium/Kiosk | out of scope by product decision | the product decision fixes Gecko as the engine |

### 1.3 What Gecko 156 gives us, and what it does not (verified)

All facts below were read from MDN and from the installed engine's own sources
on 2026-10-14. Where Gecko and Chromium differ, the difference is stated
explicitly because it drives the design.

| capability | Gecko 156 | consequence for Ziy |
| --- | --- | --- |
| `manifest_version: 3` | supported | Ziy suite is MV3 throughout |
| `background.service_worker` | **not implemented** (Firefox bug 1573659) | we use `background.scripts` (an event page). MDN's cross-browser recipe is to declare **both** `scripts` and `service_worker`; Gecko then runs `scripts`. |
| `action` / `browser_action` | `action` (MV3) supported; `browser_action` is MV2-only on Gecko | one `action` per extension; Ziy's toolbar buttons are our own actions |
| `sidebar_action` / `sidebarAction` | supported (Firefox/Safari-flavoured, *not* Chrome's `sidePanel`) | Talk, Bookmarks panels are sidebar actions. Note: Gecko has **no** `setBadgeText`/`onFocus`/`onBlur` — our badge counts live in the panel DOM, not the API |
| `declarativeNetRequest` | **supported, including blocking without host permissions** | Shields' rule engine. This is the single most important API fact: on Gecko we get blocking rules *and* full `webRequest` (below) |
| `webRequest` **blocking** (`webRequestBlocking`) | **supported on Gecko, unlike Chrome MV3** | we keep an imperative path for what DNR cannot express (CNAME/DNS heuristics, consent un-bundling, per-tab counting) — the same uBlock-on-Firefox pattern the recon's hard-part list identifies |
| `scripting.executeScript` / `insertCSS` / `registerContentScripts` | supported (MV2 and MV3 on Gecko) | element blocker, Speedreader, cookie-consent un-bundling are `scripting` injections |
| `nativeMessaging` | supported | sync server + playlist media pipeline daemons |
| `storage.local` | supported, IndexedDB-scale quota | settings/top-sites/rule state |
| `chrome_url_overrides.newtab` | supported | **this is how Ziy owns its new tab page** |
| `theme` (`manifest.json/theme`) | supported (Firefox-only key, with `backgrounds_area` added in 156) | shell theming lives in a theme extension |
| `extensions.experiments.enabled` | ignored in release builds (constant `false`) | we cannot add privileged APIs; everything below is built from the public API set |
| On-Chromium-only APIs (`externally_connectable`, `storage` manifest key, `sidePanel`, service workers) | absent | designed around — no dependency on any of them |

Fetched: [MDN Firefox 156 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/156),
[MDN manifest.json key list](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json),
[MDN `declarativeNetRequest`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest),
[MDN `webRequest`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest),
[MDN `sidebarAction`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction),
[MDN `background`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background),
[MDN `scripting`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting),
[MDN `storage.local`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local),
[MDN Native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging).

### 1.4 The signing problem — and the verified solution

Firefox release builds enforce add-on signing. Read from the installed engine's
own `modules/AppConstants.sys.mjs` inside `/usr/lib/firefox/omni.ja`:

```js
MOZ_REQUIRE_SIGNING: true,
MOZ_ALLOW_ADDON_SIDELOAD: false,
```

and `AddonSettings.sys.mjs` (also inside `omni.ja`) turns those into hard constants
in release builds — `SCOPES_SIDELOAD` becomes `SCOPE_PROFILE` and
`isCorrectlySigned` in `XPIDatabase.sys.mjs` rejects anything with
`signedState <= SIGNEDSTATE_MISSING` for the `app-profile` location. That is why
a hand-placed `.xpi` in a profile's `extensions/` dir is silently ignored on
release Firefox.

**Verified fact:** `MOZ_REQUIRE_SIGNING` and `MOZ_ALLOW_ADDON_SIDELOAD` appear
**only** in that JS file — `strings firefox-bin | grep MOZ_REQUIRE_SIGNING` is
empty, and `libxul.so` does not contain them either. The file is *stored*
(uncompressed) inside the zip, so it can be rewritten in place.

**Ziy's approach — a one-time, audited install step:** the bootstrap script
rewrites `AppConstants.sys.mjs` inside our own copy of `omni.ja`, changing two
booleans (byte-length preserving, so every zip offset stays valid):

```
MOZ_REQUIRE_SIGNING: true,   ->  MOZ_REQUIRE_SIGNING: false,
MOZ_ALLOW_ADDON_SIDELOAD: false, -> MOZ_ALLOW_ADDON_SIDELOAD: true,
```

Consequences, all of which we verified are reachable:

- `distribution/extensions/<addon-id>.xpi` inside our app dir is installed
  automatically (the `extensions.installedDistroAddon.<id>` marker we observed
  in a probe profile's `prefs.js`).
- `extensions.sideloadScopes` becomes available, so `profile/extensions/<id>.xpi`
  sideloads work too.
- Ziy's whole suite is unsigned, built from our own repo, and cannot be
  silently replaced by anything from AMO.

**Honest statement of the risk:** this modifies a file inside Mozilla's
distribution. It is the standard "unbranded build" configuration that Mozilla
itself uses for Nightly/dev-edition and CI (`MOZ_REQUIRE_SIGNING` is *already*
a build-config constant set to `false` in those channels), applied by a
configuration layer rather than patched code. It is auditable in one `diff`, and
it is re-applied by the bootstrap on each Firefox upgrade. If a future Firefox
version moves these constants into the binary, Ziy's documented fallback is to
publish the suite as signed add-ons — see §7.

### 1.5 The remaining engine gap, and how it is covered

Gecko will not do several things Brave does in-engine (per the recon's
"engine-coupled" list). Each is covered in §5.4 either by a Gecko pref, an
enterprise policy, or a content script. Nothing in the feature matrix depends
on an engine change we cannot make.

### 1.6 Services (the Brave-owned backends, re-hosted)

| Brave service | Ziy implementation | why |
| --- | --- | --- |
| Sync chain (zero-knowledge) | `server/` — a Node 22 + Fastify + SQLite blind-storage service | one language with the rest of the product; the protocol is ours; "blind" means the server only ever sees opaque blobs |
| Brave News CDN | local RSS parsing in `extensions/news` | no CDN to clone; sources are the user's own |
| Talk (Jitsi-as-a-Service) | **minimal lobby + link handoff** to a self-hosted Jitsi Meet | see §4.6 decision: we ship the control surface and a real meeting, but not 8x8's capacity |

The Brave services Ziy deliberately does **not** re-host at all — not as a local
substitute, not as a shell page — are the ads/rewards economy (BAT settlement
rails, the ad demand marketplace, notification ads, NTP sponsored images,
creator tipping) and the crypto wallet. Both are cut by product decision
(§2.3); the rows stay in `features.csv` marked `cut` for the record.

---

## 2. Module decomposition

One directory per product area. Each is independently buildable and testable.

```
ziy/
├── shell/           # app dir template: application.ini, defaults, distribution, icons, launcher
├── extensions/      # the MV3 suite (one subdir per module)
│   ├── ziy-shell/       # branding, theme, chrome CSS, first-run tour
│   ├── ziy-shields/     # blocking engine + Shields UI
│   ├── ziy-news/        # feed reader
│   ├── ziy-playlist/    # media pipeline
│   ├── ziy-talk/        # call lobby + control surface
│   ├── ziy-ntp/        # new tab override (Ziy's NTP)
│   ├── ziy-sync/        # sync chain client
│   └── ziy-desktop/     # desktop integration helpers (import/export, default-browser)
├── native/          # native messaging hosts + daemons
│   ├── ziy-mediad/
│   └── ziy-sync-agent/
├── server/          # the blind sync storage service
├── brand/           # our own logo, colour, wordmark (no Brave assets)
└── tools/           # build, package, verify
```

### 2.1 `shell` — the Ziy browser product layer

Files: `browser/application.ini` (Ziy's own `App` id, `Vendor=Ziy`,
`Name=Ziy`, `RemotingName=ziy`), `browser/defaults/preferences/ziy.js`
(autoconfig enable + all locked defaults), `mozilla.cfg` (the autoconfig
script), `distribution/policies.json`, `distribution/extensions/*.xpi` (the
suite), `omni.ja` (patched per §1.4), `browser/chrome/` (Ziy chrome CSS),
`icons/`, and the launcher `bin/ziy`.

Verified mechanism chain, each step confirmed on this machine:

| step | file | evidence |
| --- | --- | --- |
| Our app dir is the running app | `browser/application.ini` with our id | `ps` showed `-appDir <ziy>/browser`, `-greomni <ziy>/omni.ja` |
| Default prefs load | `browser/defaults/preferences/ziy.js` | this is `mXULAppDir/defaults/preferences`, added unconditionally by `nsXREDirProvider::GetFiles` (`LoadDirIntoArray(mXULAppDir, kAppendPrefDir, …)`) |
| `distribution/` is read from the **GRE root**, not the app dir | `distribution/extensions/<id>.xpi` | `nsXREDirProvider`: `XRE_APP_DISTRIBUTION_DIR = GetFile(NS_GRE_DIR) + "distribution"`; our probe profile's `prefs.js` gained `extensions.installedDistroAddon.ziy-probe@ziy.local` |
| Autoconfig | `mozilla.cfg` at the GRE root + `general.config.filename` | the documented mechanism; `pref()`/`defaultPref()`/`lockPref()` calls run at startup |

Read from the installed engine's sources: `toolkit/xre/nsXREDirProvider.cpp`
(`NS_GRE_DIR`, `XRE_APP_DISTRIBUTION_DIR`, `kAppendPrefDir = {"defaults",
"preferences"}`), `modules/libpref` path list, and bug 861775 which documents
the move to `browser/defaults/preferences` (the plural, s-included form).

### 2.2 `extensions/ziy-shields` — the blocking engine

The heart of the product. Three cooperating parts:

1. **Filter-list parser** (`rules/`): ABP/uBO syntax — `||domain^`,
   `@@` exceptions, `$third-party`, `$script`, `$important`, cosmetic
   `##selector` rules, `:style(...)`. Own parser, no dependency on any list
   provider's code.
2. **Compiled rule engine** (`engine/`): the parsed lists compile to
   `declarativeNetRequest` rules (block / upgradeScheme / allow) for the
   network rules, and to a separate cosmetic table for `scripting.insertCSS`.
   Per-site overrides are applied as *higher-priority* DNR rules in the dynamic
   ruleset, per the precedence model in §5.3.
3. **Shields UI** (`ui/`): the toolbar action popup = S07/S08; the Advanced view;
   the blocked-items list; the element-blocker picker.

Because Gecko gives us both DNR *and* blocking `webRequest`, the engine keeps
an imperative listener for the three things DNR cannot do:
CNAME-cloaked-tracker heuristics (needs DNS, so it is a `should`-priority
approximation), redirect/AMP debouncing, and per-tab block counting for the
Shields badge.

### 2.3 The rest, one line each

| module | what it is | notes |
| --- | --- | --- |
| `ziy-shell` | theme + chrome CSS + first-run tour + desktop helpers | owns S01, S22, and the branding; no blocking logic |
| `ziy-news` | feed reader over user sources | S42; parsing in-extension, storage in IndexedDB |
| `ziy-playlist` | media queue + player | S43; capture via `webRequest.filterResponseData` + `native/ziy-mediad` |
| `ziy-talk` | lobby + control surface | S39/S40; handoff to a self-hosted Jitsi Meet |
| `ziy-ntp` | the new tab page | S02–S05, S51; a `chrome_url_overrides.newtab` page |
| `ziy-sync` | sync chain client | S27; the protocol in §4 |
| `ziy-desktop` | import/export, default-browser registration, xdg integration | F01/F23; everything that must touch the OS |

**Not built (by product decision)** — each of these appeared in the original
product's recon and was cut; the reasoning per item is in `replica/fixes.md`:

- **AI assistant (Leo)** — a hosted assistant is a hosted-model feature, and
  the product decision is "nothing in it but browsing".
- **Crypto wallet** — self-custody key custody is the single largest surface in
  the product for the least browsing value; no wallet ships in Ziy (S36–S38,
  F14–F16 stay recorded as intentionally absent in `features.csv`).
- **VPN** — no server backbone; a tunnel to nowhere is a fake feature.
- **BAT token economy and the ads/rewards economy** — a token economy needs
  settlement rails Ziy will not operate, and the whole revenue layer (ads
  earning, notification ads, sponsored NTP backgrounds, creator tipping, the
  ad campaign marketplace) is the feature theme users hate most. No ads, no
  token and no rewards ledger ship in Ziy (the `rewards`/`ads` rows stay in
  `features.csv` marked `cut` for the record).
- **Hosted model fleet** — any server-side model fleet is a hosted service,
  which is the thing the product decision removes.

### 2.4 Cross-module communication

Extensions cannot import each other's modules. They talk over
`browser.runtime.sendMessage` with the message schemas in §5.1, plus a shared
**settings bus** (`ziy-shared-settings`, see §3.1) that every module reads.

---

## 3. Data model

### 3.1 Storage engine assignment — which entity lives where, and why

Three engines, chosen per entity by lifetime, size, and who needs it.

| engine | used for | why |
| --- | --- | --- |
| `browser.storage.local` | small, always-needed, launch-critical state | synchronous-ish API, available before any UI mounts; quota is IndexedDB-scale on Gecko |
| **IndexedDB** (inside the owning extension) | anything big or queryable | no quota worry with `unlimitedStorage`, real indexes/cursors, and it stays private to the module |
| **native SQLite** (via native messaging) | only what extensions genuinely cannot do | media blobs outside quota, the sync server's own DB |

Concretely:

| entity (recon) | engine | store / table | why there |
| --- | --- | --- | --- |
| `Profile` | app-dir default prefs | `ziy.profiles.*` in `mozilla.cfg` | must exist before the first extension loads; a profile is a shell concept |
| `ShieldRule` (global defaults + per-site) | `storage.local` | key `shields.global`, `shields.site.<domain>` | read on every navigation; must be fast and must survive restart |
| `ShieldRule` fp sub-toggles | `storage.local` | `shields.site.<domain>.fp` | small, nested under the site rule |
| `FilterList` | `storage.local` | `shields.lists` | tiny metadata set |
| compiled rule set | IndexedDB (`ziy-shields`) | object store `rules`, key `ruleId` | up to ~10^5 rows; only the engine touches it |
| `BlockedItemLog` | memory + `storage.session` | `shields.session` | per the recon, counts reset on navigation — so this is session-scoped by design, never persisted |
| `ElementRule` | IndexedDB (`ziy-shields`) | `elements`, index on `domain` | cosmetic rules, cosmetic only |
| `NewTabPage` prefs | `storage.local` | `ntp.config` | read by the NTP page at load |
| `TopSite` (favorites) | IndexedDB (`ziy-ntp`) | `topsites`, index `mode` | ordered, paginated, up to 24 tiles |
| `TopSite` (frequent) | IndexedDB (`ziy-ntp`) | `topsites` computed from `places` | auto-populated, recomputed, never hand-edited |
| `Bookmark` | Gecko native bookmarks (`bookmarks` API) | — | G18: the shell already has a first-class bookmark store; a clone should use it, not rebuild it |
| `HistoryEntry` | Gecko native history (`history` API) | — | same reasoning |
| `Download` | Gecko native downloads (`downloads` API) | — | same |
| `PermissionGrant` | Gecko native permissions + `storage.local` | `perm.<origin>` only for what we override | the shell's permission store is the source of truth |
| `Extension` | Gecko `management` + our `distribution/` | — | Ziy's suite is installed by the app dir; user-added ones are managed by the shell |
| `SyncChain`, `SyncRecord` | native SQLite (`ziy-sync-agent`) | `chain`, `records` | credentials and the key must never sit in browser-accessible storage |
| `TalkRoom` | `storage.local` | `talk.room` | per-call transient state |
| `SyncableSetting` | `storage.local` | `settings.<key>` | the syncable key-value set |

### 3.2 Schema — the entities that need real structure

Gecko's native stores already give us Bookmarks/History/Downloads with the
recon's fields, so the schema below covers only what Ziy must own itself.

**`storage.local` keys (Ziy-wide settings bus)** — this is the one place any
module can read any other module's public settings, and the sync surface:

```
shields.global         ShieldRule (global defaults, recon's ShieldRule fields)
shields.site.<domain>  ShieldRule | null      (null = inherit global)
shields.lists          FilterList[]
settings.*             SyncableSetting rows (theme, sidebar mode, search engine, …)
ntp.config             NewTabPage
talk.room              TalkRoom
```

**IndexedDB: `ziy-shields`** (engine-owned, never read by UI directly)

```
rules      { ruleId: uint32 primary key,
             type: 'network'|'cosmetic',
             action: 'block'|'upgrade'|'allow'|'redirect',
             pattern: string,           // compiled ABP pattern
             regexp: string|null,       // for patterns needing it
             options: { thirdParty, resourceTypes[], important },
             priority: uint32,          // drives §5.3 precedence
             listId: string, source: 'list'|'custom'|'site-override' }
  indexes: on (priority), on (listId)

elements   { domain: string, selector: string, createdAt: uint64 }
  index: on (domain)

sessions   { tabId, domain, blocks: uint32, upgrades: uint32,
             scripts: uint32, fp: uint32, startedAt: uint64 }
```

There is no `ziy-rewards` IndexedDB database in this architecture: the rewards
ledger, the creator registry and the ad catalog are cut by product decision
(§2.3), so there is no local money store to design, migrate or secure.

**Native SQLite: `ziy-sync-agent`** — the only place chain material lives.

```sql
create table chain (
  id integer primary key check (id = 1),
  device_id text not null,
  device_name text not null,
  device_type text not null,
  created_at integer not null,            -- unix seconds, UTC
  last_sync_at integer
);

create table records (
  category text not null,                 -- 'bookmarks'|'settings'|'history'|...
  record_id text not null,
  updated_at integer not null,            -- unix seconds, UTC
  tombstone integer not null default 0,   -- 1 = deleted
  payload blob not null,                  -- ciphertext; the agent never reads it
  primary key (category, record_id)
);
create index on records (category, updated_at);
```

Times are unix seconds UTC in
SQLite and epoch ms in IndexedDB — one representation per engine, both UTC.

### 3.3 Migrations

Every IndexedDB store gets an integer `version` in the `open()` call, with a
`onupgradeneeded` that adds stores/indexes **additively and never destructively**
— the compiled rule set is history-bearing data we can never lose. The native
SQLite schema carries `user_version`, and the agent applies the same additive
rule.
Because Ziy's profile is ours and versioned by the bootstrap, we can also
refuse to start on a profile newer than the binary supports (`compat` check in
`profile.json`) rather than guess.

---

## 4. Sync protocol design (Brave Sync's posture, Ziy's protocol)

Brave's chain: 24 words plus a rotating 25th word, categories are per-device
toggles, and what a chain's server holds is opaque to it. `features.csv` keeps
all of that as `must`.

**Where the Brave-side facts come from:** `replica/re-deep-sync.md` — the real
protocol read out of `brave-core` 1.99.40 and `brave/go-sync` on 2026-10-14
(key derivation, record shape, server protocol, quotas, auth). Citations like
(`re-deep-sync.md` §1) point at that doc's evidence. Two corrections against the
previous version of this section are recorded in §4.3 (what the server can see,
and record ids) and §4.7 (the 25th word). Every place where we are stricter than
Brave is marked **ours, stricter**, and is not to be "fixed" toward Brave later
without a deliberate change to the privacy promise.

### 4.1 Key derivation

**What Brave actually does** (`re-deep-sync.md` §1). The 24 words are the BIP39
mnemonic of a raw 32-byte CSPRNG value, and **those 32 bytes are the HKDF input
keying material directly**. There is no BIP39 seed step — no PBKDF2, no
`"mnemonic"` salt, no optional passphrase. `PassphraseFromBytes32` /
`PassphraseToBytes32` are plain wally-core reversals, and validation is exactly
"a valid BIP39 mnemonic with a valid checksum". Brave then derives **exactly
one** key:

```
entropy (32 bytes = the 24 words)
  -> HKDF-SHA512(ikm=entropy, salt=fixed 64-byte constant, info="sync-auth-key", L=32)
  -> Ed25519 keypair (the 32-byte HKDF output is the seed)
```

That single keypair signs the server-auth token and nothing else: record
encryption is **Chromium's Nigori** (AES-256-GCM with a keybag of per-type
keys), which Brave reuses unchanged rather than extending. So a real Brave chain
has no category key, no record key, no per-chain salt and no chain id — the HKDF
salt is a hard-coded 64-byte array, identical in every build.

**Ziy's tree** — ours, a divergence, with the reasons it is worth the divergence
stated below:

```
entropy (32 bytes = the 24 words)                              [Brave-verified]
  -> master   = HKDF-SHA512(entropy, salt=chain_id, info="ziy-sync/v1", 32)
  -> category = HKDF-SHA512(master,  salt="cat:"+name, info="ziy-sync/v1", 32)
  -> record   = HKDF-SHA512(category, salt=<client-stable record id>, info="rec/v1", 32)
  -> auth     = HKDF-SHA512(master, salt=chain_id, info="ziy-sync/v1/dev-auth|"+local_device_id, 32)
                -> Ed25519 keypair, one per device (32-byte output as the seed)
```

- The chain id is a random 128-bit value generated at chain creation; it is the
  salt that binds every key to this chain. It travels **outside** the word code
  (it is not secret — the words are) so that the same words in two chains yield
  different keys.
- The per-record salt is the **client-stable** record id, never the server's
  renamed id (§4.3): the server re-keys a record to its own uuid on create, so
  a server id must never be able to re-key a record's ciphertext.

Parameters taken from the verified implementation rather than invented:

- **SHA-512** for every HKDF in the tree. Brave's only KDF is `HKDF(...)` with
  `EVP_sha512()`; SHA-256 would be a gratuitous divergence from the one KDF the
  real client uses.
- **Info labels** are short ASCII strings, one per purpose — `"sync-auth-key"`
  in Brave; per-level labels here. Distinct labels mean the master, a category
  key, a record key and the device-auth key cannot coincide even if a salt
  collides.
- **Salt discipline** is where we part company: Brave salts once, with a
  compile-time constant, and never per record or per category. Our per-level
  salts are the point of the tree, not an oversight.
- **Ed25519 stays**, for device identity and for the auth token.
- **One keypair per device.** Brave derives no device input at all, so every
  device in a chain derives the *identical* keypair and the pubkey hex names the
  chain rather than the device (per-device identity travels separately as
  Chromium's `cache_guid`, which is not the pubkey). Our `dev-auth` derivation
  includes the local device id, so a signature identifies a device — which is
  what makes §4.2's per-record signature meaningful, and why the wire chain
  identity cannot simply be a device pubkey (§4.3).

Why keep the tree instead of Brave's single key: **one leaked 24-word code
cannot be replayed into a second chain with the same keys.** Brave's
"the chain is the pubkey" model is simpler and cannot express that. The cost of
ours is that the chain id must be transported.

Two constructs deliberately **not** adopted, both because the verified facts
rule them out:

- **No BIP39 seed step (no PBKDF2).** It costs 2048 SHA-512 rounds per
  derivation, protects nothing (a mnemonic is not a password) and is not what
  Brave does.
- **No passphrase, and no 25th word in `info`.** Brave's rotating word is
  stripped before any crypto (§4.7); mixing a time-bucketed word into a key's
  `info` would make records written yesterday unreadable today.

**Library choice (offline-verified on this machine):**
`crypto.subtle` (`HKDF`, `generateKey`) works in Node 26's `webcrypto` — probed,
`HKDF OK 32 bytes`, and `Ed25519`/`X25519`/`P-256` all generate. Extension
contexts get the identical API via `crypto.subtle` in a normal page context.
So: **WebCrypto everywhere, no external crypto dependency** — which is exactly
what a privacy-posture product wants (one primitive set, one audit surface).

### 4.2 Crypto for device auth and transport

- **Device identity:** an Ed25519 keypair per device (§4.1), derived with the
  local device id in the derivation, so a signature identifies a device and not
  merely "someone holding the words". Verification of "this record came from
  device X" is Ed25519 over `(category, record_id, updated_at)` with the device's
  public key.
  **What Brave signs is much less**: one ASCII-decimal timestamp, nothing
  per-record — per-record authenticity is not a thing the real protocol has
  (the ciphertext's integrity is the whole story, and every device in a chain
  shares one keypair). Ours deviates on purpose and costs one signature per
  record.
- **Auth token shape** (`re-deep-sync.md` §3, Brave's `brave_sync_auth_manager.cc`):
  sign the ASCII-decimal **network-time** timestamp, then send
  `base64url(timestamp_hex | signature_hex | pubkey_hex)`. Our server validates
  `ed25519.Verify(pubkey, ascii_timestamp, signature)` and then the timestamp
  window.
  - **The window is ±1 day from NETWORK time, not from our clock.**
    `TokenMaxDuration = 86400 * 1e3` ms, and the client gets its timestamp from
    `NetworkTimeTracker` precisely because a skewed client produces a token the
    server rejects. Our server therefore MUST validate against a network time
    source — a `Date` header cross-check on the inbound request, or a fetched
    reference time — and MUST NOT trust its own local clock alone. A wrongly
    retrograde local clock is the failure mode this defends against.
  - Encoding is **base64url** (`-`/`_`), so the token survives a URL context.
- **Record encryption:** XChaCha20-Poly1305 is not in WebCrypto. Use
  **AES-256-GCM** (WebCrypto, ubiquitous) with the per-record key above. That is
  a defensible, boring choice; the alternative would be bundling libsodium
  (`pynacl` is present on this box for the *native* agent, but we do not need
  it, and fewer crypto deps is better). It is also, on the verified facts, the
  cipher the real records are protected with: Brave's own crypto module is
  NaCl secretbox (XSalsa20-Poly1305), but `crypto::Encrypt` has **zero call
  sites** in the shipped product — records are encrypted by Chromium's Nigori,
  which is AES-256-GCM.
  - **Nonce: Brave's construction, truncated, not 12 random bytes.** Brave's
    `GetNonce` is `counter(2B BE) || random(20B) || implied zero(2B)` for a
    24-byte secretbox nonce, with the counter incremented per interval as a
    partial replay defence. AES-GCM's 96-bit nonce cannot hold all of it, so we
    take the first 12 bytes — `counter(2B BE) || random(10B)` — which keeps the
    replay counter and the bulk of the randomness. The record key already
    changes per record, so nonce-reuse across records is not reachable by
    collision.
  - **AAD is ours, and is a deliberate stricter delta.** Bind
    `(category, record_id, updated_at)` as AES-GCM additional authenticated
    data — the exact fields §4.2 already signs. Brave cannot do this at all:
    secretbox takes no additional data, and Nigori's GCM blobs carry none
    either. It is free in WebCrypto, and it means a server that renames or
    re-coins a record into another record's context cannot make the tampered
    ciphertext decrypt — the record is authenticated against its own envelope,
    not just present in the store. Do not "align" this back to Brave.
- **Transport:** TLS 1.3 with cert pinning of the server's key. The server can
  read nothing either way — pinning only protects against MITM of an already
  blind store. (Brave does not pin the sync path; it adds a build-time
  `BraveServiceKey` static header and the per-request signature. Pinning is
  ours, free, and strictly better — not parity.)

### 4.3 Record format, and what the server really sees

```json
{ "category": "bookmarks",
  "client_record_id": "3f2a…",   // our stable id for this logical record
  "server_record_id": "…",       // uuid assigned by the server on create (§4.3.2)
  "updated_at": 1761000000,
  "version": 42,                 // SERVER-stamped: the server's own mtime in ms (§4.3.3)
  "tombstone": false,
  "nonce": "<base64 12 bytes>",  // counter(2B BE) ‖ random(10B), per §4.2
  "payload": "<base64 AES-GCM ciphertext>",
  "aad_bind": "(category, record_id, updated_at)",   // §4.2, ours, stricter
  "signer": "<base64 Ed25519 public key>",
  "sig": "<base64 64 bytes>" }
```

#### 4.3.1 The wire shape

Adopted from Brave's real server (`re-deep-sync.md` §3, §5) — a **single
`POST /command/` endpoint** carrying protobuf bodies. There is no separate auth
endpoint, no fetchblob, no poll path; auth is the bearer token of §4.2. Requests
are `ClientToServerMessage` (optionally gzipped, capped at **10 MiB**) and
responses are `ClientToServerResponse`. The three message contents are
`GET_UPDATES`, `COMMIT` and `CLEAR_SERVER_DATA`. Our server is one endpoint with
one protobuf schema, exactly like the real one.

#### 4.3.2 Records: client id, server id, and how they map

The verified protocol is **client-chosen, server-renamed**: on a create, the
server replaces the client's id with `uuid.New().String()` and keeps the
client's `OriginatorClientItemID`/`OriginatorCacheGUID` so client-generated ids
can be mapped back to server ids. Parent ids are rewritten through the same map.
(The one exception in the real server is history, which keys on the client-tag
hash for dedup.)

So our records carry **two ids**, and the mapping is explicit:

| id | who assigns | what it is used for |
| --- | --- | --- |
| `client_record_id` | the writing device | the logical identity of a record, and the **per-record HKDF salt** (§4.1) — never sent to the server in the clear, and never re-derived from a server id |
| `server_record_id` | our server, a uuid on create | the server's storage key for that record |

`OriginatorClientItemID` is retained server-side as the mapping, exactly as the
real protocol does. Consequences our client must honour:

- An update or delete must reference the **server** id (or the originator map)
  to find the stored record, while the keys stay bound to the **client** id.
- Record **parent** references must survive the rename; store the client-side
  parent id inside the encrypted payload so folder structure does not depend on
  the server's id space.

**Our `SyncChain id` is a derived identity, not a separate chain identifier.**
In the verified protocol there is no chain id at all: the chain *is* the device
Ed25519 public key hex, and everything for the chain is stored under that
partition key. We cannot copy that exactly, because our auth key is per-device
(§4.1) — a single pubkey hex would name one device, not the chain. So:

```
SyncChain id (client-facing, displayed)  = hex(HKDF-SHA512(master, info="ziy-sync/v1/chain-id", 32))
SyncChain id (wire / server partition key) = base64url(that 32 bytes)
```

The wire identity is therefore **derived from the chain master key** — the same
derivation on every device in the chain, and distinct per chain because the
master's salt is the chain id. It travels nowhere; it is recomputed from the
words plus the chain id. (Our §3.2 entity table keeps calling it `SyncChain id`;
that is the client-facing label for this derived value.)

#### 4.3.3 Commit, conflict, and the privacy boundary

**Commit is pessimistic version-conditional.** The server generates
`version = mtime = now.UnixMilli()` on write and **rejects a stale write**: an
update is a conditional write on `version`, and a mismatch returns
`CommitResponse_CONFLICT` without storing the entry. This replaces the old
"enforce `updated_at` is monotonic, last-write-wins on the encrypted record"
wording, which was wrong in an important way: LWW trusts the client's clock, and
a client that can pick `updated_at` can win any tie. Here the clock input is the
server's, and the client resolves a conflict instead of the server silently
picking a winner. Where a deterministic tie is unavoidable our order is **server
mtime, then a stable client-record-id ordering** — not device id (our device ids
are forgeable by construction: anyone holding the words derives one).

**What our server sees.** Per entity: the partition key (derived chain id), the
record ids, `version`, `mtime`, the payload **size**, the signature, and the
`deleted` flag. Per chain: the device count, and the record counts.

**Deleted.** The real server stores deletion as a `deleted` flag on the entity
and lets Chromium's delete directives carry the semantics. We keep our
tombstone-record form (§4.5) — same observable effect (a device that fetches
deletes sees them as such), simpler on SQLite — and the server's own
server-visible record is still just `{ids, version, mtime, size, sig}`, so
switching the internal representation leaks nothing.

**What the real Brave server can see — and why we are not that.** In Brave's
design the server sees plaintext **`Name`/`NonUniqueName`** (a bookmark's title,
a folder's name) and the plaintext per-entity **`DataType`** id (i.e. which
categories a chain holds). Record contents stay encrypted, and no key or word is
ever transmitted — but the entity *name* is not protected, and neither is the
category. **Ziy does not store names or category ids in the server-visible
fields at all.** Both live inside the encrypted payload, and the per-entity
category id is not written server-side.

That is a deliberate delta, not an unimplemented piece of Brave's protocol, and
it is the one thing to preserve above all else:

> **Never add a plaintext `name` field, a per-entity plaintext category id, or a
> plaintext timestamp-derived metadata row to the sync server.** "Aligning with
> Brave" here would break the privacy promise — the server is supposed to be
> unable to read a bookmark's title even in principle. If a feature seems to
> need it, the answer is to put it in the ciphertext, not the envelope.

**Retiring the old claim.** The previous version of this section said the server
"never sees a key, a word, or a domain", and §4.4 said "the server's ignorance
of categories is the whole privacy claim". The first is still true of keys,
words and URLs. The second is false of Brave and was a misstatement: Brave's
server *does* see categories. The privacy claim that survives — and that we
actually implement — is **content blindness**: no record, name or category is
readable by the server.

#### 4.3.4 Quotas and device cap (adopted from the verified server)

| limit | value | source |
| --- | --- | --- |
| request body cap | 10 MiB (protobuf, gzip optional) | `payloadLimit10MB` |
| `GET_UPDATES` batch | 500 entries max | `maxGUBatchSize` |
| `COMMIT` batch | 90 entries max | `maxCommitBatchSize` |
| object quota per chain | 50 000 | `maxClientObjectQuota` |
| history object quota per chain | 30 000 | `maxClientHistoryObjectQuota` |
| per-entity size threshold | 400 KiB (reject above) | `LargeSizeThreshold` |
| active devices per chain | 50 | `maxActiveDevices` |

Our server enforces these as documented limits, so it fails the same way the
real one does instead of by accident. A chain that exceeds a quota gets a
rejection, and the device cap is enforced on join (`THROTTLED`). History
entities carry a server-side expiry — 14 days in Brave — so stale history
tombstones do not accumulate forever; §4.5 keeps our own GC rule on top.

### 4.4 Per-category toggles, and why they are enforced client-side

Categories are the recon's list: `bookmarks`, `passwords`, `autofill`,
`history`, `open_tabs`, `extensions`, `themes`, `apps`. A device with category
`X` off **neither sends nor accepts** `X`. Enforced in the client, not the
server — a toggle must not be able to read another device's data. This is
verified: Brave does exactly this ("type not selected ⇒ not synced in either
direction", stock Chromium behaviour with no Brave patch restricting it), so our
semantics match the real thing.

The rationale is **not** "the server cannot see categories". It can, in Brave's
design; ours can too, for record sizes. The claim is narrower and firmer:
enforcement in the client means a category toggle can never widen what a device
*reads* from another device, and our server additionally never stores the
category at all (§4.3.3).

### 4.5 Tombstones

Deletion is a record with `tombstone: true` and an empty payload. It is
retained until every known device has acknowledged it past `last_sync_at`, then
garbage-collected by the server. Hard-deleting on first sync would resurrect
the record on a device that was offline.

Verified refinements: the real server stores deletion as a `deleted` flag on the
entity rather than a separate empty-payload record (the actual tombstone
semantics live in Chromium's delete directives) — we keep the record form,
because on SQLite it is simpler than modelling a delete-directive protocol, and
it maps 1:1 onto the `records` table we already have. Two additions:

- **History tombstones expire server-side** — 14 days in the real server
  (`HistoryExpirationIntervalSecs`), beyond which the entity is TTL'd away.
  Apply the same cap to ours so history tombstones cannot accumulate forever,
  on top of the client-ack GC rule above.
- The GC rule matters for ordering, not just hygiene: processing a history
  delete directive *before* the history it refers to wrongly deletes live
  entries, which is exactly why the real server survives them for a while.

### 4.6 Decisions recorded, with the trade-off stated

| decision | choice | alternative rejected |
| --- | --- | --- |
| server stack | Node 22 + Fastify + SQLite, single binary | a hosted Postgres (unneeded for a blind KV store) |
| server shape | one `POST /command/`, protobuf bodies, bearer token | Brave's real shape, verified and adopted — see §4.3.1 |
| crypto | WebCrypto AES-256-GCM + Ed25519 | libsodium (one fewer dependency; WebCrypto is on-device) |
| key tree | HKDF-SHA512, per-level salts, chain-id salt, one keypair per device | Brave's single fixed-salt keypair (no chain binding, no per-device key) — and, in the other direction, a BIP39 PBKDF2 seed step and a 3-level tree with no test coverage |
| record ids | client id for keys, server-renamed uuid for storage, mapped | a single shared id (impossible: the server re-keys on create) |
| versioning | server-stamped version + conditional write, `CONFLICT` on mismatch | client-clocked last-write-wins with a device-id tie-break (a skewable clock can win any tie) |
| wire chain identity | derived from the chain master key, not a random id | a random chain id as the partition key (Brave has no chain id; a pubkey hex names one device in our per-device-key design) |
| names & categories | encrypted, never in server-visible fields | Brave's plaintext `Name`/`DataType` on the server (§4.3.3) |
| Talk backend | minimal lobby + link handoff to self-hosted Jitsi | full Jitsi self-host as *our* build (heavy, and Brave's economics are the `skip` row anyway) |
| News | local RSS | cloning Brave's CDN (impossible) |

### 4.7 The rotating 25th word — what it actually is

**It derives nothing cryptographically.** In the verified implementation the
25th word is `BIP39_WORDLIST[ round(days_since_epoch) mod 2048 ]`, computed
locally from a hard-coded epoch — no network fetch, no published URL — and it is
**stripped before any crypto**: the joiner validates the first 24 words as a
BIP39 mnemonic, uses the 25th as a witness that the code is current, and feeds
only the 24 pure words to the seed. It is the same seed the 24 words alone would
produce. So the 25th word is a **date witness and a join gate, and nothing
else** — the previous version of this section mixing it into `info` was wrong,
and would have locked yesterday's records out of today's keys.

**The time-bucket scheme** (verify against `re-deep-sync.md` §6 before relying on
the constants): `days = round((now - epoch) / 1 day)` with
`epoch = 2022-05-10`, then `word = wordlist[days mod 2048]`. Because the day
count is *rounded*, not truncated, a code is valid for roughly **±1 day** around
its day boundary — the practical rule is **accept today's word, yesterday's, or
tomorrow's**, never today's alone. A single-day bucket rejects codes that join
validly. Out of the window, the join fails as expired/not-yet-valid.

Two things to hold on to when building the join UI:

- **Bare 24 words are not accepted.** Brave rejects them outright
  (`kVersionDeprecated`) after the v1 sunset date; ours need not be that harsh,
  but our flow must require the 25th word just as the real one does.
- **QR is the mobile path and is separate.** The real QR payload is
  `{"version":"2","sync_code_hex":…,"not_after":…}` — hex-encoded words with a
  ~30-minute validity, and the validator rejects codes valid for more than an
  hour. The rotating word and the QR window are two different clocks.

---

## 5. API surface

### 5.1 Inter-extension messages (`browser.runtime.sendMessage`)

Every message is `{ id, from, to, op, body }`. Handlers must be idempotent.

| op | from → to | body | when |
| --- | --- | --- | --- |
| `shields.state` | any → `ziy-shields` | `{tabId}` | popup/panel open |
| `shields.setSite` | `ziy-ntp`, `ziy-shell` → `ziy-shields` | `{domain, patch}` | a UI changes a per-site rule |
| `shields.counts` | `ziy-shields` → any | `{tabId, blocks}` | badge/panel updates |
| `shields.blocksFeed` | `ziy-shields` → `ziy-ntp` | `{total, perDomain}` | NTP stats widget |
| `ntp.config` | `ziy-shell` ⇄ `ziy-ntp` | `{patch}` | dashboard toggles |
| `sync.now` | any → `ziy-sync` | `{}` | user hits sync |
| `settings.changed` | any → any | `{key, value}` | the shared bus event |

### 5.2 Native messaging (`runtime.connectNative`)

Length-prefixed JSON, one JSON object per message, on stdin/stdout.

| host | ops | notes |
| --- | --- | --- |
| `ziy-mediad` | `media.open {url, mime, referer}`, `media.read {itemId, range}`, `media.close`, `media.list` | large blobs bypass IndexedDB quota |
| `ziy-sync-agent` | `chain.create`, `chain.join {words}`, `chain.status`, `sync.push {category, records}`, `sync.pull {since}`, `chain.leave` | holds the key material; nothing key-related crosses into the browser |

The host manifest's `allowed_extensions` lists exactly our suite ids, and the
manifest is installed into `~/.mozilla/native-messaging-hosts/` by our
bootstrap (the documented per-user location on Linux).

That path is a **Linux** fact, not a cross-platform one: on Windows the manifest
goes into the per-user Mozilla app-data tree (exact path `low — unverified`, §0.4),
and on Android there is no manifest at all — the GeckoView app is the message peer
(§0.1). Nothing about the message protocol in the table changes; only the
transport plumbing does.

### 5.3 The Shields precedence model (recon S07/S08/S10)

Resolution order for any decision on a request in a tab:

```
1. session override      (element blocker, "block element" for this page only)
2. per-site override     shields.site.<domain>   (persisted, wins over global)
3. sub-toggle override   the fp / cookie / script / https sub-toggles
4. global default        shields.global
5. factory default       (Standard mode, fp on, https upgrade auto)
```

Two rules the recon is explicit about, both preserved:

- **A per-site override is never rewritten by a later global change** — it is
  stored as an absolute rule, not a diff. This is why `shields.site.<domain>`
  holds a full `ShieldRule`, not a patch.
- **Counts reset on navigation** — `BlockedItemLog` is session state.

The sub-toggles inherit the same shape: each is tri-state
(`global` | `on` | `off`) so "inherit" is representable, which is what makes
rule 1 above true.

### 5.4 Engine-coupled features: the shell/policy layer

These are the recon's "engine-coupled" list. Each is implemented as a **pref or
policy**, not an engine change. This is the whole reason the product decision
is workable.

| feature | mechanism | file / pref |
| --- | --- | --- |
| Fingerprint randomisation | Gecko's own RFP | `privacy.resistFingerprinting = true` (policy-supported prefix, Firefox ≥ 141) and `privacy.fingerprintingProtection.granularOverrides` for per-target on/off (e.g. `+AllTargets,-CSSPrefersColorScheme`). The target list is in `RFPTargets.inc` — `CanvasRandomization`, `WebGLRenderInfo`, `NavigatorHWConcurrency`, `JSLocaleLocale`, `ScreenRect`, `ReduceTimerPrecision`, … | 
| Per-fingerprint sub-toggles | the same pref, written per-site via autoconfig on Shields changes | `privacy.fingerprintingProtection.granularOverrides` |
| Disable a list of APIs (Battery, WebBluetooth, Serial, NFC, Idle Detection, File System, Network Information, …) | policy `Preferences` + user prefs | `dom.battery.enabled=false`, `dom.webbluetooth.enabled=false`, `dom.serial.enabled=false`, `dom.nfc.enabled=false`, `dom.idle-detector.enabled=false`, `dom.filesystem.enabled=false`, `dom.netinfo.enabled=false`, `dom.event.contextmenu.enabled=false` (where applicable) |
| Cookie behaviour | Gecko's own enhanced tracking protection + policy | `network.cookie.cookieBehavior`, `network.cookie.lifetimePolicy`, `privacy.partition.network_state` |
| HTTPS upgrade / strict mode | policy `HttpsOnlyMode` | `dom.security.https_only_mode` |
| Referrer capping | pref | `network.http.sendRefererHeader=2` (strict-origin-when-cross-origin) |
| Telemetry / studies off | policy | `DisableTelemetry`, `DisableFirefoxStudies`, `datareporting.healthreport.uploadEnabled=false` (locked) |
| DNS prefetch off | policy `NetworkPrediction` | `network.dns.disablePrefetch=true` |
| Disable Firefox Accounts/sync (so only Ziy sync exists) | policy | `DisableFirefoxAccounts` |
| Error-noise off (no "report this site to Mozilla") | policy | `DisableFeedbackCommands` |
| Only our add-ons | policy | `ExtensionSettings` locking the suite ids; `InstallAddonsPermission` if desired |

`policies.json` is the vehicle for the enterprise-shaped settings; the remaining
ones ride in `browser/defaults/preferences/ziy.js` / `mozilla.cfg`. The split is
deliberate: **policies for what must be locked, autoconfig for defaults the user
may change.**

---

## 6. MVP slice (honest ordering)

The goal of the first slice is a single sentence a user can verify:
**"Ziy launches, is branded, blocks trackers, and shows a working NTP."**

**Slice 1 — the vertical slice (proves the shell):**

1. `tools/build-shell.sh` produces `build/ziy/` — the patched app dir
   (§1.4) with Ziy's `application.ini`, branding, `mozilla.cfg`,
   `distribution/`, and the suite.
2. `tools/bootstrap-profile.py` creates `~/.ziy/profiles/default/` (the profile
   we own) with `user.js`, `chrome/userChrome.css`, and our prefs.
3. `tools/ziy` launcher: `exec firefox --profile …` with our app dir, our own
   `.desktop` entry, our own icon, and our own name.
4. `ziy-ntp` — a real NTP page: search box, top sites, clock, stats widget,
   background. This is what makes Ziy *look* like Ziy.
5. `ziy-shields` — the parser + DNR engine + the panel. Enough to block on a
   real site and show a real count.
6. `ziy-shell` — theme + chrome CSS so the window is branded.

Acceptance for slice 1 is in §7.

**Then, in order (Must-priority Shields/NTP/sync first, per the recon's sizing
advice and this install's stripped-Brave evidence):**

| # | milestone | modules | screens / flows |
| --- | --- | --- | --- |
| 2 | Sync works between two Ziy installs | `ziy-sync`, `server/`, `ziy-sync-agent` | S27, F20 |
| 3 | Talk lobby | `ziy-talk` | S39–S40, F11 |
| 4 | News + Playlist | `ziy-news`, `ziy-playlist`, `ziy-mediad` | S42, S43, F10/F27 |
| 5 | Desktop integration polish | `ziy-desktop` | F01/F23, S24/S26, S49/S50 |

Every milestone is end-to-end and testable before the next starts. (Rewards +
NTP sponsored images was milestone 5 until the ads/rewards economy was cut by
product decision, and VPN was milestone 6 until it was cut the same way — both
§2.3; those milestones do not exist and the table is renumbered rather than left
with a gap.)

---

## 7. End-to-end acceptance criteria

### 7.1 From clone repo to a running browser

```bash
git clone <repo> ziy && cd ziy
npm ci                       # the extension suite build
./tools/build-shell.sh       # -> build/ziy/  (patched app dir + suite + distribution)
./tools/build-extension.sh   # -> build/ziy/distribution/extensions/*.xpi
./tools/install-native.sh    # writes native-messaging manifests into ~/.mozilla/native-messaging-hosts
./tools/bootstrap-profile.py # -> ~/.ziy/profiles/default/
./tools/ziy                  # launch
```

A user runs nothing else. `./tools/ziy` is the only command that starts the
product; everything before it is packaging.

The sequence above is the **Linux** reference sequence. It has two more variants,
and only the packaging lines change (§8, `packaging/`):

| platform | commands |
| --- | --- |
| Windows | `npm ci`, `./tools/build-shell.ps1` (resolves the versioned Firefox install dir per §0.1), `./tools/build-extension.sh`, `./tools/install-native.ps1` (writes the native-messaging manifests into the Windows per-user Mozilla tree), `./tools/bootstrap-profile.py` (profile root `%LOCALAPPDATA%\Ziy\profiles\default`), then the installer output of `packaging/windows/` |
| Android | `npm ci`, `./tools/build-extension.sh` (the suite, BCD-gated per §7.2), `./tools/install-native-android.sh` (bundles the suite into the APK's `assets/` for `installBuiltIn`), then the Gradle build in `packaging/android/` |

### 7.2 Verifying each major feature

| feature | how a user verifies it |
| --- | --- |
| Ziy is the product | window chrome carries our wordmark/icon; `about:policies` shows our policies; the profile path is under `~/.ziy/` |
| Shields on by default | open a tracker-heavy site, the lion shows a non-zero count, the count list names the trackers |
| Per-site override | Advanced view → Scripts off → reload → scripts run; turning it back on restores blocking |
| Filter lists | `about:addons` lists our suite; adding a custom list URL changes blocking behaviour |
| NTP | new tab shows our widgets, top sites persist across restart, clock obeys the 12/24h toggle |
| Sync | add a bookmark on device A, restart device B, it appears; leave the chain, the server cache is empty |
| News | add an RSS source, see items, open links in the chosen destination |
| Playlist | add a media item from a site, play it, reorder |
| Talk | create a room, copy the link, a second browser joins over the self-hosted Jitsi |
| Hardening | `about:config` shows our locked prefs; tracking protection settings; the disabled APIs are disabled |
| No ads, no rewards economy | `about:addons` lists the suite and there is no rewards module in it; the policies declare no rewards id; the NTP shows no sponsored image on any new tab, including the fourth; no OS notification arrives unless the page asks for it; there is no BAT icon in the address bar and no contribution/tipping surface anywhere in the UI |

Automated: `tools/verify.sh` runs the headless profile checks —
an extension is active, `prefs.js` contains the locked values, a screenshot of
the NTP is non-blank, and the sync round-trip between two temp profiles passes.

**The harness is per-platform, and the per-platform differences are part of the
acceptance definition** — a check that only means something on one OS is not a
global check.

| platform | harness differences (what changes, and why) |
| --- | --- |
| Linux (reference) | as written above: headless profile checks, `/tmp` scratch profiles, NTP screenshot, two-temp-profile sync round-trip, headed live run for the NTP (Firefox 156's activity-stream will not screenshot headless — §9 risk 3) |
| Windows | **No `/tmp` paths anywhere** — scratch profiles, temp XPIs, screenshot output and the sync round-trip's temp dirs all resolve under a temp dir the script derives (`%TEMP%` / `TEMP` env var, not a hardcoded `/tmp`), because `/tmp` does not exist and a POSIX-y path silently writes to the wrong root. **The profile root is `%LOCALAPPDATA%\Ziy\profiles\default`** (naming convention §8), never `~/.ziy`. Launcher, desktop-entry and icon steps are replaced by their Windows equivalents; the app-dir stage resolves the *versioned* install subdirectory (§0.1) instead of a fixed Firefox path. |
| Android | **No headless screenshot of the NTP — there is no extension-owned NTP to screenshot** (§0.2). The gate is instead: (1) **Espresso tests** of the GeckoView app shell (tab open/navigate/reload, menu, home screen), and (2) **unit tests of the extension suite** — the same JS test suites the desktop build runs, plus a compatibility assertion per extension that every manifest key and runtime API it declares is actually supported on `firefox_android` (BCD-driven, so a desktop-only key fails the build instead of silently no-opping). Blocking behaviour is asserted by loading a fixture page and counting blocked requests, not by looking at the UI. |

### 7.3 How `features.csv` `clone` columns flip

`clone` starts `no` for every row. It becomes `yes` only when:

1. the feature has an implementation in the tree (not a plan),
2. it is exercised by an entry in `tools/verify.sh`,
3. and the verify entry passes on this machine.

Nothing flips on a design doc. Rows that stay `no` forever carry the reason:
`skip` for Guardian backbone, Widevine, site isolation (all already `skip` in
the matrix); `cut` for the ads/rewards economy and the crypto wallet, both cut
by product decision (§2.3, `replica/fixes.md`); plus any `should`/`could` row
that is consciously deferred, which is recorded as `deferred` in the notes
column rather than silently left `no`.

**The `platforms` column** (added with the multi-platform requirement) is set on
every row: `desktop+android`, `android-partial`, or `desktop-only`, with the
reason in the notes. A `clone` flip is **per platform**: a row flips to `yes`
only when it is implemented *and* verified on the platform its `platforms` value
claims. A `desktop-only` row can never flip on Android, and the reason is in its
notes — that is the mechanism that keeps the Android story honest (§0.2) instead
of aspirational.

---

## 8. Repo layout

```
ziy/
├── README.md
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # push/PR: node tests + tools/verify.sh on ubuntu-latest
│   │   ├── build-windows.yml   # windows-latest: portable zip + installer artifacts
│   │   └── build-android.yml   # ubuntu-latest: unsigned + signed APK variants (secrets)
│   └── (codeql/dependency workflows, if/when wanted — not part of this plan)
├── replica/                      # the clean-room record (recon, features, screens, proofs)
│   ├── recon.md
│   ├── features.csv
│   ├── screens/
│   └── proofs/                   # verification commands + captured output for §1/§2 claims
├── brand/
│   ├── logo.svg                  # Ziy's own mark (shield + lion silhouette, our design)
│   ├── logo-48.png  logo-96.png
│   ├── wordmark.svg
│   ├── colors.md                 # our palette
│   └── fonts/                    # self-hosted, licensed fonts
├── shell/
│   ├── browser/
│   │   ├── application.ini       # Ziy's App id, Vendor=Ziy, Name=Ziy, RemotingName=ziy
│   │   ├── defaults/
│   │   │   └── preferences/
│   │   │       ├── ziy.js        # autoconfig enable + all default prefs
│   │   │       └── ziy-hardening.js
│   │   ├── chrome/
│   │   │   └── userChrome.css    # Ziy window chrome
│   │   └── omni.ja.patch/        # the two-line AppConstants patch, applied by build
│   ├── mozilla.cfg                # autoconfig: defaultPref/lockPref calls
│   ├── distribution/
│   │   ├── distribution.ini       # about=Mozilla Firefox for Ziy, our partner id
│   │   ├── policies.json         # locked enterprise policies (§5.4)
│   │   └── extensions/           # our suite, installed by the app dir
│   └── ziy.desktop               # xdg entry, our icon and name
├── extensions/
│   ├── ziy-shell/                # branding + first-run tour + desktop helpers
│   ├── ziy-shields/              # blocking engine + Shields UI
│   ├── ziy-news/
│   ├── ziy-playlist/
│   ├── ziy-talk/
│   ├── ziy-ntp/                  # chrome_url_overrides.newtab
│   └── ziy-sync/
├── native/
│   ├── ziy-mediad/
│   └── ziy-sync-agent/
├── server/
│   └── src/  # blind storage service
├── packaging/                   # per-platform packaging scripts and assets (§0)
│   ├── linux/                   # tarball stage; .desktop entry; icon sizes
│   ├── windows/                 # .ps1 stage, Inno Setup / NSIS script, .ico, Start Menu
│   ├── android/                 # Gradle stage for the android/ module; GeckoView app shell; assets/ staging
│   └── (CI is an input to this tree, not a sibling: workflows under .github/workflows/ run these stages on runners — §0.5)
├── android/                     # a separate Kotlin/GeckoView app — its own Gradle project, not a packaging variant (§0.2, §7.1)
├── tools/
│   ├── build-shell.sh            # assembles build/ziy from shell/ + a Firefox install
│   ├── build-shell.ps1          # Windows variant of the above
│   ├── build-extension.sh        # cross-platform by construction (§8.1)
│   ├── bootstrap-profile.py      # creates ~/.ziy/profiles/<name>/ — must stay cross-platform
│   ├── ziy                       # the launcher (Linux)
│   ├── ziy.ps1                   # the launcher (Windows)
│   ├── install-native.sh
│   ├── install-native.ps1
│   ├── install-native-android.sh
│   ├── verify.sh                 # the acceptance harness (§7.2)
│   └── update-engine.sh          # re-points at a new Firefox and re-applies the patch
└── package.json                  # workspace root for the extension suite
```

### 8.1 What gains a platform variant (§0)

| tool / asset | Linux | Windows | Android |
| --- | --- | --- | --- |
| `tools/build-shell.sh` | reference | gains **`build-shell.ps1`**: same steps, but the Firefox source tree is resolved through the *versioned* install subdirectory, path joining and the `omni.ja` rewrite use Windows-safe primitives, and the produced stage feeds the Inno Setup / NSIS script in `packaging/windows/` | no equivalent — no app dir on Android (§0.1) |
| `tools/bootstrap-profile.py` | reference | **must stay cross-platform-verified**: it carries the profile root, which is `~/.ziy/` on Linux and `%LOCALAPPDATA%\Ziy\profiles\` on Windows, and it writes `userChrome.css` plus the prefs. It must not use `/tmp`, POSIX-only `chmod`, or shell path strings; CI runs it on all three targets | not used — profile creation belongs to the GeckoView app |
| native agents (`ziy-mediad`, `ziy-sync-agent`) | per-user native-messaging manifests + daemon binaries | **need per-OS packaging**: a Windows binary/script per daemon, and the manifests written into the Windows per-user Mozilla native-messaging tree (exact path `low — unverified`, see §0.4) | rewritten as Kotlin/Java inside our app — no manifest, `setMessageDelegate` is the peer (`geckoViewAddons` permission) |
| `chrome/userChrome.css` (shell + profile) | the branding seam | the same seam, same file | **desktop only** — no userChrome.css on GeckoView; the app shell draws its own UI |
| `.desktop` entry / icons (`shell/ziy.desktop`) | xdg entry + icon sizes | replaced by `packaging/windows/` Start Menu + `.ico` | launcher icon only |

Every extension subdir has the same shape: `manifest.json`, `background/`,
`ui/` (sidebar or popup), `content/`, `lib/` (shared parsing/crypto), `test/`.

Package name is `ziy` everywhere. The Firefox add-on ids must match the
filenames in `distribution/extensions/`, because the id is derived from the
filename (`getExpectedID()` in `XPIProvider.sys.mjs` strips `.xpi` and requires
the result to match `gIDTest`).

### Naming conventions (apply to every module)

| concept | rule | example |
| --- | --- | --- |
| product id | `ziy` (lowercase) | package `ziy`, app id `ziy` |
| user-visible dirs | `Ziy` | `~/.ziy/`, Ziy Desktop Entry |
| executable | `ziy` | `/usr/bin/ziy` |
| extension dir | `ziy-<area>` | `ziy-shields` |
| add-on id | `ziy-<area>@ziy.app` | `ziy-shields@ziy.app` |
| pref namespace | `ziy.<area>.*` | `ziy.shields.*`, `ziy.ntp.*` |
| message op | `<area>.<verb>` | `shields.setSite`, `sync.now` |
| native host | `ziy-<area>d` | `ziy-mediad`, `ziy-sync-agent` |

**Feature names.** Where Ziy's feature has its own product name, that name is
used in the UI, in messaging ops, and in namespaces — not the original's name.
The blocking surface is the worked example: Ziy calls it **Shields**, the same
word the recon recorded in Brave's own panel, and it keeps the generic
`ziy.shields.*` naming because "Shields" describes a mechanism, not a brand —
`shields.setSite` is the op the NTP and shell send when a per-site rule
changes, and `ziy-shields@ziy.app` is its add-on id.

---

## 9. Sizing and honest sequence

| module | size | why |
| --- | --- | --- |
| `shell` (app dir, bootstrap, launcher, desktop entry) | **M** | the mechanism is understood and verified; the work is packaging + one audited patch |
| `ziy-shell` (branding, tour) | S | |
| `ziy-ntp` | **M** | widget system is real work but self-contained |
| `ziy-shields` | **XL** | parser + engine + DNR + webRequest + precedence + three UIs; this is the product |
| `ziy-sync` + `server/` + `ziy-sync-agent` | **L** | crypto + protocol + a server + a native host |
| `ziy-news` | S | |
| `ziy-playlist` | M | media capture + a player |
| `ziy-talk` | M | control surface; backend is a handoff |
| `ziy-desktop` | S | |
| `tools/` (build, verify, bootstrap) | M | this is the difference between a demo and a product |

**Per-platform sizing (§0).** The rows below are the *incremental* cost of adding
a target on top of the module work above, not a re-estimate of it.

| platform | size | what the size actually is |
| --- | --- | --- |
| Linux (desktop) | — *(reference; already proven on this machine, 2026-10-14)* | the mechanism is verified end to end; remaining work is the module table above |
| Windows (desktop) | **S–M** | **reuses everything except path/script variants and desktop integration**: a `build-shell.ps1` + `.ps1` installer stage (Inno Setup/NSIS), a `ziy.ps1` launcher, `.ps1` native-messaging install, `%LOCALAPPDATA%\Ziy\profiles\` in the bootstrap, Windows-safe path handling in every script, Start Menu/icon/default-browser registration, and per-OS builds of the two native daemons. No module logic is rewritten. |
| Android | **L–XL** (a separate program) | **not a port.** Needs its own GeckoView app shell (tab/toolbar/menu/home-screen UI), its own re-implementations of every desktop-only mechanism (§0.2: NTP, sidebar panels, chrome branding, native agents as app code, profiles as app state), and a new acceptance harness (§7.2). Realistically quarter-scale, and after Windows. |
| Android — build & CI cost (on top of the row above) | **S, but it is a real program's cost** | The APK is built on `ubuntu-latest` CI, never locally (§0.5): the workflow owns SDK/JDK 17/Gradle setup and the `android/` Gradle build, with unsigned + signed variants and the keystore in repo secrets. The module-level cost above is app code; **this row is the cost of standing up its toolchain and keeping the workflow reproducible** — download sizes, cache warming, and the signing path, which is a packaging concern that must never be mistaken for the size of the program itself. |

**Honest sequence across platforms:** **Linux first** (it is the proven
reference and the place every mechanism gets verified), **Windows second** —
the same product, different packaging, and the confidence cells in §0.1 say every
mechanism we depend on either works identically or needs only a path variant —
**Android third, as a separate program** because it loses several desktop-only
mechanisms outright (§0.2) and must rebuild them as application code.

**Risk added by the platform requirement.** Windows is cheap but is where
path-shaped bugs hide (a script that hardcodes `/tmp` or `~/.ziy` fails silently
rather than loudly), so the per-platform harness rows in §7.2 are the guard.
Android is the real risk: the temptation is to promise parity, and the honest
answer is in §0.2 — a subset product, not a port.

**Sequence of modules:** shell → ntp → shields → sync → talk →
news+playlist → vpn → desktop polish. Shields is XL and
everything visible depends on it, so it is deliberately third, right after the
two things that prove the shell is real.

### The three riskiest parts

1. **The `omni.ja` signing patch.** If a Firefox update moves these constants
   into a compiled artifact, the whole install-our-own-suite story breaks and
   Ziy must distribute signed add-ons. Mitigation: `tools/update-engine.sh`
   re-applies the patch on every engine bump and fails loudly; the fallback
   path is documented in §1.4.
2. **Shields on Gecko.** Brave's adblock runs in Chromium's network service; we
   have DNR + blocking webRequest in an event page. It will work, but per-site
   precedence over ~10^5 rules needs careful priority management (§5.3), and
   the imperative path must not regress what DNR already covers.
3. **`about:home` and NTP capture in headless.** Firefox 156's activity-stream
   will not screenshot headless on this machine, which affects automated NTP
   verification (not the product). Mitigation: verify the NTP by DOM assertions
   and a live headed run, and record the limitation.

### Next step

`/replica-design` — turn this into the visual system, using `replica/screens/`
as layout reference only (never shipped), and Ziy's own brand in `brand/`.
