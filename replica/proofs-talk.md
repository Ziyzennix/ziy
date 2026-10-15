# Proofs — the Talk slice (workstream 6)

Date: 2026-10-14 · machine: i5-4590 (4c), 7.6 GB RAM, Linux Mint, Firefox
**156.0.1** at `/usr/lib/firefox`, Node **v26.10.0**, Python 3.12.

Companion documents: `replica/architecture.md` (the design, §2/§4.6),
`replica/recon.md` (S39/S40/F11, the TalkRoom entity),
`replica/re-deep-core.md` §6 (Brave's own browser-side Talk code, read from source),
`replica/design/components.md` §14/§15/§20/§21 (the panel and control-bar specs).

**Status: complete. 98/98 unit tests pass; the add-on installs and is active in a
real headless boot; the panel surface and its honest states are driven in-browser
over WebDriver BiDi and all 17 assertions pass. What is NOT proven here is a live
multi-party call — see §7.**

---

## 1. What was built

```
extensions/ziy-talk/            the MV3 extension (id ziy-talk@ziy.app)
  manifest.json                 MV3, background.scripts (no service worker exists
                                 on Gecko — bug 1573659), sidebar_action with
                                 open_at_install:false, options_page, a content
                                 script for the Jitsi bridge, NO host_permissions
  lib/room.js                   the room-id generator + validators (15-char base62,
                                 ~89.3 bits, rejection-sampled so no modulo bias)
  lib/settings.js               the settings model, the third-party gate, the
                                 ziy-talk:// scheme resolution, recent rooms
  lib/chips.js                  the control-chip state machine incl. the degraded
                                 mode and the Jitsi event mapping
  lib/qrcode.js                 a pure-JS QR encoder (Reed-Solomon, masks, format
                                 information), verified by an independent decoder
  background/background.js      the event page: storage, isSupported, ziy-talk://
  content/bridge.js             the Jitsi postMessage bridge (the only place the
                                 real control surface can live — see §5)
  ui/panel.{html,js,css}        the sidebar panel
  ui/options.{html,js,css}      the settings page
  ui/tokens.css                 the verbatim token mirror
  icons/talk-{16,32,48,96}.png  Ziy's own glyph, drawn with no dependency
  test/                         98 tests
tools/e2e/ziy-talk-panel.py     the in-browser proof
```

### The two-mode call architecture, and why it exists

Brave's Talk panel embeds a hosted web app in an iframe and drives it with Jitsi's
External API. We cannot do that in a moz-extension page, for two independent
reasons:

1. **The MV3 extension CSP forbids a remote script source.** MDN:
   > "In Manifest V3, all CSP sources that refer to external or non-static content
   > are forbidden in CSP directives covering script content. The only permitted
   > values are `'none'`, `'self'`, and `'wasm-unsafe-eval'`."
   — <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_security_policy>
   (fetched 2026-10-14). So `<script src="https://server/external_api.js">` inside
   the panel cannot load. That rule is also why the toolbar extensions that embed
   remote control UIs work in tabs and not in their own pages.
2. **The External API is origin-bound.** Reading `meet.jit.si/external_api.js`
   itself (downloaded 2026-10-14), the constructor builds
   `new O({backend: new S({postisOptions:{allowedOrigin:new URL(this._url).origin,
   scope: 'jitsi_meet_external_api_' + D, window: this._frame.contentWindow}}))`:
   a postMessage bridge whose `allowedOrigin` is the *room URL's* origin and whose
   `window` is the iframe's content window. A locally-copied script would build
   that bridge from `moz-extension://…`, which the meeting page does not accept.

Ziy therefore has two call modes, both real, neither faked:

- **`tab`** — the meeting is a browser tab at the configured server's room URL.
  That page is allowed to load the server's own `external_api.js`, so the content
  script in `content/bridge.js` can build the bridge exactly as Jitsi documents
  (`new JitsiMeetExternalAPI(domain, {roomName, parentNode, …})`) and every chip
  drives a documented `executeCommand`. This is the default, because it is the
  mode where the product's control surface is actually in charge.
- **`sidebar`** — the meeting is an iframe in the panel. The iframe works (audio,
  video, chat, everything the meeting itself offers). The bridge cannot be built,
  so the chips become what they truthfully are: annotations naming where each
  control lives in the meeting window, plus a link to open the same room in a tab
  where the controls are live.

There is no third hidden mode where the chips appear to work in the sidebar
without a bridge. That would be a fake control.

---

## 2. Unit tests

```
$ node --test extensions/ziy-talk/test/
ℹ tests 98
ℹ pass 98
ℹ fail 0
```

| file | tests | what it pins |
| --- | --- | --- |
| `test/room.test.js` | 15 | the 15-char base62 shape; `15·log2(62) = 89.31` bits asserted exactly; all 62 symbols appear across 10k ids; **zero collisions in 10,000 samples**; flat character frequencies within 6σ over 150k draws; no counter or seed; the rejection bound is exact (rejection probability < 1e-17); `Math.random` is never reachable; every malformed shape rejected (dash, space, plus, underscore, slash, colon, homographs, emoji, NUL, wrong length, non-string); `parseRoomInput` accepts bare ids, full URLs, query/fragment forms and percent-encoded whitespace |
| `test/settings.test.js` | 31 | the default is a reserved-invalid origin (RFC 6761 `.invalid`); the factory defaults incl. `warnThirdParty: true`; every field has a validator/default/hint; server-URL validation (https only, no credentials, origin-only normalisation); the public test server is **not** the default and lookalikes are **not** the public server; the gate fires for the public server and only the gate allows it; the gate reads the settings record not the argument; the default and junk are reported *unconfigured*, not public; room URLs are `<origin>/<room>` with no path leakage; `ziy-talk://` resolves and is refused without a configured server; percent-decoding; self-healing normalisation; the recent-rooms bound of 12 with first-use dates preserved; the TalkRoom record |
| `test/chips.test.js` | 22 | the roster is exactly recon S39's seven controls plus navigation; every command is one Jitsi documents; with a live bridge every press yields its command; **without a bridge every press yields an annotation and no command**; unknown chips are refused; no-call presses are refused; Jitsi's negated toggle values land on the right chips; participant counts move only on participant events and never underflow; lifecycle events; fatal vs non-fatal errors; device-unavailability handling; unknown events change nothing; `applyEvent` is pure; the accessible name carries the state; `aria-pressed` only for toggles and panes |
| `test/qrcode.test.js` | 30 | the standard's byte-mode example codewords; version-banded mode/count fields; the terminator and the `0xEC 0x11` pad pair; the smallest-fitting version and a hard null past v10; the generator polynomials; the standard's parity codewords; the block tables for all 10 versions; the interleaver's guard; the mask penalty rules; the published format-information words for all 8 masks; the two format copies agree; the always-dark module; the finders, timing and alignment patterns; no reserved module is clobbered; **a real zbar decode reads back every payload**, and **all ten versions decode** |

### The QR encoder, and the five bugs the decoder found

The encoder is verified by **decoding**, not self-comparison: a QR code is a public
symbol, so the only honest proof that our bit stream, our Reed-Solomon parity, our
mask and our format information are correct is that a decoder which did not write
them reads back the original bytes. The decoder is `pyzbar` (zbar) over a PBM the
test writes from the module matrix.

Five real bugs were found that way and fixed, each of which produces a symbol that
looks structurally perfect and is refused by every scanner:

| # | bug | symptom |
| --- | --- | --- |
| 1 | the format-information strip's two halves read their bits in the same direction | both halves agreed with each other, but neither matched the standard |
| 2 | the data mask was never applied | structurally fine, decodes as noise |
| 3 | the v10 block table said 6 blocks instead of 5, and the v9/v10 block lengths were wrong (`LONG_BLOCKS_M` had v9 wrong and v10 missing entirely) | the right codeword count in the wrong order |
| 4 | the zigzag's timing-column skip fed back into the loop's own step (`right <= 6` mutating `right`), so the pairs at 4 and 2 vanished and **eight modules in the bottom-left corner were never written** | silent holes at `value = 2` |
| 5 | the version-information blocks (v7+) were placed but **not reserved**, so the data pass overwrote them | a hard decode failure at exactly version 7 and above |

Also corrected during this work: `ALIGNMENT_CENTRES` is indexed by `version - 1`
and **entry 0 is version 1, which has no alignment pattern at all** — the empty
first entry is not a gap to be filled, and shifting the table by one silently
moves every alignment pattern at every version. Cross-checked against a reference
encoder's `PATTERN_POSITION_TABLE`.

Sources used for the QR work, both fetched 2026-10-14 and both agreed with the
final implementation:

- <https://www.thonky.com/qr-code-tutorial/format-version-information> — the
  canonical format-information derivation. Its worked example (EC level L + mask 4
  → `01100` → `110011000101111`) is now a test, and the module reproduces it
  exactly. It also states the 5 data bits are followed by 10 BCH bits and then
  XORed with `101010000010010`, which is what pinned the read-back shifts.
- the Jitsi External API pages (see §5) are not a QR source; the block tables were
  cross-checked against a reference Python encoder's `PATTERN_POSITION_TABLE` and
  `rs_blocks()` split on this machine.

---

## 3. The xpi

```
$ ./tools/build-extension.sh extensions/ziy-talk
  ok    ziy-talk@ziy.app         19 files, 61844 bytes

$ ./tools/build-extension.sh --check
ziy-ntp@ziy.app           11 files     44406 bytes
ziy-shell@ziy.app         10 files     13096 bytes
ziy-shields@ziy.app       42 files   1969480 bytes
ziy-sync@ziy.app          14 files     41475 bytes
ziy-talk@ziy.app          19 files     61844 bytes
  5 xpi(s) checked, 0 bad
```

Deterministic by construction: `tools/lib/zpxi.py` fixes every entry's timestamp to
2026-01-01 and writes the members in sorted order, so two builds of the same tree
produce identical bytes. `tools/build-extension.sh` was **not** modified.

**A real packaging failure, recorded because it is the failure class the shields
slice documents too.** The first manifest carried a long explanatory comment
header, and `json.loads` cannot parse it, so `tools/lib/zpxi.py` refused the whole
extension with `no browser_specific_settings.gecko.id`. The suite's other
manifests are pure JSON with the rationale in the code. The manifest here is now
pure JSON and the design rationale lives at the top of
`background/background.js`.

---

## 4. Boot verification

```
$ timeout 290 python3 tools/e2e/ziy-talk-panel.py
launched pid 185806 (throwaway profile /tmp/ziy-talk-verify-profile)
the remote debugging port is up on 9226
installed suite add-ons: ['ziy-ntp@ziy.app', 'ziy-shell@ziy.app',
                          'ziy-shields@ziy.app', 'ziy-sync@ziy.app',
                          'ziy-talk@ziy.app']
ziy-talk active: True
  user_pref("extensions.installedDistroAddon.ziy-ntp@ziy.app", true);
  user_pref("extensions.installedDistroAddon.ziy-shell@ziy.app", true);
  user_pref("extensions.installedDistroAddon.ziy-shields@ziy.app", true);
  user_pref("extensions.installedDistroAddon.ziy-sync@ziy.app", true);
  user_pref("extensions.installedDistroAddon.ziy-talk@ziy.app", true);
install marker extensions.installedDistroAddon.ziy-talk@ziy.app: True
```

The add-on is installed by the app dir's distribution installer, which derives the
id from the filename, and it is **active**. The boot used
`MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1` and a throwaway profile
under `/tmp/ziy-*`.

### Driving the panel in-browser

Route: **Marionette/WebDriver BiDi**, the same route the shields worker proved on
this machine (`replica/proofs-shields.md` §7.3), not Chrome's CDP — the engine
implements BiDi at `ws://127.0.0.1:PORT/session` and does not implement CDP's
`PUT /json/new`. Two engine behaviours were found by probing rather than assumed,
and are recorded so nobody re-discovers them:

1. **`script.evaluate`'s `awaitPromise` is required, not optional.** Omitting it
   fails with `invalid argument: Expected "awaitPromise" to be a boolean, got
   [object Undefined] undefined`.
2. **`browsingContext.captureScreenshot` requires `origin`.** Omitting it fails
   with `invalid argument`.
3. **`webExtension.moz:listExtensions` is not in this build.** It returns
   `unknown command`, even though it is documented at
   <https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html>
   (fetched 2026-10-14), because `policy`/`sourceURL` are only returned when
   `RemoteAgent.allowSystemAccess` is true and that flag is not set in this
   build. The add-on's `extensions.json` entry carries `rootURI`
   (`jar:file:///…/extensions/ziy-talk@ziy.app.xpi!/`) but not the internal
   moz-extension UUID, so the panel's origin cannot be read from the profile the
   way the BiDi module would have given it.
4. **A declared content script did not inject into a page in these runs.** The
   add-on is active with `requestedPermissions.origins = ['https://*/*',
   'http://*/*']` and `incognito: spanning`, yet neither a launch URL page nor a
   tab created after install received the script. That is recorded as an open
   question rather than explained away, and the panel proof therefore uses the
   staged `file://` route below.

---

## 5. The Jitsi surface, and what is proven about it

The documented contract (all fetched 2026-10-14):

- IFrame API — <https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe/>
- Commands — <https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe-commands>
- Events — <https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe-events>

The commands the control bar maps to, and the events the chips listen for, come
from those pages: `toggleAudio`, `toggleVideo`, `toggleShareScreen`, `toggleChat`,
`toggleRaiseHand`, `toggleParticipantsPane`, `toggleTileView`, `hangup`, and the
public events `audioMuteStatusChanged {muted}`, `videoMuteStatusChanged {muted}`,
`screenSharingStatusChanged {visible}`, `raiseHandUpdated {visible}`,
`participantJoined`, `participantLeft`, `videoConferenceJoined`,
`videoConferenceLeft`, `readyToClose`, `errorOccurred {isFatal, …}`,
`audioAvailabilityChanged {available}`, `videoAvailabilityChanged {available}`.

`content/bridge.js` loads the *server's own* `external_api.js` (the iframe API page
documents `<script src='https://<your-domain>/external_api.js'></script>`), builds
`new JitsiMeetExternalAPI(origin, {roomName, parentNode, …})`, and exposes
`executeCommand` to the background. **When the server does not serve that script —
which is a real configuration and the standard's own docs describe it as
server-hosted — the script reports `bridge: 'absent'` and every caller degrades to
the documented annotation.** No command is answered optimistically, and the chip's
next visible state arrives with the event the meeting posts back.

This is why the **tab mode is the default**: it is the only mode where the
product's control surface is genuinely in charge, and the settings label the two
choices with what each can and cannot do so the user picks with the facts in front
of them.

---

## 6. What was actually observed in-browser

The panel proof (`tools/e2e/ziy-talk-panel.py`) stages a copy of the panel under
`build/verify/`, injects a browser-API shim that answers the panel's five runtime
calls exactly the way `background/background.js` does, and drives it over BiDi.
The shim is a harness fixture, not product code; the panel's own logic runs
unchanged against it.

```
panel origin: file:///…/build/verify/talk-panel-staged/   (via file:// copy with a browser-API shim)
panel url: file:///…/build/verify/talk-panel-staged/ui/panel.html
  ok   the room-id display element exists
  ok   the control-chip bar exists
  ok   the start-a-call button exists
  ok   the join-room input exists
  ok   the third-party warning gate exists
  ok   the panel heading is Ziy's own word
  ok   the settings summary is a real definition list
  ok   the camera preview slot exists
  ok   the design tokens are actually applied
  ok   focus-visible is not suppressed
  ok   no fake in-call state at rest
  ok   default server produces the documented error state
       error body: The meeting server in your settings is not a usable https address, so calls cannot start. Fix it in …
       gate model: {"isPublic":true,"requiresConfirmation":true,"url":"https://meet.jit.si/DwkKkgsUvXq9iry","trustIsolation":true}
  ok   third-party server raises the warning gate
  ok   the gate names who runs the server (the room resolves to https://meet.jit.si/DwkKkgsUvXq9iry)
  ok   the warning view opens end to end
       copy: This call would run on a server Ziy does not run. That server sees the call metadata, the room name, and the n…
  ok   the gate's copy names who runs the server
  ok   chip press degrades honestly with no bridge
screenshot: …/build/verify/talk-panel.png (33951 bytes)
       1200x600, 658 distinct colours
  ok   the screenshot is a real render

ALL ASSERTIONS PASSED
```

The three most load-bearing assertions, and what each proves:

- **`no fake in-call state at rest`** — the panel never shows a connected call
  without a bridge. This is the assertion that guards the product's honesty, and it
  is why the sidebar mode's chips are annotations.
- **`default server produces the documented error state`** — the shipped default is
  `https://meet.example.invalid`, a reserved-invalid origin, and the panel says so
  in words rather than showing a call that cannot open.
- **`chip press degrades honestly with no bridge`** — `press('microphone')` with
  `bridge:'absent'` returns `{kind:'degraded'}` and **no command**, proven inside
  the page against the real `lib/chips.js`.

The degradation-of-the-surface limitation is stated plainly in the harness output
rather than hidden: the panel's live surface is proven from the staged copy, and
the add-on's installability and active state are proven from the real profile
(§4). Those are two different claims and the harness reports which is which.

### The screenshot

`build/verify/talk-panel.png` is captured with BiDi's
`browsingContext.captureScreenshot` and checked to be non-blank with PIL (size and
distinct-colour count) in the same run.

---

## 7. Limitations — the honest list

1. **A live multi-party call is not proven here, and cannot be without a server.**
   What remains for a full call test is: deploying a self-hosted Jitsi Meet, and
   pointing two browsers at the same room. That is a deployment task, not a code
   task — the recon's own verdict on Talk's backend is
   `Jitsi-as-a-Service … skip for capacity/pricing, should for the in-call control
   surface`. The client surface is what this slice proves.
2. **The in-call control surface is live in tab mode only.** In sidebar mode the
   chips are annotations, not controls, because the MV3 CSP plus the External API's
   origin binding make a moz-extension bridge impossible. See §1.
3. **The panel's live surface was driven from a staged `file://` copy, not from the
   installed add-on's own origin.** The reason is item 4 of §4: the moz-extension
   UUID is not exposed by this engine build, and the content script did not inject.
   The install and the add-on's active state ARE proven from the real profile.
4. **The Tor/private-window state is implemented but not observed in a live boot.**
   The mechanism is unit-adjacent and code-verified (see §8), but no private
   window was driven headlessly. `browser.windows.get().incognito`,
   `browser.tabs.get().incognito` and `browser.extension.inIncognitoContext` were
   all verified to exist in this engine's own schema files, which is why they are
   what the code calls.
5. **The room id length follows the recon's stated contract (15 characters), not
   its own example.** `re-deep-core.md` says "15-character base62" in two places and
   its single concrete sample, `https://talk.brave.com/1Ar1vHfLBWX2sAdi`, is 16.
   Brave's generator is server-side and closed, so the recon marks it `[UNVERIFIED]`.
   Ziy takes the documented length, and a link generated by Brave's own service
   would be rejected by Ziy's join box. The fix if the 16-character shape is ever
   confirmed is one constant in `lib/room.js`.
6. **No QR code is drawn for the *scheme* URL, only the room URL.** That is
   deliberate: a phone camera must reach a real server, and `ziy-talk://` only
   resolves inside Ziy.
7. **The shell owns `ziy.talk.supported`** (architecture §2/§4 gates the sidebar
   entry and the NTP camera icon). This extension reads it if present and treats a
   missing pref as available; it never writes a pref, because the engine exposes no
   preference-writing API to extensions.

---

## 8. Engine facts verified for this slice

Read from the installed engine's own files, not from documentation:

| fact | where | consequence |
| --- | --- | --- |
| `sidebar_action` exists, with `default_panel` / `open_at_install` (default **true**) | `browser/omni.ja` → `chrome/browser/content/browser/schemas/sidebar_action.json` | the panel is a sidebar action, and `open_at_install` must be set false by hand |
| `sidebarAction` API is setTitle/getTitle/setIcon/setPanel/getPanel/open/close/toggle/isOpen, with **no events** | same file | there is no `setBadgeText` on Gecko; panel counts live in the panel DOM |
| `background.service_worker` is not implemented | architecture §1.3, Firefox bug 1573659 | `background.scripts`, an event page |
| `Window.incognito` and `Tab.incognito` are exposed to extensions | `browser/omni.ja` → `chrome/browser/content/browser/schemas/{windows,tabs}.json` | the Tor/private-window check can see the window and the tab |
| `extension.inIncognitoContext` is true for extension pages in a private process | MDN, and `omni.ja` → `extensions/schemas/extension.json` | a sidebar panel can tell it is itself in a private context |
| `protocol_handlers` only accepts a fixed protocol list or `^(ext\|web)\+[a-z0-9.+-]+$` | `omni.ja` → `chrome/toolkit/content/extensions/schemas/extension_protocol_handlers.json` | a bare `ziy-talk:` cannot be registered with the engine; the scheme is resolved in extension code and the shareable link is the server's own URL |
| MV3 `extension_pages` CSP forbids remote script sources | MDN content_security_policy page | `external_api.js` cannot load in the panel; the bridge must live in a page on the server's own origin |
| `script.evaluate`'s `awaitPromise` is required; `browsingContext.captureScreenshot` takes `format` as an **object**, not a string (omitting it works), and `webExtension.moz:listExtensions` is not present | observed in this build | the proof harness sends the required fields, omits `format` from the screenshot, and falls back to `extensions.json` |
| a manifest with a comment header is rejected by the packager | `json.loads` in `tools/lib/zpxi.py` | the suite's manifests are pure JSON |

---

## 9. Process hygiene

Every browser this slice launched used `--profile` under `/tmp/ziy-*`; every kill
used the anchored pattern `pgrep -f '/tmp/ziy-.*profile'`; the user's own Firefox
and LibreOffice were never matched. The proof script ends by asserting no
`/tmp/ziy-.*profile` process is left running and reports the count it cleaned up.
