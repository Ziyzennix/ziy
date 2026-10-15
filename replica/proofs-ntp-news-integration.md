# Proof — the Ziy News → NTP integration, applied

**Status:** applied and verified, 2026-10-14.
**Patch applied:** `replica/patches/ziy-ntp-news-integration.md` (was "NOT APPLIED").
**Proof harness:** `tools/e2e/ziy-ntp-news.py`.

The patch's three edits were applied to `extensions/ziy-ntp` (its owner the NTP
workstream), so the new tab page now carries a news region that reads
ziy-news's `feed.snapshot` and paints NTP-owned markup. ziy-news itself was not
modified: it already answers the message.

---

## 1. The applied change

| # | file | change |
| --- | --- | --- |
| 1 | `lib/model.js` | `NEWS_EXTENSION_ID = "ziy-news@ziy.app"` beside `SHIELDS_EXTENSION_ID`, exported on the model object; `Object.freeze({ id: "news", label: "News" })` appended to `WIDGETS`; `news: false` added to `defaultConfig().widgets` |
| 2 | `ui/ntp.html` | the `<section class="ntp-news" id="news" role="region" aria-label="News" hidden>` region after the stats `</section>` and before top sites, with its five ids: `news-heading`, `news-count`, `news-list`, `news-status`, `news-empty` |
| 3 | `ui/ntp.js` | the five ids in `cacheElements()`; `setHidden(el.news, !widgets.news); if (widgets.news) loadNews();` in `renderWidgetVisibility()`; `loadNews()` and `renderNews()` beside `loadStats()`; `loadNews` exposed on `ZiyNtpPage` |

Supporting changes that the patch's own description implied, each kept minimal:

| file | change | why |
| --- | --- | --- |
| `ui/ntp.css` | a `.ntp-news*` block reusing `--ntp-widget-frost`, `--radius-lg`, `--text-*`, `--leading-*`, `--weight-*`, `--text-muted`, `--accent`, `--border`, `--space-*` | the patch says "reuse the existing NTP widget rules", which the shipped stylesheet had no rule to reuse; no new stylesheet and no hard-coded value |
| `ui/ntp.js`, `ui/options.js` | a `news:` description in each dashboard's `descriptions` map | the patch says registering the widget "gives the feature a real on/off in the existing UI with no new settings surface" — the rows are generated from `model.WIDGETS`, so without a description the new row rendered blank |
| `shell/browser/defaults/preferences/ziy.js` | `pref("ziy.ntp.widgets.news", false)` | the model's header comment requires the pref layer and the extension defaults to agree, or a fresh profile sees two different defaults |
| `test/page.test.js`, `test/model.test.js` | the three widget-count/lists assertions updated to the six-widget shape, plus five new tests (§2) | the exact-shape pins the model test keeps must stay true |

The integration is additive and gated by the **existing** widget toggle: the
news section is a `model.WIDGETS` entry, so `widgets.news` lives in the same
`ntp.config` the rest of the page reads, is switched from the same customize
dashboard row and the same options page row, and survives the same merge rules.
No second settings store was introduced.

### Failure tolerance

Every branch is a visible state, never a thrown page:

| condition | behaviour |
| --- | --- |
| ziy-news not installed | `sendMessage` rejects (or never resolves) → `catch` → `renderNews(null)` → empty state |
| `reply.ok === false` | `renderNews(null)` → empty state |
| `snapshot.version !== 1` | the `usable` guard fails → empty state |
| no `browser`/`chrome`, or no `runtime.sendMessage` | the early return → empty state |
| widget off | the region stays `hidden` and `loadNews()` is never called |

In every one of those the other widgets are untouched: the news section is a
sibling region, and the only nodes it writes are its own five ids.

---

## 2. The suite

```
$ node --test extensions/ziy-ntp/test/
ℹ tests 81
ℹ pass 81
ℹ fail 0
```

**81 passing (was 76, of which 5 are new).** Baseline was 76/76.

| phase | tests | pass | fail |
| --- | --- | --- | --- |
| before the patch | 76 | 76 | 0 |
| after the patch | 76 | 76 | 0 |
| after the patch + the new news tests | 81 | 81 | 0 |

The five new tests are all in `test/page.test.js`, all driving the REAL
`ui/ntp.js` in the harness's node vm against its DOM and `browser` shim:

1. **the news region is off by default and stays hidden when ziy-news is absent**
   — asserts `widgets.news === false`, the region hidden, and that turning it on
   with a non-answering `sendMessage` yields the empty state, zero rows, and
   untouched top sites and stats;
2. **the news region renders the snapshot rows when ziy-news answers** — asserts
   the message is addressed to `ziy-news@ziy.app`, carries
   `{op:"feed.snapshot", request:{n:10}}`, and that two snapshot rows render as
   two `li[role=listitem]` rows whose `href`, title and
   `source · publishedLabel` meta come from the snapshot; `news-count` is
   `"1 new"` and the empty state retires;
3. **a reply that is not ok, or a shape this version does not know, degrades to
   the empty state** — `{ok:false}` and a `version:2` snapshot both land on the
   empty state with zero rows;
4. **a sendMessage that rejects, or a page with no runtime, leaves the region
   hidden** — a rejecting `sendMessage` shows the empty state, and turning the
   widget off with no runtime at all keeps it hidden;
5. **the news widget's region is a real landmark beside its siblings** — asserts
   the shipped HTML carries `role="region"`, `aria-label="News"`, `hidden`, and a
   `role="list"` rows container.

---

## 3. The xpi

```
$ tools/build-extension.sh extensions/ziy-ntp
  ok    ziy-ntp@ziy.app          15 files, 51313 bytes
  1 packed, 0 failed
```

(15 files, up from 15 at 49737 bytes — the page and stylesheet grew; the tree is
still 15 members because the new files were none.)

```
$ tools/build-extension.sh --check
  OK   ziy-ntp@ziy.app.xpi: id ziy-ntp@ziy.app, 15 files, 51313 bytes uncompressed, ...
  7 xpi(s) checked, 0 bad
```

The suite check stays clean: every xpi is `<addon-id>.xpi`, carries a manifest
with the same `browser_specific_settings.gecko.id`, and lists its members.

---

## 4. The in-browser evidence

```
$ python3 tools/e2e/ziy-ntp-news.py
```

Route: headless on `build/ziy/firefox` with a throwaway
`/tmp/ziy-ntp-news-verify-profile`, `--marionette` +
`--remote-debugging-port=9231` (WebDriver BiDi, not CDP); a BiDi session over
`ws://127.0.0.1:9231/session`.

### 4.1 Both add-ons installed and active — from the real profile

```
installed suite add-ons: ['ziy-news@ziy.app', 'ziy-ntp@ziy.app',
  'ziy-playlist@ziy.app', 'ziy-shell@ziy.app', 'ziy-shields@ziy.app',
  'ziy-sync@ziy.app', 'ziy-talk@ziy.app']
  ok   ziy-ntp@ziy.app installed      ntp active=True
  ok   ziy-ntp@ziy.app active
  ok   ziy-news@ziy.app installed     news active=True
  ok   ziy-news@ziy.app active
  user_pref("extensions.installedDistroAddon.ziy-ntp@ziy.app", true);
  user_pref("extensions.installedDistroAddon.ziy-news@ziy.app", true);
  ok   both install markers are in prefs.js
```

Both markers present in `prefs.js`; both `active: true` in `extensions.json`;
the add-on's real origin was resolved from the profile's
`extensions.webextensions.uuids` pref (this build leaves `baseURL` null):

```
ntp page url: moz-extension://6c9790cb-1432-45ba-a05a-3a594e28561e/ui/ntp.html
```

### 4.2 The news region renders rows

```
ntp page url: file:///…/build/verify/ntp-news/ntp-staged/ui/ntp.html
  (via staged file:// copy of the shipped ui/ + lib/ with a browser shim)
  page state: {"page": true, "model": true, "storage": true, "newsDefault": false,
               "newsHidden": true, "head": "News",
               "newsIds": [true, true, true, true, true],
               "otherWidgetsHidden": [false, false, false, false]}
  ok   the real ntp page booted its own script bundle
  ok   the news widget ships off a fresh profile
  ok   the news region is hidden while off
  ok   the news region's five ids exist in the real page
  ok   the other widgets are unaffected
  news state: {"page": true, "newsWidgetOn": true, "newsHidden": false, "rows": 2,
               "emptyHidden": true, "count": "1 new", "status": "2 stories",
               "firstTitle": "A story the new tab page shows",
               "firstMeta": "Example Wire · 3 hours ago",
               "othersHidden": [false, false, false, false]}
  ok   the news widget is on after the page render writes
  ok   the news region is visible
  ok   the news region renders at least one real row
  ok   the empty state retires when rows arrive
  ok   the count is real copy, not blank
  ok   a row's title and source/time are rendered
  ok   the other widgets are untouched by the news region
  count='1 new' status='2 stories'
  first row: 'A story the new tab page shows' / 'Example Wire · 3 hours ago'
  feed.snapshot reply from ziy-news: {"ok": true, "version": 1, "rows": 2}
  ok   ziy-news answers feed.snapshot for the ntp
  ok   the snapshot is contract version 1
  with news off: {"newsHidden": true, "rows": 2}
  ok   turning the widget off hides the region
FAILURES: none
```

### 4.3 The screenshot

```
screenshot written: …/build/verify/ntp-news/ntp-news.png
  size=(1200, 600)  distinct colours=1874  non-white pixels=624103
  ok   the screenshot is not blank
```

PIL over the captured viewport: 1874 distinct colours, 624103 non-white
pixels — a rendered page, not a blank canvas.

### 4.4 Kill hygiene

```
cleanup: killed 1 process(es) matched by the anchored pattern
```

The only pattern ever matched is `/tmp/ziy-ntp-news-verify-profile`. The user's
own Firefox, WhatsApp and LibreOffice are never matched — the product directory
name contains "brave", which is why a bare `pkill` word is strictly avoided.

---

## 5. Deviations from the patch document

Four, each recorded here and each minimal:

1. **The NTP page's own five ids are not all in the patch.** The patch names
   five ids it writes (`news`, `news-count`, `news-list`, `news-status`,
   `news-empty`) but its own HTML snippet ships a sixth, `news-heading`, on the
   `<h2>`. All six are in the shipped HTML, so the snippet's contract and the
   patch's list are both satisfied. No script change.

2. **`ui/ntp.css` gained a `.ntp-news*` rule block.** The patch's Edit 2 said to
   "reuse the existing NTP widget rules … without a new stylesheet". Every
   existing rule it names is a declaration block on another widget's selector
   (`.ntp-stats`, `.ntp-cards`), so reusing them literally would have meant
   writing nothing and shipping an unstyled region. The block reuses the same
   tokens and the same frost/radius surface as `.ntp-cards`, adds no new
   stylesheet, and hard-codes no colour.

3. **A `news` description was added to both dashboards' `descriptions` maps.**
   The patch said registering in `WIDGETS` gives "a real on/off … with no new
   settings surface". The dashboard rows are generated from `model.WIDGETS`, and
   an entry with no description renders a blank description — which would have
   been a new settings surface with a hole in it. One line per dashboard.

4. **`tools/e2e/ziy-ntp-news.py` drives the staged `file://` copy, not the
   add-on origin.** This is a limitation of this engine build, not a choice:
   `browsingContext.navigate` to `moz-extension://…` fails with
   `unsupported operation` on this BiDi build (the same boundary
   `replica/proofs-ntp.md §3.4` and `replica/proofs-playlist.md §4.3` record;
   `about:newtab` and `about:home` are refused too, and a headed
   `--screenshot about:newtab` times out at 60 s). The script tries the real
   origin first, reports which route it used, and falls back to a byte-identical
   copy of the shipped `ui/` and `lib/` with one added `<script>` for a
   `browser` shim — the route `tools/e2e/ziy-news-panel.py` and
   `tools/e2e/ziy-talk-panel.py` use. What that costs and what it does not:

   - **Proven about the shipped code:** the ntp page's real script bundle, its
     real render path, its real `hidden` gating, its real message to
     `ziy-news@ziy.app`, and the render of the real contract's row shape.
   - **Proven from the real profile, not the shim:** both add-ons installed and
     active, and both install markers.
   - **Not proven this way, and stated as such:** the extension's own runtime
     message plumbing into the real background page. The snapshot returned to the
     page comes from the shim; the same contract is proven end-to-end against
     the real background page on the news side (83 node tests, including the
     real background page answering `feed.snapshot` in a node vm — see
     `replica/proofs-news.md`).
   - The one open item: a headed run to capture a screenshot of the add-on
     origin's own page, which is the navigation a remote client cannot perform
     (`replica/proofs-ntp.md §3.5` records the same gap for the NTP).

Two smaller deviations:

5. **`shell/…/ziy.js` gained `pref("ziy.ntp.widgets.news", false)`.** The patch
   did not mention the shell pref layer. `lib/model.js`'s own comment says the
   pref layer and the extension defaults "must agree or a fresh profile would
   show two different defaults", so leaving it out would have broken that
   invariant the patch relies on. The news proof boots the real app dir, so the
   pref is in force and is verified by the boot.

6. **The three count/list assertions in the shipped tests were updated.** They
   pinned the five-widget shape exactly (`6 = five widgets plus cards`,
   `Object.keys(widgets).length === 5`, and the `WIDGETS` id array). Registering
   `news` makes those facts false, so they now assert the six-widget shape. This
   is the patch's Edit 1 validated by the tests that guard it, not a weakened
   assertion.

---

## 6. Reproducing

```bash
# the suite (no browser needed)
node --test extensions/ziy-ntp/test/     # 81 pass, 0 fail

# package
tools/build-extension.sh extensions/ziy-ntp
tools/build-extension.sh --check

# the in-browser proof (needs a built app dir: tools/build-shell.sh --force)
tools/build-extension.sh --all
python3 tools/e2e/ziy-ntp-news.py
```

Kill hygiene, in the script and in any manual follow-up: `pgrep -f
'/tmp/ziy-.*profile'` then kill the PIDs. Never a bare word.
