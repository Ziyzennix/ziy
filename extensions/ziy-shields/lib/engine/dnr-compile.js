/* Ziy shields — compile the parsed rule table into declarativeNetRequest rules.
 *
 * Budget, measured on this engine and verified against MDN:
 *   MAX_NUMBER_OF_DYNAMIC_RULES      5000   (MDN "in Firefox: 5000")
 *   MAX_NUMBER_OF_SESSION_RULES      5000   (ExtensionDNRLimits.sys.mjs default)
 *   MAX_NUMBER_OF_REGEX_RULES        1000   (evaluated PER RULESET)
 *   MAX_NUMBER_OF_ENABLED_STATIC_RULESETS  20
 *   GUARANTEED_MINIMUM_STATIC_RULES  30000  (ExtensionDNRLimits.sys.mjs default)
 *
 * The full table is ~135k network rules — two orders of magnitude over the
 * dynamic budget. Static rulesets are the answer that does NOT fight the
 * budget: GUARANTEED_MINIMUM_STATIC_RULES is 30000, and above that the engine
 * falls back to a *global* limit that MDN explicitly says we must not depend on,
 * but that a copy of Firefox on this machine with no other installed extensions
 * documents as 300000 (commented-out MAX_GLOBAL_NUMBER_OF_STATIC_RULES):
 *
 *   // const MAX_GLOBAL_NUMBER_OF_STATIC_RULES = 300000;
 *
 * So the tiers are:
 *   tier 'static'  -> one static ruleset file, shipped/bundled, enabled from the
 *                     manifest. Held for the compiled base table. This is the
 *                     only tier that scales to 10^5 rules.
 *   tier 'dynamic' -> updateDynamicRules. Held for per-site overrides, the
 *                     element rules, and anything that must change at runtime.
 *                     Budget 5000, and the engine keeps them across sessions.
 *   tier 'session' -> updateSessionRules. Budget 5000, not persisted. Held for
 *                     "Shields down for this visit" and the block-element tool.
 *   tier 'webRequest' -> nothing DNR can express, or what DNR is too coarse for
 *                     (regex rules are capped at 1000 per ruleset). The
 *                     imperative blocking path in background/blocking.js
 *                     counts and blocks these.
 *
 * Priority is where §5.3 is enforced. compareRule() in ExtensionDNR.sys.mjs
 * orders by (highest priority) then (action precedence: allow < allowAllRequests
 * < block < upgradeScheme < redirect < modifyHeaders), and the ruleset order
 * used only to break exact ties is session > dynamic > static.
 *
 * That means a per-site ALLOW must out-prioritise a static BLOCK, so:
 *   1_000_000  session rules (Shields down for this visit)
 *   100_000     dynamic per-site allow (site override, absolute)
 *    10_000     dynamic per-site block (site override)
 *       500     list !important rules: ABP's marker for "no exception applies"
 *       100     exception (@@) rules in the static ruleset
 *        10     ordinary block rules in the static ruleset
 *         1     upgradeScheme rules for https upgrade
 * An allow with the same priority as its block would be resolved by the action
 * order — allow wins — but we still give the allow the higher priority so the
 * intent is explicit and an added block rule cannot flip the result.
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
    exports.isRegexLiteral = api.isRegexLiteral;
    exports.STATIC_RULESET_CAP = api.STATIC_RULESET_CAP;
    exports.DNR_PRIORITY = api.DNR_PRIORITY;
    exports.DNR_LIMITS = api.DNR_LIMITS;
    exports.DNR_RESOURCE_TYPES = api.DNR_RESOURCE_TYPES;
    exports.ABP_TO_DNR_TYPE = api.ABP_TO_DNR_TYPE;
    exports.isPlainUrlFilter = api.isPlainUrlFilter;
    exports.toUrlFilter = api.toUrlFilter;
    exports.toRegexFilter = api.toRegexFilter;
    exports.mapResourceTypes = api.mapResourceTypes;
    exports.buildDomainCondition = api.buildDomainCondition;
    exports.compileRule = api.compileRule;
    exports.compileTable = api.compileTable;
    exports.resetIds = api.resetIds;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

'use strict';

const DNR_PRIORITY = Object.freeze({
  SESSION_ALLOW: 1000000,
  SITE_ALLOW:     100000,
  SITE_BLOCK:      10000,
  IMPORTANT:         500,
  LIST_EXCEPTION:    100,
  LIST_BLOCK:         10,
  UPGRADE_SCHEME:      1,
});

const DNR_LIMITS = Object.freeze({
  MAX_DYNAMIC_RULES: 5000,
  MAX_SESSION_RULES: 5000,
  MAX_REGEX_RULES: 1000,
  MAX_ENABLED_STATIC_RULESETS: 20,
  GUARANTEED_MINIMUM_STATIC_RULES: 30000,
});

/**
 * The static tier's usable capacity, and the reason it is not the whole table.
 *
 * modules/ExtensionDNRStore.sys.mjs's getManifestStaticRulesets() feeds every
 * ruleset's VALIDATED rule count into a RuleQuotaCounter bounded by
 * GUARANTEED_MINIMUM_STATIC_RULES, and on overflow:
 *
 *   Cu.reportError(`Ignoring static ruleset "${id}" in extension
 *   "${extension.id}" because: ${e.message}`);
 *   continue;
 *
 * i.e. over the cap the WHOLE ruleset is dropped — not trimmed. The EasyList
 * family measures 114,973 compiled rules, which is 3.8x the cap, so a ruleset
 * containing the full table loads NOTHING. That was observed on this machine:
 * the profile's addonStartup cache held no shields entry at all, and no DNR
 * store was created.
 *
 * So the static tier carries a bounded, salience-ranked table and the rest is
 * covered by the webRequest path. The cap leaves headroom for the per-list
 * toggles: turning a list off must not push a partially-rebuilt table over the
 * line and silently drop it.
 */
const STATIC_RULESET_CAP = Object.freeze({
  rules: 30000,
  headroom: 512,
  /** The share of the budget reserved for exceptions and important rules, which
   *  must always fit: a missing ALLOW would over-block a page. */
  exceptionReserve: 4000,
});

/* ------------------------------------------------------------------ *
 * Pattern translation: ABP filter -> DNR urlFilter
 * ------------------------------------------------------------------ */

/**
 * True when a pattern can be expressed as a DNR urlFilter (no regex needed).
 * DNR's urlFilter alphabet is: A-Z a-z 0-9 _ - . % and the metacharacters
 * * | ^ (plus '/', ':', '?', '#', '&', '=', which appear in real URLs and are
 * accepted verbatim by the engine's CompiledUrlFilter parts split).
 *
 * @param {string} abpPattern
 * @returns {boolean}
 */
function isPlainUrlFilter(abpPattern) {
  // DNR's urlFilter alphabet, from the engine's own CompiledUrlFilter and
  // RuleValidator: letters, digits, and _ - . % plus the metacharacters
  // * | ^ . '/', ':', '?', '#' and '&'/'=' appear in real URLs and are taken
  // verbatim by the matcher, so they are allowed here too. Anything else
  // (regex brackets, classes, escaped metacharacters) needs a regexFilter.
  return !/[^A-Za-z0-9_\-.*^|:/?#&=~!#'+;,$]/.test(abpPattern) &&
         !/\[\]\\{}()/.test(abpPattern);
}

/**
 * Converts an ABP network pattern into a DNR urlFilter, or null when the
 * pattern needs a regex.
 *
 * The two syntaxes differ in three ways we must handle:
 *
 *  1. ABP allows a leading '||' (domain anchor) — DNR has exactly this.
 *  2. ABP's '^' (separator) is DNR's '^' — identical semantics, including the
 *     "the last ^ may also match end of URL" special case the engine documents.
 *  3. ABP allows a bare '*''; DNR rejects an empty string but a genuinely empty
 *     pattern is a match-everything rule, which we express as '*'.
 *
 * @param {string} abpPattern
 * @returns {string|null} urlFilter, or null when a regex is required
 */
function toUrlFilter(abpPattern) {
  if (abpPattern === '') return '*';
  if (abpPattern === '||*' || abpPattern === '|*') return '*';
  if (abpPattern === '||') return '*';
  // A regex literal starts AND ends with '/' and has at least one regex
  // metacharacter inside. A plain URL path like '/a/b/' also starts and ends
  // with '/' but is a literal the engine's urlFilter matcher takes verbatim, so
  // only treat the pattern as a regex when it needs RE2 features.
  if (isRegexLiteral(abpPattern)) return null;
  if (!isPlainUrlFilter(abpPattern)) return null;
  // ABP's '||*' prefix is chrome-rejected in DNR ("urlFilter should not start
  // with '||*'"); a plain '*' prefix is the documented replacement, so drop
  // BOTH leading bars and keep the wildcard.
  if (abpPattern.startsWith('||*')) return abpPattern.slice(2);
  if (abpPattern.startsWith('|*')) return abpPattern.slice(1);
  return abpPattern;
}

/**
 * True when a pattern is a DNR regexFilter (an ABP regex literal), which means
 * it both looks like /.../ and needs RE2 features a plain urlFilter cannot
 * carry. A literal path such as '/a/b/' stays a urlFilter.
 */
function isRegexLiteral(abpPattern) {
  if (abpPattern.length < 3) return false;
  if (!(abpPattern.startsWith('/') && abpPattern.endsWith('/'))) return false;
  const body = abpPattern.slice(1, -1);
  if (body === '') return false;
  // Any character outside the urlFilter alphabet forces a regex.
  return /[^A-Za-z0-9_\-.*^|:/]/.test(body);
}

/**
 * Converts an ABP regex literal (/pat/) into a DNR regexFilter. Returns null
 * when the pattern is not a valid RE2-flavoured regex (Gecko uses its own
 * engine; lookarounds are unsupported and we cannot test for them cheaply, so
 * we only reject the trivially-invalid forms here and rely on the engine to
 * reject the rest, at which point the caller falls back to webRequest).
 */
function toRegexFilter(abpPattern) {
  if (!isRegexLiteral(abpPattern)) return null;
  const body = abpPattern.slice(1, -1);
  if (body === '') return null;
  try {
    new RegExp(body);               // eslint-disable-line no-new
    return body;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Resource-type and third-party mapping
 * ------------------------------------------------------------------ */

/** ABP resource-type names that DNR accepts verbatim. */
const ABP_TO_DNR_TYPE = Object.freeze({
  document: 'main_frame',
  main_frame: 'main_frame',
  subdocument: 'sub_frame',
  script: 'script',
  stylesheet: 'stylesheet',
  image: 'image',
  object: 'object',
  'object-subrequest': 'object_subrequest',
  object_subrequest: 'object_subrequest',
  xmlhttprequest: 'xmlhttprequest',
  xml_dtd: 'xml_dtd',
  xslt: 'xslt',
  ping: 'ping',
  beacon: 'beacon',
  csp_report: 'csp_report',
  font: 'font',
  media: 'media',
  websocket: 'websocket',
  other: 'other',
  imageset: 'imageset',
  web_manifest: 'web_manifest',
  speculative: 'speculative',
});

const DNR_RESOURCE_TYPES = Object.freeze([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'object',
  'object_subrequest', 'xmlhttprequest', 'xslt', 'ping', 'beacon', 'xml_dtd',
  'font', 'media', 'websocket', 'csp_report', 'imageset', 'web_manifest',
  'speculative', 'json', 'other',
]);

/**
 * Maps a parsed rule's resourceTypes to DNR's enum. Returns null when the rule
 * has no resource-type restriction (which, in DNR, means "everything except
 * main_frame" — the documented behaviour when neither resourceTypes nor
 * excludedResourceTypes is specified).
 */
function mapResourceTypes(abpTypes) {
  if (!abpTypes || abpTypes.length === 0) return null;
  const out = [];
  for (const t of abpTypes) {
    const mapped = ABP_TO_DNR_TYPE[t];
    if (mapped !== undefined && !out.includes(mapped)) out.push(mapped);
  }
  if (out.length === DNR_RESOURCE_TYPES.length) return null;
  if (out.length === 0) return null;
  return out;
}

/**
 * @param {object} domain  {include: string[], exclude: string[]}
 * @param {string} ruleDomainType 'firstParty'|'thirdParty'|null from DNR
 *        'firstParty' == ABP's ~third-party, 'thirdParty' == ABP's third-party
 */
function buildDomainCondition(domain) {
  const include = Array.isArray(domain && domain.include) ? domain.include : [];
  const exclude = Array.isArray(domain && domain.exclude) ? domain.exclude : [];
  // DNR caps these lists; MDN documents no hard cap but the engine builds a Set
  // per condition, and a rule with hundreds of entries is a real cost in the
  // matching hot path. EasyList's $domain= lists are short (< 30), so a
  // documented sanity cap only rejects malformed input.
  const MAX_DOMAIN_TERMS = 64;
  const cond = {};
  if (include.length > 0 && include.length <= MAX_DOMAIN_TERMS && !include.includes('*')) {
    cond.initiatorDomains = include.slice();
  } else if (include.includes('*') && include.length === 1) {
    // $domain=* — no initiator restriction needed.
  } else if (include.length > MAX_DOMAIN_TERMS) {
    // Too specific to express in DNR; leave it to the webRequest path.
    return { __overflow: 'include' };
  }
  if (exclude.length > 0 && exclude.length <= MAX_DOMAIN_TERMS) {
    cond.excludedInitiatorDomains = exclude.slice();
  } else if (exclude.length > MAX_DOMAIN_TERMS) {
    return { __overflow: 'exclude' };
  }
  return cond;
}

/* ------------------------------------------------------------------ *
 * Rule compilation
 * ------------------------------------------------------------------ */

let nextStaticId = 1;

function resetIds() { nextStaticId = 1; }

/**
 * Compiles one parsed network rule into a DNR rule, or returns null with a
 * reason when it cannot be expressed in DNR.
 *
 * @param {object} rule    a parsed rule (kind 'network')
 * @param {object} opts
 * @param {number} opts.priority
 * @param {'block'|'allow'|'upgradeScheme'} opts.actionType
 * @param {string} opts.rulesetId   'static_1' | 'dynamic' | 'session'
 * @param {number} [opts.ruleId]
 * @returns {{rule: object|null, reason: string|null}}
 */
function compileRule(rule, opts) {
  const priority = opts.priority;
  const actionType = opts.actionType;

  if (rule.kind !== 'network') return { rule: null, reason: 'not-network' };

  // A rule with a resource-type restriction that includes main_frame cannot
  // block the navigation itself with a plain block action (the doc behaviour is
  // that main_frame-subtype rules do apply, but a blocking main_frame rule
  // breaks navigation entirely). $document/$popup are the two main_frame-ish
  // options EasyList uses, and both are handled by the webRequest path.
  const types = mapResourceTypes(rule.resourceTypes);
  const domainCond = buildDomainCondition(rule.domain);
  if (domainCond.__overflow) {
    return { rule: null, reason: 'domain-list-too-long' };
  }

  const condition = {};
  if (types) condition.resourceTypes = types;

  let hasUrlFilter = false;
  const urlFilter = toUrlFilter(rule.pattern);
  if (urlFilter !== null) {
    condition.urlFilter = urlFilter;
    hasUrlFilter = true;
  } else {
    const regexFilter = toRegexFilter(rule.pattern);
    if (regexFilter === null) {
      return { rule: null, reason: 'not-urlfilter' };
    }
    condition.regexFilter = regexFilter;
    // regex rules are budget-capped (1000 per ruleset) and the engine's regex
    // filter memory is the reason. The caller counts them and tiers the
    // overflow to webRequest.
    condition.__regex = true;
  }

  if (rule.matchCase) condition.isUrlFilterCaseSensitive = true;

  Object.assign(condition, domainCond);

  if (rule.thirdParty === true) condition.domainType = 'thirdParty';
  else if (rule.thirdParty === false) condition.domainType = 'firstParty';

  if (rule.resourceTypes && rule.resourceTypes.includes('document') && actionType === 'block') {
    // $document block rules: DNR blocks the subresource fine, but blocking a
    // main_frame means blocking navigation. EasyList's $document entries are
    // genuinely intended as "block this document", so the webRequest path is
    // the honest home for them. Keep the exception here so the tiering is
    // explicit rather than silent.
    return { rule: null, reason: 'document-block' };
  }

  const dnr = {
    id: opts.ruleId || (opts.rulesetId === 'session' ? nextStaticId++ : nextStaticId++),
    priority,
    action: { type: actionType },
    condition,
  };
  // The '__regex' marker is ours, not DNR's; strip it before shipping.
  const wasRegex = dnr.condition.__regex === true;
  delete dnr.condition.__regex;
  if (wasRegex) dnr.__regex = true;

  return { rule: dnr, reason: null };
}

/* ------------------------------------------------------------------ *
 * DNR rule-set construction for a whole compiled table
 * ------------------------------------------------------------------ */

/**
 * Splits a parsed table into static/dynamic/session/webRequest tiers, per the
 * documented limits, and returns the DNR rules plus the residual webRequest
 * rules.
 *
 * @param {object} params
 * @param {object[]} params.networkRules  parsed network rules
 * @param {object} params.priorities      {exception, block, important, upgrade}
 * @param {object[]} [params.siteOverrides]  per-site absolute rules
 * @param {object[]} [params.sessionRules]   session absolute rules
 * @returns {{tiers: {static: object[], dynamic: object[], session: object[]}, webRequest: object[], stats: object}}
 */
function compileTable(params) {
  const networkRules = params.networkRules || [];
  const tiers = { static: [], dynamic: [], session: [] };
  const webRequest = [];
  const stats = {
    input: networkRules.length,
    staticBlock: 0, staticAllow: 0,
    dynamicBlock: 0, dynamicAllow: 0,
    sessionBlock: 0, sessionAllow: 0,
    regexRules: 0,
    dropped: Object.create(null),
  };

  const bump = (reason) => {
    stats.dropped[reason] = (stats.dropped[reason] || 0) + 1;
  };

  // Tier order: important > exceptions > ordinary blocks. Exceptions must beat
  // ordinary blocks, so they carry the higher priority.
  const P = params.priorities || {
    important: DNR_PRIORITY.IMPORTANT,
    exception: DNR_PRIORITY.LIST_EXCEPTION,
    block: DNR_PRIORITY.LIST_BLOCK,
    upgrade: DNR_PRIORITY.UPGRADE_SCHEME,
  };

  const regexBudget = { left: DNR_LIMITS.MAX_REGEX_RULES };

  /* ---- the static tier, capped by the engine's own quota ---------------- */
  // Everything here is first TRIED in the static tier; the overflow moves to
  // webRequest. The order within the static tier is what matters, so it is
  // decided before any rule is compiled:
  //
  //   1. every exception (@@) and every !important rule, always. A missing
  //      ALLOW would over-block a page, so these are never the ones dropped.
  //   2. the remaining ordinary blocks, ranked by the salience of the anchored
  //      domain they cover (the count of distinct rules behind that domain in
  //      the shipped lists). Salience is a proxy for "how often a real page
  //      fetches this host", and it is the only signal available offline.
  //   3. anything that does not fit, plus everything DNR cannot express, goes to
  //      the webRequest path — which is the same mechanism the residual already
  //      uses, and which the counting listener counts either way.
  const cap = params.staticCap === undefined
    ? STATIC_RULESET_CAP.rules - STATIC_RULESET_CAP.headroom
    : params.staticCap;

  const mustHave = [];
  const ordinary = [];
  for (const rule of networkRules) {
    if (rule.kind !== 'network') continue;
    if (rule.isException === true || rule.important === true) mustHave.push(rule);
    else ordinary.push(rule);
  }

  // Salience: group the ordinary rules by their anchored domain.
  const byDomain = new Map();
  const domainless = [];
  for (const rule of ordinary) {
    const m = /^\|\|([^/^*?|]+)/.exec(rule.pattern);
    if (!m) { domainless.push(rule); continue; }
    const domain = m[1].replace(/^www\./, '');
    let bucket = byDomain.get(domain);
    if (!bucket) { bucket = []; byDomain.set(domain, bucket); }
    bucket.push(rule);
  }
  const rankedDomains = [...byDomain.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));

  const staticPlan = [];
  for (const rule of mustHave) staticPlan.push(rule);
  let used = mustHave.length;
  for (const [, rules] of rankedDomains) {
    if (used + rules.length > cap) continue;
    for (const rule of rules) staticPlan.push(rule);
    used += rules.length;
  }
  // Rules whose pattern has no domain anchor are cheap to evaluate (the engine
  // still substring-matches them) and cover ad paths that appear on many hosts,
  // so they get whatever is left before the webRequest tail.
  const remaining = cap - used;
  for (const rule of domainless.slice(0, Math.max(0, remaining))) staticPlan.push(rule);
  used = staticPlan.length;

  for (const rule of staticPlan) {
    const isException = rule.isException === true;
    const priority = rule.important ? P.important : (isException ? P.exception : P.block);
    const actionType = isException ? 'allow' : 'block';

    const compiled = compileRule(rule, { priority, actionType, rulesetId: 'static' });
    if (compiled.rule === null) { bump(compiled.reason); webRequest.push(rule); continue; }
    if (compiled.rule.__regex) {
      if (regexBudget.left <= 0) { bump('regex-budget'); webRequest.push(rule); continue; }
      regexBudget.left--;
      stats.regexRules++;
    }
    tiers.static.push(compiled.rule);
    if (isException) stats.staticAllow++; else stats.staticBlock++;
  }

  // Everything that did not fit the cap, and everything the salience pass
  // skipped, is covered by the webRequest path rather than dropped.
  const planned = new Set(staticPlan);
  for (const rule of networkRules) {
    if (rule.kind !== 'network') continue;
    if (planned.has(rule)) continue;
    bump('static-cap');
    webRequest.push(rule);
  }

  // Per-site overrides: absolute rules written into the dynamic ruleset, which
  // is the one that persists and is checked before static rules.
  for (const override of (params.siteOverrides || [])) {
    const compiled = compileRule(override, {
      priority: override.__action === 'allow' ? DNR_PRIORITY.SITE_ALLOW : DNR_PRIORITY.SITE_BLOCK,
      actionType: override.__action || 'block',
      rulesetId: 'dynamic',
      ruleId: override.__dnrId,
    });
    if (compiled.rule === null) { bump('override:' + compiled.reason); webRequest.push(override); continue; }
    tiers.dynamic.push(compiled.rule);
    if (override.__action === 'allow') stats.dynamicAllow++; else stats.dynamicBlock++;
  }

  // Session rules: "Shields down for this visit" and the block-element tool.
  for (const srule of (params.sessionRules || [])) {
    const compiled = compileRule(srule, {
      priority: srule.__action === 'allow' ? DNR_PRIORITY.SESSION_ALLOW : DNR_PRIORITY.SITE_BLOCK,
      actionType: srule.__action || 'allow',
      rulesetId: 'session',
      ruleId: srule.__dnrId,
    });
    if (compiled.rule === null) { bump('session:' + compiled.reason); webRequest.push(srule); continue; }
    tiers.session.push(compiled.rule);
    if (srule.__action === 'allow') stats.sessionAllow++; else stats.sessionBlock++;
  }

  return { tiers, webRequest, stats };
}

  return {
    isRegexLiteral,
    STATIC_RULESET_CAP,
    DNR_PRIORITY,
    DNR_LIMITS,
    DNR_RESOURCE_TYPES,
    ABP_TO_DNR_TYPE,
    isPlainUrlFilter,
    toUrlFilter,
    toRegexFilter,
    mapResourceTypes,
    buildDomainCondition,
    compileRule,
    compileTable,
    resetIds,
  };
});
