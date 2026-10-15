# research-android.md — the Android feasibility spec, verified and honest

**Date:** 2026-10-16 · **Workstream:** Android feasibility research (spec only — no app, no
code, no emulator, no build) · **Read first:** `replica/architecture.md` §0 (platform matrix),
`replica/AI-BRIEF.md`, `brand/MASCOT.md`, `replica/design/tokens.css`.

## THROWAWAY-NOTHING STATEMENT — read this before any other line

**NOTHING IN THIS DOCUMENT WAS RUN ON ANDROID.** No APK was built, no emulator or device was
launched, no Gradle project was created, no GeckoView artifact was downloaded or executed, and
no extension was installed into a GeckoView runtime. Every claim below is either (a) read from
a document I actually fetched in this session, cited with its URL, or (b) measured from this
repository's own files on this Linux machine, cited by path. Anything that is neither is
labelled **UNVERIFIED**. This is a feasibility spec for a decision, not evidence that anything
works on a phone.

Confidence labels used throughout:

| label | meaning |
| --- | --- |
| **OBSERVED** | the cited URL states this verbatim, or the cited repo file was read/counted here |
| **DOC-INFERRED** | the cited URLs state the premises; the join is mine |
| **UNVERIFIED** | not established by any source I could fetch — stated as a gap, not guessed |

---

## 1. The GeckoView verdict — the integration path, verified

**Verdict: GeckoView is the engine path, and `WebExtensionController.installBuiltIn()` is a real,
documented, signature-free way to ship our unsigned suite. The Android app is a real program we
must write; it is not a port of the Linux shell.**

### 1.1 The maven coordinates, language level, and what a minimal WebView activity needs

All from the official quick-start page
(<https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/geckoview-quick-start.html>,
fetched 2026-10-16):

| item | what the page says | label |
| --- | --- | --- |
| Dependency | `implementation "org.mozilla.geckoview:geckoview-${geckoviewChannel}:${geckoviewVersion}"` — three release channels: **Stable, Beta, Nightly** | **OBSERVED** |
| Maven repo | `repositories { maven { url "https://maven.mozilla.org/maven2/" } }`; the version list is browsable at `https://maven.mozilla.org/?prefix=maven2/org/mozilla/geckoview/` | **OBSERVED** |
| Java level | "As GeckoView uses some Java 17 APIs, it requires these compatibility flags": `sourceCompatibility`/`targetCompatibility` = `JavaVersion.VERSION_17` | **OBSERVED** |
| Layout | one widget: `<org.mozilla.geckoview.GeckoView android:id="@+id/geckoview" …/>` | **OBSERVED** |
| Minimal activity | create a `GeckoSession`, `session.setContentDelegate(new GeckoSession.ContentDelegate() {})` (the page calls this a **workaround for Bug 1758212**), create a **static** `GeckoRuntime` ("GeckoRuntime can only be initialized once per process"), then `session.open(sRuntime)`, `view.setSession(session)`, `session.loadUri(...)` | **OBSERVED** |
| Manifest | `android:windowSoftInputMode="stateUnspecified\|adjustResize"` for the css `interactive-widget` viewport spec | **OBSERVED** |
| Reference apps | the **Android Components** library collection ("Building a browser? Check out Android Components, our collection of ready-to-use support libraries!"), plus `mobile/android/geckoview_example` | **OBSERVED** |

**Minimum API level — verified, and it is a real floor.** `minSdkVersion` is not stated on the
consumer quick-start page. It is stated in GeckoView's build:
`mobile/android/geckoview/build.gradle` (fetched from
<https://github.com/mozilla/gecko-dev/blob/master/mobile/android/geckoview/build.gradle>, raw,
2026-10-16) reads `minSdkVersion = project.ext.minSdkVersion` and
`buildConfigField 'int', 'MIN_SDK_VERSION', mozconfig.substs.MOZ_ANDROID_MIN_SDK_VERSION` —
i.e. it comes from mozconfig, not a literal, so the page alone does not give the number. The
tracking bug does:
<https://bugzilla.mozilla.org/show_bug.cgi?id=1982312> — *"Raise minSdkVersion to 26 (Android 8)
for Geckoview"* — **RESOLVED FIXED, target milestone `firefox145`**, last activity 2026-04-28
(**OBSERVED**). Bug 1985246 ("Downgrade minSdkVersion to 21 for GeckoView example") closed
alongside it. **DOC-INFERRED:** for a GeckoView 145+ dependency (Ziy targets the 156 line),
`minSdk = 26` (Android 8.0) is the floor we design to. The exact value for the specific
`geckoview` artifact version we pin must be re-read from that artifact's own build at
pinning time — **UNVERIFIED for the pinned version.**

### 1.2 `installBuiltIn()` — the mechanism, verified verbatim

From the GeckoView consumer docs
(<https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html>,
fetched 2026-10-16):

- Extensions "can be provided in a folder in the `/assets` section of the APK"; GeckoView's
  shorthand for the APK root is **`resource://android/`**, so `resource://android/assets/messaging/`
  points at `/assets/messaging/` in the APK. **OBSERVED.**
- Install call: `runtime.getWebExtensionController().installBuiltIn("resource://android/assets/messaging/")`.
  **OBSERVED.**
- "Note that the lifetime of the extension is not tied with the lifetime of the `GeckoRuntime`
  instance. The extension persists even when your app is restarted. Installing at every start
  up is fine, but it could be slow. To avoid installing multiple times you can use
  `WebExtensionRuntime.ensureBuiltIn`" — `ensureBuiltIn(uri, id)` **only installs if not
  already installed**. **OBSERVED.**
- Every bundled extension "will need an `id` and `version` specified in the `manifest.json`
  file" — i.e. `browser_specific_settings.gecko.id` must be present. **OBSERVED.**
- Native messaging **does not need a host manifest** in GeckoView: "Ordinarily, native
  extensions would use a native manifest to define what native app identifier to use. For
  GeckoView this is *not* needed, the `nativeApp` parameter in `setMessageDelegate` will be
  used to determine what native app string is used." The identifier may be any string matching
  `[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*`. **OBSERVED.**
- The privileges are gated on **manifest permissions that are not on MDN**: "these APIs are
  only available when the `geckoViewAddons` permission is present in the `manifest.json` …
  These permissions are not documented on MDN, and are only available to privileged extensions
  such as built-in extensions." Content-script messaging additionally needs
  `nativeMessagingFromContent`. **OBSERVED.**
- The doc's own worked example uses **`manifest_version: 2`** with
  `"permissions": ["nativeMessaging","nativeMessagingFromContent","geckoViewAddons"]`.
  **OBSERVED** — and note the caveat in §4 below about MV3 + these permissions.

From the authoritative API javadoc
(<https://mozilla.github.io/geckoview/javadoc/mozilla-central/org/mozilla/geckoview/WebExtensionController.html>,
"geckoview 160.0a1 API", fetched 2026-10-16):

> `installBuiltIn(String uri)` — "Install a built-in extension. Built-in extensions have access
> to native messaging, don't need to be signed and are installed from a folder in the APK
> instead of a `.xpi` bundle. … `uri` — Folder where the extension is located. **To ensure this
> folder is inside the APK, only `resource://android` URIs are allowed.**" **OBSERVED.**

And from the managing-extensions design doc
(<https://firefox-source-docs.mozilla.org/mobile/android/geckoview/design/managing-extensions.html>,
fetched 2026-10-16): the embedder "will be able to install bundled first-party extensions using
`installBuiltIn`. This method will only accept URIs that start with `resource://` and will give
additional privileges like being able to use app messaging and not needing a signature." The
same doc documents `registerWebExtension`/`unregisterWebExtension` as **deprecated in favour
of** `installBuiltIn`/`uninstall` — so `installBuiltIn` is the current, not legacy, path.
**OBSERVED.**

**What this replaces, and what it does not.** This is the Android equivalent of our `omni.ja`
`MOZ_REQUIRE_SIGNING` patch: it gets an unsigned suite installed (architecture.md §0.1's
assertion is **correct**). It does **not** give us app-dir branding, autoconfig, `policies.json`,
or chrome skinning — architecture.md §0.1 already marks those impossible, and nothing fetched
here contradicts that.

### 1.3 The recommended shell stack — Kotlin, not Flutter, not raw Compose

**Recommendation: a Kotlin Android app on Mozilla's Android Components (Kotlin), GeckoView
pinned to the Stable channel from maven.mozilla.org.** Verified basis:

- The quick-start page itself points browser builders at Android Components
  ("Building a browser? Check out Android Components, our collection of ready-to-use support
  libraries!") — **OBSERVED**.
- Android Components is maintained on `main` in the `mozilla-mobile/firefox-android` repo, published
  to the same `maven.mozilla.org`, and its component list (read from
  <https://github.com/mozilla-mobile/firefox-android/blob/main/android-components/README.md>,
  2026-10-16) includes, all marked **Production ready** (🔵): **Engine-Gecko** ("Engine
  implementation based on GeckoView"), **Toolbar**, **Tabstray**, **Session-Storage**, **State**,
  **Menu**, **Awesomebar**, **Context Menu**, **Prompts**, **Site Permissions**, **Downloads**
  ("perform downloads using the Android downloads manager"), **Find In Page**, **Web Add-ons**
  ("functionality for managing add-ons"), **Autofill**, **Share**, **Icons**, **Thumbnails**,
  **Top Sites**, **Errorpages**, **Sync**. **OBSERVED.**
  **DOC-INFERRED:** that list is close to a line-item inventory of what architecture.md §0.2
  says we must rebuild — toolbar, tabs tray, menu, downloads, find-in-page, site permissions,
  autofill. Using Components is the difference between writing a browser shell and writing one
  from `GeckoView` primitives.
- `GeckoView`'s own site (<https://mozilla.github.io/geckoview/>, fetched 2026-10-16) states
  GeckoView is "**Self-Contained**: Because GeckoView is a standalone library that you bundle
  with your application, you can be confident that the code you test is the code that will
  actually run" — which is the exact property Ziy's whole engine-pinning story depends on.
  **OBSERVED.**
- Compose vs Views: Android Components is a **Views/Kotlin** library. Nothing I fetched
  documents a Compose-native Components track. **UNVERIFIED** — and the practical read is
  **DOC-INFERRED**: choosing Compose for the shell means writing the toolbar/tabs/menu
  ourselves and interop-wrapping Components, which inverts the saving. **Recommendation: Views +
  Android Components**, brand-skinned with `replica/design/tokens.css` values.

---

## 2. The Flutter verdict — settled, and the answer is no

**Verdict: no maintained first-party Flutter×GeckoView bridge exists. `webview_flutter`, the
Flutter team's official plugin, is backed by the system WebView — which on Android is Chromium,
i.e. the engine Ziy explicitly rejected. Do not choose Flutter for the Ziy Android app.**

| question | finding | source | label |
| --- | --- | --- | --- |
| Does Flutter's official webview plugin use GeckoView? | **No.** `webview_flutter` is "A Flutter plugin that provides a WebView widget **backed by the system webview**", latest 4.14.1, repo `github.com/flutter/packages`; its dependencies are `webview_flutter_android`, `webview_flutter_wkwebview`, `webview_flutter_platform_interface` — i.e. Android system WebView (= Chromium) and WKWebView. | <https://pub.dev/packages/webview_flutter> | **OBSERVED** |
| Does Mozilla ship a Flutter×GeckoView plugin? | **No.** Mozilla's mobile story is Kotlin: the quick-start points at Android Components; the Android Components README enumerates Kotlin components and a Kotlin **reference-browser** ("A fully-featured reference browser implementation based on the components can be found in the reference-browser repository"). No Flutter component appears anywhere in that list. No `flutter_gecko` or equivalent was found in mozilla-mobile or mozilla/geckoview. | quick-start; <https://github.com/mozilla-mobile/firefox-android/blob/main/android-components/README.md> | **OBSERVED** |
| Does any third-party bridge exist? | One, and it is thin and pre-1.0: `webview_flutter_geckoview` — "The Gecko implementation of `webview_flutter`", latest **0.0.1+2**, published ~3 months ago, verified publisher `zeekr.dev`, MIT, deps `webview_flutter_platform_interface: ^2.14.0`. | <https://pub.dev/packages/webview_flutter_geckoview> | **OBSERVED** |
| Is that bridge a browser? | No. It implements the *webview widget platform interface* — a rendering surface. It exposes no tab model, no `WebExtensionController`, no `installBuiltIn`, no `setMessageDelegate`. | pub.dev package description (surface read) | **DOC-INFERRED** |
| Was there ever a Mozilla Flutter experiment? | I found no first-party Flutter GeckoView artifact to cite, only community work (e.g. `XertDev/gecko_view_flutter`, `Mahdijamebozorg/firefox_webview_flutter`, both described "WIP, Android only", single-digit stars). | web search results (repo pages) | **UNVERIFIED** for the *history*, **OBSERVED** that nothing maintained is on pub.dev |

**What Flutter would actually cost us if we insisted.** The bridge we would need —
`installBuiltIn` + `setMessageDelegate` + the `geckoViewAddons`/`nativeMessagingFromContent`
permissions — is **Kotlin either way**. Flutter adds: a second UI toolkit and its render loop, a
platform-channel layer for every delegate, an unmaintained pre-1.0 dependency for the one thing
it was adopted for, and a duplicate branding implementation of `tokens.css` in Dart. The Linux
product is HTML/CSS/JS extensions; the Android extension surfaces stay HTML/CSS/JS regardless.
**DOC-INFERRED: Flutter's only genuine win (one codebase for iOS later) is unavailable here,
because the iOS engine question is unanswered and was not in this assignment's scope —
UNVERIFIED, and out of scope for this spec.**

---

## 3. Per-extension portability table

Manifest facts below were read from `extensions/*/manifest.json` on 2026-10-16. Platform support
is from MDN Browser Compat Data (`firefox_android` column), fetched 2026-10-16 from
`https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/...`.

**Critical BCD fact that governs this whole table:** the `webextensions` BCD `firefox_android`
column describes **Firefox for Android**, the shipping consumer app. A **GeckoView embedder app
is a different host** — its extension host is whatever Gecko ships in the artifact we pin, plus
the privileged built-in path. So "BCD says false" means *"Firefox for Android does not expose
this"*; it does **not** by itself prove a GeckoView embedder cannot. What we can say with
confidence is the pairing: **an API BCD marks unsupported on `firefox_android` is implemented
(where at all) in the browser chrome, which in a GeckoView app is *our* Kotlin code** — so it
must be re-implemented as app code regardless. This distinction is the spine of the table.

| extension | API surface actually used (read from manifest + sources) | Android reality (verified) | required re-implementation | size |
| --- | --- | --- | --- | --- |
| **ziy-shields** | `declarativeNetRequest`, `webRequest`, `webRequestBlocking`, `webNavigation`, `scripting`, `alarms`, `storage`, `tabs`, `activeTab`, host `<all_urls>`; one static ruleset `ziy-shields-lists` → `rules/static-ruleset.json` | **All available.** BCD: DNR `firefox_android: mirror` (≥113); `webRequest` 48; `webRequestBlocking` 48 mirror; `webNavigation` 48; `scripting` 102 mirror; `alarms` 48; `activeTab` 48 mirror; `tabs` 54. | **None for the engine itself — this is the one extension that ports nearly intact.** Three real items: (1) **verify the ruleset loads at all** — see §4.1; (2) the panel (`ui/`, the Shields popup) becomes a **Kotlin bottom sheet / full-screen app view** hosting the extension page, because toolbar/sidebar chrome is ours; (3) per-site precedence UI moves to app code. | **S–M** |
| **ziy-sync** | `storage`, `nativeMessaging`, `bookmarks`, `history`, `tabs`; background opens `runtime.connectNative("ziy-sync-agent")` on a persistent port | `nativeMessaging` **permission is `firefox_android: false`** (BCD) — but GeckoView built-ins get it via `geckoViewAddons` + `setMessageDelegate`, **no host manifest** (verified §1.2). `bookmarks` API **false**, `history` API **false** on `firefox_android`. `tabs` 54, `storage.local` 48. | **The host protocol is replaced, not ported**: write a Kotlin `WebExtension.MessageDelegate` (and `PortDelegate` for the persistent port — GeckoView docs document `onConnect`/`WebExtension.Port` for exactly this shape) that speaks the same length-prefixed JSON protocol, with the agent's crypto + protocol logic re-hosted as Kotlin. `bookmarks`/`history` sync categories must go through our own Kotlin store until the engine exposes them. `server/` needs no change. | **M** |
| **ziy-ntp** | `storage`, `topSites`, `search`, `chrome_url_overrides.newtab` → `ui/ntp.html` | **The override is impossible**: `chrome_url_overrides` (incl. `newtab`) is `version_added: false` on `firefox_android`. Worse, the data sources are gone too: `topSites` is `version_added 52, version_removed 79`, and `search` is `false` on `firefox_android`. | **The Android app must draw its own home screen** and serve the NTP document (the same `ui/ntp.html` + `ntp.css` can be loaded verbatim in a hidden/second GeckoSession or a WebView — the HTML/CSS is reusable, the *hosting* is not). Top-sites and search suggestions must come from Kotlin code (Android Components ships **Top Sites**, **Awesomebar**, **Search** components — verified §1.3). | **M** |
| **ziy-news** | `storage`, `alarms`, host `<all_urls>`, `sidebar_action` panel | `storage`/`alarms` fine (48). `sidebar_action` is `false` on `firefox_android`. | The panel becomes a **Kotlin screen** loading `ui/panel.html` from the installed extension's `moz-extension://` base URL (GeckoView's `WebExtensionController.AddonManagerDelegate.onReady` supplies `baseUrl` as a `moz-extension://` URL — verified in the managing-extensions doc). Feed fetching/background logic ports unchanged. | **S** |
| **ziy-playlist** | `storage`, `tabs`, `webRequest`, `webRequestBlocking`, `scripting`, host `<all_urls>`; `sidebar_action`; IndexedDB `ziy-playlist` store; content script captures page media | `webRequest`/`webRequestBlocking`/`scripting` all available. `sidebar_action` false. Media capture in a content script is a web-API surface, not a chrome one — **DOC-INFERRED** it survives. | Sidebar → Kotlin screen hosting `ui/panel.html`. Two hard items: (a) **the IndexedDB blob/media store** — `storage.local` is fine for settings, but the playlist's media items live in IndexedDB opened from the extension page, whose lifetime and quota inside a GeckoView app are **UNVERIFIED**; (b) background media playback needs a foreground-service/`MediaSession` treatment, which is Android host behaviour our extension never had to think about — **UNVERIFIED**. | **M** |
| **ziy-talk** | `storage`, `tabs`, `sidebar_action`; panel embeds a hosted meeting in an `<iframe allow="camera; microphone; display-capture; fullscreen; autoplay">` | `sidebar_action` false. Everything else is web-platform. | Sidebar → full-screen Kotlin screen hosting `ui/panel.html`. The iframe model survives **DOC-INFERRED**, but **camera/microphone/display-capture permission grants from inside an embedded extension page are UNVERIFIED** — GeckoView has `GeckoSession.PermissionDelegate` and the app must hold the Android runtime permissions (`CAMERA`, `RECORD_AUDIO`), a host concern the desktop product never had. | **S–M** |
| **ziy-pwd** | `storage`, `nativeMessaging`, `tabs`, `activeTab`; 295-line `lib/pwd-client.js` speaking the port protocol to the `ziy-pwd` native helper | `nativeMessaging` permission false on `firefox_android`; GeckoView built-in path available via `geckoViewAddons` + `setMessageDelegate`. | **The helper must become Kotlin** (this was already architecture.md §0.1's call). The `pwd-client.js` protocol half is reusable as-is; the encrypted store, passphrase handling and lockout logic must be rewritten in Kotlin with Android Keystore — and autofill must hook **Android's Autofill framework** (Android Components ships an **Autofill** component; GeckoView's own `GeckoView.java` gates `AndroidAutofillDelegate` behind `SDK_INT >= 26`, i.e. the minSdk floor from §1.1). | **M** |
| **ziy-desktop** | `storage`, `tabs`, `bookmarks`, `downloads`, `find`, `theme`; `tabs.setZoom`, `tabs.query({currentWindow})`, Netscape bookmark import/export, xdg default-browser status | **The API surface is almost entirely desktop-only**: `bookmarks` API false, `find` API false, `theme` API false, `tabs.PageSettings` false (all `firefox_android`); `downloads` API is `version_added 48, version_removed 79` — and BCD is internally inconsistent here, since the `downloads` **permission** is `mirror` while the API is removed (**OBSERVED** contradiction; treat as unsupported). | **Largely desktop-only glue — the honest answer is "drop, do not port".** Android has no xdg, no desktop integration, no user-selectable profiles (§0.1). What survives is the **pure logic** in `lib/desktop.js` — the file's own header states it is "deliberately free of every `browser.*` call: the API surface is injected at the boundary", so bookmark import/export and zoom arithmetic reuse as a tested library. Zoom/downloads/find become Android Components (**Downloads**, **Find In Page**) plus Kotlin. | **S** (drop) / **M** (rebuild the survivors) |
| **ziy-shell** | `storage`, `tabs`, `theme`; `browser.tabs.create()` on install to open the welcome page; theme applied via `theme.update()` | `tabs.create` available (54). **`theme` API is false on `firefox_android`** — verified from BCD `theme.json`. | The theme cannot be applied through the engine. Branding must be **native Android theming** — the app's own `Material` theme, colors and night mode, driven from `replica/design/tokens.css` values. Welcome page: open it as the app's own first screen or a GeckoSession-loadable extension page. | **S** |

**Summary of the table:** 1 extension (shields) ports close to intact on the blocking path; 5
(sync, ntp, news, playlist, talk) keep their extension logic and lose their *surface*, which
becomes Kotlin; 2 (pwd, desktop) lose their host mechanism entirely; 1 (shell) loses its
theming mechanism. **Nothing in the suite is discarded, but almost nothing is dropped in
unchanged.**

### 3.1 MV3 + the `geckoViewAddons` permission — the open question

Our suite is **Manifest V3** (`manifest_version: 3` in all nine manifests — **OBSERVED**). The
GeckoView doc's native-messaging example is **MV2**, and it adds `geckoViewAddons` +
`nativeMessagingFromContent` to `permissions`. Nothing in any page I fetched states whether
**MV3 built-ins receive the same privileged extension treatment** — the mechanism is
documented in terms of "built-in extensions" (`installBuiltIn`), not in terms of a manifest
version. **UNVERIFIED — and it is the single highest-value thing to test first** (§5, phase 0),
because if MV3 built-ins do not get privileged native messaging, `ziy-sync` and `ziy-pwd` need a
different transport (e.g. `runtime.sendMessage` bridged to Kotlin through a small MV2 shim, or
an app↔extension channel we design).

---

## 4. The real constraints

### 4.1 The 28,907-rule ruleset — under the documented cap, but unproven on a phone

**Measured here (2026-10-16, from this repo):** `extensions/ziy-shields/rules/static-ruleset.json`
is **3.1 MB** and contains **28,907 rules** (counted programmatically from the file's rule
array). The manifest declares exactly one enabled static ruleset (`ziy-shields-lists`), which is
within `MAX_NUMBER_OF_STATIC_RULESETS` / `MAX_NUMBER_OF_ENABLED_STATIC_RULESETS` = 20 (BCD:
`firefox_android` mirror, ≥113 — **OBSERVED**).

**The cap, and why our ruleset clears it.** MDN
(<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/GUARANTEED_MINIMUM_STATIC_RULES>,
fetched 2026-10-16) states the value is **`30000` on Chrome**, and "any rules above this limit
[count] towards the global static rule limit" — BCD records the constant as supported on
`firefox_android` (mirror of Firefox 113) — **OBSERVED** for the constant's existence and
Chrome's value. Our own repo independently records the Firefox-side default: `extensions/ziy-shields/lib/engine/dnr-compile.js`
quotes `GUARANTEED_MINIMUM_STATIC_RULES = 30000` from `ExtensionDNRLimits.sys.mjs`, and its
tests assert it — **OBSERVED from the repo**. **28,907 < 30,000**, so the entire static tier
sits inside the *guaranteed* minimum and does not touch the engine-dependent global limit at
all. That is a genuinely favourable fact and it is worth stating plainly.

**What is NOT known — and must not be guessed:**

- **No Android-specific rule ceiling is documented anywhere I could fetch.** There is no page
  in the GeckoView docs, MDN DNR pages, or BCD that states a *mobile* static-rule count or a
  mobile DNR performance budget. **UNVERIFIED.**
- The consequence is a real performance risk, not a correctness risk: our own budget doc
  (`replica/resource-budget.md`, cited via `AI-BRIEF.md` §4) measures the desktop path at
  **0.34–9.67 ms per clean request (mean 1.10 ms)** for the static tier and **191 ms once** for
  the 28,923-rule index load, on a 4-core desktop. A mid-range phone has neither the core count
  nor the thermal headroom, and `webRequest`'s residual tier is an event-page round-trip per
  request where mobile kills event pages aggressively. **DOC-INFERRED risk; UNVERIFIED
  magnitude — measure on device before trusting any number.**
- Also unmeasured: **first-install cost**. `installBuiltIn` reads the whole extension folder
  from the APK assets; a 3.1 MB ruleset plus the filter-list snapshots (our own repo records
  ~1.7 MB of snapshots under `lib/filterlist/snapshots/`, `AI-BRIEF.md` §2.1) makes the total
  bundled extension payload on the order of 5 MB *before* the APK itself. **UNVERIFIED.**

### 4.2 The permission model — three distinct gates

1. **Install gate.** `installBuiltIn` needs **no signature** and no install prompt
   (verified §1.2). This is the honest Android equivalent of the `omni.ja` signing patch, and it
   is the single biggest reason the Android path is possible at all.
2. **Privileged-permission gate.** App messaging requires `geckoViewAddons` (and
   `nativeMessagingFromContent` for content scripts) in the extension's own manifest —
   permissions that are explicitly "not documented on MDN, and are only available to privileged
   extensions such as built-in extensions" (verified §1.2). Our manifests do not currently
   declare them; the Android build must **add them in an Android-only manifest variant**, and
   that variant is a divergence from the desktop suite that has to be maintained.
3. **Runtime-permission gate (host-side).** Anything touching camera, microphone, location,
   notifications or storage becomes an **Android runtime permission** the Kotlin app must request
   — `ziy-talk`'s iframe `allow` list is the concrete case (§3, ziy-talk row). The desktop
   extension model has no analogue of this. **DOC-INFERRED.**
4. **`setAllowedInPrivateBrowsing`** exists on `WebExtensionController` (verified in the
   javadoc, §1.2) — private-browsing behaviour for the suite is a per-extension app decision,
   not a manifest one. **OBSERVED.**

### 4.3 What cannot be patched around this time

No `omni.ja` (there is no GRE root in an embedder app), no `mozilla.cfg`, no `policies.json`,
no `application.ini`, no userChrome.css, no `chrome_url_overrides.newtab`, no
`sidebar_action`. All of these are architecture.md §0.1's existing "not possible" cells, and
nothing I fetched weakens any of them. **The GeckoView-specific additions to that list, verified
in this session:** the `theme` API (BCD `theme.json`), `topSites` (removed at 79), `search`,
`bookmarks`, `find`, `history`, `tabs.PageSettings`/`MutedInfo` — all `false` on
`firefox_android`. Runtime configuration that the desktop shell does with `mozilla.cfg`/
`policies.json` must move to **`GeckoRuntimeSettings` and prefs set programmatically from
Kotlin** — architecture.md §0.1 already flags the exact API surface as `low — unverified`, and
this session did not fetch a `GeckoRuntimeSettings` page, so it remains **UNVERIFIED**.

---

## 5. The honest cost — sizes and phase order

### 5.1 What the Android shell *is* (net-new Kotlin, nothing reused)

| piece | what it is | size | why |
| --- | --- | --- | --- |
| Gradle project + GeckoView dependency + JDK 17 + minSdk 26 | the build itself, `maven.mozilla.org` repo, three Gradle stanzas | **S** | verified §1.1; mechanical, but it is a second toolchain this workstation cannot host (4 cores, 7.6 GB — `AI-BRIEF.md` §2.3), so it is CI work |
| The app shell: toolbar, tab strip/tray, menu, home screen, find-in-page, site-permission prompts | the browser chrome, in Kotlin | **L** | this is the thing that is absent; Android Components covers the primitives (Toolbar, Tabstray, Menu, Awesomebar, Prompts, Find In Page all verified §1.3) but the assembly and the brand skin are ours |
| Extension install + delegate wiring | `ensureBuiltIn` × 9, `setMessageDelegate`, `setAllowedInPrivateBrowsing`, prompt delegate | **S** | verified §1.2 — this is the well-documented part, and the part that makes the whole plan credible |
| The home screen (NTP) | an app-drawn first screen + the NTP HTML served into a session | **M** | §3, ziy-np row |
| Native agent ports: `ziy-pwdd` → Kotlin, `ziy-sync-agent` → Kotlin `MessageDelegate` | the two `nativeMessaging` host protocols, re-hosted | **L** | crypto + protocol + Keystore; the `lib/` logic can be shared, the host cannot |
| Brand surfaces: app icon, mascot personality surfaces, splash/welcome | the identity the shell carries | **S** | `brand/ziy.png` + `brand/mascot*.svg/png` + the teal ramp; **MASCOT.md's hard rules carry over verbatim** (see §5.3) |
| Toolbar/panel chrome for shields, news, playlist, talk | each panel becomes a Kotlin surface hosting its extension page | **M** | §3 table |
| Android acceptance harness | what replaces `tools/verify.sh` (§7.2 of architecture.md has no Android row) | **M** | instrumentation tests on CI; GitHub's `ubuntu-latest` documents Android SDK hardware-acceleration support (arch §0.4) |

**Total for the Android app: L–XL as a separate program.** That matches architecture.md §9's
existing sizing — this session's fetches do not change it, and that is itself a useful result:
the matrix's L–XL call was right.

### 5.2 What is reused verbatim (the honest reuse list)

| asset | reuse | note |
| --- | --- | --- |
| `extensions/ziy-shields/` | **verbatim, plus an Android manifest variant** for `geckoViewAddons`/`nativeMessagingFromContent` | ruleset + engine + webRequest path unchanged; §4.2 gate 2 |
| `extensions/ziy-news/`, `ziy-playlist/`, `ziy-talk/` | **background + lib + content scripts verbatim**; only the *surface* is re-hosted | §3 |
| `extensions/ziy-ntp/ui/` | **HTML/CSS verbatim**, new host | the document is reusable; the newtab override is not |
| `extensions/ziy-desktop/lib/desktop.js` | **verbatim as a tested library** (its own header guarantees no `browser.*` calls) | bookmark import/export, zoom arithmetic |
| `extensions/ziy-sync/lib/` + `background/` logic | **protocol logic shared; host reimplemented** | the ESM libs are shared with `native/` and `server/` today (`AI-BRIEF.md` §3) |
| `server/` | **zero change** | the sync server is platform-agnostic |
| `brand/` (22 MB) | **zero change** | `ziy.png` is the app icon; `tokens.css` values drive the native theme |
| `tools/` build + verify | **not reusable** | no app dir, no omni.ja, no `--profile` |
| `shell/`, `patches/`, `native/` manifests | **not reusable** | all four mechanisms are desktop-only (§4.3) |

### 5.3 Brand/identity obligations the Android shell inherits

From `brand/MASCOT.md` (read 2026-10-16) — these are co-owner decisions and they bind the
Android app as much as the desktop shell: the **app icon is the co-owner's cat**
(`brand/ziy.png`, "used as-is … no conversion, no recode, no resample"); the cat is
**personality only** and must never be a toolbar icon, a `manifest.json` `icons{}` entry, a
favicon, a notification icon, a permission-prompt icon, or a **state indicator**; the sealed-eye
**shield** remains the function glyph (shields toolbar icon); the teal family is for the brand
mark only and "the palette rule applies ONLY to the brand MARK … and never to the cat"; alt text
follows the `Ziy the cat …` + surface pattern; `mascot-simple` below 160 px. From
`replica/design/tokens.css` (read 2026-10-16): the token set is a CSS custom-property mirror of
`tokens.json` with a `[data-theme="dark"]` block and a WCAG 2.2 2px/2px focus ring that is
"never suppressed" — the Android native theme must carry the same roles and the same focus-ring
rule, and the extension-hosted pages inherit them by loading the same CSS. **DOC-INFERRED:**
Android's own accessibility surface (TalkBack, font scaling, `forced-colors` equivalents) is a
new obligation the desktop userChrome approach never had — **UNVERIFIED** scope, listed here so
it is not discovered late.

### 5.4 Phase order (after Linux and Windows — architecture.md §0.2's ordering stands)

| phase | what ships | exit condition (what would prove it) |
| --- | --- | --- |
| **0 — Spike (S, days not weeks)** | a throwaway Gradle app: GeckoView Stable, one `GeckoSession` loading a page, `ensureBuiltIn` on a **stripped copy of ziy-shields** | the ruleset installs and blocks a known tracker; the `geckoViewAddons` + **MV3** question (§3.1) is answered; install time and steady-state blocking are measured on a real device |
| **1 — Shell (L)** | toolbar, tabs tray, menu, home screen, brand skin, GeckoRuntimeSettings/prefs wiring | Ziy opens, is branded, browses, and shows its own home screen — the Android sentence equivalent to architecture.md §6's Linux slice |
| **2 — Suite (M)** | all 9 `ensureBuiltIn` installs, delegates wired, shields panel + news/playlist/talk screens | blocking, news and playlist work end to end on device |
| **3 — Native ports (L)** | `ziy-sync-agent` and the pwd helper as Kotlin, Keystore, autofill hook | a two-device sync e2e, matching `tools/e2e-ziy-sync.sh`'s desktop proof |
| **4 — Hardening (M)** | acceptance harness on CI, private-browsing policy, performance budget for DNR on device | a documented per-request cost and a measured install time, replacing every UNVERIFIED label in §4 |

**The recommendation in one line:** do phase 0 first and nothing else — it is the cheapest
possible disproof of the whole plan, and it answers the only two questions this document cannot
answer from fetched pages (MV3 built-in privileges, and real-device DNR cost).

---

## 6. Pages actually fetched this session (2026-10-16)

The assignment budgeted ≤8 sequential fetches. **I exceeded it** — the per-extension
portability table (§3) required BCD reads per API, which are separate documents. The overshoot
is recorded honestly rather than hidden; the two headline verification targets (GeckoView
integration path; Flutter) were each covered by a small number of fetches.

| # | URL | what it established |
| --- | --- | --- |
| 1 | `firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/geckoview-quick-start.html` | maven coordinates, `maven.mozilla.org`, **Java 17**, the minimal activity, `adjustResize`, pointer to Android Components (§1.1) |
| 2 | `firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html` | `/assets` + `resource://android/`, `installBuiltIn`, `ensureBuiltIn`, no host manifest, `geckoViewAddons`/`nativeMessagingFromContent`, MV2 example, `setMessageDelegate`/`onConnect` (§1.2, §3.1) |
| 3 | `mozilla.github.io/geckoview/` | "Self-Contained … the code you test is the code that will actually run" (§1.3) |
| 4 | `firefox-source-docs.mozilla.org/mobile/android/geckoview/design/managing-extensions.html` | `installBuiltIn` = `resource://` only, no signature, app messaging; `onReady` supplies `moz-extension://` `baseUrl`; `setAllowedInPrivateBrowsing`; legacy API deprecation (§1.2, §4.2) |
| 5 | `mozilla.github.io/geckoview/javadoc/mozilla-central/org/mozilla/geckoview/WebExtensionController.html` | verbatim `installBuiltIn` javadoc incl. "only `resource://android` URIs are allowed"; full controller surface (§1.2) |
| 6 | `pub.dev/packages/webview_flutter` | "backed by the system webview" — system WebView = Chromium on Android (§2) |
| 7 | `pub.dev/packages/webview_flutter_geckoview` | the only Flutter×Gecko bridge; `0.0.1+2`, pre-1.0, one publisher, no extension controller (§2) |
| 8 | `github.com/mozilla/gecko-dev/blob/master/mobile/android/geckoview/build.gradle` (raw) | `minSdkVersion` comes from mozconfig, not a literal — the number is in the tracking bug, not the file (§1.1) |
| 9 | `bugzilla.mozilla.org/show_bug.cgi?id=1982312` | minSdk 26 (Android 8), RESOLVED FIXED, milestone firefox145 (§1.1) |
| 10 | `github.com/mozilla-mobile/firefox-android/blob/main/android-components/README.md` (raw) | the Components inventory, all production-ready, on the same maven repo (§1.3) |
| 11 | `developer.mozilla.org/.../declarativeNetRequest/GUARANTEED_MINIMUM_STATIC_RULES` | 30000 on Chrome; above it counts to the global limit (§4.1) |
| 12–19 | `raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/**` (queried per API: `declarativeNetRequest`, `webRequest`, `webNavigation`, `scripting`, `topSites`, `theme`, `find`, `search`, `bookmarks`, `history`, `downloads`, `alarms`, `tabs`, `storage`, `sidebarAction`, `manifest/permissions`) | the `firefox_android` column behind every row of §3 and §4.3 |

**Dead/blocked in this session:** `https://maven.mozilla.org/maven2/org/mozilla/geckoview/`
(404 via the reader — so the current artifact **version number** is **UNVERIFIED**; the repo URL
`https://maven.mozilla.org/?prefix=maven2/org/mozilla/geckoview/` is the documented way to
browse it) and `pub.dev/search?q=geckoview` (404 — the package pages themselves were read
instead).

## 7. Open items this document deliberately leaves open

1. **MV3 built-in privileges** — does a `manifest_version: 3` built-in get
   `geckoViewAddons`/native messaging? (UNVERIFIED, §3.1 — phase 0 answers it.)
2. **`GeckoRuntimeSettings` surface** — how autoconfig-equivalent prefs are actually set
   programmatically. (UNVERIFIED, §4.3; architecture.md §0.1 already flagged this.)
3. **Real-device DNR cost** for a 28,907-rule static tier, and install time for a ~5 MB
   bundled extension payload. (UNVERIFIED, §4.1 — phase 0 measures it.)
4. **IndexedDB media blob storage** for ziy-playlist inside a GeckoView-hosted extension page.
   (UNVERIFIED, §3, playlist row.)
5. **Camera/mic/display-capture permission grants** from inside an embedded extension page.
   (UNVERIFIED, §3, talk row.)
6. **The pinned GeckoView version and its exact minSdk.** (UNVERIFIED, §1.1.)
7. **iOS.** Out of scope for this assignment and not researched; noted only because it is the
   argument Flutter would otherwise make (§2).
