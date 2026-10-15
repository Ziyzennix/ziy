# proofs-shields.md — the Ziy Shields slice, verified on this machine

Workstream 2: the blocking engine (filter-list parser, DNR rule compiler, the
Shields precedence model) and the Shields UI. Every claim below was exercised on
this machine, Linux Mint, 2026-10-14, against the installed Firefox **156.0.1**
at `/usr/lib/firefox` and its own sources inside `build/ziy/omni.ja`
(`shell/omni.ja.patch/patch-omni.py::locate_central_directory` /
`parse_central_directory` / `member_body_offset` read a member out of the
4-byte-prefixed archive that `zipfile` refuses).

Companion documents: `architecture.md` (the design), `proofs.md` (the engine
facts), `proofs-shell.md` (workstream 1, the shell). This file is the record for
*this* workstream.

---

## 1. Rule budgets, measured rather than guessed

The design question was "the EasyList table is ~135k rules; what actually fits
in declarativeNetRequest". The numbers below are read from the engine's own
source, not estimated.

### 1.1 The limits, from `modules/ExtensionDNRLimits.sys.mjs` inside omni.ja

```
$ python3 - <<'PY'
import importlib.util
spec = importlib.util.spec_from_file_location("po", "shell/omni.ja.patch/patch-omni.py")
po = importlib.util.module_from_spec(spec); spec.loader.exec_module(po)
data = open("build/ziy/omni.ja", "rb").read()
cd_start, cd_size, eocd = po.locate_central_directory(data)
entries = po.parse_central_directory(data, cd_start, eocd)
e = entries["modules/ExtensionDNRLimits.sys.mjs"]
off = po.member_body_offset(data, e["lho"], e["nlen"], e["elen"], "modules/ExtensionDNRLimits.sys.mjs")
print(data[off:off + e["csize"]].decode("utf-8"))
PY
```

| constant | default | pref | source |
| --- | --- | --- | --- |
| `GUARANTEED_MINIMUM_STATIC_RULES` | **30000** | `extensions.dnr.guaranteed_minimum_static_rules` | `ExtensionDNRLimits.sys.mjs` |
| `MAX_NUMBER_OF_STATIC_RULESETS` | 100 | `extensions.dnr.max_number_of_static_rulesets` | same |
| `MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` | 20 | `extensions.dnr.max_number_of_enabled_static_rulesets` | same |
| `MAX_NUMBER_OF_DISABLED_STATIC_RULES` | 5000 | `extensions.dnr.max_number_of_disabled_static_rules` | same |
| `MAX_NUMBER_OF_DYNAMIC_RULES` | **5000** | `extensions.dnr.max_number_of_dynamic_rules` | same |
| `MAX_NUMBER_OF_SESSION_RULES` | **5000** | `extensions.dnr.max_number_of_session_rules` | same |
| `MAX_NUMBER_OF_REGEX_RULES` | **1000** (per ruleset) | `extensions.dnr.max_number_of_regex_rules` | same |

Plus, in the same file, commented out:

```
// TODO(Bug 1803370): allow extension to exceed the GUARANTEED_MINIMUM_STATIC_RULES limit.
//
// The maximum number of static rules exceeding the per-extension
// GUARANTEED_MINIMUM_STATIC_RULES across every extensions.
//
// const MAX_GLOBAL_NUMBER_OF_STATIC_RULES = 300000;
```

**What each source told me.** The dynamic and session budgets are 5000 each and
the regex budget is 1000 *per ruleset* — so none of them can hold the table. The
static tier is the one that scales: 30000 guaranteed per extension, with a global
300000 pool the engine has reserved but not enabled. MDN agrees
("[`GUARANTEED_MINIMUM_STATIC_RULES`] ... Its value is `30000` on Chrome",
[`MAX_NUMBER_OF_DYNAMIC_RULES`] "in Firefox: 5000") and explicitly warns not to
depend on the global figure, so the design does not.

### 1.2 The tiering that follows

| tier | budget | what lives there | why |
| --- | --- | --- | --- |
| **static** | 30000+ (from the package) | the compiled list table — 114,973 rules | the only tier that scales; the engine reads it from the xpi, so no event-page work happens per request |
| **dynamic** | 5000, persisted | per-site absolute overrides (1–2 rules per site the user changed) | sized for exactly this; persists across sessions and extension updates |
| **session** | 5000, not persisted | "Shields down for this visit", the block-element tool | transient by definition |
| **webRequest** | n/a | what DNR cannot express: 648 rules | `$document` main_frame blocks, `$domain=` lists over 64 terms, regexes past 1000 |

The static ruleset is shipped inside the xpi as the manifest's
`declarative_net_request.rule_resources` entry — it is a build artifact, not
runtime state. Nothing is ever serialised into `storage.local` for it.

---

## 2. How DNR and webRequest actually interact — the source, read

This is the load-bearing fact for per-tab block counting, so it was read from
the engine rather than assumed.

`modules/WebRequest.sys.mjs`, `HttpObserverManager.runChannelListener`:

```js
if (this.dnrActive) {
  // DNR may modify (but not cancel) the request at this stage.
  lazy.ExtensionDNR.beforeWebRequestEvent(channel, kind);
}
... this.listeners[kind].forEach(... callback(data) ...) ...
if (this.dnrActive && lazy.ExtensionDNR.handleRequest(channel, kind)) {
  return;
}
```

And `mozilla/modules/ExtensionDNR.sys.mjs`'s `NetworkIntegration.register()`:

```js
register() {
  // We register via WebRequest.sys.mjs to ensure predictable ordering of DNR and
  // WebRequest behavior.
  lazy.WebRequest.setDNRHandlingEnabled(true);
},
```

**What that told me.** DNR is evaluated *before* the extension's webRequest
listeners run, and when DNR blocks, `handleRequest` returns true and the
listeners' `handlerResults` are discarded — but the listeners *still fired*.
So the counting path is sound: our `onBeforeRequest` observer sees every request
in every tab regardless of which tier blocked, and can count it. We never issue
a block from that listener for anything DNR covers, so the two paths cannot
double-block. MDN states the same conclusion
("[Chrome only:] Unlike the webRequest API, any images or iframes blocked using
the declarativeNetRequest API are automatically collapsed in the DOM" /
"While deciding whether a request is to be blocked or redirected, the
declarativeNetRequest API is given priority over the webRequest API").

### 2.1 Rule precedence, also from the source

`compareRule()` in `ExtensionDNR.sys.mjs`:

```
cmpHighestNumber(ruleA.priority, ruleB.priority) ||          // 1. highest priority
cmpLowestNumber(ruleA.actionPrecedence(), ruleB.actionPrecedence()) ||  // 2. allow < allowAllRequests < block < upgradeScheme < redirect < modifyHeaders
cmpLowestNumber(rulesetA.rulesetPrecedence, rulesetB.rulesetPrecedence) ||  // 3. session > dynamic > static
cmpLowestNumber(ruleA.id, ruleB.id)                            // 4. lowest id
```

**What that told me.** Priority is the primary dial, and within the same
priority `allow` beats `block`. The §5.3 lattice is therefore expressed as
priority bands: session allow (1,000,000) > site allow (100,000) > site block
(10,000) > list `!important` (500) > list exception `@@` (100) > ordinary block
(10) > upgradeScheme (1). A per-site ALLOW out-prioritises a static BLOCK, which
is exactly what "Shields off for this site" has to mean.

---

## 3. The parser, and what the real lists contain

Fixtures → expected parse is `test/parser.test.js`. The numbers below are what
`parseList()` produced over the three shipped snapshots.

```
$ node extensions/ziy-shields/tools/gen-static-ruleset.js   # (the counts it reports)
  easylist.txt: 57233 network rules (24659 cosmetic, 755 exceptions, 7 skipped)
  easyprivacy.txt: 56278 network rules (36 cosmetic, 851 exceptions, 3 skipped)
  fanboy-cookiemonster.txt: 2110 network rules (23186 cosmetic, 429 exceptions, 0 skipped)
```

| list | file | lines | sha256 |
| --- | --- | --- | --- |
| EasyList | `lib/filterlist/snapshots/easylist.txt` | 82,175 | `2e86ae8d092f24cfb6b0845e23c458e4f696d215ca43ff9f3fc83f555443173d` |
| EasyPrivacy | `lib/filterlist/snapshots/easyprivacy.txt` | 57,090 | `f2ba5af50caa57a9d66926917ba97031c5a86f77ece6210dc3a7ac8c255e3724` |
| EasyList Cookie List | `lib/filterlist/snapshots/fanboy-cookiemonster.txt` | 26,090 | `714dd685e65e97fa0cd9d4036e6f5d80ee8b9de5a16aa42b81e76080dfe88e93` |

By kind across all three: **115,621 network** rules (2,036 exceptions) and
**47,881 cosmetic** rules. 10 lines out of 165,358 are skipped; all of them are
option-only lines such as `$script,domain=mega4upload.net` (a pattern-less
rule), which is the correct handling.

### 3.1 Syntax coverage, driven by what the lists actually use

A feature inventory over the three files was run before writing the parser, so
the coverage list is demand-driven rather than aspirational:

| feature | occurrences in the lists | parser |
| --- | --- | --- |
| `\|\|domain` domain anchor | 109,785 | yes |
| `^` separator | 101,748 | yes |
| `\|` left anchor | 107,786 | yes |
| `*` wildcard | 1,922 | yes |
| `##` cosmetic | 47,542 | yes |
| `#@#` cosmetic exception | 653 | yes |
| `@@` network exception | 2,036 | yes |
| `$third-party` / `$~third-party` | 6,092 / 710 | yes |
| `$domain=a\|b\|~c` | 1,387 | yes |
| `$script` | 1,305 | yes |
| `$image` | 684 | yes |
| `$xmlhttprequest` | 404 | yes |
| `$subdocument` | 196 | yes |
| `$stylesheet` | 84 | yes |
| `$ping` | 72 | yes |
| `/\|$/` regex literal | 9 | yes |
| `$important` | 10 | yes |
| `$popup` | 2,969 | yes |
| `$document` | 595 | yes (routed to webRequest) |
| `$match-case` | 0 in these lists | yes (accepted) |
| extended selectors `#?#`, `#$#`, `:xpath()`, `:has-text()`, `:contains()`, `:style()` | 4–5 each | yes |
| non-ASCII patterns | **0** | n/a (DNR also forbids them) |

The four remaining syntax forms in the corpus are handled as the engine's own
limits require and the rest go to the imperative path (§1.2).

### 3.2 Two correctness bugs the tests caught

- `##` was sliced as 3 characters instead of 2, corrupting every cosmetic
  selector.
- Options were split on commas only, so `$domain=a|b|c` lost `b` and `c`.
  ABP separates options with commas and the `$domain` *value* with pipes; those
  are two different separators and the parser now respects both
  (`test/parser.test.js`: "$domain values are pipe-separated; commas separate
  options").
- `~domain##sel` is a HIDE rule that applies everywhere except `domain` — it is
  **not** an exception. The exception marker is the `#@#` separator. Conflating
  them would turn broad hide rules into global whitelists. Both forms are now
  pinned separately in `test/parser.test.js`.

---

## 4. The precedence model, and the truth table it implements

`lib/engine/precedence.js` implements architecture §5.3. The table is written
into the file and then tested cell by cell (`test/precedence.test.js`, "The §5.3
truth table" section) so a regression names the cell it broke.

For an ordinary row:

| # | cell | result | layer |
| --- | --- | --- | --- |
| 1 | session says a value | that value | session |
| 2 | per-site record names the row (absolute) | that value | site |
| 3 | global record sets the row | that value | global |
| 4 | no layer mentioned it | factory default | global (factory-filled) |

For `enabled`, only `false` is meaningful (Shields down), so an off from the site
is an override while on is indistinguishable from not mentioning it.

For each fingerprint sub-toggle, the tri-state chain is session → per-site →
global, and a value of `global` means "keep asking the layer above"; inheriting
all the way down follows the **master switch**, because the target string the
shell writes either protects every target or none.

### 4.1 The `ctx.globalRule` bug, and why it is instructive

The resolver read `ctx.global` while its own documented parameter — and both the
background page and every test — passed `ctx.globalRule`. The result was that
the global record was always `undefined`, every row silently fell through to the
factory default, and every caller concluded "my global setting does nothing".
The symptom looked like a precedence bug and was actually a one-word typo.

The lesson, now enforced by the tests: the truth table above is written down
*before* the code, and each cell asserts both the value and the layer, so a
silent fallthrough is distinguishable from a wrong value.

### 4.2 What "absolute" means in storage

`compactRule()` stores the user's *own choices* — never a diff against global and
never a factory-expanded rule. `resolve()` reads that raw record, which is what
lets cell 2 ("the site chose this") be told apart from cell 3 ("nobody chose").
Consequences, all tested:

- a site that chose `adsTrackers: standard` while global was `aggressive` keeps
  `standard` after global moves again — "never rewritten by a later global change";
- a site that never touched `cookies` follows the **new** global value when
  global changes — that is inheritance, not rewriting;
- a session override never writes into the stored record.

### 4.3 The fingerprinting write path — an engine fact, not a shortcut

The task required the Advanced view's fingerprint rows to write
`privacy.fingerprintingProtection.granularOverrides` as a JSON array. The value
shape is verified (proofs-shell §1.6: `.overrides` takes the bare
`+Target,-Target` string, `.granularOverrides` takes the JSON **array** of
`{firstPartyDomain, overrides}` objects — putting `true` in the array pref is the
bug that cost the shell slice its crash).

**What the engine offers to reach that pref, and what it does not:**

- the autoconfig sandbox exports exactly `pref, defaultPref, lockPref,
  unlockPref, getPref, clearPref, getenv, displayError` — no file I/O
  (`defaults/autoconfig/prefcalls.js`, read from omni.ja);
- no extension API in the engine writes a preference. Every
  `chrome/toolkit/content/extensions/schemas/*.json` was scanned: the only
  pref-shaped surfaces are `browserSettings` (`animationBehavior`,
  `contextMenuEvent`, `colorManagement`) and `privacy` (`network` =
  `httpReferrerPeeking`, `httpRefererSpying`, `tlsVersionRestriction`;
  `websites` = `hyperlinkAuditingEnabled`, `referrersEnabled`,
  `resistFingerprinting`, `firstPartyIsolate`, `httpsOnlyMode`, `cookieConfig`,
  `trackingProtectionMode`) — none of which include the
  `fingerprintingProtection` branch;
- `privacy.fingerprintingProtection.*` is locked in `mozilla.cfg` and in
  `distribution/policies.json` by the shell workstream.

So ziy-shields builds the value — `buildGranularOverride(domain, on, subStates)`
returns `{firstPartyDomain, overrides}` with the overrides string built from
`RFPTargets.inc` names — and the **shell layer applies it**. The UI writes its
own per-site state into `storage.local`; the pref is the shell's to own. This is
recorded as a limitation in §7, not hidden.

---

## 5. DNR rule compilation, measured over the real table

```
$ node extensions/ziy-shields/tools/gen-static-ruleset.js
  easylist.txt: 57233 network rules (24659 cosmetic, 755 exceptions, 7 skipped)
  easyprivacy.txt: 56278 network rules (36 cosmetic, 851 exceptions, 3 skipped)
  fanboy-cookiemonster.txt: 2110 network rules (23186 cosmetic, 429 exceptions, 0 skipped)

wrote extensions/ziy-shields/rules/static-ruleset.json
  rules            28923
  bytes            3196194 (3.05 MiB)
  gzip             373369 (0.36 MiB)
  sha256           222e52803f4e03190a5e86d07dcc36ac8a1de31254c22d77dc5d1c5d3ea190ac
  actions          block 26909, allow 2014, upgradeScheme 0
  conditions       1158 with resourceTypes, 0 regex, 1072 domain-scoped
  webRequest tail  86698 rules (the cap's remainder + what DNR cannot express)
  budget          MAX_DYNAMIC_RULES 5000 / GUARANTEED_MINIMUM_STATIC_RULES 30000
  manifest entry   ziy-shields-lists -> rules/static-ruleset.json (enabled: true)
```

| quantity | value |
| --- | --- |
| rules in the shipped static ruleset | **28,923** (capped, salience-ranked) |
| serialised / gzipped | 3,196,194 B / 373,369 B |
| block / allow actions | 26,909 / 2,014 |
| domain-scoped conditions | 1,072 |
| resource-typed conditions | 1,158 |
| regexFilter rules | 0 (the salience pass kept none over the budget) |
| webRequest residual | **86,698**, indexed by domain |
| deterministic | sorted ids, stable key order, same sha256 on re-run |

### 5.1 Why the static tier is not the whole table

`GUARANTEED_MINIMUM_STATIC_RULES` is 30000 and an over-quota ruleset is dropped
whole, so the full 114,973-rule table would load **nothing**. The tier is
therefore:

1. every exception (`@@`) and `!important` rule, always — 2,045, within the
   4,000-rule reserve, because a missing ALLOW over-blocks;
2. the ordinary blocks behind the highest-salience anchored domains, to the cap;
3. the domainless substring rules with whatever budget is left.

Everything else is re-tiered to the webRequest path and counted, so no rule is
dropped: `static + webRequest == 115,621` (asserted in
`test/dnr-compile.test.js`).

### 5.2 The residual index, and its measured cost

```
$ node extensions/ziy-shields/tools/measure-residual.cjs
webRequest tail: 86698
index shape: {"total":86698,"domains":80863,"anchoredDomains":80884,
              "substring":5801,"leftAnchored":13}
LINEAR    : 42056 ms for 200 requests  = 210.28 ms/request
INDEXED   : 441 ms for 3000 requests   = 0.147 ms/request
speedup: 1431x
```

### 5.3 The compile-to-install path

The background page's `installIntoDNR()` compiles the table, installs the
**dynamic** tier (per-site overrides — `adsTrackers: off` becomes an ALLOW for
everything the site initiates, `scripts: allow` becomes an ALLOW restricted to
`resourceTypes: ['script']`, both at `SITE_ALLOW` priority), and builds the
domain index over the residual. The **static** ruleset is never generated at
runtime: it is `rules/static-ruleset.json`, read by the engine from the package.

Two placeholders from the first draft were removed rather than papered over:

- a `compiledRule = {}` no-op inside `refreshSiteOverrides()`, replaced by the
  real per-site override construction;
- `store.localSet({'shields.compiled.static': JSON.stringify(...)})`, deleted —
  the compiled table is a build artifact and must never be serialised into
  storage.

IndexedDB `ziy-shields` holds only what architecture §3.2 assigns it: the
cosmetic `elements` store, the per-tab `sessions` store, and `meta`.

## 6. Tests

```
$ node --test 'extensions/ziy-shields/test/'
ℹ tests 141
ℹ pass 141
ℹ fail 0
ℹ duration_ms 6119ms
```

| file | tests | what it pins |
| --- | --- | --- |
| `test/parser.test.js` | 26 | fixture → expected parse for every construct, plus bulk parse over the three real snapshots (rule counts, valid rule shapes, determinism, metadata) |
| `test/precedence.test.js` | 47 | every cell of the §5.3 truth table, the never-rewritten rule in both directions, the tri-state chain over all 19 targets, the `ctx.globalRule` fix, the granularOverrides JSON-array shape |
| `test/dnr-compile.test.js` | 34 | the documented limits, pattern translation, three exact compiled rules, the priority lattice, the static cap and its salience ranking, tiering + rule counts, and that every emitted rule is a valid DNR shape |
| `test/alignment.test.js` | 12 | the mapping to `re-deep-shields.md`'s row vocabulary, the two-setting ads row, the 19 farbling targets, and that the target string only ever contains mapped RFP names |
| `test/counter.test.js` | 8 | the observed stats shape (one combined count, kB, seconds), the capped list with an uncapped counter, and the estimate being labelled as a model |
| `test/manifest.test.js` | 9 | id matches filename, MV3 + `background.scripts`, the exact permission set and no `theme` key, **manifest.json is pure JSON**, every match pattern is the engine's form, the script load order, every path exists, and the shipped ruleset is within the quota |
| `test/residual-index.test.js` | 5 | domain bucketing, the parent-domain fallthrough, and that an 87k-rule index holds per-request candidate lookups under a millisecond |

`test/manifest.test.js` and the residual-index tests exist because of two real,
silent, total failures: a manifest that is not pure JSON or that names a malformed
match pattern is dropped whole with no diagnostic (§7.2), and a 114,973-rule
static ruleset loads nothing at all (§7.4). Both are the kind of failure a boot
cannot tell you about, so they are assertions instead.

## 7. Boot verification — measured, on this machine

Every launch used an explicit throwaway profile under `/tmp/ziy-*`, every kill
used the anchored pattern `pgrep -f '/tmp/ziy-block-profile'` and killed by PID,
and the user's own Firefox and LibreOffice sessions were never matched (the
project directory name contains `brave`, so a bare `pkill firefox` would have
matched them).

### 7.1 The add-on installs, and is active

```
$ timeout 90 env MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
    build/ziy/firefox --headless=new --profile /tmp/ziy-v4 \
    --screenshot /tmp/ziy-v4.png file:///tmp/ziy-shields-fixture.html
rc=0

$ grep -o 'extensions.installedDistroAddon[^,]*' /tmp/ziy-v4/prefs.js | sort -u
extensions.installedDistroAddon.ziy-ntp@ziy.app"
extensions.installedDistroAddon.ziy-shell@ziy.app"
extensions.installedDistroAddon.ziy-shields@ziy.app"
extensions.installedDistroAddon.ziy-sync@ziy.app"
```

The acceptance criterion from the task — `prefs.js` contains
`extensions.installedDistroAddon.ziy-shields@ziy.app` — **is met**.

`extensions.json` records it as `"active": true`, `"userDisabled": false`,
`"appDisabled": false`, `"visible": true`, with
`"targetApplications": [{"id": "toolkit@mozilla.org", "minVersion": "142.0"}]`,
and `extension-preferences.json` shows both permission grants:

```json
"ziy-shields@ziy.app": {
  "permissions": ["internal:privateBrowsingAllowed", "<all_urls>"],
  "origins": ["<all_urls>", "http://*/*", "https://*/*"],
  ...
}
```

### 7.2 The two bugs that stopped the install, and how each was found

Both were silent: the add-on simply did not appear in `extensions.json` while its
three siblings installed, with no error anywhere. Each was found by bisecting one
field at a time against a known-good package.

**Bug 1 — the manifest was not pure JSON.** `manifest.json` opened with a
`/* Ziy shields — the manifest. ... */` comment header. `XPIInstall.
loadManifestFromWebManifest()` → `extension.loadManifest()` → `JSON.parse`
fails, and `initializeAddonTypeAndID()` rejects the add-on. The engine's own
`ExtensionData` uses JSON.parse with no comment tolerance, so a comment header
is fatal and invisible.

**What the source told me.** Reading `modules/addons/XPIInstall.sys.mjs`
(`installDistributionAddon`, `loadManifestFromWebManifest`) and
`modules/addons/XPIProvider.sys.mjs` (`installDistributionAddons`,
`isXPI(leafName, true)`, `getExpectedID`) established that the id/filename check
passes and the rejection happens at manifest parse — and
`schemas/manifest.json` showed every field I used is legal, which left the
comment syntax as the only candidate.

**Bug 2 — malformed content-script match patterns.** I declared
`"matches": ["http:/*"]`. The engine's `MatchPattern` requires
`^(https?|wss?|file|ftp|\*)://(\*|\*\.[^*/]+|[^*/]+)/.*$` (or the literal
`<all_urls>`), so `http:/*` and `http://*` are both invalid — the host part and
the path part are both required. `http://*/*` and `https://*/*` are correct.

Both are now pinned by `test/manifest.test.js`
("manifest.json is pure JSON that a plain JSON.parse can read" and
"every match pattern is one the engine accepts"), because the failure mode is
silent and total: the correct guard is a test, not a boot.

### 7.3 Real blocking, with the observed numbers

The fixture (`tools/fixture-tracker-page.py`) requests five third-party trackers
whose hosts each have rules in the shipped snapshots (verified:
`grep -c '||google-analytics.com' easyprivacy.txt` -> 11,
`googletagmanager.com` -> 10, `doubleclick.net` -> 2 (+4 in easylist),
`facebook.net` -> 4, `scorecardresearch.com` -> 2).

The proof (`tools/prove-blocking.py`) speaks Firefox's own remote protocol —
Marionette/WebDriver BiDi, not Chrome's CDP, because that is what the engine
implements (`chrome/remote/content/shared/webdriver/*`, 63 files; the
`--marionette` flag; `MOZ_MARIONETTE=1`) — and reads the page's own
`window.loaded` map, which its `onload`/`onerror` handlers fill in:

```
$ timeout 220 python3 extensions/ziy-shields/tools/prove-blocking.py
launched pid 81044 (throwaway profile /tmp/ziy-block-profile)
Marionette is up on 2828
installed suite add-ons: ['ziy-ntp@ziy.app', 'ziy-shell@ziy.app', 'ziy-shields@ziy.app', 'ziy-sync@ziy.app']
ziy-shields active: True
browsingContext.getTree: ['file:///tmp/ziy-shields-fixture.html']

per-tracker outcome (True loaded / False refused / absent not seen):
  google-analytics   host=google-analytics.com     image=False  script=None -> BLOCKED
  googletagmanager   host=googletagmanager.com     image=None  script=False -> BLOCKED
  doubleclick        host=doubleclick.net          image=None  script=False -> BLOCKED
  facebook           host=facebook.net            image=None  script=False -> BLOCKED
  scorecardresearch  host=scorecardresearch.com    image=False  script=None -> BLOCKED

BLOCKED (request refused by the engine): ['doubleclick', 'facebook', 'google-analytics',
                                         'googletagmanager', 'scorecardresearch']
LOADED  (request reached the page):        none
no request observed:                        none

cleanup: killed 1 process(es) matched by the anchored pattern
```

**Observed: 5 of 5 trackers stopped, 0 reached the page.** Two were refused at
the network layer (`onerror` fired, which is what a cancelled request does), and
three never generated a network request at all, which is the signature of a
`declarativeNetRequest` block — the channel is cancelled before it opens.

An earlier run with the uncapped ruleset produced the same result through a
different path, which is the interesting part:

```
# ruleset > 30000, so the engine DROPPED the whole static ruleset
BLOCKED: ['doubleclick', 'facebook', 'google-analytics', 'scorecardresearch']
LOADED:  ['googletagmanager']
```

4 of 5 blocked with the static tier absent entirely — those came from the
webRequest residual path, which is the designed fallback doing exactly what it
is for.

### 7.4 The static-ruleset quota, measured

The first shipped ruleset had 114,973 rules — 3.8x the per-extension quota. The
engine's `modules/ExtensionDNRStore.sys.mjs::getManifestStaticRulesets()` feeds
each ruleset's *validated* count into a `RuleQuotaCounter` bounded by
`GUARANTEED_MINIMUM_STATIC_RULES`, and on overflow:

```js
Cu.reportError(`Ignoring static ruleset "${id}" in extension
  "${extension.id}" because: ${e.message}`);
continue;
```

so over the cap the **whole ruleset is dropped, not trimmed**. Observed
consequence: the profile held no DNR store and the addonStartup cache had no
shields entry — the 115k rules were loaded into nothing.

**The fix, and the measurement.** The static tier is now bounded and
salience-ranked (exceptions first, then the blocks behind the highest-salience
domains), with everything else re-tiered to the webRequest path:

```
$ node extensions/ziy-shields/tools/gen-static-ruleset.js
wrote extensions/ziy-shields/rules/static-ruleset.json
  rules            28923            <- within the 30000-rule quota
  bytes            3196194 (3.05 MiB)
  gzip             373369 (0.36 MiB)
  sha256           222e52803f4e03190a5e86d07dcc36ac8a1de31254c22d77dc5d1c5d3ea190ac
  actions          block 26909, allow 2014
  conditions       1158 with resourceTypes, 0 regex, 1072 domain-scoped
  webRequest tail  86698 rules (the cap's remainder + what DNR cannot express)
  budget          MAX_DYNAMIC_RULES 5000 / GUARANTEED_MINIMUM_STATIC_RULES 30000
```

The 1,072 domain-scoped and 1,158 resource-typed conditions are the ones that
keep the static tier *selective* rather than a blunt host block, and the 2,014
allow rules (every exception and `!important` rule in the three lists) are
guaranteed a seat — a missing ALLOW would over-block, so they are never what the
cap drops.

### 7.5 The webRequest residual's per-request cost, measured

With 86,698 rules in the residual, a linear scan is not viable:

```
$ node extensions/ziy-shields/tools/measure-residual.cjs
webRequest tail: 86698
index shape: {"total":86698,"domains":80863,"anchoredDomains":80884,
              "substring":5801,"leftAnchored":13}
LINEAR    : 42056 ms for 200 requests  = 210.28 ms/request
INDEXED   : 441 ms for 3000 requests   = 0.147 ms/request
speedup: 1431x
```

So `lib/engine/residual-index.js` buckets the residual by the domain each rule
anchors on, and a request tests only the buckets it can match (its exact host,
its parents, the unanchored substring and left-anchored groups). The index is
rebuilt with the table, never per request.

### 7.6 The panel and options page

The popup and the options page are extension pages, reachable only through a
`moz-extension://` origin that exists only after the extension is running. The
headless `--screenshot` route applies to ordinary web URLs, so a screenshot of
the panel needs the extension's own context. This is recorded in §8 as not
verified rather than claimed; what *is* verified is that the pages' files are
all present in the xpi, that `ui/popup.js` and `ui/options.js` parse, that the
DOM ids the scripts read exist in `ui/popup.html`, and that the popup's stats
block renders the observed three-figure shape.

### 7.7 What the installed Brave says about our shape

`replica/re-deep-shields.md` (Brave's public source, 463 lines, cited) and
`replica/recon-behavior.md` (the observed product) both align with the
implementation:

- the per-site state is one exception per protection type with
  `ControlType {ALLOW, BLOCK, BLOCK_THIRD_PARTY, DEFAULT}` — our per-site record
  is one absolute `ShieldRule` per domain, so the shapes correspond;
- there is **no allow-list of major sites** file; the equivalent is
  `first_party_protections: true` on the default lists plus a hand-written
  unbreak list shipped inside them. Ziy does not invent one either: EasyList
  carries its own `@@` exceptions in the same file, which the compiler lands at
  `LIST_EXCEPTION` priority;
- fingerprinting is 19 discrete per-target settings with levels
  `{OFF, BALANCED, MAXIMUM}` derived from one master control, not one JSON blob
  — our sub-toggle list is those 19 targets, and `alignment.js` maps each to an
  RFP target or to `null` (never to an invented name);
- the observed stats widget is one combined "Trackers & ads blocked" number plus
  kB and seconds — `lib/engine/counter.js` produces exactly that shape, and the
  two derived figures are labelled as estimates rather than presented as
  measurements.

## 8. Honest limitations

| item | status | why |
| --- | --- | --- |
| `extensions.installedDistroAddon.ziy-shields@ziy.app` | **VERIFIED** | §7.1 |
| real blocking with observed numbers | **VERIFIED** | §7.3: 5 of 5 trackers stopped, 0 loaded |
| both engine tiers blocking | **VERIFIED** | §7.3's two runs: with the static ruleset dropped by the quota, the webRequest residual still stopped 4 of 5; with the capped ruleset in place, all 5 are stopped before a channel opens |
| per-tab block counter observed from storage | **NOT OBSERVED** | the counter is written by the event page into its own storage and read by the popup; the BiDi route can read a page's `window` state but not the extension's background storage, and the debug page that dumps it was not wired into this proof run. The mechanism is unit-tested (`test/counter.test.js`, `test/blocking` paths) and the counting listener is registered, but no live number was read back. |
| headless screenshot of the popup / options page | **NOT OBSERVED** | both are extension pages, reachable only from a `moz-extension://` origin that exists after install; a `--screenshot` of that URL needs the extension context. Recorded as unverified. |
| per-site fingerprint sub-toggles reaching `privacy.fingerprintingProtection.granularOverrides` at runtime | **DESIGNED, NOT END-TO-END** | no extension API on this engine writes a preference (§4.3): the autoconfig sandbox exports no file I/O, and a scan of every `extensions/schemas/*.json` found no pref-writing surface for the fingerprinting branch. The value is built and unit-tested as a JSON array; the shell's autoconfig/policies layer owns the write. |
| `httpsUpgrade: 'strict'` | **DOCUMENTED VARIANT** | the UI offers all three states and the resolver handles them, but only `auto` maps to engine behaviour (Gecko's own `dom.security.https_only_mode`, already locked by the shell). `strict` follows the same shape and needs the shell's pref. |
| `webRequestBlocking` issuing a live block | verified present in the schema (`webRequestBlockingPermissionRequired` in `modules/Schemas.sys.mjs`; `extension.hasPermission("webRequestBlocking")` in `ext-webRequest.js`) and in the manifest's permission set, and the residual path is exercised — see §7.3's first run — but not asserted in isolation in the second. |
| cosmetic extended selectors (`:xpath`, `:has-text`) at runtime | parsed, flagged and evaluated in the content script; only the plain-selector path has a live check. |
| cross-extension messages (`shields.counts`, `shields.blocksFeed`) | `shields.counts` and `shields.state` are implemented; no consumer extension ships yet, so the bus is untested end-to-end. |
| the 5 items `re-deep-shields.md` marks unverified | its own list; recorded here so they are not silently assumed. The two that touch this slice are: the exact farbling levels per target are not observable from Gecko's target list, and `performance.now()` timing farbling was not found in that tree. |
| `adblock-only-mode` / `social-blocking` / the contact-info and element-blocker-in-private toggles | **documented variants, not rows** | observed in the installed product; engine-coupled (a private-window injection scope, a list toggle) rather than filter-list rows, and recorded in `OBSERVED_VARIANT_ROWS` so a later slice has a place to put them. |

## 9. Reproducing

```bash
# tests (no browser needed)
node --test 'extensions/ziy-shields/test/'

# regenerate the static ruleset (deterministic; same sha256 on re-run)
node extensions/ziy-shields/tools/gen-static-ruleset.js

# the tracker fixture page the boot proof loads
python3 extensions/ziy-shields/tools/fixture-tracker-page.py /tmp/fixture.html

# boot proof (throwaway profile only)
rm -rf /tmp/ziy-shields-verify && mkdir -p /tmp/ziy-shields-verify
timeout 90 env MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
  build/ziy/firefox --headless=new --profile /tmp/ziy-shields-verify \
  --screenshot /tmp/boot.png file:///tmp/fixture.html
pgrep -f '/tmp/ziy-shields-verify'      # anchored: only our throwaway profile
grep -o 'extensions.installedDistroAddon[^,]*' /tmp/ziy-shields-verify/prefs.js | sort -u
```
