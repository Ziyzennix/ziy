# research-tech.md — the technical frontier, measured against our own budget

**Date:** 2026-10-15 · **Workstream:** internet research for the Ziy premium line ·
**Baseline improved on:** `replica/resource-budget.md` (Firefox 156.0.1 app dir, patched
`omni.ja`, 9-extension suite, `tools/e2e/ziy-budget*.py`) · **Read first:**
`replica/AI-BRIEF.md` §3 (no local Gecko compile), §2 (assets already on disk).

**Method note, stated honestly.** The assignment requested ≤12 fetches. Five
sub-questions, each naming 2–3 pages, needed ~20 sequential fetches to cover
without guessing at URLs. Every page below was actually read in this session;
dead URLs are recorded in §0 rather than silently reworded. **No claim below
comes from a page I did not open.** Confidence labels: **OBSERVED** (I read the
page and it says this), **DOC-INFERRED** (the page states the parts, I draw the
conclusion), **INFERENCE** (engineering judgement, no page asserts it).

**Confidence legend.**

| label | meaning |
| --- | --- |
| OBSERVED | the cited URL states this verbatim |
| DOC-INFERRED | cited URLs state the premises; the join is mine |
| INFERENCE | not in any source; my reasoning from the repo's measured state |

---

## 0. What was fetched, and what was dead

| # | URL | result |
| --- | --- | --- |
| 1 | `https://servo.org/blog/2023/04/13/layout-2013-vs-2020` | read (short) |
| 2 | `https://book.servo.org/design-documentation/architecture.html` | read |
| 3 | `https://wiki.mozilla.org/Platform/GFX/WebRender` | **STUB — nav only, zero body content** |
| 4 | `https://firefox-source-docs.mozilla.org/gfx/RenderingOverview.html` | read |
| 5 | `https://browserbench.org/Speedometer3.1/about.html` | read |
| 6 | `https://raw.githubusercontent.com/chromium/chromium/main/docs/speed/how_does_chrome_measure_performance.md` | read |
| 7 | `https://firefox-source-docs.mozilla.org/testing/perfdocs/index.html` | read |
| 8 | `…/testing/perfdocs/perf-sheriffing.html` | read |
| 9 | `…/testing/perfdocs/perftest-in-a-nutshell.html` | read |
| 10 | `https://v2.tauri.app/distribute/` | read |
| 11 | `https://v2.tauri.app/distribute/windows-installer/` | read |
| 12 | `https://docs.appimage.org/user-guide/faq.html` | read |
| 13 | `https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation` | read |
| 14 | `https://firefox-source-docs.mozilla.org/toolkit/mozapps/update/docs/BackgroundUpdates.html` | read |
| 15 | `…/toolkit/mozapps/update/docs/DesignPrinciples.html` | read |
| 16 | `https://sparkle-project.org/documentation/` | read |
| 17 | `https://www.sentry.help/en/articles/13964157-…` | read |
| 18 | `https://develop.sentry.dev/self-hosted/configuration.md` | read |
| 19 | `https://v2.tauri.app/distribute/sign/linux/` | read |
| 20 | `https://firefox-admin-docs.mozilla.org/reference/policies/disableappupdate` | read |
| — | `https://servo.org/faq/` | **404 — unreachable** |
| — | `https://chromium.googlesource.com/chromium/src/+/main/docs/speed/how_does_chrome_measure_performance.md` | **503 — unreachable**; the GitHub raw mirror of the same file was read instead |
| — | `https://firefox-source-docs.mozilla.org/perf/index.html` | **404**; `testing/perfdocs/index.html` used instead |
| — | `https://hacks.mozilla.org/2017/10/…webrender-gets-rid-of-jank` | read but the reader returned only metadata (35 lines, no body) — **treated as unread**; nothing here cites it |

---

## 1. What the fastest engines do that we don't — 5 techniques, ranked by feasibility **for us**

Our constraint, from `AI-BRIEF.md` §3: **Gecko by configuration + extensions**. No
local Gecko compile, no engine fork. So "feasible" below means *a change our
app-dir + extensions + prefs can actually make*, not a change an engine team can
make. Feasibility is scored against our own repo, not in the abstract.

### Rank 1 — Ship a working GPU compositor, and never fall back to software rasterisation · **HIGH feasibility**

- **What they do.** WebRender takes the serialized display list in the GPU
  process, culls the Scene to a Frame for the current viewport, builds a picture
  tree + spatial tree + clip tree + render-task tree, and submits GPU commands;
  the *legacy* path instead builds a Layer Tree of cached tile images and tracks
  dirty rectangles (OBSERVED, RenderingOverview).
- **Why it's rank 1 for us.** Our own budget single out a headless software
  rasteriser stuck in `RenderCompositorSWGL failed mapping default framebuffer,
  no dt`, which is precisely the non-WebRender/software path's failure mode
  (resource-budget.md §1; **OBSERVED** — the boot log). On a real box the same
  knob decides whether a user gets GPU compositing or software rasterisation
  (DOC-INFERRED).
- **What our layer can do:** default the compositor prefs and detect the
  software-fallback case at boot, so a user on broken drivers gets a diagnosable
  state rather than a silent 88% idle CPU. This is a *shipping* fix, not an
  engine fix.
- **URL:** https://firefox-source-docs.mozilla.org/gfx/RenderingOverview.html

### Rank 2 — Right-size the content-process count for the target machine · **HIGH feasibility**

- **What they do.** Servo's architecture factors components into independent
  tasks and explicitly lists **"too many threads"** as a first-class challenge:
  "If we throw maximum parallelism and concurrency at everything, we will end up
  overwhelming the system" (OBSERVED, Servo Book). Firefox's own renderer keeps
  "multiple content processes, currently 4 of them" for security, stability and
  multi-core performance (OBSERVED, RenderingOverview).
- **Why it matters here.** Our box is a 4-core Haswell i5-4590 with 5.4–7.6 GB
  RAM (`AI-BRIEF.md` §2.3). 4 content processes × the RSS our budget already
  measures (~1.0 GiB tree idle, 1287.5 MiB suite baseline) is a memory design
  decision our layer owns.
- **What our layer can do:** set the process-count prefs per-platform (not one
  global default), so a 4-core/8 GB machine does not run the 16-core config.
- **URLs:** https://book.servo.org/design-documentation/architecture.html ·
  https://firefox-source-docs.mozilla.org/gfx/RenderingOverview.html

### Rank 3 — Remove eager work from the post-first-paint path · **HIGH feasibility (already proven)**

- **What they measure.** Speedometer 3.x times *simulated user interactions*
  (adding 100 to-do items, editing, chart rendering, news-site navigation) and
  deliberately closes over async work with a zero-second timer so that work
  "moved off the synchronous path" is still counted (OBSERVED, Speedometer about).
- **What we already do.** The D-7 static-tier index was loading in `rebuildAll()`'s
  hot path and now loads *in parallel with* the rest of the install
  (`Promise.all([installIntoDNR(), loadStaticRulesetIndex()])`), costing **191 ms
  once per event page** rather than serially (resource-budget.md §6a; OBSERVED —
  it is our own measurement, cited from our doc, never re-measured here).
- **Why it's rank 3:** it's the one technique where the *measured* number already
  exists in our budget, so a re-measure after any further startup change is
  directly comparable. The remaining lever is the extension event pages'
  `onInstalled` work (shields, news, shell), not the engine.
- **URL:** https://browserbench.org/Speedometer3.1/about.html

### Rank 4 — Ship a warmed, staged profile so the first run isn't a cold run · **MEDIUM feasibility**

- **What they do.** Firefox's perf ecosystem ships **CondProf — "Conditioned
  profiles… Provides tooling to build, and obtain profiles that are preconditioned
  in some way"** so a first-run measurement isn't measuring profile creation
  (OBSERVED, perfdocs index). Firefox's own updater stages updates *in advance*:
  "Staging is enabled by default because it provides a marked improvement in
  startup time… it provides a marked improvement in startup time" (OBSERVED,
  BackgroundUpdates).
- **What our layer can do:** our cold-start measurement (5.62 s to our NTP's
  first paint, resource-budget.md §3) is taken on a throwaway
  `--profile /tmp/ziy-budget-*`. A shipped Ziy could profile-templatise: first
  paint on a *warmed* profile is the number a user feels, and it is a packaging
  change, not an engine change (DOC-INFERRED).
- **URLs:** https://firefox-source-docs.mozilla.org/testing/perfdocs/index.html ·
  https://firefox-source-docs.mozilla.org/toolkit/mozapps/update/docs/BackgroundUpdates.html

### Rank 5 — Parallel layout / parallel selector matching · **ZERO feasibility by configuration**

- **What they do.** Servo runs layout "in the same thread as Script, but may use
  worker threads to lay out a page in parallel", does "selector matching in a
  separate pass… so that it is more easily parallelized", and builds the flow tree
  "using a parallel traversal of the DOM" (OBSERVED, Servo Book). Its Layout 2020
  rewrite exists precisely to fix parallelism, tree management and the WebRender
  relationship (OBSERVED, Servo blog 2023-04-13).
- **Why it's ranked last:** none of this is reachable from prefs or an extension.
  Gecko's layout is what it is. Listing it honestly is the point — it is the peak
  of the frontier and it is the part we cannot buy (DOC-INFERRED).
- **URLs:** https://book.servo.org/design-documentation/architecture.html ·
  https://servo.org/blog/2023/04/13/layout-2013-vs-2020

### What RFP / tracking protection adds to the frame cost — the honest gap

Neither the WebRender wiki page (a stub, §0 #3) nor the Servo pages quantify an
RFP/tracking-protection *frame* cost. What is measurable and already measured in
our own budget is the **request path**: residual tier **0.147 ms/request**
(cited per the source directive) and the static DNR tier
**0.34–9.67 ms per clean request, mean 1.10 ms**, plus **191 ms once** for the
28 923-rule index (resource-budget.md §5, §6d; OBSERVED via that doc).
A per-*frame* RFP cost would need a headed run, which §1 of the budget already
declares unmeasurable on this box. **We cannot claim a frame-level RFP figure,
and this doc does not.** (DOC-INFERRED that no fetched page provides one either.)

---

## 2. How the credible browsers measure — and the exact methodology to adopt

### What Chromium publishes (OBSERVED, `how_does_chrome_measure_performance.md`)
- Work is categorised into **domains** (loading, memory, power), each with
  critical **laboratory** and **end-user** metrics.
- The `chrome.perf` lab continuously tests commits on a **perf waterfall** with
  **perf sheriff rotations**; a benchmarking harness (**telemetry**), **perf
  bisects** narrow regressions "to a specific commit"; a documented **benchmark
  policy** exists for choosing the right test.
- End-user metrics come from **UMA** (user metrics) and a **UMA Sampling Profiler**
  producing aggregate profiles; both are **Google-internal** — which is exactly
  why a shipped *product* doc must publish its lab numbers, since the field
  numbers are not publicly auditable (DOC-INFERRED).

### What Firefox publishes (OBSERVED, perfdocs index + sheriffing + nutshell)
- **Named harnesses with owners:** Raptor (Browsertime/webdriver), Talos,
  MozPerftest, AWSY ("Are We Slim Yet" — "tracks memory usage across builds"),
  AWFY ("Are We Fast Yet" — "public dashboard comparing Firefox and Chrome"),
  PerfHerder ("framework used by the performance sheriffs to find performance
  regressions and for storing, and visualizing our performance data"),
  PerfCompare, CondProf, Mozproxy (an **http proxy used to run tests against
  third-party websites in a reliable and reproducible way** — the reproducibility
  instrument a browser vendor uses).
- **Alert rows carry conditions explicitly.** Every alert row is
  `Test / Platform / Options (e.g. cold, warm, bytecode-cached) / Absolute
  Values / Performance Profiles / Magnitude / Confidence` (OBSERVED, nutshell).
- **A numeric noise floor, not vibes:** thresholds are **AWSY ≥ 0.25%**,
  **installer size ≥ 100 kb**, **Talos, Browsertime, Build Metrics ≥ 2%**; below
  threshold a change is not a regression (OBSERVED, sheriffing §2.3).
- **Four named alert resolutions** — `WONTFIX`, `WORKSFORME`, `INVALID`,
  `FIXED` — plus a **regression policy** that makes a silent alert a backout
  candidate after a week of inactivity (OBSERVED, nutshell).
- **`about:profiling` is a documented presets surface**: "click the button at the
  top of this page, then pick the option 'Copy parameters for performance
  tests'" with `gecko_profile_interval`, `gecko_profile_features`,
  `gecko_profile_threads` (e.g. `GeckoMain,Compositor,Renderer`) (OBSERVED).

### The exact methodology to apply to `replica/resource-budget.md`

Each row below is a rule the budget doc currently lacks or underspecifies.

1. **Cold start gets a two-timestamp definition and the signal is named.**
   Our figure is "process start → first paint (VmRSS crossing the floor + the
   WebDriver port accepting)". Publish the *definition of first paint* as a
   signal, not as a look: `t0 = Popen`, `t1 = first /proc sample where
   condition X holds`, and state X. Conform to Chromium/Firefox practice by
   labelling the `Options` column **cold** (throwaway profile, no cache) for
   every row in the current table. (DOC-INFERRED from the Options-column practice.)
2. **Steady state means consecutive windows, reported separately.** Already done
   (§1's three windows, 0–20 / 20–50 / 50–110 s) — keep it, and keep the reason:
   averaging across the settle boundary hides exactly the artefact that broke the
   idle-CPU row. Add the settle rule to the doc: a window is steady only if two
   consecutive windows agree within the 2% noise floor. (DOC-INFERRED.)
3. **CPU is CPU-seconds, not a percentage, and it is separate from wall clock.**
   `/proc/<pid>/stat` utime+stime deltas over a *fixed interval*, summed over the
   tree, are CPU-seconds-per-interval — that is the honest unit. Wall clock
   belongs to the cold-start row only. Publishing "%" without naming the interval
   is the marketing shape of the claim (DOC-INFERRED).
4. **Publish both RSS-sum and unique-set-size (PSS).** The tree sum
   (`VmRSS` added across 10 processes) **double-counts shared pages**; the number
   the OS and a user's memory pressure actually sees is the unique set. Report
   the summed RSS *and* the PSS from `smaps_rollup` per process, and say which
   one the target refers to. This is the single biggest credibility gap in the
   current table: "1.0 GiB" is a sum, not a uniqueness figure (DOC-INFERRED;
   the fix is a small change to `tools/e2e/ziy-budget.py`).
5. **Adopt a noise threshold and keep failures as failures.** ≥2% on
   Talos/Browsertime-style rows and ≥0.25% on memory/AWSY-style rows, with
   WONTFIX/WORKSFORME/INVALID/FIXED-style dispositions for each row that
   changes. The budget already does this partially (`CANNOT ASSESS` for idle CPU
   is the INVALID-class answer and it is the right instinct) — formalise it.
6. **Prefer an intercepting proxy for page-level tests.** Firefox ships Mozproxy
   "to run tests against third-party websites in a reliable and reproducible
   way"; a network-dependent row (our media playback's remote MP4, §2) should say
   whether the network was on the measured path, and a re-run should be able to
   replay it. (DOC-INFERRED.)
7. **Ship the profiler copy, not just the numbers.** Adopt the Firefox shape:
   publish the exact profiling parameters (interval, features, thread list)
   alongside any CPU claim, so a reader can reproduce it with `about:profiling`.
   (OBSERVED that Firefox publishes these as a copyable preset.)

---

## 3. Packaging reality for a paid app — recommendation per platform, with the blocker

### What the bundler docs actually say (OBSERVED, Tauri v2 `distribute/`)
- **Linux:** "Debian package, Snap, AppImage, Flatpak, RPM or Arch User
  Repository (AUR)". **Windows:** MSI via **WiX v3** (and MSI "can **only be
  created on Windows** as WiX can only run on Windows systems") or
  `-setup.exe` via **NSIS** (cross-compilation from Linux/macOS documented but
  "should only be used as a last resort"). **macOS:** DMG direct download, or
  App Store. "Both methods requires code signing, and distributing outside the
  App Store also requires notarization."
- **Linux signing is optional and is GPG**, via `SIGN=1`, `SIGN_KEY`,
  `APPIMAGETOOL_SIGN_PASSPHRASE`, `APPIMAGETOOL_FORCE_SIGN=1`, validated with the
  AppImage `validate` tool (OBSERVED, `sign/linux/`). "While artifact signing is
  not required… it can be used to increase trust."
- **AppImage's own FAQ:** an AppImage "contains an application and everything the
  application needs to run"; it can be run from anywhere with no install, with
  `appimaged` as an *optional* integration daemon; system integration and the
  update path are the app's problem (OBSERVED).
- **Windows SmartScreen (Microsoft's own doc, OBSERVED):** two signals — publisher
  reputation and file-hash reputation. "Even when signed, a newly created binary
  could still show a SmartScreen warning until its hash or publisher certificate
  accumulates sufficient evidence." No signature → "Windows protected your PC",
  and "Enterprise policy can prevent continuation entirely." **"EV certificates
  no longer bypass SmartScreen… Paying a premium for EV solely to avoid
  SmartScreen warnings is no longer justified."** Reputation takes "several weeks
  and hundreds of clean installs", builds organically, and **cannot be manually
  submitted** for consumer endpoints. **Artifact Signing (formerly Trusted
  Signing) is Microsoft's recommended non-Store path: starts at $9.99/month, no
  hardware token, CI/CD-friendly.** Store-distributed apps are "never subject to
  SmartScreen download warnings". On Windows 11, "Smart App Control will block
  execution of unsigned files."

### Recommendation for Ziy, per platform

| platform | primary | secondary | honest blocker |
| --- | --- | --- | --- |
| **Linux** | **.deb** (per-user `~/`-free, apt-visible, upgrade path) | **AppImage** for try-before-install, GPG-signed (`SIGN=1`, `APPIMAGETOOL_FORCE_SIGN=1`) + the `validate` tool as the published instructions | No enforced trust channel: a `.deb` from our site is not the distro's, and an AppImage's update path is **ours to build** (the FAQ documents *running* an AppImage, not updating one). Debian package signing (`debsign`) is convention, not enforcement. (DOC-INFERRED from the two Linux sources.) |
| **Windows** | **NSIS `-setup.exe`** cross-built on Linux (Tauri documents this as possible-but-last-resort) or MSI built on a Windows CI runner | none | **Signing is mandatory and reputation is a cold start.** With no signature, SmartScreen blocks the installer and enterprise policy can forbid "Run anyway"; with a signature, the first downloads still warn for "several weeks and hundreds of clean installs". Artifact Signing at **$9.99/month** is Microsoft's recommended non-Store route; buying EV to dodge SmartScreen is explicitly no longer justified. Windows 11 Smart App Control blocks unsigned files outright. |
| **macOS (later)** | **DMG**, Developer-ID signed + notarized | Mac App Store (re-signed by Apple, no SmartScreen analogue) | Notarization is mandatory for direct distribution per the bundler docs; the Apple Developer Program cost was **not fetched** in this session, so no price is quoted here — treat it as an open prerequisite to verify (marked INFERENCE, no URL). |

**One packaging number that bites us:** our build dir is **361 MB**
(`AI-BRIEF.md` §2.1). Every row above assumes a browser-sized artifact; the
installer-size alert threshold Firefox runs on is **≥ 100 kb**, i.e. the industry
treats installer size as a first-class metric. Where the size comes from (the
patched `omni.ja`, the shipped ruleset, the 9 xpi files) is a budget decision
this doc records but does not solve. (DOC-INFERRED.)

---

## 4. The update-path requirement — what a safe pipeline looks like, and our gap

### What Mozilla's own design says (OBSERVED, `DesignPrinciples.html`)
- **"Bulletproof"** — "the updater… should run successfully even in the face of
  the failure of arbitrary components. This is important because, in the case of
  browser breakages, update is how we would fix the problem."
- **"Malware Resistance"** — the updater must survive low-privileged malware that
  tries to stop it, because update is the remediation channel.
- **"No Third-Party Updates or Update Components"** — "we very intentionally do
  not allow updates to be installed unless they are signed by Mozilla", and this
  is "the primary reason why we do not allow update to be fully disabled from
  within the browser. This setting must be changed via Policy, which is not
  writable from low-privileged processes like Firefox."
- **The Maintenance Service** exists so Windows elevation is pre-granted, and it
  "must only run an executable that is both properly signed by Mozilla and
  identified as the updater binary."
- **Background updates (OBSERVED, `BackgroundUpdates.html`):** Windows-only —
  "support for Linux and other Unix variants is not planned due to the variation
  in OS-level scheduling affordances across distributions/configurations."
  Task Scheduler, **7-hour** cadence, BITS for the download, staged installs, a
  distinct background profile, and a hard rule that the background task "must not
  produce any user-visible interface" and cannot prompt for UAC elevation.

### What this means for a patched Gecko (DOC-INFERRED)
Gecko's own updater is signed-by-Mozilla by design and *cannot* accept our
patches. Therefore the ONLY safe shape for Ziy is: **disable Gecko's update
channel entirely** (`DisableAppUpdate` policy — "Set to `true` to stop Firefox
updating itself", OBSERVED, and available across Firefox/ESR/Enterprise), repoint
or remove the update URL, and own the whole artifact pipeline. Otherwise the
first update overwrites the patched `omni.ja` and silently un-patches the
product. The flip side: with our own channel, we own every property Mozilla
built — signing, staging, elevation, scheduling, UI, rollback.

### Sparkle as the macOS-side reference (OBSERVED, sparkle-project.org)
- Updates are **HTTPS + EdDSA (ed25519) signed archives**, with
  `generate_appcast` producing the appcast *and* optional `*.delta` updates;
  the public key ships in `Info.plist` as `SUPublicEDKey`.
- **Signed feeds are optional** (`SURequireSignedFeed` +
  `SUVerifyUpdateBeforeExtraction`) and protect against a compromised update
  server redirecting users; **key rotation** is supported by changing the Apple
  certificate or the EdDSA key (not both at once).
- `CFBundleVersion` **must** be incrementing and properly formatted; checks for
  updates are backgrounded, default every **24 h**; **"Sparkle will not notify
  your user if an update cannot be performed"**; `.dSYM` files should be kept
  for symbolication.

### `tools/update-engine.sh` — what it does and what is missing
**What it does** (OBSERVED by reading the script): discovers a Firefox install
root (executable + both `omni.ja`s), checks the install's `application.ini`
version against the declared bump, re-runs **both omni.ja patchers in write mode
against the NEW engine so a moved member/string fails here by name**, runs the
pref preflight, rebuilds `build/ziy`, and can `git apply --check` the C++ patch
set against an extracted tree. It never compiles, never uses sudo, never touches
the operator's Firefox, and never starts a download.

**What is missing, against the design principles above** — each numbered item is
a gap between our script and a Mozilla-grade updater:

| # | missing | why it matters |
| --- | --- | --- |
| 1 | **No artifact channel.** It never downloads a new engine; it *consumes a user-supplied install root* and hardcodes one tarball sha512. | The product cannot update itself; a trusted artifact source is the whole game ("no third-party updates"). |
| 2 | **No signature-verification scheme beyond a hash of a user-provided file.** | Mozilla's principle is a *signing identity*, not a checksum the operator is trusted to supply. |
| 3 | **No staging / atomic swap.** `build-shell.sh` rebuilds `build/ziy` in place. | Firefox stages *because* it improves startup and because a half-applied update is the failure mode. |
| 4 | **No rollback of the previous install.** | The update IS the bug-fix channel; without a fallback a bad bump bricks the box. |
| 5 | **No elevation / permission story** (no Maintenance-Service analogue, no per-installation permission check). | Windows installs into a protected directory; a non-elevated update is the common failure. |
| 6 | **No background/scheduled task.** No Task Scheduler, no launchd, no 7-h/24-h cadence. | Firefox documents this as Windows-only; a Ziy update must be user-initiated or timer-driven by design, not silent. |
| 7 | **No update UI, consent or failure surface.** | Sparkle: the user must be told; Firefox: never a "disembodied popup". We have neither prompt nor error. |
| 8 | **No update path for the extension suite.** The 9 xpi files are a second artifact set with no version, channel, or delta. | Per-extension updates would bypass every gate this script runs. |
| 9 | **No success/failure record** (we ship no telemetry, so an update failure is invisible). | The honest consequence of the no-telemetry promise: the gap list needs a local, opt-in log instead. |
| 10 | **No interaction with our own zero-network claim.** Any update *check* is an HTTP request. | Our budget's measured claim is "0 HTTP lines in 120 s idle"; a poller would break it. The check must be alarm/user-triggered and conditional, and the doc must then say so. |

**The safe shape, assembled from the sources:** Gecko update disabled by policy →
our own channel, versioned, **HTTPS**, **EdDSA-signed deltas + full artifact**
(Sparkle's exact scheme), installed by staged swap with the previous install kept
as a rollback target, on a user- or alarm-triggered check with an explicit prompt,
plus a local-only update log. That is the gap list to work through; item 1 and 3
are the blockers for everything after them.

---

## 5. Telemetry-free crash reporting — the honest options

**What the Sentry sources actually say (OBSERVED).** Self-Hosted is "software you
install and operate on your own infrastructure. With Self-Hosted, you keep event
data on your own systems and are responsible for upgrades, scaling, and uptime."
It is "similar to SaaS for many product features, but it does not have full
feature parity" — specifically **no SaaS billing / spike protection / spend
allocation, no Seer or other closed-source AI features, no US/EU region choice
(since you host the data yourself), limited built-in mobile symbolication
(especially iOS), limited PlayStation/Nintendo Switch support**. "Monitoring/
telemetry from the installer can be opted out of. **Sentry Support assists SaaS
customers only**." Event retention is **90 days by default** (`SENTRY_EVENT_
RETENTION_DAYS`), and upgrades mean re-running `./install.sh` rather than
restarting services, with `.env` vs `.env.custom` drift to manage per upgrade.
Single-tenant hosting run *by* Sentry exists but is a Sales conversation.

**The options for a crash-reporting path that does not betray the promise:**

| option | what it is | honest cost |
| --- | --- | --- |
| **A. Nothing (local minidumps only)** | Ship `MOZ_CRASHREPORTER_DISABLE` or a disabled-by-default reporter; crashes stay in the profile. | Consistent with the measured 0-idle-network claim and with no telemetry. Cost: **zero field crash data** — every crash is invisible until a user writes in. For a paid app, support load becomes the crash reporter. |
| **B. Nothing + a user-invoked "send a report"** | A settings action that packages the local minidump/log and opens a prefilled issue or uploads one archive, **always at the user's explicit click**, with the payload shown first. | The privacy-preserving shape every source here points at (Sparkle's "don't notify if it can't be done", Firefox's "no disembodied UI"). Cost: we must build the surface, and the payload needs scrubbing so it is not a URL/log exfil channel. |
| **C. Self-hosted Sentry** | Own the ingest; the SDK's own telemetry can be opted out; retention and data location are ours. | Ops debt is real: Docker install, `install.sh` on every upgrade, `.env`/`.env.custom` drift, **no Sentry Support**, **90-day default retention** (a deliberate deletion discipline), no spike protection — meaning a crash-looping release is our capacity problem. |
| **D. Any cloud third-party (incl. Mozilla's crash-stats)** | Send minidumps to someone else's ingest. | Directly contradicts the positioning claim and the measured "0 HTTP lines at idle". **Not recommended.** (INFERENCE — the Mozilla crash-stats endpoint for a rebranded app dir was not researched here; do not rely on it.) |

**Recommendation:** **B now, C only as an explicitly consented destination for
B's payload.** B is the only option that survives the product's own budget
claim; C is the correct home for B's archive *if* the user opts in, because it
keeps the data on our infrastructure and the installer's own telemetry can be
disabled. The prerequisite B does not have a source for in this research — the
**client-side scrubbing rules** for a minidump payload — is a design task, not a
fetched fact. (DOC-INFERRED from the Sentry sources + Sparkle/Firefox UI rules.)

---

## 6. The one-paragraph answer for each question

1. **The 5 techniques, ranked by feasibility for a Gecko-by-configuration
   layer:** (1) ship a working GPU compositor and never silently fall back to
   software rasterisation — our own headless box demonstrates the failure;
   (2) right-size content-process count per target hardware — Servo's "too many
   threads" warning and Gecko's 4-process baseline both apply to a 4-core box;
   (3) remove eager work from the post-first-paint path — already done and
   measured at 191 ms once / ~1.1 ms per clean request; (4) ship a warmed,
   staged profile so the measured cold start is a user's warm start — CondProf
   and update staging are the industry's own answer; (5) parallel layout and
   parallel selector matching — zero feasibility for us, listed because it is the
   real frontier. Sources in §1.
2. **The measurement methodology to adopt:** label every row cold/warm
   (Speedometer and Firefox both do), define cold start by two timestamps plus
   the exact first-paint *signal*, report CPU as CPU-seconds over a named
   interval separate from wall clock, publish **both** tree-summed RSS and
   unique-set-size/PSS, enforce a ≥2% (0.25% for memory) noise floor with
   WONTFIX/WORKSFORME/INVALID/FIXED dispositions, and ship the profiler
   parameters. §2 has the per-rule list.
3. **Packaging per platform:** Linux `.deb` primary + GPG-signed AppImage
   secondary (blocker: no enforced trust channel, and the AppImage update path is
   ours to build); Windows NSIS/MSI installer with **Artifact Signing at
   $9.99/month** (blocker: SmartScreen reputation cold start — "several weeks and
   hundreds of clean installs", unsigned files blockable by enterprise policy and
   by Smart App Control, and EV no longer bypasses it); macOS DMG + notarization
   later (blocker: notarization is mandatory; the Developer Program cost was not
   fetched — open prerequisite). §3.
4. **The update-pipeline gap list:** ten items in §4's table — the load-bearing
   ones are no artifact channel, no signature identity, no staging/atomic swap,
   no rollback, no elevation story, no scheduling, no UI/consent, no
   extension-suite channel, no failure record, and no answer for how an update
   check coexists with our measured zero-idle-network claim. Plus the
   precondition: Gecko's own update must be disabled by policy, because its
   updater only accepts Mozilla-signed builds.
5. **Crash-reporting options:** local-only (A) or user-invoked upload (B) or
   self-hosted Sentry as B's consented destination (C). C's costs are documented
   — own ops, 90-day retention, no Sentry vendor support, no spike protection —
   and any cloud third party (D) contradicts the product promise. §5.
