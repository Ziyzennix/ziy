# proofs-cpp-fingerprint.md — the fingerprinting-protection C++ delta evidence

**Scope.** The "Ziy" fork ships Brave's farbling as its fingerprinting contract
(`replica/re-deep-shields.md` §5, 19 farbled APIs). This workstream covers only
the deltas that **prefs + JS provably cannot reach**. Each one is written as a
gated, cited, reversible `git apply -p1` patch against the pristine
`firefox-156.0.1` tree.

**Status, stated once and precisely: every patch in this document is
`AUTHORED, NOT COMPILED`.** No patch here has been through a compiler, and
nothing here has been booted. The first compilation is the first run of
`.github/workflows/build-gecko.yml`. "Apply-verified" below means exactly the
four `git apply` commands and nothing more.

Engine revision: `sourcestamp.txt` `20260921121718`, rev
`6f2c158dfc7e9693f880fad2510ceb51a158c069` of `mozilla-release`, matching the
SHA512-verified `firefox-156.0.1.source.tar.xz`
(`80a32a79…24d5b`), i.e. the exact source of the shipped engine. Git tag
`FIREFOX_156_0_1_RELEASE` was used for the reference copies cited below
(line-for-line identical to the locally extracted 156.0.1 tree that was read for
authoring — verified by line-count and anchor comparison, see §6).

---

## 1. The patch set

| patch | file touched | delta | status |
| --- | --- | --- | --- |
| [`0001-rfp-colorscheme-carveout.patch`](../patches/0001-rfp-colorscheme-carveout.patch) | `toolkit/components/resistfingerprinting/nsRFPService.cpp` | read the engine's own overrides pref in `HandleExceptionalRFPTargets()` so `-CSSPrefersColorScheme` works in RFP mode | authored by another worker; **not re-verified here**, listed for sequence context only |
| [`0002-ziy-fingerprinting-option.patch`](../patches/0002-ziy-fingerprinting-option.patch) | `toolkit/moz.configure`, `toolkit/ziy-fingerprinting.configure` (new) | declare `--enable-ziy-fingerprinting`, `include()` it from `toolkit/moz.configure`, and `configure_error()` if the gate and the shipped prefs disagree | authored by another worker; **not re-verified here**, but verified to apply in §5 |
| [`0003-webgpu-adapter-strings.patch`](../patches/0003-webgpu-adapter-strings.patch) | `dom/webgpu/Adapter.cpp` | under RFP, empty the four unguarded `GPUAdapterInfo` wgpu* identity strings (`wgpuName`, `wgpuDeviceType`, `wgpuDriver`, `wgpuDriverInfo`) | **authored, apply-verified, NOT COMPILED** |
| [`0004-webgl-fake-extension.patch`](../patches/0004-webgl-fake-extension.patch) | `dom/canvas/ClientWebGLContext.cpp` | under RFP, append one fake extension name to `getSupportedExtensions()` so the GPU-derived list length stops identifying the machine | **authored, apply-verified, NOT COMPILED** |

Both of my patches are gated behind `MOZ_ZIY_FINGERPRINTING`, the define
`0002` declares. **Neither adds a new `RFPTarget`.** That is deliberate and is
the reason the shipped pref string stays valid — see §3.

---

## 2. 0003 — WebGPU adapter-identity strings

### The delta, in one sentence
Under RFP, `GPUAdapterInfo`'s four `[ChromeOnly]` wgpu* getters return empty
strings instead of the raw wgpu-native GPU name, device class, driver and
driver-info.

### Grounding
Brave's contract is `third_party/blink/renderer/modules/webgpu/gpu_adapter.cc:
BraveScrubWebGpuAdapterInfo` — row 17 (`brave-webcompat-webgpu`) of
`re-deep-shields.md` §5, "empty `vendor`/`architecture`/`device` strings".

Gecko's state, verified line by line:

* `dom/webidl/WebGPU.webidl:71-88` — `interface GPUAdapterInfo`. The four
  **standard** attributes `vendor`, `architecture`, `device`, `description` are
  declared here, and they are already permanently empty:
  `dom/webgpu/Adapter.h:60-63` is literally
  `void GetVendor(nsString& s) const { s = nsString(); }` and the same for
  `GetArchitecture`, `GetDevice`, `GetDescription`. So the *web-exposed* half of
  Brave's row 17 needs no patch at all — Gecko already does it.
* What is **not** covered is the non-standard `[ChromeOnly]` half, same webidl
  block: `wgpuName`, `wgpuVendor`, `wgpuDevice`, `wgpuDeviceType`, `wgpuDriver`,
  `wgpuDriverInfo`, `wgpuBackend`. The string-valued ones are unguarded:
  * `dom/webgpu/Adapter.cpp:83` `GetWgpuName()` — `s = mAboutSupportInfo->name;`
  * `dom/webgpu/Adapter.cpp:91` `GetWgpuDeviceType()` — a `switch` over
    `Cpu`/`DiscreteGpu`/`IntegratedGpu`/`VirtualGpu`/`Other`
  * `dom/webgpu/Adapter.cpp:114` `GetWgpuDriver()` — `s = …->driver;`
  * `dom/webgpu/Adapter.cpp:118` `GetWgpuDriverInfo()` — `s = …->driver_info;`
* Gecko's **entire** RFP coverage for WebGPU is three targets, all elsewhere in
  the same file: `WebGPULimits` (`Adapter.cpp:332`), `WebGPUIsFallbackAdapter`
  (`Adapter.cpp:73`), `WebGPUSubgroupSizes` (`Adapter.cpp:39` and `:62`). A grep
  of `RFPTarget` in `dom/webgpu/Adapter.cpp` returns exactly those four sites.
  None of them reaches the getters above.
* `Adapter.h:56-58` is the engine's own warning — "Changing implementation in a
  way that increases fingerprinting surface? Please create a bug in
  [Core::Privacy: Anti-Tracking]" — which is the engine telling us these values
  are fingerprinting surface.

### Why prefs + JS cannot do it
Same mechanism as 0001. In RFP mode
`toolkit/components/resistfingerprinting/nsRFPService.cpp:335`
`IsRFPEnabledFor()` returns `true` for every target before it consults the
override set, so the overrides pref cannot express "add coverage for this".
Adding a *new* `RFPTarget` to `RFPTargets.inc` would also change the meaning of
the `+AllTargets` term in the pref string Ziy locks, and would need the
`CreateOverridesFromText` path (`nsRFPService.cpp:2685`) touched. So the gate
reuses the engine's existing `WebGPUIsFallbackAdapter` — the target Gecko
already uses at `Adapter.cpp:73` for "Always report hardware support for WebGPU",
which is the same decision — and no enum value changes.

### Honest scope statement
This closes the *device-identity* half of Brave's row 17. It does **not**
implement Brave's Maximum-mode `GetScreenInfos` override (that is row 11, Screen,
and Gecko's `ScreenRect`/`ScreenAvailRect`/`WindowOuterSize`/`WindowScreenXY`/
`WindowInnerScreenXY`/`MouseEventScreenPoint` already spoof the values — see §4,
row 11, DROPPED).

---

## 3. 0004 — fake WebGL extension in `getSupportedExtensions()`

### The delta, in one sentence
Under RFP, `gl.getSupportedExtensions()` returns its usual list plus one fake
extension name.

### Grounding
Brave's contract is `third_party/blink/renderer/core/farbling/`
`webgl_farbled_extension_handler.cc` + `webgl_rendering_context_base.cc` — row 15
(`brave-webcompat-webgl`) of `re-deep-shields.md` §5, "inject 1 fake extension
name into `getSupportedExtensions()` (from 21 fakes)".

Gecko's state:

* `dom/canvas/ClientWebGLContext.cpp:6399` `GetSupportedExtensions()` builds the
  list straight from the driver's bitmask — `IsSupported` at `:6389` returns
  `limits.supportedExtensions[ext]`, and the loop over `WebGLExtensionID::Max`
  at `:6409-6414` appends each supported name. There is **no RFP branch in the
  function at all**.
* Gecko's WebGL RFP coverage, exhaustively:
  `WebGLRenderInfo` (`ClientWebGLContext.cpp:2521`, and `:6382` for
  `WEBGL_debug_shaders`), `WebGLVendorRandomize` (`:2524`),
  `WebGLVendorConstant` (`:2542`), `WebGLVendorSanitize` (`:2547`),
  `WebGLRenderCapability` (`:894`, `:1080`), `CanvasRandomization` /
  `WebGLRandomization` for the pixels. Every one guards a *string* or the
  *pixels*. None touches the extension list.
* The list is a real fingerprint: `EXT_texture_compression_*`,
  `WEBGL_compressed_texture_astc`, `OVR_multiview2` and
  `WEBGL_provoking_vertex` (all in the `GetExtensionName` table at
  `dom/canvas/WebGLContextExtensions.cpp:20-66`) name the GPU family, and the
  list *length* is a pure function of the driver's capability mask.

### Why the fake name is safe (not a footgun)
The fake name `KHR_parallel_shader_compile` is a real WebGL/Khronos extension
name, but it is **not** in the `GetExtensionName` table. `getExtension()`
resolves a name by matching against that same table
(`WebGLContextExtensions.cpp:88-98`), so `getExtension("KHR_parallel_shader_compile")`
returns `null`. A page that sees the name in the list and tries to use it gets an
object-less `null`, never a broken half-initialised extension. The
`alreadyListed` guard makes the patch idempotent if a future engine build adds
the name for real.

### Honest scope statement
Brave draws the fake name **per site** from a pool of 21. This patch uses **one
fixed** name. Per-site variety requires a per-site entropy source, which is
candidate 2 below and is **not implementable yet**. What the fixed name still
achieves, with no per-site entropy at all: the list *length* stops being a
function of the installed GPU, and an unreported name appears in the list. What
it does not achieve: the value does not vary per site.

---

## 4. Candidate 2 — per-site entropy (Nigori-style token). NOT WRITTEN.

### What Brave does
`components/brave_shields/core/browser/brave_shields_settings_service.cc:395-412`
(`GetFarblingToken`) reads one 128-bit `base::Token` per schemeful-site, stored
in the `braveShieldsMetadata` content setting under the single key
`farbling_token` (`brave_shields_settings_service.cc:31-56`,
`SetShieldsMetadata`). It is 32 uppercase hex chars (`%016X%016X`), which is
exactly the value observed in the user's profile. The PRNG is seeded per context
from it (`third_party/blink/renderer/core/farbling/brave_session_cache.cc:474-482`,
`MakePseudoRandomGenerator`: `token.high() ^ token.low() ^ key`), with two extra
XOR mutations — a storage-key container nonce (`brave_session_cache.cc:275-287`)
and a profile-session entropy (`brave_shields_settings_service.cc:418-425`, so
the token differs across browser restarts). Deleting site data wipes it
(`browser/ui/webui/settings/brave_site_settings_handler.cc:74-83`).

### What the Gecko side has instead
Gecko's randomization already has a per-*site* key, and it is *not* pref-writable:

* `toolkit/components/resistfingerprinting/nsRFPService.cpp:1324`
  `GetBrowsingSessionKey()` — a per-`OriginAttributes` `nsID`, held in
  `mBrowsingSessionKeys` (`nsRFPService.h:696`), **parent-process only**.
* `nsRFPService.cpp:1397` `GenerateKey(nsIChannel)` — HMAC-SHA256 over that
  session key and the top-level partition key, producing the canvas key.
  The partition key is set from the top-level URI
  (`nsRFPService.cpp:1429-1431`, `attrs.SetPartitionKey(topLevelURI, …)`), and
  the site string fed to the HMAC is `attrs.mPartitionKey` (`:1455-1462`).
* The lifetime is **browsing session**, not per-site-persistent: the key is
  generated on the first http channel after startup and persists until shutdown
  (`nsRFPService.h:686-691`). It is reset daily if
  `privacy.resistFingerprinting.randomization.daily_reset.enabled` is true
  (`StaticPrefList.yaml:18105`, default `true`) via `ClearBrowsingSessionKey`
  (`nsRFPService.cpp:1375`), and for private windows when the last private window
  closes (`LAST_PB_SESSION_EXITED_TOPIC`, `:501`).

### The honest answer: a Gecko-side per-site token needs TWO things that do not exist
1. **A pref-writable per-site key.** Brave's `farbling_token` lives in a content
   setting, which is per-site, user-writable, and inspectable. Gecko has no
   equivalent for the RFP layer: the only per-site knobs are
   `privacy.fingerprintingProtection.granularOverrides` (a JSON array of
   `{firstPartyDomain, overrides}` — resolved through
   `GetOverriddenFingerprintingSettingsForURI`, `nsRFPService.cpp:2975-3091`,
   via `mFingerprintingOverrides`, `nsRFPService.h:699`) and
   `privacy.resistFingerprinting.exemptedDomains`. Both carry **RFPTarget
   bitsets / domain lists**, not entropy. There is no field in either that could
   hold a per-site noise seed, and no pref that would be read as one.
2. **A seed for the RFP PRNG.** Gecko's randomization is seeded from a
   *session*-scoped `nsID::GenerateUUID()` (`nsRFPService.cpp:1369`), not from a
   per-site value. Deriving a per-site value would mean either (a) replacing that
   session key with a per-site key — which changes canvas/WebGL noise for every
   site and needs a whole new storage story — or (b) layering a second,
   site-derived seed on top, which is the thing with no home.

A patch that just XOR'd a constant into the canvas key would be *fake farbling*:
it would look like per-site noise and would not be per-site noise. Per the
"never deliver a misleading scaffold" rule, **no patch is written for candidate
2.** The design above is what a real implementation needs; it is not a diff.

### One consequence worth flagging
Because the farbling seed is session-scoped and reset daily, Brave's
"token differs across browser restarts" property (`kBraveFarblingTokenReset`)
is already *stronger* in Gecko: every restart re-rolls the key. A future
per-site token would have to decide whether to keep that (a per-site *persistent*
token would make the fingerprint *more* stable across sessions, i.e. worse).

---

## 5. Candidatern 3 — the dead-pref class (coverage the RFP layer documents but ignores)

### 5a. `privacy.resistFingerprinting.randomizationOnRestart` — A DEAD PREF ZIY LOCKS
Ziy locks this in `shell/mozilla.cfg:37` and sets it in
`shell/browser/defaults/preferences/ziy.js:140`. **The pref does not exist in the
engine.** It is absent from `modules/libpref/init/StaticPrefList.yaml` (whose
`privacy.resistFingerprinting.*` block is only `pbmode`, `block_mozAddonManager`,
`jsmloglevel`, `reduceTimerPrecision.jitter`,
`reduceTimerPrecision.microseconds`, `target_video_res`,
`randomization.daily_reset.enabled`,
`randomization.daily_reset.private.enabled`,
`randomization.canvas.use_siphash`), absent from
`modules/libpref/init/all.js` (which has only
`privacy.resistFingerprinting.exemptedDomains` and, via `firefox.js`,
`skipEarlyBlankFirstPaint`), and absent from every reader in the tree. It is a
silently-ignored lock: `lockPref` of a nonexistent pref succeeds and does
nothing.

**This is a shell-layer defect, not an engine delta**, so no C++ patch is
written for it. The engine's real equivalent is
`privacy.resistFingerprinting.randomization.daily_reset.enabled`
(`StaticPrefList.yaml:18105`, default `true`). The fix belongs in
`shell/mozilla.cfg` / `ziy.js`, replacing the dead name with the real one.
**Recommend relabeling this in the shell — do not add a C++ patch.**

### 5b. `privacy.spoof_english` — a real dead-pref in RFP mode
This one *is* an engine-side dead pref and is the cleanest member of the class.

`toolkit/components/resistfingerprinting/nsRFPService.cpp:308-313`
(`HandleExceptionalRFPTargets`) spoofs `JSLocale` only when
`StaticPrefs::privacy_spoof_english_DoNotUseDirectly() == 2`
(`"We only spoof language if the user has explicitly agreed to the prompt we
show when privacy.spoof_english is set to 0"`). The pref's own documentation
(`modules/libpref/init/StaticPrefList.yaml:17946-17953`) says `0 - will prompt`,
`1 - don't spoof`, `2 - spoof`, **default `0`** — i.e. in a default configuration
`JSLocale` is never spoofed, even in RFP mode, because `0 != 2`.

The intent of RFP is that `JSLocale` is spoofed; the pref's *documented default*
silently disables it. The JS half of the mechanism
(`toolkit/components/resistfingerprinting/RFPHelper.sys.mjs:176-193`,
`_handleSpoofEnglishChanged`) also only acts at `case 2`. So a user who wants
`privacy.resistFingerprinting=true` to mean "spoof my locale" has to know to set
`spoof_english=2`, and nothing in the RFP layer tells them.

**Decision: NOT written as a patch.** Two reasons. (1) It is not a delta
*prefs cannot reach* — `privacy.spoof_english=2` reaches it fully; it is an
undiscoverable default, not an unreachable capability. (2) Changing a
prompt-gated consent pref from inside the RFP service would be changing a
consent mechanism, which is a policy decision for the shell
(`mozilla.cfg` can `lockPref("privacy.spoof_english", 2)`), not an engine patch.
**The correct fix is one line in `shell/mozilla.cfg`.** Recorded here so it is
not lost, and explicitly not patched.

**Landed 2026-10-16** (the batch pass): `lockPref("privacy.spoof_english", 2)`
sits in `shell/mozilla.cfg` §1 with the deciding engine lines cited beside it,
mirrored as a default in `ziy.js` + `ziy-hardening.js`;
`preflight-prefs.py` → 97 locks, 172 declared, layers agree. Not
runtime-read-back (the same chrome-context boundary as `proofs-fix-prefs.md`
§4.5) — the record is source-cited, and the addendum lives in
`replica/proofs-fix-prefs.md` §6.

### 5c. `navigator.plugins` / `mimeTypes` — already covered, see §6 row 10.

---

## 6. The farbling contract, target by target: what was written and what was dropped

The 19 APIs of `re-deep-shields.md` §5, each checked against the real Gecko
source before anything was written. **"DROPPED" below means I verified that
Gecko's RFP already covers it and deliberately wrote nothing.**

| # | Brave target | Gecko RFP coverage found (file:line) | verdict |
| --- | --- | --- | --- |
| 1 | `brave-webcompat-audio` — audio | `RFPTarget::AudioSampleRate` forces `44100` (`dom/media/CubebUtils.cpp:499-512`), `RFPTarget::AudioContext` fixes latency (`dom/media/webaudio/AudioContext.cpp:558-577`), `MaxChannelCount`->2 (`:715-720`), and `AudioDestinationNode.cpp:198`. | **DROPPED — RFP already spoofs it.** Gecko spoofs the *observable* audio parameters (sample rate, channel count, output latency) rather than perturbing sample data. Brave's fudge factor perturbs `getByteTimeDomainData` samples; Gecko does not. Not patchable without a PRNG source (see candidate 2), and the sample-level delta is Brave's own extra, not a Gecko gap in a documented capability. |
| 2 | `brave-webcompat-canvas` | `CanvasRandomization` (9) / `EfficientCanvasRandomization` (76) / `WebGLRandomization` (75) — the whole per-site canvas HMAC pipeline, `nsRFPService.cpp:1397-1470` | **DROPPED — RFP already spoofs it, and is per-site** (the one thing candidate 2 says Gecko lacks). |
| 3 | `brave-webcompat-device-memory` | `navigator.deviceMemory` **does not exist in Gecko**. Not in `dom/webidl/Navigator.webidl`, not in `WorkerNavigator.webidl`, no `deviceMemory` anywhere in `dom/` or `modules/`. | **DROPPED — nothing to patch.** The API is absent, so there is no fingerprinting surface to farble. |
| 4 | `brave-webcompat-event-source-pool` | `dom/base/EventSource.cpp` has no `ResourcePoolLimiter`/pool concept; grep for `PoolLimiter` across `dom/`, `toolkit/`, `modules/` returns nothing. Brave's mechanism (a `ResourcePoolLimiter` in-use tracker that refuses the Nth connection) has no Gecko counterpart to gate. | **DROPPED — not implementable in the cited file.** Would mean inventing a connection-pool budget subsystem, which is a feature, not a delta. |
| 5 | `brave-webcompat-font` | `RFPTarget::FontVisibilityBaseSystem` (43) / `FontVisibilityLangPack` (44) / `FontVisibilityRestrictGenerics` (62) — `toolkit/components/resistfingerprinting/FontVisibilityProvider.cpp:49-115` `ComputeFontVisibility()`. | **DROPPED — RFP already spoofs it.** Gecko's is stricter than Brave's: a three-level visibility model that hides non-base fonts from matching entirely, plus `UseHardcodedFontSubstitutes` (69). |
| 6 | `brave-webcompat-hardware-concurrency` | `RFPTarget::NavigatorHWConcurrency` (16) / `NavigatorHWConcurrencyTiered` (74) — `dom/workers/RuntimeService.cpp:2103-2154` `ClampedHardwareConcurrency()`; consumers `dom/base/Navigator.cpp:704-712`, `dom/workers/WorkerNavigator.cpp:237-239`. | **DROPPED — RFP already spoofs it** (hardcoded 4, or 8 on macOS). |
| 7 | `brave-webcompat-keyboard` | `RFPTarget::KeyboardEvents` (36) / `WidgetEvents` — `dom/events/KeyboardEvent.cpp:347-368` `ShouldResistFingerprinting()`, plus `nsRFPService::GetSpoofedKeyCodeInfo` (`nsRFPService.cpp:1271-1315`) and the KeyCodeConsensus table. | **DROPPED — RFP already spoofs it.** Brave's `navigator.keyboard` is a webidl attribute that **Gecko does not expose at all** (`grep keyboard dom/webidl/Navigator.webidl` → nothing). The KeyboardEvent half is covered. |
| 8 | `brave-webcompat-language` | `RFPTarget::JSLocale` (13) — with the `spoof_english` caveat in §5b | **DROPPED — RFP already spoofs it**; the only gap is the default, handled in §5b, not patched. |
| 9 | `brave-webcompat-media-devices` | `RFPTarget::MediaDevices` (37) — `dom/media/MediaManager.cpp:2987` (constraint reduction), `:3410-3411` (`AnonymizeDevices`), `:3550`; `nsRFPService::GetMediaDeviceName` / `GetMediaDeviceGroup` (`nsRFPService.cpp:3094-3121`) return fixed "Internal Microphone/Camera/Speaker" and "Audio/Video Device Group". | **DROPPED — RFP already spoofs it**, including Brave's shuffle-free fixed naming. |
| 10 | `brave-webcompat-plugins` | `RFPTarget::PdfjsSpoof` (20) — `dom/base/nsPluginArray.cpp:100-105` `ForceNoPlugins()`, `dom/base/Navigator.cpp:530-534` `PdfViewerEnabled()`, `dom/base/nsMimeTypeArray.cpp:84`. | **DROPPED — RFP already spoofs it**, and in RFP mode the array is empty, which is Brave's Maximum behaviour. Brave's "fake plugin names" is its Balanced mode. |
| 11 | `brave-webcompat-screen` | `ScreenRect` (30), `ScreenAvailRect` (31), `ScreenAvailToResolution` (68) — `dom/base/nsScreen.cpp:72-73,104-105,128`; `WindowOuterSize` (26) — `nsGlobalWindowOuter.cpp:3518-3526`; `WindowScreenXY` (27) — `:3579-3583`; `WindowInnerScreenXY` (28) — `:3665-3671, :3680-3686`; `MouseEventScreenPoint` (42) — `dom/events/MouseEvent.cpp:300-318`. | **DROPPED — RFP already spoofs it**, every value Brave farbles. |
| 12 | `brave-webcompat-speech-synthesis` | `RFPTarget::SpeechSynthesis` (5) — `dom/media/webspeech/synth/SpeechSynthesis.cpp:243-246` (`GetVoices` returns early, empty list) and `:321-325`. | **DROPPED — RFP already spoofs it**, empty list = Brave's Maximum. |
| 13 | `brave-webcompat-usb-device-serial-number` | `USBDevice` has **no implementation in Gecko**. The names are listed in `dom/webidl/Window.webidl:153-162` and `dom/base/UseCounters.conf:334`, but there is no `dom/webusb/` directory, no `USBDevice.webidl`, and `dom/bindings/moz.build` has no `MOZ_WEBUSB` gate. `dom.webbluetooth.enabled` is a separate thing and Ziy already locks it false (`shell/mozilla.cfg:57`). | **DROPPED — nothing to patch.** The API is not in the tree. |
| 14 | `brave-webcompat-user-agent` | `RFPTarget::NavigatorUserAgent` (19) / `HttpUserAgent` (25) / `NavigatorAppVersion` (14) / `NavigatorBuildID` (15) / `NavigatorOscpu` (17) / `NavigatorPlatform` (18) — `dom/base/Navigator.cpp` throughout. | **DROPPED — RFP already spoofs it** (fixed UA, not a noisy one). Brave's trailing-space trick is a different (weaker) strategy. |
| 15 | `brave-webcompat-webgl` | vendor/renderer covered (`ClientWebGLContext.cpp:2521,2524,2542,2547`), pixels covered, but **the extension list is not** | **WRITTEN — patch 0004.** |
| 16 | `brave-webcompat-webgl2` | same handler as row 15; `mIsWebGL2` only changes the version string (`ClientWebGLContext.cpp:2487-2493`) | **WRITTEN — patch 0004 covers webgl2 too** (same function, both contexts). |
| 17 | `brave-webcompat-webgpu` | four WebGPU targets exist, none reaches the adapter-identity strings | **WRITTEN — patch 0003.** |
| 18 | `brave-webcompat-web-sockets-pool` | `dom/websocket/WebSocket.cpp` — no pool/budget concept, no `PoolLimiter` anywhere in the tree. | **DROPPED — not implementable in the cited file.** Same reasoning as row 4. |
| 19 | `brave-webcompat-none` | sentinel | n/a |

**Summary: 19 candidates, 2 written (0003, 0004), 17 dropped.**
Of the 17 dropped: 13 because Gecko's RFP already spoofs the value, 4 because
the API has no implementation in Gecko at all (rows 3, 7's `navigator.keyboard`,
13, and — by absence — 4 and 18's pool machinery).

---

## 7. Apply evidence — the four commands, all RC=0

Run from the root of a pristine `firefox-156.0.1` tree with the four patches
applied **in sequence** 0001 → 0002 → 0003 → 0004 and reversed in the reverse
order. Reference copies used for the byte-compare are the authoritative
`FIREFOX_156_0_1_RELEASE` files listed in §8.

```
$ git apply --check --verbose 0001-rfp-colorscheme-carveout.patch
Checking patch toolkit/components/resistfingerprinting/nsRFPService.cpp...
   RC=0
$ git apply 0001-rfp-colorscheme-carveout.patch
   RC=0

$ git apply --check --verbose 0002-ziy-fingerprinting-option.patch
Checking patch toolkit/moz.configure...
Checking patch toolkit/ziy-fingerprinting.configure...
   RC=0
$ git apply 0002-ziy-fingerprinting-option.patch
   RC=0

$ git apply --check --verbose 0003-webgpu-adapter-strings.patch
Checking patch dom/webgpu/Adapter.cpp...
   RC=0
$ git apply 0003-webgpu-adapter-strings.patch
   RC=0

$ git apply --check --verbose 0004-webgl-fake-extension.patch
Checking patch dom/canvas/ClientWebGLContext.cpp...
   RC=0
$ git apply 0004-webgl-fake-extension.patch
   RC=0
```

Post-apply state (all four landed):

```
 M dom/canvas/ClientWebGLContext.cpp
 M dom/webgpu/Adapter.cpp
 M toolkit/components/resistfingerprinting/nsRFPService.cpp
 M toolkit/moz.configure
?? toolkit/ziy-fingerprinting.configure

 dom/canvas/ClientWebGLContext.cpp                  | 58 ++++++++++++++++++++
 dom/webgpu/Adapter.cpp                             | 62 ++++++++++++++++++++++
 .../resistfingerprinting/nsRFPService.cpp          | 35 ++++++++++++++
 toolkit/moz.configure                              |  5 ++
 4 files changed, 160 insertions(+)
 toolkit/ziy-fingerprinting.configure (new file)
```

Reverse, in reverse order, every command RC=0:

```
$ git apply --reverse --check 0004-webgl-fake-extension.patch   -> RC=0
$ git apply --reverse         0004-webgl-fake-extension.patch   -> RC=0
$ git apply --reverse --check 0003-webgpu-adapter-strings.patch  -> RC=0
$ git apply --reverse         0003-webgpu-adapter-strings.patch  -> RC=0
$ git apply --reverse --check 0002-ziy-fingerprinting-option.patch -> RC=0
$ git apply --reverse         0002-ziy-fingerprinting-option.patch -> RC=0
$ git apply --reverse --check 0001-rfp-colorscheme-carveout.patch -> RC=0
$ git apply --reverse         0001-rfp-colorscheme-carveout.patch -> RC=0
```

Post-reverse `git status` is **empty**, and each file byte-compares identical to
its pristine reference:

```
  IDENTICAL  dom/webgpu/Adapter.cpp
  IDENTICAL  dom/canvas/ClientWebGLContext.cpp
  IDENTICAL  toolkit/components/resistfingerprinting/nsRFPService.cpp
  IDENTICAL  toolkit/moz.configure
  REMOVED    toolkit/ziy-fingerprinting.configure
```

### Gate-off proof (patches/README.md step 6)
Stripping the `#ifdef MOZ_ZIY_FINGERPRINTING` blocks from the patched files and
comparing to pristine:

```
  dom/webgpu/Adapter.cpp:                  gate-off == stock Gecko -> True
  dom/canvas/ClientWebGLContext.cpp:       gate-off == stock Gecko -> True
  toolkit/.../nsRFPService.cpp:            gate-off == stock Gecko -> False
```

0003 and 0004 are **byte-identical to stock Gecko with the gate off** — each
`#ifdef` is placed so stripping it leaves no residue. The one `False` is
**0001**, which is the shipped example patch authored by another worker: its
`#ifdef` block is followed by a blank line, so stripping leaves exactly one
blank line behind. Flagged here rather than silently "fixed", because 0001 is
not mine to change; if the maintainer wants the strict byte-identity there too,
the one-line fix is to delete the blank line after 0001's `#endif`.

### Structural audit of the applied tree
```
toolkit/components/resistfingerprinting/nsRFPService.cpp
   braces: {=421  }=421  balanced=True
   MOZ_ZIY_FINGERPRINTING references=2
dom/webgpu/Adapter.cpp
   braces: {=79  }=79  balanced=True
   MOZ_ZIY_FINGERPRINTING references=8
dom/canvas/ClientWebGLContext.cpp
   braces: {=1246  }=1246  balanced=True
   MOZ_ZIY_FINGERPRINTING references=2
```
Both configure files parse as valid Python (moz.configure files are Python), and
the gate is reachable from the configure graph:
`grep -n 'include("ziy-fingerprinting.configure")' toolkit/moz.configure` → line
4647.

---

## 8. How the references were obtained (honest sourcing note)

The locally extracted `firefox-156.0.1` tree used for authoring was lost to a
`/tmp` wipe partway through this workstream (the working scratch tree and the
extracted source tree were both removed). The patches were authored and first
verified against that tree before the loss. For the **re-verification** recorded
above, the four touched files were re-fetched from the authoritative mirror
`raw.githubusercontent.com/mozilla-firefox/firefox/FIREFOX_156_0_1_RELEASE/…`:

| file | lines | matches the tree read for authoring |
| --- | --- | --- |
| `dom/webgpu/Adapter.cpp` | 627 | yes |
| `dom/canvas/ClientWebGLContext.cpp` | 7618 | yes |
| `toolkit/components/resistfingerprinting/nsRFPService.cpp` | 3496 | yes |
| `toolkit/components/resistfingerprinting/RFPTargets.inc` | 139 | yes |
| `toolkit/components/resistfingerprinting/RFPTargetsDefault.inc` | 37 | yes |
| `dom/canvas/WebGLContextExtensions.cpp` | 571 | yes |
| `dom/webidl/WebGPU.webidl` | 1423 | yes |
| `dom/webgpu/Adapter.h` | 123 | yes |
| `toolkit/moz.configure` | 4642 | yes, and its last line matches 0002's hunk context |
| `modules/libpref/init/StaticPrefList.yaml` | 21321 | yes |

Every `file:line` citation in this document and in the two patches was re-checked
against those re-fetched files. Two citations that the loss exposed as wrong
(`Adapter.cpp:118/155/165` for the getter line numbers, and
`RFPTargets.inc:59-60` for `WebGLRenderCapability`) were corrected to the true
lines `Adapter.cpp:83/91/114/118` and `RFPTargets.inc:91`. The `Section` symbol
in the patches is the real `§` character.

---

## 9. What is NOT claimed

* **Nothing here has been compiled.** No `./mach build`, no `clang`, no
  `libxul`. The brace counts and the Python `compile()` check are the only
  structural checks run, and they are not a compile.
* **Nothing here has been booted.** No engine behaviour has been observed.
* **The patches are not known to compile.** 0003 calls
  `GetParentObject()->ShouldResistFingerprinting(RFPTarget::WebGPUIsFallbackAdapter)`
  inside a `const` member — the same call shape the file already uses at
  `Adapter.cpp:71-72` and `:332`, so it should, but "should" is not "did".
  0004 uses `ShouldResistFingerprinting(RFPTarget::WebGLRenderCapability)` — same
  shape as `:894`/`:1080` in the same class — and
  `LowerCaseEqualsLiteral`, used elsewhere in the tree (e.g.
  `dom/script/ScriptLoader.cpp:473`). Neither has been through a compiler.
* **0004 is a partial implementation of Brave's row 15** (fixed name, not
  per-site) for the reason in §3, and 0003 is a partial implementation of row 17
  (the `wgpu*` strings, not the standard attributes, which Gecko already empties).
* **0001 and 0002 were not re-verified by me.** They are included in the
  sequence run above, which is how I know they still apply; I did not re-derive
  or re-review their content.
* **The two shell-layer findings in §5 are not patches** and are not fixed here.
  `privacy.resistFingerprinting.randomizationOnRestart` is a dead lock that
  should be replaced by
  `privacy.resistFingerprinting.randomization.daily_reset.enabled`, and
  `privacy.spoof_english` should be locked to `2` if Ziy wants JSLocale spoofed
  without the prompt. Both belong to the shell owner.
