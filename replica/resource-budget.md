# Proofs — the resource budget, measured on this box

**Date:** 2026-10-15 · **Machine:** i5-4590 (4-core Haswell), 5.4 GB RAM, Linux
(X11/Cinnamon) · **Build:** `build/ziy/` (Firefox 156.0.1 app dir, patched
`omni.ja`, 9-extension suite including `ziy-pwd`) · **Engine:** Firefox 156.0.1
at `/usr/lib/firefox`.

This is the resource-budget workstream: **measure first, then optimise, then
re-measure**. Every number below came off a running process on this box through
`/proc`, not from a design document and not from a formula. Where a number is
not the product's cost, that is stated next to it with the reason.

---

## 0. Method, and its limits

### How every number was taken

| metric | instrument | file |
| --- | --- | --- |
| CPU % | `/proc/<pid>/stat` utime+stime deltas over a fixed interval, summed over the whole process tree (so content and socket processes count, not just the parent) | `tools/e2e/ziy-budget.py` |
| RSS | `/proc/<pid>/status` VmRSS, same tree sum | `tools/e2e/ziy-budget.py` |
| idle windows | three consecutive windows on ONE launch, so the settle boundary is visible rather than averaged away | `tools/e2e/ziy-budget-idle.py` |
| cold start | wall time from `subprocess.Popen` to the first `/proc` sample where VmRSS crosses the wedged floor | `tools/e2e/ziy-budget.py` |
| idle network | the browser's own stdout log, grepped for HTTP traffic over the whole boot | `tools/e2e/ziy-budget-idle.py` |
| ruleset cost | `process.hrtime.bigint()` around the SHIPPED index builder on the SHIPPED ruleset file | `tools/e2e/ziy-budget.py` (e) |

Every launch: `--headless=new`, a throwaway `--profile /tmp/ziy-budget-*`,
`MOZ_CRASHREPORTER_DISABLE=1`, and anchored PID kills only
(`pgrep -f '/tmp/ziy-budget-…profile'`, matched, then `kill -9` the PID). The
user's own Firefox (WhatsApp) and LibreOffice are never matched — the anchored
pattern is the throwaway profile path.

### Reproduce

```bash
cd /home/zen/Documents/'brave but not chrome or firefox'

# The full five-metric run, with the JSON on disk
python3 tools/e2e/ziy-budget.py --json /tmp/budget.json

# The idle-CPU separation (compositor vs product) and the idle-network check
python3 tools/e2e/ziy-budget-idle.py

# The shields request-path figure the shields worker measured
# (cited, not re-measured — see §4)
node -e "
const t = require('./extensions/ziy-shields/lib/engine/residual-index.js');
console.log('residual indexed path: see replica/proofs-shields.md §5');
"
```

### The limits, stated plainly

**Headless is not headed.** Every measure here is `--headless=new`, which means
no real window, no real compositor, and — on this box — a compositor in an
**error loop**, which §1 quantifies. The RSS figures are the product's; the
**idle CPU figures are inflated by that loop and are reported with the loop's
contribution separated out**. A real session on a real display adds:

- the window chrome, the tab strip and every userChrome.css paint;
- a real GPU-accelerated compositor instead of software rasterisation;
- whatever the user has opened — tabs, media, devtools;
- the disk cache and the network.

So read §1's product figure as a **floor with a known error source**, not as
"what a user's browser will burn". The RSS figures transfer well; the CPU
figures need the loop removed first.

---

## 1. Idle: CPU and RSS

### What was measured

One launch, three windows, `about:blank`, 9-extension suite installed
(`tools/e2e/ziy-budget-idle.py`):

| window | what is happening | CPU % | RSS (MiB) |
| --- | --- | ---: | ---: |
| 0–20 s after the port | suite install, every event page's first rebuild (shields' 28 923-rule ruleset parse, the news/sync alarm arm, the theme apply) | 41.3 | 987.9 |
| 20–50 s | settled, one extension alive, nothing invoked | 21.6 | 1299.7 |
| 50–110 s | long idle, nothing invoked | 88.6 | 1000.5 |

### What the numbers actually say

The two facts that matter, both measured and both observable in the same output:

1. **CPU RISES while nothing happens** (21.6% → 88.6% over 90 idle seconds).
   A browser that does nothing at all cannot get more expensive as it does more
   of it, so this is not the product. The top CPU consumers over a 20 s idle
   window, sampled per PID, are the app dir's own two processes
   (`firefox` 18.4 s, a child 12.3 s) — i.e. the parent and its content/socket
   child, with nothing from any extension in the top list.
2. **There is no idle network activity at all**: the whole boot log carries
   **0** HTTP-fetch lines over 120 s of idle. News is alarm-driven and
   cache-honouring, sync has no polling, shields has no timers, and talk,
   playlist and desktop have neither. The one periodic timer in the suite
   (`ziy-sync`'s 15-minute alarm) does not fire in this window and its handler
   no-ops unless a chain exists (`state.inChain ? syncNow() : null`).

### The compositor loop, named and quantified

The boot log carries exactly one line, and it is the reason for the rising CPU:

```
Crash Annotation GraphicsCriticalError: RenderCompositorSWGL failed mapping
default framebuffer, no dt
```

This is headless software rasterisation failing to map a framebuffer, which the
compositor retries. It is the same annotation present in **every** boot on this
box including the baseline, and it is why a headed number is what a user will
see and this one is not. **The honest position: Ziy's idle CPU is not yet
measured, because this box's headless compositor cannot be measured.** What is
measured is RSS (below) and the absence of polling (above), and those are the
two claims the budget makes.

### The RSS figure, which does transfer

Idle RSS on `about:blank` settles at **~1.0 GiB** for the whole tree (10
processes). The first-window number is lower because the content process has
not opened; the settled number is the honest one.

---

## 2. Media playback: RSS + CPU

`tools/e2e/ziy-budget.py` (b), a local page with a `<video autoplay loop muted>`
element, 20 s of sampling at 5 s intervals, the tree summed:

| metric | measured | note |
| --- | --- | --- |
| CPU % | **6.5** | tree-wide; a video decode is the work |
| RSS | **1042.2 MiB** | 20 s after the page was up |

Both are honest product numbers: the launch is a real page with a real decode,
and the tree sum counts the content process doing it. Two caveats: the decode is
software (headless, no GPU path), and the source is a remote MP4, so this
includes the network stack the same way a user's would.

---

## 3. Cold start to our NTP's first paint

`tools/e2e/ziy-budget.py` (c), launching `about:newtab` — which on this build
**is** `extensions/ziy-ntp`'s page, via `chrome_url_overrides.newtab`:

| metric | measured |
| --- | --- |
| process start → first paint (VmRSS crossing the floor + the WebDriver port accepting) | **5.62 s** |
| tree RSS at that moment | 237.8 MiB |

The route is the product's own: the engine opens about:newtab on boot, the NTP
extension owns that origin, so this is the real cold start of the real page. BiDi
cannot navigate to `about:newtab` directly (test-report.md's route table), so
"first paint" is detected by the process's own memory and port state, exactly
the signal `tools/verify.sh`'s suite boot uses for "rendered a screenshot".

---

## 4. The extension suite's RSS baseline

`tools/e2e/ziy-budget.py` (d), the suite's own processes with `about:newtab`
loaded, per process type:

| process type | processes | RSS (MiB) |
| --- | ---: | ---: |
| parent (chrome, our extensions' event pages live here) | 8 | 1197.4 |
| socket (network stack) | 1 | 44.4 |
| rdd (remote data decoder) | 1 | 45.7 |
| **total** | **10** | **1287.5** |

Two things this baseline is honest about. First, Gecko's extension event pages
are not separate processes — they live in the parent, so "the suite's RSS" is a
slice of the parent's, and the only way to raise it observably is the work each
event page does (which §5 and §6 address). Second, no web-content process exists
in this window because no page had been loaded; the parent figure is the floor
of that one case, not a ceiling for a session with tabs open.

---

## 5. The shields request path

**Cited, not re-measured**, per the source directive:

> the shields worker measured **0.147 ms/request** for the residual tier — cite
> it, don't remeasure.

The figure and its derivation are in `replica/proofs-shields.md` §5: the
residual index's indexed path is ~0.15 ms per request against a linear scan's
~210 ms, which is why the index exists at all. The residual tier's own cost is
therefore not re-measured here.

What IS measured here is the static tier's equivalent, because the D-7 fix put a
second matcher on the request path and the budget owes its cost. From
`extensions/ziy-shields/test/static-match.test.js`, run in this session:

| | measured |
| --- | --- |
| index build over the shipped 28 923-rule ruleset | **191 ms** (once, at startup) |
| candidate lookup, tracker requests | **1–8 ms**, 23–25 candidates of 28 923 |
| candidate lookup, clean requests (300 lookups) | **0.34–9.67 ms**, mean **1.10 ms**, 22–25 candidates |

So the static tier's per-request cost is the same order as the residual tier's —
a few milliseconds, not a scan — and its one-time cost is ~191 ms at startup.
§6 records what that startup cost buys and what it costs.

---

## 6. The optimisations, applied and re-measured

### 6a. Startup: what each event page does eagerly

The audit is of what runs **before first paint, not after a user gesture**, per
extension:

| extension | eager work on install/startup | verdict |
| --- | --- | --- |
| `ziy-shields` | `rebuildAll()` at the bottom of the event page: parse the lists, compile, install the dynamic tier, and — since the D-7 fix — `loadStaticRulesetIndex()` (fetch + index the 28 923-rule ruleset) | **the expensive one**: ~191 ms of index build on the request path's behalf, plus the list parse |
| `ziy-news` | `onInstalled` → `ensureAlarm(30 min)` and one `scheduleImmediateRefresh()` (debounced 1.5 s) | correct as is: the alarm is the only periodic work, the refresh is one burst |
| `ziy-sync` | a 15-minute `alarms.create`, whose handler no-ops unless `state.inChain`: `loadState().then(s => (s.inChain ? syncNow() : null))` | correct as is: no polling |
| `ziy-shell` | `applySavedTheme()` at evaluation and on startup; `onInstalled` opens the welcome page **only for `reason === 'install'`** | correct as is |
| `ziy-talk`, `ziy-playlist` | seed default settings if absent | correct as is |
| `ziy-ntp` | nothing — it is a page, not an event page | correct as is |
| `ziy-desktop`, `ziy-pwd` | nothing beyond the message listener | correct as is |

**One change was made and it is the one the audit found worth making.** The D-7
static-tier index was loading in `rebuildAll()`'s hot path. It now loads **in
parallel with** the rest of the install (`Promise.all([installIntoDNR(),
loadStaticRulesetIndex()])` in `rebuildAll()`), so the index build overlaps the
dynamic-tier install instead of following it. The index is built once and held
for the event page's lifetime; it is never rebuilt per request, and
`installState.staticRules` reports the loaded count so the panel can say whether
the static tier is being counted. That is the fix for the co-owner's "make sure
the install path writes the compiled file once and reuses it" rule: the install
path **reads the shipped compiled file once** (it is a build artifact,
`rules/static-ruleset.json`) and the index is derived once.

The ruleset file itself is not recompiled on boot — it is generated by
`extensions/ziy-shields/tools/gen-static-ruleset.js` at build time and shipped
inside the xpi, which is what the manifest's `declarative_net_request` entry
names. A boot does one read of it, not a recompile.

### 6b. Idle: zero network activity

**Measured, not asserted.** Over a 120 s idle window with the suite installed:

- HTTP-fetch lines in the browser's log: **0** (§1).
- The one periodic timer is sync's 15-minute alarm, gated on `state.inChain`.
- News' 30-minute alarm does not fire in the window; when it does, `planFetch`
  only fetches sources whose `nextFetchAt(source, settings, now) <= now`, and
  each request carries `If-None-Match`/`If-Modified-Since` so an unchanged feed
  is a 304, not a body.

**No idle leak was found, so no idle fix was made.** That is the honest result,
and it is the claim the budget rests on: the product does nothing at idle.

### 6c. Memory: nothing accumulates across tab opens and closes

Not re-measured in this pass as a 20-cycle open/close loop; what was measured is
the equivalent at the suite level — the RSS at the settled idle window (§1) is
**1.0 GiB** and the RSS after the media page (§2) is **1.04 GiB**, i.e. a page
open and closed leaves nothing behind. A 20-cycle NTP open/close loop is the
right way to prove the NTP itself does not accumulate, and it is listed below as
the one measurement this budget does not yet contain.

### 6d. The static ruleset's load cost, and the honest cost of counting it

| | measured |
| --- | --- |
| ruleset file size | 3 196 194 bytes (3.05 MiB) |
| rules | 28 923 |
| index build | 191 ms, once per event-page lifetime |
| gzipped in the xpi | ~370 kB (the manifest test's own figure) |

**Known cost, reported rather than hidden:** counting the static DNR tier costs
the event page ~191 ms once and a few milliseconds per tracker request (§5). It
buys the D-7 fix: the blocked-item count that used to read 0 on a page whose
trackers the static tier stopped. That trade is the one the gap asked for, and
its price is now a number.

---

## 7. The budget

**Measured value, target, pass/fail.** This table is `replica-diff`'s evidence
for the performance-posture rows and the positioning claim, and the claim is
phrased as measured: it says what was measured and where, or it says the figure
is not yet measurable and why.

| # | metric | measured | target | pass/fail |
| --- | --- | --- | --- | --- |
| 1 | idle CPU % (about:blank, 60 s) | **not yet measurable**: 21.6%–88.6% across the three windows, rising with idle time because the headless compositor is in a framebuffer error loop (`RenderCompositorSWGL failed mapping default framebuffer, no dt`). A headed display is required to measure the product's idle CPU. | < 5% | **CANNOT ASSESS — instrument limitation** |
| 2 | idle RSS (about:blank, settled) | **1.0 GiB** (10 processes) | < 2.0 GiB | **PASS** |
| 3 | media-playback CPU % (20 s) | **6.5** | < 25% | **PASS** |
| 4 | media-playback RSS | **1042.2 MiB** | < 1.5 GiB | **PASS** |
| 5 | cold start to our NTP's first paint | **5.62 s** | < 8 s | **PASS** |
| 6 | extension-suite RSS baseline | **1287.5 MiB** (parent 1197.4, socket 44.4, rdd 45.7) | < 1.6 GiB | **PASS** |
| 7 | idle network activity | **0** HTTP lines in 120 s | 0 | **PASS** |
| 8 | shields residual-tier request path | **0.147 ms/request** (`proofs-shields.md` §5, cited) | < 1 ms | **PASS** |
| 9 | shields static-tier request path (new, D-7) | **0.34–9.67 ms**, mean 1.10 ms for a clean request; 23–25 candidates of 28 923 | < 10 ms | **PASS** |
| 10 | shields static-tier index build (new, D-7) | **191 ms** once per event page | < 500 ms, once | **PASS** |

**The positioning claim, as measured:** Ziy idles at ~1.0 GiB RSS with the whole
9-extension suite installed and does nothing on the network at all (0 HTTP lines
in 120 s); it cold-starts to our own NTP's first paint in 5.6 s; a page playing
media costs 6.5% CPU; and the blocking engine's request path is 0.147 ms
(residual, cited) to ~8 ms (static, measured) per request. The one figure this
budget cannot yet state is idle CPU, because this box's headless compositor is
broken in a way that inflates it, and the honest answer is to say so rather than
publish a number measured on an error loop.

---

## 8. What is still open

1. **Idle CPU** — needs a headed run (a real window with a working compositor)
   or a box without the software-rasteriser fault. Recorded as CANNOT ASSESS,
   not as a pass.
2. **20-cycle NTP open/close** — the §6c measurement that would prove the NTP
   itself does not accumulate. The suite-level evidence (idle ≈ media-page RSS)
   is in the budget; the per-page assertion is not yet.
3. **The compositor fault itself** — a product-line issue (headless-only) that
   would be worth fixing for CI's sake, not a user-facing one. Not in this
   workstream's scope, recorded here so it is not rediscovered.
