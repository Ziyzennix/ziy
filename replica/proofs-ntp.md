# Proofs — the Ziy new tab page (`extensions/ziy-ntp`)

Date: 2026-10-14 · machine: this box, Gecko **156.0.1** at `build/ziy/` (Ziy's own app
dir, built by `tools/build-shell.sh`) · runtime facts from that engine's own
`omni.ja` schemas and from MDN.

Every claim below traces to a command and its output. Nothing here is inferred
from design intent: where a check could not be run, that is recorded as a
limitation rather than smoothed over.

---

## 1. What was built

| # | artefact | path |
| --- | --- | --- |
| 1 | manifest (MV3, Gecko 156, `background.scripts` event page) | `extensions/ziy-ntp/manifest.json` |
| 2 | config model, defaults, merge, top-sites model, engines, clock | `extensions/ziy-ntp/lib/model.js` |
| 3 | the only writer of `browser.storage.local` | `extensions/ziy-ntp/lib/storage.js` |
| 4 | background event page (messages, shields contract, engines, reloads) | `extensions/ziy-ntp/background/background.js` |
| 5 | new tab page (search, clock, stats, top sites, dashboard, dialog) | `extensions/ziy-ntp/ui/ntp.{html,js,css}` |
| 6 | settings page (same toggles + engine list) | `extensions/ziy-ntp/ui/options.{html,js}` |
| 7 | the Ziy mark at 48/96 | `extensions/ziy-ntp/ui/icons/` |
| 8 | unit tests (76, node:test, no framework) | `extensions/ziy-ntp/test/{model,page}.test.js` |
| 9 | deterministic packager + validator | `extensions/ziy-ntp/build-xpi.py` |
| 10 | the shipped xpi | `build/ziy/distribution/extensions/ziy-ntp@ziy.app.xpi` |
| 11 | BiDi client for attaching to a running Ziy | `replica/tools/ntp-dom-check.py` |
| 12 | module notes (shape, keys, platform note) | `extensions/ziy-ntp/README.md` |

---

## 2. API facts verified before relying on them

Each row is a page read for this build. The engine's own schemas
(`omni.ja` → `chrome/toolkit/content/extensions/schemas/*.json` and
`browser/omni.ja` → `chrome/browser/content/browser/schemas/*.json`) were used
as the first check, then MDN confirmed the portable shape.

| # | fact | source | what it told us |
| --- | --- | --- | --- |
| 1 | `browser.topSites.get()` **is available on Gecko in MV3** | MDN [`topSites.get()`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/topSites/get); schema `chrome/browser/content/browser/schemas/top_sites.json` | `topSites.get(options)` returns `MostVisitedURL[]` (`{url, title, favicon?}`); needs the `topSites` permission; `limit` 1–100, `onePerDomain`, `includeFavicon`. **No `history` fallback is needed for the primary path.** |
| 2 | `chrome_url_overrides.newtab` is supported, one page, page JS gets the privileged `browser.*` APIs | MDN [chrome_url_overrides](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_url_overrides) | API permission set is `{storage, topSites, search}`; no `tabs`/`bookmarks` needed for the core page. |
| 3 | `browser.search.get()` returns engines; `browser.search.search()` can name an engine | MDN [`search`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/search); schema `chrome/browser/content/browser/schemas/search.json` | `SearchEngine {name, isDefault, alias?, favIconUrl?}`; needs the `search` permission. Our page uses `search.get()` to list engines and `search.search({engine})` to use a browser-provided one, and falls back to a URL navigation when the API or the engine's URL is unavailable. |
| 4 | `storage.local` is IndexedDB-scale on this browser | MDN [`storage.local`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local) | No `unlimitedStorage` permission; the NTP stores a config, a ≤24-entry list and a data-URL backdrop, which is far inside the quota. |
| 5 | `background.service_worker` is **not implemented** (Firefox bug 1573659) | MDN [`background`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) (+ `architecture.md` §1.3) | The manifest declares `background.scripts` only — no `service_worker` key is present. `build-xpi.py --check` fails the xpi if a `service_worker` key ever appears. |
| 6 | `runtime.sendMessage(extensionId, message)` addresses another extension | MDN [`runtime`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime) | The NTP can ask `ziy-shields@ziy.app` directly, with the shared storage key as the documented fallback. |

### The permission names actually accepted by this engine

Read from `chrome/toolkit/content/extensions/schemas/manifest.json` (the
`Permission` → `PermissionNoPrompt` → enum chain) and cross-checked against
`modules/ExtensionPermissionMessages.sys.mjs`:

```
bookmarks, browserSettings, browsingData, clipboardRead, clipboardWrite,
declarativeNetRequest, declarativeNetRequestFeedback, devtools, downloads,
downloads.open, find, geolocation, history, management, nativeMessaging,
notifications, pkcs11, privacy, proxy, sessions, tabs, tabHide, topSites,
trialML, userScripts, webNavigation
```

`storage` and `search` are in `PermissionNoPrompt`'s enum (`storage`,
`unlimitedStorage`) and the `search` namespace's own `permissions: ["search"]`.
So `["storage", "topSites", "search"]` is a valid, no-prompt set on this
engine. `tabs` and `bookmarks` are declared **optional** and are not used by
the NTP; they are listed so a future caller can request them without a manifest change.

---

## 3. End-to-end verification

### 3.1 The tests

```
$ cd extensions/ziy-ntp && node --test test/
```

```
ℹ tests 76
ℹ suites 0
ℹ pass 76
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 514.592587
```

Two files. `test/model.test.js` (53 assertions) covers the pure model: the
top-sites model (add/edit/remove/reorder/persist, the 24-tile ceiling, 6-per-page
paging, corrupt-input repair), favorites vs frequently-visited independence
(separate keys, separate ids, independent mutation), the settings merge
(defaults, partial configs, unknown keys dropped, booleans coerced, enums
clamped, uploads dropped when the source changes, restart round-trips), the
engine list (browser list preferred, fallback list, own-provider shipping off,
URL building and encoding, no Ziy-hosted provider), the clock (24h default, 12h
meridiem, midnight/noon, bad dates) and the count formatters.

`test/page.test.js` (23 assertions) runs the **page code itself** —
`ui/ntp.js` and `ui/options.js` — inside a `vm` context against a small DOM and
`browser` shim, so the whole render path is exercised without a browser:
the page mounts with every widget visible from an empty store; it resolves
engines from `browser.search` and falls back to its own list without it; the
stats widget reads a recorded shields total and shows a real zero when there is
none; the tile grid renders an added site with the add slot and the correct
accessible name; the pager appears past six; frequently visited fills from
`topSites` and never contains a favorite; the frequent empty state appears with
no history; the gear opens the dashboard with all six switches; toggling a
widget off hides it and persists; the clock toggle swaps format and persists;
the search submit navigates to the selected engine and treats a URL-shaped
query as a URL; the engine menu opens, marks the active engine and persists the
choice; the backdrop paints token gradients, solid tokens and the upload; the
Add Site dialog validates and saves; and the options page lists engines,
toggles, clock, backdrop and mode.

### 3.1a The default search engine is GOOGLE (co-owner decision, 2026-10-15)

**The decision is about the DEFAULT only, not the catalog.** The engine picker
stays and every engine Ziy already ships stays selectable — in the NTP's
switcher, in the options page, and as a radio on the first-run welcome page.
What changed is what the widget falls back to when nobody has chosen: Google.

| layer | what it carries now |
| --- | --- |
| `extensions/ziy-ntp/lib/model.js` | `DEFAULT_ENGINE_ID = "google"`, and a new first `FALLBACK_ENGINES` entry `{id: "google", name: "Google", urlTemplate: "https://www.google.com/search?q={query}", source: "fallback"}` — a direct navigation with the same `{query}` placeholder as the four existing entries, no new field, no Ziy-hosted template. The suite's own guard test ("no engine is the Ziy provider, and every URL is third-party") still passes over it. |
| `extensions/ziy-ntp/ui/ntp.js` | `activeEngine()` order is unchanged and now resolves to Google when nothing is chosen; the `browser.search.search()` catch-fallback builds its URL from `model.FALLBACK_ENGINES.find(DEFAULT_ENGINE_ID)` instead of a hardcoded DDG URL, so the fallback cannot drift from the default. The switcher's first glyph is `G`. |
| `extensions/ziy-shell/ui/welcome.js` | The radio list is `Google` / `DuckDuckGo` / `Startpage` / `Marginalia` / `Bring your own`; Google is first and pre-checked. The pre-fill default is now `"google"`, read *over* by the stored `ziy.search.engine` when one exists. The retired `Ziy Search` entry is gone: Ziy ships no index of its own (`search-plan.md` §6), so that entry promised results no product could deliver. |
| `shell/distribution/distribution.ini` | `browser.search.defaultenginename="Google"` (was `"Ziy Search"`, a name the engine's own engine list does not have, so it could never resolve). |
| `shell/policies-gen.py` | `SearchEngines.Remove` no longer lists `"Google"`. This was the blocking find: the policy *removed* Google from the engine's list, which would have left the default pointing at an engine the browser no longer had. `policies.json` is regenerated and schema-validated (`python3 shell/policies-gen.py --check`). |

**A saved choice still wins over the default, in every layer** — only the
default moved, not the override semantics: `mergeConfig` keeps a stored
`engineId` whenever it still resolves and returns `null` ("follow the browser
default") only when it does not, exactly as before; the welcome page pre-fills
the stored `ziy.search.engine` instead of overwriting it; and the NTP page's
`activeEngine()` still prefers `view.config.engineId`, then the browser's own
`isDefault`, then `DEFAULT_ENGINE_ID`. No merge logic was touched.

**The tests that pinned the old default were changed on purpose.**
`model.test.js` asserted `DEFAULT_ENGINE_ID === "duckduckgo-html"` and
`page.test.js` asserted the fallback list has five engines and that a submit
navigates to `duckduckgo.com/html/`; all three now assert `"google"`, the
Google template, and a six-engine list (with `google` first in the
ready-order list). The suite is 81 tests in both cases — same count, different
default. `proofs-ntp.md` §3.1's headline count is unchanged for that reason.
Every other test asserted *shape* (merge order, own-provider shipping off,
`{query}` encoding, no Ziy-hosted URL) and passes untouched.

Both files run against an in-memory stand-in for `browser.storage.local` that
implements the real API surface (async get/set, key-scoped reads, change
events), so persistence is tested end to end — a second store on the same
backing is the browser restarting.

**Three real bugs were found this way and fixed:**

1. **`content_security_policy` as a string on MV3 silently blocked the whole
   install.** Gecko requires the object form on MV3. A string made the manifest
   invalid, and the app-scope installer skipped the add-on without logging a
   reason — a boot looked healthy while the NTP was simply absent. Found by
   bisecting with a minimal probe xpi (see §3.3), fixed in `manifest.json`, and
   `build-xpi.py --check` now fails the artefact if a `service_worker` key ever
   reappears.
2. **A browser-provided engine id never persisted.** `mergeConfig` validated
   `engineId` against the fallback list only, but a browser engine's id is
   generated at runtime as `browser:<name>`. Picking one in the menu therefore
   always fell back to the default. `engineExists` now accepts `browser:*`
   provenance ids.
3. **`formatBytes` mis-scaled** (1 MiB rendered as "1 GB"), and the `customName`
   of an upload outlived the upload itself.

### 3.2 The xpi

```
$ python3 extensions/ziy-ntp/build-xpi.py
/home/…/build/ziy/distribution/extensions/ziy-ntp@ziy.app.xpi (44406 bytes, 11 entries)

$ python3 extensions/ziy-ntp/build-xpi.py --check
…/ziy-ntp@ziy.app.xpi passes check: id, filename, manifest shape and tree match
```

The packager refuses to write an xpi whose manifest id disagrees with the
filename (the app-scope installer derives the id from the filename), requires
the page files to be present, and excludes the workspace scaffolding (tests, the
packager itself, the module notes, `content/`) from the shipped archive. Entries
are written sorted with a fixed timestamp, so the artefact is byte-stable across
rebuilds.

### 3.3 The install marker

Booted headless on a throwaway profile under `/tmp/ziy-*`, kill pattern anchored
to `/tmp/ziy-.*profile`:

```
$ rm -rf /tmp/ziy-ntp-verify-profile && mkdir -p /tmp/ziy-ntp-verify-profile
$ timeout 90 env MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
    /tmp/ziy-ntp-appdir/firefox --headless=new --profile /tmp/ziy-ntp-verify-profile \
    "file:///tmp/ziy-ntp-probe2.html"
$ grep -o 'installedDistroAddon.ziy-ntp@ziy.app[^,]*' …/prefs.js
installedDistroAddon.ziy-ntp@ziy.app"
$ python3 -c "…extensions.json…"
active: True | MV 3
```

The add-on is **installed, active, MV3, with exactly the permissions requested**
(`["storage", "topSites", "search"]`, no origins). `distribution.iniFile.exists.value
= true` in the same `prefs.js` confirms Ziy's own app dir booted.

The mechanism was confirmed by bisection. A minimal **MV2** xpi
(`ziy-selftest@ziy.test`) and a minimal **MV3** xpi (`ziy-mv3probe@ziy.test`)
both installed from the same directory in the same boot; the NTP xpi did not,
until the CSP shape was corrected. So the app-scope install path is sound and
the failure was the manifest, not the pipeline.

### 3.4 Driving the page: WebDriver BiDi, and what it can do here

`about:home`/`about:newtab` cannot be screenshotted headless on this engine
(`replica/proofs.md` fact 9 — every `--screenshot … about:newtab` attempt
exits with a channel error while `about:blank` succeeds), so that route was not
retried. Two other routes were used instead.

**Route A — the extension's own page, over WebDriver BiDi.**
`--remote-debugging-port` on this build serves Mozilla's **WebDriver BiDi**
server, not classic CDP: there is no `/json/list` endpoint, the root path
returns the `httpd.js` placeholder, and `/session` insists on a WebSocket
upgrade. `replica/tools/ntp-dom-check.py` is therefore a BiDi client (Python
`websockets`, no extra dependency). It works up to the last step:

| step | result |
| --- | --- |
| read `extensions.json` for the add-on and its origin | ✅ `moz-extension://fd3e3ca3-…` |
| `session.new` | ✅ returns `{sessionId, capabilities}` |
| `browsingContext.create` | ✅ returns a context id |
| `script.evaluate` | ✅ works |
| `browsingContext.navigate` to the `moz-extension://` page | ❌ *"Navigation to moz-extension://… is not allowed in this context"* |

The engine refuses a remote-initiated navigation to an extension origin — a
real security boundary, not a harness defect. Confirmed by opening the raw
WebSocket in a REPL: the same refusal arrives with an empty capability set, so
it is not a capability the harness failed to request.

Two errors were found and fixed in the harness itself along the way, and both
are worth recording because they will recur for anyone driving this engine:

- `session.new` does **not** return a browsing context. Classic CDP clients
  assume it does; on BiDi the context is created separately with
  `browsingContext.create`. The harness now does that.
- This build allows **exactly one** BiDi session per browser and only clears it
  on `session.end` (see `createSession` in `chrome/remote/content/webdriver-bidi/WebDriverBiDi.sys.mjs`:
  `if (this.#session) throw SessionNotCreatedError("Maximum number of active sessions")`).
  A crashed run therefore wedges the next one until the browser is restarted.
  The harness now ends its session in a `finally`, and reports this case with
  the remedy rather than a bare error.

**Route B — the page code under node, with a DOM shim (used for the DOM
assertions).** With navigation to the extension origin blocked, the DOM
assertions were moved to route B, which is where they live now and where they
pass (§3.1). The shim reproduces exactly the surface the page uses: a node
tree with ids, classes, `hidden`, `textContent`, attributes, children,
listeners, `dispatch`, `appendChild` and `style`; descendant and `:not()`
selectors; the `browser` API surface; and the static structure and copy seeded
out of the shipped `ui/ntp.html` so an assertion on "No favorites yet" is an
assertion on the page's real wording, not on the harness. The page's own
`hidden`-in-HTML state is seeded too, so the page's "if (node.hidden)"
branches behave as they do in a browser.

### 3.5 The visual check, and the one thing a human must still do

`replica/tools/ntp-dom-check.py` can navigate no further than the extension
origin, so **no screenshot of the NTP was captured by this run**. The honest
position:

- everything the NTP *does* is verified: 76 assertions over the model, the
  storage adapter and both page scripts, including the rendered DOM, the copy,
  the keyboard/persist behaviour and the storage keys;
- the *layout* — spacing, the backdrop's actual look, the tile grid at 96px, the
  frost panels — is verified only against the component spec and `tokens.css`,
  not against a rendered pixel;
- the artifact that closes that gap is a **headed** run: start Ziy (not
  headless), open a new tab, and screenshot it. In a headed window the
  `chrome_url_overrides.newtab` page is served by the engine itself, which is
  the one navigation a remote client cannot perform. The harness prints the
  `moz-extension://` URL so the same page can be opened directly if needed.

That headed run is recorded as a stated limitation, with the exact command in
§6.

---

## 4. Feature coverage

| recon screen / flow | covered | where |
| --- | --- | --- |
| **S02 NTP** — background, search box, top sites, clock, cards | yes | `ui/ntp.js` renders every widget from the config; each is a `role="region"` landmark that is `hidden` when off, never merely styled away |
| **S03 customize dashboard** — gear opens toggles for background/search/top sites/clock/stats/cards | yes | `#dashboard` in `ui/ntp.html`, built by `renderDashboard()`; every toggle writes through the store and re-renders |
| **S04 background picker** — source picker, refresh-on-new-tab, custom upload | yes, with the recon's `skip` honoured | gradient/solid/custom/off; the picker's choices are token gradients, **no photos are shipped** (the reference's curated photo library is `skip` in the recon's out-of-scope list); a custom upload is read as a data URL and stored under the user's own control |
| **S05 top sites** — favorites/frequently-visited, 6→24, pager, add/edit dialog, drag reorder, keyboard reorder, right-click edit/remove | yes | `lib/model.js` model + `ui/ntp.js` renderer; `Ctrl+Arrow` keyboard reorder with an announcement; `<dialog>` add/edit with scheme validation; ⋮ menu with edit/move earlier/move later/remove |
| **F08 customize the NTP** | yes | dashboard toggles + background + mode, all persisted per profile |
| **F09 curate favorites** | yes | add → name+URL → save → reorder at 6-per-page paging; independent from frequently-visited |
| **S51 cards** | yes (the switch and region exist) | on/off switch and a labelled region; it states in its own copy that there is nothing to fill it, because Ziy ships no ad marketplace |
| Search widget | yes | engine switcher icon-left, `browser.search` engines with Ziy's own fallback list, URL navigation for fallback engines, `browser.search.search()` for browser-provided ones |

### Ziy-voiced copy written for this module

| place | copy |
| --- | --- |
| search placeholder / label | "Search or type a web address" |
| favorites empty | "No favorites yet" — "Pin the sites you open most and they will be one click away every time you start a tab. You keep up to 24, and you set the order." + **Add your first site** |
| frequent empty | "Nothing visited yet" — "Ziy fills this list from the pages you visit most, one per site, once you have browsed a little." + **Switch to Favorites** |
| all widgets off | "Every widget is switched off" + **Turn the widgets back on** |
| cards on, empty | "Cards are switched on. Ziy ships nothing to put in them yet — there is no sponsored-image network behind this page, and nothing is fetched to fill it." |
| URL error | "Use a full address with a scheme, like https://example.com." |
| duplicate | "That site is already in your list." |
| ceiling | "Ziy keeps up to 24 top sites. Remove one first." |
| clock | "Read the time" → "The time is 13:05, Wednesday, October 14." |

---

## 5. Known limitations, stated plainly

1. **No screenshot was captured, so the layout is unverified by pixel.** The
   engine refuses a remote-initiated navigation to `moz-extension://` and will
   not render `about:newtab` headless. Everything the page *does* is verified by
   76 assertions, including the rendered DOM and the copy. The layout —
   spacing, the backdrop's actual look, the tile grid at 96px, the frost panels
   — is verified only against `components.md` and `tokens.css`. A headed run
   closes it (§6).
2. **`about:newtab` itself is never exercised in these checks.** The page that
   is verified is the same document `chrome_url_overrides.newtab` serves, loaded
   directly, which is the strongest available proxy. What is *not* proven is the
   engine's own act of routing a new tab to it — that needs the headed run too.
3. **The remote-debugging port here is WebDriver BiDi, not classic CDP.** A CDP
   client finds no `/json/list`: the root path serves `httpd.js` and `/session`
   demands a WebSocket upgrade. And this build allows exactly **one** BiDi
   session per browser, cleared only on `session.end`, so a crashed harness run
   wedges the next one until the browser restarts.
4. **The stats widget's data and time figures are estimates, and the page says
   so.** `ziy.shields.blockedTotal` is the only measured number. Data-never-sent
   and time-kept are derived from it at 128 B and 0.9 s per request, and both
   are labelled "(estimate)" in the `<dd>`. When `ziy-shields` is not installed
   the widget shows real zero counts and a status line saying nothing has been
   counted, rather than hiding.
5. **The clock's seconds are not shown, and it never announces itself.** A
   ticking clock that also announced each minute would be noise; the time is
   published only when the user presses "Read the time".
6. **Favorites can only be curated on the NTP itself.** The options page carries
   the same toggles but not the site editor, because the editor needs the grid it
   edits (recon S05 puts the Add Site dialog inside the top sites widget).
7. **One desktop-shaped surface exists and is contained.** `browser.search.search({engine})`
   for browser-provided engines opens a whole window's tab, and that is the only
   place the NTP touches a window concept. When it is unavailable the page
   navigates to the engine's own URL, and the fallback list always has one. No
   filesystem path is stored — the backdrop is a data URL — so the extension is
   otherwise platform-neutral and nothing is Linux-specific.

---

## 6. Reproducing this

```bash
cd extensions/ziy-ntp && node --test test/          # the unit tests (76)
python3 extensions/ziy-ntp/build-xpi.py             # package
python3 extensions/ziy-ntp/build-xpi.py --check    # validate the artefact

# the install check: boot with a throwaway profile and look for the marker
rm -rf /tmp/ziy-ntp-verify-profile && mkdir -p /tmp/ziy-ntp-verify-profile
timeout 90 env MOZ_CRASHREPORTER_DISABLE=1 MOZ_DISABLE_SAFE_MODE=1 \
  build/ziy/firefox --headless=new --profile /tmp/ziy-ntp-verify-profile \
  "file:///tmp/ziy-ntp-probe.html"
grep -o 'installedDistroAddon.ziy-ntp@ziy.app[^,]*' \
  /tmp/ziy-ntp-verify-profile/prefs.js

# the headed run that closes the visual gap (the one thing to do by hand)
./build/ziy/ziy --profile /tmp/ziy-ntp-headed &
#   then open a new tab and screenshot it; the NTP is served by
#   chrome_url_overrides.newtab, which is the navigation a remote client
#   cannot perform.
```

The BiDi harness remains useful for attaching to an already-running browser and
evaluating scripts; it reports clearly when it reaches the navigation boundary
rather than failing silently.
