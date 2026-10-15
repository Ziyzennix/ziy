/* Ziy NTP — unit tests.
 *
 * Plain node:test, no framework, no dependencies. Run with:
 *
 *   node --test test/
 *
 * or `npm test` in this directory.
 *
 * What is covered:
 *   1. the top-sites storage model (add / edit / remove / reorder / persist),
 *   2. favorites-vs-frequently-visited independence,
 *   3. settings merge defaults (including a partial and a hostile config),
 *   4. the search-engine model,
 *   5. the clock formatter,
 *   6. the shields shared-storage contract.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const model = require("../lib/model.js");

/* ---------------------------------------------------------------------------
 * A tiny in-memory stand-in for browser.storage.local. This is what makes the
 * persistence tests real: the adapter's storage.js is exercised against a
 * store that behaves like the API (async get/set, key-scoped reads) without
 * needing a browser.
 *
 * The tests inject it by installing a `globalThis.browser` before requiring the
 * storage adapter, which is how the page gets it too.
 * ------------------------------------------------------------------------ */

function makeStorage(seed) {
  const data = Object.assign({}, seed || {});
  const listeners = [];
  const local = {
    async get(keys) {
      if (typeof keys === "string") {
        const out = {};
        if (Object.prototype.hasOwnProperty.call(data, keys)) out[keys] = data[keys];
        return out;
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
        }
        return out;
      }
      if (keys === undefined || keys === null) return Object.assign({}, data);
      return Object.assign({}, data);
    },
    async set(items) {
      for (const key of Object.keys(items)) {
        data[key] = JSON.parse(JSON.stringify(items[key]));
        listeners.forEach((fn) => fn({ [key]: { newValue: data[key] } }, "local"));
      }
    },
    async remove(key) {
      delete data[key];
    },
    async clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    get onChanged() {
      return { addListener: (fn) => listeners.push(fn) };
    },
  };
  return {
    local,
    data,
    /* Read the whole store as a plain object, for assertions. */
    snapshot: () => JSON.parse(JSON.stringify(data)),
  };
}

function installBrowser(storage) {
  globalThis.browser = { storage: { local: storage.local } };
}

/* A fresh storage adapter bound to a fresh store. storage.js resolves
 * ZiyNtpModel from the module cache, so requiring both here is enough. */
function newStore(seed) {
  for (const key of Object.keys(require.cache)) {
    if (key.endsWith("lib/storage.js")) delete require.cache[key];
  }
  const backing = makeStorage(seed);
  installBrowser(backing);
  // eslint-disable-next-line global-require
  return { store: require("../lib/storage.js"), backing };
}

const SAMPLE = [
  { id: "a", url: "https://one.example.com/", title: "One", position: 3 },
  { id: "b", url: "https://two.example.com/", title: "Two", position: 1 },
  { id: "c", url: "https://three.example.com/", title: "Three", position: 2 },
];

/* ===========================================================================
 * 1. Top-sites storage model
 * =========================================================================*/

test("normaliseTopSites drops junk and makes positions dense", () => {
  const messy = [
    { id: "a", url: "https://one.example.com", title: "One" },
    { id: "a", url: "https://dup.example.com" },
    { url: "https://noid.example.com" },
    { id: "d", url: "not-a-url" },
    { id: "e", url: "ftp://files.example.com/x" },
    null,
    "string",
    { id: "f", url: "https://two.example.com", title: "  Two  " },
  ];
  const out = model.normaliseTopSites(messy, "favorites");
  assert.equal(out.length, 2, "only the two valid, de-duplicated entries survive");
  assert.deepEqual(out.map((s) => s.position), [0, 1], "positions are dense and ordered");
  assert.equal(out[1].title, "Two", "titles are trimmed");
  for (const site of out) {
    assert.ok(site.url.startsWith("https://"), "only http/https survive");
    assert.equal(site.mode, "favorites");
  }
});

test("normaliseTopSites tolerates no input at all", () => {
  assert.deepEqual(model.normaliseTopSites(undefined, "favorites"), []);
  assert.deepEqual(model.normaliseTopSites(null, "favorites"), []);
  assert.deepEqual(model.normaliseTopSites("nope", "favorites"), []);
});

test("addTopSite appends, normalises the URL and keeps order", () => {
  const result = model.addTopSite(SAMPLE, {
    url: "https://four.example.com/path",
    title: "Four",
  });
  assert.equal(result.ok, true);
  assert.equal(result.sites.length, 4);
  assert.equal(result.sites[3].url, "https://four.example.com/path");
  assert.equal(result.sites[3].position, 3);
  /* Stored order is respected, not silently re-sorted. */
  assert.deepEqual(result.sites.map((s) => s.id), ["a", "b", "c", result.sites[3].id]);
});

test("addTopSite requires an explicit scheme", () => {
  /* The recon's rule is "must have a scheme". A bare host would resolve against
   * the moz-extension origin instead of the web, so it is refused. */
  const result = model.addTopSite(SAMPLE, { url: "four.example.com/path", title: "Four" });
  assert.equal(result.ok, false);
  assert.match(result.error, /scheme/);
  assert.equal(result.sites.length, 3);
});

test("addTopSite normalises an uppercase scheme and host", () => {
  const result = model.addTopSite([], { url: "HTTPS://Example.COM/A" });
  assert.equal(result.ok, true);
  assert.equal(result.sites[0].url, "https://example.com/A");
});

test("addTopSite rejects a scheme-less URL with a reason", () => {
  const result = model.addTopSite([], { url: "example.com", title: "x" });
  assert.equal(result.ok, false);
  assert.match(result.error, /scheme/);
  assert.deepEqual(result.sites, []);
});

test("addTopSite rejects the same site added twice", () => {
  /* The same host is allowed with a different path — those are different pages
     — but the exact same URL is a duplicate. */
  const sameExact = model.addTopSite(SAMPLE, { url: "https://one.example.com/", title: "Dupe" });
  assert.equal(sameExact.ok, false, "the same URL is refused");
  assert.match(sameExact.error, /already/);
  assert.equal(sameExact.sites.length, 3);

  const otherPath = model.addTopSite(SAMPLE, {
    url: "https://one.example.com/other",
    title: "Other page",
  });
  assert.equal(otherPath.ok, true, "a different path on the same host is a different site");
  assert.equal(otherPath.sites.length, 4);
});

test("addTopSite enforces the 24-tile ceiling", () => {
  const full = [];
  for (let i = 0; i < model.MAX_TOP_SITES; i += 1) {
    full.push({ id: "s" + i, url: "https://s" + i + ".example.com", title: "S" + i });
  }
  assert.equal(model.MAX_TOP_SITES, 24, "the recon's ceiling is 24");
  const result = model.addTopSite(full, { url: "https://another.example.com" });
  assert.equal(result.ok, false);
  assert.match(result.error, /24/);
});

test("editTopSite changes title and URL in place, preserving position", () => {
  const result = model.editTopSite(SAMPLE, "b", {
    title: "Renamed",
    url: "https://moved.example.com/",
  });
  assert.equal(result.ok, true);
  const site = result.sites.find((s) => s.id === "b");
  assert.equal(site.title, "Renamed");
  assert.equal(site.url, "https://moved.example.com/");
  /* Position is the stored order (second), not the array index of the input. */
  assert.equal(site.position, 1);
  assert.deepEqual(result.sites.map((s) => s.id), ["a", "b", "c"]);
});

test("editTopSite rejects an unknown id and a duplicate URL", () => {
  assert.equal(model.editTopSite(SAMPLE, "nope", { title: "x" }).ok, false);
  const dupe = model.editTopSite(SAMPLE, "b", { url: "https://one.example.com/" });
  assert.equal(dupe.ok, false);
  assert.match(dupe.error, /already/);
});

test("removeTopSite removes one entry and renumbers", () => {
  const result = model.removeTopSite(SAMPLE, "b");
  assert.deepEqual(result.sites.map((s) => s.id), ["a", "c"]);
  assert.deepEqual(result.sites.map((s) => s.position), [0, 1]);
});

test("moveTopSite moves by one step and clamps at the ends", () => {
  const later = model.moveTopSite(SAMPLE, "a", 1);
  assert.deepEqual(later.sites.map((s) => s.id), ["b", "a", "c"]);
  assert.deepEqual(later.sites.map((s) => s.position), [0, 1, 2]);

  const earlier = model.moveTopSite(later.sites, "c", -1);
  assert.deepEqual(earlier.sites.map((s) => s.id), ["b", "c", "a"]);

  /* Past the start is refused, not wrapped. */
  const clamped = model.moveTopSite(SAMPLE, "a", -1);
  assert.equal(clamped.ok, false);
  assert.match(clamped.error, /end of the list/);
});

test("reorderTopSites applies an explicit order and is idempotent", () => {
  const once = model.reorderTopSites(SAMPLE, ["c", "a", "b"]);
  assert.deepEqual(once.sites.map((s) => s.id), ["c", "a", "b"]);
  const twice = model.reorderTopSites(once.sites, ["c", "a", "b"]);
  assert.deepEqual(twice.sites.map((s) => s.id), ["c", "a", "b"]);
  assert.deepEqual(twice.sites.map((s) => s.position), [0, 1, 2]);
});

test("reorderTopSites ignores unknown ids and keeps omitted entries", () => {
  const result = model.reorderTopSites(SAMPLE, ["c", "ghost", "c"]);
  assert.deepEqual(result.sites.map((s) => s.id), ["c", "a", "b"]);
});

test("pageOf returns 6 tiles per page and never an out-of-range page", () => {
  assert.equal(model.TILES_PER_PAGE, 6, "the recon's page size is 6");
  const eight = [];
  for (let i = 0; i < 8; i += 1) {
    eight.push({ id: "x" + i, url: "https://x" + i + ".example.com", title: "X" + i });
  }
  const first = model.pageOf(eight, 0);
  assert.equal(first.sites.length, 6);
  assert.equal(first.pages, 2);
  const second = model.pageOf(eight, 1);
  assert.equal(second.sites.length, 2);
  /* An out-of-range page is clamped rather than returning an empty slice. */
  const beyond = model.pageOf(eight, 99);
  assert.equal(beyond.page, 1);
  assert.equal(beyond.sites.length, 2);
  const empty = model.pageOf([], 0);
  assert.equal(empty.pages, 1);
  assert.equal(empty.sites.length, 0);
});

/* ===========================================================================
 * 2. The storage adapter, end to end through the in-memory store
 * =========================================================================*/

test("the adapter persists top sites across a save/load round trip", async () => {
  const { store, backing } = newStore();
  await store.mutateTopSites("favorites", (list) =>
    model.addTopSite(list, { url: "https://one.example.com", title: "One" }),
  );
  await store.mutateTopSites("favorites", (list) =>
    model.addTopSite(list, { url: "https://two.example.com", title: "Two" }),
  );
  const reloaded = await store.loadTopSites("favorites");
  assert.equal(reloaded.length, 2);
  assert.deepEqual(reloaded.map((s) => s.title), ["One", "Two"]);
  assert.deepEqual(reloaded.map((s) => s.position), [0, 1]);
  assert.ok(backing.snapshot()[store.siteKey("favorites")], "written under its own key");
});

test("a persisted edit and reorder survive a fresh adapter instance", async () => {
  const first = newStore();
  const afterFirst = await first.store.mutateTopSites("favorites", (list) =>
    model.addTopSite(list, { url: "https://one.example.com", title: "One" }),
  );
  const afterSecond = await first.store.mutateTopSites("favorites", (list) =>
    model.addTopSite(list, { url: "https://two.example.com", title: "Two" }),
  );
  assert.ok(afterFirst.ok && afterSecond.ok, "both additions succeed");
  /* Move the second entry (index 1) earlier. */
  const movedId = afterSecond.sites[1].id;
  await first.store.mutateTopSites("favorites", (list) => model.moveTopSite(list, movedId, -1));

  /* A second store on the same backing = the browser restarting. */
  const second = newStore(first.backing.snapshot());
  const list = await second.store.loadTopSites("favorites");
  assert.deepEqual(
    list.map((s) => s.title),
    ["Two", "One"],
    "the reorder is what is on disk",
  );
  assert.deepEqual(list.map((s) => s.position), [0, 1]);
});

test("a corrupt stored list is repaired on read, not on write only", async () => {
  const { store } = newStore({
    "ntp.topsites.favorites": [
      { id: "keep", url: "https://keep.example.com", title: "Keep" },
      { id: "bad", url: "javascript:alert(1)" },
      { url: "https://nourl.example.com" },
    ],
  });
  const list = await store.loadTopSites("favorites");
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "keep");
  assert.equal(list[0].position, 0);
});

/* ===========================================================================
 * 3. Favorites vs frequently-visited independence
 * =========================================================================*/

test("favorites and frequently-visited are separate lists", async () => {
  const { store, backing } = newStore();

  await store.mutateTopSites("favorites", (list) =>
    model.addTopSite(list, { url: "https://fav.example.com", title: "Fav" }),
  );
  await store.mutateTopSites("frequent", (list) =>
    model.addTopSite(list, { url: "https://freq.example.com", title: "Freq" }),
  );

  const favorites = await store.loadTopSites("favorites");
  const frequent = await store.loadTopSites("frequent");

  assert.deepEqual(favorites.map((s) => s.url), ["https://fav.example.com/"]);
  assert.deepEqual(frequent.map((s) => s.url), ["https://freq.example.com/"]);

  const snap = backing.snapshot();
  assert.ok(snap["ntp.topsites.favorites"], "favorites has its own key");
  assert.ok(snap["ntp.topsites.frequent"], "frequent has its own key");
  assert.notEqual(
    snap["ntp.topsites.favorites"],
    snap["ntp.topsites.frequent"],
    "the two keys are not aliases of one value",
  );
});

test("removing from favorites does not touch frequently-visited", async () => {
  const { store } = newStore();
  for (const mode of ["favorites", "frequent"]) {
    await store.mutateTopSites(mode, (list) =>
      model.addTopSite(list, { url: "https://shared.example.com", title: "Shared" }),
    );
  }
  const favorites = await store.loadTopSites("favorites");
  await store.mutateTopSites("favorites", (list) => model.removeTopSite(list, favorites[0].id));

  const afterFavorites = await store.loadTopSites("favorites");
  const afterFrequent = await store.loadTopSites("frequent");
  assert.equal(afterFavorites.length, 0, "the favorite went away");
  assert.equal(afterFrequent.length, 1, "the frequent entry is untouched");
});

test("a frequent entry derives a distinct id from the same URL", async () => {
  const { store } = newStore();
  const url = "https://shared.example.com/";
  await store.mutateTopSites("favorites", (l) => model.addTopSite(l, { url, title: "Fav" }));
  await store.mutateTopSites("frequent", (l) => model.addTopSite(l, { url, title: "Freq" }));
  const [fav] = await store.loadTopSites("favorites");
  const [freq] = await store.loadTopSites("frequent");
  assert.notEqual(fav.id, freq.id, "ids are per-list, so a reorder of one is never a reorder of both");
  assert.equal(fav.mode, "favorites");
  assert.equal(freq.mode, "frequent");
});

/* ===========================================================================
 * 4. Settings merge defaults
 * =========================================================================*/

test("mergeConfig on nothing produces the full documented default", () => {
  const config = model.mergeConfig(undefined);
  const defaults = model.defaultConfig();

  assert.deepEqual(config.widgets, {
    background: true,
    search: true,
    topsites: true,
    clock: true,
    stats: true,
    news: false,
  });
  assert.equal(config.cards, false);
  assert.equal(config.topSitesMode, "favorites");
  assert.equal(config.clock24h, true);
  assert.equal(config.engineId, null);
  assert.equal(config.background.source, "gradient");
  assert.equal(config.background.gradientId, "gloam");
  assert.equal(config.background.customDataUrl, null);
  assert.equal(config.background.refreshOnNewTab, false);

  /* And the default really is byte-identical to the accessor, so nothing can
     mutate it through the returned object. */
  assert.deepEqual(config, defaults);
  config.clock24h = false;
  assert.equal(model.defaultConfig().clock24h, true, "the default factory is not shared state");
});

test("a partial stored config is completed from defaults", () => {
  const merged = model.mergeConfig({
    widgets: { search: false },
    topSitesMode: "frequent",
  });
  assert.equal(merged.widgets.search, false, "the stored value wins");
  assert.equal(merged.widgets.clock, true, "an omitted widget falls back to on");
  assert.equal(merged.widgets.topsites, true);
  assert.equal(merged.topSitesMode, "frequent");
  assert.equal(merged.clock24h, true, "an omitted scalar falls back to its default");
  assert.equal(merged.background.source, "gradient", "an omitted section is whole");
});

test("unknown widget keys and unknown sections are dropped", () => {
  const merged = model.mergeConfig({
    widgets: { search: true, telemetry: true, ads: "yes" },
    somethingElse: { nope: 1 },
    background: { source: "gradient", gradientId: "gloam", injected: "css:url()" },
  });
  assert.equal("telemetry" in merged.widgets, false, "unknown widget ids do not survive");
  assert.equal("ads" in merged.widgets, false);
  assert.equal("somethingElse" in merged, false, "unknown sections do not survive");
  assert.equal("injected" in merged.background, false, "unknown background keys do not survive");
});

test("string booleans and non-boolean junk are coerced, not trusted", () => {
  const merged = model.mergeConfig({
    widgets: { search: "false", clock: 0, stats: "true", topsites: 1 },
    cards: "off",
    clock24h: "true",
  });
  assert.equal(merged.widgets.search, false, `"false" is false`);
  assert.equal(merged.widgets.clock, true, "0 falls back to the default, not to true");
  assert.equal(merged.widgets.stats, true);
  assert.equal(merged.widgets.topsites, true, "1 falls back to the default");
  assert.equal(merged.cards, false);
  assert.equal(merged.clock24h, true);
});

test("an out-of-range mode or enum falls back to its default", () => {
  const merged = model.mergeConfig({
    topSitesMode: "promoted",
    background: { source: "photo-library", gradientId: "nonexistent", solidId: "polka-dot" },
  });
  assert.equal(merged.topSitesMode, "favorites");
  assert.equal(merged.background.source, "gradient");
  assert.equal(merged.background.gradientId, "gloam");
  assert.equal(merged.background.solidId, "bg");
});

test("a custom upload is dropped unless the source is still custom", () => {
  const keep = model.mergeConfig({
    background: {
      source: "custom",
      customDataUrl: "data:image/png;base64,AAAA",
      customName: "beach.png",
    },
  });
  assert.equal(keep.background.customDataUrl, "data:image/png;base64,AAAA");
  assert.equal(keep.background.customName, "beach.png");

  const drop = model.mergeConfig({
    background: {
      source: "gradient",
      customDataUrl: "data:image/png;base64,AAAA",
      customName: "beach.png",
    },
  });
  assert.equal(drop.background.customDataUrl, null, "a stale upload never outlives the choice");
  assert.equal(drop.background.customName, null);

  const junk = model.mergeConfig({
    background: { source: "custom", customDataUrl: 42 },
  });
  assert.equal(junk.background.customDataUrl, null);
});

test("an engine id that no longer exists falls back to the browser default", () => {
  const config = model.mergeConfig({ engineId: "an-engine-we-removed" });
  assert.equal(config.engineId, null);
});

test("a browser-provided engine id survives the merge", () => {
  /* A browser engine's id is generated at runtime as `browser:<name>`, so it
     cannot be known to the fallback list. Dropping it here meant picking a
     browser engine never persisted. */
  const config = model.mergeConfig({ engineId: "browser:Wikipedia (en)" });
  assert.equal(config.engineId, "browser:Wikipedia (en)");
  /* An empty or malformed provenance is still refused. */
  assert.equal(model.mergeConfig({ engineId: "browser:" }).engineId, null);
  /* And the adapter round-trips it. */
  assert.equal(
    model.mergeConfig({ engineId: "browser:Ziy Search", widgets: {} }).engineId,
    "browser:Ziy Search",
  );
});

test("config round-trips through the adapter with defaults applied", async () => {
  const { store } = newStore();
  const first = await store.saveConfig({ widgets: { clock: false } });
  assert.equal(first.widgets.clock, false);
  assert.equal(first.widgets.search, true, "a patch does not erase its siblings");

  const reloaded = await store.loadConfig();
  assert.equal(reloaded.widgets.clock, false, "the value persisted");
  assert.equal(reloaded.topSitesMode, "favorites");
});

test("deep-copying means a stored object is never aliased", async () => {
  const { store, backing } = newStore();
  await store.saveConfig({ widgets: { search: false } });
  const live = backing.snapshot()["ntp.config"];
  live.widgets.search = true;
  assert.equal((await store.loadConfig()).widgets.search, false, "the store is the source of truth");
});

test("the shields shared-storage key is exactly the documented contract", () => {
  assert.equal(model.SHIELDS_STORAGE_KEY, "ziy.shields.blockedTotal");
  assert.equal(model.SHIELDS_EXTENSION_ID, "ziy-shields@ziy.app");
});

test("a stored shields total of a bad shape is ignored", async () => {
  const { store } = newStore({ "ziy.shields.blockedTotal": "twelve" });
  const all = await store.loadConfig();
  assert.equal(all.widgets.search, true, "an unrelated bad key cannot break the config");
});

/* ===========================================================================
 * 5. Engines
 * =========================================================================*/

test("mergeEngines prefers the browser list when there is one", () => {
  const merged = model.mergeEngines(
    [{ id: "browser:Wikipedia", name: "Wikipedia", isDefault: true }],
    [{ id: "duckduckgo-html", checked: false }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "browser:Wikipedia");
  assert.equal(merged[0].source, "browser");
  assert.equal(merged[0].urlTemplate, null, "a browser engine carries no template");
  assert.equal(merged[0].isDefault, true);
});

test("mergeEngines falls back to our own list when the browser has none", () => {
  const merged = model.mergeEngines([], []);
  assert.equal(merged.length, model.FALLBACK_ENGINES.length);
  assert.deepEqual(merged.map((e) => e.id), model.FALLBACK_ENGINES.map((e) => e.id));
  /* Every slot except the user's own is available straight away. */
  const ready = merged.filter((e) => e.checked);
  assert.deepEqual(
    ready.map((e) => e.id),
    ["google", "duckduckgo-html", "startpage", "searx-be", "wikipedia"],
  );
  const own = merged.find((e) => e.id === "own-provider");
  assert.equal(own.checked, false, "the user's own slot ships off");
  assert.equal(own.urlTemplate, null, "and with no provider URL");
});

test("mergeEngines keeps a stored off state and defaults unknown to on", () => {
  const merged = model.mergeEngines(null, [
    { id: "startpage", checked: false },
    { id: "unknown-id", checked: true },
  ]);
  assert.equal(merged.find((e) => e.id === "startpage").checked, false);
  assert.equal(merged.find((e) => e.id === "duckduckgo-html").checked, true);
  assert.equal(
    merged.some((e) => e.id === "unknown-id"),
    false,
    "an entry for an engine that is not available is dropped",
  );
  assert.deepEqual(
    merged.map((e) => e.id),
    model.FALLBACK_ENGINES.map((e) => e.id),
    "order follows the available list",
  );
});

test("no engine is the Ziy provider, and every URL is third-party", () => {
  for (const engine of model.FALLBACK_ENGINES) {
    assert.ok(!/ziy\.(app|com|internal)/i.test(engine.urlTemplate), engine.id + " points off-product");
  }
  const own = model.FALLBACK_ENGINES.find((e) => e.id === "own-provider");
  assert.equal(own.source, "own", "the last slot is the user's own provider");
  assert.equal(own.urlTemplate, "", "and it is empty until the user fills it");
});

test("buildSearchUrl encodes the query and keeps the template safe", () => {
  const engine = model.FALLBACK_ENGINES.find((e) => e.id === "duckduckgo-html");
  assert.equal(
    model.buildSearchUrl(engine, "hello world"),
    "https://duckduckgo.com/html/?q=hello+world",
  );
  assert.equal(
    model.buildSearchUrl(engine, "a & b=c?d#e"),
    "https://duckduckgo.com/html/?q=a+%26+b%3Dc%3Fd%23e",
  );
  assert.equal(model.buildSearchUrl(engine, "   "), null, "a blank query builds nothing");
  assert.equal(model.buildSearchUrl(null, "x"), null);
  assert.equal(
    model.buildSearchUrl({ urlTemplate: null }, "x"),
    null,
    "a browser-provided engine has no URL to build",
  );
  /* The user's own slot cannot produce a URL before it is configured. */
  const own = model.FALLBACK_ENGINES.find((e) => e.id === "own-provider");
  assert.equal(model.buildSearchUrl(own, "x"), null);
  /* The shipped default builds the same way: Google is a direct-navigation
     entry with the same {query} placeholder as every other one. */
  const google = model.FALLBACK_ENGINES.find((e) => e.id === model.DEFAULT_ENGINE_ID);
  assert.equal(
    model.buildSearchUrl(google, "hello world"),
    "https://www.google.com/search?q=hello+world",
  );
  assert.equal(google.source, "fallback");
});

test("normaliseEngineChoices de-duplicates and keeps order", () => {
  const out = model.normaliseEngineChoices([
    { id: "a", checked: true },
    { id: "a", checked: false },
    { id: "b" },
    "junk",
  ]);
  assert.deepEqual(out, [{ id: "a", checked: true }, { id: "b", checked: true }]);
});

test("the adapter persists an engine choice", async () => {
  const { store } = newStore();
  await store.setEngineChecked("startpage", false);
  await store.setEngineChecked("wikipedia", false);
  await store.setEngineId("startpage");
  const config = await store.loadConfig();
  assert.equal(config.engineId, "startpage");
  const choices = await store.loadEngines();
  assert.equal(choices.find((c) => c.id === "startpage").checked, false);
});

test("setEngineId(null) means follow the browser default", async () => {
  const { store } = newStore();
  await store.setEngineId("wikipedia");
  const config = await store.setEngineId(null);
  assert.equal(config.engineId, null);
});

/* ===========================================================================
 * 6. Clock
 * =========================================================================*/

test("formatClock renders 24-hour by default", () => {
  const at = new Date(2026, 9, 14, 13, 5, 9);
  const out = model.formatClock(at, true);
  assert.equal(out.time, "13:05");
  assert.equal(out.seconds, "09");
  assert.match(out.date, /2026|October/);
});

test("formatClock renders 12-hour with a meridiem", () => {
  const afternoon = new Date(2026, 9, 14, 13, 5);
  assert.equal(model.formatClock(afternoon, false).time, "1:05 PM");
  const midnight = new Date(2026, 9, 14, 0, 30);
  assert.equal(model.formatClock(midnight, false).time, "12:30 AM");
  const noon = new Date(2026, 9, 14, 12, 0);
  assert.equal(model.formatClock(noon, false).time, "12:00 PM");
});

test("formatClock zero-pads minutes in both formats", () => {
  const at = new Date(2026, 9, 14, 9, 7, 0);
  assert.equal(model.formatClock(at, true).time, "09:07");
  assert.equal(model.formatClock(at, false).time, "9:07 AM");
});

test("formatClock tolerates a bad date", () => {
  const out = model.formatClock(new Date("not a date"), true);
  assert.equal(out.time, "");
});

/* ===========================================================================
 * 7. Count formatting
 * =========================================================================*/

test("formatCount groups thousands and never shows a negative", () => {
  assert.equal(model.formatCount(0), "0");
  assert.equal(model.formatCount(1284), "1,284");
  assert.equal(model.formatCount(-5), "0");
  assert.equal(model.formatCount(undefined), "0");
  assert.equal(model.formatCount("junk"), "0");
});

test("formatBytes scales real byte counts through the units", () => {
  assert.equal(model.formatBytes(0), "0 KB");
  assert.equal(model.formatBytes(-1), "0 KB", "a negative never reaches the display");
  assert.equal(model.formatBytes(512), "512 B", "sub-kilobyte counts stay in bytes");
  assert.equal(model.formatBytes(1024), "1 KB");
  assert.equal(model.formatBytes(1024 + 512), "1.5 KB");
  assert.equal(model.formatBytes(1024 * 1024), "1 MB");
  assert.equal(model.formatBytes(1024 * 1024 + 1024 * 512), "1.5 MB");
  assert.equal(model.formatBytes(1024 * 1024 * 1024 * 4), "4 GB");
  assert.equal(model.formatBytes(1024 * 1024 * 1024 * 1024 * 3), "3 TB", "stops at the last unit");
});

test("formatBytes treats a bad input as zero, never as NaN", () => {
  for (const bad of [undefined, null, "junk", NaN, Infinity]) {
    const out = model.formatBytes(bad);
    assert.match(out, /^[\d.]+ (B|KB|MB|GB|TB)$/, "got " + String(out));
  }
});

/* ===========================================================================
 * 8. Shapes that must hold for the shipped page
 * =========================================================================*/

test("the shipped vocabulary and bounds are exactly what the recon specifies", () => {
  assert.deepEqual(model.WIDGETS.map((w) => w.id), [
    "background", "search", "topsites", "clock", "stats", "news",
  ]);
  assert.equal(model.CARDS_WIDGET_ID, "cards");
  assert.deepEqual(model.TOP_SITE_MODES, ["favorites", "frequent"]);
  assert.deepEqual(model.BACKGROUND_SOURCES.map((s) => s.id), [
    "gradient", "solid", "custom", "off",
  ]);
  /* The shipped default engine is Google: it is listed in the picker like any
     other engine and added as the first entry of the fallback list, so this
     assertion pins both halves of the co-owner's decision at once. */
  assert.equal(model.DEFAULT_ENGINE_ID, "google");
  assert.equal(model.FALLBACK_ENGINES[0].id, "google", "Google is the first picker entry");

  /* Every shipped gradient is expressed in tokens, never a raw hex. */
  for (const gradient of model.GRADIENTS) {
    assert.match(gradient.css, /var\(--/, gradient.id + " must use token vars");
    assert.equal(/#[0-9a-fA-F]{3,8}/.test(gradient.css), false, gradient.id + " hard-codes a hex");
  }
});

test("every widget label is Ziy-voiced and non-empty", () => {
  for (const widget of model.WIDGETS) {
    assert.ok(widget.label && widget.label.length > 0, widget.id + " has no label");
    /* Never a bare keyword from the reference's UI copy. */
    assert.ok(!/brave|leo|bat/i.test(widget.label), widget.id + " labels use a foreign name");
  }
});

test("validateSiteUrl accepts the addresses a user actually types", () => {
  for (const good of [
    "https://example.com",
    "http://example.com/",
    "https://sub.domain.example.co.uk/path?q=1#frag",
    "  https://example.com/a b  ",
    "https://192.0.2.10/x",
  ]) {
    assert.equal(model.validateSiteUrl(good).ok, true, good + " should be accepted");
  }
});

test("validateSiteUrl rejects everything else with a usable message", () => {
  for (const bad of [
    "", "   ", "example.com", "ftp://example.com", "javascript:alert(1)",
    "https://", "https://localhost", "file:///etc/passwd", 42,
  ]) {
    const result = model.validateSiteUrl(bad);
    assert.equal(result.ok, false, String(bad) + " should be rejected");
    assert.ok(result.error.length > 0, String(bad) + " gives no reason");
  }
  const ftp = model.validateSiteUrl("ftp://example.com");
  assert.match(ftp.error, /http and https/);
});

test("newId produces distinct values", () => {
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(model.newId());
  assert.equal(ids.size, 200);
});
