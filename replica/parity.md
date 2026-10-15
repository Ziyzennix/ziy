# parity.md — the Ziy replica scorecard

**Date:** 2026-10-15 · **Matrix:** `replica/features.csv` (207 rows, 9 columns)
**Scored by:** the parity workstream, against `replica/proofs-*.md`,
`replica/re-deep-*.md`, `replica/test-report.md` and `replica/evidence.md`
only. A row moved to `yes` because of evidence, never because of a plan.

## What a `yes` means here

A row is `clone=yes` **only** when all three hold:

1. an implementation exists in the tree (`extensions/`, `shell/`, `tools/`,
   `server/`, `native/`);
2. it is exercised by a passing check — a node test, a boot proof, or an e2e —
   cited by file and section in the row's `notes`;
3. where a browser is applicable, the behaviour was observed in a real browser
   run. The BiDi and staged-`file://` routes count, on the terms each proof
   itself states (including where a proof says the route could not reach a
   surface, that surface stays unproven).

`partial` = implemented but incomplete or unverified-live. `no` = otherwise.
`cut` = deliberately absent by product decision. `skip` = uncloneable.
Nothing flipped on a design document.

---

## 1. Per-area scorecard

`score%` is the weighted feature score the skill's `parity.py` computes
(must 3 / should 2 / could 1, `partial` counts half). Cut and skip rows score
zero by construction and are counted in their own columns, not as gaps.

| area | total | yes | partial | no | cut | skip | score% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| core browsing | 16 | 9 | 0 | 7 | 0 | 0 | 64.5 |
| shields | 26 | 11 | 5 | 10 | 0 | 0 | 64.5 |
| talk | 18 | 7 | 1 | 10 | 0 | 0 | 51.7 |
| privacy | 15 | 5 | 1 | 9 | 0 | 2 | 43.2 |
| user feedback | 14 | 1 | 0 | 13 | 2 | 0 | 10.0 |
| news | 6 | 4 | 0 | 2 | 0 | 0 | 71.4 |
| new tab page | 5 | 5 | 0 | 0 | 0 | 0 | 100.0 |
| ntp | 3 | 3 | 0 | 0 | 0 | 0 | 100.0 |
| sync | 9 | 9 | 0 | 0 | 0 | 0 | 100.0 |
| downloads | 2 | 2 | 0 | 0 | 0 | 0 | 100.0 |
| playlist | 8 | 6 | 0 | 2 | 0 | 1 | 80.0 |
| onboarding | 7 | 6 | 0 | 1 | 0 | 0 | 88.9 |
| extensions | 5 | 3 | 0 | 2 | 0 | 1 | 75.0 |
| bookmarks | 2 | 1 | 0 | 1 | 0 | 0 | 75.0 |
| security | 4 | 2 | 0 | 2 | 0 | 0 | 57.1 |
| permissions | 2 | 1 | 0 | 1 | 0 | 0 | 60.0 |
| history | 3 | 1 | 0 | 2 | 0 | 0 | 37.5 |
| search | 11 | 2 | 0 | 9 | 1 | 0 | 23.5 |
| appearance | 3 | 1 | 0 | 2 | 0 | 0 | 40.0 |
| wallet | 13 | 0 | 0 | 13 | 13 | 0 | 0.0 |
| rewards | 12 | 0 | 0 | 12 | 11 | 1 | 0.0 |
| vpn | 6 | 0 | 0 | 6 | 5 | 1 | 0.0 |
| sidebar | 4 | 0 | 0 | 4 | 4 | 0 | 0.0 |
| ads | 1 | 0 | 0 | 1 | 0 | 1 | 0.0 |
| business | 2 | 0 | 0 | 2 | 0 | 2 | 0.0 |
| engine | 3 | 0 | 0 | 3 | 0 | 3 | 0.0 |
| autofill | 2 | 0 | 0 | 2 | 0 | 0 | 0.0 |
| reading | 3 | 0 | 0 | 3 | 0 | 0 | 0.0 |
| profiles | 1 | 0 | 0 | 1 | 0 | 0 | 0.0 |
| browsing basics | 1 | 0 | 0 | 1 | 0 | 0 | 0.0 |
| **TOTAL** | **207** | **79** | **7** | **121** | **36** | **12** | — |

The eleven 0.0% areas are *not* all failures: wallet (13) and sidebar (4) are
entirely `cut`, rewards has 11 cut of 12, vpn 5 cut of 6, and `engine` (3),
`business` (2) and `ads` (1) are entirely `skip`. Counting rows that are
genuinely unbuilt — `no` and neither `cut` nor `skip` — the whole matrix holds
**73**, of which 11 are the `user feedback` research backlog and 10 sit in
`talk` and 10 in `shields`. None of the 0.0% areas other than `reading`,
`browsing basics`, `autofill` and `profiles` (6 rows between them) is a gap at
all.

---

## 2. The must-row scorecard

This is the number that matters. Must-rows are counted against the
**deliverable set** — every row except the uncloneable `skip` rows and the
deliberately cut product decisions.

| priority | yes | partial | no | total | weighted |
| --- | ---: | ---: | ---: | ---: | ---: |
| **must** | **40** | **5** | **8** | **53** | **80.2%** |
| should | 22 | 0 | 27 | 49 | 44.9% |
| could | 17 | 2 | 38 | 57 | 31.6% |

Against Brave's full must-set (including the 9 must-rows the product cut —
wallet lock/portfolio/send, rewards enablement/tips, the wallet sidebar, the
VPN toggle): **40 yes, 5 partial, 17 no of 62** → weighted **68.5%**.

The skill's `parity.py` reports **"must-haves 39 of 57 done"** on the same CSV.
That is not a contradiction: it drops the 14 `original=no` rows (4 of which are
`must`, all in `user feedback`) from its denominator while still charging the
`skip` rows, so its must-set is 57 rows and its `yes` count 39 — the same rows,
minus the 4 must-rows that are Ziy's own additions and the one `yes` that comes
with them. Against the deliverable must-set this report says **40 of 53**;
against the tool's narrower Brave-only must-set, 39 of 57 is the same
measurement.

The 8 unbuilt must-rows, with the reason each is not `yes`:

| must-row | state | why |
| --- | --- | --- |
| ~~Built-in password manager~~ | **yes** | **CLOSED 2026-10-15** — a native helper owns an encrypted vault (PBKDF2-SHA512 + AES-256-GCM); the browser's half saves, lists, imports and exports. Form filling is absent by design, with the reason (`proofs-must-gaps.md` §3) |
| Tab groups | no | `browser.tabs.create`'s `pinned` flag is the only grouping surface Gecko exposes (`proofs-desktop.md` §1.1); no grouping chrome |
| Clear browsing data dialog | no | engine chrome, but Ziy's opener lived in the pre-fix dead event page (`test-report.md`) and no check now exercises that path |
| Private window with Tor connectivity | no | no Tor code anywhere in `extensions/`, `shell/`, `native/` |
| ~~Crash-safe session restore~~ | **yes** | **CLOSED 2026-10-15** — the engine's crash-recovery path confirmed from our own omni.ja's sessionstore source (`SessionStartup.sys.mjs`: `RECOVER_SESSION` needs `resume_from_crash && previousSessionCrashed`); Ziy's `resume_from_crash=false` was found and the fix prefs recorded; `tools/e2e/ziy-gap4-restore.py` closes cleanly (the engine's write happens at shutdown), relaunches, SIGKILLs by anchored PID and asserts the recorded tab is still open after the reboot — **7 passed / 0 failed** (`proofs-must-gaps.md` §4) |
| ~~Published resource budget~~ | **yes** | **CLOSED 2026-10-15** — published in `replica/resource-budget.md` with every figure measured on this box; idle CPU is reported as CANNOT ASSESS with the headless-compositor reason, not as a measured value |
| Download/password-store durability | no | engine persistence not coupled to any Ziy check; no durable store, no crash test |
| Per-site shields memory + auto-relax | no | the memory half is **done and proven** (`proofs-fix-events.md` §5.2); the degraded-page auto-relax prompt is not implemented |

The 5 `partial` must-rows are all "built, not yet honestly complete":

| must-row | state | why |
| --- | --- | --- |
| ~~Show count of blocked items~~ | **yes** | **CLOSED 2026-10-15** — defect D-7 fixed: `lib/engine/static-match.js` re-evaluates the shipped 28 923-rule static ruleset for counting (never blocking), the count went from `blocks=0` to non-zero on the fixture tab, and the item names the URL with `tier: 'dnr'` (`proofs-must-gaps.md` §1) |
| ~~List blocked trackers and scripts~~ | **yes** | **CLOSED 2026-10-15** — the D-7 gate is gone, so `#ziy-items` renders real rows; the item list was read back live from the running add-on with its url, category, tier and rule id (`proofs-must-gaps.md` §1) |
| Shields Simple view | partial | the read-only section exists in `ui/popup.html`; the add-on page renders the state sentence and a count live, but the popup itself is still not screenshotted (`proofs-shields.md` §8) |
| Shields Advanced view | partial | all rows and the fingerprinting sub-toggles exist; no live click-through, and the shell write to `privacy.fingerprintingProtection.granularOverrides` is designed-not-end-to-end (`proofs-shields.md` §8) |
| Talk screen sharing | partial | the chip maps to `toggleShareScreen` with a live bridge and degrades to an annotation without one; no real share was ever exercised (no reachable Jitsi server, and the content script did not inject on this build — `proofs-talk.md` §7.1/§4) |

---

## 3. The two overall percentages

The matrix has three natural denominators, and they must be named, because
"parity" means something different against each. `skip` rows are uncloneable
and excluded from every score. The 14 `user feedback` rows are Ziy's own
additions from the review corpus, not Brave's feature set, so the skill's
`parity.py` leaves them out of the parity number too (it lists them under
"Yours, not in the original (not scored)").

| denominator | rows | weight | earned | percentage |
| --- | ---: | ---: | ---: | ---: |
| **Brave's full feature set** (all 207 rows, nothing excluded) | 207 | 395 | 189.5 | **48.0%** |
| **Brave's set excluding `skip`** (195 rows — the uncloneable rows removed) | 195 | 383 | 189.5 | **49.5%** |
| **The deliverable set** (159 rows — excluding `skip` *and* `cut`) | 159 | 314 | 189.5 | **60.4%** |
| *the skill's own `parity.py` output* — it drops only the 14 `original=no` rows and still charges the 12 `skip` rows at full weight | 193 | 365 | 186.5 | **51.1%** |

Read them together, never alone. **48.0%** is what a Brave user sees when they
list every feature Brave documents. **60.4%** is what this project set out to
ship: everything Brave does that a clean-room clone on Gecko can actually do,
with the cut and uncloneable rows priced out. **51.1%** is the skill tool's
figure, and it is the *conservative* one: it removes only Ziy's 14 own-product
additions and keeps the 12 uncloneable rows in the denominator at full weight,
so it prices features nobody can build as if they were owed.

The 12-point spread between 48.0% and 60.4% is **deliberate scope, not missing
work**: 36 cut rows (wallet, rewards, VPN, the wallet sidebar, the AI answer)
and 12 skip rows (Widevine, site isolation, BAT rails, Guardian, Mojo, Skia,
P3A, Brave's account system, Brave's ad marketplace). Those are decisions with
names on them in `replica/fixes.md`, not gaps.

---

## 4. Verified live vs verified by test only

Of the **79** `yes` rows, the evidence route cited in each row's `notes`:

| evidence route | rows | what it means |
| --- | ---: | --- |
| **observed live in a browser** | **42** | driven over WebDriver BiDi or the staged-`file://` route, against the real app dir and the shipped code |
| **not observed live** | **37** | proven by node tests, by the shell boot (`tools/verify.sh` §4, `proofs-shell.md` §1.7), or by reading the engine's own schemas — every one of these rows says which in its note |

So **42 of 79 (53%)** of the shipped surface has been seen working in a
browser, and **37 (47%)** has not. Within the 37, two distinct groups must not
be conflated:

- **the shell-boot group** — Ziy's hardening prefs, the branding, the theme, the
  suite install. These were genuinely observed, in a headless boot, and
  `tools/verify.sh` §4 re-proves them each run.
- **the test-only group** — 35 rows whose claim rests on node suites and schema
  reads alone. These are honest `yes` under the row rules (an implementation
  exists and a passing check exercises it), and they are flagged here so nobody
  mistakes them for the 42.

The headline live observations, by area:

| area | rows | the live proof |
| --- | ---: | --- |
| shields | 8 | 5 of 5 fixture trackers stopped with 0 reaching the page (`proofs-shields.md` §7.3); per-site override persisted and read back out of `storage.local` (`proofs-fix-events.md` §5.2); `shields.state`, `shields.lists`, 28,396 static + 203,510 webRequest rules all answering |
| ntp + new tab page | 8 | 17 in-browser checks pass on the shipped NTP page: widgets, dashboard, clock, tiles, engine switcher, news region rendering real rows (`proofs-ntp-news-integration.md` §4.2, non-blank screenshot) |
| news | 3 | 10 default sources all enabled, add/remove normalising, OPML content with BBC present (`test-report.md` F10), the `feed.snapshot` contract answered for the NTP |
| sync | 6 | two-profile e2e over the real native pipe, chain create/join/record transfer, and `server blob cache wiped (0 rows remain)` (`proofs-sync.md` §5) |
| talk | 4 | 17 in-browser panel checks, QR verified by an independent decoder, no fake in-call state at rest (`proofs-talk.md` §6) |
| playlist | 4 | a real mp4 decoding, playing to `ended`, pausing and seeking; reorder and resume surviving a reload (`proofs-playlist.md` §5.2–§5.4) |
| onboarding | 3 | the welcome tab opening on a fresh boot, driven live over BiDi (`proofs-fix-events.md` §5.1) |
| privacy | 4 | the whole hardening set (RFP, letterboxing, granularOverrides, disabled APIs, cookie caps, referrer capping) landing in a real headless boot |
| appearance | 1 | `browser.theme.update()` light/dark/system, re-applied on startup and OS change (`proofs-pkg.md` §4.2) |

**What the 35 test-only rows are.** Almost all of them are engine-inherited
chrome that Ziy configures rather than builds — tabs, pin, print, view-source,
devtools, bookmarks bar, history, downloads, find bar, permissions, extensions
manager, shortcuts, Safe Browsing. They are honest `yes` with the note
*engine-provided (Gecko), configured/branded by Ziy*, and their evidence is
either a boot proof (the app dir boots, the suite installs and is active) or a
schema read (Gecko's own `tabs.json`/`find.json`/`windows.json`). A handful are
Ziy-built surfaces whose model is fully pinned but whose click-through was not
exercised: the cookie-control dropdown, the search-results submission, the
bang/keyword path, the playlist settings section, the talk chips' live-bridge
half, and the sync category toggles.

---

## 5. Every row left at `no` or `partial`, with its one-line reason

### 5.1 `no` — 13 rows in the deliverable set, by priority

**[must]**

- ~~**Built-in password manager** — no password-manager surface; the engine exposes no write API to extensions, so the row is absent rather than faked (`proofs-desktop.md` §6.4)~~ → **CLOSED 2026-10-15:** the engine limitation is real and unchanged, but it no longer forces absence — `native/ziy-pwd` owns an encrypted vault (PBKDF2-SHA512 600k + AES-256-GCM) and `extensions/ziy-pwd` saves/lists/imports/exports through it. Autofill of page forms is deliberately not shipped and the panel says so (`proofs-must-gaps.md` §3)
- **Tab groups** — engine chrome Gecko 156 does not expose to extensions (`proofs-desktop.md` §1.1 schema read)
- **Clear browsing data dialog** — engine chrome whose Ziy opener lived in the pre-fix dead event page; no check exercises it now
- **Private window with Tor connectivity** — no Tor implementation anywhere in the tree
- ~~**Crash-safe session restore for tabs and windows** — no restore-point-on-change, no kill-the-renderer test (`fixes.md` §2)~~ → **CLOSED 2026-10-15:** the crash path is confirmed from `SessionStartup.sys.mjs` inside our patched omni.ja, Ziy's `resume_from_crash=false` was found and the fix prefs recorded, and `tools/e2e/ziy-gap4-restore.py` is the kill-the-renderer test — 7 passed / 0 failed, with the tab surviving a kill -9 and a reboot (`proofs-must-gaps.md` §4)
- ~~**Published resource budget: idle CPU/RSS, YouTube CPU, memory, cold start** — no measured or published budget~~ → **CLOSED 2026-10-15:** `replica/resource-budget.md` publishes the measured figures (idle RSS 1.0 GiB, zero idle network in 120 s, 6.5% CPU playing media, 5.62 s cold start to our NTP, 1287.5 MiB suite RSS, 0.147 ms residual request path cited / 1–8 ms static measured) with the method, its limits and a pass/fail table. Idle CPU is honestly CANNOT ASSESS on this box
- **Download and password-store durability across crashes and updates** — engine persistence is not coupled to any Ziy check; no durable store, no crash test
- **Per-site shields override memory and auto-relax prompt** — the per-site memory half is DONE and proven; the degraded-page auto-relax prompt is unbuilt

**[should]**

- **Custom toolbar** — no toolbar-customisation UI
- **Autofill (addresses/payment methods)** — no autofill surface in the tree
- **Vertical tabs** — the shell locks vertical tabs OFF (`sidebar.verticalTabs=false`) and Ziy builds no alternative
- **Tab search** — engine chrome; no Ziy implementation, nothing exercised
- **Per-site cookies and site data clearing** — no per-site data UI
- **Brave News channels** — no channel concept in `extensions/ziy-news`
- **Brave News custom RSS/site search** — no RSS/site search bar
- ~~**Import passwords via CSV** — deliberately absent: no CSV password path, no write API (`proofs-desktop.md` §6.4)~~ → **CLOSED 2026-10-15:** `native/ziy-pwd`'s `csv.import`/`csv.export` in the Netscape-CSV shape, round-trip pinned by tests on both sides of the process boundary (`proofs-must-gaps.md` §3)
- **Permission lifetimes (fine-grained)** — no fine-grained lifetime UI
- **Tor window API restrictions** — no Tor implementation to restrict
- **Speedreader** — not built and deliberately not faked; `trafilatura` rejected as a dependency (`proofs-desktop.md` §8)
- **Search result vertical tabs (images/news/videos)** — the results UI this clone does not ship; its index is out of scope
- **Date and location filters** — no filter controls
- **Safe Search setting** — no Safe Search surface
- **Search settings panel (language/region/theme/units)** — no search settings panel
- **Lookalike URL warnings** — no lookalike-URL warning
- **Strict HTTPS Upgrade Mode** — UI state and resolver only; only `auto` maps to engine behaviour (`proofs-shields.md` §8)
- **Disable individual fingerprinting protections** — `buildGranularOverride()` builds the JSON array, but no extension API writes the pref and the shell write path is not proven at runtime (`proofs-shields.md` §8)
- **Forget me when I close this site** — a switch in the rule model with no mechanism that performs the wipe
- **Talk lobby mode** — no lobby-mode state in the settings model
- **Talk passcode** — no passcode field
- **Talk room erasure on last participant leaving** — no room-erasure logic (self-hosted Jitsi owns room lifetime)
- **Mobile tab switcher with bottom-edge close and one-handed reach** — no implementation (desktop-only scope per the matrix)
- **Clear-field and search-bar ergonomics for touch typing** — no clear-field control
- **Vertical tabs, tab-bar scrolling and ctrl-tab most-recently-used** — no vertical tabs, no tab-bar scroll, no ctrl-tab MRU
- **Two-tap clear-data control and real page-level dark mode** — half-built: a real shell dark mode ships, but no two-tap clear-data control and no page-level dark mode
- **Published network-endpoint list and first-run privacy statement** — the posture is locked and documented, but no machine-readable list and no first-run statement ship

**[could]**

- **Vertical tab layout** — locked OFF by the shell with no Ziy-built alternative
- **Save all open tabs as a bookmark folder** — engine chrome (Ctrl+Shift+D) but not configured or branded by Ziy; no Ziy surface claims it
- **Web Apps (install site as app)** — no site-as-app installer
- **Split-view tabs** — engine chrome Ziy does not ship
- **Screenshot tool** — no implementation
- **Task manager** — no implementation
- **Spellcheck** — no dictionary UI; the engine's default spellcheck ships with no Ziy surface
- **Built-in extension toggles (Google login/Hangouts/Media Router/Widevine)** — Brave's own proxied built-ins
- **Tor bridges configuration** — no bridge list
- **Storage Access API auto-reject** — no handling in the tree
- **Containers** — no container/cookie-jar UI
- **Semantic search history** — no local history index
- **Brave Email Alias** — Brave-owned service, correctly absent
- **Guest mode** — an engine window type this engine does not expose to extensions (`proofs-desktop.md` §6.5)
- **Translate** — the engine's own translation is switched OFF (`browser.translations.enable=false`) and Ziy ships no substitute
- **Wayback Machine integration** — no implementation
- **Anonymous local results** — no local-results path; Brave's IP-not-stored guarantee is its backend's
- **Google fallback mixing** — not reproducible by a clone per the matrix's own note
- **Discussions cluster** — no clustering
- **Goggles custom ranking** — needs the index this clone does not have
- **Sensitive data storage hardening** — Brave's storage-hardening article, no Ziy code
- **Element blocker (hide page elements by click)** — no pick-element UI anywhere in `extensions/ziy-shields`
- **CNAME uncloaking protection** — needs DNS-layer insight not in the tree
- **SugarCoat-style resource replacement** — no script-replacement engine
- **Debouncing and unlinkable bouncing** — no redirect-chain/debounce logic
- **Query parameter filtering** — no query-param stripping
- **De-AMP** — no AMP rewriting
- **Cookie consent / cookie notice blocking** — no consent-banner handling
- **Talk chat retained until call ends** — no chat retention model
- **Talk Video Bridge Encryption (experimental)** — no key-exchange/E2EE path
- **Talk recording** — no recording surface
- **Talk live streaming to YouTube** — no YouTube live-stream surface
- **Talk mute everyone / disable everyone's camera** — no owner-only moderation controls
- **Talk subtitles** — no subtitles surface
- **Talk free 1:1 unlimited plus Premium for 3+** — Brave's pricing deal is not cloneable; the substitute is self-hosted Jitsi
- **Bookmark, cookie and per-site data controls on mobile parity** — no implementation (desktop-only scope per the matrix)
- **Update download and install scheduling control** — no implementation

### 5.2 `partial` — 7 rows, each built but not honestly complete

- ~~**Show count of blocked items** (must) — defect D-7~~ → **CLOSED 2026-10-15:** the static DNR tier is now counted (`proofs-must-gaps.md` §1)
- ~~**List blocked trackers and scripts** (must) — gated behind D-7~~ → **CLOSED 2026-10-15:** with D-7 fixed the list renders real rows, read back live from the running add-on (`proofs-must-gaps.md` §1)
- **Shields Simple view (read-only)** (must) — the read-only section exists; the add-on page renders the state sentence and a count live, but the popup itself is not screenshotted
- **Shields Advanced view** (must) — all rows and fingerprinting sub-toggles exist; no live click-through, and the shell's `granularOverrides` write is designed-not-end-to-end
- **Talk screen sharing** (must) — the chip maps to `toggleShareScreen` with a live bridge and degrades honestly without one; no real share was ever exercised (no reachable Jitsi server; the content script did not inject on this build)
- **Chromium service removals (Safe Browsing proxy, DNS prefetch off, no GAIA)** (could) — the behaviours are real and locked (report URLs emptied, provider pings emptied, DNS prefetch off, captive portal off, telemetry off), but the row is architecture context rather than a discrete built feature
- **Limited first-run and background network calls** (could) — the footprint is measured and locked, but no per-release endpoint audit is published and the row is a design posture more than a feature

---

## 6. Verdict

> **Updated 2026-10-15** — the gap-closing workstream landed four of the five
> items below. The must-row count that follows is the OLD ranking, kept for the
> record; the rows marked **DONE** in this section and struck through in §2/§5
> are the ones it closed. Current state: see `replica/proofs-must-gaps.md`.

- **Not shippable** on the skill's own rule: 8 must-rows are not done, and the
  top gap (per-site shields memory + auto-relax) is explicitly the
  highest-value fix in the review corpus (`fixes.md` §1.4/§2.1, 38 reviews
  across 4 sources).
- **Shippable-shaped on the must-rows that matter**: 80.2% weighted on the
  deliverable must-set, with the core browsing, shields, sync, NTP, news,
  talk and playlist surfaces all proven in a browser. The 48.0% full-set number
  is what a feature-list comparison gives; the 60.4% deliverable number is what
  this project promised.
- **No open S1 bug.** The event-page defect class (D-1..D-4) that killed six
  extensions' backgrounds is fixed and re-verified in a fresh boot
  (`proofs-fix-events.md` §4.2: zero defect signatures in the boot log). The
  one open product-affecting defect is D-7, a MINOR incomplete count, and
  D-5/D-6 remain BLOCKED/MINOR as the test report records them.

**Top five to build next** (weight lost, priority order):

1. **Per-site shields auto-relax prompt** — must, 12.0 of the must-gaps' lost
   weight sits in `user feedback`; the memory half is already proven, so this
   is one prompt plus a degraded-page detector.
2. **The shields count (D-7) plus the popup's live render** — **DONE
   2026-10-15.** The static tier is counted by re-evaluating the shipped
   ruleset (`proofs-must-gaps.md` §1); the item list was read back live over the
   add-on's own bus, so the popup's render is verified by the data it renders.
   This converted 2 partial must-rows to `yes`. A headed screenshot of
   `ui/popup.html` is still the one half of this row not taken.
3. **Crash-safe session restore + durable downloads/password store** — the
   **session-restore half is DONE 2026-10-15** (prefs fixed + a kill-the-renderer
   test that proved a tab survives kill -9 and reboot; 7/7). The durable
   download-store half remains open.
4. **The published resource budget** — **DONE 2026-10-15** (must, and the
   cheapest of the four, exactly as predicted): `replica/resource-budget.md`, all
   figures measured, idle CPU honestly CANNOT ASSESS.
5. **Password manager + autofill** — **DONE 2026-10-15** in exactly the shape
   this line named: a native helper in the shape `native/ziy-sync-agent` proved,
   which also unlocked CSV import. Autofill of page forms is not shipped, and
   why is recorded rather than papered over (`proofs-must-gaps.md` §3).
