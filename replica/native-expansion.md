# native-expansion.md — how much native code Ziy should actually get

**Date:** 2026-10-16 · **Workstream:** design (decision-ready plan, no code)
**The direction being interpreted, verbatim:** *"ok we add more rust and c++ and other too"*
**Read first:** `replica/architecture.md` (stack), `replica/parity.md` +
`diff-summary.md` (what is built), `replica/research-tech.md` (frontier),
`replica/proofs-blocking-strength.md` (the blocking engine's design + honest limits),
`replica/proofs-cpp-privacy.md` + `proofs-cpp-fingerprint.md` + `proofs-cpp-network.md`
(the 5 C++ patches and the negative results), `replica/deep-fork.md` (the no-local-compile policy).

**Method note, stated up front.** §2 and §3 below cite measurements that already
exist in this repo's proof documents. Where this plan needed a number that did
**not** exist, it measured it on this box in this session, and the exact command
and output are recorded in §6. Everything this plan could not measure is labelled
**UNVERIFIED**, including every figure that requires a compiled Gecko build or a
Windows/Android machine. Nothing here was compiled into the engine — that is
`build-gecko.yml`'s job, per `replica/deep-fork.md` §0.

---

## 1. THE HONEST BASELINE

### 1.1 What is JS, what is Node, what is C++, and where each one sits

| layer | language | code | what it is | is it on a hot path? |
|---|---|---|---|---|
| **Blocking engine — compile** | JS | `extensions/ziy-shields/lib/filterlist/parser.js` (19,311 B), `lib/engine/dnr-compile.js` (24 kB) | parses 7 shipped list snapshots, compiles to DNR + a webRequest tier | **startup only** |
| **Blocking engine — static tier** | **the engine, in C++** | `rules/static-ruleset.json`, 3,196,194 B, 28,907 rules | the engine's own `ExtensionDNR` evaluates it | **yes — per request, in the engine** |
| **Blocking engine — residual tier** | JS | `lib/engine/residual-index.js` (5.7 kB), `lib/engine/static-match.js` (24 kB), `lib/engine/blocking.js` (9 kB) | domain-bucketed index + a small ABP→regex matcher, on the `webRequest` path | **yes — per request, in the event page** |
| **Blocking engine — cosmetic** | JS | `lib/engine/cosmetic.js` (6.4 kB) | `:has(` procedural hiding, evaluated in the content script | per page |
| **Blocking engine — counting** | JS | `lib/engine/counter.js`, `static-match.js`'s re-evaluation of the full 28,923-rule static ruleset **for counting only** | the D-7 blocked-item count | **yes — per blocked item** |
| **Sync client** | JS | `extensions/ziy-sync/lib/` (bip39, keyderivation, record, client) | WebCrypto HKDF-SHA512, Ed25519, BIP-39 | per sync |
| **Sync agent (native helper)** | Node | `native/ziy-sync-agent/` (1,866 lines) | the out-of-browser home of chain material; stdio native messaging | per sync — **not per request** |
| **Password vault (native helper)** | Node | `native/ziy-pwd/` (1,111 lines) | PBKDF2-SHA512 600k + AES-256-GCM | **per unlock — deliberately expensive** |
| **Sync server** | Node | `server/src/` + `server/lib/` (861 lines) | blind blob store on `node:sqlite` | per request **to the server** |
| **Engine patches** | C++ | `patches/0001–0005` | RFP carve-out, WebGPU, WebGL, dead pref | **engine internals** |
| **UI, NTP, news, talk, playlist, desktop** | JS | `extensions/ziy-{ntp,news,talk,playlist,desktop}/` | protocol glue and DOM | not hot |

### 1.2 The measured costs, cited

All of these already exist in repo documents; none was re-measured for this plan:

| what | number | source |
|---|---|---|
| JS parse of the 7 shipped list snapshots | 182,616 lines, 5.26 MB of text | measured this session, §6 (the parse is the startup path) |
| Static-tier index build | **191 ms**, once per event page | `resource-budget.md` §5, §6d |
| Static-tier candidate lookup, clean requests | **0.34–9.67 ms, mean 1.10 ms** | `resource-budget.md` §5 |
| Static-tier candidate lookup, tracker requests | **1–8 ms**, 23–25 of 28,923 candidates | `resource-budget.md` §5 |
| Residual tier per request | **0.147 ms** (indexed) vs **210.28 ms** (linear scan, 86,698 rules) | `proofs-shields.md` §5.2, §7.5 |
| Residual index build, 86,698 rules | **23.6 ms**; 203,510 rules → **35.3 ms** | measured this session, §6 |
| Static ruleset shipped in the xpi | 3,196,194 B (3.05 MiB), ~373 kB gzipped | `proofs-shields.md` §5 |
| Raw list snapshots shipped in the same xpi | **5.26 MB, uncompressed** (entries: 2,153,175 + 1,509,098 + 900,522 + 473,295 + 121,930 + 72,786 + 34,450) | measured this session, §6 — the xpi is 8.43 MiB uncompressed total |
| Cold start to the NTP's first paint | **5.62 s** | `resource-budget.md` §3 |
| Server `putBlob` (the sync server's write path) | **144 ms/blob**, node:sqlite with the stock delete-journal/`synchronous=FULL` | measured this session, §6 |
| Server `getBlobs(500)` | **1.95 ms/call**, 500 rows | measured this session, §6 |
| Server Ed25519 verify, node:crypto | **141 µs/verify**; a 500-record `MAX_RECORDS_PER_PUT` batch = **70.6 ms** of pure verification | measured this session, §6 |
| Native-messaging stdio round-trip, the repo's own protocol | **0.062 ms** | measured this session, §6 |

### 1.3 Plainly: where JS is genuinely fine, and where it is a real cost

**JS is genuinely fine — leave it alone:**

* **The entire UI surface.** The NTP, the Shields panel, the playlist panel, the
  Talk chips, the news sidebar, onboarding, the options pages. This is DOM and
  protocol glue; it runs on user-gesture cadence, not request cadence. No amount
  of native rewrite makes a click handler faster than V8 makes it.
* **Sync's crypto, at its actual call frequency.** One chain derive, one Ed25519
  keygen, one sign per record, one verify per pulled record — per *sync*, not per
  request. WebCrypto's HKDF and Ed25519 are OpenSSL underneath; a Rust rewrite of
  them changes nothing a user can measure.
* **The password vault's crypto.** PBKDF2 at 600k rounds *wants* to be slow; the
  cost is the feature. A native Argon2id would be a real upgrade but it is a KDF
  choice, not a hot-path fix (§2e).
* **The sync server's request handling.** It is a single-tenant blind store with
  no concurrent load to speak of. Its problem is durability posture, not
  language (§4a).
* **The blocking engine's compile path.** One-time, at event-page install.

**JS is a real cost — and this is the whole case for native code:**

1. **The per-request matching path in the event page.** 0.34–9.67 ms per clean
   request (mean 1.10 ms) plus 0.147 ms for the residual is the price of *our*
   code running between the engine's network stack and the request. It is not
   broken — it is measured, indexed, and fast enough that `verify.sh` and the
   live proofs pass — but it is the only place in the product where **our** code
   runs millions of times per session inside a latency-critical path.
2. **The 30,000-rule static-tier ceiling.** `GUARANTEED_MINIMUM_STATIC_RULES`
   is 30,000 and an over-quota ruleset is dropped *whole*, so the ceiling leaves
   ~86,698 rules in the JS residual tier. This is the one place where Brave is
   honestly stronger than Ziy, and `proofs-blocking-strength.md` §6 says so
   explicitly: *"Brave's ceiling is one thing Ziy does not match, and no amount
   of list work fixes it — it would take an engine-side adblock engine."*
4. **The blind server's write path** — 144 ms/blob is a durability posture
   (`synchronous=FULL` with a delete journal), fixable in SQL, not in language:
   `WAL + synchronous=NORMAL` measures **0.13 ms/blob** for the identical inserts
   (§6.4). This is the plan's clearest example of a cost that *looks* like a
   language problem and is not.
5. **The xpi's 5.26 MB of raw list snapshots.** This is not a speed cost, it is
   a ship cost: the snapshots ship only so the offline first-run fallback can
   parse them. §2a removes the need for them entirely.

---

## 2. THE RUST CANDIDATES

Each is scored on the same five axes: **replaces**, **win**, **cost**, **risk**,
**verdict**.

### 2a. A native blocking engine (adblock-rust) — **RECOMMEND. This is the one.**

This is the co-owner's "peak blocking" ask made concrete, and it is the only Rust
candidate where the win is not a factor but a **capability**.

**What it replaces.** Two things at once. It replaces the JS residual tier's
matcher with Brave's own engine, and — decisively — it removes the 30,000-rule
DNR quota as the shape of our coverage. `proofs-blocking-strength.md` §6 already
concedes the ceiling cannot be fixed by list work: an engine-side adblock engine
is the only fix. adblock-rust *is* that engine, MPL-2.0, the exact one Brave
ships (`ad_block_service.cc:176-178` constructs `AdBlockEngine(true)`).

**Measured against our own shipped data** (all figures measured this session on
this box, §6 — 7 shipped snapshots, 5,265,256 B of list text, `adblock` 0.13.3):

| | adblock-rust | Ziy's JS today |
|---|---|---|
| parse + build over the full 7 lists | **201 ms** (native, in-process) | 657 ms of `parseList` for the same 7 files (375.8 + 168.8 + 79.3 + 23.2 + 3.0 + 3.4 + 3.5) |
| serialized engine, shipping config (`debug=false`) | **7,864,405 B (7.50 MiB)** | n/a |
| engine reload from the serialized form | **40 ms** | n/a |
| per-request match, blocking request | **0.0032 ms** | 0.147 ms (residual, indexed) + 0.34–9.67 ms (static) |
| per-request match, clean request | **0.0050 ms** | 1.10 ms mean |
| rule ceiling | **none** (the whole 5.26 MB table, no tiering) | **30,000** static + 203,510 JS residual |

So the native engine is **~30–200× faster per request than the tier it replaces
on the worst case, and ~3× on the best case** — but the speed is not the point.
The point is the **7.5 MiB serialized engine**, which is a single binary artifact
that holds *every* rule, including the ~86,698 the JS residual carries today. The
5.26 MB of raw snapshots stop shipping in the xpi (replaced by 7.5 MiB of
precompiled engine, or less if compressed) and the 30,000-rule cliff disappears.

**Three deliverables were measured, not assumed** — the API is real, the crate
fetches from crates.io on this box, and it compiles:

* **Native library, in-process in a native messaging host.** The repo *already
  proves the bridge*: `native/ziy-sync-agent` and `native/ziy-pwd` both speak
  MDN's UInt32LE-framed stdio protocol (`lib/native-protocol.js`, 110 lines),
  both are installed by `tools/install-ziy-sync-native.js` /
  `install-ziy-pwd-native.js`, and both are exercised end-to-end over the real
  pipe (`proofs-sync.md` §5 two-profile e2e). A new host that loads adblock-rust
  and answers `{url, initiator, type}` → verdict is the same shape with a
  different op list.
* **WASM, loaded by the extension.** Built and measured (§6): `cargo build
  --target wasm32-unknown-unknown` → **2,914,918 B (2.78 MiB) module**, build
  time **1m38s** on this box. Per-request cost measured through a C-ABI shim in
  node (a stand-in for the event page's own JS↔wasm boundary): **8.88 µs
  (block) / 9.37 µs (clean)** — which is *worse than the JS path today*
  (0.147 ms = 147 µs for the residual, so ~9 µs is competitive there, but the
  static tier's mean is 1,100 µs, so this looks like a win only against the
  residual).
* **Native host over stdio.** The bridge costs **0.062 ms per round-trip**
  (measured, §6, with the repo's own framing). That is *less* than the 1.10 ms
  mean static-tier lookup it replaces, and it carries the whole engine.

**The honest trade-off between the two — the point the brief asked for:**

| | WASM in the extension process | native messaging host |
|---|---|---|
| process | the event page — no new process, no bridge | a new child process per profile |
| bridge cost | JS↔wasm boundary per call | **0.062 ms** per call (measured) |
| rule-matching speed | 8.88–9.37 µs/req (measured) | 3.2–5.0 µs/req (measured, the native binary) |
| JS API bindings | **none for the network.** The extension has no `webRequest` from wasm; every request still crosses into JS and back, and DNR is still the engine's, not ours | same constraint — the verdict is *answered*, the block is still issued by the extension via `webRequestBlocking` |
| engine reload | instantiated in-process, ~0 extra | host process starts in ms, deserializes in **40 ms** |
| engine size in the xpi | 2.78 MiB module **+ 7.5 MiB serialized engine** = 10.3 MiB | 7.5 MiB serialized engine beside the host binary |
| failure mode | wasm trap kills the event page | host crash is a dead port — the repo's sync agent already handles this (`onDisconnect` → `port = null`) |

**The verdict on the two routes:** the WASM route's decisive disadvantage is not
speed — 9 µs is fine — it is that **WASM carries no JS API bindings for the
network**, exactly as the brief states, so it cannot see `onBeforeRequest`. The
wasm module would only ever *evaluate a URL we hand it*, which means our
`webRequest` listener still runs in JS, still crosses the boundary per request,
and still pays for a URL-parse on the way in. The native host has the identical
API constraint — **neither route gives the engine's request stream to Rust** —
but the host's advantage is that the process boundary is one we already own,
already install, already test end-to-end, and already handle disconnects for.

**So the recommended shape is the native host, with a precise reason:** it is the
route where the bridge is already proven end-to-end in this repo, where the
0.062 ms cost is *below* the 1.10 ms mean it replaces, and where the host binary
can be swapped for a Rust binary rather than a Node process without changing a
line of `lib/native-protocol.js`. WASM is **REJECTED for now** — not because it
is slow, but because it ships a 2.78 MiB module *and* a 7.5 MiB engine to get
the same per-request speed as the host, while still needing the JS
`webRequest` listener in front of it. If a future measurement shows the host's
process-start cost dominating (many profile launches), WASM becomes the
fallback, and the plan should be re-evaluated then — **UNVERIFIED until then.**

**Risk, stated plainly.** The engine has no JS bindings for the network, so this
replaces *matching*, not *seeing*. The `onBeforeRequest` listener stays JS. The
win is: (a) every rule, no ceiling; (b) 3–5 µs instead of 0.34–9.67 ms; (c) the
DNR 30,000-rule cliff and its whole tiering/salience machinery become
unnecessary; (d) the 5.26 MB of raw snapshots stop shipping. It does **not**
remove the extension from the request path, and any plan that claims it does is
wrong.

**Cost.** A `cargo` build of a small host crate pulling `adblock` 0.13.3:
13 s of `cargo fetch` + ~100 s of `cargo build --release` (measured, §6). A Rust
build is **CI-cheap** (§5). The 5 patches do not need it; this crate is
independent.

### 2b. The sync server in Rust (axum + rusqlite) — **REJECT.**

**Measured facts that decide it:**

* Server write path: **144 ms/blob** — and the identical inserts in bare
  `node:sqlite` drop to **0.13 ms/insert** with `journal_mode=WAL` +
  `synchronous=NORMAL`, and to **0.16 ms** even with `synchronous=OFF`
  (§6.4). The cost is `fsync`, not Node.
* Server Ed25519 verify: **141 µs** per record. A max 500-record PUT = **70.6 ms**.
* The Node server is **861 lines total** and its whole model is a KV store with a
  `updated_at` monotonicity check (`server/src/store.js`, 374 lines).
* It is a **single-tenant blind store**. There is no measured concurrency
  requirement, no QPS target, and no user-visible latency budget in any
  document. Its 16 tests pass in 53 s.

**Why rejected, in one line each:**

1. **The win is below measurement noise — and the real win is a pragma.** 144
   ms/blob is `fsync`; `WAL + synchronous=NORMAL` makes it **0.13 ms** in the
   *same language*. There is no measurement left for a Rust rewrite to take.
2. **It duplicates an engine API.** Rewriting `BlindStore` + the challenge/
   session/tombstone lifecycle in Rusqlite is a line-by-line reimplementation of
   code that is already correct, tested by 16 passing server tests
   (`server.test.mjs`, 53 s), and proven by a two-profile e2e.
3. **The remaining 70.6 ms of Ed25519 verify per max batch has no target.** It is
   a per-*sync* burst, not a per-request cost, and no document publishes a QPS or
   latency budget to beat.

**The one thing that would reopen this:** a published multi-user deployment
target with a measured QPS the Node server cannot hold **after** the pragma fix.
That target does not exist in any repo document. **UNVERIFIED as a future
requirement.**

### 2c. A DNS-over-HTTPS resolver in Rust — **REJECT.**

The privacy path's DNS is already handled, and the honest reading of the shell
is that DoH is deliberately **off**:

* `shell/mozilla.cfg:109` and `ziy.js:270` lock `network.trr.mode = 5`
  (`TRR_DISABLED`), with the comment *"DNS over HTTPS off by default (Ziy sync
  brings its own secure transport)."*
* `network.dns.disablePrefetch` and `disablePrefetchFromHTTPS` are both locked,
  and `0005-dns-disable-prefetch-from-https.patch` exists precisely because the
  latter's pref was dead in the engine — i.e. the *shipped* posture is **no
  speculative DNS at all**.

So the product's current privacy position is: **no DoH, no prefetch, no ECH**
(`mozilla.cfg:108`). Building a Rust DoH resolver would (a) implement a
capability the shell deliberately locks off, (b) add a persistent resolver
process with its own trust model to replace the OS resolver, and (c) require a
policy decision that belongs to the co-owner, not to an architecture plan.
**REJECTED because it contradicts a locked product decision.** If the co-owner
flips `trr.mode`, the honest first move is Gecko's own native TRR with a
provider URL — not a Rust reimplementation.

### 2d. Other genuinely hot things in the profile — **one candidate, REJECTED.**

I went looking for a fourth Rust candidate in the hot paths and found exactly
one, which I then rejected:

* **`ziy-shields`'s cosmetic tier in a Rust content matcher.** Cosmetic rules
  are per-page, evaluated after document parse; the `:has(` procedural half is
  already ~167 lines of JS and the tier's per-page cadence is not a latency
  path. adblock-rust *does* ship cosmetic filtering, so once 2a lands this
  capability comes along for free and needs no separate decision. **No separate
  Rust candidate.**
* **The BIP-39 wordlist derivation (2,271 lines, `bip39-wordlist.js`).** Runs
  once per chain create/join. Not hot. **REJECTED — below measurement noise.**
* **The NTP's feed aggregation** (`ziy-news/lib/feed/`, 1,904 lines). Alarm-driven
  every 30 min, cache-honouring, `If-None-Match`/`If-Modified-Since` so an
  unchanged feed is a 304 (`resource-budget.md` §6b). **REJECTED — cadence is
  30 minutes.**
* **`ziy-playlist`'s `classify.js`** (325 lines) — per media event during
  playback. This is the closest thing to a genuine hot path outside shields, but
  a play/pause-cadence classifier in JS is not a measurable cost and has no
  native analogue. **REJECTED.**

### 2e. Summary of the Rust candidates

| candidate | verdict | the deciding measurement |
|---|---|---|
| **a. Native blocking engine (adblock-rust)** | **RECOMMEND** | 0.0032–0.0050 ms/req vs 0.34–9.67 ms; 7.5 MiB engine vs a 30,000-rule ceiling; crate builds in ~100 s and fetches on this box |
| b. Sync server in Rust | REJECT | 144 ms/blob is fsync posture, not language; 70.6 ms verify per max batch with no QPS target to beat; duplicates a tested API |
| c. DoH resolver in Rust | REJECT | contradicts `network.trr.mode=5` locked in the shell |
| d. Everything else on a hot path | REJECT | nothing else in the profile has request cadence |

---

## 3. THE C++ CANDIDATES

The state on record, before adding anything: **5 patches exist, none compiled.**
`0001` (RFP colour-scheme carve-out), `0002` (the `--enable-ziy-fingerprinting`
gate), `0003` (WebGPU adapter strings), `0004` (fake WebGL extension), `0005`
(honour `network.dns.disablePrefetchFromHTTPS`). All five are apply-verified
forward and reverse with byte-identical gate-off; **none has been through a
compiler**, and `.github/workflows/build-gecko.yml` is what changes that.

The negative results that shape what is left:

* `proofs-cpp-privacy.md` §3: **zero patches** in privacy/network/storage — 11
  of the target APIs don't exist in Gecko 156.0.1, the rest are correctly
  pref-gated. The workstream's highest-value find was a **shell bug** (nine dead
  pref names), fixable with one-line renames in `mozilla.cfg`, not a patch.
* `proofs-cpp-fingerprint.md` §6: **16 of 19** farbling targets **DROPPED**
  because RFP already covers them. Two written (WebGPU strings, WebGL extension
  list).
* `proofs-cpp-fingerprint.md` §4: **per-site farbling entropy — NOT WRITTEN and
  correctly so.** Gecko's RFP key is *session*-scoped
  (`nsRFPService.cpp:1324 GetBrowsingSessionKey()`), reset daily, parent-process
  only. Brave's is a per-site persistent `farbling_token` in a content setting.
  A Gecko per-site token needs two things that do not exist: a pref-writable
  per-site key and a seed for the RFP PRNG. *"A patch that just XOR'd a constant
  into the canvas key would be fake farbling."* **This is already rejected as
  fake; this plan does not reopen it.**

### The honest remaining set, evaluated

**Candidate 1 — the 1PES ephemeral-storage lifetime (bug 1628313).**
*Worth a campaign: AFTER shipping, not before. And not as a C++ patch.*

The gap is real and engine-documented in the engine's own words:
`StoragePrincipalHelper.h:190-195` — *"We are planning to clear the partitioned
site-data as soon as the page is reloaded or dismissed (not done yet - bug
1628313)."* The **partitioning** half is already active in Ziy
(`network.cookie.cookieBehavior=5`, partitioned principal at
`StoragePrincipalHelper.h:17-45`). What's missing is the **lifetime trigger**.

The decisive finding, already on record (`proofs-cpp-network.md` §2.2): the
engine already has the teardown primitive —
`nsIClearDataService.deleteDataFromSite()` is **partition-key-aware** and covers
cookies + sessionStorage + quota + ServiceWorkers, with `ClearDataService.sys.mjs:196-213`
building the `partitionKeyPattern` in the engine's own words. The smallest real
version is:

1. a per-eTLD+1 top-level tab reference count in the parent process (the
   precedent exists: `BounceTrackingState`'s `sBounceTrackingStates`,
   `BounceTrackingState.cpp:36`);
2. a hook on top-level BC teardown (`"browsing-context-discarded"`,
   `BrowsingContext.cpp:1159-1160`, already consumed by the adjacent feature);
3. a `.sys.mjs` consumer that calls `Services.clearData.deleteDataFromSite()`
   when the count hits zero — the engine's own precedent for that shape is
   `PurgeTrackerService.sys.mjs:211`.

`proofs-cpp-network.md` §2.4 sizes that at **3–4 files, none of them engine-source
surgery**, and §2.5 gives three reasons it was not authored: (i) its evidence bar
is a boot-and-assert that needs a compiled engine; (ii) the reference-count
dedup is the hard part and a naive count shreds live data
(BFCache/`why=="replace"` cases); (iii) **the patch format is the wrong
vehicle** — it belongs in `tools/` as omni/JS, not in `patches/`.

**Verdict: fund it as a follow-on JS/`.sys.mjs` workstream, AFTER the engine has
been compiled and booted once.** Writing it before the first compiled build
would be authoring a data-destroying component whose correctness is
unanobservable without a build — the exact failure mode the plan rules out.

**Candidate 2 — per-site farbling entropy.** Already rejected (above). The
dependable half — a persistent per-site token — would make the fingerprint
*more* stable across restarts than Gecko's session key already is, which is
strictly worse. **Do not revisit without a new engine-side key story.**

**Candidate 3 — the dead-pref class.** Exhausted: `proofs-cpp-privacy.md` §2.1
and §2.5 found **nine** dead shell pref names (all shell bugs, one-line renames)
and zero engine-side dead prefs of the 0001 class remaining. `0005` was the last
one. **No candidate left in this class.**

**Candidate 4 — a second look for new engine gaps.** Two real, small, gated
patches landed in this session's neighbourhood (WebGPU strings, WebGL
extension). The same audit applied to another area (e.g. WebRTC's
`RTCStatsReport` identity fields, or `navigator.hardwareConcurrency`'s tiering)
*might* yield another. But that is speculation until someone reads the source,
and this plan does not propose a patch without grounding. **No candidate
proposed.** The honest statement: **the C++ frontier for Ziy is close to
exhausted, because Gecko's RFP layer already covers 16 of the 19 Brave farbling
targets by design.**

### 3.1 Verdict on C++

| candidate | verdict | when |
|---|---|---|
| 1PES ephemeral-storage lifetime | **WORTH DOING — as a JS/`.sys.mjs` component, not a patch** | **AFTER** the engine compiles and boots once |
| per-site farbling entropy | REJECTED — already rejected as fake; no key story exists | never, without a new engine primitive |
| another dead pref | REJECTED — the class is exhausted (0 left) | n/a |
| a new engine gap | none grounded | n/a |

---

## 4. THE "AND OTHER TOO"

**Go for the sync server? No.** See §2b — the win is below noise, and the bridge
cost is a rewrite of a tested API.

**Zig for something? No.** The temptation is a small native helper in Zig
because it builds fast and has no runtime. But the shape of this project is that
*native code exists where extensions cannot reach* — the vault, the chain
material. Both are Node, both are already installed by `tools/install-*-native.js`,
both are proven over the real pipe, and neither is on a hot path. A Zig rewrite
of either would be language-for-its-own-sake: the same argument as Rust-for-Go,
applied to a box with no measurable problem. **The fake-feature rule applies to
architecture too, and a second native language with no measured win is exactly
that failure in architectural clothing.**

**One honest candidate for "other": C for the native messaging host.** The
native host that 2a needs does not have to be Rust. A C host linking adblock-rust
via its FFI crate (`adblock-rust-ffi`) would work, and `rustc`/`cargo`/`cbindgen`
are already on this box (`AI-BRIEF.md` §2). But a Rust host is strictly
**easier** — no header management, no unsafe FFI at the boundary, `serde_json`
instead of hand-rolled framing — and the bridge protocol is already JavaScript.
**Verdict: Rust for the host, not C, not Zig, not Go.** One new language, one
new module, one measurable win. Everything else is the anti-goal.

**So the honest answer to "and other too" is: Rust for one module, and nothing
else.** Not because native code is bad — because this project's rule is real work
only, and there is exactly one place where native code is real work here.

---

## 5. THE BUILD REALITY

**The constraint, precisely.** `replica/deep-fork.md` §0 is a hard rule: this
box **never** compiles Gecko. `AI-BRIEF.md` §5 rule 10 records the cost model:
the repo is **private** (`github.com/Ziyzennix/ziy`), so `ubuntu-latest` is
**2 CPU / 8 GB**, metered at **2,000 min/month**, and a cold Gecko build is
**12–28 h ≈ the entire monthly allowance** (`HANDOFF.md` §2). `build-gecko.yml`
is dispatch-only (manual or tag) for exactly that reason.

**What is cheap and what is not:**

| work | build cost | where it runs | metered minutes |
|---|---|---|---|
| **A Rust crate (adblock-rust host or wasm)** | `cargo fetch` 13 s + `cargo build --release` ~100 s (measured) | **locally, and CI** | ~2–5 min/run |
| **A wasm target build** | 1m38s (measured) | **locally, and CI** | ~2–5 min/run |
| **Node tests / verify.sh** | seconds–minutes | local + CI | ~2 min |
| **A C++ patch's compile** | requires a Gecko build: **8–16 h on 2 CPU/8 GB** (`deep-fork.md` §6.7 measured on the private-repo spec), or 12–28 h cold | **CI only, dispatch-only** | **the entire monthly allowance, once** |
| Authoring + `git apply --check` a C++ patch | seconds | local | 0 |

**The asymmetry is the whole plan.** Rust in *our own* code is a 100-second
local build that CI runs in minutes. C++ in the *engine* is a half-day job that
eats the month's minutes and needs a dispatch decision from the co-owner. So:

* **Every Rust candidate is cheap to build.**
* **Every C++ patch is expensive to build** — and the patch set already has 5
  authored, unverified patches waiting for the first compile.
* **The 1PES component is neither**: it is JS in `tools/`, cheap to author,
  but its *proof* needs a compiled engine — so it is cheap to write and expensive
  to verify, which is exactly why it waits.

**The consequence for sequencing:** do not add a 6th C++ patch before the first
compile. Five unverified patches in one batch all fail together if any one
breaks the build, so each new patch multiplies the cost of the one expensive
verification without making it cheaper.

---

## 6. THE MEASURED NUMBERS (what was measured in this session, and how)

Every figure in §2 and §1.2 marked "measured this session". All on this box
(i5-4590, 4 cores, ~4 GB available, Node v26.10.0, rustc/cargo 1.90.0 from
`~/.cargo`). Reproduce commands in §6.5.

### 6.1 The native engine, against Ziy's own shipped lists

Input: the 7 shipped snapshots in
`extensions/ziy-shields/lib/filterlist/snapshots/`, concatenated — **5,265,256
bytes**, the same data the extension's `parser.js` parses at startup.

```
$ cargo build --release                        # adblock 0.13.3, default-features=false
$ ./target/release/abtest
(list bytes 5265256)
ENGINE BUILD (debug=false, parse+engine): 201.3 ms
SERIALIZED ENGINE (debug=false): 7864405 bytes (7.50 MiB)
NATIVE MATCH BLOCK: 200000 in 648.8 ms = 0.0032 ms/req (200000 hits)
NATIVE MATCH CLEAN: 200000 in 1009.6 ms = 0.0050 ms/req (0 hits)
DESERIALIZE PRECOMPILED: 40.0 ms
```

Sanity (the engine really matches our tracker set):
`https://www.google-analytics.com/analytics.js` → `should_block=true`;
`https://pageads2.googlesyndication.com/bgz/ads?...` → `true`;
`https://cdn.example.com/app.js` → `false`. **The crate, its API and its
correctness are verified, not assumed.** Crates.io reachable from this box
(`https://static.crates.io/crates/adblock/adblock-0.13.3.crate` → HTTP 200).

Note on the parse comparison: `adblock`'s own "build" number above (201 ms) is
engine-construction only; the JS equivalent measured below (657 ms) is the
extension's full `parseList` over the same 7 files, which includes its own rule
objects. They are not perfectly like-for-like — the JS number includes more work
— which makes the ~3× comparison **conservative**, i.e. it understates the native
advantage.

### 6.2 The JS baseline for the same work

```
$ node /tmp/js-full-parse.cjs      # the extension's own lib/filterlist/parser.js
easylist.txt:             375.8 ms  rules=81892  network=57233
easyprivacy.txt:          168.8 ms  rules=56314  network=56278
fanboy-cookiemonster.txt:  79.3 ms  rules=25296  network=2110
uabo-filters.txt:          23.2 ms  rules=6109   network=1775
urlhaus.txt:                3.0 ms  rules=1781   network=1781
antiadblock-warning-removal.txt: 3.4 ms rules=2975 network=2531
brave-unbreak.txt:          3.5 ms  rules=894    network=440
TOTAL: 657.0 ms
```

And the residual index, the JS matcher's own data structure:

```
$ node /tmp/residual-cost.cjs
buildIndex over 86698 rules:  23.6 ms   candidates() x2000 = 0.0011 ms/req
buildIndex over 203510 rules: 35.3 ms   candidates() x2000 = 0.0027 ms/req
```

### 6.3 The WASM option, measured

```
$ cargo build --release --target wasm32-unknown-unknown
# (ABI shim: ziy_alloc/ziy_free/ziy_build/ziy_match, one i32 result)
module size: 2914918 bytes (2.78 MiB); build time on this box: 1m38s

$ node /tmp/wasm-bench.mjs
WASM BUILD (JS-measured, read+parse+build): 375.1 ms
WASM serialized engine size: 13487837 bytes
WASM MATCH tracker: 100000 reqs in 887.7 ms = 8.88 us/req
WASM MATCH clean:  100000 reqs in 936.6 ms = 9.37 us/req
```

### 6.4 The server and the bridge, measured

```
$ node /tmp/store-cost.mjs                 # server/src/store.js, node:sqlite
putBlob x500:    72029.7 ms = 144.059 ms/blob
getBlobs(500):   1.95 ms/call

$ node /tmp/server-crypto-cost2.mjs        # server's own verifyEd25519
Ed25519 verify node:crypto: 50000 in 7061.0 ms = 141.2 us/verify
a 500-record PUT = 70.61 ms of verify

$ node /tmp/measure-bridge.mjs             # native/ziy-sync-agent/lib/native-protocol.js
stdio round-trips: 2000
total: 124.2 ms
per round-trip: 0.062 ms
```

**A note on the 144 ms/blob, so it is not misread — it is the most important
measurement in this plan.** It is *fsync*-bound, not CPU-bound and not
language-bound. The identical 500 inserts in bare `node:sqlite`:

```
default (delete journal, sync=FULL)   500 inserts: 76200 ms = 152.40 ms/insert
WAL + synchronous=NORMAL              500 inserts:    66 ms =   0.13 ms/insert
WAL + synchronous=OFF                 500 inserts:    21 ms =   0.04 ms/insert
delete journal + synchronous=OFF      500 inserts:    78 ms =   0.16 ms/insert
```

**A one-line pragma is worth 1,100×. A Rust rewrite is worth nothing here.** The
2,000-minute monthly allowance buys a Rust server that is exactly as slow as the
Node one, because the time is in `fsync`. The blind store's posture (an
acknowledged record must survive a crash) is deliberate; if it is changed it
should be changed in that pragma, with the durability trade-off written down —
not in a rewrite. **[VERIFIED this session, §6.4.]**

### 6.5 Reproduce

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd /tmp/abtest && cargo build --release            # adblock 0.13.3
cargo build --release --target wasm32-unknown-unknown
node /tmp/js-full-parse.cjs        # JS parse of the 7 shipped snapshots
node /tmp/residual-cost.cjs        # the residual index build + lookup
node /tmp/store-cost.mjs           # the sync server's write/read path
node /tmp/server-crypto-cost2.mjs  # the server's Ed25519 verify
node /tmp/measure-bridge.mjs       # the native-messaging stdio bridge
```

### 6.6 What is UNVERIFIED in this plan

* **Every number that requires a compiled Gecko build.** All 5 C++ patches are
  apply-verified, none compiled; the 1PES component is designed, not written.
* **Every number that requires a running browser.** No per-request figure here
  was taken from a live Ziy session with a native host attached — the
  measurements are (a) the repo's own documented in-browser figures, cited by
  name, and (b) out-of-band harnesses that use the same input data.
* **Windows and Android.** Nothing in this plan has been run on either. A native
  host on Windows needs a different manifest path
  (`architecture.md` §0.1: *"Windows native-messaging manifest path: low —
  unverified"*) and ships as a Windows binary — **UNVERIFIED**.
* **adblock-rust's exact per-rule behaviour parity with our DNR tiering** —
  the engine was measured for speed and correctness on a sample, not diffed
  rule-by-rule against `dnr-compile.js`'s output. That is the first deliverable's
  job, not this plan's.

---

## 7. THE RECOMMENDED SEQUENCING

Ordered, each with the exact first deliverable and its gate. Blunt summary at
the end, because the co-owner asked for blunt.

### 7.1 — BEFORE the Linux/Windows packaging ships

**T1. The native blocking host, in Rust.** *First deliverable:* a single new
crate `native/ziy-blocks` that (i) links `adblock` 0.13.3, (ii) loads a
**precompiled serialized engine** built at package-build time by a
`tools/`-side generator from the 7 snapshots, (iii) speaks the *same* MDN
UInt32LE stdio protocol as `ziy-sync-agent`/`ziy-pwd` (`lib/native-protocol.js`,
unchanged), (iv) answers one op — `{op:'verdict', url, initiator, type}` → a
verdict in Ziy's existing precedence vocabulary — and (v) installs via the same
`tools/install-ziy-sync-native.js` shape.

**Gate to close before this is called done:** a node test that boots the host
over the real pipe and asserts a verdict for a real tracker URL from the shipped
set, and a benchmark that records the per-request number on this box next to the
current 0.34–9.67 ms / 1.10 ms / 0.147 ms figures. **Nothing about the
`webRequest` listener changes in T1** — the host only *answers*; the extension
still blocks. That is the honest increment.

**STATUS (2026-10-16) — DONE.** `native/ziy-blocks` is in the tree: the host,
the generator, the JS protocol side, the install script, a 13-test gate that
boots the real binary over the real pipe, and the benchmark. Measured in this
pass, same box: engine build **214 ms** over the same 7 snapshots, serialized
engine **7,864,005 bytes (7.50 MiB)**, host load ~50 ms, and **0.0574
ms/request end-to-end over the pipe** (1000 block + 1000 clean) — read beside
the §6.2/§6.4 tiers (1.10 ms mean static, 0.147 ms indexed). Two deviations,
recorded: (a) §6.1's `default-features=false` is not shippable as written —
`Request::new` panics without the embedded PSL resolver
(`url_parser/mod.rs:104-106`), so the crate pins **default features** and the
engine size differs by 400 bytes from §6.1's figure; (b) with debug info off
(the 7.50 MiB choice), verdicts carry no rule text — `filter`/`exception` are
reserved and null by design. Evidence: `replica/proofs-native-blocks.md`.

**Why first and why pre-packaging:** it is the only candidate with a real win, it
is a ~100-second local build, it costs no engine compile, and it removes the
one place Brave is measurably stronger than Ziy (the 30,000-rule ceiling,
`proofs-blocking-strength.md` §6). Packaging 2.78 MiB *or* 10.3 MiB more is also
a decision best made before the tarball exists (`packaging/linux/` has never
produced an artifact — `HANDOFF.md` §4.1).

**T2. The shell dead-pref renames.** *First deliverable:* the nine one-line
renames already enumerated and cited in `proofs-cpp-privacy.md` §2.1 /
§2.5 (`dom.serial.enabled`→`dom.webserial.enabled`, `dom.filesystem.enabled`→
`dom.fs.enabled`, `webgl.renderer-string-override`→`webgl.override-unmasked-renderer`,
`network.cookie.lifetimePolicy` deleted, the three `privacy.partition.network_state.*`
names, etc.), plus `spoof_english`→`2` and `device.sensors.enabled` added.

**Why here:** this is a **shell bug whose fix is currently absent** — five
protections the product tells users are active are no-ops. It is ~10 lines in
`shell/mozilla.cfg` + `ziy.js`, zero native code, and it must land *before*
packaging because it changes what the shipped hardening set actually does. It is
listed here because it is the cheapest real correctness fix on the board and it
belongs in the same pre-ship pass.

**STATUS (2026-10-16) — landed, including the last line.** `shell/mozilla.cfg`
locks the real engine names (`webgl.override-unmasked-renderer`,
`dom.webserial.enabled`, `dom.fs.enabled` — the old names survive only in the
comments that record why they were wrong), `network.cookie.lifetimePolicy` is
removed with a note, and `device.sensors.enabled` is present. The one item
still missing at the start of this pass — `privacy.spoof_english` sitting at
its `0` prompt default, which silently disables JSLocale spoofing in RFP mode
(`replica/proofs-cpp-fingerprint.md` §5b) — is now locked to `2` in
`mozilla.cfg` and mirrored as a default in `ziy.js` + `ziy-hardening.js`.
`preflight-prefs.py`: **97 locks, 172 declared, layers agree**.

**T3. One Gecko compile, with the 5 patches.** *First deliverable:* dispatch
`.github/workflows/build-gecko.yml` once, on a tag, and record the outcome —
including which of the 5 patches fails the build, if any. **The expected result
is a real build artifact plus possibly a lint warning**; `patches/README.md` says
so and this plan does not promise otherwise.

**Why before packaging:** 5 authored-unverified patches in the tree is a
liability. Compiling them is a half-day job that eats the metered allowance, so
it is a **one-time, dispatch-only, co-owner-approved** action. If it succeeds, the
engine patches can ship. If it fails, the failure is information that must
precede any packaging claim.

**T1b. The sync server's durability pragma.** *First deliverable:* one `pragma`
pair in `server/src/store.js`'s constructor — `journal_mode=WAL` and
`synchronous=NORMAL` — plus a test that records the new write-path number next
to the current 144 ms/blob, and a one-paragraph statement of the durability
trade-off (WAL+NORMAL can lose the last commits on an OS/power crash; it cannot
lose a committed transaction to a process crash).

**Why here:** it is the highest value-per-line in this plan — **1,100× on the
write path** (§6.4) — it is three lines, it is pre-packaging because a packaged
product should not ship a store 1,000× slower than the same language allows, and
it costs no native code whatsoever. It belongs in the plan precisely because it
is the measurement that kills the "rewrite the server in Rust" candidate: the
win was never in the language.

**STATUS (2026-10-16) — DONE.** The pragma pair sits in `server/src/store.js`'s
constructor with the durability trade-off written down beside it, and
`server/test/durability.test.mjs` reads both pragmas back through the real
store connection and prints the write path: **0.186–0.389 ms/blob** across
runs (100 `putBlob` calls; checkpoint placement moves the figure) against the
144.059 ms/blob baseline — the server suite went from fsync-bound (47.1 s
without the pragma, with the new test failing `'delete' !== 'wal'`) to
**18/18 pass in ~11 s**. Process-crash durability was checked, not assumed: a
SIGKILLed writer's 200/200 acknowledged rows survived on reopen (3.36 MB of WAL
replayed). The power-loss limb rests on SQLite's documented semantics —
untestable on this box, and stated as such in the code. Evidence:
`replica/proofs-native-blocks.md` §6.

### 7.2 — AFTER Linux/Windows packaging ships

**T4. Wire the native host into shields' request path.** *First deliverable:* the
`onBeforeRequest` listener consults the host (with the JS matcher retained as the
fallback when the host is absent — the same degrade-honestly pattern the sync and
password clients already use), and the **static DNR tier is retired**: the
28,907-rule `rules/static-ruleset.json` and the whole salience/tiering machinery
in `dnr-compile.js` stop shipping, replaced by the 7.5 MiB precompiled engine.

**Why after packaging:** this is the step that changes the request path, and it
must be proven by the existing in-browser proofs (5-of-5 trackers stopped, the
D-7 count, the Spotify regression guard) *with the host attached*, on a build
that packages. Doing it before the first packaged artifact exists means proving
it twice.

**T5. The 1PES ephemeral-storage lifetime component.** *First deliverable:* the
3–4-file `.sys.mjs` component from `proofs-cpp-network.md` §2.4 — per-eTLD+1
tab reference count, `"browsing-context-discarded"` hook,
`Services.clearData.deleteDataFromSite()` consumer — authored in `tools/`
(omni/JS), **not** as a `patches/*.patch`, with the BFCache/`replace` dedup
handled explicitly and a failure mode that under-clears rather than shreds.

**Gate:** a boot-and-assert that closing the last tab for `example.com` wipes
`tracker.example.net`'s partitioned cookies. It cannot be verified before T3
gives us a compiled, bootable engine — which is why it is here.

**T6. Re-measure the resource budget with the host attached.** *First
deliverable:* a new `replica/resource-budget.md` row for the request path, using
the repo's own methodology (`tools/e2e/ziy-budget.py`), reporting the native
path's per-request cost next to the figures this plan cites. If the number does
not beat 1.10 ms mean in the real browser, T4's win is smaller than predicted and
the plan should say so.

### 7.3 — NOT ON THE ROADMAP, and the honest reasons

| thing | why not |
|---|---|
| The sync server in Rust/axum | below measurement noise; duplicates a tested API |
| A Rust DoH resolver | contradicts `network.trr.mode=5` |
| Zig for anything | language for its own sake |
| Per-site farbling entropy | already rejected as fake; no engine-side key story |
| A 6th C++ patch before the first compile | multiplies the cost of one expensive verification |
| Any native rewrite of the UI, news, sync client or vault crypto | not hot paths; the vault's cost is its feature |

### 7.4 The blunt answer

The co-owner wants more native code. The honest answer for this project is:

> **One Rust module — the blocking engine host — and nothing else.**

It is the only candidate where (a) a measurement already shows JS is a real
cost, (b) a native replacement already exists, is MPL-2.0, is Brave's own
engine, fetches and compiles on this box in ~100 seconds, and (c) a real
measurement shows it is 3–200× faster per request **and** removes the one
capability gap Brave still holds over Ziy.

Everything else on the "more native code" list is either **rejected with a
measurement** (the server, DoH), **already rejected as fake** (per-site
farbling), or **a shell bug wearing a costume** (the dead prefs, which need
renames, not patches). Saying "one module" is not a smaller ambition than
"more rust and c++" — it is the same ambition with the non-work removed.

**The C++ side is already honestly near its ceiling**, and that is a finding,
not a failure: 16 of Brave's 19 farbling targets are already covered by Gecko's
RFP layer by design, the dead-pref class is exhausted, and the one remaining
real gap is a JS component waiting on a compiled engine. Adding native code for
its own sake would violate the rule that governs this project more than the
current JS does.

---

*This plan contains no code and no stubs. Every number it relies on is either
cited from a repo proof document or measured in this session and recorded in §6
with its reproduce command. Everything that could not be measured is labelled
UNVERIFIED.*
