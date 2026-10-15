/* Ziy Playlist — the two stores, and nothing else.
 *
 * The split follows architecture §3.1 exactly, for the reason that section
 * gives:
 *
 *   IndexedDB 'ziy-playlist'   the items. Big, queryable, bounded, and the
 *                              only place a queue row lives. Items survive a
 *                              browser restart because IndexedDB does.
 *   storage.local              settings and per-site dismissals. Small,
 *                              always-needed, launch-critical.
 *
 * IndexedDB is not present in the node test process, so this file detects the
 * API and exposes the same interface either way; the tests inject a fake
 * IndexedDB-ish object, and the storage MODEL (the shapes, the drain rule) is
 * tested separately from the transport.
 *
 * The drain rule, stated because a queue that grows without a cap is a slow
 * bug: at most MAX_ITEMS rows, newest-added last, and a 'page' item older
 * than PAGE_ITEM_AGE is dropped on save — a page row is a pointer, and a
 * pointer to a player that has changed is worse than no pointer.
 */
(function (root, factory) {
  "use strict";
  const api = factory(root.ZiyPlaylistModel);
  if (typeof module === "object" && module.exports) {
    const model = typeof require === "function" ? require("./model.js") : root.ZiyPlaylistModel;
    module.exports = factory(model);
    return;
  }
  root.ZiyPlaylistStore = factory(root.ZiyPlaylistModel);
})(typeof globalThis !== "undefined" ? globalThis : this, function (model) {
  "use strict";

  const DB_NAME = "ziy-playlist";
  const DB_VERSION = 1;

  const KEY_ITEMS = "playlist.items";

  /* A 'page' item is a pointer to something the user asked to remember.
     Stale pointers from months ago are noise, so they age out. Media items
     never age out on their own. */
  const PAGE_ITEM_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  const SCHEMA = Object.freeze({
    name: DB_NAME,
    version: DB_VERSION,
    stores: Object.freeze([
      Object.freeze({
        name: "items",
        keyPath: "id",
        indexes: Object.freeze([
          Object.freeze({ name: "order", keyPath: "order" }),
          Object.freeze({ name: "lastPlayedAt", keyPath: "lastPlayedAt" }),
        ]),
      }),
      Object.freeze({ name: "meta", keyPath: "key" }),
    ]),
  });

  /* --------------------------------------------------------------------- */
  /* storage.local: settings and dismissals                              */
  /* --------------------------------------------------------------------- */

  async function loadSettings(api) {
    const local = api && api.storage && api.storage.local;
    if (!local) return null;
    const all = await local.get("playlist.settings");
    return all ? all["playlist.settings"] : null;
  }

  async function saveSettings(api, settings) {
    const local = api && api.storage && api.storage.local;
    if (!local) return { ok: false, reason: "no-storage" };
    await local.set({ "playlist.settings": settings });
    return { ok: true };
  }

  async function loadSites(api) {
    const local = api && api.storage && api.storage.local;
    if (!local) return null;
    const all = await local.get("playlist.sites");
    return all ? all["playlist.sites"] : null;
  }

  async function saveSites(api, sites) {
    const local = api && api.storage && api.storage.local;
    if (!local) return { ok: false, reason: "no-storage" };
    await local.set({ "playlist.sites": sites });
    return { ok: true };
  }

  /* --------------------------------------------------------------------- */
  /* IndexedDB                                                            */
  /* --------------------------------------------------------------------- */

  let dbPromise = null;

  function openDB(indexedDB) {
    if (dbPromise) return dbPromise;
    const idb = indexedDB || (typeof indexedDBImpl === "function" ? indexedDBImpl() : null);
    if (!idb) return Promise.reject(new Error("ziy-playlist: IndexedDB is unavailable"));
    dbPromise = new Promise(function (resolve, reject) {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        const db = request.result;
        for (const store of SCHEMA.stores) {
          if (!db.objectStoreNames.contains(store.name)) {
            const os = db.createObjectStore(store.name, {
              keyPath: store.keyPath,
            });
            for (const index of store.indexes || []) {
              os.createIndex(index.name, index.keyPath);
            }
          }
        }
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

  /**
   * Reads the whole queue. The event page is the only writer, so a plain
   * getAll plus a sort by `order` is both correct and small: a queue is
   * hundreds of rows at most, so there is no index to lean on.
   */
  async function loadItems(indexedDB) {
    const db = await openDB(indexedDB);
    return new Promise(function (resolve, reject) {
      const tx = db.transaction("items", "readonly");
      const request = tx.objectStore("items").getAll();
      request.onsuccess = function () {
        const rows = Array.isArray(request.result) ? request.result : [];
        rows.sort((a, b) => (a.order || 0) - (b.order || 0));
        resolve(model.normaliseQueue(rows));
      };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function saveItems(indexedDB, items) {
    const db = await openDB(indexedDB);
    /* Drain before writing: the cap and the page-item age are both about
       what is stored, not what is on screen. */
    const drained = drain(items, Date.now());
    return new Promise(function (resolve, reject) {
      const tx = db.transaction("items", "readwrite");
      const os = tx.objectStore("items");
      os.clear();
      for (const item of drained) os.put(item);
      tx.oncomplete = function () { resolve(drained); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function clearItems(indexedDB) {
    const db = await openDB(indexedDB);
    return new Promise(function (resolve, reject) {
      const tx = db.transaction("items", "readwrite");
      tx.objectStore("items").clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  /* --------------------------------------------------------------------- */
  /* The drain rule                                                       */
  /* --------------------------------------------------------------------- */

  /**
   * The stored form of a queue: normalised, capped, with 'page' items past
   * their age dropped. Pure, so the rule is a unit test rather than a
   * behaviour you discover.
   */
  function drain(items, now) {
    const at = Number.isFinite(now) ? now : Date.now();
    const horizon = at - PAGE_ITEM_AGE_MS;
    const kept = model.normaliseQueue(items).filter((item) => {
      if (item.kind !== model.KINDS.page) return true;
      // A page item survives if it was added recently OR played recently:
      // "recently" is about the user's attention, not only the add button.
      const touched = Math.max(item.addedAt || 0, item.lastPlayedAt || 0);
      return touched >= horizon;
    });
    return model.reindex(kept.slice(-model.MAX_ITEMS));
  }

  return {
    DB_NAME: model.MAX_ITEMS ? DB_NAME : DB_NAME,
    DB_VERSION,
    SCHEMA,
    KEY_ITEMS,
    PAGE_ITEM_AGE_MS,
    loadSettings,
    saveSettings,
    loadSites,
    saveSites,
    loadItems,
    saveItems,
    clearItems,
    drain,
    openDB,
    resetDbPromise,
  };
});
