# Ziy News → NTP integration patch (APPLIED)

**Status:** applied to `extensions/ziy-ntp` on 2026-10-14 by the NTP workstream.
See `../proofs-ntp-news-integration.md` for the applied change, the test counts,
the in-browser evidence and the four recorded deviations from this document.
`extensions/ziy-news` was not edited: it already answered the message.

**Contract version:** 1 (`aggregate.SNAPSHOT_VERSION`).

The patch adds a news section to the NTP page that reads through ziy-news's
`feed.snapshot` message. It is three edits to two files, and it is defensive
on every branch: if ziy-news is absent or the reply is malformed, the section
shows its empty state and nothing else on the page changes.

---

## The contract, in one table

| direction | payload | reply |
| --- | --- | --- |
| NTP → ziy-news | `browser.runtime.sendMessage("ziy-news@ziy.app", {op:"feed.snapshot", request:{n:10}})` | `{ok:true, snapshot:{version:1, generatedAt, windowHours, total, unread, rows:[{id,title,snippet,url,sourceTitle,sourceCategory,sourceKind,image,published,publishedLabel,read,audio}]}}` |
| NTP → ziy-news | any other op | `{ok:false, error:{kind:"unknown-op", op:…}}` |

Discovery is built in: the same message with `{op:"feed.whoareyou"}` replies
with the contract itself, so the NTP can log what it is talking to.

The reply is a *projection*: the NTP never learns the item shape, the storage
schema, or anything about feeds. That is what keeps the two extensions
independent — ziy-news can change its internals without touching the NTP, and
the NTP can change its layout without touching ziy-news.

---

## Edit 1 of 3 — `extensions/ziy-ntp/lib/model.js`

**Where:** in the `WIDGETS` array (line 61-67), after the `stats` entry.

```js
    Object.freeze({ id: "stats", label: "Privacy stats" }),
    Object.freeze({ id: "news", label: "News" }),          // <-- ADD THIS LINE
  ]);
```

**Why:** the widget list drives both the NTP's own visibility switch and the
customize-dashboard toggle row, so registering `news` here gives the feature a
real on/off in the existing UI with no new settings surface.

**Default state:** `widgets.news` defaults to `false` in the config defaults
(the `widgets` default object around line 201). Add it there so a fresh
profile has the section off until the user turns it on:

```js
      widgets: {
        search: true, topsites: true, clock: true, stats: true, background: true,
        news: false,                     // <-- ADD THIS LINE
      },
```

**Also add** the news extension id to the model's constants, beside the
existing `SHIELDS_EXTENSION_ID`:

```js
  const NEWS_EXTENSION_ID = "ziy-news@ziy.app";
  …
  NEWS_EXTENSION_ID,
```

---

## Edit 2 of 3 — `extensions/ziy-ntp/ui/ntp.html`

**Where:** after the stats `</section>` (line 244) and before the top-sites
`<section>` (line 248). It is a sibling region, so the NTP's existing
landmark structure is preserved.

```html
    <!-- News widget. ziy-news renders nothing here; this section only reads
         its snapshot and paints NTP-owned markup. -->
    <section class="ntp-news" id="news" role="region" aria-label="News" hidden>
      <div class="ntp-widget-head">
        <h2 id="news-heading">News</h2>
        <p id="news-count" class="ntp-news__count"></p>
      </div>
      <ul id="news-list" class="ntp-news__list" role="list"></ul>
      <p id="news-status" class="vh" role="status"></p>
      <p id="news-empty" class="ntp-news__empty" hidden>
        No stories in your window. Add a source in Ziy News.
      </p>
    </section>
```

**Ids the script writes into:** `news` (the section), `news-count`,
`news-list`, `news-status`, `news-empty`. All five must exist before the
script runs; the script never creates them.

**Styles:** reuse the existing NTP widget rules (`--ntp-widget-frost` fill,
`radius lg`, `text`/`text-muted`) so the section matches the rest of the page
without a new stylesheet. A row is a `<li role="listitem">` holding one
`<a>` whose text is the title, and the source/time as visible muted text
under it.

---

## Edit 3 of 3 — `extensions/ziy-ntp/ui/ntp.js`

**Where 3a:** in `cacheElements()` (around line 88), add the five ids:

```js
    news: $("news"),
    newsList: $("news-list"),
    newsCount: $("news-count"),
    newsStatus: $("news-status"),
    newsEmpty: $("news-empty"),
```

**Where 3b:** in `renderWidgetVisibility()` (line 203-209), add the switch
next to the others:

```js
    setHidden(el.news, !widgets.news);
    if (widgets.news) loadNews();
```

**Where 3c:** add the loader, beside `loadStats()` (around line 413). This is
the whole integration:

```js
  /* News. The section belongs to the NTP; the stories belong to ziy-news.
     The message is the only coupling, and every failure path is a real state
     the user can see rather than a console error. */
  async function loadNews() {
    var api = globalThis.browser || globalThis.chrome;
    if (!api || !api.runtime || typeof api.runtime.sendMessage !== "function") {
      renderNews(null);
      return;
    }
    try {
      var reply = await api.runtime.sendMessage(model.NEWS_EXTENSION_ID, {
        op: "feed.snapshot",
        from: "ziy-ntp@ziy.app",
        request: { n: 10 },
      });
      renderNews(reply && reply.ok === true ? reply.snapshot : null);
    } catch (_err) {
      /* ziy-news not installed, or refused. The NTP must not stall on a
         sibling being absent — this is the same contract shapes use. */
      renderNews(null);
    }
  }

  function renderNews(snapshot) {
    if (!el.newsList) return;
    el.newsList.textContent = "";
    var usable = snapshot && snapshot.version === 1 && Array.isArray(snapshot.rows);
    if (!usable || !snapshot.rows.length) {
      el.newsEmpty.hidden = false;
      el.newsCount.textContent = "";
      return;
    }
    el.newsEmpty.hidden = true;
    el.newsCount.textContent = snapshot.unread + " new";
    for (var i = 0; i < snapshot.rows.length; i++) {
      var row = snapshot.rows[i];
      var link = ui_el("a", { class: "ntp-news__link", href: row.url || "#" });
      link.appendChild(ui_el("span", { class: "ntp-news__title", text: row.title || "" }));
      var meta = ui_el("span", { class: "ntp-news__meta",
                                  text: row.sourceTitle + " · " + row.publishedLabel });
      link.appendChild(meta);
      el.newsList.appendChild(ui_el("li", { class: "ntp-news__item" }, [link]));
    }
  }
```

(`ui_el` is whatever the NTP's own element helper is called — the file
already has one; if it does not, use `document.createElement`.)

**Why this shape.** The NTP sends one message and renders what comes back. It
does not poll, does not cache, and does not touch ziy-news's storage. The
`version === 1` guard means a future contract bump degrades to the empty
state instead of rendering a shape it does not understand.

---

## What this patch deliberately does NOT do

- **No message port / long-lived connection.** A one-shot `sendMessage` is
  enough, is idempotent, and leaves no socket to leak when the tab closes.
- **No `feed.snapshot` polling.** The NTP is a static page; it reads once on
  load. A user who wants fresh stories opens the panel or the options page.
- **No shared storage key.** The NTP never reads ziy-news's IndexedDB or
  `storage.local`. The message is the whole interface.
- **No ziy-ntp edit to the news feed's content decisions** — window, ordering
  and unread state all stay inside ziy-news, where they are already
  unit-tested.

## Verification this contract has

- `test/engine.test.js` pins the reply shape field-by-field, the version,
  the clamping of `n`, and the typed-error path for an unknown op.
- The real background page's `handleMessage` answers `feed.snapshot` from the
  real lib files in a node:vm sandbox (same suite).
- A live boot proof confirmed the add-on installs and is active with the
  marker in `prefs.js` (see `replica/proofs-news.md`).

## Applying it

```bash
# 1. model.js: the widget entry, its default, and the id constant
# 2. ntp.html: the <section> after line 244
# 3. ntp.js: cacheElements + renderWidgetVisibility + the two functions
```

Then `tools/build-extension.sh extensions/ziy-ntp` and re-boot. No changes are
needed on the ziy-news side for the patch to work — the extension already
answers the message today.
