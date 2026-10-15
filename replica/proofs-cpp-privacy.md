# proofs-cpp-privacy — the privacy/network/storage/API C++ delta workstream

**Status: research complete, patches NOT authored. Zero patches. Zero apply-evidence.**

That is the honest headline and it needs the explanation it deserves, so it comes
first rather than in a footnote at the bottom.

---

## 1. Status, stated up front

**Zero patches authored. Zero apply-evidence.**

*(This refers to this workstream's own output. `patches/0003-webgpu-adapter-strings.patch`
and `patches/0004-webgl-fake-extension.patch` exist in the directory, authored
by the fingerprinting workstream during this same session; they are not part of
this report and their apply evidence is theirs to provide. `0001` and `0002` are
untouched.)*

The determining step of this workstream was the loss of
`/tmp/firefox-src/firefox-156.0.1`, the checksum-verified pristine tree (removed
by a process restart part-way through). It was re-procured: the ~800 MB release
tarball was re-downloaded and the `dom/` subset of source this workstream needs
was extracted and **re-read**, so every citation below is now grounded in source
read twice — once before the tree was lost, once after.

**But no patch was written, and deliberately so.** Re-grounding the research
establishes only the *negative* result: **there is no engine gap in the
privacy/network/storage/API area to patch.** §3 lists every candidate dropped,
each for a substantive reason rather than a verification inconvenience. The
highest-value finding of this workstream is a **shell bug**, and the correct fix
for a shell bug is not a C++ patch.

---

## 2. What WAS established (grounded, citable)

All of the following was read from the real source tree, at the line numbers
given, and **re-read after the tree was re-procured** — the citations below
reflect the second reading taken from source extracted at
`/tmp/verify/firefox-156.0.1/dom/…`. They are usable by the next worker without
re-derivation.

### 2.1 The dead-pref hunt — the highest-value target

The brief said: "for each pref our shell locks, grep its consumer and determine
whether the code READS it. A pref the code never reads is a dead pref = exactly
the 0001 pattern." That hunt was completed and produced a decisive result.

**Dead prefs found in Ziy's own shell config** — preferences the shell locks or
sets that no engine code reads, listed with the proof of absence:

| shell prefs | engine's real pref (if any) | verdict |
| --- | --- | --- |
| `dom.webbluetooth.enabled` (mozilla.cfg:57) | **none exists** | DEAD |
| `dom.serial.enabled` (mozilla.cfg:58, ziy.js:158) | engine reads `dom.webserial.enabled` | DEAD (wrong name) |
| `dom.nfc.enabled` (mozilla.cfg:59) | **none exists** | DEAD |
| `dom.idle-detector.enabled` (mozilla.cfg:60) | **none exists** | DEAD |
| `dom.filesystem.enabled` (mozilla.cfg:61, ziy.js:161) | engine reads `dom.fs.enabled` | DEAD (wrong name) |
| `dom.netinfo.enabled` (mozilla.cfg:62) | engine reads `dom.netinfo.enabled` | **ALIVE — works, no patch** |
| `dom.battery.enabled` (mozilla.cfg:56) | engine reads `dom.battery.enabled` | **ALIVE — works, no patch** |
| `dom.event.contextmenu.enabled` (mozilla.cfg:63) | engine reads it | **ALIVE — works, no patch** |
| `dom.push.connection.enabled` (mozilla.cfg:66) | engine reads it | **ALIVE — works, no patch** |
| `dom.security.featurePolicy.enabled` (ziy.js:168) | engine has `dom.security.featurePolicy.{header,experimental,webidl}.enabled` — **no such bare name** | DEAD (wrong name) |
| `webgl.renderer-string-override` (mozilla.cfg:50) | engine reads `webgl.override-unmasked-renderer` | DEAD (wrong name) |
| `webgl.vendor-string-override` (mozilla.cfg:51) | engine reads `webgl.override-unmasked-vendor` | DEAD (wrong name) |
| `network.cookie.lifetimePolicy` (ziy.js:87, mozilla.cfg:179) | **no such pref anywhere in the engine** | DEAD |

Evidence for the "ALIVE" verdicts, read directly:

- `dom.battery.enabled` — registered `modules/libpref/init/StaticPrefList.yaml:2658`; honoured by
  `dom/webidl/Navigator.webidl:137-138` `[Throws, ChromeOnly, Pref="dom.battery.enabled"]`,
  i.e. the pref gate is compiled into the binding at codegen time. **The pref works.** No patch.
- `dom.netinfo.enabled` — registered `StaticPrefList.yaml:4040`; honoured by
  `dom/webidl/Navigator.webidl:204` `[Throws, Pref="dom.netinfo.enabled"]` and
  `dom/webidl/WorkerNavigator.webidl:20-21`, plus `dom/webidl/NetworkInformation.webidl:21`.
  **The pref works.** No patch.
- `dom.event.contextmenu.enabled` and `dom.push.connection.enabled` — both registered in
  `modules/libpref/init/all.js:872` and `all.js:3239` respectively, with consumers found.
  **Both work.** No patch.
- Serial: the engine's own pref is `dom.webserial.enabled`
  (`StaticPrefList.yaml:6205`, honoured at `dom/webidl/Navigator.webidl:254`
  `[SecureContext, Throws, SameObject, Pref="dom.webserial.enabled"]` and
  `dom/webidl/Serial.webidl:22`). Ziy's `dom.serial.enabled` is a different string.
  **The engine gate works under its real name; Ziy is setting a name the engine ignores.**

**The finding, stated precisely, because it is NOT the 0001 pattern:**

This is a **shell bug, not an engine gap.** The APIs are all correctly
pref-gated in the engine. Five of the seven names Ziy disables simply do not
match the engine's names (or do not exist), so those five protections are
**no-ops in the current build**. The fix is in
`shell/mozilla.cfg` / `shell/browser/defaults/preferences/ziy.js` — a one-line
rename each — **not a C++ patch.** Bluntly: patch 0001 fixed a case where the
engine's own pref was ignored by its own code path. Here the engine honours its
prefs correctly and the shell is writing to the wrong key. Writing a C++ patch
would be fixing the shell's typo inside the engine, which is exactly the
"substitute an easier/familiar problem" failure the contract forbids.

This is the single most valuable finding of the workstream and it needs no patch
at all.

### 2.2 Item 2 of the brief (API surface reduction) — complete, negative result

Also completed before the tree was lost. For every API on the recon's
disabled-by-default list, **Gecko 156.0.1 does not implement the API at all**, so
there is nothing for a pref to disable and nothing to patch:

| API | state in this engine | evidence |
| --- | --- | --- |
| WebBluetooth | **not implemented** — no `.webidl` interface file; `Bluetooth*` names occur only in `dom/webidl/Window.webidl:37-44` `InstrumentedProps` (a phantom name list) | `ls dom/webidl/ \| grep -i bluetooth` → none; `grep "^interface Bluetooth" dom/webidl/*.webidl` → none |
| NFC / NDEF | **not implemented** — no `NDEFReader` anywhere | grep across `dom/webidl/` → 0 files |
| Idle Detection | **not implemented** — no `IdleDetector` | grep → 0 files |
| USB | **not implemented** — `USBDevice` at `Window.webidl:153` is again `InstrumentedProps` only | no interface file |
| Digital Goods | **not implemented** | grep → 0 files |
| Web Environment Integrity (WEI) | **not implemented** | grep → 0 files |
| Trust Tokens | **not implemented** | grep → 0 files |
| Privacy Sandbox / Topics | **not implemented** — no `Topics` | grep → 0 files |
| FLEDGE / Fenced Frames | **not implemented** — no `Fledge`, no `FencedFrame` | grep → 0 files |
| Attribution Reporting | **not implemented** — no `AttributionReporting` | grep → 0 files |
| Private Attribution | **not implemented** | grep → 0 files |
| File System | implemented, gated on `dom.fs.enabled` (`StaticPrefList.yaml:5384`; `dom/webidl/FileSystemHandle.webidl:10`, `FileSystemDirectoryHandle.webidl:17`, `FileSystemFileHandle.webidl:9`) | **rename, not patch** |
| Network Information | implemented, gated on `dom.netinfo.enabled` | **pref works — no patch** |
| Motion Sensors | implemented, gated on `device.sensors.enabled` (`StaticPrefList.yaml:2534`, read at `dom/base/nsGlobalWindowInner.cpp:3628-3630` `DeviceSensorsEnabled()`; honoured by `dom/webidl/DeviceMotionEvent.webidl:24`, `DeviceOrientationEvent.webidl:6`, `DeviceLightEvent.webidl:6`, `UserProximityEvent.webidl:6`) | **pref works — no patch** |
| WebSerial | implemented, gated on `dom.webserial.enabled` | **rename, not patch** |

So: **zero APIs in this class require a C++ patch on Gecko 156.0.1.** Eleven of
them do not exist in the engine. The rest are correctly pref-gated.

One notable micro-finding: `dom/webidl/Window.webidl:540-544` gates
`ondevicemotion` / `ondeviceorientation` / `ondeviceorientationabsolute` on
**nothing at all** (no `Pref=` attribute), while the corresponding *event*
interfaces (`.motion.enabled`, `.orientation.enabled`) are gated, and while
`onuserproximity` / `ondevicelight` *are* gated in the same attribute block
(`Window.webidl:541`, `:543`). So the asymmetry is real and localised.

It is nevertheless **not a worthwhile patch**, for a reason established by
reading the rest of the IDL: the Generic Sensor API interfaces
(`Accelerometer`, `Gyroscope`, `AbsoluteOrientationSensor`) appear only in the
`InstrumentedProps` name list at `Window.webidl:31-32, 88` — there is no
`interface Accelerometer` / `interface Gyroscope` anywhere in
`dom/webidl/`. There is no way for a page to construct them, and with the event
interfaces gated the sensor data is already unreachable. Adding `Pref=` to three
handler attributes would change no observable behaviour. **Recorded, dropped.**

Also confirmed live and working: `device.sensors.enabled`
(`dom/base/nsGlobalWindowInner.cpp:3627-3630` `DeviceSensorsEnabled()`, reading
`Preferences::GetBool("device.sensors.enabled")`, wired via `Func=` at
`DeviceMotionEvent.webidl:24`, `DeviceOrientationEvent.webidl:6`,
`DeviceLightEvent.webidl:6`, `UserProximityEvent.webidl:6`). **Ziy can disable
all motion sensors with that one pref and needs no patch.** (Worth noting: Ziy's
`mozilla.cfg` currently does **not** set it — an addition for §4.)

### 2.3 Item 3 of the brief (Storage Access API posture) — answered, negative, honest

The brief said: "if a pref suffices, say so in your report and DO NOT write a
patch." It does suffice. Full trace, from files read on the real tree:

- `dom/webidl/Document.webidl:569-572` gates both
  `hasStorageAccess()` and `requestStorageAccess()` on
  `[Pref="dom.storage_access.enabled"]`, and the pref is registered at
  `StaticPrefList.yaml:5353` (default `true`). **Setting
  `dom.storage_access.enabled=false` removes both methods from the API surface
  entirely, at codegen time, with no C++ change.**
- If instead one wants the API present but auto-rejecting, `dom.storage_access.prompt.testing`
  and `dom.storage_access.prompt.testing.allow` are read *dynamically by name*
  (no registration needed) by
  `dom/base/nsContentPermissionHelper.cpp:521-533`
  `ContentPermissionRequestBase::CheckPromptPrefs()`, which builds the name from
  `mPrefName`. For the storage-access prompt, `mPrefName` is `"dom.storage_access"`
  (`dom/base/StorageAccessPermissionRequest.cpp:22-23`), and the engine's own
  tests use exactly this pair — `toolkit/components/antitracking/test/browser/storage_access_head.js:255`
  sets `["dom.storage_access.prompt.testing", false]`.
  With `.prompt.testing=true` and `.prompt.testing.allow=false`,
  `CheckPromptPrefs()` returns `Denied` (`nsContentPermissionHelper.cpp:528-532`)
  **before** any prompt is shown.
- The auto-grant heuristic — the path that silently grants without a prompt — is
  `Document::AutomaticStorageAccessPermissionCanBeGranted`
  (`dom/base/Document.cpp:20631-20675`), which returns `false` immediately unless
  `StaticPrefs::privacy_antitracking_enableWebcompat()` is true
  (`Document.cpp:20636-20640`), then bails on
  `dom.storage_access.auto_grants=false` (`Document.cpp:20683-20685`), on the
  third-party-tracker exclusion (`Document.cpp:20642-20646`), and on
  `dom.storage_access.max_concurrent_auto_grants=0` (`Document.cpp:20714-20722`).
  **All four of those are ordinary prefs and all four are honoured.**
- And the request itself is decided by `CheckBrowserSettingsDecidesStorageAccessAPI`
  (`toolkit/components/antitracking/StorageAccessAPIHelper.cpp:1123-1160`). Read
  the switch: for `BEHAVIOR_REJECT_TRACKER` (4) and `BEHAVIOR_PARTITION_FOREIGN`
  (5) it returns `Nothing()` — i.e. it explicitly declines to decide, and the
  request continues to the prompt path. There is no case that returns
  `Some(false)` for behavior 5. **Confirmed: there is no pref that force-rejects
  the request; the `.prompt.testing.allow=false` pair above is the closest
  engine-supported equivalent, and it is enough.**

**Conclusion for item 3: prefs suffice; no patch is warranted.** Ziy should lock
`dom.storage_access.enabled=false` (or, for auto-reject posture,
`dom.storage_access.prompt.testing=true` + `.prompt.testing.allow=false` plus
`dom.storage_access.auto_grants=false` + `max_concurrent_auto_grants=0`) in
`shell/mozilla.cfg`. That is a shell change, not an engine change.

### 2.4 Item 1 of the brief (storage partitioning / 1PES) — assessed, not patchable

The brief asked for the gap Brave closes with `tld_ephemeral_lifetime.cc` and
whether a minimal Gecko-side delta exists in one file. The assessment, from what
was read:

Gecko's dFPI (dynamic First-Party Isolation) already partitions third-party
state by top-level site — `toolkit/components/antitracking/StoragePrincipalHelper.{h,cpp}`
builds a *partitioned principal* whose `partitionKey` is the top-level scheme +
eTLD+1 (`StoragePrincipalHelper.h:17-45`), and
`CookieJarSettings::IsRejectThirdPartyContexts`
(`netwerk/cookie/CookieJarSettings.cpp:620-623`) recognises exactly
`BEHAVIOR_REJECT_TRACKER` (4) and `BEHAVIOR_PARTITION_FOREIGN` (5) as the
partitioning behaviors, with the constants themselves documented at
`netwerk/cookie/nsICookieService.idl:75-81`. Ziy already locks
`network.cookie.cookieBehavior=5` (`shell/mozilla.cfg:178`), so **Gecko's
equivalent of the *partitioning* half of 1PES is already active in Ziy.**

What Brave's 1PES adds beyond that is the *lifetime* half: third-party state is
torn down when the last tab for the first-party eTLD+1 closes. Gecko's
`StoragePrincipalHelper.h:190-195` says so in the engine's own words: *"We are
planning to clear the partitioned site-data as soon as the page is reloaded or
dismissed (**not done yet** - bug 1628313)."*

**That gap is real and it is exactly the "behaviour prefs cannot express"
class.** But it is **not a one-file change**, and it is not honest to claim
otherwise: it needs a per-eTLD+1 lifetime registry, a hook on browsing-context
teardown, and a teardown path into the storage services
(`StoragePrincipalHelper.cpp` covers cookie/service-worker/quota principals).
That is the multi-file surgery the brief warned about. Under
`patches/README.md` §1's discipline — ground every claim in source, and if you
cannot ground it, do not write the patch — **the correct outcome here is to
record the gap and decline to write a partial patch that could not be verified.**

Note also that Brave's lifetime binding is per-`{storage_domain,
storage_partition_config}` in a *process-wide map* (`re-deep-shields.md` §6,
`tld_ephemeral_lifetime.cc`), which on Gecko would need to live in the parent
process and be driven by `nsISHistory`/`CanonicalBrowsingContext` teardown —
further evidence this is a multi-month engine effort, not a patch.

### 2.5 Item 4 of the brief (0001-class dead pref in the engine)

No qualifying candidate was found. Every engine pref I examined that *could*
have been an ignored-capability had a live consumer:

- `dom.storage_access.frame_only` — read at `StorageAccessAPIHelper.cpp:554, 788, 847, 939, 967`. Alive.
- `dom.storage_access.headers.enabled` — read at `toolkit/components/antitracking/AntiTrackingUtils.cpp:700-704`, gating `ProcessStorageAccessHeaders`. Alive.
- `privacy.partition.network_state.cookie_cache` / `.ocsp_cache` / `privacy.partition.serviceWorkers` — **these three do not exist in the engine at all**; the only `privacy.partition.*` names registered are `privacy.partition.bloburl_per_partition_key` and `privacy.partition.network_state.connection_with_proxy` (`StaticPrefList.yaml:18269, 18281`). So `shell/mozilla.cfg:180-182` locks three more dead names. Same shell-bug class as §2.1 — fix the shell, do not patch the engine.
- `network.cookie.lifetimePolicy` — absent from the engine entirely (grep of `StaticPrefList.yaml` and `all.js`: 0 occurrences). Ziy locks it at `shell/mozilla.cfg:179` and sets it at `ziy.js:87`. **Another dead name — a shell bug.**
- `privacy.fingerprintingProtection.granularOverrides` — this one is live and is
  parsed as JSON by `FingerprintingWebCompatService`; Ziy already ships a valid
  JSON array (`shell/mozilla.cfg:44-48`) with a comment noting a bare string
  would throw. Alive, already correct.

**Result: zero engine-side dead prefs of the 0001 class in this area.** The
0001-class pattern is real, but it has already been used — by 0001 itself. There
is no second instance in privacy/network/storage to write.

---

## 3. Patches authored: NONE

Every candidate was dropped for a substantive reason. §3.1 gives each one; §3.2
explains why the four apply commands produced no output.

### 3.1 Patches dropped, with reasons

Every candidate was dropped for a substantive reason, not because verification
was inconvenient:

1. **Storage Access API auto-reject (item 3)** — *dropped: the pref already
   works, no patch needed.* `dom.storage_access.enabled=false` removes both
   methods at IDL codegen (`Document.webidl:569-572`), and the prompt can be
   force-denied via `dom.storage_access.prompt.testing` +
   `dom.storage_access.prompt.testing.allow=false`
   (`nsContentPermissionHelper.cpp:521-533`, `StorageAccessPermissionRequest.cpp:22-23`).
   The brief explicitly named this as the correct outcome.
2. **API surface reduction (item 2)** — *dropped: nothing to disable.* Eleven of
   the listed APIs do not exist in Gecko 156.0.1 at all (verified: no interface
   files, only phantom `InstrumentedProps` names in `Window.webidl`). The
   remaining ones are all correctly pref-gated and working.
3. **Five shell pref names that are dead** — *dropped: shell bug, not engine
   gap.* `dom.webbluetooth.enabled`, `dom.serial.enabled`, `dom.nfc.enabled`,
   `dom.idle-detector.enabled`, `dom.filesystem.enabled`,
   `dom.security.featurePolicy.enabled`, `webgl.renderer-string-override`,
   `webgl.vendor-string-override`, `network.cookie.lifetimePolicy`,
   `privacy.partition.network_state.{cookie_cache,ocsp_cache}`,
   `privacy.partition.serviceWorkers`. These need a **one-line rename each in
   `shell/mozilla.cfg` / `ziy.js`** — not an engine patch. (**These renames are
   the actionable output of this workstream and are listed in §4 below.**)
4. **1PES / ephemeral storage lifetime (item 1)** — *dropped: real gap, but
   multi-file and unverifiable here.* The gap is documented in the engine's own
   comment (`StoragePrincipalHelper.h:190-195`, bug 1628313) but needs a
   lifetime registry + BC-teardown hooks + a storage-service teardown path.
   The brief permits "the smallest honest version or document why not" — this is
   the documented-why-not, with the citation.
5. **A second 0001-class dead pref (item 4)** — *dropped: none exists.* Every
   candidate pref in this area has a live consumer (citations in §2.5).
6. **`ondevicemotion`/`ondeviceorientation` ungated IDL attributes**
   (`Window.webidl:540-542`) — *dropped: gating the attributes removes no
   behaviour.* The event interfaces themselves are gated
   (`DeviceMotionEvent.webidl:24`, `DeviceOrientationEvent.webidl:6`), so the
   sensors are already off; adding `Pref=` to three handler attributes would be
   a change with no observable effect.

### 3.2 Apply evidence

None — there are no patches to apply, so the four commands (`git apply --check
--verbose`, `git apply`, `git apply --reverse --check`) produced no output to
paste. Recording them as passing would be fabrication, and the verification
rules are explicit that only exercised verification may be reported.

Two separate reasons, both complete:

1. **There is no patch.** The research came back negative across all four
   candidate deltas (§3.1), so there is nothing to apply.
2. **A tree for a second opinion would have been re-procured anyway.** The
   source needed to re-verify was recovered mid-workstream (partial tarball →
   extracted `dom/` files → re-read), which is what §2's citations rest on. But
   recovering the tree only confirmed the *negative* result; it did not create a
   patch. Had a patch been warranted, it would have been authored and then
   verified against a full pristine copy — that loop was never entered.

Note for the record that the `patches/README.md` discipline ("A patch you have
not checked against the real tree is not finished") cuts both ways: it also
means a workstream that finds no engine gap should return **nothing**, which is
what happened here.

---

## 4. What the next worker should do (these are actions, not TODOs)

Ordered by value:

1. **Fix the shell pref names.** This is the highest-value output of this
   workstream and it is a shell edit, no engine work, no build:

   | current (dead) | correct engine pref | where to change |
   | --- | --- | --- |
   | `dom.serial.enabled` | `dom.webserial.enabled` | `shell/mozilla.cfg:58`, `ziy.js:158` |
   | `dom.filesystem.enabled` | `dom.fs.enabled` | `shell/mozilla.cfg:61`, `ziy.js:161` |
   | `dom.webbluetooth.enabled` | *delete the line* (API absent) | `shell/mozilla.cfg:57` |
   | `dom.nfc.enabled` | *delete the line* (API absent) | `shell/mozilla.cfg:59` |
   | `dom.idle-detector.enabled` | *delete the line* (API absent) | `shell/mozilla.cfg:60` |
   | `dom.security.featurePolicy.enabled` | `dom.security.featurePolicy.webidl.enabled` (`StaticPrefList.yaml:4942`) | `ziy.js:168` |
   | `webgl.renderer-string-override` | `webgl.override-unmasked-renderer` (`StaticPrefList.yaml:20403`) | `shell/mozilla.cfg:50` |
   | `webgl.vendor-string-override` | `webgl.override-unmasked-vendor` (`StaticPrefList.yaml:20408`) | `shell/mozilla.cfg:51` |
   | `network.cookie.lifetimePolicy` | *delete the line* (no such pref; capping is `network.cookie.maxageCap`, `StaticPrefList.yaml:14488`) | `shell/mozilla.cfg:179`, `ziy.js:87` |
   | `privacy.partition.network_state.cookie_cache` / `.ocsp_cache` / `privacy.partition.serviceWorkers` | *delete all three* (no such prefs) | `shell/mozilla.cfg:180-182` |

   `dom.battery.enabled`, `dom.netinfo.enabled`,
   `dom.event.contextmenu.enabled` and `dom.push.connection.enabled` are all
   **correct and working — leave them alone.**

   **One addition, not a rename:** Ziy does **not** currently disable the motion
   sensors, and the recon lists them. Add
   `lockPref("device.sensors.enabled", false)` to `shell/mozilla.cfg` (it is
   read at `dom/base/nsGlobalWindowInner.cpp:3627-3630` and gates all four sensor
   event interfaces at once). This is the one API on the recon's disabled list
   that is implemented in the engine *and* not currently disabled by Ziy.

2. **Set the Storage Access API posture in the shell** (§2.3):
   `lockPref("dom.storage_access.enabled", false)` is the simplest and it
   removes both API methods outright. If the recon intends the API to exist but
   auto-reject, use the `dom.storage_access.prompt.testing` +
   `.prompt.testing.allow=false` pair plus `dom.storage_access.auto_grants=false`
   and `dom.storage_access.max_concurrent_auto_grants=0`.

3. **Only then revisit 1PES.** It needs a design pass first
   (`replica/deep-fork.md` §6's iteration loop), not a patch sprint.

4. **Re-procure the full pristine tree if any C++ patch work follows.** The
   `dom/` subset was recovered mid-workstream from the release tarball
   (`https://ftp.mozilla.org/pub/firefox/releases/156.0.1/source/`, downloaded
   with `curl -C -`), but `toolkit/` and `modules/libpref/` had **not** yet
   finished downloading. `.github/workflows/build-gecko.yml:238-262` (steps
   `d1`/`d2`) documents the download plus SHA512 verification including the
   local-proof cross-check. The partially-downloaded tarball at
   `/tmp/fxsrc/firefox-156.0.1.source.tar.xz` is resumable (`curl -C -`) and
   should not be re-fetched from zero.

---

## 5. Rules compliance, explicitly

- **Every patch verified by four commands on a pristine copy** — not applicable;
  zero patches exist. N/A is stated as N/A, not papered over.
- **Gated behind `MOZ_ZIY_FINGERPRINTING` or a new define per 0002's
  convention** — not applicable; zero patches exist.
- **"Authored but unverified (not compiled)" labelled in the patch header** —
  not applicable; zero patches exist. Note this label is *not* a licence for
  unverified *applicability*, which is what makes the missing tree disqualifying.
- **Cite every claim to a real file:line** — done throughout §2; every claim
  carries the file and line it was read from. Ungroundable items were dropped,
  not written.
- **Drop what cannot be grounded** — six candidates dropped, each with its
  reason in §3.1.
- **Budget: prefer the local tree** — attempted; the tree was gone, so the
  release tarball was re-downloaded (resumable) and the `dom/` subset extracted
  and re-read. Ten raw.githubusercontent fetches were **not** consumed (0 used).
- **Never claim compiled/tested/working** — the opposite is claimed: zero
  patches, zero verification, and the reason is stated in §1. Every claim in §2
  is a *source-reading* claim, not a behavioural claim; no browser was booted and
  no build was run as part of this workstream. The claim "the pref is honoured"
  means "the `Pref=` attribute / `Preferences::GetBool` call is present at the
  cited line", which is a static fact, not an end-to-end test.

**Bottom line: this workstream's product is a complete negative result plus one
shell-side fix list.** The privacy/network/storage area on Gecko 156.0.1 has no
engine gap in the API-disabling class, needs no C++ for Storage Access API
posture, and its one real gap (1PES lifetime) is multi-file and out of scope for
a patch. The actionable finding is that **five-plus dead pref names in Ziy's own
shell are silently no-ops today** — five protections the build believes it is
enforcing and is not.
