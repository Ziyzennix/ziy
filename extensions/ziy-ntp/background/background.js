/* Ziy NTP — background event page.
 *
 * MV3 on Gecko has no service worker (Firefox bug 1573659), so this is a
 * `background.scripts` event page. Its jobs are all small:
 *
 *   1. answer `ntp.config` messages (architecture.md §5.1) so the shell can push
 *      a config patch at the NTP,
 *   2. serve the shields blocked-total contract `ziy.shields.blockedTotal`, via
 *      ziy-shields when it is installed and a shared storage key when it is not,
 *   3. publish the resolved engine list so the NTP page and the options page
 *      never each have to discover browser.search themselves,
 *   4. reload an open NTP tab when the backdrop source is set to
 *      refresh-on-new-tab, so the next new tab picks the new backdrop up.
 *
 * Everything stateful lives in browser.storage.local; this file keeps no state
 * of its own, so the event page can be suspended between messages.
 */
(function () {
  "use strict";

  const model = ZiyNtpModel;
  const store = ZiyNtpStorage;

  const SHIELDS_KEY = model.SHIELDS_STORAGE_KEY;
  const SHIELDS_ID = model.SHIELDS_EXTENSION_ID;

  function api() {
    return globalThis.browser || globalThis.chrome;
  }

  /* -------------------------------------------------------------------------
   * The shields contract.
   *
   * Preferred path: ask ziy-shields directly over runtime messaging. The message
   * is fire-and-forget with a rejection path, because the NTP must never stall
   * on another extension being present or absent.
   * ---------------------------------------------------------------------- */

  async function askShields() {
    const runtime = api().runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") return null;
    try {
      const reply = await runtime.sendMessage(SHIELDS_ID, {
        op: "shields.counts",
        from: "ziy-ntp@ziy.app",
      });
      if (reply && typeof reply.total === "number" && isFinite(reply.total)) {
        return { total: Math.max(0, Math.floor(reply.total)), via: "message" };
      }
    } catch (_err) {
      /* Shields is not installed, or refused. That is a supported state. */
    }
    return null;
  }

  /* Fallback path: the shared storage key. This is the documented contract, so a
   * shields that cannot be reached by messaging can still publish here. */
  async function readSharedKey() {
    const local = api().storage && api().storage.local;
    if (!local) return null;
    try {
      const all = await local.get(SHIELDS_KEY);
      const value = all ? all[SHIELDS_KEY] : undefined;
      if (typeof value === "number" && isFinite(value)) {
        return { total: Math.max(0, Math.floor(value)), via: "storage" };
      }
      if (value && typeof value === "object" && typeof value.total === "number") {
        return { total: Math.max(0, Math.floor(value.total)), via: "storage" };
      }
    } catch (_err) {
      /* No permission or no storage. Also supported. */
    }
    return null;
  }

  /* Always resolves with a real number. When nothing has reported, the total is
   * a true zero and `via` says so — the NTP shows the widget shell with real
   * zero counts rather than hiding it. */
  async function readStats() {
    const fromMessage = await askShields();
    if (fromMessage) return fromMessage;
    const fromStorage = await readSharedKey();
    if (fromStorage) return fromStorage;
    return { total: 0, via: "none" };
  }

  /* -------------------------------------------------------------------------
   * Engines.
   *
   * browser.search.get() is the portable source (permission "search"). Where the
   * API is missing, the fallback list stands in so the widget never breaks. The
   * result is merged with the user's stored on/off choices either way.
   * ---------------------------------------------------------------------- */

  async function availableEngines() {
    let fromBrowser = null;
    const search = api().search;
    if (search && typeof search.get === "function") {
      try {
        const engines = await search.get();
        if (Array.isArray(engines) && engines.length) {
          fromBrowser = engines
            .filter(function (engine) {
              return engine && typeof engine.name === "string" && engine.name;
            })
            .map(function (engine) {
              return {
                /* A browser engine has no url template: it is used by name
                 * through browser.search.search(). */
                id: "browser:" + engine.name,
                name: engine.name,
                urlTemplate: null,
                source: "browser",
                isDefault: !!engine.isDefault,
                favIconUrl: engine.favIconUrl || null,
              };
            });
        }
      } catch (_err) {
        fromBrowser = null;
      }
    }
    const stored = await store.loadEngines();
    /* When the browser exposed its own engines, those are the list; the fallback
     * list is only used when there is nothing better. */
    return {
      engines: model.mergeEngines(fromBrowser, stored),
      fromBrowser: !!fromBrowser,
    };
  }

  /* Which engine to use right now: the user's stored choice if it is still
   * available and switched on, otherwise the browser's default if the browser
   * exposed one, otherwise the model's own default. */
  async function currentEngine() {
    const config = await store.loadConfig();
    const available = await availableEngines();
    if (config.engineId) {
      const chosen = available.engines.find(function (e) { return e.id === config.engineId; });
      if (chosen && chosen.checked) return { engine: chosen, fromBrowser: available.fromBrowser };
    }
    const browserDefault = available.engines.find(function (e) { return e.isDefault; });
    if (browserDefault && browserDefault.checked) {
      return { engine: browserDefault, fromBrowser: available.fromBrowser };
    }
    const fallback = available.engines.find(function (e) {
      return e.id === model.DEFAULT_ENGINE_ID;
    }) || available.engines[0];
    return { engine: fallback, fromBrowser: available.fromBrowser };
  }

  /* -------------------------------------------------------------------------
   * Reload an open NTP tab.
   * ---------------------------------------------------------------------- */

  function ntpTabUrls() {
    const a = api();
    if (!a.runtime || typeof a.runtime.getURL !== "function") return [];
    const url = a.runtime.getURL("ui/ntp.html");
    return [url, url + "*"];
  }

  async function reloadOpenNtpTabs() {
    const tabs = api().tabs;
    if (!tabs || typeof tabs.query !== "function" || typeof tabs.reload !== "function") {
      return 0;
    }
    let reloaded = 0;
    for (const pattern of ntpTabUrls()) {
      try {
        const found = await tabs.query({ url: pattern });
        for (const tab of found || []) {
          try {
            await tabs.reload(tab.id);
            reloaded += 1;
          } catch (_err) {
            /* A tab can vanish between the query and the reload. Fine. */
          }
        }
      } catch (_err) {
        /* An unsupported pattern shape. Try the next one. */
      }
    }
    return reloaded;
  }

  /* -------------------------------------------------------------------------
   * Messages (architecture.md §5.1).
   *
   * Every op is idempotent: it reads an absolute value or writes one, never
   * increments. Returns a promise so the async sendResponse path works on both
   * Firefox (which awaits a returned promise) and any browser that needs
   * `return true`.
   * ---------------------------------------------------------------------- */

  function onMessage(message, _sender, sendResponse) {
    if (!message || typeof message.op !== "string") return undefined;

    if (message.op === "ntp.config") {
      return store.saveConfig(message.patch || {}).then(function (config) {
        if (sendResponse) sendResponse(config);
        return config;
      });
    }

    if (message.op === "ntp.stats") {
      return readStats().then(function (stats) {
        if (sendResponse) sendResponse(stats);
        return stats;
      });
    }

    if (message.op === "ntp.engines") {
      return availableEngines().then(function (result) {
        if (sendResponse) sendResponse(result);
        return result;
      });
    }

    if (message.op === "ntp.engine") {
      return currentEngine().then(function (result) {
        if (sendResponse) sendResponse(result);
        return result;
      });
    }

    if (message.op === "ntp.reload") {
      return reloadOpenNtpTabs().then(function (count) {
        if (sendResponse) sendResponse({ reloaded: count });
        return { reloaded: count };
      });
    }

    return undefined;
  }

  const a = api();
  if (a && a.runtime && typeof a.runtime.onMessage === "object") {
    a.runtime.onMessage.addListener(onMessage);
  }

  /* Exposed for the page-side harness so the DOM assertions can reach the same
   * code paths without re-implementing them. */
  globalThis.ZiyNtpBackground = {
    readStats,
    availableEngines,
    currentEngine,
    reloadOpenNtpTabs,
    onMessage,
  };
})();
