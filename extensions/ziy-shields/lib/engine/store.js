/* Ziy shields — the engine's own stores.
 *
 * Two engines, exactly as architecture.md §3.1 assigns them:
 *
 *   browser.storage.local   small, always-needed, launch-critical state
 *                           (ShieldRules, the list registry)
 *   IndexedDB 'ziy-shields' anything big or queryable: the compiled rule set
 *                           (10^5 rows) and the cosmetic table.
 *
 * The event page must not do heavy IndexedDB work on the request path, so the
 * compiled rules are loaded once into memory at startup and kept there; the
 * IndexedDB copy is the durable source of truth between restarts, and the
 * DNR engine does the actual per-request matching from its own rule sets.
 *
 * Schema (architecture §3.2):
 *   rules      { ruleId, type, action, pattern, regexp, options, priority, listId, source }
 *   elements   { domain, selector, createdAt, isException }
 *   sessions   { tabId, domain, blocks, upgrades, scripts, fp, startedAt }
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * A classic <script> in the shared global scope of the event page. Nothing
 * here is declared at the top level; the API lands on the shared
 * `ziyShields` namespace and on module.exports for the unit tests.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  const ns = root.ziyShields || (root.ziyShields = {});
  const api = factory();
  Object.assign(ns, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.DB_NAME = api.DB_NAME;
    exports.DB_VERSION = api.DB_VERSION;
    exports.openDB = api.openDB;
    exports.tx = api.tx;
    exports.putAll = api.putAll;
    exports.clearStore = api.clearStore;
    exports.toRuleRow = api.toRuleRow;
    exports.localGet = api.localGet;
    exports.localSet = api.localSet;
    exports.localRemove = api.localRemove;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

/* BODY: no top-level declaration of its own — the wrapper below owns the
 * scope, so this file's names can never collide with another lib file's
 * (defect D-2 was exactly such a collision). */
const DB_NAME = 'ziy-shields';
const DB_VERSION = 1;

/* ------------------------------------------------------------------ *
 * IndexedDB
 * ------------------------------------------------------------------ */

const browserApi = () => {
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) return browser;
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) return chrome;
  throw new Error('ziy-shields: no WebExtension API global in this context');
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rules')) {
        const rules = db.createObjectStore('rules', { keyPath: 'ruleId' });
        rules.createIndex('priority', 'priority');
        rules.createIndex('listId', 'listId');
        rules.createIndex('source', 'source');
      }
      if (!db.objectStoreNames.contains('elements')) {
        const elements = db.createObjectStore('elements', { keyPath: ['domain', 'selector'] });
        elements.createIndex('domain', 'domain');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'tabId' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        // A newer version wants the DB: close so it can upgrade. We deliberately
        // do not try to keep the old version alive — additive upgrades are the
        // only kind this schema performs, and refusing them corrupts nothing.
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let out;
    try {
      out = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    transaction.oncomplete = () => resolve(out && out.__value !== undefined ? out.__value : out);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function putAll(storeName, records) {
  if (records.length === 0) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const r of records) {
      if (r.__value === undefined) store.put(r);
    }
    transaction.oncomplete = () => resolve(transaction.completed);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ------------------------------------------------------------------ *
 * Rule store
 * ------------------------------------------------------------------ */

/** One row, shaped to architecture §3.2's `rules` store. */
function toRuleRow(dnrRule, source, listId, pattern, abp) {
  return {
    ruleId: dnrRule.id,
    type: 'network',
    action: dnrRule.action.type,
    pattern: typeof pattern === 'string' ? pattern : null,
    regexp: dnrRule.condition && dnrRule.condition.regexFilter ? dnrRule.condition.regexFilter : null,
    options: {
      thirdParty: dnrRule.condition && dnrRule.condition.domainType
        ? dnrRule.condition.domainType === 'thirdParty'
        : null,
      resourceTypes: dnrRule.condition && dnrRule.condition.resourceTypes
        ? dnrRule.condition.resourceTypes.slice()
        : null,
      initiatorDomains: dnrRule.condition && dnrRule.condition.initiatorDomains
        ? dnrRule.condition.initiatorDomains.slice()
        : null,
      excludedInitiatorDomains: dnrRule.condition && dnrRule.condition.excludedInitiatorDomains
        ? dnrRule.condition.excludedInitiatorDomains.slice()
        : null,
      matchCase: !!(dnrRule.condition && dnrRule.condition.isUrlFilterCaseSensitive),
      important: (abp && abp.important) || false,
    },
    priority: dnrRule.priority,
    listId: listId,
    source: source,
  };
}

/* ------------------------------------------------------------------ *
 * storage.local
 * ------------------------------------------------------------------ */

async function localGet(key, fallback) {
  try {
    const b = browserApi();
    const area = b.storage && b.storage.local;
    if (!area) return fallback;
    const value = typeof key === 'string' ? await area.get(key) : await area.get(key);
    if (typeof key === 'string') {
      return (value && key in value) ? value[key] : fallback;
    }
    return value || {};
  } catch (e) {
    return fallback;
  }
}

async function localSet(obj) {
  const b = browserApi();
  return b.storage.local.set(obj);
}

async function localRemove(key) {
  const b = browserApi();
  return b.storage.local.remove(key);
}

  return {
    DB_NAME,
    DB_VERSION,
    openDB,
    tx,
    putAll,
    clearStore,
    toRuleRow,
    localGet,
    localSet,
    localRemove,
  };
});
