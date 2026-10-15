/* Ziy shields — the filter-list registry: the updatable, checksum-verified list
 * mechanism (recon S11, F06).
 *
 * The product shape (from the recon and the architecture):
 *   - seven default lists ship as a SNAPSHOT inside the extension so first run
 *     works offline — public filter lists are data, like a dictionary, and this
 *     is the documented way to make first-run work without a network
 *   - every list carries a source URL, an enable/disable flag, a SHA-256 of the
 *     last body we accepted, and a "last checked" timestamp
 *   - a background alarm re-checks the sources a few times a day; a list whose
 *     sha256 changed replaces its rules, one whose checksum matches does not
 *   - the user can add a custom list URL (F06) and toggle any list off (S11)
 *     without destroying its downloaded body, so re-enabling is instant
 *
 * Checksums are the whole reason a list update is safe to apply blind: the
 * source of a list is not the source of its *correctness*, but a digest gives
 * us an end-to-end integrity check on the transfer and lets us skip the
 * (expensive) recompile when nothing changed.
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * Loaded as a classic <script> in the shared global scope of the background
 * page, next to the other ziy-shields lib files, this file declares NOTHING
 * at the top level: the whole body lives inside the factory below. Defect D-2
 * was exactly this — a second top-level `const parseList` colliding with
 * parser.js made the engine discard the whole file, so the event page never
 * finished evaluating and every shields surface was dead. The API goes on the
 * shared `ziyShields` namespace and on module.exports for the unit tests.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  /* The shared namespace carries whatever earlier lib files merged into it.
   * Under node a require() starts from an empty root, so each dependency
   * arrives by name when already present, else through require() — which is
   * the same code the sibling extensions' libs use (see the UMD wrapper in
   * extensions/ziy-playlist/lib/classify.js and extensions/ziy-news/lib/[…]).
   * In the browser the manifest's load order already put them there. */
  if (!root.ziyShields) root.ziyShields = {};
  const ns = root.ziyShields;
  if (!ns.localGet && typeof require === "function") {
    Object.assign(ns, require("../engine/store.js"));
  }
  if (!ns.parseList && typeof require === "function") {
    Object.assign(ns, require("./parser.js"));
  }
  const api = factory(ns);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.STORAGE_KEY_LISTS = api.STORAGE_KEY_LISTS;
    exports.STORAGE_KEY_LISTS_INT = api.STORAGE_KEY_LISTS_INT;
    exports.DEFAULT_SOURCES = api.DEFAULT_SOURCES;
    exports.UPDATE_INTERVAL_MINUTES = api.UPDATE_INTERVAL_MINUTES;
    exports.ALARM_NAME = api.ALARM_NAME;
    exports.blankRecord = api.blankRecord;
    exports.getRegistry = api.getRegistry;
    exports.saveRegistry = api.saveRegistry;
    exports.setListEnabled = api.setListEnabled;
    exports.addCustomList = api.addCustomList;
    exports.removeCustomList = api.removeCustomList;
    exports.sha256Hex = api.sha256Hex;
    exports.verifyDigest = api.verifyDigest;
    exports.fetchList = api.fetchList;
    exports.loadSnapshot = api.loadSnapshot;
    exports.resolveListBody = api.resolveListBody;
    exports.registerUpdateAlarm = api.registerUpdateAlarm;
  } else {
    root.ziyShields = Object.assign(root.ziyShields || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ns) {
  "use strict";

  /* The two dependencies arrive from the shared namespace, but NOT
   * necessarily at load time: manifest.json lists this file before
   * lib/engine/store.js, so store's API is not on the namespace yet when this
   * factory runs. They are therefore resolved at CALL time, through the
   * namespace, which is also what makes a direct require() in node work.
   * parseList follows the same rule for symmetry. */
  const getLocalGet = () => ns.localGet;
  const getLocalSet = () => ns.localSet;
  const getParseListMetadata = () => ns.parseListMetadata;

/* DEPENDENCY NOTE: localGet/localSet (store.js) and parseList/parseListMetadata
 * (parser.js) arrive through the shared ziyShields namespace, which this
 * factory receives as `ns`. That keeps the manifest's load order the only
 * ordering requirement, and it keeps this file free of top-level
 * declarations — see the wrapper header at the top of the file. */

const STORAGE_KEY_LISTS = 'shields.lists';
const STORAGE_KEY_LISTS_INT = 'shields.lists.internal';

/** Update cadence. Two windows a day: a scheduled 4h check. */
const UPDATE_INTERVAL_MINUTES = 240;

const ALARM_NAME = 'ziy-shields-list-update';

/* ------------------------------------------------------------------ *
 * The default sources
 * ------------------------------------------------------------------ */

/**
 * The three default lists. EasyList and EasyPrivacy are the canonical pair;
 * the third is the EasyList cookie-list (the cookie-consent banner rules),
 * mirrored at secure.fanboy.co.nz because easylist.to does not serve the
 * cookie list any more.
 *
 * Licences are recorded here and shipped in LICENSES; an update re-reads the
 * '! Licence:' header and keeps whatever the source says.
 */
const DEFAULT_SOURCES = Object.freeze([
  Object.freeze({
    id: 'easylist',
    name: 'EasyList',
    url: 'https://easylist.to/easylist/easylist.txt',
    enabled: true,
    isCustom: false,
    licence: 'GPL-3.0',
    licenceUrl: 'https://easylist.to/pages/licence.html',
    homepage: 'https://easylist.to/',
    description: 'The broad advert-blocking list. Blocks known ad servers, ad frames and ad placements.',
  }),
  Object.freeze({
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    enabled: true,
    isCustom: false,
    licence: 'GPL-3.0',
    licenceUrl: 'https://easylist.to/pages/licence.html',
    homepage: 'https://easylist.to/',
    description: 'The tracking-and-telemetry list. Blocks analytics, beacons and third-party trackers.',
  }),
  Object.freeze({
    id: 'easylist-cookie',
    name: 'EasyList Cookie List',
    url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
    enabled: true,
    isCustom: false,
    licence: 'CC-BY-3.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
    homepage: 'https://easylist.to/',
    description: 'Cookie-consent banners, cookie notices and the overlays that hide them.',
  }),
  /* The four lists below close the gap Brave's default stack reads about. See
   * replica/proofs-blocking-strength.md §2 for the before/after table and the
   * Brave-parity extraction each line is taken from. */
  Object.freeze({
    id: 'uabo-filters',
    name: 'uBlock Origin filters',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
    enabled: true,
    isCustom: false,
    licence: 'GPL-3.0',
    licenceUrl: 'https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE',
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    description: 'uBlock Origin\'s base filters. The upstream of Brave\'s default adblock list (re-deep-shields.md §4c source 1).',
  }),
  Object.freeze({
    id: 'urlhaus',
    name: 'URLhaus Malicious URL Blocklist',
    url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-agh-online.txt',
    enabled: true,
    isCustom: false,
    licence: 'CC0-1.0',
    licenceUrl: 'https://gitlab.com/malware-filter/urlhaus-filter#license',
    homepage: 'https://urlhaus.abuse.ch/',
    description: 'Live malicious-distribution URLs from abuse.ch. Ships inside Brave\'s default list (re-deep-shields.md §4c source 1).',
  }),
  Object.freeze({
    id: 'antiadblock-warning-removal',
    name: 'Adblock Warning Removal List',
    url: 'https://easylist-downloads.adblockplus.org/antiadblockfilters.txt',
    enabled: true,
    isCustom: false,
    licence: 'GPL-3.0',
    licenceUrl: 'https://easylist.to/pages/licence.html',
    homepage: 'https://github.com/easylist/antiadblockfilters',
    description: 'The anti-adblock list: hides the "please disable your ad blocker" walls and blocks the detector scripts that raise them.',
  }),
  Object.freeze({
    id: 'brave-unbreak',
    name: 'Brave Unbreak',
    url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-unbreak.txt',
    enabled: true,
    isCustom: false,
    licence: 'MPL-2.0',
    licenceUrl: 'https://www.mozilla.org/en-US/MPL/2.0/',
    homepage: 'https://github.com/brave/adblock-lists',
    description: 'Exceptions that repair sites the other lists break. Ships INSIDE Brave\'s default list, not as a separate allow-list (re-deep-shields.md §4c source 1).',
  }),
]);

/** Shape of one list record in storage.local `shields.lists`. */
function blankRecord(source) {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    enabled: source.enabled !== false,
    isCustom: source.isCustom === true,
    licence: source.licence,
    licenceUrl: source.licenceUrl,
    homepage: source.homepage,
    description: source.description || '',
    sha256: null,
    lastCheckedAt: 0,
    lastUpdatedAt: 0,
    ruleCount: 0,
    version: null,
    homepageFromHeader: null,
    error: null,
  };
}

/**
 * Returns the registry, creating it from DEFAULT_SOURCES the first time.
 * @returns {Promise<object>} a map id -> record
 */
async function getRegistry() {
  let reg = await getLocalGet()(STORAGE_KEY_LISTS, null);
  if (reg && typeof reg === 'object' && !Array.isArray(reg)) {
    // Add any source we have started shipping but the profile has not seen.
    let changed = false;
    for (const source of DEFAULT_SOURCES) {
      if (!reg[source.id]) { reg[source.id] = blankRecord(source); changed = true; }
    }
    if (changed) await getLocalSet()({ [STORAGE_KEY_LISTS]: reg });
    return reg;
  }
  reg = {};
  for (const source of DEFAULT_SOURCES) reg[source.id] = blankRecord(source);
  await getLocalSet()({ [STORAGE_KEY_LISTS]: reg });
  return reg;
}

async function saveRegistry(reg) {
  await getLocalSet()({ [STORAGE_KEY_LISTS]: reg });
}

/**
 * Enables or disables one list. A disabled list keeps its downloaded body, so
 * re-enabling does not re-download.
 */
async function setListEnabled(id, enabled) {
  const reg = await getRegistry();
  if (!reg[id]) throw new Error(`ziy-shields: unknown list ${id}`);
  reg[id].enabled = enabled === true;
  reg[id].error = null;
  await saveRegistry(reg);
  return reg[id];
}

/** Adds a custom list (F06's "add custom URL"). */
async function addCustomList(id, name, url) {
  const reg = await getRegistry();
  if (reg[id]) throw new Error(`ziy-shields: list id ${id} already exists`);
  if (!/^https:\/\//i.test(url)) {
    throw new Error('ziy-shields: a custom list URL must be https');
  }
  const canonical = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (canonical === '') throw new Error('ziy-shields: a custom list id needs letters or digits');
  reg[canonical] = {
    ...blankRecord({ id: canonical, name: name || url, url, enabled: true, isCustom: true }),
    description: 'A list you added.',
  };
  await saveRegistry(reg);
  return reg[canonical];
}

async function removeCustomList(id) {
  const reg = await getRegistry();
  if (!reg[id]) throw new Error(`ziy-shields: unknown list ${id}`);
  if (reg[id].isCustom !== true) throw new Error('ziy-shields: a default list cannot be removed');
  delete reg[id];
  await saveRegistry(reg);
  return true;
}

/* ------------------------------------------------------------------ *
 * Checksums
 * ------------------------------------------------------------------ */

/**
 * SHA-256 of the list body, hex encoded. WebCrypto is the portable core: every
 * context we run in (event page, options page, worker) has crypto.subtle.
 * Returns null when it is unavailable, which the caller treats as "unknown
 * digest, do not claim a checksum".
 */
async function sha256Hex(text) {
  try {
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle)
      || (globalThis.crypto && globalThis.crypto.subtle);
    if (!subtle) return null;
    const bytes = new TextEncoder().encode(text);
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (e) {
    return null;
  }
}

/**
 * Verifies a digest against a fetched body, when we have one to compare with.
 * A list record with sha256 = null is "never verified"; a record with a sha256
 * is verified against the last accepted body by the update path.
 */
async function verifyDigest(text, expected) {
  if (!expected) return { ok: true, reason: 'no-digest-on-record' };
  const actual = await sha256Hex(text);
  if (actual === null) return { ok: true, reason: 'digest-unavailable' };
  return { ok: actual === expected, reason: actual === expected ? 'match' : 'mismatch', actual };
}

/* ------------------------------------------------------------------ *
 * Fetching, with the bundled snapshot as the offline fallback
 * ------------------------------------------------------------------ */

const SNAPSHOT_BASE = 'lib/filterlist/snapshots';

/**
 * Fetches a list over https. On failure, or when a list is disabled, the caller
 * falls back to the bundled snapshot.
 */
async function fetchList(url, { timeoutMs = 45000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Loads the snapshot bundled in the extension. */
async function loadSnapshot(id) {
  const b = (typeof browser !== 'undefined' ? browser : chrome);
  const url = b.runtime.getURL(`${SNAPSHOT_BASE}/${id}.txt`);
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`snapshot ${id}: HTTP ${res.status}`);
  return await res.text();
}

/**
 * Gets the body to use for a list: the fetched body when the list is enabled
 * and reachable, otherwise the bundled snapshot. Records the digest either way.
 *
 * @returns {Promise<{text: string, meta: object, from: 'network'|'snapshot', digest: string|null, changed: boolean}>}
 */
async function resolveListBody(record) {
  if (record.enabled !== false) {
    try {
      const text = await fetchList(record.url);
      const digest = await sha256Hex(text);
      const meta = getParseListMetadata()(text);
      return { text, meta, from: 'network', digest, changed: !!record.sha256 && record.sha256 !== digest };
    } catch (e) {
      // fall through to the snapshot: first-run and any offline session still
      // have to work.
    }
  }
  const text = await loadSnapshot(record.id);
  const digest = await sha256Hex(text);
  const meta = getParseListMetadata()(text);
  return { text, meta, from: 'snapshot', digest, changed: !!record.sha256 && record.sha256 !== digest };
}

/* ------------------------------------------------------------------ *
 * The update scheduler
 * ------------------------------------------------------------------ */

function registerUpdateAlarm(api) {
  const b = api || (typeof browser !== 'undefined' ? browser : chrome);
  if (!b.alarms) return;
  b.alarms.create(ALARM_NAME, {
    periodInMinutes: UPDATE_INTERVAL_MINUTES,
    delayInMinutes: UPDATE_INTERVAL_MINUTES,
  });
}

  return {
    STORAGE_KEY_LISTS,
    STORAGE_KEY_LISTS_INT,
    DEFAULT_SOURCES,
    UPDATE_INTERVAL_MINUTES,
    ALARM_NAME,
    blankRecord,
    getRegistry,
    saveRegistry,
    setListEnabled,
    addCustomList,
    removeCustomList,
    sha256Hex,
    verifyDigest,
    fetchList,
    loadSnapshot,
    resolveListBody,
    registerUpdateAlarm,
  };
});
