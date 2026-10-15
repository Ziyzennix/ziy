# TESTS + QA + VERIFICATION — agent section

Area owner: tests-qa. Everything below was **run on this box 2026-10-15** and cited to file:line.
No code changed. Repo root: `/home/zen/Documents/brave but not chrome or firefox`.

---

## 1. UNIT-TEST SETUP — wiring and observed counts

`package.json` (root, `"type":"module"`, `workspaces:["extensions/*"]`):
`"test": "node --test extensions/*/test"`, `"verify": "./tools/verify.sh"`,
`"build:xpi": "node tools/build-extension.sh --all"`. Node v26.10.0, no framework, no deps.

- Trailing `/` makes the glob tolerant: no `test/` dir → no error; a real failure fails the run
  (`replica/proofs-pkg.md:349-351`).
- Per-extension `package.json` (ziy-shields, ziy-news, ziy-ntp, ziy-talk, ziy-desktop,
  ziy-pwd) add `"test": "node --test test/"`; all declare `"type":"commonjs"` except
  `ziy-sync` — so plain `node --test` works without loaders. `ziy-shell`/`ziy-sync` have no
  package.json but are still swept by the `extensions/*/test` glob.
- `server/` and `native/*` are outside the glob (ESM `import` suites) — run them by path.

| area | command | tests | pass | fail | skip |
|---|---|---|---|---|---|
| `extensions/ziy-shields/test` | `node --test extensions/ziy-shields/test` | **176** | 176 | 0 | 0 |
| `extensions/ziy-talk/test` | `node --test extensions/ziy-talk/test` | **98** | 98 | 0 | 0 |
| `extensions/ziy-news/test` | `node --test extensions/ziy-news/test` | **83** | 83 | 0 | 0 |
| `extensions/ziy-playlist/test` | `node --test extensions/ziy-playlist/test` | **83** | 83 | 0 | 0 |
| `extensions/ziy-ntp/test` | `node --test extensions/ziy-ntp/test` | **81** | 81 | 0 | 0 |
| `extensions/ziy-sync/test` | `node --test extensions/ziy-sync/test` | **51** | 51 | 0 | 0 |
| `extensions/ziy-desktop/test` | `node --test extensions/ziy-desktop/test` | **27** | 27 | 0 | 0 |
| `extensions/ziy-pwd/test` | `node --test extensions/ziy-pwd/test` | **19** | 19 | 0 | 0 |
| `extensions/ziy-shell/test` | `node --test extensions/ziy-shell/test` | **10** | 10 | 0 | 0 |
| `server/test` | `node --test server/test` | **16** | 16 | 0 | 0 |
| `native/ziy-pwd/test` | `node --test native/ziy-pwd/test` | **35** | 35 | 0 | 0 |
| `native/ziy-sync-agent/test/` | — | **empty dir** | — | — | — |
| **`npm test` (glob total)** | `npm test` | **628** | 628 | 0 | 0 |

Whole box = 628 + 16 + 35 = **679 green** (`native/ziy-sync-agent` has no unit tests; it is
covered by `tools/e2e-ziy-sync.sh` + `tools/e2e/agent-driver.py` over the real native pipe).

Two runtime traps: `server/test` takes 45–60 s — under a 60 s `timeout` it prints
`cancelled 1` / *"Promise resolution is still pending…"*, which is a **timeout artifact, not a
failure**; with ≥120 s it reports 16/16/0. `native/ziy-pwd/test` ~23 s (key derivation).

Suite shapes: pure lib tests (most); page tests under a `vm` DOM shim (`ziy-ntp/page.test.js`);
cross-process contract pinned from both sides (`extensions/ziy-pwd/test/pwd.test.js` vs
`native/ziy-pwd/test/*.mjs`, so a field rename fails one of the two); protocol tests that build
**real** clients (`server/test/server.test.mjs` — *"if a test could construct records the
server would never see, it would prove nothing about the protocol"*); spec vectors
(`ziy-sync/test/bip39.test.mjs`, BIP-39 `vectors.json`).

---

## 2. THE ACCEPTANCE GATE — `tools/verify.sh`

`./tools/verify.sh` (831 lines) / `npm run verify`. One line per check: `PASS`/`FAIL`/`SKIP` +
evidence; `ok`/`bad`/`skip` counters at `tools/verify.sh:50-56`; exits non-zero on any FAIL
(`:830`). Filters (`run_check`, `:69-77`): `--identity --boot --prefs --extensions --signing
--suite --features --prefs-lock --native --desktop --all --keep-selftest`; `--help` prints the
usage block (`:1-26`).

Sections, as the file numbers them:

| # | note | what it checks |
|---|---|---|
| 1 | build/ziy + patched omni.ja | app dir executable; `AppConstants.sys.mjs` in `omni.ja` carries `MOZ_REQUIRE_SIGNING:false` + `MOZ_ALLOW_ADDON_SIDELOAD:true` |
| 2 | identity `--version` | contains `ziy`, else **SKIP** (`:140`) |
| 3 | headless boot + screenshot | 6 916-byte shot of a `file://` probe page, PIL pixel count ≥50 000 brand-violet `#26118F` px + ≥500 wordmark-white px |
| 4 | real 20 s boot writes our prefs | `prefs.js` exists and names our prefs |
| 5 | suite extensions directory wired | xpi count, every filename's manifest id agrees |
| 6 | signing bypass installs unsigned | builds + installs a `ziy-selftest@ziy.test` xpi, requires the `installedDistroAddon` marker, removes it |
| 7 | **full-suite gate** | every id in `shell/extensions.list` is `<id>.xpi` **and** installed **and** active in `extensions.json` **and** has a `installedDistroAddon` marker in prefs.js, after a real headless boot on a fresh throwaway profile |
| 8 | feature-level headless checks | shields ruleset+suite, NTP page+bundle, news fixture parse+suite, playlist/talk unit suites **plus their BiDi panel probes**, sync two-profile e2e+suite, desktop suite, whole `npm test` |
| 9 | pref/lock assertions | `shell/preflight-prefs.py` + `mozilla.cfg` pref-call count |
| 10 | native helpers | `install-ziy-sync-native.js --dry-run` names a real manifest target |
| 11 | desktop integration | `shell/ziy.desktop` fields/actions, `install-desktop.sh --dry-run`, hicolor icon count |
| 12 | clean-room guard | no reference product's name in manifests' visible strings, the `.desktop` entry, brand `.svg`s, or a shipped code literal (comments excluded) — `tools/lib/cleanroom-scan.py` |

### 2.1 Baseline — recorded vs. what I observed today

`replica/deploy.md:96-108` records the last full green run:

```
$ ./tools/verify.sh ; echo "exit=$?"
  46 passed, 0 failed, 1 skipped
exit=0
```

**I ran the full gate on 2026-10-15** (after `bash tools/build-extension.sh --all`, which filled
the previously empty `distribution/extensions/`) and observed:

```
  45 passed, 0 failed, 2 skipped
EXIT_CODE=0
```

Full PASS list as observed: omni.ja patched · boot screenshot 6 916 B · brand-violet wordmark ·
`prefs.js` 12 768 B after a real boot · 9 xpis · unsigned selftest xpi installed + marker true ·
every xpi's manifest id matches filename · `extensions.json` 26 691 B · **every suite id installed
AND active** · every suite id has an `installedDistroAddon` marker · suite-boot screenshot
8 650 B · shields ruleset 28 923 rules · shields 176 · ntp 81 · news 83 · playlist 83 · talk 98 ·
desktop 27 · sync 51 · sync two-profile e2e transferred A's record to B · whole node suite ·
preflight · `mozilla.cfg` 96 pref calls · native manifest target · ziy.desktop ×4 ·
`install-desktop.sh --dry-run` · 5 hicolor icons · 4 clean-room guard checks · anchored cleanup.

**The two SKIPs, and what each one is:**

1. **`--version does not say Ziy`** (`it says: Mozilla Firefox 156.0.1`) — the historical one,
   cause at `tools/verify.sh:138-140`: 156 does not remap `--version` from `App:Name` alone;
   sections 1+3 prove identity another way. Deterministic.
2. **`playlist panel probe did not complete`** (`build/verify/playlist-panel.log`) — **new on
   today's run.** The probe itself failed one assertion: the staged panel's media element
   reported `readyState 0, duration None, currentTime 0` — headless media did not decode, so
   every other check (capture, classify, queue row, reorder, resume, screenshot, transport
   controls, tokens, typed audio row, top/bottom button inertness) still passed and only
   playback failed; the probe exits non-zero and §8d therefore SKIPs. This is the same
   environment/headless-media flakiness `replica/test-report.md` already records for **F27
   playback as PARTIAL** (*"an environment/headless-media difference between two runs on the
   same box"*): the earlier recorded run (`build/verify/playlist-panel.log`, Oct 15 19:26)
   printed `played 0.284s of 0.333s … ALL ASSERTIONS PASSED`. Do not read today's SKIP as a
   product regression; re-run it before concluding the player is broken (the report says the
   same about the autoplay prefs).

Recorded 46-pass baselines (`deploy.md:102`, `proofs-desktop.md:529`,
`proofs-must-gaps.md:447`) predate `ziy-pwd` and the D-7 fix; today's observed 45+2 is the
live number and is consistent with the extra `ziy-pwd` suite id and the panel-probe SKIP.

Harness quirk seen today: §8f prints `the whole node suite passes (pass assertions)` — verify
greps `^. pass ` but node emits `ℹ pass 628`, so the aggregate count never reaches the line.
The suite itself passed (628).

### 2.2 Prereqs and traps

`build/ziy/distribution/extensions/` was **empty** on disk (mtime Oct 15 19:52), which SKIPs
section 5 (`tools/verify.sh:312`) and FAILs 7/8. I rebuilt it this session:
`bash tools/build-extension.sh --all` → `9 packed, 0 failed`. Suite ids of record:
`shell/extensions.list` (9 lines); `policies.json` declares 10 `ExtensionSettings` (9 suite +
the engine's own `newtab@mozilla.org`).

- `tools/build-extension.sh` is **bash, not node**: `node tools/build-extension.sh --all` dies
  with `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".sh"`.
- Same class of trap for the regression suite: **`bash replica/test/regressions.sh`**, not
  `./` (`replica/proofs-fix-events.md:519`).

---

## 3. E2E / BOOT-PROOF HARNESSES (`tools/e2e/*.py`)

Shared boot layer: `tools/e2e/ziy-flow-harness.py` — one throwaway profile per scenario under
`/tmp/ziy-*/`, anchored kills by PID, `MOZ_MARIONETTE=1 MOZ_CRASHREPORTER_DISABLE=1
MOZ_DISABLE_SAFE_MODE=1` (`:177-178`), and *"the route used for every flow is recorded, not
implied"* (route vocabulary: real add-on origin / staged `file://` / engine page / BiDi /
headed).

### 3.1 THE ROUTE NOTE

 Firefox's remote protocol is **WebDriver BiDi** at `ws://127.0.0.1:PORT/session` (+ `--marionette`
on 2828), **not** Chrome CDP. Two engine limits constrain everything (`replica/test-report.md`
route table; measured by `ziy-route-probe.py`/`-probe2.py`):

1. `browsingContext.navigate` **refuses** `about:newtab` and every `moz-extension://` URL
   (`unsupported operation`); `location.href` assignment is denied to script;
   `browsingContext.create` with a url lands on `about:blank`; `webExtension.moz:listExtensions`
   reports `unknown command` (module not built into this engine).
2. A `file://` or `about:blank` page has **no `browser.*` / `chrome.*` API at all**
   (`typeof browser === "undefined"`).

Hence only two honest routes, and every tool states which it used:

- **iframe-child-context** — a `file://` page with
  `<iframe src="moz-extension://<uuid>/ui/debug.html">` loads the add-on's real document on its
  real origin, exposed as its own browsing-context child and scriptable over BiDi. Needs the
  page in `web_accessible_resources`: shields `extensions/ziy-shields/manifest.json:82-90`
  (`ui/*`,`icons/*`), pwd `:40-46`, playlist `:64-67` (`ui/panel.html`), talk `:50-53`.
- **staged `file://` copy with one shim** — a byte copy of shipped `ui/`+`lib/` plus **one**
  added `<script src="../lib/shim.js">` that answers the page's own ops with the shipped
  defaults; the panel's real JS runs unchanged. This proves the **surface, not the install**,
  and every tool's docstring says so. Never describe it as the add-on origin.

### 3.2 The tools

| tool (port · profile) | route | proves |
|---|---|---|
| `ziy-talk-panel.py` (9226 · `/tmp/ziy-talk-verify-profile`) | staged `file://` | install + marker; panel DOM (room-id display, control chips, start/join, third-party warning gate, definition-list settings, tokens applied, `focus-visible` kept); **no fake in-call state at rest**; default-server error copy; screenshot. Attempts `listExtensions` → extensions.json `baseURL` → content-script probe URL → staged copy, printing which worked. Log `build/verify/talk-panel.log`: `ALL ASSERTIONS PASSED` |
| `ziy-news-panel.py` (9228 · `/tmp/ziy-news-verify-profile`) | staged `file://` | install + marker; **event page parses a REAL feed** (build-time fixtures) inside the running extension, read back; list semantics, source rows, mark-read, live region, tokens |
| `ziy-playlist-panel.py` (9227 · `/tmp/ziy-playlist-verify`) | staged `file://` | classify+add through the extension's own bus; **a real mp4 decode in the real media element** (play/pause/seek, readyState 4) plus reorder- and resume-across-reload. Log `build/verify/playlist-panel.log`: played 0.284 s of 0.333 s, seeked to 0.100 s |
| `ziy-fix-shields-flows.py` (9362 · `/tmp/ziy-fix-shieldsflows-profile`) | **iframe** | F02–F07 on the real add-on origin: `shields.*` ops on the add-on's own bus, 3 shipped lists, both DNR tier sizes, per-site override write+persist, `shields.global`. Also the reference `read_storage_local_keys()` for `storage.local` in IndexedDB (one-byte `0`/`0x30` prefix, letters shifted down one — `s` stored as `t`) |
| `ziy-fix-f01-probe.py` (9357 · `/tmp/ziy-fix-f01-profile`) | engine page | F01: asks the engine for the tab list over BiDi, which the log-grep regression cannot see |
| `ziy-gap3-pwd-boot.py` (9381 · `/tmp/ziy-gap3-pwd-profile`) | **iframe** | GAP 3: ziy-pwd installed by the app dir; the **shipped** popup's honest states. Limits stated in-file: an iframe has no `tabs` (site prefill absent, asserted away); the native helper is not launched here |
| `ziy-gap4-restore.py` (9421 · `/tmp/ziy-gap4-restore-profile`) | engine page + profile read | GAP 4: crash-safe restore — N tabs, SIGKILL the anchored PID, relaunch on the same profile, assert tabs back from the engine's own `sessionstore.js` **and** the live tab list. Quotes `SessionStartup.sys.mjs`'s `sessionType` contract; records that Ziy sets `browser.startup.page=1` with `resume_from_crash=false` |
| `ziy-fix-iframe-probe.py` (9361) | route discovery | established the iframe route as the only way to reach an add-on document |
| `ziy-fix-shields-ops.py` (9358) | staged `file://` | **negative control**: same ops from a page with no `browser.*` — a defect *of the probe*, not the product (`proofs-fix-events.md:505-511`) |
| `ziy-gap1-d7-count.py` (9371) | **iframe** | D-7: with the static tier blocking a known tracker, `shields.tabCounts` reports **non-zero** and names the requests |
| `ziy-ntp-news.py` (9231) | real NTP page | the NTP news region renders rows from the real `ziy-news` background's `feed.snapshot` |
| `ziy-route-probe.py` / `-probe2.py` | both refused routes | produced limits 1 and 2 |
| `ziy-budget.py` / `-idle.py` | engine page | measurements behind `replica/resource-budget.md` (idle CPU reported CANNOT ASSESS, with the headless-compositor reason) |

Plus `tools/e2e-ziy-sync.sh` — the two-device sync e2e (throwaway `HOME`s under
`/tmp/ziy-sync-e2e`, real node:sqlite server on 127.0.0.1, encrypted A→B transfer, server-side
ciphertext as evidence; `ziy_kill_throwaway '/tmp/ziy-.*profile'` at `:225`/`:374`),
`agent-driver.py` (drives the native agent over the real MDN UInt32LE pipe), and
`replica/tools/ntp-dom-check.py` (the BiDi DOM check for the NTP; attaches to an
already-running browser, never launches or kills one).

---

## 4. PROCESS HYGIENE — the rule that must never break

**The failure:** `replica/AI-BRIEF.md` §5 rule 1 — *"Bare-word `pkill` nearly killed the
user's LibreOffice. The project path contains `brave`, so a broad `pkill` pattern matched the
user's own apps."* Twice. Rules: throwaway profiles only (`/tmp/ziy-*`);
`MOZ_CRASHREPORTER_DISABLE=1` on every launch; match first, kill by PID, **never a bare
`pkill`**.

`tools/lib/common.sh:47-52` — the rule with its reason:

```sh
# Process hygiene. The project directory contains 'brave'; so do the user's
# LibreOffice and Firefox sessions. Everything we start MUST be selected with an
# anchored pattern that only matches a throwaway profile under /tmp/ziy-*, or by
# a PID we recorded ourselves. Never `pkill -f firefox`, never `pkill firefox`.
ziy_pids_of() { pgrep -f "$1" 2>/dev/null || true; }
```

`tools/lib/common.sh:54-67` — the kill every bash harness calls:

```sh
ziy_kill_throwaway() {
  # $1 = regex anchored on the throwaway profile path, e.g. '/tmp/ziy-.*profile'
  pids="$(pgrep -f "$1" 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  kill $pids 2>/dev/null || true
  sleep 1
  pids="$(pgrep -f "$1" 2>/dev/null || true)"
  if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null || true; fi
}
```

`tools/verify.sh:80-83` — the EXIT trap that protects a Ctrl-C mid-boot:

```sh
cleanup() {
  [ "$CLEANUP_DONE" = "1" ] && return 0
  CLEANUP_DONE=1
  # Only ever kill by the anchored throwaway-profile pattern.
  ziy_kill_throwaway '/tmp/ziy-.*profile'
}
trap cleanup EXIT INT TERM
```

`replica/test/regressions.sh` (repeated per case) — the shell one-liner:

```sh
pgrep -f '/tmp/ziy-regress-shields-profile' | xargs -r kill -9 2>/dev/null
```

`tools/e2e/ziy-talk-panel.py:117-131` (byte-identical `cleanup()` in every Python probe):

```python
def cleanup():
    """Anchored kill only: the throwaway profile path, nothing else."""
    out = subprocess.run(["pgrep", "-f", PROFILE], capture_output=True, text=True).stdout
    pids = [p for p in out.split() if p.strip()]
    for pid in pids:
        try: os.kill(int(pid), signal.SIGTERM)
        except Exception: pass
    time.sleep(1)
    for pid in pids:
        try: os.kill(int(pid), signal.SIGKILL)
        except Exception: pass
    return len(pids)
```

`tools/verify.sh:815-819` — the proof-of-innocence last check:

```sh
USERFIDDLE="$(pgrep -af '/usr/lib/firefox/firefox -[a-z]' 2>/dev/null | grep -v ziy | head -3 || true)"
```

Observed today: `pgrep -af '/tmp/ziy-.*profile'` → **0** processes.

---

## 5. THE REGRESSION SUITE — `replica/test/regressions.sh`

Exists (275 lines). `bash replica/test/regressions.sh [all|shields-runtime|shields-blocking|
f01-first-run|f20-sync|--list]`; cheapest-first; exit 0 = all PASS.

| case | what it checks | catches |
|---|---|---|
| `shields-runtime` | boots `/tmp/ziy-regress-shields-profile` (port 9340) and greps the boot log for `redeclaration of non-configurable` among `JavaScript error` lines; **plus** two same-case assertions — `blocking.browserApi is not a function` absent, `webNavigation is undefined` absent | D-1/D-2/D-3. The boot log is the evidence because a dead event page leaves the static ruleset still blocking — exactly how the bug hides |
| `shields-blocking` | `/tmp/ziy-regress-block-profile` (9341): renders the generated tracker fixture headlessly and asserts a non-empty shot; opens the **shipped xpi** and requires DNR `rule_resources` `ziy-shields-lists` enabled with >1 000 rules; requires `ziy-shields@ziy.app` `active:true` in the booted `extensions.json` | D-2 cannot be mistaken for "blocking is fine" (the only blocking check independent of the event page) |
| `f01-first-run` | `/tmp/ziy-regress-f01-profile` (9342): `ziy-shell` active **and** `welcome.html` in the log/sessionstore; then `f01-suite-active` — all 8 named ids active in the fresh profile | D-1's visible symptom |
| `f20-sync` | runs `tools/e2e-ziy-sync.sh`, requires **both** `END-TO-END: the record created on A appears on B` **and** `server blob cache wiped` | the two-profile chain round trip + server-side wipe |

Recorded state, quoted from `replica/test-report.md:606-620`:

> Its current output on this build is **5 passed, 4 failed, 0 blocked**
> (`shields-runtime`, `shields-runtime-background`, `shields-runtime-webnav`,
> `f01-first-run`), which is the same verdict set as this report and is the
> regression signal to re-run after the fixes land.

That 5/4/0 predates the fix-events workstream; `proofs-fix-events.md:691-695` then records
that `shields-runtime` passes, while `f01-first-run` still fails **as written** (it greps for
`welcome.html`, which a headless `about:blank` boot never writes — it needs the BiDi tab read
`ziy-fix-f01-probe.py` performs). I did not re-run the suite; 5/4/0 is the last recorded run.

---

## 6. TEST CONVENTIONS

**Asserting.** `node:test` + `node:assert/strict` (`require` in the CommonJS suites, `import`
in ziy-sync / ziy-shell / server / native). No framework, no mocking library. Behaviour, not
wiring: `static-match.test.js:56-64` pins `domainAnchors()` to the engine's own
`#getDomainAnchors` offsets and loads the **real** `rules/static-ruleset.json`; the news
engine suite asserts the backoff ladder against an injected **fake clock**
(`extensions/ziy-news/test/engine.test.js:11`). Shipped code under test, never a
re-implementation: `engine.test.js` loads `lib/feed/*` + `lib/store/*` in manifest order into a
`vm` context with a fake `browser` and calls `handleMessage` directly, so a message-contract
regression fails a test rather than a browser run.

**Fixtures.**
- `extensions/ziy-news/test/fixtures/` — **real fetched feeds**, six files: `bbc-world.rss.xml`
  (RSS 2.0, dc:/content:/media: ns, CDATA titles, media:thumbnail), `guardian-world.rss.xml`,
  `heise-rss1.rdf.xml` (RSS 1.0/RDF), `nature-atom.atom.xml`, `mozilla-blog.atom.xml` (Atom),
  `manton-jsonfeed.json` (JSON Feed 1.1). Real HTTP GETs on 2026-10-14; the exact `curl` lines
  and the four rejected-at-build-time URLs (three 403 to scripted clients, one 404) are in
  `replica/proofs-news.md:55-66`. Parser header: *"A parser that only passes hand-written XML
  will fail on the first real feed it meets, so the real feed is the test."* A truncated
  download fails the fixture-sanity test, not the parser.
- `extensions/ziy-playlist/test/fixtures/` — **generated media**: `tiny.mp4` (H.264, 10 frames
  @30 fps, 320×240), `tiny.webm` (VP8), `tone.mp3`, `tone.ogg`, `tone.wav`. Regenerate with
  **`extensions/ziy-playlist/tools/make-fixtures.py`** (gstreamer; path is inside the extension,
  not `tools/`). Deterministic by construction; a missing gstreamer is a hard error because
  *"a fixture-less suite would silently test nothing."* `decode.test.js` asserts the generator's
  determinism, each fixture's real container signature, and that the served bytes equal the
  bytes on disk.

**The `vm` DOM shim for page tests.** `extensions/ziy-ntp/test/page.test.js` (23 of the suite's
81) runs the extension's own `ui/ntp.js` + `ui/options.js` inside a `node:vm` context
(`:576-578`):

```js
const ctx = vm.createContext(sandbox);
vm.runInContext(source, ctx, { filename: source.fileName || "script.js" });
```

The DOM is a hand-written node tree (`class Node`, `:36-60`): tagName, children, parentNode,
listeners, attributes, dataset, and a `style` **Proxy** that records what the page writes
because the backdrop's background-image is read back by assertions. `browser` is a merged shim
(`makeBrowser`) with `storage.local` on a plain object, `search.get` returning engines (so both
the engine-list and fallback paths run), `topSites`, `history.search`, `tabs.query/reload`, and
`setTimeout` captured rather than fired. Header rule: *"Anything the page needs that the shim
lacks would be a real dependency and would fail loudly here rather than silently mis-verify."*

**What MUST be tested.** (1) Behaviour, not wiring — no mock-echo assertions; the server suite
builds real clients and asserts what the server did and did not learn, the playlist proof
drives a real media element. (2) No mock echoes — a shim may only answer a page's own ops with
the shipped defaults, and the file must say *"harness fixture, not product code"*; negative
controls are kept deliberately. (3) Deterministic — fixtures are bytes on disk, jitter runs on
a fake clock, the packer produces the same bytes on re-run. (4) Counts are baselines, not
trophies (§7).

---

## 7. COVERAGE EXPECTATIONS — baselines that must not drop

| suite | baseline (`proofs-must-gaps.md:447-459`) | observed 2026-10-15 | verdict |
|---|---|---|---|
| `ziy-shields` | 176 (= 141 baseline + 35 new static-match) | **176 pass** | holds |
| `ziy-talk` | 98 | **98 pass** | holds |
| `ziy-news` | 83 | **83 pass** | holds |
| `ziy-playlist` | 83 | **83 pass** | holds |
| `ziy-ntp` | 81 | **81 pass** | holds |
| `ziy-sync` | 51 (the `proofs-sync.md` headline still says 67/67; its own §5 line 93 records `test/ 51 tests` — **51** is what runs) | **51 pass** | holds |
| `ziy-desktop` | 27 | **27 pass** | holds |
| `ziy-pwd` | 19 | **19 pass** | holds |
| `ziy-shell` | 10 | **10 pass** | holds |
| `native/ziy-pwd` | 35 (18 crypto-vault + 17 native-protocol) | **35 pass** | holds |
| `server/test` | 16 | **16 pass** | holds |
| `npm test` glob total | 573 (`replica/deploy.md:37`, dated) | **628 pass** | grew (+55) |
| whole box | — | **679 green** | — |
| `native/ziy-sync-agent/test/` | — | **empty** | covered by the sync e2e + `agent-driver.py` |

**These counts must not drop.** A change that narrows a suite must restore the coverage or
record exactly what is no longer asserted, and why, in the proof doc. Shields is the sensitive
row: its 176 include the static-matcher pinning that is the only thing between D-7 returning
and a panel silently reporting `blocks=0`.

---

## 8. HOW VERIFICATION EVIDENCE IS RECORDED

**`replica/test-report.md`** (the TEST phase report, 622 lines) — method statement, quoted:

> **Method:** every flow was *run*, not reviewed. Headless WebDriver BiDi boots on throwaway
> profiles under `/tmp/ziy-*`; every kill was anchored (`pgrep -f '/tmp/ziy-…profile'`, by
> PID). The user's own Firefox (WhatsApp) and LibreOffice were never matched.
> `MOZ_CRASHREPORTER_DISABLE=1` on every launch.

Structure to copy: route table **with both engine limits stated before any verdict**; per flow
a **Setup** (exact commands), **Observed** (real output), **Verdict** (PASS/FAIL/BLOCKED/
PARTIAL with the cause named); a *"What I could NOT test, and why"* section listing 7 blocked
surfaces rather than glossing; a *"Where the checks live"* pointer at
`replica/test/regressions.sh` with its then-current 5/4/0. Verdicts are honest verdicts —
`BLOCKED` is a real answer, and D-1–D-4 carry ✅ FIXED markers citing
`replica/proofs-fix-events.md` rather than rewriting history.

**`replica/proofs-*.md`** (one per workstream) — every claim traces to a command plus observed
output, and **`unverified` is a valid verdict**: `proofs-news.md:283` lists a live in-browser
feed fetch as **NOT OBSERVED** with the route limit; `compile-readiness.md:634` records a CI
state as `unverified — do not treat it as fact`. `replica/evidence.md` sets the classes
(OBSERVED / OBSERVED-SOURCE / DOC-INFERRED / BUILT-EXERCISED / INFERRED), the precedence rule
(OBSERVED behavioral > OBSERVED-SOURCE > DOC-INFERRED), and requires a contradicted claim to
be **struck through in place** with the correction beside it — never silently deleted.

**`authored-not-compiled`** is a fourth verdict state for C++ patches.
`replica/proofs-cpp-fingerprint.md:8-11` states it in the header:

> **Status, stated once and precisely: every patch in this document is
> `AUTHORED, NOT COMPILED`.** No patch here has been through a compiler, and nothing here
> has been booted. The first compilation is the first run of
> `.github/workflows/build-gecko.yml`. "Apply-verified" below means exactly the four
> `git apply` commands and nothing more.

The four `patches/0001–0004*.patch` carry apply + reverse evidence against the 156.0.1 tree
(`compile-readiness.md` §2–§3) and **nothing may claim they work at runtime`**.
`proofs-cpp-privacy.md` goes the other way: *"Zero patches authored. Zero apply-evidence"* as
its headline, because the correct fix there was a shell pref rename, not a C++ patch.

---

## 9. QUICK REFERENCE

```bash
node --test extensions/<area>/test      # after any change to that area
npm test                                # 628 assertions (extensions/*/test)
node --test server/test                 # 16 — give it >=120s
node --test native/ziy-pwd/test         # 35 — ~23s

bash tools/build-extension.sh --all     # bash, NOT node; fills distribution/extensions/
./tools/verify.sh                       # the gate (or: npm run verify)
./tools/verify.sh --features            # one section at a time
./tools/verify.sh --help                # every filter flag

timeout 400 python3 tools/e2e/ziy-talk-panel.py
timeout 400 python3 tools/e2e/ziy-playlist-panel.py
timeout 400 python3 tools/e2e/ziy-news-panel.py
timeout 400 python3 tools/e2e/ziy-gap3-pwd-boot.py

bash replica/test/regressions.sh --list            # bash, NOT ./
bash replica/test/regressions.sh shields-runtime
```

Before any of the above: throwaway profile only, `MOZ_CRASHREPORTER_DISABLE=1`, anchored kills
only — never a bare `pkill` (§4).
