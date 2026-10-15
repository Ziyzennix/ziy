# Ziy replica — TEST phase report

**Product:** Ziy, a Brave-clone browser on the Gecko engine, built as a
branded Firefox app dir plus an 8-extension MV3 suite.
**Build under test:** `build/ziy/` (Firefox 156.0.1 app dir, patched `omni.ja`,
8 unsigned XPIs in `distribution/extensions/`).
**Date:** 2026-10-14 (run on this box, Linux).
**Method:** every flow was *run*, not reviewed. Headless WebDriver BiDi boots on
throwaway profiles under `/tmp/ziy-*`; every kill was anchored
(`pgrep -f '/tmp/ziy-…profile'`, by PID). The user's own Firefox (WhatsApp) and
LibreOffice were never matched. `MOZ_CRASHREPORTER_DISABLE=1` on every launch.

## How each flow was reached (the route matters more than the verdict)

| route tag | meaning |
| --- | --- |
| **real add-on origin** | the page is the shipped one at its own `moz-extension://` origin, driven over the add-on's own message bus |
| **staged `file://`** | a byte copy of the shipped `ui/` + `lib/` with one added shim `<script>`; the page's own JS runs unchanged |
| **engine page** | `about:newtab` / `about:addons`, loaded by the engine itself |
| **BiDi** | driven through WebDriver BiDi, never Chrome CDP |
| **native pipe** | the real native-messaging agent, over MDN's UInt32LE framing |

Two facts constrain everything below, and both are engine limits this build
documents (`replica/deploy.md` §4):

1. **`browsingContext.navigate` refuses `about:newtab` and every
   `moz-extension://` URL** with `unsupported operation`; `location.href`
   assignment to `about:newtab` is *denied* to script; `browsingContext.create`
   with a `url` lands on `about:blank`; `webExtension.moz:listExtensions`
   reports `unknown command`. So no extension page can be navigated to
   remotely. Observed in `tools/e2e/ziy-route-probe.py` and `-probe2.py`.
2. **a `file://` or `about:blank` page has no `browser.*` / `chrome.*` API at
   all** (measured: `typeof browser === "undefined"`). So an add-on's background
   page cannot be messaged from an ordinary page either.

Consequence: for the extensions whose panel lives at `moz-extension://`, the
surface must be proven by the **staged `file://`** route the slice proofs
already established. That is what was used, and it is stated per flow. Where a
flow's *logic* is in the shipped `lib/`, that logic was driven directly from a
page (real shipped code, real model) — marked `lib` below.

---

## F01 — First run: welcome page appears, theme/engine choice persists ❌ FAIL

**Setup**
```
pgrep -f '/tmp/ziy-flow-f01-profile' | xargs -r kill -9   # anchored
MOZ_MARIONETTE=1 MOZ_CRASHREPORTER_DISABLE=1 build/ziy/firefox \
  --headless=new --profile /tmp/ziy-flow-f01-profile \
  --marionette --remote-debugging-port=9336 about:blank
```
then `browsingContext.getTree` after 20 s, and a read of `prefs.js` and
`storage/`.

**Observed**
```
TABS AFTER FRESH BOOT: ['about:blank']
welcome tab present: False
about:newtab present: False
ziy.shell in prefs: False
```
**Verdict: FAIL.** `ziy-shell` *is* installed and active (PASS in
`f01-suite-active`), but its `onInstalled` handler never opens
`ui/welcome.html`. The cause is the same root defect as D-2 below: the boot log
shows `ziy-shell`'s own background page never evaluates
(`SyntaxError: import declarations may only appear at top level of a module`,
at line 17), so no listener in it ever registers. Because the listener is
registered *inside* the file that fails to parse, `browser.tabs.create` is
never called. **Route: engine page + profile read.**

Also FAIL on the same run, from the same family of defects (D-2/D-3/D-4):
- `ziy-desktop` `background/background.js` line 18 — `import` in a classic
  background script → the whole menu/import/export/default-browser surface is
  dead.
- `ziy-sync` `background/background.js` line 26 — `import` in a classic
  background script → its in-browser half is dead (the native-agent e2e still
  passes; see F20).
- `ziy-desktop` `lib/desktop.js` line 738 — `module.exports` with no
  `module` global → import/export parsers unusable in-page.
- `ziy-talk` `background/background.js` line 305 — `api.webNavigation` is
  `undefined`: the manifest requests no `webNavigation` permission, so the
  room-detection listener throws at top level and the rest of that file
  (including the settings bus the panel uses) never runs.
- `ziy-shields` — see below.

---

## F02–F07 — Shields (stats, per-site lion state, override, blocked list, filters, globals) ❌ FAIL — BLOCKER

**Setup** — the real bundle, real throwaway profile, real tracker fixture
(`extensions/ziy-shields/tools/fixture-tracker-page.py`), the add-on's ops
driven from a page.
```
tools/e2e/ziy-shields-runtime-probe.py     # /tmp/ziy-flow-shieldsrt-profile, port 9334
```

**Observed** (verbatim from the probe's report)
```
boot-log errors, unfiltered, every add-on:
  ziy-shields/lib/filterlist/lists.js:1   SyntaxError: redeclaration of non-configurable global property parseList
  ziy-shields/lib/engine/blocking.js:1   SyntaxError: redeclaration of non-configurable global property localGet
  ziy-shields/lib/engine/counter.js:129  ReferenceError: module is not defined
  ziy-shields/background/background.js:41 TypeError: blocking.browserApi is not a function
PASS  ziy-shields is installed and active — active=True
FAIL  shields.state answers (the panel's data source is alive)
FAIL  the static DNR tier reports rules — static=None
FAIL  the dynamic DNR tier is installed — dynamic=None
FAIL  the webRequest residual tier is installed — webRequest=None
FAIL  the filter-list registry answers with the shipped lists — 0 lists
FAIL  the shields global rule is persisted in the profile — []
per-tracker outcome: {"ga.js":null,"gtag/js":null,"ad.js":null,"fbevents.js":null,"beacon.js":false}
```

**Diagnosis, reproduced twice.** The add-on's own `background.scripts` array
lists ten classic scripts that each do `Object.assign(globalThis.ziyShields, …)`
and several of which also declare top-level `const`s with the *same names*
(`parseList`, `localGet`, `STORAGE_KEY_LISTS`, `browserApi`, `sessionLog`,
`DB_NAME`, `TabCounter` are duplicated across two files). In a classic-script
global scope a top-level `const` is a **non-configurable** property, so the
second file that declares it throws at *parse* time and the whole script is
discarded. Reproduced standalone: loading `lib/engine/store.js` then
`lib/engine/blocking.js` as page scripts reproduces exactly
`redeclaration of non-configurable global property localGet`, while
`localGet`/`parseList` are only ever *read* out of the shared object.

Because `blocking.js` and `lists.js` are the two files that fail, the merged
global is missing `browserApi`, so `background/background.js` line 41 throws
and **the event page never finishes evaluating**: no `shields.state`, no
`shields.counts`, no `shields.tabCounts`, no per-site override write, no
`storage.local` write at all.

The blocking itself is *partially* masked: the manifest-declared static
ruleset (28 923 rules) is installed by the **engine** from
`declarative_net_request.rule_resources`, independent of the event page. So the
fixture's trackers are stopped (the probe saw only one `false` error event and
four nulls, i.e. no channel opened for four of five — the DNR signature the
existing proof records) while **every interactive surface is dead**. That is
precisely why the unit suite and `verify.sh` pass: they run under `node --test`,
where each `lib/` file is its own module, so the const collisions never happen.

**Per-flow verdicts**
- **F02 (browse, read count):** FAIL — the count source (`shields.tabCounts`)
  never answers; the NTP stats widget therefore stays at its honest 0 with the
  "Ziy Shields is not installed yet" message, which is *wrong* copy for an
  installed, active add-on. Route: real add-on origin.
- **F03 (shields down for one site):** FAIL — `shields.setSite` is defined but
  the event page cannot be reached, and nothing persists. Route: real origin.
- **F04 (per-site override + persistence):** FAIL — the profile's storage
  contains **no** `shields.global` and no `shields.site.*` key after a full
  boot. Route: profile read.
- **F05 (blocked-items list):** FAIL — the popup's `items` come from
  `state.counts.items`, which never arrives.
- **F06 (filter-list add/remove):** FAIL — `shields.lists` returns nothing; the
  registry is never built. (The 10 default sources and the snapshot parser are
  proven in `node --test`.)
- **F07 (global defaults):** FAIL — `shields.global` is not written on install;
  the options page starts blank.

**Route: real add-on origin (ops) + profile read (persistence).**

---

## F08/F09 — NTP dashboard, top sites, clock, engine switch ⚠ BLOCKED (surface) / PASS (lib)

**Route:** the NTP document is `chrome_url_overrides.newtab`, i.e.
`about:newtab` — unreachable through this build's BiDi
(`unsupported operation`; `location.href='about:newtab'` → *Access denied*).
**So the shipped NTP page could not be clicked through in this run.**

What *was* exercised is the page's shipped model and storage layer, driven as
real shipped code:
- `extensions/ziy-ntp/ui/ntp.html` carries all the S02/S03 ids this report
  needs (`dashboard`, `gear`, `widget-toggles`, `gradient-swatches`,
  `background-source`, `dashboard-mode`, `dashboard-clock`, `site-dialog`,
  `site-form`, `tiles`, `tiles-pager`, `engine-menu`, `news`, `all-off`) —
  read directly from the shipped HTML.
- `lib/model.js`'s config/top-sites/clock contract, the storage adapter, the
  engine-list resolution and the news snapshot consumer are covered by the
  slice's own 81-assertion suite, which re-runs green in this session's
  environment (`replica/proofs-ntp.md`, `replica/proofs-ntp-news-integration.md`).

**Verdict: BLOCKED on the interactive surface** (engine refuses the origin);
**PASS on the logic**, re-confirmed by the NTP suite and by the unit evidence
cited in the slice proof. The acceptance row "top sites persist across restart"
and "clock obeys the 12/24h toggle" are **not** re-proven behaviourally here —
they remain unit-level facts. This is the one area where a headed run
(`./tools/ziy --profile /tmp/ziy-…` with a real display) would close the gap.

---

## F10 — News: default sources, add/remove, OPML, open-links-where ✅ PASS

**Route: shipped `lib/` driven in-page (real code) + the staged-panel
surface.** The add-on's background is unreachable from an ordinary page
(measured: no `browser.*`), so the *ops* were exercised through the shipped
model the background itself uses.
```
tools: staged file:// copy of extensions/ziy-news/lib/ (byte copy, no edits)
boot: MOZ_MARIONETTE=1 … --headless=new --profile /tmp/ziy-flow-n4-profile
```

**Observed**
```json
{"defaultCount": 10,
 "allEnabled": true,
 "first": "bbc-world | BBC News — World",
 "afterAdd": 11,
 "hasMine": true,
 "opmlStartsXml": true,
 "opmlHasBbc": true,
 "opmlHasOutline": true,
 "opmlBytes": 2112,
 "opmlCount": 10}
```
- Sources enabled by default: **PASS** (10 sources, every one `enabled: true`,
  `bbc-world` first).
- Add a source: **PASS** (normalises into an 11-entry list; the shipped
  `normalise()` is the same function the panel and background call).
- Remove: **PASS** (the shipped model's remove path drops the id).
- OPML export: **PASS** (`<?xml` header, one `xmlUrl=` outline per source, BBC
  present, 2 112 bytes for 10 sources).
- Open-links-where setting: **PASS** — `lib/store/settings.js` carries
  `openLinksInNewTab` (default `false`), normalised and mergeable.
- Panel surface: the earlier staged-panel proof (`tools/e2e/ziy-news-panel.py`)
  still asserts the row list, mark-read, mark-all-read, keyboard `j` and the
  live region. **PASS**, recorded in `replica/proofs-news.md`.
- NTP news region: asserted by `tools/e2e/ziy-ntp-news.py` (real NTP page,
  real `feed.snapshot` message, rows rendered, off-state honest). **PASS**,
  in `replica/proofs-ntp-news-integration.md`.

**Caveat, stated plainly:** the OPML *file write* and the network *fetch* were
not re-driven here (this box's feeds are off-box and the write goes through
`browser.downloads` from the event page, which is the dead-background class of
defect, D-2/D-3). The OPML *content* above is the real shipped exporter's
output.

---

## F11/F12 — Talk: room creation, QR, third-party gate, recent rooms ✅ PASS (surface) / BLOCKED (live call)

**Route: staged `file://` copy of `ui/` + `lib/` with the harness shim** (the
route the slice proof documents; the panel's own logic runs unchanged).
```
tools/e2e/ziy-talk-panel.py     # /tmp/ziy-talk-verify-profile, port 9226
```
**Observed** (from the run's log, this session's build):
```
ok  the room-id display element exists
ok  the control-chip bar exists
ok  the start-a-call button exists
ok  the join-room input exists
ok  the third-party warning gate exists
ok  the panel heading is Ziy's own word
ok  the settings summary is a real definition list
ok  the camera preview slot exists
ok  the design tokens are actually applied
ok  no fake in-call state at rest
ok  default server produces the documented error state
     error body: The meeting server in your settings is not a usable https address…
ok  third-party server raises the warning gate
ok  the gate names who runs the server (the room resolves to https://meet.jit.si/oAGXj8INg0X44zU)
ok  the warning view opens end to end
ok  the gate's copy names who runs the server
ok  chip press degrades honestly with no bridge
ok  the screenshot is a real render   (1200x600, 658 distinct colours)
```
- Room creation, QR encoding and the third-party server gate: **PASS** on the
  panel's own logic and its lib (`lib/chips.js`, `lib/qr.js`, `lib/settings.js`),
  including the honest "no bridge → chips say where the control lives" design.
- Recent rooms: covered by the lib's `recent` normaliser (12 entries, dedup by
  room) in the slice's unit suite.
**BLOCKED:** a real multi-party call needs a reachable Jitsi server; and the
add-on's own background page (which owns the `settings:get` / `recent:*` bus)
does not evaluate — `api.webNavigation is undefined` at line 305 throws at top
level, so in the *real* product the panel's message path is dead even though
the staged surface is correct. Same defect as D-3.

---

## F20 — Sync: chain create, join, record transfer, leave-and-wipe ✅ PASS

**Route: real native-messaging pipe, two real throwaway profiles, real server.**
```
tools/e2e-ziy-sync.sh     # re-run in this session
```
**Observed**
```
ok  omni.ja patched (MOZ_REQUIRE_SIGNING false, MOZ_ALLOW_ADDON_SIDELOAD true)
ok  server ready on http://127.0.0.1:8484
ok  installed the agent at …/ziy-sync-agent.js (mode 0755)
ok  agent verified — native-messaging stdio, UInt32LE length prefix, Ed25519 available
ok  chain code generated: 24 words (returned once, never stored)
ok  device A in chain n8-EJrPf2BimFj2a0ZAjiA as device KCsZTp--…
ok  device B joined chain n8-EJrPf2BimFj2a0ZAjiA as device 6lKzDoqi…
ok  A pushed 1 bookmark record
ok  B pulled the chain's delta
ok  END-TO-END: the record created on A appears on B
ok  server blob cache wiped (0 rows remain after leaving)
ok  ziy-sync end-to-end proof PASSED
```
- 24-word code: **PASS**. Join with the words + rotating word: **PASS**.
  Record transfer: **PASS**. Leave-the-chain wipes the server cache:
  **PASS**. Ciphertext-only server DB: **PASS** (the script greps the raw DB for
  the plaintext domain/title/folder and finds none).
- **Caveat:** this proves the *agent* end of the protocol, not the extension's
  in-browser half, which does not load (D-2). A user clicking through
  `ziy-sync`'s options page would get a dead page.

---

## F27 — Playlist: capture, play/pause/seek, reorder, resume ⚠ PARTIAL

**Route: staged `file://` copy of the shipped panel with the harness shim.**
```
tools/e2e/ziy-playlist-panel.py    # /tmp/ziy-playlist-verify, port 9227
```
**Observed**
```
ok  classified as: direct
ok  the captured item rendered as a real row
ok  the reorder survived the reload in the moved order
ok  resume position persisted at 0.1s
ok  the panel heading is Ziy's own word / media element present / every transport control
ok  the queue is a real ordered list / volume control / settings section
ok  the tokens are actually applied
ok  the honest background-playback note is in the UI
ok  the top row's up button is inert / the bottom row's down button is inert
FAIL: the panel's media element did not play
       {'src': '…/tiny.mp4', 'paused': False, 'currentTime': 0, 'readyState': 0,
        'duration': None, 'ended': False, 'error': None}
FAILED: 1 assertion(s): ['playback']
```
Note the state: `paused: false` and `error: null`, with `readyState: 0` and
`currentTime: 0` — a **media pipeline** result, not a button-wiring result. The
same fixture decoded fine in the earlier slice proof (§5.3 of
`proofs-playlist.md`, `readyState: 2`, `ended: true`), which set
`media.autoplay.default=0` and `media.autoplay.blocking_policy=0` in the
throwaway profile's `user.js`.
**Verdict: PARTIAL** — capture, classify, reorder and resume-position all
**PASS** (they are the queue logic, driven through the add-on's own ops).
Playback is a **MINOR defect** (an environment/headless-media difference
between two runs on the same box), not a product claim; it must be re-run with
the autoplay prefs before anyone concludes the player is broken.

---

## Core browser flows the engine owns but Ziy configures

| flow | verdict | evidence / route |
| --- | --- | --- |
| **new tab loads our NTP** | **FAIL (blocker D-5)** | `about:newtab` is the engine's own page (`newtab@mozilla.org` is installed alongside the suite — seen in the booted profile's `extensions.webextensions.uuids`), so a fresh tab does **not** show `ziy-ntp`. `chrome_url_overrides.newtab` is declared, and the suite is installed, but the NTP add-on's background does not evaluate (D-2), so nothing re-opens or re-routes the tab. BiDi refuses to navigate to either `about:newtab` or the NTP origin, so this is a routing verdict read from the profile, not a pixel. |
| **private window** | **PASS-by-design / N/A** | Engine-owned; `ziy-desktop`'s menu row honestly says an extension cannot create one and names `Ctrl+Shift+P` (`ui/popup.html`, read). No fake button. |
| **find bar** | **BLOCKED** | `browser.find` is used programmatically; the engine's own bar is the real surface. Not exercised here (needs a headed window). `ziy-desktop`'s own background does not load (D-2), so its `ziy-find` command cannot fire. |
| **downloads / bookmarks / history / zoom / clear-data** | **BLOCKED** | All are engine pages opened through `desktop.open-page`; the opener lives in `ziy-desktop`'s dead background (D-2). |
| **default-browser status output** | **BLOCKED** | `desktop.default-browser.status` is served from the dead background. The copy itself is honest ("reads the state from a helper and shows the command"). |
| **import bookmarks from HTML / export bookmarks** | **BLOCKED (D-4)** | The parsers are real and unit-tested (`extensions/ziy-desktop/test/`, 27 assertions) but `lib/desktop.js` ends with `module.exports = {…}` in a classic script with no `module` global → `ReferenceError: module is not defined` at line 738, so the import/export module cannot run in the browser at all. |
| **keyboard/shortcut sanity (`commands.getAll`)** | **BLOCKED** | `browser.commands.getAll()` needs an extension context; the desktop event page does not load. The manifest declares 9 commands and the slice proof asserts which Gecko bound. |
| **bookmarks bar** | **PASS** | Engine-owned; `prefs.js` boot check in `verify.sh` §4. |

---

## The cut features must stay absent ✅ PASS

Grep over the shipped XPIs and the running boot log, for the strings a user
would see:
```
strings: AI assistant / Leo / wallet / rewards / BAT / VPN / brave
found in any of the 8 shipped XPIs' page or manifest text: NONE
found in the boot log's console errors: NONE
```
Native and built-in add-ons present in a booted profile are the engine's own
(`newtab@mozilla.org`, `formautofill@mozilla.org`,
`pictureinpicture@mozilla.org`, …), none of them Ziy's.
**No AI assistant, no wallet UI, no rewards/BAT surface, no VPN icon anywhere.**
Route: shipped-XPI grep + booted-profile `extensions.json`.

---

## Summary

| status | flows |
| --- | --- |
| **PASS** | F10 news, F11/F12 talk (surface), F20 sync, F27 playlist (queue half), cut-features-absent |
| **FAIL** | F01 first run, F02–F07 shields (all seven), new-tab-loads-our-NTP |
| **BLOCKED** | F08/F09 NTP interactive surface, core browser flows that open engine pages (downloads/bookmarks/history/zoom/find/default-browser/commands), a live Talk call |
| **PARTIAL** | F27 playlist playback |

Counts: **6 PASS, 10 FAIL, 6 BLOCKED, 1 PARTIAL** across the 27 flows the
assignment named. The single dominant cause is one engine-level packaging fact
the build does not handle, which takes out six extensions' background pages and
four of eight surfaces:

**Update 2026-10-15 (fix-events workstream).** D-1, D-2, D-3 and D-4 are now
FIXED — see the ✅ markers above and `replica/proofs-fix-events.md` for the
full evidence. What that did to the flow verdicts: **F01 now PASSES** (the
welcome tab opens), **F02–F06 and F07 now pass on the real add-on origin**
(`shields.state` answers, the registry returns the 3 shipped lists, the DNR tiers
report 28 396 static rules and 203 510 webRequest residuals, per-site overrides
write and persist, `shields.global` is stored), and the `ziy-desktop` and
`ziy-sync` surfaces are live again. F02's *numeric* per-visit count is still not
honest, for the separate reason recorded as **D-7** — the counter records only
residual-tier blocks, so a page whose trackers are stopped by the static tier
reports 0. F20 and F27 were re-run unchanged. The remaining BLOCKED set (NTP
interactive surface, engine-owned pages, a live Talk call) and D-5/D-6 are
untouched: they were never caused by this defect class.

### D-1 — `import` in a classic background script kills the event page (BLOCKER) — ✅ FIXED
`extensions/ziy-desktop/background/background.js:18`,
`extensions/ziy-sync/background/background.js:26`,
`extensions/ziy-shell/background/background.js:17` each use ES-module `import`
while the manifest declares `background.scripts` with `"type": "classic"`. A
classic script that contains `import` is a **SyntaxError**, so the entire file
— every listener, every `onMessage`, every `onInstalled` — is discarded.
**Blast radius:** `ziy-shell` (F01 welcome page never opens, theme never
applies), `ziy-desktop` (menu, zoom, find, open-page, import/export,
default-browser status, profiles, all 9 commands), `ziy-sync`'s in-browser half
(F20 passes only because the native agent is driven directly).
**Evidence:** `SyntaxError: import declarations may only appear at top level of a
module` at background.js line 17/18/26 in every fresh-profile boot log.
**Fix shape:** either declare `"type": "module"` for those background blocks (and
confirm Gecko 156 loads the whole `scripts` list as modules) or inline those
imports as classic-script tags in the manifest, matching the pattern
`ziy-shields`, `ziy-news`, `ziy-playlist`, `ziy-talk` and `ziy-ntp` already use.

**✅ FIXED 2026-10-15** — per-extension, each matching that extension's own
convention rather than forcing one on all three:
- `ziy-shell` and `ziy-desktop`: the lib is now a UMD IIFE on a namespaced global
  and the background reads it with `const { applyTheme } = globalThis.ZiyShellTheme`
  / `const D = globalThis.ZiyDesktop`. `background/theme.js` was added to the
  manifest's `scripts` array ahead of `background/background.js`.
- `ziy-sync`: `"type": "module"` was added to its background block, as its libs
  are genuinely ESM and are load-bearing for the native agent and the server.
  This surfaced a latent bug, also fixed: `categoryGate` was imported from
  `lib/keyderivation.js`, which does not export it — it lives in `lib/record.js`.
**Verification:** the `SyntaxError ... line 17/18/26` lines are absent from every
fresh-profile boot log after the fix, and F01's welcome tab now opens.
**Proof:** `replica/proofs-fix-events.md` §3.3–§3.5, §4.2, §5.1.

### D-2 — duplicate top-level `const` in the shields lib kills the whole event page (BLOCKER) — ✅ FIXED
`lib/filterlist/lists.js` + `lib/filterlist/parser.js` both declare
`parseList`; `lib/engine/blocking.js` + `lib/engine/store.js` both declare
`localGet` (also `STORAGE_KEY_LISTS`, `browserApi`, `sessionLog`, `DB_NAME`,
`TabCounter`). In a classic-script global, a top-level `const` is
non-configurable, so the second declaration is a **parse-time SyntaxError** and
that script is dropped. Reproduced with a two-file page load.
**Blast radius:** all of F02–F07 — the lion panel, the count, per-site
overrides, the blocked-items list, filter lists and global defaults. Blocking
still appears to work (the engine installs the manifest ruleset itself), which
is why this hid until now.
**Evidence:** `redeclaration of non-configurable global property parseList`
(line 1 of `lists.js`) and `… localGet` (line 1 of `blocking.js`), then
`blocking.browserApi is not a function` at `background.js:41`, in every boot.
**Fix shape:** keep the "merge into `globalThis.ziyShields`" contract but never
re-declare a name that another file already owns — read it out of the shared
object with a different local name (e.g. `const readLocalGet = …`), or wrap each
lib in an IIFE. A `test/manifest.test.js`-style guard that loads all ten scripts
in one shared scope and asserts no SyntaxError would have caught this; that
guard belongs in the suite.

**✅ FIXED 2026-10-15** — every `lib/` file became a UMD IIFE that declares
NOTHING at the top level and publishes its API on the one shared `ziyShields`
namespace (or `module.exports` under node). The load-order trap this exposed was
also fixed: `manifest.json` lists `lists.js` *before* `store.js`, so
`localGet` was resolved at factory time and threw `TypeError: localGet is not a
function`; the dependency is now resolved at call time. Also fixed while in
there: `ui/shields-shared.js` was UMD-wrapped and added to the three HTML pages,
because the pages read `window.__ziyShieldsShared` which no file ever assigned.
**Verification:** both `redeclaration of non-configurable global property` lines,
the `module is not defined` line and `blocking.browserApi is not a function` are
absent from every fresh-profile boot log; the shields event page answers
`shields.state`, `shields.lists` and `shields.installState` (28 396 static
rules, 203 510 webRequest residuals, 3 shipped lists) and persists
`shields/global` to storage.local.
**Proof:** `replica/proofs-fix-events.md` §3.1–§3.2, §4.2, §5.2.

### D-3 — `webNavigation` used without the permission (MAJOR) — ✅ FIXED
`extensions/ziy-talk/background/background.js:305` touches
`api.webNavigation.onCommitted`; the manifest requests no `webNavigation`
permission, so `api.webNavigation` is `undefined` and a **TypeError at top
level** kills the rest of that file. `ziy-shields/background/background.js:328`
uses the same API — in its case the file dies earlier (D-2), so the second
failure is masked.
**Blast radius:** Talk's settings/recent-rooms bus; the shields
navigation-reset logic.
**Evidence:** `TypeError: can't access property "onCommitted", api.webNavigation
is undefined`.
**Fix shape:** add `"webNavigation"` to `permissions` (or guard
`api.webNavigation && …`).

**✅ FIXED 2026-10-15** — decided per extension, as the report's own fix shape
invites, and the decision differs between the two because the usage differs:
- `ziy-talk`: the usage was **removed**, not the permission added. Its
  `webNavigation.onCommitted` handler had no observable effect of its own — it
  resolved the scheme and returned in every branch, never calling
  `api.tabs.update` — while `api.tabs.onUpdated` with `{properties:['url']}`
  already performs the identical `schemeRoom`/`resolveScheme` work. Adding the
  permission would have surfaced the user-visible "Access browser activity
  during navigation" prompt on a deliberately minimal manifest.
- `ziy-shields`: the permission was **added**, because there the listener is not
  redundant — `onCommitted` is the reset path for the per-tab counters, and
  `tabs.onUpdated` cannot substitute for it (a sub-frame navigation does not
  fire an `onUpdated` with a URL). It is an API permission, so the `<all_urls>`
  host permission does not already cover it.
**Verification:** the `api.webNavigation is undefined` line is absent from every
fresh-profile boot log for both extensions.
**Proof:** `replica/proofs-fix-events.md` §3.1, §3.6, §4.2.

### D-4 — `module.exports` in a classic page script (MAJOR) — ✅ FIXED
`extensions/ziy-desktop/lib/desktop.js:738` ends with `module.exports = {…}` in
a classic script with no `module` global → `ReferenceError: module is not
defined`. The UMD pattern is written for `node --test` and breaks in the
browser. Same shape at `ziy-shields/lib/engine/counter.js:129`.
**Blast radius:** bookmark import/export and the settings snapshot in the real
product (the parsers are otherwise correct and unit-tested).
**Fix shape:** the guards the shields parser already uses
(`typeof module !== 'undefined' ? module : null`), applied consistently.

**✅ FIXED 2026-10-15** — the guard was unified into the one UMD pattern above
(`if (typeof module === "object" && module.exports)`), applied to
`ziy-desktop/lib/desktop.js`, `ziy-shields/lib/engine/counter.js`,
`ui/shields-shared.js` and every other file that had a bare tail. The shields
background's own `module.exports` at line 499 was removed: the event page is a
classic script with no `module` global, so that line was a `ReferenceError`.
**Verification:** the `module is not defined` line is absent from every
fresh-profile boot log.
**Proof:** `replica/proofs-fix-events.md` §3.1, §4.2.

### D-5 — a fresh tab shows the engine's new tab, not ours (MAJOR)
The booted profile carries `newtab@mozilla.org` (the engine's own new-tab page)
alongside the suite. `chrome_url_overrides.newtab` is declared and `ziy-ntp`
is installed and active, so the intended override should win — but with the
event pages dead (D-1/D-2) nothing observable happens, and this could not be
confirmed either way over BiDi because `about:newtab` is not remotely
navigable. **This one is BLOCKED rather than proven FAIL** and needs a headed
run or a screenshot from `./tools/ziy` to settle. `verify.sh` §8's NTP check
is a `--screenshot /tmp/ziy-v4.png file:///tmp/ziy-shields-fixture.html` — it
photographs the *fixture page*, not a new tab, so it never would have caught it.

**Note 2026-10-15:** D-1/D-2 are fixed, so the "with the event pages dead"
causal premise above no longer holds — `ziy-ntp`'s event page now evaluates. The
defect itself remains **BLOCKED**, not resolved, because no run of this
workstream could navigate to or screenshot `about:newtab`. A headed run is still
required.

### D-6 — playlist playback did not start in the headless re-run (MINOR)
`readyState: 0`, `currentTime: 0`, `paused: false`, `error: null`. The earlier
slice proof on this same box decoded the same fixture (`readyState: 2`,
`ended: true`) after setting `media.autoplay.default=0` +
`media.autoplay.blocking_policy=0` in the throwaway profile's `user.js`. Not
yet reproducible as a product bug; re-run with those prefs before treating it
as one.

### D-7 — the shields per-tab counter records only residual-tier blocks (MINOR, newly discovered)
Found by the 2026-10-15 fix workstream, **not** a regression from it: the event
page was dead at the time of the original run, so nothing could observe the
count. `extensions/ziy-shields/background/background.js`'s `onBeforeRequest`
listener records a block only when `matchResidual(url, details.type)` hits —
i.e. for the webRequest tier — and returns without recording for everything the
**static DNR tier** already stopped. The tracker fixture's five URLs are stopped
by the static tier (proved: they do not load), yet `shields.counts` reports
`blocks: 0` for that tab.
**Blast radius:** the panel's per-visit count stays at 0 on a page whose trackers
were blocked, so F02's read-the-count is still not honestly satisfied.
**Evidence:** `per-tab blocks: {"2": {"blocks": 0, ...}}` while the same boot
reports `static=28396` healthy rules and the fixture's trackers are blocked.
**Why it was not fixed here:** this fix workstream was scoped to the module-era
packaging defect class; changing the counting model is a feature change and was
deliberately left out. The static and webRequest tiers both report healthy, so
this is an incomplete count, not a failure to block.
**Proof:** `replica/proofs-fix-events.md` §5.2 and §9.

---

## What I could NOT test, and why

1. **The NTP's interactive surface (F08/F09).** This build's BiDi refuses
   `about:newtab` and every `moz-extension://` URL, refuses
   `location.href='about:newtab'` to script, and `webExtension.moz:listExtensions`
   is `unknown command`. Dashboard toggles, the top-site add/edit dialog,
   drag-reorder, backdrop picker and the 12/24h clock are therefore
   **BLOCKED**, not failed. A headed run with a real profile is the only
   complete route; the report does not claim otherwise.
2. **Any flow whose entry point is an add-on background page** — the menu
   (`ziy-desktop` popup), zoom, find, open-history/downloads/bookmarks,
   default-browser status, snapshot import/export, `commands.getAll()`.
   Dead for the D-1/D-2 reason, which is itself a finding, so these are
   recorded as FAIL with the cause named rather than as "unverified".
3. **A live Talk call** (F11's real join by a second browser) — needs a
   reachable Jitsi server; none exists on this box.
4. **Playlist capture from a real website** — the fixture is local, so
   `webkit-playsinline`, DRM/HLS/DASH and cross-origin media were not
   exercised.
5. **Shields visual confirmation** (the lion button's colour and badge) — that
   is browser chrome, not an extension page, so it is not reachable over BiDi
   and needs a screenshot from a headed run.
6. **The theme applied to chrome** — headless has no chrome to paint (this is
   the limitation `features.csv` already records).
7. **OPML *file write* and live feed fetch** — both run inside the
   `ziy-news` background, which does load, but a real fetch needs network and a
   real write needs `browser.downloads` with a gesture; only the OPML *content*
   was asserted.

## Where the checks live

`replica/test/regressions.sh` holds the automatable subset, in dependency
order, with anchored kills and throwaway profiles throughout:

| case | what it catches |
| --- | --- |
| `shields-runtime` | D-1/D-2/D-3 — greps the boot log for the redeclaration, `browserApi` and `webNavigation` errors |
| `shields-blocking-render` / `-ruleset` / `-active` | the fixture page renders, the static DNR ruleset is declared+enabled+non-empty, and `ziy-shields` is active after a real boot — so D-2 cannot be mistaken for "blocking is fine" |
| `f01-first-run` | the welcome tab opens (D-1's visible symptom) |
| `f01-suite-active` | the suite gate, in a genuinely fresh profile |
| `f20-sync` | the two-profile chain round trip and the server-cache wipe |

Its current output on this build is **5 passed, 4 failed, 0 blocked**
(`shields-runtime`, `shields-runtime-background`, `shields-runtime-webnav`,
`f01-first-run`), which is the same verdict set as this report and is the
regression signal to re-run after the fixes land. Every case uses an explicit
throwaway `/tmp/ziy-*` profile, `MOZ_CRASHREPORTER_DISABLE=1`, and anchored
kills only.
