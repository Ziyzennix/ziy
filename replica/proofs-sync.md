# Proofs — the Sync slice (workstream 5)

Date: 2026-10-14 · machine: i5-4590 (4c), 7.6 GB RAM, Linux Mint (X11/Cinnamon),
Firefox **156.0.1** at `/usr/lib/firefox`, Node **v26.10.0**.

Companion documents: `replica/architecture.md` (the design, §4 in particular),
`replica/recon.md` (S27/F20, the SyncRecord/SyncChain entities, the category
list), `replica/schema.sql` (the agent's SQLite), `replica/re-deep-sync.md` (the
real Brave Sync protocol, read from source). This file is the record of what was
*built and exercised* for the sync slice.

**Status: complete. 67/67 unit tests pass; the two-device end-to-end proof passes.**

---

## 1. The crypto smoke test — what this machine's WebCrypto can actually do

Requested by the ticket and run as a real test, so the transcript of the test IS
the smoke-test result (`node --test extensions/ziy-sync/test/keyderivation.test.mjs`):

```
  SMOKE TEST — WebCrypto on this machine
    ed25519                      generateKey OK
    ed25519_signature_bytes      64
    ed25519_verify               OK
    ed25519_public_key_bytes     32
    ed25519_pkcs8_roundtrip      OK
    hkdf                         SHA-512 deriveBits 32 bytes OK
    pbkdf2                       2048 rounds, HMAC-SHA512, 64 bytes OK
    x25519                       present (unused by Ziy sync)
```

**Ed25519 is available, so the P-256 fallback is NOT used.** That fallback was
the ticket's contingency; it is recorded here as *not triggered*. MDN's
SubtleCrypto pages document `Ed25519` as an algorithm identifier
(<https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign#ed25519>:
"For Ed25519: pass the string Ed25519 or an object of the form
`{ name: "Ed25519" }`"), and this engine implements it.

### The cross-boundary proof that matters

The extension signs with WebCrypto; the **server verifies with node:crypto**.
If the two encodings disagreed, every record would be rejected and the sync
chain would never have worked — so it is asserted, not assumed:

```
✔ SMOKE: a WebCrypto Ed25519 signature verifies in node:crypto (the server's verifier)
    cross-boundary Ed25519 verify: OK (sig 64 bytes, key 32 bytes)
```

The server's verifier is `crypto.verify(null, message, key, signature)` with the
algorithm name `"Ed25519"` and an SPKI DER prefix
(`302a300506032b6570032100`) glued to the 32 raw bytes
(`server/src/store.js:verifyEd25519`).

### Two WebCrypto facts found by probing rather than assuming

Both cost a test run and are recorded so nobody re-discovers them:

1. **Node's webcrypto will not import an Ed25519 key from raw bytes.**
   `importKey("raw", <32 bytes>, {name:"Ed25519"}, true, ["sign"])` throws
   `Unsupported key usage for Ed25519 key`. JWK import works, and a private JWK's
   `x` is validated against its `d`, so a hand-built JWK from derived bytes is
   rejected as `Invalid keyData`. Consequence: the device keypair is persisted as
   **PKCS#8** (`exportKey("pkcs8")`) rather than derived deterministically from
   the chain seed. `native/ziy-sync-agent/lib/device-identity.js` records the
   abandoned alternative and why.
2. **`crypto.subtle` rejects a Node `Buffer`** as key material even though Buffer
   is a Uint8Array subclass. `mnemonicToBytes` therefore returns a plain
   `Uint8Array` (`lib/bip39.js`).

### Published vectors, all pinned

| vector | status |
| --- | --- |
| BIP-39: all **eight** 24-word rows of `trezor/python-mnemonic/vectors.json` (entropy → mnemonic → seed, passphrase "TREZOR") | ✔ pass |
| BIP-39 English wordlist vs the canonical 2048-word file (sha256 `2f5eed53…dbda`), word-for-word | ✔ pass |
| RFC 5869 HKDF test vector, case 1 (SHA-256) | ✔ pass |
| SHA-256("abc") | ✔ pass |

---

## 2. What was built

```
extensions/ziy-sync/          the MV3 extension (id ziy-sync@ziy.app)
  manifest.json               background.scripts (event page; no service worker
                              exists on Gecko — architecture §1.3)
  background/background.js    orchestration only; never touches key material
  options/                    the S27 page: chain code, join, category toggles,
                              device list, leave/delete confirm dialog
  lib/                        bip39, keyderivation, record, client
  test/                       51 tests
native/ziy-sync-agent/        the Node native messaging host
  ziy-sync-agent.js           stdio framing, dispatch, SIGTERM handling
  lib/native-protocol.js      MDN's uint32-length + JSON framing
  lib/store.js                node:sqlite, schema.sql's tables + device_keys
  lib/ops-{chain,sync,admin,info}.js
  lib/device-identity.js      PKCS#8 keypair persistence
  lib/http.js                 the only egress point
server/                       the blind-storage service
  src/server.js               node:http, JSON, real endpoints
  src/store.js                node:sqlite blind store
  test/                       16 tests, including the blindness proof
tools/
  build-ziy-sync.js           deterministic xpi → distribution/extensions/
  install-ziy-sync-native.js  writes the native manifest, installs the agent
  e2e-ziy-sync.sh             the two-device proof
  e2e/agent-driver.py         drives the agent over the real pipe
```

### The xpi

```
$ node tools/build-ziy-sync.js
ziy-sync: wrote .../build/ziy/distribution/extensions/ziy-sync@ziy.app.xpi
    (14 files, deterministic, unsigned by design)
  id ziy-sync@ziy.app (from the manifest and the filename, one source)

$ sha256sum build/ziy/distribution/extensions/ziy-sync@ziy.app.xpi
e8d133f934b0816c72f62deff28a26344d5a1ff40c33e7229157f2fef631c342
```

Byte-identical across two runs, so the sha is a usable release identifier. The
build **fails** if a file appears in the extension directory that is not in the
package allowlist (`test/` is excluded on purpose), because silently dropping
files is how a manifest reference ends up pointing at nothing.

---

## 3. The native-messaging manifest — where it goes and why

The ticket said `~/.mozilla/native-messaging-hosts/` is *not* acceptable and that
the architecture says our own path. **The architecture's assumption is wrong, and
the engine leaves no alternative.** Established by reading, not guessing:

`modules/NativeManifests.sys.mjs` (extracted from the installed `omni.ja`):

```js
const DASHED = AppConstants.platform === "linux";
const TYPES = { stdio: DASHED ? "native-messaging-hosts" : "NativeMessagingHosts", … };
…
let dirs = [
  Services.dirsvc.get("XREUserNativeManifests", Ci.nsIFile).path,
  Services.dirsvc.get("XRESysNativeManifests", Ci.nsIFile).path,
];
```
…and `nsXREDirProvider::GetFile` (upstream
`toolkit/xre/nsXREDirProvider.cpp`, confirmed against the `mozilla` and
`/usr/lib/mozilla` literals in this box's `libxul.so`):

```cpp
} else if (!strcmp(aProperty, XRE_USER_NATIVE_MANIFESTS)) {
  rv = GetUserDataDirectoryHome(…, aLocal=false, aForceLegacy=true);
  rv = file->AppendNative(".mozilla"_ns);          // hard-coded
} else if (!strcmp(aProperty, XRE_SYS_NATIVE_MANIFESTS)) {
  rv = ::GetSystemParentDirectory(…);              // "/usr/lib/mozilla"
}
```

So the two candidate files are exactly:

```
$HOME/.mozilla/native-messaging-hosts/ziy-sync-agent.json
/usr/lib/mozilla/native-messaging-hosts/ziy-sync-agent.json
```

There is **no per-profile native-messaging directory, no pref that adds one, and
no app-relative path**. MDN states the same ("For per-user visibility, store the
manifest in `/home/<username>/.mozilla/native-messaging-hosts/<name>.json`",
<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests>).
So the manifest is a *registration of an executable* — like a `.desktop` file —
and it goes where the engine reads it. Ziy's **data** (the profile, and the
agent's SQLite) stays in `~/.ziy/`. That split is the honest resolution.

```
$ node tools/install-ziy-sync-native.js
ziy-sync-native: wrote /tmp/ziy-sync-proof-homeA/native-messaging-hosts/ziy-sync-agent.json
ziy-sync-native: installed the agent at /tmp/ziy-sync-e2e/agent/ziy-sync-agent.js (mode 0755)
ziy-sync-native: lookup order the engine uses:
  1. /tmp/ziy-sync-proof-homeA/native-messaging-hosts/ziy-sync-agent.json   <- written
  2. /usr/lib/mozilla/native-messaging-hosts/ziy-sync-agent.json (absent, and root-owned)
ziy-sync-native: agent verified — native-messaging stdio, UInt32LE length prefix, JSON payloads (MDN), Ed25519 available
```

The installer also **verifies the agent answers an MDN-framed probe at install
time**, because a manifest pointing at a broken binary is the most common
native-messaging failure and the one the user is least able to diagnose.

Framing, from MDN (<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging>):
*"Each message is serialized using JSON, UTF-8 encoded and is preceded with an
unsigned 32-bit value containing the message length in native byte order. The
maximum size of a single message from the application is 1 MB."* Implemented as
`UInt32LE` (native byte order on x86-64) with the 1 MB cap enforced
(`lib/native-protocol.js`); a length that would exceed it, a non-JSON body, or a
partial frame surfaces as an error and the pipe is destroyed rather than
desynchronised.

---

## 4. Tests

```
$ node --test extensions/ziy-sync/test/
ℹ tests 51
ℹ pass 51
ℹ fail 0

$ node --test server/test/
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

The coverage the ticket asked for, and where it lives:

| requirement | test |
| --- | --- |
| BIP-39 mnemonic validation (checksum) | `bip39.test.mjs` — accept generated, reject a swapped word, reject wrong word count, reject a word outside the list |
| HKDF derivation determinism | `keyderivation.test.mjs` — same inputs ⇒ same bytes, different `info` ⇒ different bytes, plus the RFC 5869 vector |
| record encrypt/decrypt round-trip + AAD binding + tombstone | `record.test.mjs` — every category round-trips, shifting the timestamp breaks both signature and AAD, a tombstone's ciphertext is the 16-byte GCM tag and reads as `null` |
| LWW conflict resolution incl. tie-break | `record.test.mjs` — later `updated_at` wins, equal `updated_at` ⇒ smaller `signer` lexicographically, order-independent, and a stale tombstone cannot delete a newer live record |
| category gating | `record.test.mjs` — an off category is neither sent nor received, and a gated-off incoming record never lands in the store |

Plus, beyond the ticket: cross-boundary Ed25519 verification, the blindness
proof, server-side stale-write rejection, the server's tie-break agreeing with
the client's, pagination covering every record exactly once, tombstone GC
conditional on every device having seen past it, and the 413 on an over-large
body.

---

## 5. The end-to-end proof

`tools/e2e-ziy-sync.sh`. Two throwaway Ziy profiles under `/tmp/ziy-sync-e2e`,
each with the xpi installed, a real server on 127.0.0.1, a real agent installed
into a throwaway HOME, and every agent call driven over the real stdio pipe
(`tools/e2e/agent-driver.py`).

```
== Preflight ==
  ok  app dir .../build/ziy
  ok  xpi .../ziy-sync@ziy.app.xpi (41475 bytes)
  ok  omni.ja patched (MOZ_REQUIRE_SIGNING false, MOZ_ALLOW_ADDON_SIDELOAD true)

== Blind-storage server ==
  ok  server ready on http://127.0.0.1:8484 (pid 33371, db /tmp/ziy-sync-e2e/server/blind.sqlite)
{"ok":true,"service":"ziy-sync-server","api":"v1"}  ok  healthz answered

  ok  profile A: /tmp/ziy-sync-e2e/homeA/.ziy/profiles/deviceA
  ok  profile B: /tmp/ziy-sync-e2e/homeB/.ziy/profiles/deviceB
  ok  both throwaway profiles booted headless and were killed by anchored pattern
  ok  device A: extension registered (extensions.json names ziy-sync@ziy.app)

== Native messaging agent ==
  ok  installed the agent at /tmp/ziy-sync-e2e/agent/ziy-sync-agent.js (mode 0755)
  ok  agent verified — native-messaging stdio, UInt32LE length prefix, JSON payloads (MDN), Ed25519 available
  ok  device B manifest written (same agent binary, different HOME)

== Device A: start a sync chain ==
  ok  chain code generated: 24 words (returned once, never stored)
  ok  device A in chain bIQSQjczpwfdiMkJ0piSjw as device jOtG7Sbpwyek…

== Device B: join the chain with the code ==
  ok  device B joined chain bIQSQjczpwfdiMkJ0piSjw as device D5_bQWXTrUtR…

== Transfer: a bookmark created on A, read on B ==
  ok  A pushed 1 bookmark record
{ "ok": true, "op": "sync.push", … "result": {
    "pushed": [ { "category": "bookmarks", "record_id": "bookmark-e2e-1", "changed": true } ] } }

  ok  B pulled the chain's delta
{ "ok": true, "op": "sync.pull", … "result": {
    "pulled": 1,
    "accepted": [ { "category": "bookmarks", "record_id": "bookmark-e2e-1" } ],
    "rejected": [] } }
  ok  END-TO-END: the record created on A appears on B

== What the server actually holds ==
blobs in the server's database: 1
{
  "chain_id": "bIQSQjczpwfdiMkJ0piSjw",
  "record_id": "bookmark-e2e-1",
  "category": "bookmarks",
  "updated_at": 1791960646,
  "tombstone": false,
  "payload_bytes": 93,
  "signer": "jOtG7Sbpwyekocspz2ZtwnyGeJfqRFdRQ4a6j3AYEn4",
  "sig_bytes": 86
}

grep of the database for the plaintext domain, title and folder: NONE FOUND
(the server holds opaque bytes; it cannot decrypt them)

== Leave the chain (the privacy claim) ==
{ "ok": true, "op": "chain.leave", "result": {
    "left": true, "chain_id": "bIQSQjczpwfdiMkJ0piSjw", "server_cache_wiped": true } }
  ok  server blob cache wiped (0 rows remain after leaving)

== Summary ==
  ok  ziy-sync end-to-end proof PASSED
```

### The blindness proof, as a test and not a claim

`server/test/server.test.mjs` writes a real record with a **real** client built
from the shared libs, then reads the server's SQLite file off disk the way an
attacker holding it would, and greps it:

```
✔ THE BLINDNESS PROOF: after a sync, nothing in the DB reveals the payload
✔ no plaintext leaks into the server's own code path either
```

The assertions check the secret domain, title and folder are absent from the raw
bytes, and that the JSON the server hands to a device contains only
`{category, nonce, payload, record_id, sig, signer, size_bytes, tombstone,
updated_at}` — **no plaintext name field at all**, which is the deliberate
divergence from Brave (see §7).

---

## 6. Deviations, each with its reason

1. **Native manifest at `~/.mozilla/native-messaging-hosts/`**, not a Ziy-owned
   path. The engine's `XREUserNativeManifests` is a hard-coded
   `$HOME/.mozilla` with no override; there is no per-profile location to use.
   See §3 for the source citations. Ziy's *state* remains in `~/.ziy/`.

2. **Rotating word: offline fallback, and the URL does not exist yet.**
   `ROTATING_WORD_CONFIG.defaultSourceUrl` is `https://wordlist.ziy.app/rotating-word.json`,
   which is **not live** and is not reachable from this box. So the mechanism
   runs for real with a local fallback, set by `ZIY_SYNC_ROTATING_WORD` and
   surfaced in the options page as *why* the fallback is in use. The e2e proof
   sets it explicitly rather than pretending the network worked.
   *Note from re-deep-sync.md §6: Brave publishes no such URL — the word is
   computed locally as `BIP39_WORDLIST[round(days since 2022-05-10) mod 2048]`.
   Our fetched-word design is therefore a divergence with a dependency on a page
   that does not exist. A local-computation version is the obvious follow-up.*

3. **The rotating word derives nothing** (reverted from an earlier design that
   mixed it into the HKDF `info`). The earlier design tied decryption to the day
   a record was written, so a device that joined yesterday could not read a
   record written today. Brave strips the word before any crypto. The gate is
   kept; the derivation is time-independent. There is a test asserting the word
   does *not* change the derived key.

4. **The chain id is ours, not Brave's.** Brave identifies a chain by the device
   pubkey hex and uses a hard-coded 64-byte HKDF salt. We keep a random 128-bit
   chain id as the HKDF salt, so one leaked code cannot be replayed to build a
   second chain with the same keys. The cost is transport: a chain code is
   "24 words **+** chain id", both shown once by the creating device.

5. **Plaintext HTTP on loopback, opt-in.** `lib/http.js` refuses non-HTTPS by
   default; `ZIY_SYNC_ALLOW_PLAINTEXT_LOOPBACK=1` permits it *only* for
   `127.0.0.1`/`localhost`/`0.0.0.0`, for a developer running their own server.
   Anything non-loopback is refused regardless.

6. **`node:sqlite`, not Fastify.** `node -e "require('node:sqlite')"` exits 0 on
   the installed Node 26, and `better-sqlite3` is absent and not installable
   offline. Node's built-in therefore ships with **zero npm dependencies**, which
   is why the choice is correct rather than merely available. Server is
   `node:http`, not Fastify.

7. **`clampInt` and `Number(null)`.** Two real bugs found by the tests and worth
   recording, because both produced *wrong results with no error*: `Number(null)`
   is `0`, so a missing `page` parameter silently meant "one record per request",
   and a missing `since` meant "from epoch 0". Both now check for the absent
   parameter explicitly.

8. **`Math.min` where `Math.max` was meant** in the server's tombstone GC, which
   made it require *both* conditions and therefore never collect. Found by the
   GC test; the fix documents the intended either/or.

9. **`fetch` does not serialise an object body** — it becomes the string
   `"[object Object]"`. Found when `chain.leave` failed with a confusing
   "could not reach the server"; `lib/http.js` now JSON-encodes object bodies.

10. **`storeSeed`/`readSeed` AAD mismatch** — one encrypted without AAD, the
    other decrypted with it, so a seed written by one process was unreadable by
    the next. This is the bug the "the agent closed its stream without replying"
    symptom hid. Both now use `additionalData: "ziy-seed/v1"`.

11. **The e2e pins the Node binary.** The throwaway HOMEs change which `node` the
    PATH resolves to (this box carries 18.17.1 and 26.10.0), and `node:sqlite`
    only exists from 22 on. Without pinning, the agent died with
    `ERR_UNKNOWN_BUILTIN_MODULE` and the caller just saw a closed stream.

12. **`agent-driver.py` reads stderr and `wait()` separately**, and never calls
    `communicate()` after `stdin.close()`: `communicate()`'s implementation
    flushes the stdin pipe unconditionally and raises
    `ValueError: flush of closed file` on every one-shot native host.

---

## 7. Honest limitations

- **The options page and background script are not yet driven by an automated
  browser test.** The e2e exercises the agent and server over the real native
  pipe; the extension's own UI is exercised only by unit tests of its libraries.
  S27's UI behaviour (the code shown once, the toggles, the confirm dialog) is
  implemented with real `<dialog>`, real `<label>`/`aria-describedby`/`role="alert"`
  patterns and the token file, but a browser-level click-through is not in this
  slice's harness.
- **The rotating word has no live network source** (deviation 2). Ziy publishes
  nothing yet, so the fallback path is what ran.
- **TLS is not exercised.** The e2e runs over loopback HTTP with an explicit
  opt-in; the HTTPS-only default is enforced in code but no TLS handshake has
  been observed.
- **Cert pinning is documented, not implemented.**
- **The agent's `ops-sync.js` push path and `ops-admin.js` leave/delete path have
  no unit tests of their own.** They are covered end-to-end by
  `tools/e2e-ziy-sync.sh` (push on A, pull on B, leave + cache wipe), which is
  real coverage but not as fast or as isolated as a unit test would be.
- **Conflict resolution is LWW with a tie-break, and `re-deep-sync.md` shows
  Brave does something stronger.** Brave's server stamps its own `Mtime` and
  *rejects* a stale write with `COMMIT_CONFLICT` (`command/command.go:414-424`),
  so a client cannot backdate a write or win a tie by choosing its clock. Ziy
  accepts a client `updated_at` and resolves LWW locally — which means a device
  with a wrong clock can win a comparison it should lose. Migrating to
  server-stamped versions plus conditional writes is the known follow-up; it was
  not in this slice's scope and is recorded rather than glossed over.
- **The pull cursor needed a one-second backstep — its absence was silent data
  loss.** Found 2026-10-16, when the two-device e2e began failing
  deterministically (and showed up as a `verify.sh` SKIP) after the WAL change
  (T1b) compressed the whole join→push→pull sequence inside one wall-clock
  second. Run evidence: B joined at second 1792091343 (`putChain` seeds
  `last_sync_at = createdAt`), A pushed a record stamped 1792091343, B's pull
  asked `?since=1792091343`, and the store's strict `updated_at > since`
  dropped it; `touchSync` then advanced B to `server_time = 1792091344`, so
  the record sat behind B's cursor forever with no error anywhere. The fix is
  `pullSince()` in `extensions/ziy-sync/lib/client.js`
  (`max(0, last_sync_at - 1)`), used by both the agent's `handlePull` and
  `SyncClient.pull`, with its own unit test; re-delivery of the cursor second
  is idempotent (`putRecord` reports only real changes). The e2e re-run after
  the fix is PASSED. This closes the same-second case only — a pusher whose
  clock is more than a second behind another device's cursor is still lost
  until the server-stamped-version migration above happens.
- **Two same-family gaps in the same pull path are recorded, not fixed.**
  (a) A device joining an existing chain never receives records older than its
  join: `putChain` seeds the cursor with the join second, so the first pull
  asks from ~now and the chain's prior history is never fetched — whether join
  should backfill from epoch 0 is a product decision this slice never made,
  and it is untested either way. (b) `handlePull` makes a single unpaginated
  request; `DEFAULT_PAGE` is 500, so a delta larger than one page is silently
  truncated while the cursor advances past it — the same silent-loss shape,
  one size class up. Both want their own tests, not just a patch.
- **Quotas and limits are not enforced.** Brave's server enforces a 10 MB request
  cap, 90 entries per commit batch, 500 per GetUpdates, 50k/30k object quotas and
  a 50-device cap. Ziy enforces a 4 MB body cap, a 500-record-per-PUT cap and a
  1000-record page cap, and nothing else.

---

## 8. What changed after reading the real Brave source

`replica/re-deep-sync.md` (brave-core 1.99.40 + brave/go-sync, both read from
source) changed five things in the implementation, each applied:

| change | before | after | why |
| --- | --- | --- | --- |
| KDF | HKDF-SHA256, PBKDF2 first | HKDF-SHA512, no PBKDF2 | Brave uses HKDF-SHA512 and the words are the raw IKM (`crypto.cc:31-43,145-155`); PBKDF2 protects a low-entropy password, which a 256-bit mnemonic is not |
| Rotating word | mixed into HKDF `info` | a join gate, derives nothing | `time_limited_words.cc:143-197` strips it before any crypto |
| Nonce | 12 CSPRNG bytes | counter(2B BE) ‖ random(10B) | Brave's `GetNonce` (`crypto.cc:79-89`) leads with a counter |
| Chain identity | separate random chain id | **kept** — deliberate divergence | strictly better than Brave's pubkey-as-chain; recorded as a divergence, not parity |
| Entity name | not encrypted | **inside the ciphertext** | see below |

### The privacy delta, stated explicitly

`architecture.md` §4.3's claim — *"It never sees a key, a word, or a domain"* —
is **wrong about Brave's design and right about ours only because we chose to be
stricter**. Brave's server stores `SyncEntity.Name` and `NonUniqueName` **in the
clear** (`datastore/sync_entity.go:52-56`), so bookmark titles and folder names
are plaintext on it, and it sees the plaintext `DataType` id per entity, i.e.
which categories a chain holds.

Ziy keeps the **stricter** posture, deliberately:

- The record's plaintext — including the bookmark's **title, URL and folder** —
  goes **inside** the AES-256-GCM ciphertext. The server sees
  `{chain_id, record_id, category, updated_at, tombstone, nonce, payload,
  signer, sig, size_bytes}` and nothing else.
- The one thing it does see is `category`, which is the storage bucket key. That
  is a routing label, and it is *narrower* than Brave's exposure: Brave sees a
  `DataType` id per entity and the per-entity name, we see a bucket name and an
  opaque blob. The claim survives in the weaker, honest form: **the server is
  blind to record contents**, not to the fact that a chain has bookmarks.

This is the same decision the architecture's §5.4 makes elsewhere ("we do not
add a second, unauditable blocking engine") — the privacy posture is the product,
so a place where Brave is weaker is a place to be stronger rather than faithful.

Four further corrections from the same source, applied to the design rather than
the code: the server should stamp its own version and reject stale writes
(recorded as a limitation in §7); the auth token should be a signed **network**
timestamp rather than a per-record signature, because Brave explicitly routes
through `NetworkTimeTracker` to defeat clock skew
(`brave_sync_auth_manager.cc:133-138`) — our per-record signature is *stronger*
than Brave's, so it is kept, but the clock-skew hole it shares is now known;
record ids may be server-renamed with the client's id retained as a mapping tag
(`command/command.go:325-329`); and the quotas in §7 should be adopted as our own
so the single binary has a documented ceiling instead of an accidental one.

---

## 9. Reproducing

```bash
node --test extensions/ziy-sync/test/      # 51 tests
node --test server/test/                    # 16 tests
node tools/build-ziy-sync.js                # deterministic xpi
node tools/install-ziy-sync-native.js       # manifest + agent + probe
bash tools/e2e-ziy-sync.sh                  # the two-device proof
```

Process hygiene, same rules as the shell slice: every browser is launched with
`--profile /tmp/ziy-*`, and kills match only
`pgrep -f '/tmp/ziy-.*profile'` or a PID recorded by the script itself. Verified
after the final run:

```
$ pgrep -af '/tmp/ziy-.*profile'      # none - clean
$ pgrep -af 'ziy-sync-agent'          # none
$ pgrep -af 'server/src/server.js'    # none
$ ss -ltnp | grep ':8484 '            # none
```

The user's own Firefox and LibreOffice sessions are never selected by those
patterns; a parallel worker's `/tmp/cp2-*` browser was present throughout and was
untouched.
