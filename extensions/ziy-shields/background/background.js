/* Ziy shields — the background event page (architecture §8: background/).
 *
 * Manifest V3 with background.scripts (an EVENT PAGE, not a service worker):
 * Gecko 156 does not implement background.service_worker (Firefox bug 1573659),
 * so the cross-browser recipe — declare both, let Gecko run the scripts form —
 * is what the manifest does. On Gecko the page suspends when idle and restarts
 * on an event, so every listener here is registered at the top level (never
 * inside an async bootstrap) and the DNR rules are rebuilt idempotently on
 * startup.
 *
 * This file wires the four pieces:
 *   1. the rule pipeline: parse the lists, compile, install into DNR
 *   2. the per-tab block counter (webRequest observer, counts only)
 *   3. the Shields state resolver and the sites/dnrmessages the UI uses
 *   4. the list update alarm
 */

'use strict';

/* The lib files are loaded as classic scripts ahead of this one in the
 * manifest's background.scripts list, and they all merge into the shared
 * `ziyShields` global. Gecko's event page has no require(); this keeps one copy
 * of each module in memory and lets the same files run under plain node (where
 * they merge into the same global) for the unit tests.
 *
 * THE ONE-GLOBAL CONTRACT, and why it is not optional: the engine writes every
 * entry of background.scripts[] as a plain <script> into ONE generated HTML
 * document (toolkit/components/extensions/WebExtensionPolicy.cpp,
 * `BackgroundPageHTML()`), so all of these files share one window scope and
 * any top-level duplicate declaration is a parse-time SyntaxError that
 * discards the file. That is defect D-2 in replica/test-report.md, and it is why
 * every lib file now declares nothing at the top level: each is a UMD IIFE that
 * merges its API into `globalThis.ziyShields` and only assigns `module.exports`
 * when a module object exists. The rule is recorded at the top of each lib file
 * and in replica/proofs-fix-events.md §2. */
const lib = globalThis.ziyShields || {};
const parser = lib;
const lists = lib;
const dnrCompile = lib;
const precedence = lib;
const store = lib;
const blocking = lib;
const cosmetic = lib;
const spotifyAdSlot = lib;

/* ------------------------------------------------------------------ *
 * The WebExtension API shim.
 * The popup and the options page each load this file's modules directly, but
 * the event page must run under the manifest's script scope, where `browser`
 * is available. We resolve it once and pass it around rather than depending on
 * a global in library code, so the same modules run under plain node in tests.
 * ------------------------------------------------------------------ */
const api = blocking.browserApi ? blocking.browserApi()
  : (typeof browser !== 'undefined' ? browser : chrome);

const RULESET_STATIC_ID = 'ziy-shields-lists';
const STATIC_RULE_PATH = 'rules/static-ruleset.json';

/* Per-site override rule ids start well above the static ruleset's ids (which
 * are dense from 1) so the two sets never collide when the engine compares
 * them, and stay far below the session tier's 1,000,000 priority band. */
const DNR_SITE_RULE_ID_BASE = 2000000;

/* ------------------------------------------------------------------ *
 * In-memory compiled state
 * ------------------------------------------------------------------ */

/** All parsed network rules from the enabled lists, with their list ids. */
let compiledNetwork = [];
/** Cosmetic entries from the enabled lists. */
let compiledCosmetic = [];
/** webRequest residuals (what DNR could not express). */
let webRequestRules = [];
/** The domain index over the webRequest residual, rebuilt with the table. */
let residualIndex = null;
let residualShape = null;

/** Per-site ABSOLUTE rules: domain -> parsed rule objects ready to compile. */
const siteOverrideRules = new Map();
/** How many DNR rules are installed in each tier. */
const installState = { static: 0, dynamic: 0, session: 0, webRequest: 0, staticRules: 0, staticCounting: false };

/**
 * The STATIC ruleset as the engine loaded it, for counting.
 * `fetch()`-loaded at startup from the file the manifest's
 * declarative_net_request.rule_resources entry names, then indexed. This is the
 * SAME table the engine evaluates (it is the build artifact, not a recompile),
 * which is what makes the count a measurement of the engine's own decisions
 * rather than a guess about them.
 * @type {{index: object, unanchored: Array, count: number}|null}
 */
let staticRulesetIndex = null;
/** Set once the ruleset fetch has failed, so it is not retried per request. */
let staticRulesetUnavailable = false;

/**
 * The list id a static rule's priority band stands for. The static tier is a
 * build artifact compiled from EasyList/EasyPrivacy/Fanboy, so a rule id names
 * a ROW of that compilation, not a list. The engine's own priority band is the
 * honest signal for classification: 500 is ABP's !important, 100 is an
 * exception (@@), and 10 an ordinary block. classify() takes a list id, so the
 * band is passed through it rather than inventing a list name.
 */
function staticListIdFor(rule) {
  if (!rule) return null;
  const priority = rule.priority || 0;
  if (priority >= 500) return 'important';
  if (priority >= 100) return 'exception';
  return 'static';
}

let initPromise = null;

/* ------------------------------------------------------------------ *
 * Pipeline
 * ------------------------------------------------------------------ */

/**
 * Reads the enabled list registry, fetches or falls back to the snapshot,
 * parses, compiles and installs. Called on install, on update and on any list
 * toggle. Every run is idempotent: the static ruleset is rebuilt from scratch
 * (one file), and the dynamic tier is cleared then rewritten.
 */
async function rebuildAll() {
  const registry = await lists.getRegistry();

  const bodies = [];
  for (const record of Object.values(registry)) {
    if (record.enabled === false) continue;
    const body = await lists.resolveListBody(record);
    const parsed = parser.parseList(body.text, record.id);

    // Record the digest and the count so the panel can show "2.1 M rules from
    // three lists, checked 4 hours ago" without re-parsing anything.
    record.sha256 = body.digest;
    record.ruleCount = parsed.stats.network;
    record.lastUpdatedAt = Date.now();
    record.lastCheckedAt = Date.now();
    record.version = body.meta && (body.meta.version || body.meta['last-modified']) || null;
    record.homepageFromHeader = body.meta && body.meta.homepage || null;
    record.error = null;

    for (const rule of parsed.rules) {
      if (rule.kind === 'network') compiledNetwork.push(rule);
      else compiledCosmetic.push(cosmetic.makeEntry(
        rule.domains.length === 1 ? rule.domains[0] : rule.domains[0],
        rule.selector,
        rule.isException,
        Date.now(),
      ));
      // A domain-scoped cosmetic rule produces one entry per domain in its list.
      if (rule.kind === 'cosmetic' && rule.domains.length > 1) {
        for (const d of rule.domains) {
          compiledCosmetic.push(cosmetic.makeEntry(d, rule.selector, rule.isException, Date.now()));
        }
      }
    }
    bodies.push(record.id);
  }
  await lists.saveRegistry(registry);

  await Promise.all([installIntoDNR(), loadStaticRulesetIndex()]);
  await persistCosmeticTable();
  return { lists: bodies, networkRules: compiledNetwork.length };
}

/** Compiles and installs the static and dynamic tiers. */
async function installIntoDNR() {
  // 1. static tier: one ruleset file, enabled from the manifest.
  const compiled = dnrCompile.compileTable({
    networkRules: compiledNetwork,
    siteOverrides: [...siteOverrideRules.values()].flatMap(v => v),
  });
  installState.static = compiled.tiers.static.length;
  installState.dynamic = compiled.tiers.dynamic.length;
  webRequestRules = compiled.webRequest;
  installState.webRequest = webRequestRules.length;
  residualIndex = lib.buildIndex ? lib.buildIndex(webRequestRules) : null;
  residualShape = lib.describe ? lib.describe(residualIndex) : null;

  // The STATIC table is not written here at all: it is generated at build time
  // into extensions/ziy-shields/rules/static-ruleset.json and SHIPPED INSIDE the
  // xpi as the manifest's declarative_net_request.rule_resources entry. The
  // engine loads it from the package — that is the only tier that scales to
  // 10^5 rules, and it is why the 5000-rule dynamic budget is left for per-site
  // overrides rather than the bulk table. Nothing is serialised into
  // storage.local here: the compiled table is a build artifact, not state.

  // 2. dynamic tier: the per-site overrides.
  const dyn = [...compiled.tiers.dynamic];
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: await currentDynamicIds(),
    addRules: dyn,
  });
  return { static: installState.static, dynamic: dyn.length, webRequest: webRequestRules.length };
}

async function currentDynamicIds() {
  const rules = await api.declarativeNetRequest.getDynamicRules();
  return rules.map(r => r.id);
}

/**
 * Compiles and installs the per-site overrides into the dynamic ruleset.
 * The dynamic tier is the right home for them: it persists across browser
 * sessions and extension updates (MDN declarativeNetRequest), and its 5000-rule
 * budget comfortably holds one or two rules per site the user has overridden.
 */
async function installSiteOverrides(overrides) {
  const compiled = dnrCompile.compileTable({
    networkRules: compiledNetwork,
    siteOverrides: overrides,
  });
  installState.dynamic = compiled.tiers.dynamic.length;
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: await currentDynamicIds(),
    addRules: compiled.tiers.dynamic,
  });
  return compiled.tiers.dynamic.length;
}

/**
 * Persists the cosmetic table into IndexedDB so the content script can read a
 * domain's selectors without asking the event page (which may be suspended).
 */
async function persistCosmeticTable() {
  await store.clearStore('elements');
  await store.putAll('elements', compiledCosmetic);
}

/* ------------------------------------------------------------------ *
 * Per-site override
 * ------------------------------------------------------------------ */

/**
 * Writes an ABSOLUTE per-site rule. §5.3's rule: "a per-site override is never
 * rewritten by a later global change — it is stored as an absolute rule, not a
 * diff." The resolver reads it back with the FACTORY default as its fill, which
 * is what makes that true.
 */
async function setSiteRule(domain, patch) {
  if (!precedence.isDomain(domain)) throw new Error(`ziy-shields: not a domain: ${domain}`);
  const stored = await store.localGet(precedence.siteKey(domain), null) || {};
  // The stored record is the user's OWN choices, never a diff against global and
  // never a factory-expanded rule. That is what §5.3's "a per-site override is
  // never rewritten by a later global change" means in practice: the resolver
  // sees only the rows this site actually chose.
  const absolute = precedence.compactRule(Object.assign({}, stored, patch));
  await store.localSet({ [precedence.siteKey(domain)]: absolute });
  // The compiled per-site DNR rules depend on the absolute rule, so refresh.
  await refreshSiteOverrides();
  return absolute;
}

/** Clears one site's override, restoring global inheritance. */
async function clearSiteRule(domain) {
  await store.localRemove(precedence.siteKey(domain));
  await refreshSiteOverrides();
  return true;
}

/**
 * Loads the shipped static ruleset and indexes it.
 *
 * WHY fetch() AND NOT require(): this file runs in the event page, where there
 * is no require(); the ruleset file is the one the manifest's
 * `declarative_net_request.rule_resources` entry names, so the URL is the
 * extension's own. The engine has already parsed the same file to install the
 * tier, so reading it costs one file read at startup and nothing per request.
 *
 * A failure is not fatal: without the index the static tier simply does not
 * contribute to the count (which is exactly the pre-D-7-fix behaviour), so the
 * add-on degrades to the residual count rather than to a crash. `counted` is
 * echoed in installState so the panel can tell the two situations apart.
 */
async function loadStaticRulesetIndex() {
  if (staticRulesetIndex || staticRulesetUnavailable) return staticRulesetIndex;
  try {
    const response = await fetch(api.runtime.getURL(STATIC_RULE_PATH));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rules = await response.json();
    if (!Array.isArray(rules) || !rules.length) throw new Error('empty ruleset');
    staticRulesetIndex = lib.buildStaticIndex
      ? lib.buildStaticIndex(rules)
      : null;
    installState.staticRules = rules.length;
    installState.staticCounting = staticRulesetIndex !== null;
    return staticRulesetIndex;
  } catch (e) {
    staticRulesetUnavailable = true;
    installState.staticRules = 0;
    return null;
  }
}

/**
 * Would the static ruleset stop this request? Returns the winning block rule,
 * or null. Counting only — it never cancels anything. See the note in the
 * onBeforeRequest listener and the header of lib/engine/static-match.js for
 * why this is the honest measurement available on this engine.
 */
function staticWinnerForRequest(request) {
  if (!staticRulesetIndex) return null;
  const candidates = lib.staticCandidates
    ? lib.staticCandidates(staticRulesetIndex, request.url)
    : [];
  if (!candidates.length) return null;
  return lib.staticWinnerFor(candidates, request);
}

/**
 * Rebuild the per-site DNR overrides from storage and install them into the
 * DYNAMIC ruleset — the one tier whose budget (5000) is sized for exactly this:
 * a handful of rules per site the user has actually visited.
 *
 * Only rows that DIFFER from the factory default need a rule, because the
 * static ruleset already encodes the factory position for everything:
 *   sites+ads 'off'          -> an ALLOW for everything from that initiator
 *                               (out-prioritises every static block)
 *   scripts 'allow'          -> an ALLOW restricted to resourceTypes:['script']
 *   httpsUpgrade 'strict'    -> a static upgradeScheme rule already covers
 *                               'auto'; 'strict' is the shell's pref, not DNR's
 * The full §5.3 precedence model still runs in resolve() for the panel, so the
 * DNR layer is a projection of it, never a second source of truth.
 */
async function refreshSiteOverrides() {
  const all = await api.storage.local.get(null);
  const overrides = [];
  let id = DNR_SITE_RULE_ID_BASE;
  for (const key of Object.keys(all)) {
    if (!key.startsWith('shields.site.')) continue;
    const domain = key.slice('shields.site.'.length);
    const rule = all[key];
    if (!rule || typeof rule !== 'object') continue;

    // 'ads+trackers off' for this site: allow everything it initiates.
    if (rule.adsTrackers === 'off') {
      overrides.push({
        __action: 'allow',
        __dnrId: id++,
        kind: 'network',
        pattern: '*',
        isException: false,
        important: false,
        matchCase: false,
        resourceTypes: null,
        domain: { include: [domain], exclude: [] },
        thirdParty: null,
      });
    }
    // 'scripts allowed' for this site: allow scripts only, everything else
    // keeps being blocked by the static tier.
    if (rule.scripts === 'allow') {
      overrides.push({
        __action: 'allow',
        __dnrId: id++,
        kind: 'network',
        pattern: '*',
        isException: false,
        important: false,
        matchCase: false,
        resourceTypes: ['script'],
        domain: { include: [domain], exclude: [] },
        thirdParty: null,
      });
    }
  }
  siteOverrideRules.clear();
  await installSiteOverrides(overrides);
}

/* ------------------------------------------------------------------ *
 * webRequest listeners
 * ------------------------------------------------------------------ */

/**
 * The counting listener. Registered with "blocking" so it runs on the request
 * path, but we never issue a block from here for anything DNR already covers —
 * see the ordering note in lib/engine/blocking.js.
 *
 * The two tiers are counted here, in the order the ENGINE runs them
 * (WebRequest.sys.mjs, runChannelListener: DNR evaluation, then our listeners,
 * then handleRequest which discards our handlerResults when DNR blocked):
 *
 *   1. the STATIC ruleset (the 28 923-rule build artifact shipped in the xpi) —
 *      counted by re-evaluating the request against the same ruleset, in
 *      lib/engine/static-match.js. This is what closes D-7: the engine gives an
 *      extension no per-request "a rule matched" event (onRuleMatchedDebug is
 *      bug 1745773 and is not in this engine; getMatchedRules is bug 1745765 and
 *      is not either), and the one synchronous feedback API there is,
 *      testMatchOutcome, is gated behind extensions.dnr.feedback (default
 *      false) plus an optional permission that needs a user-gesture prompt.
 *      So the count is measured by us against the shipped ruleset. It NEVER
 *      blocks: by the time this listener runs, the engine has already applied
 *      the block and our handlerResults are discarded.
 *   2. the residual webRequest tier — the rules DNR could not express, which we
 *      really do block here.
 */
api.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const request = {
      url,
      type: details.type,
      initiator: details.documentUrl || null,
    };

    // 1. The static tier. Its winner is recorded with tier 'dnr' so the panel
    //    can say which engine stopped the request; the classification is the
    //    same one the residual path uses, with the ruleset's own priority band
    //    standing in for the list id (a static rule id names a build artifact
    //    row, not a list, so the priority band is the honest signal: 500 is an
    //    !important rule, 100 an exception, 10 an ordinary block).
    const staticWinner = staticWinnerForRequest(request);
    if (staticWinner) {
      blocking.recordBlock(details.tabId, {
        category: blocking.classify(url, staticListIdFor(staticWinner), details.type),
        url,
        tier: 'dnr',
        protocol: details.type,
        initiator: details.documentUrl || null,
        listId: staticListIdFor(staticWinner),
        reason: staticWinner.condition.urlFilter || staticWinner.condition.regexFilter || null,
        ruleId: staticWinner.id,
      });
      return undefined;
    }

    // 2. The residual webRequest tier: what the static ruleset could not carry.
    //    Which intensity a match belongs to is only knowable against the
    //    compiled table; DNR tells us nothing about what it did, so a request
    //    that is in our residual set is one we block ourselves.
    const hit = matchResidual(url, details.type);
    if (hit) {
      blocking.recordBlock(details.tabId, {
        category: blocking.classify(url, hit.listId, details.type),
        url,
        tier: 'webRequest',
        protocol: details.type,
        initiator: details.documentUrl || null,
        listId: hit.listId,
        reason: hit.pattern,
      });
      // A session override can only make the request go through earlier, never
      // later; DNR already had its turn.
      return { cancel: true };
    }
    return undefined;
  },
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'script', 'image', 'stylesheet',
    'object', 'object_subrequest', 'xmlhttprequest', 'ping', 'beacon', 'font', 'media',
    'websocket', 'csp_report', 'imageset', 'web_manifest', 'other'] },
  ['blocking'],
);

/** Counts navigation so the per-tab count resets on navigation (recon S09). */
api.webNavigation.onCommitted.addListener((details) => {
  blocking.resetTab(details.tabId);
  const host = safeHost(details.url);
  if (host) blocking.setTabDomain(details.tabId, host);
});

api.tabs.onRemoved.addListener((tabId) => blocking.dropTab(tabId));
api.tabs.onReplaced.addListener((added, removed) => { blocking.dropTab(added); blocking.dropTab(removed); });


/** The panel's figures: one combined count plus the two derived estimates. */
function tabCountsWithStats(tabId) {
  const raw = blocking.getTabCounts(tabId);
  const derived = lib.TabCounter
    ? null
    : null;
  // blocking.getTabCounts is the session log; the derived figures are computed
  // here rather than stored, so the counters stay per-tab and reset cleanly.
  const blocks = raw.blocks || 0;
  const items = raw.items || [];
  const kb = items.reduce((sum, i) => sum + (i.bytes || 0), 0) / 1024;
  const seconds = blocks * 0.03;
  return Object.assign({}, raw, { kb, seconds });
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return null; }
}

/**
 * Matches a URL against the residual rules DNR could not take. This is the
 * whole reason the webRequest path exists, and it is small on purpose: with the
 * static tier healthy the residual is a few hundred rules.
 */
function matchResidual(url, resourceType) {
  const host = safeHost(url);
  // The residual is indexed by domain because a linear scan of ~87k rules is
  // ~210 ms per request (measured) while the indexed path is ~0.15 ms.
  const candidates = residualIndex
    ? lib.candidates(residualIndex, url, host)
    : webRequestRules;
  for (const rule of candidates) {
    if (rule.resourceTypes && rule.resourceTypes.length) {
      const mapped = rule.resourceTypes.map(t => dnrCompile.ABP_TO_DNR_TYPE[t]).filter(Boolean);
      if (mapped.length && !mapped.includes(resourceType)) continue;
    }
    if (rule.domain && rule.domain.include && rule.domain.include.length) {
      const want = rule.domain.include;
      const hit = want.includes('*') || want.some(d => host === d || (host && host.endsWith('.' + d)));
      if (!hit) continue;
    }
    if (rule.domain && rule.domain.exclude && rule.domain.exclude.length) {
      const no = rule.domain.exclude.some(d => host === d || (host && host.endsWith('.' + d)));
      if (no) continue;
    }
    if (blocking.abpMatches(rule.pattern, url)) return rule;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Messaging (architecture §5.1)
 * ------------------------------------------------------------------ */

api.runtime.onMessage.addListener((message, sender) => {
  const send = (payload) => {
    if (api.runtime && api.runtime.sendMessage) {
      return Promise.resolve(api.runtime.sendMessage(payload));
    }
    return Promise.resolve(payload);
  };

  switch (message && message.op) {
    case 'shields.state': {
      const tabId = message.body && message.body.tabId;
      return resolveForTab(tabId, sender).then(state => ({ ok: true, state }));
    }
    case 'shields.setSite':
      return setSiteRule(message.body.domain, message.body.patch)
        .then(rule => ({ ok: true, rule }));
    case 'shields.clearSite':
      return clearSiteRule(message.body.domain).then(() => ({ ok: true }));
    case 'shields.counts':
      return Promise.resolve({ ok: true, counts: blocking.allCounts() });
    case 'shields.tabCounts':
      return Promise.resolve({ ok: true, counts: tabCountsWithStats(message.body.tabId) });
    case 'shields.rebuild':
      return rebuildAll().then(r => ({ ok: true, ...r }));
    case 'shields.installState':
      return Promise.resolve({ ok: true, state: installState });
    case 'shields.cosmetic':
      return cosmeticFor(message.body.host).then(c => ({ ok: true, cosmetic: c }));
    case 'shields.lists':
      return lists.getRegistry().then(registry => ({ ok: true, registry }));
    /* The Spotify ad-slot verdict. The fixture (and the player-side content
     * script) asks what the network tier would do with a URL, so the page's
     * state machine can model the player's real response to it. The answer for
     * an ad-delivery host is deliberately NOT a block: a block is what leaves
     * the player stalled in the ad slot. See lib/engine/spotify-adslot.js. */
    case 'shields.spotify.verdict': {
      const url = (message.body && message.body.url) || '';
      const verdict = spotifyAdSlot.createSlotTracker
        ? spotifyVerdictFor(url)
        : { action: 'unknown', reason: 'spotify-adslot absent' };
      return Promise.resolve({ ok: true, verdict });
    }
    case 'shields.listEnabled':
      return lists.setListEnabled(message.body.id, message.body.enabled)
        .then(() => rebuildAll().then(() => ({ ok: true })));
    case 'shields.addList':
      return lists.addCustomList(message.body.id, message.body.name, message.body.url)
        .then(() => rebuildAll().then(() => ({ ok: true })));
    case 'shields.removeList':
      return lists.removeCustomList(message.body.id)
        .then(() => rebuildAll().then(() => ({ ok: true })));
    default:
      return undefined;
  }
});

async function resolveForTab(tabId, sender) {
  const [globalRule, storageAll] = await Promise.all([
    store.localGet(precedence.STORAGE_KEY_GLOBAL, precedence.FACTORY),
    api.storage.local.get(null),
  ]);
  const domain = blocking.getTabCounts(tabId).domain
    || (sender && sender.tab && safeHost(sender.tab.url))
    || null;
  const siteKey = domain ? precedence.siteKey(domain) : null;
  const siteRule = siteKey ? storageAll[siteKey] || null : null;
  const resolved = precedence.resolve({ globalRule, siteRule, session: null, domain });
  return {
    domain,
    tabId,
    rule: resolved.rule,
    layers: resolved.layers,
    provenance: resolved.provenance,
    counts: blocking.getTabCounts(tabId),
    installState,
    lists: await lists.getRegistry(),
  };
}

/* The Spotify ad-slot verdict for one URL.
 *
 * Two inputs, and they answer different questions:
 *
 *   1. the resolved shields rule for the site the request belongs to — because
 *      the row is per-site and tri-state, so "off" must turn the feature off
 *      for that site exactly the way every other row works (architecture
 *      §5.3). A user who turns the Spotify row off gets the plain blocking
 *      behaviour: the ad host is blocked by the list table like any other host.
 *   2. the URL itself — ad host, song host, or neither.
 *
 * The verdict 'allow-and-mute' is the mechanism: the network tier does not
 * cancel the request, so the player's ad slot ends and the song follows; the
 * content script mutes the ad element, so no ad audio is heard. lib/engine/
 * spotify-adslot.js explains why a block is the failure mode here.
 */
async function spotifyVerdictFor(url, sender) {
  const host = url && String(url).replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]
    .replace(/:\d+$/, '').toLowerCase();
  const kind = spotifyAdSlot.hostKind(host);
  if (kind !== 'ad' && kind !== 'song') {
    return { action: 'passthrough', reason: 'not-spotify-audio' };
  }

  const resolved = await resolveForTab(null, sender);
  const row = resolved.rule.spotifyAdSlot;
  if (row === 'off') {
    return { action: 'block', reason: 'spotify-ad-slot row is off for this site',
             host };
  }

  if (kind === 'ad') {
    return {
      action: 'allow-and-mute',
      reason: 'the ad slot must end for the song to follow, and the ad is muted',
      host,
      muted: true,
    };
  }
  return { action: 'passthrough', host, reason: 'song host is never muted' };
}

async function cosmeticFor(host) {
  const grouped = cosmetic.buildForDomain(compiledCosmetic, host.replace(/^www\./, ''));
  return {
    css: cosmetic.buildStyleText(grouped.selectors),
    selectors: grouped.selectors,
    extended: grouped.extended,
  };
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

api.runtime.onInstalled.addListener(async (details) => {
  initPromise = rebuildAll();
  await initPromise;
  await store.localSet({
    [precedence.STORAGE_KEY_GLOBAL]: precedence.normaliseRule(
      await store.localGet(precedence.STORAGE_KEY_GLOBAL, null), 'global', null),
  });
});

api.runtime.onStartup.addListener(async () => {
  initPromise = rebuildAll();
  await initPromise;
});

api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm && alarm.name === lists.ALARM_NAME) {
    await rebuildAll();
  }
});

lists.registerUpdateAlarm(api);

// First run: the manifest installs before this listener chain is registered in
// some Gecko versions, so start now too.
initPromise = rebuildAll();

/* No module.exports: this file is the event page's own entry point, loaded
 * once as the last classic script in the manifest's scripts array. A
 * `module` global does not exist in that scope, so the old
 * `module.exports = {...}` line threw a ReferenceError in a page context.
 * The event-page functions stay private to this file. */
