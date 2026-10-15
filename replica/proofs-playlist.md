# proofs-playlist.md — the Ziy Playlist slice, verified on this machine

Workstream 9: the media queue (`extensions/ziy-playlist`) and its player.
Every claim below was exercised on this machine, Linux Mint, 2026-10-14,
against the installed Firefox **156.0.1** at `/usr/lib/firefox` reached through
Ziy's own app dir (`build/ziy/firefox`).

Companion documents: `architecture.md` (the design), `proofs-shields.md`
(workstream 2 — the BiDi route this workstream reuses), `proofs-talk.md`
(workstream 8 — the panel-surface proof whose limitation §6.3 below is a
second instance of).

A note on the reference: `replica/recon-behavior.md` records that the user's
own Brave **Origin** build ships **no** `brave://playlist` page and no Playlist
menu entry (9 pages absent, observed over CDP). Brave's own help centre says
desktop Playlist is Nightly-channel only. Ziy builds it anyway, per the feature
matrix, and this file is honest about what that means (§8).

---

## 1. The two layers of evidence

This slice is proven at two levels, and the distinction matters:

| layer | what it proves | where |
| --- | --- | --- |
| **the model** | every decision the product makes — item shape, add/move/remove/clear, classification of a URL, the resume rule, the sleep-timer state machine, settings merge — as **node:test suites over the real `lib/` files** | `extensions/ziy-playlist/test/`, 83 assertions |
| **the boot** | that the add-on installs, that the shipped panel renders in a real browser, that the shipped classifier adds a real captured item, that a **real media file plays, pauses and seeks** in the panel's real media element, that reorder and resume positions **survive a reload** | `tools/e2e/ziy-playlist-panel.py` |

The node suites are not a stand-in for the browser: they run the same files
the xpi ships (`lib/model.js`, `lib/classify.js`, `lib/settings.js`,
`lib/sleep.js`, `lib/position.js`), required through their UMD export, so a
regression in the model fails in node in milliseconds.

---

## 2. The unit suites, and what each one pins

```
$ node --test 'extensions/ziy-playlist/test/'
ℹ tests 83
ℹ pass 83
ℹ fail 0
ℹ duration_ms 0.9s
```

| file | tests | what it pins |
| --- | --- | --- |
| `test/model.test.js` | 21 | the item shape; add/remove/clear/reorder never mutating the caller's array; de-duplication by url keeping the remembered position; the cap at 500; the tail-is-finished rule; the three resume sentences; time round-trip; a persisted queue round-tripping unchanged |
| `test/classify.test.js` | 20 | direct files by extension and by declared type; HLS as **one** item; DASH as a page item (no DASH pipeline); blob: never addable; a host-name suffix never fooling the extension reader; metadata precedence (element → og: → page → file name); `<source>` children |
| `test/settings.test.js` | 12 | defaults; merge-with-defaults; every wrong shape falling back; a patch that does not clobber a good value with a bad one; the dismissal list keyed by origin and capped at 200 |
| `test/sleep.test.js` | 13 | construct/extend/cancel; the deadline in milliseconds; **fires once**; fires on a starved tick; a fresh timer can be started after a fire; the status sentences |
| `test/decode.test.js` | 7 | the fixture files are real, non-trivial, carry their container signature; the generator is deterministic; **every shipped fixture classifies as playable through a served HTTP response**; the served bytes equal the bytes on disk; a VOD manifest with variants yields one item |
| `test/manifest.test.js` | 10 | pure JSON (a comment header is a silent total rejection — proofs-shields §7.2); event page not service worker, lib order; the exact permission set; every match pattern is the engine's form; every named path exists; the icons are real PNGs at their sizes; the CSP keeps `media-src 'self'`; the xpi carries every path and no fixture |

Two tests exist because of failures that were real and silent, so they are now
assertions rather than memories:

- `test/decode.test.js` builds the fixtures with gstreamer and checks the
  container signature **at its real offset** (an mp4's magic word is `ftyp` at
  offset 4, not offset 0). The first draft asserted offset 0 and failed; the
  fixture was right and the assertion was wrong, which is the exact failure
  this suite is supposed to catch.
- `lib/sleep.js`'s `shouldPause` originally answered `true` for a state that
  had *already* fired. `test/sleep.test.js`'s "shouldPause is the edge, so
  repeated ticks do not pause twice" failed on it, the machine was fixed to
  compare tick identities, and the test pins it. A sleep timer that re-fired
  on every tick would be a pause loop.

### The fixtures are real files, generated on this machine

```
$ python3 extensions/ziy-playlist/tools/make-fixtures.py
  tiny.mp4        52594 bytes
  tiny.webm       15328 bytes
  tone.mp3         2838 bytes
  tone.ogg         5341 bytes
  tone.wav       352056 bytes
```

H.264 in MP4, VP8 in WebM, MP3, Vorbis in Ogg, PCM WAV. Deterministic by
construction (fixed frame counts, a test pattern), and re-running produces the
same byte count. They are smaller than a thumbnail and genuinely decodable.

---

## 3. The capture classification, and what it means for real sites

`lib/classify.js` answers one question as a decision rather than a boolean.
The rules, and the reason for each:

| input | verdict | why |
| --- | --- | --- |
| `.mp4 .webm .ogv .mov .mkv` | `direct` media | containers Gecko's media stack decodes |
| `.mp3 .m4a .aac .opus .ogg .wav .flac .weba` | `direct` audio | same |
| a declared `type` that is a decodable MIME | `direct` | the element's own claim, the strongest signal |
| a declared type this engine cannot decode (`video/x-msvideo`) | `page` | a control that would fail is not a control |
| `.m3u8 / .m3u` or an HLS MIME | `manifest`, **one item** | the player resolves the variants; five rows for one video would be four too many |
| `.mpd` or `application/dash+xml` | `page` | this engine has no DASH pipeline |
| a page URL with no media signal | `page` | extensionless CDN URLs exist, but a hopeful entry that cannot play is worse than a page pointer |
| a `blob:` URL | never addable | it cannot be replayed tomorrow |
| `data:` / no scheme | rejected | not a durable queue row |

The end-to-end capture path an element takes is `classify.itemFromElement()`,
and it picks the FIRST addable candidate in element-resolve order (currentSrc →
src → each `<source>`), so a page with four variants contributes one row. The
title precedence is element `title`/`aria-label → og:title → schema.org
`VideoObject.name` → `<title>` → a cleaned file name; the poster precedence is
element `poster → og:image → schema.org image`.

### The prompt is not in the address bar, and that is stated

The reference puts its prompt in the address bar. On Gecko the address bar is
the engine's — an extension cannot own it — so the equivalent affordance is a
page-level prompt near the media element that appears **while the page is
playing**, plus the toolbar Action as the always-available entry point. It is
dismissed per site, and the dismissal is stored by the event page
(`playlist.site.dismiss` → `playlist.sites`), so it is never a reminder that
comes back. `lib/settings.js` bounds that list at 200 origins.

---

## 4. Cross-origin media playback: the documented approach

The panel is a `moz-extension://` page, and it plays a URL that lives on
somebody else's origin. The question is what lets those bytes arrive.

**The pattern, and the document it comes from.** MDN's
[`host_permissions`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)
states the extra privileges a host permission grants, and the first one is:

> "XMLHttpRequest and fetch access to those origins without cross-origin
> restrictions, but not for requests from content scripts."

and MDN's
[Background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/background_scripts)
article states the same fact from the other side:

> "Background scripts can make XHR requests to hosts they have host
> permissions for."

The manifest therefore ships `"host_permissions": ["<all_urls>"]`, granted at
install, and that grant is what a media element in the panel relies on for a
cross-origin URL. This is the standard extension pattern for playing another
origin's media, and it is the one used here.

**`web_accessible_resources` does not do this, and is not used for playback.**
A WAR entry makes *extension* resources available to web pages; it does nothing
for a web origin's media landing in an extension page. ziy-playlist declares
exactly one WAR entry, for `ui/panel.html`, for the proof tooling, not for
media.

**No cookies go with it.** The fetch path that does exist (the event page's
message plumbing) never attaches credentials; the media element's own request
is governed by the media origin's policy, and a site that requires signed
cookies will refuse — which is the DRM/authorised-content limitation, §8.

---

## 5. The boot verification — measured, on this machine

Every launch used an explicit throwaway profile under `/tmp/ziy-playlist-verify`,
and every kill used the anchored pattern `pgrep -f '/tmp/ziy-playlist-verify'`.
The project directory name contains `brave`, so a bare `pkill firefox` would
have matched the user's own browser; nothing but the throwaway path is ever
matched.

```
$ timeout 400 python3 tools/e2e/ziy-playlist-panel.py
launched pid 285656 (throwaway profile /tmp/ziy-playlist-verify)
the remote debugging port is up on 9227
installed suite add-ons: ['ziy-news@ziy.app', 'ziy-ntp@ziy.app',
                          'ziy-playlist@ziy.app', 'ziy-shell@ziy.app',
                          'ziy-shields@ziy.app', 'ziy-sync@ziy.app',
                          'ziy-talk@ziy.app']
ziy-playlist active: True
  user_pref("extensions.installedDistroAddon.ziy-playlist@ziy.app", true);
install marker extensions.installedDistroAddon.ziy-playlist@ziy.app: True
```

The acceptance criterion — `prefs.js` contains
`extensions.installedDistroAddon.ziy-playlist@ziy.app` — **is met**, and
`extensions.json` records `"active": true, "userDisabled": false,
"appDisabled": false, "visible": true` with
`"targetApplications": [{"id": "toolkit@mozilla.org", "minVersion": "115.0"}]`.

### 5.1 The panel renders, and its own DOM is what is asserted

```
panel url: file:///…/build/verify/playlist-panel-staged/ui/panel.html
  ok   the screenshot is a real render
       1200x600, 1158 distinct colours
  ok   the panel heading is Ziy's own word
  ok   the media element is present
  ok   every transport control exists
  ok   the queue is a real ordered list
  ok   the volume control exists
  ok   the settings section exists
  ok   the tokens are actually applied
  ok   the honest background-playback note is in the UI
  ok   the second row is audio, and typed as such
  ok   the top row's up button is inert
  ok   the bottom row's down button is inert
ALL ASSERTIONS PASSED
```

### 5.2 Capture: the shipped classifier adds a real item

```
capture: {"ok":true,"item":{"url":"file:///…/tiny.mp4","kind":"media",
          "type":"video","mime":"video/mp4",
          "title":"The Ziy proof clip", …},"added":true,
          "classified":"direct"}
  ok   classified as: direct
queue rows in the DOM after the reload: 1
  ok   the captured item rendered as a real row
row title: 'The Ziy proof clip'
```

### 5.3 Playback: a real decode, a real pause, a real seek

```
playback: {"played":true,
           "afterPlay":{"src":"file:///…/tiny.mp4","paused":true,
                        "currentTime":0.333333,"readyState":2,
                        "duration":0.333333,"ended":true,"error":null},
           "paused":true,"currentTime":0.09999989999999999,
           "seekedTo":0.09999989999999999}
  ok   the media element really decoded it: played 0.333s of 0.333s, ended=True, readyState=2
  ok   paused on request
  ok   seeked to 0.100s
```

The fixture is 0.33 seconds long, so it reaches its end before the check — the
element's own `ended` event is the evidence that it played, which is stronger
than pausing mid-way and then checking a position. Current time equals duration
equals 0.333333 s, then seeking to 0.100 s lands at exactly 0.100 s.

Two throwaway-profile prefs are set for this run only
(`media.autoplay.default = 0`, `media.autoplay.blocking_policy = 0`), because a
headless boot has no user gesture and Gecko's autoplay policy would otherwise
refuse to start the fixture. The product's real path is the user's own click
on the row; the prefs only stop the harness from having to fake a click.

### 5.4 Reorder and resume survive a reload

```
reorder: {"ok":true,"order":["Second clip","The Ziy proof clip"],"savedAt":2}
order after reload: ["Second clip","The Ziy proof clip"]
  ok   the reorder survived the reload in the moved order
position written: {"ok":true,"stored":0.1,"savedAt":2}
resume after reload: {"position":0.1,"duration":0,"title":"Second clip"}
  ok   resume position persisted at 0.1s
```

Both are reloaded-from-storage assertions: the store is written through the
panel's own ops and read back after a navigation, so a value that survives did
not come from a page variable.

---

## 6. How the panel page is reached, honestly

The route deserves its own section, because it is the one part of this proof
that is indirect and it must not be dressed up.

Firefox's remote protocol on this machine is WebDriver BiDi
(`firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html`), not
Chrome's CDP. Three routes were tried in order, and each failure is recorded:

1. **`webExtension.moz:listExtensions`** — returns `unknown command` on this
   build. The same result `replica/proofs-talk.md §4.3` recorded: the module's
   `policy`/`sourceURL` fields need `RemoteAgent.allowSystemAccess`, which is
   not set here.
2. **`extensions.json`'s `baseURL`** — not present. The entry carries
   `rootURI` (`jar:file:///…ziy-playlist@ziy.app.xpi!/`) but never the internal
   `moz-extension://` UUID.
3. **The UUID from the profile's storage tree, then
   `browsingContext.navigate` to `moz-extension://<uuid>/ui/panel.html`** — the
   UUIDs are discoverable (`storage/default/moz-extension+++<uuid>^…`), and
   four UUIDs were found, but every navigation attempt fails with
   `unsupported operation`. This build's BiDi refuses the scheme outright.

The proof therefore drives a **staged `file://` copy of the shipped `ui/` and
`lib/`**, byte-identical apart from one added `<script>` for the harness's
`browser.*` shim. That is exactly the route `tools/e2e/ziy-talk-panel.py` and
`tools/e2e/ziy-news-panel.py` use and `replica/proofs-talk.md §4.4` records,
for the same reason. What that costs and what it does not:

- **Proven about the shipped code:** the panel's DOM, tokens, rows, transport,
  reorder, resume, and the shipped classifier. The shim's queue and settings
  are answered by the shipped `lib/` files, so the logic exercised is the
  shipped logic.
- **Not proven this way:** the extension's own runtime message plumbing, the
  IndexedDB write, the toolbar Action, and the content script's injection.
  The content script does not inject on this build for *any* ziy add-on —
  verified here directly: shields' cosmetic script is absent from a launch page
  too, which is the same limitation talk recorded. The IndexedDB write is
  unit-tested at the model level (`test/model.test.js`, `test/decode.test.js`)
  and the store's shape is pinned by `test/manifest.test.js`.

The install marker and the active state *are* proven from the real profile
above, so this section proves the surface, not the install — and says so rather
than implying the panel was reached through the add-on's own origin.

---

## 7. Performance posture, from `replica/fixes.md`

`fixes.md §1.2` is the largest complaint theme in the corpus (273 reviews, avg
2.5 stars) and it names background services as the cause. This extension is
built to not be one:

| fix number honoured | how |
| --- | --- |
| **§1.2's CPU/memory theme** | the event page has **no alarm, no periodic refresh, no polling**. It wakes for a message and is suspended between calls. Nothing in this extension sets an interval in the background. |
| **no background network activity** | the event page performs no fetch at all on its own; there is no feed, no manifest pre-loading, no reachability check. The only network in the product is the media element playing an item the user chose. |
| **lazy RPC** | the panel's position save is armed **only while playing** (5 s interval) and disarms on `pause`/`ended`; a paused player writes once, on the event. The sleep-timer tick is armed **only while a timer is running**. When nothing is playing the panel does nothing at all. |
| **debounced, not batched** | queue writes collapse a drag-reorder burst into one write with a 150 ms debounce — short enough that no update is perceived as lost, long enough that one reorder is one write. |
| **no message port per tab** | `content/capture.js` uses `runtime.sendMessage`, not a persistent port: the panel is the player, so there is no live consumer, and an open port per tab is sustained background work for nothing. |
| **no rendered-out content** | the classifier never fetches a manifest to check it; a `.m3u8` is classified by extension or declared type, and the loader resolves it at play time or the row opens a tab. |

The `strict_min_version` is `115.0`, the same floor the sibling extensions use.

---

## 8. Honest limitations

| item | status | why |
| --- | --- | --- |
| `extensions.installedDistroAddon.ziy-playlist@ziy.app` | **VERIFIED** | §5 |
| panel surface: DOM, tokens, rows, transport, reorder, resume | **VERIFIED** | §5.1, §5.4 — from the shipped files, via the staged route |
| a real media file plays, pauses and seeks | **VERIFIED** | §5.3, with a gstreamer-generated mp4 |
| reorder and resume persist across a reload | **VERIFIED** | §5.4, from storage, not from a page variable |
| the model, the classifier, the sleep timer, settings merge | **VERIFIED** | §2, 83 node assertions over the shipped files |
| the event page's runtime plumbing and the IndexedDB write, end to end | **NOT VERIFIED IN-BROWSER** | the `moz-extension://` route is unavailable on this build (§6); the model and the store shape are unit-tested, and the surface proof uses the shipped libs, but the add-on's own message loop was not driven live |
| the content script's injection into a page | **NOT VERIFIED** | declared and active with the right origins, but this build does not inject a content script for any ziy add-on (§6) — recorded as an open question rather than explained away, exactly as `proofs-talk.md §4.4` does |
| **background playback** (continues when the panel closes) | **UNAVAILABLE, AND SAID SO** | the sidebar document is unloaded when the sidebar closes (MDN, [Sidebars](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars): "Sidebar documents are unloaded when their browser window is closed or when the user closes the sidebar"). An extension has no browser-side media process. This engine gives an extension no such process, so playback pauses with its place kept, and the panel says so in the UI rather than shipping a switch that would lie. The reference's background playback is an OS-level feature of its own architecture. |
| **HLS live manifests** | **DOCUMENTED LIMITATION** | VOD plays (the loader reads the manifest and resolves the variants); live has no start, so this engine's streams cannot resolve it, and a live manifest item opens in a tab |
| **DASH (`.mpd`)** | **NOT PLAYABLE, DELIBERATELY** | no DASH pipeline on this engine; a `.mpd` is a page item, which is the honest answer |
| **DRM'd / authorised content** | **NOT SUPPORTED** | the media element plays the URL with the host permission; a stream that requires signed cookies or a CDM will refuse. Nothing in the queue pretends otherwise |
| **PiP in the panel** | **SUPPORT-CONDITIONAL** | `requestPictureInPicture` shipped in Firefox **153** (MDN BCD, `HTMLVideoElement.requestPictureInPicture`), and this build is 156, so the control is live; the button is disabled with an explanatory label if a build lacks it |
| **panel side (left/right)** | **A RECORDED PREFERENCE, NOT A PROMISE** | no extension API moves the sidebar: the browser owns placement. The setting records the preference and the options page says the browser keeps the final word |
| **media quality** | **A NOTE, NOT A SWITCH** | choosing a variant is adaptive bitrate switching, and this engine has no switcher. The preference is recorded, the first variant plays, and the UI says so rather than shipping a control that does nothing |
| **Address-bar prompt** | **EQUIVALENT, NOT THE SAME** | Gecko's address bar is not an extension surface; the prompt is page-level plus a toolbar Action (`§3`) |
| **Nightly-only availability** | **N/A HERE** | Brave's desktop Playlist is Nightly-channel only and absent from the user's Origin build; Ziy ships it, per the matrix, in its own way |

---

## 9. Reproducing

```bash
# the model suites (no browser needed)
node --test 'extensions/ziy-playlist/test/'

# regenerate the fixtures (gstreamer; deterministic BY BYTE COUNT — the muxers
# embed their own metadata, so a re-run writes byte-different files of the same
# size, and decode.test.js regenerates them in place on every test run; the trio
# under test/fixtures/ will show dirty after `npm test` — restore before a
# commit: git checkout -- extensions/ziy-playlist/test/fixtures/)
python3 extensions/ziy-playlist/tools/make-fixtures.py

# package the xpi (deterministic; same bytes on re-run)
bash tools/build-extension.sh extensions/ziy-playlist
python3 tools/lib/zpxi.py list build/ziy/distribution/extensions/ziy-playlist@ziy.app.xpi

# the boot proof (throwaway profile only, anchored kill)
timeout 400 python3 tools/e2e/ziy-playlist-panel.py
grep -o 'extensions.installedDistroAddon[^,]*' /tmp/ziy-playlist-verify/prefs.js | sort -u
```

---

## 10. Sources fetched for this file (2026-10-14)

| URL | what it told us |
| --- | --- |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions | the host-permission privilege list, whose first entry is XHR/fetch to those origins without cross-origin restrictions — the documented basis for §4 |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/background_scripts | "Background scripts can make XHR requests to hosts they have host permissions for", and the event-page rules (synchronous listeners) §5 of the background page implements |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars | sidebar documents are unloaded when the sidebar or window closes — the mechanism behind §8's background-playback limitation |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action | the manifest key, `open_at_install`, and that `browser_style` is not supported in MV3 from Firefox 118 |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction | Gecko has no `setBadgeText`/`onFocus`/`onBlur`, so counts live in the panel DOM, not the API |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy | the default MV3 CSP, `script-src 'self'`, and why `media-src 'self'` is the right extension-pages policy |
| https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Streaming | "The desktop version of Firefox … does not support HLS" natively — the reason §3's manifest path is an extension-side loader |
| https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats | Gecko's media capability is the engine's own, which is what §3's direct-file list is scoped to |
| https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API | the PiP API shape, `document.pictureInPictureEnabled`, and the `enterpictureinpicture` event |
| https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/HTMLVideoElement.json | `requestPictureInPicture` is `version_added: 153` on Firefox — why §8's PiP row is support-conditional and this build (156) satisfies it |
| https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest | `webRequestBlocking` + host permission is what gives response-body access — the permission pair §4's manifest declares |
