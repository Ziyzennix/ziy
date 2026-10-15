# Ziy NTP — module notes

The new tab page extension. Owner of recon S02–S05, S51 and flows F08/F09.

## Shape

```
manifest.json        MV3, Gecko 156. background.scripts (no service worker):
                     Firefox bug 1573659 means service_worker is not implemented,
                     so the event page is `scripts`.
background/
  background.js       event page: ntp.config messages, the shields contract,
                     the resolved engine list, backdrop-refresh reloads
lib/
  model.js            pure config model, defaults, merge, top-sites model,
                     engines, clock — one definition, used by everything
  storage.js          the only writer of browser.storage.local
ui/
  ntp.html / .js/.css the new tab page (chrome_url_overrides.newtab)
  options.html/.js    the about:addons → Preferences page
  ntp.css             the stylesheet for both pages
  icons/              the Ziy mark at 48 and 96
test/
  model.test.js        node:test, no framework: `npm test`
```

## Keys (architecture.md §3.1)

| key | shape |
| --- | --- |
| `ntp.config` | the `NewTabPage` entity: widget toggles, background, modes |
| `ntp.topsites.favorites` | `TopSite[]`, the curated list |
| `ntp.topsites.frequent` | `TopSite[]`, computed from topSites/history |
| `ntp.engines` | `{id, checked, urlTemplate?}[]` |
| `ziy.shields.blockedTotal` | the cross-module contract; **written by ziy-shields, read-only here** |

## Platform note

`chrome_url_overrides.newtab`, `storage`, `topSites` and `history` are the
portable core and everything else in this extension is page JavaScript. The one
desktop-shaped surface is `browser.search.search({engine})` for
browser-provided engines: it opens a new tab, which is a whole-window concept.
On a platform without that API the page falls back to navigating to the
engine's own URL, and our own fallback engine list always has a URL to
navigate to. Nothing in this extension reaches for `tabs`, `windows` or a
filesystem path, so the NTP itself works unchanged on narrow viewports and on a
device.

## Tests

```
cd extensions/ziy-ntp && npm test     # or: node --test test/
```

## Package

The xpi is built by the shared `tools/build-extension.sh` when it is present;
its name must be `ziy-ntp@ziy.app.xpi` because the app-scope installer derives
the add-on id from the filename (`getExpectedID()` in `XPIProvider.sys.mjs`).
`manifest.json` declares `browser_specific_settings.gecko.id` as the same value.
