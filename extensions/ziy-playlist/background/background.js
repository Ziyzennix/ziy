/* ziy-playlist background — the event page.
 *
 * MV3 on Gecko has no service worker (Firefox bug 1573659), so this is a
 * `background.scripts` event page: suspended between calls, so every listener
 * is registered synchronously at the top level and every state transition is
 * idempotent.
 *
 * Its five jobs:
 *
 *   1. THE QUEUE. The event page is the only writer, so the panel's writes
 *      all arrive here, are normalised by lib/model.js, and are drained by
 *      lib/store.js on save. Two panels editing at once is impossible
 *      because there is one queue and one writer.
 *
 *   2. CAPTURE. The content script reports the item a page element exposes;
 *      the address-bar equivalent is the toolbar Action, which asks the
 *      page's content script for the same item. Both land in the queue.
 *
 *   3. RESUME. The panel writes a position; the event page persists it. The
 *      rule that decides whether a position is offered is lib/position.js,
 *      not this file, so it is unit-tested.
 *
 *   4. THE BUS. Two cross-extension facts are published, both consumed
 *      elsewhere in the suite: `playlist.counts` (how many items, how many
 *      unplayed) for anyone that needs to display it, and
 *      `playlist.openPanel` so the shell's Playlist menu entry can open the
 *      panel without owning it (architecture §2.4).
 *
 *   5. NOTHING ELSE. No network. No alarm. No periodic refresh. The event
 *      page wakes for a message and goes back to sleep: an extension that
 *      keeps a background page alive to look at nothing is the CPU complaint
 *      replica/fixes.md §1.2 is made of.
 */
(function () {
  "use strict";

  /* The lib files are loaded before this one by the manifest's script order,
     * so they are on the global already. */
  const model = globalThis.ZiyPlaylistModel;
  const classify = globalThis.ZiyPlaylistClassify;
  const settingsModel = globalThis.ZiyPlaylistSettings;
  const store = globalThis.ZiyPlaylistStore;
  const position = globalThis.ZiyPlaylistPosition;

  const api = globalThis.browser || globalThis.chrome;
  const EXTENSION_ID = "ziy-playlist@ziy.app";

  /* The queue is held in memory for the life of the event page, and every
     mutation writes through to IndexedDB. On wake, it is loaded once. */
  let queue = model.emptyQueue();
  let loaded = false;
  let saveTimer = 0;
  let loadingPromise = null;

  function log(...args) {
    try {
      console.log("[ziy-playlist]", ...args);
    } catch (_e) { /* a background page without a console just logs nowhere */ }
  }

  /* ------------------------------------------------------------------ */
  /* Loading and saving                                                 */
  /* ------------------------------------------------------------------ */

  function loadQueue() {
    if (loadingPromise) return loadingPromise;
    loadingPromise = store.loadItems()
      .then((items) => {
        queue = model.normaliseQueue(items);
        loaded = true;
        return queue;
      })
      .catch((err) => {
        log("could not open the queue store:", err && err.message);
        queue = model.emptyQueue();
        loaded = true;
        return queue;
      })
      .finally(() => { loadingPromise = null; });
    return loadingPromise;
  }

  /**
   * Writes are debounced by one tick of a timeout, not by a long delay:
   * the debounce exists to collapse the burst a drag-reorder produces into
   * one write, not to make persistence lazy. 150ms is far below the point
   * where a user could perceive a lost update, and far above the point
   * where it matters.
   */
  const SAVE_DEBOUNCE_MS = 150;

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  async function saveNow() {
    try {
      await store.saveItems(undefined, queue);
      /* Anyone displaying a count hears about the change, politely. */
      void publishCounts();
    } catch (err) {
      log("could not save the queue:", err && err.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Counts, published on the suite's bus                              */
  /* ------------------------------------------------------------------ */

  let counts = { items: 0, unplayed: 0 };

  function publishCounts() {
    const next = {
      items: queue.length,
      unplayed: queue.filter((item) => item.lastPlayedAt === 0).length,
    };
    const changed = next.items !== counts.items || next.unplayed !== counts.unplayed;
    counts = next;
    if (!changed) return Promise.resolve();
    try {
      return api.runtime.sendMessage(EXTENSION_ID, {
        op: "playlist.counts",
        from: "background",
        counts: next,
      });
    } catch (_e) {
      return Promise.resolve();
    }
  }

  /* ------------------------------------------------------------------ */
  /* The address-bar equivalent: the toolbar Action                    */
  /* ------------------------------------------------------------------ */

  api.action.onClicked.addListener(async (tab) => {
    if (!tab || typeof tab.id !== "number") return;
    let reply = null;
    try {
      reply = await api.tabs.sendMessage(tab.id, { kind: "playlist:capture" });
    } catch (_e) {
      reply = null;
    }
    if (reply && reply.ok === true && reply.item) {
      const before = queue.length;
      queue = model.add(queue, reply.item);
      const added = queue.length > before || true;
      scheduleSave();
      void api.sidebarAction.open();
      log("added from the toolbar action:", reply.item.url);
      return;
    }
    /* Nothing playable on this page. Opening the panel is still the right
       answer: the user asked for the playlist, not for a media file. */
    void api.sidebarAction.open();
  });

  /* ------------------------------------------------------------------ */
  /* The message bus. Every handler is synchronous at the top level, per
     * the event-page rules, and every reply is a promise.                */
  /* ------------------------------------------------------------------ */

  const HANDLERS = Object.freeze({
    "playlist.page.hello": hello,
    "playlist.get": getQueue,
    "playlist.add": addItem,
    "playlist.remove": removeItem,
    "playlist.move": moveItem,
    "playlist.moveBefore": moveBefore,
    "playlist.clear": clearQueue,
    "playlist.position": setPosition,
    "playlist.duration": setDuration,
    "playlist.played": markPlayed,
    "playlist.settings.get": getSettings,
    "playlist.settings.set": setSettings,
    "playlist.site.dismiss": dismissSite,
    "playlist.site.undismiss": undismissSite,
    "playlist.sites.get": getSites,
    "playlist.counts": getCounts,
  });

  api.runtime.onMessage.addListener((message, sender) => {
    if (!message || typeof message.op !== "string") return undefined;
    const handler = HANDLERS[message.op];
    if (!handler) return undefined;
    /* The panel and the content script both reply to the extension's own
       origin, so the sender check is about not answering a foreign page. */
    if (sender && sender.id && sender.id !== EXTENSION_ID) return undefined;
    return Promise.resolve()
      .then(() => handler(message))
      .then((reply) => {
        publishCounts();
        return reply;
      })
      .catch((err) => {
        log("op failed:", message.op, err && err.message);
        return { ok: false, error: { kind: "op-failed", message: String(err && err.message) } };
      });
  });

  /* ------------------------------------------------------------------ */
  /* Handlers                                                           */
  /* ------------------------------------------------------------------ */

  async function hello() {
    const settings = settingsModel.normaliseSettings(await store.loadSettings(api));
    const sites = settingsModel.normaliseSites(await store.loadSites(api));
    const origin = arguments[0] && arguments[0].origin;
    return {
      ok: true,
      settings: settings,
      site: { dismissed: settingsModel.isSiteDismissed(sites, origin) },
    };
  }

  async function getQueue() {
    await loadQueue();
    const settings = settingsModel.normaliseSettings(await store.loadSettings(api));
    /* Every row is returned with its resume sentence already decided, so
       the panel never re-decides what a position means. */
    return {
      ok: true,
      queue: queue,
      rows: queue.map((item) => ({
        id: item.id,
        url: item.url,
        kind: item.kind,
        type: item.type,
        mime: item.mime,
        title: item.title,
        source: item.source,
        thumbnail: item.thumbnail,
        duration: item.duration,
        order: item.order,
        lastPlayedAt: item.lastPlayedAt,
        resume: position.resumeLabel(item, settings.resumeMode),
        position: position.startPosition(item, settings.resumeMode),
        finished: position.isFinished(item, item.position),
      })),
      counts: {
        items: queue.length,
        unplayed: queue.filter((item) => item.lastPlayedAt === 0).length,
      },
    };
  }

  async function addItem(message) {
    await loadQueue();
    const before = queue.length;
    const item = message.item || {};
    const full = model.normaliseItem(item);
    if (!full) {
      return { ok: false, error: { kind: "not-playable", message: "That media has no address the player can use." } };
    }
    queue = model.add(queue, full);
    const existing = before >= queue.length;
    scheduleSave();
    return {
      ok: true,
      added: !existing,
      item: full,
      counts: { items: queue.length },
    };
  }

  async function removeItem(message) {
    await loadQueue();
    queue = model.remove(queue, message.id);
    scheduleSave();
    return { ok: true, queue: queue };
  }

  async function moveItem(message) {
    await loadQueue();
    queue = model.move(queue, message.from, message.to);
    scheduleSave();
    return { ok: true, queue: queue };
  }

  async function moveBefore(message) {
    await loadQueue();
    queue = model.moveBefore(queue, message.id, message.targetId);
    scheduleSave();
    return { ok: true, queue: queue };
  }

  async function clearQueue() {
    await store.clearItems();
    queue = model.clear(queue);
    scheduleSave();
    return { ok: true, queue: queue };
  }

  async function setPosition(message) {
    await loadQueue();
    const value = Number(message.position);
    queue = model.setPosition(queue, message.id, value);
    scheduleSave();
    const item = model.find(queue, message.id);
    if (!item) return { ok: true, position: 0 };
    /* The reply carries the resolved start position, so the panel can
       restart from it after a reload without re-deriving the rule. */
    const settings = settingsModel.normaliseSettings(await store.loadSettings(api));
    return {
      ok: true,
      position: position.startPosition(item, settings.resumeMode),
      finished: position.isFinished(item, item.position),
    };
  }

  async function setDuration(message) {
    await loadQueue();
    queue = model.setDuration(queue, message.id, message.duration);
    scheduleSave();
    return { ok: true, queue: queue };
  }

  async function markPlayed(message) {
    await loadQueue();
    const now = Number.isFinite(message.now) ? message.now : Date.now();
    queue = model.markPlayed(queue, message.id, now);
    scheduleSave();
    return { ok: true, ok_at: now };
  }

  /* ------------------------------------------------------------------ */
  /* Settings and per-site dismissals                                   */
  /* ------------------------------------------------------------------ */

  async function getSettings() {
    const raw = await store.loadSettings(api);
    return { ok: true, settings: settingsModel.normaliseSettings(raw) };
  }

  async function setSettings(message) {
    const next = settingsModel.serialiseSettings(message.settings);
    await store.saveSettings(api, next);
    /* The panel side is the shell's business: it is a pref we cannot write,
     * so the choice is recorded here and the options page says so plainly. */
    return { ok: true, settings: next };
  }

  async function dismissSite(message) {
    const sites = settingsModel.normaliseSites(await store.loadSites(api));
    const next = settingsModel.dismissSite(sites, message.origin);
    await store.saveSites(api, next);
    return { ok: true, sites: next };
  }

  async function undismissSite(message) {
    const sites = settingsModel.normaliseSites(await store.loadSites(api));
    const next = settingsModel.undismissSite(sites, message.origin);
    await store.saveSites(api, next);
    return { ok: true, sites: next };
  }

  async function getSites() {
    const sites = settingsModel.normaliseSites(await store.loadSites(api));
    return { ok: true, sites: sites };
  }

  async function getCounts() {
    await loadQueue();
    return { ok: true, counts: counts };
  }

  /* ------------------------------------------------------------------ */
  /* Install: seed the settings once, so the first panel open is the     *
   * documented default rather than a half-filled record.                */
  /* ------------------------------------------------------------------ */

  api.runtime.onInstalled.addListener(async () => {
    const raw = await store.loadSettings(api);
    if (!raw) await store.saveSettings(api, settingsModel.factorySettings());
  });

  /* The counts bus: a sibling that asks gets the current pair. */
  api.runtime.onMessageExternal
    ? api.runtime.onMessageExternal.addListener((message) => {
      if (message && message.op === "playlist.counts") return Promise.resolve({ ok: true, counts: counts });
      return undefined;
    })
    : undefined;
})();
