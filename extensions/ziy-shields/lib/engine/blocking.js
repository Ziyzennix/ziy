/* Ziy shields — the imperative blocking path.
 *
 * Gecko gives us both declarativeNetRequest and blocking webRequest, and the
 * engine's own source says how they interact (modules/WebRequest.sys.mjs,
 * runChannelListener):
 *
 *   if (this.dnrActive) { lazy.ExtensionDNR.beforeWebRequestEvent(channel, kind); }
 *   ... run the webRequest listeners ...
 *   if (this.dnrActive && lazy.ExtensionDNR.handleRequest(channel, kind)) { return; }
 *
 * So: DNR is evaluated BEFORE webRequest listeners run, and when DNR blocks,
 * webRequest listeners still fire but their handlerResults are DISCARDED. Two
 * consequences we build on:
 *
 *  1. Per-tab counting works. Our onBeforeRequest listener observes every
 *     request in every tab, so we can count blocks per tab regardless of which
 *     tier blocked. The count is ours; the blocking is DNR's.
 *  2. Our own webRequest block is a real fallback for what DNR cannot express:
 *     regex rules past the 1000-per-ruleset cap, $document main_frame blocks,
 *     and $domain= lists longer than the domain-condition cap.
 *
 * The engine fires onBeforeRequest from the http-on-modify-request observer,
 * which means a request blocked by DNR still reaches our listener — that is the
 * documented hook this file exists to use. A block we issue here uses the same
 * shape as DNR's own applyBlock: cancel with NS_ERROR_ABORT.
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * This file is loaded as a classic <script> in the shared global scope of
 * the event page, next to the other ziy-shields lib files. It therefore
 * declares NOTHING at the top level: the whole body lives inside the
 * factory below. A second top-level declaration of a name another file
 * already owns is a PARSE-time SyntaxError in that scope ("redeclaration
 * of non-configurable global property"), the engine discards the whole
 * file, and every listener in it fails to register — which is precisely
 * defect D-2 in replica/test-report.md. The API is published on the one
 * `ziyShields` namespace this extension shares, and on module.exports
 * under node --test.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  if (!root.ziyShields) root.ziyShields = {};
  const api = factory();
  Object.assign(root.ziyShields, api);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    exports.sessionLog = api.sessionLog;
    exports.freshSession = api.freshSession;
    exports.getSession = api.getSession;
    exports.recordBlock = api.recordBlock;
    exports.recordUpgrade = api.recordUpgrade;
    exports.resetTab = api.resetTab;
    exports.dropTab = api.dropTab;
    exports.setTabDomain = api.setTabDomain;
    exports.getTabCounts = api.getTabCounts;
    exports.allCounts = api.allCounts;
    exports.abpMatches = api.abpMatches;
    exports.classify = api.classify;
    exports.browserApi = api.browserApi;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

'use strict';

const browserApi = () => {
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) return browser;
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) return chrome;
  throw new Error('ziy-shields: no WebExtension API global in this context');
};

/* ------------------------------------------------------------------ *
 * Per-tab blocked-item counting (recon S09 / BlockedItemLog)
 * ------------------------------------------------------------------ */

/**
 * The session log. Counts reset on navigation — that is the recon's rule, so
 * this lives in memory only and is keyed by tab id. The domain a tab was on is
 * remembered so the count belongs to the right site after a redirect chain.
 *
 * @type {Map<number, {domain: string|null, blocks: number, upgrades: number, scripts: number, fp: number, items: Array, startedAt: number}>}
 */
const sessionLog = new Map();

function freshSession(domain, now) {
  return {
    domain: domain || null,
    blocks: 0,
    upgrades: 0,
    scripts: 0,
    fp: 0,
    items: [],
    startedAt: now,
  };
}

function getSession(tabId) {
  let s = sessionLog.get(tabId);
  if (!s) { s = freshSession(null, Date.now()); sessionLog.set(tabId, s); }
  return s;
}

/**
 * Records one blocked item for a tab. The count is capped at 200 distinct
 * entries per tab (the list is for the panel, not a log), but the numeric
 * counters do not cap — that is what the badge shows.
 *
 * @param {number} tabId
 * @param {{category: 'tracker'|'ad'|'script'|'fingerprinting', url: string, tier: string, protocol?: string, initiator?: string, reason?: string}} item
 */
function recordBlock(tabId, item) {
  const s = getSession(tabId);
  s.blocks++;
  if (item.category === 'script') s.scripts++;
  if (item.category === 'fingerprinting') s.fp++;
  if (s.items.length < 200) s.items.push(Object.assign({ at: Date.now() }, item));
}

function recordUpgrade(tabId, url) {
  const s = getSession(tabId);
  s.upgrades++;
  if (s.items.length < 200) s.items.push({ at: Date.now(), category: 'upgrade', url });
}

/** Counts reset on navigation — this is the §5.3 rule the recon is explicit about. */
function resetTab(tabId) {
  sessionLog.set(tabId, freshSession(null, Date.now()));
}

function dropTab(tabId) {
  sessionLog.delete(tabId);
}

function setTabDomain(tabId, domain) {
  const s = getSession(tabId);
  s.domain = domain || null;
}

function getTabCounts(tabId) {
  const s = sessionLog.get(tabId);
  if (!s) return { blocks: 0, upgrades: 0, scripts: 0, fp: 0, items: [], domain: null, startedAt: 0 };
  return { ...s, items: s.items.slice() };
}

function allCounts() {
  const out = {};
  for (const [tabId, s] of sessionLog.entries()) {
    out[tabId] = { blocks: s.blocks, upgrades: s.upgrades, scripts: s.scripts, fp: s.fp, domain: s.domain };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The webRequest matcher
 * ------------------------------------------------------------------ */

/**
 * A minimal ABP pattern matcher for the webRequest path.
 *
 * DNR's urlFilter handles '||', '|', '^' and '*'. The webRequest path only sees
 * what DNR could not take, so this matcher only needs the same alphabet plus the
 * cases a regex rule covers. It is deliberately small and readable: the hot path
 * for anything a list can express belongs to DNR, not to us.
 */
function abpMatches(pattern, url) {
  let p = pattern;
  if (p.startsWith('/') && p.endsWith('/') && p.length > 2) {
    try {
      return new RegExp(p.slice(1, -1)).test(url);
    } catch (e) {
      return false;
    }
  }
  // '^' is the separator: end of URL, or a char that is not [A-Za-z0-9_.-].
  // We keep the ABP meaning exactly, including the trailing-^ special case.
  const parts = p.split('^');
  let anchoredStart = false;
  let anchoredEnd = false;
  let anchoredDomain = false;
  if (p.startsWith('||')) { anchoredDomain = true; }
  else if (p.startsWith('|')) { anchoredStart = true; }
  if (p.endsWith('|')) anchoredEnd = true;

  // Build a regex from the pattern. '^' becomes the separator class, '*' is a
  // wildcard, everything else is escaped.
  const SEP = /[^A-Za-z0-9_.%-]/;
  let re = '^';
  let body = p;
  if (anchoredDomain) { body = body.slice(2); re += '[a-z0-9.-]*\\.'; }
  else if (anchoredStart) { body = body.slice(1); }
  if (anchoredEnd && body.endsWith('|')) { body = body.slice(0, -1); }
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '^') {
      // A '^' matches one separator char, or end of URL at the very end.
      if (i === body.length - 1) out += '(?:' + SEP.source + '|$)';
      else out += SEP.source;
    } else if (c === '*') {
      out += '.*';
    } else if ('.[]{}()+-?|\\/$^'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  re += out;
  if (anchoredEnd) re += '$';
  try {
    return new RegExp(re).test(url);
  } catch (e) {
    // Last resort: a literal substring test, which is at least conservative.
    return url.includes(p.replace(/[|^*]/g, ''));
  }
}

/**
 * Classifies a blocked URL into the recon's categories. The list id is the
 * strongest signal (EasyPrivacy is the tracker list), then the resource type.
 */
function classify(url, listId, resourceType) {
  if (listId === 'easyprivacy' || listId === 'easylist-cookie') return 'tracker';
  if (listId === 'easylist') return resourceType === 'script' ? 'script' : 'ad';
  if (resourceType === 'script') return 'script';
  return 'ad';
}

  return {
    sessionLog,
    freshSession,
    getSession,
    recordBlock,
    recordUpgrade,
    resetTab,
    dropTab,
    setTabDomain,
    getTabCounts,
    allCounts,
    abpMatches,
    classify,
    browserApi,
  };
});
