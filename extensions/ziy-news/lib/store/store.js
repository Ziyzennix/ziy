/* Ziy news — storage.
 *
 * Two stores, split the way architecture §3.1 assigns them:
 *
 *   browser.storage.local   settings and the source list (small, always
 *                           needed, launch-critical). One key each, so a
 *                           settings write never rewrites the feeds.
 *   IndexedDB 'ziy-news'    items, read state and refresh results (big,
 *                           queryable, bounded). The event page prunes it.
 *
 * IndexedDB is not available in the node test process, so this file detects
 * the API and exposes the same interface either way; the tests inject a fake
 * IndexedDB-ish object, and the storage MODEL (the shapes and the pruning
 * rule) is tested separately from the transport.
 */
(function (root, factory) {
  "use strict";
  const api = factory(root.ZiyNewsSource, root.ZiyNewsSettings);
  if (typeof module === "object" && module.exports) {
    /* In node the UMD globals are not present from a require, so resolve the
     * CommonJS way when it exists. */
    const source = typeof require === "function" ? require("./source.js") : root.ZiyNewsSource;
    const settings = typeof require === "function" ? require("./settings.js") : root.ZiyNewsSettings;
    module.exports = factory(source, settings);
    return;
  }
  root.ZiyNewsStore = factory(root.ZiyNewsSource, root.ZiyNewsSettings);
})(typeof globalThis !== "undefined" ? globalThis : this, function (source, settings) {
  "use strict";

  const DB_NAME = "ziy-news";
  const DB_VERSION = 1;

  const SOURCES_KEY = "news.sources";
  const READ_KEY = "news.read";
  const REFRESH_KEY = "news.refresh";

  /* How much history is kept. A week of window plus headroom: items older
   * than this can never appear in any filter, so keeping them would only
   * grow the database. */
  const MAX_ITEM_AGE_MS = 8 * 24 * 60 * 60 * 1000;
  const MAX_ITEMS_PER_SOURCE = 300;

  /* --------------------------------------------------------------------- */
  /* Sources, in storage.local                                             */
  /* --------------------------------------------------------------------- */

  async function loadSources(api) {
    const local = api && api.storage && api.storage.local;
    if (!local) return source.defaults();
    const all = await local.get(SOURCES_KEY);
    const raw = all ? all[SOURCES_KEY] : undefined;
    if (!raw) return source.defaults();
    let list = raw;
    if (typeof raw === "string") {
      try {
        list = JSON.parse(raw);
      } catch (_e) {
        /* A corrupt source list is not a reason to strand the user on an
         * unreadable feed: the defaults are restored. */
        return source.defaults();
      }
    }
    if (!Array.isArray(list)) return source.defaults();
    const out = [];
    for (const entry of list) {
      const normalised = source.normalise(entry, null);
      if (normalised) out.push(normalised);
    }
    return out.length > 0 ? out : source.defaults();
  }

  async function saveSources(api, sources) {
    const local = api && api.storage && api.storage.local;
    if (!local) return { ok: false, reason: "no-storage" };
    await local.set(Object.keys({ [SOURCES_KEY]: 1 }).length ? { [SOURCES_KEY]: sources } : {});
    return { ok: true };
  }

  /* --------------------------------------------------------------------- */
  /* Read state, in storage.local                                          */
  /* --------------------------------------------------------------------- */

  async function loadReadState(api) {
    const local = api && api.storage && api.storage.local;
    if (!local) return {};
    const all = await local.get(READ_KEY);
    return normaliseReadState(all ? all[READ_KEY] : undefined);
  }

  /**
   * The read map is { [itemKey]: true }. A key is the item's dedupe key
   * ("sourceId\0guid"), so read state survives a feed refresh that reorders
   * items and survives an item's permanent removal only in the sense that the
   * entry becomes unreachable and is pruned.
   */
  function normaliseReadState(raw) {
    let value = raw;
    if (typeof raw === "string") {
      try {
        value = JSON.parse(raw);
      } catch (_e) {
        return {};
      }
    }
    const out = {};
    if (!value || typeof value !== "object") return out;
    for (const key of Object.keys(value)) {
      if (value[key] === true && key.indexOf("\u0000") > 0) out[key] = true;
    }
    return out;
  }

  async function saveReadState(api, readState) {
    const local = api && api.storage && api.storage.local;
    if (!local) return { ok: false, reason: "no-storage" };
    await local.set({ [READ_KEY]: readState });
    return { ok: true };
  }

  /* --------------------------------------------------------------------- */
  /* Settings, in storage.local                                            */
  /* --------------------------------------------------------------------- */

  async function loadSettings(api) {
    const local = api && api.storage && api.storage.local;
    if (!local) return settings.normalise(null);
    const all = await local.get(settings.KEY);
    return settings.normalise(all ? all[settings.KEY] : undefined);
  }

  async function saveSettings(api, value) {
    const local = api && api.storage && api.storage.local;
    if (!local) return { ok: false, reason: "no-storage" };
    await local.set({ [settings.KEY]: settings.normalise(value) });
    return { ok: true };
  }

  /* --------------------------------------------------------------------- */
  /* Refresh status, in storage.local
   *
   * Small enough to live here: it is a few numbers, and writing it on every
   * refresh keeps the panel and the NTP in step without either of them
   * opening a database.
   * --------------------------------------------------------------------- */

  const EMPTY_REFRESH = Object.freeze({
    lastRunAt: 0,
    lastRunMs: 0,
    lastResult: "never",
    sources: 0,
    ok: 0,
    unchanged: 0,
    failed: 0,
    itemsAdded: 0,
  });

  function normaliseRefresh(raw) {
    const base = Object.assign({}, EMPTY_REFRESH);
    if (!raw || typeof raw !== "object") return base;
    if (typeof raw.lastRunAt === "number" && isFinite(raw.lastRunAt)) base.lastRunAt = raw.lastRunAt;
    if (typeof raw.lastRunMs === "number" && isFinite(raw.lastRunMs)) base.lastRunMs = raw.lastRunMs;
    if (typeof raw.lastResult === "string") base.lastResult = raw.lastResult;
    base.sources = intOr(raw.sources, 0);
    base.ok = intOr(raw.ok, 0);
    base.unchanged = intOr(raw.unchanged, 0);
    base.failed = intOr(raw.failed, 0);
    base.itemsAdded = intOr(raw.itemsAdded, 0);
    return base;
  }

  function intOr(value, fallback) {
    const n = parseInt(value, 10);
    return isFinite(n) && n >= 0 ? n : fallback;
  }

  /* --------------------------------------------------------------------- */
  /* IndexedDB                                                             */
  /* --------------------------------------------------------------------- */

  /**
   * The database schema, versioned. The object stores are:
   *   items      keyed by the dedupe key; indexed by sourceId and by
   *              published (for the age window and the "newest first" order)
   *   refreshLog one record per refresh run, capped, so the panel can show
   *              a short history without storing the items again
   */
  const SCHEMA = Object.freeze({
    name: DB_NAME,
    version: DB_VERSION,
    stores: Object.freeze([
      Object.freeze({ name: "items", keyPath: "key", indexes: Object.freeze([
        Object.freeze({ name: "sourceId", keyPath: "sourceId" }),
        Object.freeze({ name: "published", keyPath: "published" }),
      ]) }),
      Object.freeze({ name: "meta", keyPath: "key" }),
      Object.freeze({ name: "refreshLog", keyPath: "id", autoIncrement: true }),
    ]),
  });

  /* Opened once per context. `openDB` is only called where an IndexedDB
   * actually exists; the fake in the tests supplies the same three methods. */
  let dbPromise = null;

  function openDB(indexedDB) {
    if (dbPromise) return dbPromise;
    const idb = indexedDB || (typeof indexedDBImpl === "function" ? indexedDBImpl() : null);
    if (!idb) return Promise.reject(new Error("ziy-news: IndexedDB is unavailable"));
    dbPromise = new Promise(function (resolve, reject) {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (event) {
        const db = request.result;
        for (const store of SCHEMA.stores) {
          if (!db.objectStoreNames.contains(store.name)) {
            const os = db.createObjectStore(store.name, {
              keyPath: store.keyPath,
              autoIncrement: !!store.autoIncrement,
            });
            for (const index of store.indexes || []) os.createIndex(index.name, index.keyPath);
          }
        }
        /* event is intentionally unused: the upgrade is idempotent. */
        void event;
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return dbPromise;
  }

  function indexedDBImpl() {
    if (typeof globalThis !== "undefined" && globalThis.indexedDB) return globalThis.indexedDB;
    if (typeof indexedDB !== "undefined") return indexedDB;
    return null;
  }

  function resetDbPromise() {
    dbPromise = null;
  }

  /* --------------------------------------------------------------------- */
  /* Pruning                                                               */
  /* --------------------------------------------------------------------- */

  /**
   * Decides which items a store should drop: everything older than the
   * horizon, and everything past a per-source row cap. Keeps the newest
   * `cap` per source. Deterministic and pure, so it is tested directly.
   */
  function pruneItems(items, now, cap) {
    const horizon = Number(now) - MAX_ITEM_AGE_MS;
    const limit = cap || MAX_ITEMS_PER_SOURCE;
    const bySource = new Map();
    for (const item of items) {
      const published = item.published || 0;
      if (item.published != null && published < horizon) continue;
      /* A row with neither a key nor a way to name itself cannot be read,
       * marked or referred to again, so it is not worth storing. */
      if (item.key == null && !item.guid && !item.link) continue;
      const list = bySource.get(item.sourceId) || [];
      list.push(item);
      bySource.set(item.sourceId, list);
    }
    const kept = [];
    const keepKeys = new Set();
    for (const list of bySource.values()) {
      list.sort(function (a, b) { return (b.published || 0) - (a.published || 0); });
      for (const entry of list.slice(0, limit)) {
        kept.push(entry);
        keepKeys.add(entry.key != null ? entry.key : entry.guid);
      }
    }
    const droppedKeys = [];
    for (const entry of items) {
      if (keepKeys.has(entry.key != null ? entry.key : entry.guid)) continue;
      droppedKeys.push(entry.key != null ? entry.key : null);
    }
    return { kept: kept, dropped: items.length - kept.length, droppedKeys: droppedKeys };
  }

  return {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    SCHEMA: SCHEMA,
    SOURCES_KEY: SOURCES_KEY,
    READ_KEY: READ_KEY,
    REFRESH_KEY: REFRESH_KEY,
    MAX_ITEM_AGE_MS: MAX_ITEM_AGE_MS,
    MAX_ITEMS_PER_SOURCE: MAX_ITEMS_PER_SOURCE,
    EMPTY_REFRESH: EMPTY_REFRESH,
    loadSources: loadSources,
    saveSources: saveSources,
    loadReadState: loadReadState,
    saveReadState: saveReadState,
    normaliseReadState: normaliseReadState,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    normaliseRefresh: normaliseRefresh,
    pruneItems: pruneItems,
    openDB: openDB,
    resetDbPromise: resetDbPromise,
  };
});
