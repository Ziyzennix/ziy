/* Ziy NTP — storage adapter.
 *
 * The one place that talks to `browser.storage.local`, so every reader and
 * writer in the extension goes through the same merge and the same key set.
 * Nothing else in the extension touches storage directly.
 *
 * UMD-style for the same reason as model.js: the NTP page, the dashboard, the
 * options page and the background event page all load this one file, so there
 * is a single definition of how the config is persisted.
 *
 * Load order in any HTML page: model.js, then storage.js.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ZiyNtpStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* model.js is loaded first, so ZiyNtpModel is on the global by the time this
   * factory runs. In node, the test harness requires model.js then this file. */
  const model =
    (typeof ZiyNtpModel !== "undefined" && ZiyNtpModel) ||
    (typeof require === "function" ? require("./model.js") : null);

  const KEY_CONFIG = model.STORAGE_KEYS.config;
  const KEY_SITES = model.STORAGE_KEYS.topSites;
  const KEY_ENGINES = model.STORAGE_KEYS.engines;

  /* Favorites and frequently-visited are independent lists. They read and write
   * different storage keys, which is what makes the independence structural
   * rather than a rule the code has to remember (recon F09). */
  const SITE_KEYS = {
    favorites: KEY_SITES + ".favorites",
    frequent: KEY_SITES + ".frequent",
  };

  function siteKey(mode) {
    return SITE_KEYS[mode === "frequent" ? "frequent" : "favorites"];
  }

  /* Resolve `browser.storage.local` at call time, not at load time: an event
   * page can be suspended and resumed, and an extension page can be created
   * before its storage is ready. Failing here with a clear error beats a
   * half-initialised module reference. */
  function storage() {
    const api = globalThis.browser || globalThis.chrome;
    if (!api || !api.storage || !api.storage.local) {
      throw new Error("browser.storage.local is not available in this context");
    }
    return api.storage.local;
  }

  /* Read one key, tolerating a missing result. */
  async function readKey(key) {
    try {
      const all = await storage().get(key);
      return all ? all[key] : undefined;
    } catch (_err) {
      return undefined;
    }
  }

  /* ------------------------------------------------------------------- config */

  async function loadConfig() {
    return model.mergeConfig(await readKey(KEY_CONFIG));
  }

  /* Write a merge of the stored config with `patch`, then return the merged
   * result, so a caller can render from the authoritative value. */
  async function saveConfig(patch) {
    const merged = model.mergeConfig(Object.assign({}, await readKey(KEY_CONFIG), patch));
    await storage().set({ [KEY_CONFIG]: merged });
    return merged;
  }

  async function setWidget(id, value) {
    const current = await loadConfig();
    current.widgets[id] = !!value;
    return saveConfig({ widgets: current.widgets });
  }

  async function setCards(value) {
    return saveConfig({ cards: !!value });
  }

  async function setTopSitesMode(mode) {
    return saveConfig({
      topSitesMode: mode === "frequent" ? "frequent" : "favorites",
    });
  }

  async function setClock24h(value) {
    return saveConfig({ clock24h: !!value });
  }

  /* null/unset means "follow the browser's default search engine". */
  async function setEngineId(id) {
    return saveConfig({ engineId: id || null });
  }

  async function setBackground(patch) {
    const current = await loadConfig();
    return saveConfig({ background: Object.assign({}, current.background, patch) });
  }

  /* Store the user's upload. The caller reads the file as a data URL, so the
   * extension holds bytes it can render and never a filesystem path. */
  async function setCustomBackground(dataUrl, name) {
    return setBackground({
      source: "custom",
      customDataUrl: typeof dataUrl === "string" ? dataUrl : null,
      customName: typeof name === "string" ? name : null,
    });
  }

  /* ---------------------------------------------------------------- topsites */

  async function loadTopSites(mode) {
    return model.normaliseTopSites(await readKey(siteKey(mode)), mode);
  }

  async function saveTopSites(mode, sites) {
    const normalised = model.normaliseTopSites(sites, mode);
    await storage().set({ [siteKey(mode)]: normalised });
    return normalised;
  }

  /* Every mutation returns the whole new list, so the caller re-renders from
   * what was actually written. */
  async function mutateTopSites(mode, fn) {
    const current = await loadTopSites(mode);
    const result = fn(current);
    const saved = await saveTopSites(mode, result.sites || current);
    return Object.assign({}, result, { sites: saved });
  }

  /* ------------------------------------------------------------------ engines */

  async function loadEngines() {
    return model.normaliseEngineChoices(await readKey(KEY_ENGINES));
  }

  async function saveEngines(choices) {
    const normalised = model.normaliseEngineChoices(choices);
    await storage().set({ [KEY_ENGINES]: normalised });
    return normalised;
  }

  /* Set one engine's on/off state, keeping the rest of the list. */
  async function setEngineChecked(id, checked) {
    const choices = await loadEngines();
    let found = false;
    const next = choices.map(function (choice) {
      if (choice.id !== id) return choice;
      found = true;
      return { id: choice.id, checked: !!checked };
    });
    if (!found) next.push({ id: id, checked: !!checked });
    return saveEngines(next);
  }

  /* ------------------------------------------------------------------- export */

  return {
    loadConfig,
    saveConfig,
    setWidget,
    setCards,
    setTopSitesMode,
    setClock24h,
    setEngineId,
    setBackground,
    setCustomBackground,
    loadTopSites,
    saveTopSites,
    mutateTopSites,
    loadEngines,
    saveEngines,
    setEngineChecked,
    siteKey,
  };
});
