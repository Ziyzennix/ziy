# proofs-cpp-network — the network/storage C++ delta workstream

**Status: research complete, ONE patch authored and apply-verified, not compiled.**

**Headline:** of the four candidate areas the brief named, **one is a real,
grounded, patchable engine gap and now has a patch** (`0005`, the dead
`network.dns.disablePrefetchFromHTTPS` pref). The 1PES ephemeral-storage
**lifetime** half is a **campaign, not a patch** — and this report says exactly
why, with the engine's own primitives mapped, because the honest scoping is more
useful than a fake patch. autoShred/forget-me and the query-strip/debounce/de-AMP
set are both **engine-side complete already, or JS-only deltas** — recorded with
the reasoning so nobody re-derives them.

Zero scaffolds, zero placeholders, zero "TODO: implement". Everything below is
either grounded in source read on this box at the cited path/line, or marked
`[UNVERIFIED]`.

---

## 1. What was authored

### `patches/0005-dns-disable-prefetch-from-https.patch` — REAL, apply-verified

| property | value |
| --- | --- |
| file touched | `netwerk/dns/nsDNSService2.cpp` (one hunk, +26 lines) |
| gate | `MOZ_ZIY_FINGERPRINTING` (0002's `--enable-ziy-fingerprinting`) |
| `git apply --check` | **RC=0** (after 0001–0004 in numeric order) |
| `git apply` forward | **RC=0** |
| `git apply --reverse --check` | **RC=0** |
| real reverse + `cmp` | **RC=0, byte-identical** |
| gate-off strip + `cmp` | **byte-identical to pristine** |
| braces / `#ifdef` pairing | 0 delta; one `#ifdef` matched by one `#endif` |
| compiled | **no** — CI's job (`.github/workflows/build-gecko.yml`) |

**The gap, in one paragraph.** The engine registers
`network.dns.disablePrefetchFromHTTPS` as a bool StaticPref with `mirror: always`
(`modules/libpref/init/StaticPrefList.yaml:15433-15437`) — the pref layer
expresses a capability. Then no engine code reads it. The single tree-wide hit is
the comment at `netwerk/dns/DNSServiceBase.cpp:36-37`, which asserts the *opposite*
of the truth — *"`disablePrefetchFromHTTPS` is a StaticPref and needs no
callback"* — and that assertion is why `DNSServiceBase::AddPrefObserver()`
(`:33-44`) declines to observe it. A pref that needs no callback still needs a
consumer. This is the 0001 pattern in a new area, and it is the same class as
`0001-rfp-colorscheme-carveout.patch`: a pref the engine documents that its own
code never honours.

**Why this pref and not another.** Ziy locks it in the shell (`ziy.js`,
`mozilla.cfg`), so it is a protection the user is told is active. It is also the
*fingerprinting-relevant* half of prefetch: an HTTPSSVC (SVCB) answer carries the
server's ECH config list and alt-service hints — per-server identity material
the querying client has no need to obtain speculatively. Its sibling
`network.dns.disablePrefetch` **is** honoured, two lines above the patch site,
by exactly the early-return shape the patch copies.

**The patch follows the engine's own chosen place, not a new pattern.**
`nsDNSService::AsyncResolveInternal()` (`nsDNSService2.cpp:1025-1041`) is the
single funnel every async DNS lookup passes through, and it already returns early
inside the lock block for the pref-controlled speculative path. The new check
mirrors it: same early return, same enclosing lock scope, same structure, no
restructuring of surrounding code. It returns `NS_ERROR_NOT_AVAILABLE` (the
engine's existing "cannot be satisfied here" code, used for the null-resolver
case at the same site, `:1053`) rather than the sibling's
`NS_ERROR_DNS_LOOKUP_QUEUE_FULL`, which means "queued, retry later".

**A note on the include.** No new `#include` is needed:
`nsDNSService2.cpp:11` already includes `mozilla/StaticPrefs_network.h`, which
carries `network.dns.offline-localhost` — a pref registered in the same YAML
pref group (`StaticPrefList.yaml:15618-15622`), so
`StaticPrefs::network_dns_disablePrefetchFromHTTPS()` resolves through the same
generated header. This is `[UNVERIFIED]` in the strictest sense: the generated
`StaticPrefs_network.h` does not exist until configure runs, and no Gecko
compile was performed on this box. The *evidence* is that every other
`network.dns.*` StaticPref used in `netwerk/dns/*.cpp` resolves through that one
header — `network_dns_offline_localhost()` is called in this very file at `:1074`
with no other include — and both names live in the same YAML block.

---

## 2. Candidate 1 — the 1PES ephemeral-storage LIFETIME half

**Verdict: real gap, ENGINE-CONFIRMED, but a CAMPAIGN not a patch. Documented,
not authored.** This is the honest scoping the brief asked for, and it is more
precise than the earlier workstream's version of it (`proofs-cpp-privacy.md`
§2.4) because this pass read the engine's teardown primitives end to end.

### 2.1 The gap is real — the engine says so in its own words

`toolkit/components/antitracking/StoragePrincipalHelper.h:190-195`:

> *"We are planning to clear the partitioned site-data as soon as the page is
> reloaded or dismissed (**not done yet - bug 1628313**)."*

The **partitioning** half is active in Ziy: `network.cookie.cookieBehavior=5`
(`BEHAVIOR_PARTITION_FOREIGN`) is honoured by
`CookieJarSettings::IsRejectThirdPartyContexts` (`netwerk/cookie/CookieJarSettings.cpp:620-623`,
constants at `netwerk/cookie/nsICookieService.idl:75-81`), and
`StoragePrincipalHelper::Create()` builds the partitioned principal whose
`partitionKey` is the top-level scheme + eTLD+1 (`StoragePrincipalHelper.h:17-45`,
`StoragePrincipalHelper.cpp`). So third-party state is
already partitioned per first-party site. What 1PES adds is the *lifetime* half,
and that is what the engine has not done.

### 2.2 The decisive finding: the engine ALREADY has the teardown primitive

This is the part the earlier workstream did not reach, and it changes the scoping
considerably. **`nsIClearDataService.deleteDataFromSite()` already implements
exactly Brave's 1PES teardown semantics, including the partitioned third-party
half.** Read it, do not take my word for it:

- `toolkit/components/cleardata/ClearDataService.sys.mjs:795` `deleteBySite(aSchemelessSite, aOriginAttributesPattern)`,
  the method the C++ `nsIClearDataService` funnel
  (`toolkit/components/cleardata/nsIClearDataService.idl:80`) dispatches to.
- It calls, in order, with a **partition-key-aware** match every time:
  - `sessionStorage` via the `browser:purge-sessionStorage` notification with an
    `nsIClearBySiteEntry` (`ClearDataService.sys.mjs:809-816`); the consumer
    `StorageObserver::Observe` (`dom/storage/StorageObserver.cpp:360-400`) reads
    the entry's `patternJSON` as an `OriginAttributesPattern`.
  - **third-party state partitioned under the first-party site**, explicitly:
    `ClearDataService.sys.mjs:818-831` notifies
    `"dom-storage:clear-origin-attributes-data"` with
    `partitionKeyPattern: { baseDomain: aSchemelessSite }` — verbatim comment:
    *"Clear third-party storage partitioned under aSchemelessSite."*
  - cookies via `CookieCleaner.deleteBySite` (`:289-307`), which filters
    `Services.cookies.cookies` through the same `hasSite()` helper.
  - quota (IndexedDB/localStorage/cache) via
    `_qmsClearStoragesForPrincipalsMatching()` (`:840-848`), again `hasSite()`.
  - ServiceWorkers via `ServiceWorkerCleanUp.removeFromSite` **before** the quota
    clear, which is a real ordering constraint that the engine already gets right.
- And the match helper itself is partition-aware, in the engine's own words
  (`ClearDataService.sys.mjs:196-213`):

  ```js
  // Additionally check for partitioned state under the top level
  // aSchemelessSite. We need to inspect the OriginAttributes partitionKey for
  // that.
  let patternWithPartitionKey = {
    ...aOriginAttributesPattern,
    partitionKeyPattern: { baseDomain: aSchemelessSite },
  };
  ```

So the teardown half of 1PES — the part Brave implements in
`tld_ephemeral_lifetime.cc` — is **not missing in Gecko**. It is exposed,
partition-key-aware, and covers cookies + sessionStorage + quota + SW + TLS
tokens. **What is missing is only the lifetime trigger.**

### 2.3 Why the trigger cannot be expressed in JS (rules out the extension layer)

The extension layer would need `browser.browsingData`, and the shape does not
reach:

- `browsingData.remove()` maps to `nsIClearDataService::deleteDataFromHost()`
  (see `toolkit/components/extensions/parent/ext-browsingData.js:85-115` calling
  `Services.clearData.deleteDataFromHost(...)`) — **`deleteByHost`, not
  `deleteBySite`**. `SiteDataCleaner.deleteByHost` (`ClearDataService.sys.mjs:856+`)
  does *not* build a `partitionKeyPattern`, so it would under-clear the
  partitioned third-party half even if it existed.
- The `hostnames` removal option is documented as applying *"only … to cookies
  and localStorage"* (`schemas/browsing_data.json:35`), and `clearQuotaManager`
  (`ext-browsingData.js:130-200`) filters purely on hostname, never on
  partitionKey. So an extension cannot ask for "all third-party state partitioned
  under example.com".
- `browsingData` is an **optional permission** (`schemas/browsing_data.json:8-13`
  `$extend: OptionalPermission`), so it also fails the "no permission prompt"
  constraint Ziy's shell holds itself to.
- `Services.eTLD.getSchemelessSite` exists in chrome code but not in the WebExtension
  API surface.

**Therefore the delta cannot be delivered in `extensions/ziy-shields`.** That is
the finding worth reporting: the natural-looking JS implementation is
*semantically wrong*, not merely inconvenient.

### 2.4 The exact multi-file shape of the campaign

The trigger needs, minimally, these concrete pieces. All are grounded in
engine files that exist:

1. **A per-eTLD+1 tab reference count in the parent process.** Brave binds
   storage lifetime to the first-party TLD-storage area; Gecko's primitive for
   "how many top-level tabs hold this site" already exists in an *adjacent*
   feature and is the precedent to copy: `BounceTrackingState` keeps a global
   `browserId → state` map
   (`toolkit/components/antitracking/bouncetrackingprotection/BounceTrackingState.cpp:36`
   `sBounceTrackingStates`) and exposes
   `BounceTrackingState::HasBounceTrackingStateForSite(siteHost, originAttributes)`
   (`BounceTrackingState.h:105-111`) — the engine's own approximation of "is this
   site currently loaded in a top-level tab". **A Ziy 1PES registry is that same
   hash keyed by eTLD+1 instead of `browserId`.**
2. **A hook on top-level browsing-context teardown.** The exact notification
   exists and is already consumed by the adjacent feature — it does not need
   inventing: `BrowsingContext::Detach()` fires
   `"browsing-context-discarded"` with the BC as subject
   (`docshell/base/BrowsingContext.cpp:1159-1160`), and
   `BrowsingContextWebProgress::ContextDiscarded()`
   (`docshell/base/BrowsingContextWebProgress.cpp:163-168`) forwards it to
   `BounceTrackingState::OnBrowsingContextDiscarded()`. **This is the hook.**
3. **A JS or C++ consumer that, on the count hitting zero for an eTLD+1, calls
   `Services.clearData.deleteDataFromSite(site, {})`.** The engine's own
   precedent for "JS component observes a topic and drives ClearDataService" is
   `PurgeTrackerService.sys.mjs:211`, which calls
   `Services.clearData.deleteDataFromPrincipal(...)` from a `.sys.mjs` with an
   `observe()` switch on `"idle-daily"`. A `ZiyEphemeralStorage.sys.mjs` with the
   same shape — observing `"browsing-context-discarded"`, keeping the count, and
   calling `deleteDataFromSite` — is the *smallest real version* of the campaign.

**Estimated blast radius for that smallest version:** one new `.sys.mjs`
component + its `components.conf`/manifest entry + one `moz.build` line, i.e.
**3–4 files, none of them engine-source surgery** — because every primitive it
needs already exists. That is the honest answer to the brief's question: it is
not the 6-file C++ rewrite the phrase "campaign" suggests, and it is not a
one-file patch either.

### 2.5 Why it was NOT authored as `0006`

Three reasons, in order of weight:

1. **The acceptable-evidence bar is an end-to-end behaviour test, and that needs
   a compiled engine.** The only way to prove this component works is to boot a
   patched build and assert that closing the last tab for `example.com` wipes
   `tracker.example.net`'s partitioned cookies. Everything in this workstream is
   authored-not-compiled by policy (`patches/README.md`, `deep-fork.md` §0);
   authoring a component whose correctness is unobservable without a build, and
   whose failure mode is *destroying site data at the wrong time*, is a worse
   outcome than not shipping it.
2. **The reference-count dedup is the hard part, not the plumbing.** Brave's own
   implementation binds `{storage_domain, storage_partition_config}` in a
   process-wide map (`re-deep-shields.md` §6) and has an entire
   `kBraveEphemeralStorageKeepAlive` feature to get it wrong safely. A naive
   count that decrements on *any* BC discard — including discarded-but-relaunched
   BFCache entries, replaced contexts (`"browsing-context-discarded"` fires with
   `why == "replace"`, `BrowsingContext.cpp:1154-1157`) — would shred live site
   data. The engine's own doc
   (`toolkit/components/antitracking/docs/data-sanitization/index.md`) documents
   how much care "Forget About This Site"-style clearing needs; doing it on a
   timer-free background event is strictly harder.
3. **No engine file needed to change.** Because the primitive exists, a patch in
   `patches/` is the wrong vehicle: `patches/*.patch` is for source diffs applied
   before `./mach build`, and this component belongs in the packaged app
   (`tools/`, omni.ja) where the JS layer lives. Authoring it as a `.patch` would
   have been a category error.

**Recommendation to the main agent:** fund §2.4's 3–4-file component as a
follow-on JS workstream (not a C++ patch), gated behind a build that can boot and
assert it. Do not simplify it into a `.patch` to make it look shippable.

---

## 3. Candidate 2 — autoShred / forget-me (LAST_TAB_CLOSED / APP_EXIT)

**Verdict: the APP_EXIT half is a PREF, the LAST_TAB_CLOSED half is §2's
campaign. No new patch. Recorded gap on the JS side only.**

### 3.1 A real minimal engine-side delta does not exist for LAST_TAB_CLOSED, but the primitives are all there

The brief asked me to read whether Gecko has an equivalent hook. It has all the
parts and no existing per-tab teardown feature:

| what AutoShred needs | Gecko's state |
| --- | --- |
| know when a tab is gone | `"browsing-context-discarded"`, fired from `BrowsingContext::Detach()` (`docshell/base/BrowsingContext.cpp:1159-1160`), with subject = the BC and data = `"discard"`/`"replace"` |
| count top-level tabs holding an eTLD+1 | `BounceTrackingState::HasBounceTrackingStateForSite()` + the `browserId → state` map (`bouncetrackingprotection/BounceTrackingState.cpp:36`, `.h:105-111`) is the engine's own precedent for the same keying |
| tear the site's data down | `Services.clearData.deleteDataFromSite(site, {})`, partition-aware (`cleardata/ClearDataService.sys.mjs:795-855`) |
| do it at app exit | **`privacy.sanitize.sanitizeOnShutdown` + `privacy.clearOnShutdown_v2.*`** — a pref-expressed capability that already runs at exit (see §3.2) |

**An honest note on the wider prefs Ziy might want:** the report
`proofs-cpp-privacy.md` §2.5 listed `privacy.partition.network_state.cookie_cache`
/ `.ocsp_cache` / `privacy.partition.serviceWorkers` as dead names in
`StaticPrefList.yaml`. A grep of the extracted tree agrees that no *consumer*
was found for those three in `netwerk/` and `toolkit/components/antitracking/`,
and `StaticPrefList.yaml` registers only
`privacy.partition.bloburl_per_partition_key` and
`privacy.partition.network_state.connection_with_proxy` (`:18269`, `:18281`). The
right call for Ziy is the same as `proofs-cpp-privacy.md`'s — drop the names from
`mozilla.cfg`/`ziy.js`, do not patch the engine to honour them.

### 3.2 APP_EXIT is already pref-expressible — and worth turning ON

This is the actionable finding of this section, and it is a shell change:

- `privacy.sanitize.sanitizeOnShutdown` — **registered** at
  `StaticPrefList.yaml:18244` (`RelaxedAtomicBool`, mirror: always), default
  `false`. Documented as *"Whether to clear data on Firefox shutdown"* in
  `toolkit/components/antitracking/docs/data-sanitization/index.md:69`.
- The per-category `privacy.clearOnShutdown.*` / `privacy.clearOnShutdown_v2.*`
  branch is real: `Sanitizer.sanitizeOnShutdown()` reads the whole set
  (`browser/modules/Sanitizer.sys.mjs:1049-1065`) and clears via
  `ClearDataService` (`:1299`, `:1304-1309`).
- **The consumer is alive and this is a shell change, not a patch.** Ziy should
  lock `privacy.sanitize.sanitizeOnShutdown=true` +
  `privacy.clearOnShutdown_v2.cookiesAndStorage=true` (+ `cache`, `formdata`) in
  `shell/mozilla.cfg` / `ziy.js`. Net effect: Brave's `AutoShredMode.APP_EXIT`
  behaviour, zero engine delta.
- One engine-side caveat worth recording: `PurgeTrackerService` refuses to purge
  when `sanitizeOnShutdown` is on *and* history/siteSettings are also on
  (`PurgeTrackerService.sys.mjs:295-333`, bug 1672394's hotfix). So Ziy must not
  enable `privacy.clearOnShutdown.history` / `.siteSettings` at the same time as
  it enables sanitize-on-shutdown, or it silently disables tracker purging. That
  is a pref-interaction trap for whoever writes the shell change, not a patch.

---

## 4. Candidate 3 — more dead prefs in netwerk/ and antitracking

**Verdict: one more 0001-class dead pref found and patched (`0005`); one
documented-but-dead pref *family* recorded; the live/ALIVE result for everything
else. Audit method is reproducible.**

### 4.1 `0005`'s pref — the second 0001-class dead pref in the tree

`network.dns.disablePrefetchFromHTTPS`: registered
(`StaticPrefList.yaml:15433-15437`), **zero consumers**, and the only hit is a
comment asserting a consumer exists (`DNSServiceBase.cpp:36-37`). See §1.

### 4.2 The second dead pref — `network.dns.prefetch_via_proxy`, dead for a different reason

- Registered at `StaticPrefList.yaml:15446-15448` (`# For testing purpose only:
  allow dns prefetch through proxies`), default `false`.
- One consumer exists: `netwerk/base/nsProtocolProxyService.cpp:2335` — so it is
  **not** 0001-class (it is read). Recorded here for completeness because the
  default is `false` and the only path that honours it is the manual-proxy path;
  a Ziy user behind no proxy can never set it to anything useful.
- The pref above's neighbour, `network.dns.disablePrefetch`
  (`StaticPrefList.yaml` includes the base name), **is** honoured:
  `DNSServiceBase::ReadPrefs` reads it into `mDisablePrefetch`
  (`DNSServiceBase.cpp:65-68`) and `nsDNSService2.cpp:1039` enforces it. Do not
  touch this one.

### 4.3 Documented-but-never-wired family — `privacy.partition.network_state.cookie_cache`, `.ocsp_cache`, `privacy.partition.serviceWorkers`

Not 0001-class in the strict sense either, and worth keeping straight:
`StaticPrefList.yaml` registers **`privacy.partition.network_state.connection_with_proxy`**
at `:18281` with the comment *"By default, the network state isolation is not
active when there is a proxy setting"* — the *only* one of that family that
exists. `privacy.partition.bloburl_per_partition_key` exists at `:18269`
(consumer: the blob URL path used from the browser tests). Ziy's `mozilla.cfg`
locks `privacy.partition.network_state.cookie_cache` / `.ocsp_cache` /
`privacy.partition.serviceWorkers`, none of which exist in the engine at all —
the same dead-name shell bug as `proofs-cpp-privacy.md` §2.5. **Fix the shell, do
not patch.**

### 4.4 The audit's ALIVE list (so nobody re-derives it)

Every pref below was grepped across the extracted tree and has a live consumer.
Abridged to the privacy-relevant ones; the full grep list is in
`agent://cpp-network.DeadPrefScout` (the scout payload) and the raw transcript at
`history://cpp-network.DeadPrefScout`.

| pref | consumer (file:line) |
| --- | --- |
| `network.cookie.cookieBehavior` | `netwerk/cookie/CookieService.cpp:113-119` |
| `network.cookie.maxageCap` | `netwerk/cookie/CookieCommons.cpp:1003,1015` |
| `network.cookie.lifetimePolicy` | **not registered anywhere; read only by the one-shot migration** `CookieService.cpp:58-95` then `ClearUser`. **The canonical dead pref — a shell bug, already fixed in Ziy's `ziy.js` comment.** |
| `network.cookie.CHIPS.*` | `CookieService.cpp:586,1061` |
| `network.dns.disabled` | `GetAddrInfo.cpp:383`, `nsHostResolver.cpp:1019` |
| `network.dns.echconfig.enabled` | `nsHttpHandler.cpp:3070` |
| `network.trr.mode` | `TRRServiceBase.cpp:129,151` |
| `privacy.query_stripping.enabled` / `.pbmode` / `.redirect` | `URLQueryStringStripper.cpp:141-166`; `nsHttpChannel.cpp:6952` |
| `privacy.query_stripping.strip_on_share.enabled` | `URLQueryStringStripper.cpp:226,475` |
| `privacy.bounceTrackingProtection.*` (all 8) | `BounceTrackingProtection.cpp:86-139`, `BounceTrackingState.cpp:877`, `...Storage.cpp:208-209` |
| `privacy.purge_trackers.*` | `PurgeTrackerService.sys.mjs:31,38,296,357` |
| `privacy.antitracking.enableWebcompat` | `AntiTrackingRedirectHeuristic.cpp:182,285` |
| `privacy.restrict3rdpartystorage.*` | `StorageAccessAPIHelper.cpp:137-150` |
| `privacy.sanitize.sanitizeOnShutdown` | `PurgeTrackerService.sys.mjs:295` (read-only guard) + `Sanitizer.sys.mjs:1049` |
| `network.http.referer.*` (whole family) | **`dom/security/ReferrerInfo.cpp`** — `[UNVERIFIED]` by absence-grep on this box because `dom/security` was not extracted; cross-checked against the release-tagged upstream tree |

`network.http.referer.*` deserves an honest `[UNVERIFIED]` rather than a claim:
the extracted tree did not contain `dom/security/`, so an absence grep could not
disprove a consumer. If a future pass wants those ALIVE verdicts proven from
disk, extract `dom/security` and re-run. **The one thing to not do** is carry
them as dead on the strength of an incomplete grep.

**Method (reproducible):** extract `netwerk/{cookie,dns,protocol,base}`,
`toolkit/components/antitracking`, `docshell`, `dom/webidl`, `dom/storage`,
`dom/quota`, `toolkit/components/{cleardata,extensions}`, `browser/modules` and
`modules/libpref` from the checksum-verified tarball, then
`grep -rn "<PrefName>" ` and check for a consumer that is not (a) a registration
in `StaticPrefList.yaml`/`all.js`, (b) a comment, or (c) a migration shim.

---

## 5. Candidate 4 — query-param stripping / debounce / de-AMP

**Verdict: no C++ needed, and in one case no patch needed at all — a pref the
shell does not set. The likely 'no C++ needed' outcome.**

### 5.1 Query-parameter stripping — Gecko's native mechanism is better, and it is OFF

`toolkit/components/antitracking/URLQueryStringStripper.cpp` (+
`URLQueryStrippingListService.sys.mjs`, `nsIURLQueryStringStripper.idl`) is
Gecko's answer to Brave's `components/query_filter` +
`components/url_sanitizer`:

- The strip list is sourced from **both** the pref
  `privacy.query_stripping.strip_list` **and a Remote Settings collection**
  (`URLQueryStrippingListService.sys.mjs:14`
  `COLLECTION_NAME = "query-stripping"`, `:186-191` `rs.on('sync')`, `rs.get()`;
  `_notifyObservers` at `:316-334` unions both) — i.e. it is the engine-native
  equivalent of Brave's *component-updated* `query-filter.json`.
- It strips on **top-level navigation** (`URLQueryStringStripper.cpp:141-166`
  `Strip()`, consumers in `nsDocShell`/`BrowsingContext` per the engine's own
  `docs/query-stripping/index.md:144-153`) **and on third-party top-level HTTP
  redirects** (`netwerk/protocol/http/nsHttpChannel.cpp:6951-7000`, pref
  `privacy.query_stripping.redirect`, default `true`).
- Default is **`false`** — `StaticPrefList.yaml:18296-18299` for
  `privacy.query_stripping.enabled`, `:18303-18306` for `.pbmode`,
  `:18288-18291` for `strip_on_share.enabled` — and **Ziy does not set it**.
- There is also a separate, even broader sibling feature: `StripForCopyOrShare`
  recurses into a **nested URI inside a query-param value**
  (`URLQueryStringStripper.cpp:437-469` `TryStripValue`) — broader than Brave's
  list, and also off by default.

**So the verdict is not even DROP — it is a PREF GAP.** Ziy should lock
`privacy.query_stripping.enabled=true`, `.pbmode=true`,
`strip_on_share.enabled=true` in `mozilla.cfg`/`ziy.js`. Note the
`enabled=false` + `strip_list="…"` trap: with the feature off, the pref list is
dead weight, and the two must move together.

**One real difference from Brave, honestly stated.** Brave's
`kConditionalQueryStringTrackers` strips a param *only when a substring is
absent* (`ck_subscriber_id` unless `/unsubscribe`, `h_sid`, `h_slt` unless
`/email/`, `mkt_tok` unless unsubscribe/emailWebview). Gecko's list is a flat
`THashSet<nsCString>` of param **names** (`PopulateStripList`,
`URLQueryStringStripper.cpp:332-338`), so the conditional rules are not
expressible. Brave's own `query-filter.json` in the recon is 4 include-rules and
Gecko's remote collection is the same flat shape, so this is a nice-to-have, not
parity — and if it ever matters, it is a **JS** delta (the extension can do
conditional stripping in `webRequest.onBeforeRequest`), not a C++ one.

### 5.2 Debounce — Gecko has a different, already-adequate design; the JS route is a real gap

- Gecko's `BounceTrackingProtection` (`toolkit/components/antitracking/bouncetrackingprotection/`)
  addresses the same "unlinkable bouncing" threat but by **tracking the bounce
  chain and purging the tracker's state afterwards** (`BounceTrackingState.cpp`,
  `ClearDataCallback.cpp` → `BounceTrackingProtectionStorage::ClearSiteHost`),
  not by rewriting the URL. It is a *different* mechanism, neither a superset
  nor a subset of Brave's.
- Brave's debounce (rewrite the navigation to the target in `param`, skipping the
  hop) has **no engine equivalent at all** — verified by absence checks for
  `debounce|de_amp|deamp|amphtml` across the extracted tree, with the only hit an
  unrelated comment about test rebuilds
  (`toolkit/components/antitracking/docs/content-classifier/index.md:165`).
- **But it is not a C++ gap by construction:** the extension already requests
  `webRequest`, `webRequestBlocking`, `webNavigation` and
  `host_permissions: <all_urls>` (`extensions/ziy-shields/manifest.json:14-27`),
  and a blocking `webRequest.onBeforeRequest` listener can return
  `{redirectUrl: …}` in Firefox. So it is a **JS layer gap**.

**The JS layer today does not implement it.** Verified: the shields DNR compiler
emits only `block`, `allow` and `upgradeScheme` actions
(`lib/engine/dnr-compile.js:503`, `:329` — the supported actionType set is
declared at `:329`), the only listeners are `webRequest.onBeforeRequest`
(returns `{cancel:true}`), `webNavigation.onCommitted` and tabs lifecycle
(`background/background.js:398-463`), and `lib/filterlist/parser.js:404-411`
records `removeparam`/`redirect`/`rewrite` as ABP **vocabulary with no consumer**
— so `$removeparam` rules in EasyList/EasyPrivacy parse as inert flags and never
fire. **That is the actionable gap for the JS workstream, and it is not mine.**

### 5.3 De-AMP — no engine equivalent, JS-only, and the JS route needs a verified permission

Same shape: Gecko has no AMP detection, no `<link rel=canonical>` redirect, no
HTML-head buffer. Absence verified for `de_amp|deamp|amphtml|StripOnShare` and for
`unwrap|Unwrap|RedirectUnwrap` across the extracted tree (hits were
`SubtleCrypto.unwrapKey` and Rust `Option::unwrap` only), and
`nsHttpChannel.cpp` has no response-body/head interceptor.

The JS route is `webRequest.onHeadersReceived` → `browser.webRequest.filterResponseData()`
for top-level `text/html`, buffer the head, regex `<html amp>` and
`<link rel=canonical>`, return `{redirectUrl: canonical}`. **`filterResponseData` is
real in Firefox's WebExtension API** — read directly from the engine's own schema
`toolkit/components/extensions/schemas/web_request.json:453-464`:

```json
{
  "name": "filterResponseData",
  "permissions": ["webRequestBlocking"],
  "type": "function",
```

so the permission it needs is `webRequestBlocking`, **which the shields manifest
already declares** (`manifest.json:17`). No C++, no new permission.

**One honest caveat for whoever writes it:** the schema declares it under the
`webRequest` namespace in a Gecko-tree schema, so its *runtime* gating should be
re-verified on Gecko 156.0.1 specifically before depending on it. That is a
five-minute check on an already-built engine, not a patch.

### 5.4 Summary of candidate 4

| mechanism | engine side | JS layer today | verdict |
| --- | --- | --- | --- |
| Query-param stripping | **native, remote-list-fed, nav + redirect**, off by default | not implemented | **PREF GAP** — lock 3 prefs, no C++ |
| Debounce | different mechanism (purge, not rewrite) | not implemented | **JS GAP** — `webRequest.onBeforeRequest` + `{redirectUrl}` |
| De-AMP | none | not implemented | **JS GAP** — `filterResponseData` + regex; permission already held |

`replica/recon.md:486-487` had already put all three in the "achievable without
engine changes" bucket; this pass confirms it from the engine's source.

---

## 6. Apply evidence (verbatim)

Run against the pristine 156.0.1 tree extracted fresh at
`/tmp/apply-test/firefox-156.0.1` from the checksum-verified tarball
(`sha512 80a32a79…a24d5b`, verified equal to `replica/deep-fork.md` §6.2 before
extraction). The tree was **never modified** — patches were checked, applied,
reversed, and the file confirmed byte-identical to pristine afterwards
(`sha512 08fc159f…660d4` before and after).

Extracted for this pass: `netwerk/{cookie,dns,protocol/http,base}`,
`toolkit/components/antitracking`, `toolkit/components/{cleardata,extensions}`,
`toolkit/components/places`, `dom/{webidl,storage,quota}`, `docshell`,
`browser/modules`, `modules/libpref`.

```
$ cd /tmp/apply-test/firefox-156.0.1
$ for p in "$REPO"/patches/*.patch; do echo "=== $(basename "$p") ==="; git apply --check -v "$p"; echo "RC=$?"; done
=== 0001-rfp-colorscheme-carveout.patch ===
Checking patch toolkit/components/resistfingerprinting/nsRFPService.cpp...
RC=0
=== 0002-ziy-fingerprinting-option.patch ===
Checking patch toolkit/moz.configure...
Checking patch toolkit/ziy-fingerprinting.configure...
RC=0
=== 0003-webgpu-adapter-strings.patch ===
Checking patch dom/webgpu/Adapter.cpp...
RC=0
=== 0004-webgl-fake-extension.patch ===
Checking patch dom/canvas/ClientWebGLContext.cpp...
RC=0
=== 0005-dns-disable-prefetch-from-https.patch ===
Checking patch netwerk/dns/nsDNSService2.cpp...
RC=0
```

**All five of the numeric-order sequence, all RC=0.**

`0005` in full detail:

```
$ cp netwerk/dns/nsDNSService2.cpp /tmp/ziy-net-author/pristine.cpp
$ git apply patches/0005-dns-disable-prefetch-from-https.patch
apply RC=0
$ git apply --reverse --check patches/0005-dns-disable-prefetch-from-https.patch
RC=0
$ git apply --reverse patches/0005-dns-disable-prefetch-from-https.patch
reverse RC=0
$ cmp netwerk/dns/nsDNSService2.cpp /tmp/ziy-net-author/pristine.cpp
IDENTICAL: gate-off restores pristine byte-for-byte
```

**Gate-off proof (strip the `#ifdef` block from the patched file → pristine):**

```
$ git apply patches/0005-dns-disable-prefetch-from-https.patch && python3 …
GATE-OFF STRIPPED == PRISTINE: True
$ TREE RESTORED CLEAN
$ sha512sum netwerk/dns/nsDNSService2.cpp  →  08fc159f…660d4   (same as pristine)
```

**Gate-on structural check (applied file):**

```
braces: 0   (balanced)
Ziy block braces: 0   (balanced)
Ziy block parens: 0   (balanced)
#ifdef MOZ_ZIY_FINGERPRINTING: 1
#endif  // MOZ_ZIY_FINGERPRINTING: 1
```

Note on the paren-count caveat: the *file-level* paren count is `-1`, and it is
`-1` in the pristine file too (an unpaired `(` inside comment text) — so it is
pre-existing, not introduced. The delta block itself is balanced.

**Not yet done:** `0005` (like `0001`–`0004`) has **not been compiled** and the
resulting engine has not been booted. That is the CI job's job. The specific
compile risk worth flagging for the first CI run is the
`StaticPrefs::network_dns_disablePrefetchFromHTTPS()` accessor resolving through
the already-included `mozilla/StaticPrefs_network.h` — if the generated header
splits DNS prefs differently, the fix is a one-line include, not a redesign.

---

## 7. Verdict table

| # | candidate | verdict | evidence |
| --- | --- | --- | --- |
| 1 | 1PES ephemeral-storage **lifetime** half | **REAL GAP, CAMPAIGN not patch.** Engine's teardown primitive is partition-aware and already exists (`ClearDataService.deleteBySite`); JS layer cannot express it semantically (maps to `deleteByHost`, no partitionKeyPattern; `browsingData` is an optional permission). Smallest real version = 1 new `.sys.mjs` + manifest entry + `moz.build` line, lifecycle keyed off `"browsing-context-discarded"`, precedent `PurgeTrackerService.sys.mjs:211`. **Not authored**: needs a compiled engine to prove, and the durability trigger is the hard part. | §2 |
| 2 | autoShred / forget-me | **APP_EXIT = PREF GAP** (lock `privacy.sanitize.sanitizeOnShutdown` + `clearOnShutdown_v2.*`; note the `PurgeTrackerService` suppression trap). **LAST_TAB_CLOSED = §2's campaign.** No patch. | §3 |
| 3 | more dead prefs in netwerk/ + antitracking | **ONE found and patched (`0005`)** — `network.dns.disablePrefetchFromHTTPS`, registered, zero consumers. One read-but-useless pref (`network.dns.prefetch_via_proxy`) and the missing `privacy.partition.network_state.*` family (dropped: **shell bug, do not patch**) recorded. Everything else ALIVE. | §4 |
| 4 | query-strip / debounce / de-AMP | **NO C++ NEEDED.** Query-strip = a pref gap (Gecko's mechanism is native + remote-list-fed + covers redirects, off by default). Debounce + de-AMP = JS gaps only (permissions already held; `filterResponseData` in schema). | §5 |

**Patches authored this workstream: 1** (`0005`).
**Patches verified applying: 5** (`0001`–`0005`, all RC=0, in numeric order).
**Compiled: 0.**
