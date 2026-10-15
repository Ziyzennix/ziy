/* Ziy news — the background event page.
 *
 * MV3 on Gecko has no service worker (Firefox bug 1573659), so this is a
 * `background.scripts` event page: suspended between calls, so every listener
 * is registered synchronously at the top level and every state transition is
 * idempotent.
 *
 * Its four jobs:
 *
 *   1. REFRESH: on an alarm, fetch the sources that are due, parse them,
 *      store the new items, prune the old ones, and record the per-source
 *      error state. Politeness lives in lib/feed/fetcher.js (conditional GET,
 *      cache headers, backoff, concurrency cap) so it is testable with a fake
 *      clock.
 *
 *   2. SERVE the NTP contract: a `feed.snapshot` message returns the top N
 *      items for the new tab page's news section. This is the documented,
 *      versioned interface described in replica/patches/
 *      ziy-ntp-news-integration.md — the NTP calls it, we answer it, and
 *      neither extension owns the other.
 *
 *   3. ANSWER the panel and options page: snapshot for reading, mark-read,
 *      refresh-now, source add/remove/enable, settings changes, OPML
 *      import/export.
 *
 *   4. OPEN links: the panel's "open" hands us a URL and the setting decides
 *      new tab or current tab, which is the reference's "open links where".
 *
 * Every write goes through lib/store, and the parsed feed never leaves the
 * profile: there is no telemetry path in this file on purpose.
 */
(function () {
  "use strict";

  /* The lib files are loaded before this one by the manifest's script order,
   * so they are on the global already. */
  const xml = globalThis.ZiyFeedXml;
  const newsItem = globalThis.ZiyNewsItem;
  const parse = globalThis.ZiyNewsParse;
  const fetcher = globalThis.ZiyNewsFetcher;
  const aggregate = globalThis.ZiyNewsFeed;
  const sourceModel = globalThis.ZiyNewsSource;
  const settingsModel = globalThis.ZiyNewsSettings;
  const opml = globalThis.ZiyNewsOpml;
  const store = globalThis.ZiyNewsStore;

  const EXTENSION_ID = "ziy-news@ziy.app";
  const ALARM_NAME = "ziy-news-refresh";
  /* How long the alarm is armed for. The prompt's default is 30 minutes; a
   * source's own cache headers or a backoff can push an individual fetch
   * later than this, but never earlier, because the plan is re-evaluated on
   * every run. */
  const ALARM_PERIOD_MINUTES = 30;

  /* Runtime state for one refresh. Deliberately tiny and rebuilt each run. */
  let refreshing = false;
  let lastRun = store.EMPTY_REFRESH;

  /* --------------------------------------------------------------------- */
  /* API access                                                            */
  /* --------------------------------------------------------------------- */

  function api() {
    return globalThis.browser || globalThis.chrome;
  }

  function log() {
    const a = api();
    if (a && a.runtime && typeof a.runtime.sendMessage === "function") {
      /* The debug console of the event page; kept out of the normal path. */
      try {
        a.runtime.sendMessage(EXTENSION_ID, {
          op: "news.debug",
          level: "log",
        }).catch(function () { return undefined; });
      } catch (_e) { /* no listener: fine. */ }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Items.                                                                */
  /* --------------------------------------------------------------------- */

  /**
   * Loads every stored item. The event page is the only writer, so a plain
   * getAll over the index is both correct and small enough (a week of feeds
   * is a few thousand rows).
   */
  async function loadAllItems() {
    const db = await store.openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction("items", "readonly");
      const request = tx.objectStore("items").getAll();
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function putItems(items) {
    if (!items || items.length === 0) return 0;
    const db = await store.openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction("items", "readwrite");
      const os = tx.objectStore("items");
      for (const item of items) {
        if (!item.key) continue;
        /* An item already stored keeps its position; a new one is added. The
         * `put` is keyed by the dedupe key, so this is an upsert. */
        os.put(item);
      }
      tx.oncomplete = function () { resolve(items.length); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function clearItems() {
    const db = await store.openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction("items", "readwrite");
      tx.objectStore("items").clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  /* --------------------------------------------------------------------- */
  /* The refresh                                                           */
  /* --------------------------------------------------------------------- */

  /** One source: fetch, parse, store, record state. Returns a result row. */
  async function refreshSource(source, settings, now) {
    const startedAt = typeof performance !== "undefined" && performance.now
      ? performance.now() : Date.now();
    try {
      const response = await fetcher.fetchOne(source, crossOriginFetch);
      const patch = fetcher.cachePatchFromHeaders(response.headers, now, source);
      if (response.notModified) {
        /* A 304 says the body is unchanged: the stored items stand, and only
         * the timestamps move. This is the whole point of conditional GET. */
        return {
          sourceId: source.id,
          status: "unchanged",
          ms: elapsed(startedAt),
          patch: Object.assign(patch, {
            lastFetchedAt: now,
            consecutiveFailures: 0,
            lastError: null,
          }),
        };
      }
      const feed = parse.parseFeed(response.body, source.id);
      const merged = dedupeIntoItems(source, feed.items, now);
      await putItems(merged);
      return {
        sourceId: source.id,
        status: "ok",
        added: merged.length,
        parsed: feed.items.length,
        ms: elapsed(startedAt),
        patch: Object.assign(patch, {
          lastFetchedAt: now,
          consecutiveFailures: 0,
          lastError: null,
          /* A feed that renames itself is not a new source; the title updates
           * so the panel shows what the publisher calls itself. */
          title: feed.title ? feed.title : source.title,
        }),
      };
    } catch (err) {
      const failures = (source.consecutiveFailures || 0) + 1;
      const kind = err && err.kind ? err.kind : "unknown";
      return {
        sourceId: source.id,
        status: "failed",
        error: { kind: kind, message: err && err.message ? String(err.message) : "unknown", at: now },
        ms: elapsed(startedAt),
        patch: {
          lastFetchedAt: now,
          consecutiveFailures: failures,
          lastError: { kind: kind, message: err && err.message ? String(err.message) : "unknown", at: now },
        },
      };
    }
  }

  function elapsed(startedAt) {
    const end = typeof performance !== "undefined" && performance.now
      ? performance.now() : Date.now();
    return Math.round(end - startedAt);
  }

  /**
   * Turns parsed feed items into rows for the store.
   *
   * The dedupe key is (sourceId, guid) when the feed gave a guid, else
   * (sourceId, link) — which is exactly `newsItem.dedupeKey`, so the panel's
   * read state and the store's row id agree. A row with no key at all cannot
   * be referred to again, so it is dropped rather than stored.
   */
  function dedupeIntoItems(source, parsed, now) {
    const keyOf = function (entry) { return newsItem.dedupeKey(entry); };
    const result = newsItem.dedupe(parsed || [], keyOf);
    return result.kept.map(function (entry) {
      return {
        key: keyOf(entry),
        sourceId: entry.sourceId,
        guid: entry.guid,
        title: entry.title,
        link: entry.link,
        snippet: entry.snippet,
        html: entry.html,
        author: entry.author,
        published: entry.published,
        updated: entry.updated,
        categories: entry.categories,
        images: entry.images,
        attachments: entry.attachments,
        fetchedAt: Number(now) || 0,
      };
    }).filter(function (row) { return row.key; });
  }

  /** The whole refresh pass: pick the due sources, run them, store the state. */
  async function runRefresh(reason) {
    if (refreshing) return { skipped: true };
    refreshing = true;
    const startedAt = Date.now();
    try {
      const api0 = api();
      const [sources, settings] = await Promise.all([
        store.loadSources(api0),
        store.loadSettings(api0),
      ]);
      const due = fetcher.planFetch(sources, settings, startedAt);
      const results = [];
      for (const source of due) {
        /* eslint-disable-next-line no-await-in-loop */
        results.push(await refreshSource(source, settings, startedAt));
      }

      const patches = new Map();
      for (const result of results) if (result.patch) patches.set(result.sourceId, result.patch);

      const updated = sources.map(function (source) {
        const patch = patches.get(source.id);
        if (!patch) return source;
        return Object.assign({}, source, patch);
      });
      await store.saveSources(api0, updated);

      /* Pruning: a week of window plus headroom, so the store stays bounded
       * and the next refresh is as fast as the first. */
      let pruned = 0;
      const all = await loadAllItems();
      const outcome = store.pruneItems(all, startedAt);
      if (outcome.dropped > 0 && outcome.droppedKeys.length > 0) {
        const db = await store.openDB();
        pruned = await new Promise(function (resolve) {
          const tx = db.transaction("items", "readwrite");
          const os = tx.objectStore("items");
          const dropKeys = new Set(outcome.droppedKeys.filter(function (key) { return key; }));
          let removed = 0;
          const cursorRequest = os.openCursor();
          cursorRequest.onsuccess = function (event) {
            const cursor = event.target.result;
            if (!cursor) { resolve(removed); return; }
            if (dropKeys.has(cursor.key)) {
              cursor.delete();
              removed++;
            }
            cursor.continue();
          };
          cursorRequest.onerror = function () { resolve(removed); };
        });
      }

      const ok = results.filter(r => r.status === "ok").length;
      const unchanged = results.filter(r => r.status === "unchanged").length;
      const failed = results.filter(r => r.status === "failed").length;
      const itemsAdded = results.reduce(function (sum, r) {
        return sum + (r.added || 0);
      }, 0);

      lastRun = store.normaliseRefresh({
        lastRunAt: startedAt,
        lastRunMs: Date.now() - startedAt,
        lastResult: failed === 0 ? (due.length === 0 ? "idle" : "ok") : "partial",
        sources: due.length,
        ok: ok,
        unchanged: unchanged,
        failed: failed,
        itemsAdded: itemsAdded,
      });
      const a = api();
      if (a && a.storage && a.storage.local) {
        await a.storage.local.set({ [store.REFRESH_KEY]: lastRun });
      }

      log();
      return {
        reason: reason,
        due: due.length,
        ok: ok,
        unchanged: unchanged,
        failed: failed,
        itemsAdded: itemsAdded,
        pruned: pruned,
        ms: lastRun.lastRunMs,
        results: results,
      };
    } finally {
      refreshing = false;
    }
  }

  /* --------------------------------------------------------------------- */
  /* Cross-origin fetch                                                    */
  /* --------------------------------------------------------------------- */

  /**
   * The one place the extension touches the network.
   *
   * This is the background page's fetch, which the manifest's
   * host_permissions <all_urls> makes cross-origin (MDN, Background scripts:
   * "Background scripts can make XHR requests to hosts they have host
   * permissions for"). An extension PAGE cannot do this, because page fetches
   * are subject to CORS — which is why the fetch lives here and not in the
   * panel.
   *
   * credentials: "omit" is deliberate: the grant is for reading public feeds,
   * and sending the user's cookies would widen it into a way to read an
   * authenticated page on their behalf.
   */
  async function crossOriginFetch(url, init) {
    const a = api();
    const fetchFn = a && (a.fetch || globalThis.fetch);
    if (!fetchFn) throw new Error("ziy-news: no fetch in this context");
    const options = Object.assign({}, init, { credentials: "omit" });
    return fetchFn(url, options);
  }

  /* --------------------------------------------------------------------- */
  /* Message handling                                                      */
  /* --------------------------------------------------------------------- */

  /**
   * The ops this extension answers. Every op is idempotent and every reply is
   * a plain object, so a caller never has to know about the internals.
   *
   * Cross-extension messages arrive with the caller's id as the FIRST
   * argument to onMessage, so `sender` is checked only where the caller's
   * identity matters.
   */
  async function handleMessage(message, sender, sendResponse) {
    const op = message && typeof message.op === "string" ? message.op : "";
    const a = api();

    /* ---- the NTP contract -------------------------------------------- */
    if (op === "feed.snapshot") {
      try {
        const [items, readMap, sources, settings] = await Promise.all([
          loadAllItems(),
          store.loadReadState(a),
          store.loadSources(a),
          store.loadSettings(a),
        ]);
        const snap = aggregate.snapshot(items, readMap, sources, settings, Date.now(), message.request || {});
        return sendResponse({ ok: true, snapshot: snap });
      } catch (err) {
        return sendResponse({
          ok: false,
          error: { kind: "snapshot-failed", message: err && err.message ? String(err.message) : "unknown" },
        });
      }
    }

    /* ---- reading ------------------------------------------------------ */
    if (op === "feed.list") {
      try {
        const [items, readMap, sources, settings] = await Promise.all([
          loadAllItems(),
          store.loadReadState(a),
          store.loadSources(a),
          store.loadSettings(a),
        ]);
        const feed = aggregate.buildFeed(items, readMap, sources, settings, Date.now(),
          message.filter || {});
        return sendResponse({ ok: true, feed: feed, refresh: lastRun });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "list-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.markRead") {
      try {
        const keys = Array.isArray(message.keys) ? message.keys : [];
        const readValue = message.read !== false;
        const readMap = await store.loadReadState(a);
        for (const key of keys) {
          if (typeof key !== "string") continue;
          if (readValue) readMap[key] = true;
          else delete readMap[key];
        }
        await store.saveReadState(a, readMap);
        return sendResponse({ ok: true, read: readMap });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "mark-read-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.markAllRead") {
      try {
        const [items, readMap, sources, settings] = await Promise.all([
          loadAllItems(),
          store.loadReadState(a),
          store.loadSources(a),
          store.loadSettings(a),
        ]);
        const feed = aggregate.buildFeed(items, readMap, sources, settings, Date.now(),
          message.filter || {});
        for (const row of feed.rows) {
          if (row.key) readMap[row.key] = true;
        }
        await store.saveReadState(a, readMap);
        return sendResponse({ ok: true, marked: feed.rows.length });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "mark-all-failed", message: String(err && err.message) } });
      }
    }

    /* ---- opening ------------------------------------------------------ */
    if (op === "feed.open") {
      const url = String(message.url || "");
      if (!url) return sendResponse({ ok: false, error: { kind: "no-url" } });
      try {
        const settings = await store.loadSettings(a);
        await openUrl(url, settings.openLinksInNewTab ? "tab" : "current");
        return sendResponse({ ok: true, where: settings.openLinksInNewTab ? "tab" : "current" });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "open-failed", message: String(err && err.message) } });
      }
    }

    /* ---- source management -------------------------------------------- */
    if (op === "feed.sources.get") {
      try {
        const sources = await store.loadSources(a);
        return sendResponse({ ok: true, sources: sources });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "sources-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.sources.add") {
      try {
        const raw = message.source || {};
        if (!sourceModel.isHttpUrl(raw.url)) {
          return sendResponse({ ok: false, error: { kind: "bad-url", message: "That is not an http or https URL." } });
        }
        const sources = await store.loadSources(a);
        const existing = sources.find(function (s) { return sameUrl(s.url, raw.url); });
        if (existing) {
          /* Adding a URL we already follow updates it rather than forking a
           * duplicate, so a user who re-adds a feed by hand does not end up
           * reading it twice. */
          const updated = Object.assign({}, existing, {
            title: raw.title || existing.title,
            category: raw.category || existing.category,
            enabled: true,
          });
          const next = sources.map(function (s) { return s === existing ? updated : s; });
          await store.saveSources(a, next);
          return sendResponse({ ok: true, source: updated, replaced: true, sources: next });
        }
        const created = sourceModel.normalise({
          title: raw.title || raw.url,
          url: raw.url,
          siteUrl: raw.siteUrl || "",
          category: raw.category || "Uncategorised",
          enabled: true,
        }, null);
        const next = sources.concat([created]);
        await store.saveSources(a, next);
        /* A newly added source is fetched now, so the user sees news instead
         * of a spinner until the next alarm. */
        scheduleImmediateRefresh();
        return sendResponse({ ok: true, source: created, sources: next });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "add-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.sources.setCategory") {
      try {
        const id = String(message.id || "");
        const category = String(message.category || "").trim() || "Uncategorised";
        const sources = await store.loadSources(a);
        const next = sources.map(function (s) {
          return s.id === id ? Object.assign({}, s, { category: category }) : s;
        });
        await store.saveSources(a, next);
        return sendResponse({ ok: true, sources: next });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "category-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.sources.remove") {
      try {
        const id = String(message.id || "");
        const sources = await store.loadSources(a);
        const next = sources.filter(function (s) { return s.id !== id; });
        await store.saveSources(a, next);
        return sendResponse({ ok: true, sources: next });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "remove-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.sources.setEnabled") {
      try {
        const id = String(message.id || "");
        const enabled = message.enabled !== false;
        const sources = await store.loadSources(a);
        const next = sources.map(function (s) {
          return s.id === id ? Object.assign({}, s, { enabled: enabled }) : s;
        });
        await store.saveSources(a, next);
        return sendResponse({ ok: true, sources: next });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "enabled-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.sources.reset") {
      try {
        await store.saveSources(a, sourceModel.defaults());
        scheduleImmediateRefresh();
        return sendResponse({ ok: true, sources: sourceModel.defaults() });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "reset-failed", message: String(err && err.message) } });
      }
    }

    /* ---- OPML ---------------------------------------------------------- */
    if (op === "feed.opml.export") {
      try {
        const sources = await store.loadSources(a);
        const result = opml.exportSources(sources);
        return sendResponse({
          ok: true,
          opml: result.text,
          counts: result.counts,
          filename: "ziy-news.opml",
        });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "export-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.opml.import") {
      try {
        if (typeof message.opml !== "string" || !message.opml.trim()) {
          return sendResponse({ ok: false, error: { kind: "empty-opml" } });
        }
        const result = opml.importOpml(message.opml);
        const existing = await store.loadSources(a);
        const byUrl = new Map(existing.map(function (s) { return [normaliseUrlKey(s.url), s]; }));
        const merged = existing.slice();
        let added = 0;
        let updated = 0;
        for (const incoming of result.sources) {
          const key = normaliseUrlKey(incoming.url);
          const found = byUrl.get(key);
          if (found) {
            Object.assign(found, incoming, { id: found.id, createdAt: found.createdAt });
            updated++;
          } else {
            merged.push(incoming);
            byUrl.set(key, incoming);
            added++;
          }
        }
        await store.saveSources(a, merged);
        scheduleImmediateRefresh();
        return sendResponse({
          ok: true,
          added: added,
          updated: updated,
          merged: added,
          replaced: updated,
          skipped: result.skipped,
          counts: result.counts,
          sources: merged,
        });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "import-failed", message: String(err && err.message) } });
      }
    }

    /* ---- settings ------------------------------------------------------ */
    if (op === "feed.settings.get") {
      try {
        const settings = await store.loadSettings(a);
        return sendResponse({ ok: true, settings: settings });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "settings-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.settings.set") {
      try {
        const current = await store.loadSettings(a);
        const next = settingsModel.patch(current, message.patch || {});
        await store.saveSettings(a, next);
        /* A refresh-interval change re-arms the alarm immediately. */
        await ensureAlarm(next.refreshMinutes);
        return sendResponse({ ok: true, settings: next });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "settings-failed", message: String(err && err.message) } });
      }
    }

    /* ---- refresh ------------------------------------------------------- */
    if (op === "feed.refresh.now") {
      try {
        const result = await runRefresh("message");
        return sendResponse({ ok: true, refresh: result });
      } catch (err) {
        return sendResponse({ ok: false, error: { kind: "refresh-failed", message: String(err && err.message) } });
      }
    }

    if (op === "feed.refresh.status") {
      return sendResponse({ ok: true, refresh: lastRun });
    }

    /* ---- identity ------------------------------------------------------ */
    if (op === "feed.whoareyou") {
      return sendResponse({
        ok: true,
        id: EXTENSION_ID,
        snapshotVersion: aggregate.SNAPSHOT_VERSION,
        contract: {
          op: "feed.snapshot",
          request: { n: "number of rows wanted" },
          reply: {
            ok: "boolean",
            snapshot: {
              version: aggregate.SNAPSHOT_VERSION,
              rows: "array of {id,title,snippet,url,sourceTitle,sourceCategory,image,published,publishedLabel,read,audio}",
              total: "number of rows in the window",
              unread: "number of unread rows",
              windowHours: "the age filter in hours",
            },
          },
        },
      });
    }

    /* An unknown op is answered, not ignored: the caller gets a typed error
     * instead of a timeout it has to guess about. */
    return sendResponse({ ok: false, error: { kind: "unknown-op", op: op } });
  }

  /* --------------------------------------------------------------------- */
  /* Opening                                                               */
  /* --------------------------------------------------------------------- */

  /**
   * Opens a URL in the destination the user chose.
   *
   * The reference's setting is "open links where: new tab / current tab".
   * `browser.tabs.create` is the new-tab path; `browser.tabs.update` on the
   * sender's tab is the current-tab path, which is how the panel replaces the
   * page it was opened from.
   */
  async function openUrl(url, where) {
    const a = api();
    if (!a || !a.tabs) throw new Error("ziy-news: no tabs API");
    if (where === "tab" || typeof a.tabs.create !== "function") {
      const created = await a.tabs.create({ url: url, active: true });
      return created;
    }
    /* The current tab: the panel is a sidebar, so the sender's tab is the
     * page the user is looking at, and replacing it is what "current tab"
     * means. */
    const senderTabId = currentSenderTabId();
    if (senderTabId != null) {
      await a.tabs.update(senderTabId, { url: url });
      return { updated: senderTabId };
    }
    return a.tabs.create({ url: url, active: true });
  }

  let senderTabIdCache = null;
  function currentSenderTabId() {
    return senderTabIdCache;
  }

  function sameUrl(a, b) {
    return normaliseUrlKey(a) === normaliseUrlKey(b);
  }

  function normaliseUrlKey(url) {
    return String(url || "").replace(/^https?:\/\//i, "")
      .replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
  }

  /* --------------------------------------------------------------------- */
  /* Alarms                                                               */
  /* --------------------------------------------------------------------- */

  async function ensureAlarm(minutes) {
    const a = api();
    if (!a || !a.alarms) return;
    const period = Math.max(5, Math.min(180, parseInt(minutes, 10) || ALARM_PERIOD_MINUTES));
    try {
      await a.alarms.create(ALARM_NAME, { periodInMinutes: period });
    } catch (_e) {
      /* An alarm that cannot be created leaves the manual refresh path. */
    }
  }

  var refreshTimer = null;
  function scheduleImmediateRefresh() {
    if (refreshTimer) return;
    /* A debounce: one refresh per burst of source changes, not one per add. */
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      runRefresh("sources-changed").catch(function () { return undefined; });
    }, 1500);
  }

  /* --------------------------------------------------------------------- */
  /* Wiring                                                               */
  /* --------------------------------------------------------------------- */

  function onMessage(message, sender, sendResponse) {
    senderTabIdCache = sender && sender.tab && typeof sender.tab.id === "number"
      ? sender.tab.id : (sender && typeof sender.id === "string" ? null : null);
    /* Everything is async, so the channel stays open by returning true. */
    handleMessage(message, sender, sendResponse).catch(function (err) {
      try {
        sendResponse({ ok: false, error: { kind: "handler-crashed", message: String(err && err.message) } });
      } catch (_e) { /* the channel is already gone. */ }
    });
    return true;
  }

  async function onInstalled() {
    await ensureAlarm(ALARM_PERIOD_MINUTES);
    /* A first refresh on install, so a new profile has news before the first
     * alarm would have fired. */
    scheduleImmediateRefresh();
  }

  async function onStartup() {
    await ensureAlarm(ALARM_PERIOD_MINUTES);
  }

  async function onAlarm(alarm) {
    if (alarm && alarm.name === ALARM_NAME) {
      await runRefresh("alarm");
    }
  }

  function wire() {
    const a = api();
    if (!a || !a.runtime) return;
    a.runtime.onMessage.addListener(onMessage);
    if (a.runtime.onInstalled) a.runtime.onInstalled.addListener(onInstalled);
    if (a.runtime.onStartup) a.runtime.onStartup.addListener(onStartup);
    if (a.alarms && a.alarms.onAlarm) {
      a.alarms.onAlarm.addListener(function (alarm) {
        onAlarm(alarm).catch(function () { return undefined; });
      });
    }
    ensureAlarm(ALARM_PERIOD_MINUTES);
  }

  /* Exported for the integration test, which drives the message contract
   * with a shim rather than a browser. */
  globalThis.ZiyNewsBackground = {
    EXTENSION_ID: EXTENSION_ID,
    ALARM_NAME: ALARM_NAME,
    handleMessage: handleMessage,
    runRefresh: runRefresh,
    wire: wire,
  };

  wire();
})();
