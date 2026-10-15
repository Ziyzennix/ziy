/* Ziy shields — matcher for the STATIC declarativeNetRequest tier.
 *
 * WHAT THIS IS FOR
 * -----------------
 * Defect D-7 (replica/test-report.md, replica/proofs-fix-events.md §9): the
 * per-tab counter records only the requests the webRequest residual tier stops,
 * so a page whose trackers the STATIC DNR ruleset stopped reports blocks=0.
 * The static tier is the majority of the table (28 923 rules in the shipped
 * ruleset), so on a real page the count was almost always zero.
 *
 * WHY THIS FILE MATCHES THE RULESET ITSELF RATHER THAN CALLING AN API
 * -----------------------------------------------------------------
 * The engine has exactly one way for an extension to ask what DNR did:
 * `declarativeNetRequest.testMatchOutcome()`, which returns matchedRules for a
 * HYPOTHETICAL request. Three facts read out of the engine's own sources rule
 * it out for per-request counting, and each is verified rather than assumed:
 *
 *  1. It is gated behind the pref `extensions.dnr.feedback` (default FALSE —
 *     XPCOMUtils.defineLazyPreferenceGetter(this, "dnrFeedbackEnabled",
 *     PREF_DNR_FEEDBACK, false) in parent/ext-declarativeNetRequest.js), and on
 *     that pref being false testMatchOutcome throws:
 *       "... is only available when the \"extensions.dnr.feedback\" preference
 *        is set to true."
 *     The permission is `declarativeNetRequestFeedback`, and the schema
 *     (toolkit/components/extensions/schemas/declarative_net_request.json)
 *     puts it under `OptionalPermission` — i.e. it needs a
 *     `permissions.request()` round trip, whose prompt path is
 *     `requireUserInput: true` in permissions.json, i.e. a user gesture and a
 *     browser-level prompt on a shipped extension.
 *  2. There is NO event for "a rule matched": `onRuleMatchedDebug` is bug
 *     1745773 and is NOT in this engine — grep of ExtensionDNR.sys.mjs finds
 *     only the comment "Note: Only needed for testMatchOutcome, getMatchedRules
 *     (bug 1745765) and onRuleMatchedDebug (bug 1745773)". getMatchedRules is
 *     bug 1745765 and is likewise absent: the shipped API surface is
 *       updateDynamicRules, updateSessionRules, getEnabledRulesets,
 *       updateEnabledRulesets, updateStaticRules, getAvailableStaticRuleCount,
 *       getDisabledRuleIds, getDynamicRules, getSessionRules, isRegexSupported,
 *       testMatchOutcome
 *     — no feedback event, and no per-request matched-rule callback anywhere.
 *  3. Calling testMatchOutcome per request would be an ASYNC round trip to the
 *     parent process for every subresource on every page; the counting listener
 *     is synchronous on the request path.
 *
 * So the documented alternative (and the one the engine already runs for every
 * request in startDNREvaluation) is to evaluate the same ruleset the engine
 * evaluated. That is what this file does, and it does it in ONE place so the
 * matcher is unit-testable rather than an approximation buried in the listener.
 *
 * IT NEVER BLOCKS. It answers "would the static tier have stopped this?" for
 * counting purposes only. The block itself is and remains the engine's: the
 * engine's DNR evaluation happens BEFORE the webRequest listeners run
 * (WebRequest.sys.mjs, runChannelListener: `beforeWebRequestEvent(channel,
 * kind)` then the listeners then `handleRequest(channel, kind)` which returns
 * early and DISCARDS our handlerResults when DNR blocked), so by the time our
 * listener sees the request the block has already been decided and applied.
 * Returning anything from here changes nothing about the network.
 *
 * WHAT IS MATCHED, AND WHERE THE SEMANTICS COME FROM
 * --------------------------------------------------
 * Every urlFilter/regexFilter/resourceTypes/domainType/initiatorDomains
 * condition the shipped ruleset uses, reimplemented from the engine's own
 * CompiledUrlFilter and RequestEvaluator:
 *
 *   - `^` is the separator: one char that is not [A-Za-z0-9_\-.%] — the
 *     engine's own `CompiledUrlFilter.#regexIsSep = /[^A-Za-z0-9_\-.%]/`, and
 *     the URL is matched as `url + "^"` so a trailing "^" can match the end.
 *   - `||` is the DOMAIN anchor: it matches at any domain-boundary offset,
 *     which is what RequestDataForUrlFilter.#getDomainAnchors computes (host
 *     start, plus every offset after a "." in the host, honouring userinfo).
 *   - `|` left/right anchors, `*` wildcards, and the engine's exact-URL
 *     backtracking of the tail when the pattern is right-anchored.
 *   - main_frame requests only match a rule that declares resourceTypes
 *     (the engine: `else if (this.req.type === "main_frame") return false`).
 *   - domainType: 'thirdParty' when the request host is not the initiator host.
 *   - initiatorDomains matches when the initiator's host equals, or is a
 *     subdomain of, any listed domain (the engine's #matchesDomains over
 *     allInitiatorDomains, which is the host and all its parent domains).
 *
 * This is not an approximation of "roughly what the list means"; it is the
 * same predicate the engine evaluates, so a count this file produces is the
 * count the engine's ruleset would produce for the same request.
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
    exports.SEPARATOR_CHARS = api.SEPARATOR_CHARS;
    exports.SUBRESOURCE_TYPES = api.SUBRESOURCE_TYPES;
    exports.isSeparatorChar = api.isSeparatorChar;
    exports.appendVirtualSeparator = api.appendVirtualSeparator;
    exports.domainAnchors = api.domainAnchors;
    exports.parseUrlFilter = api.parseUrlFilter;
    exports.matchUrlFilter = api.matchUrlFilter;
    exports.staticMatch = api.staticMatch;
    exports.buildStaticIndex = api.buildStaticIndex;
    exports.staticCandidates = api.staticCandidates;
    exports.staticWinnerFor = api.staticWinnerFor;
    exports.requestHost = api.requestHost;
    exports.initiatorDomainChain = api.initiatorDomainChain;
    exports.domainMatches = api.domainMatches;
    exports.sameOrSubdomain = api.sameOrSubdomain;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * The engine's own separator class, from CompiledUrlFilter:
   *   static #regexIsSep = /[^A-Za-z0-9_\-.%]/;
   */
  const SEPARATOR_RE = /[^A-Za-z0-9_\-.%]/;

  /**
   * DNR resource types a subresource request can carry. main_frame is
   * deliberately NOT in this set: the engine ignores a rule without an explicit
   * resourceTypes list for main_frame requests, so a document navigation can
   * only ever be matched by a rule that names its type.
   */
  const SUBRESOURCE_TYPES = [
    'script', 'image', 'stylesheet', 'object', 'object_subrequest',
    'xmlhttprequest', 'sub_frame', 'ping', 'beacon', 'font', 'media',
    'websocket', 'csp_report', 'imageset', 'web_manifest', 'other',
  ];

  /** The engine appends "^" to the URL so a trailing "^" can match the end. */
  function appendVirtualSeparator(url) {
    return url + "^";
  }

  function isSeparatorChar(ch) {
    return SEPARATOR_RE.test(ch);
  }

  /**
   * The offsets in the URL where a `||` domain anchor may match, computed
   * exactly as RequestDataForUrlFilter.#getDomainAnchors does: the start of
   * the host (after "://" and any userinfo), plus every offset just after a
   * "." inside the host. Returns the offsets, or an empty list when the URL
   * has no host in the expected shape.
   */
  function domainAnchors(url) {
    const hostStart = url.indexOf("://") + 3;
    if (hostStart === 2) return [];
    let hostEnd = url.indexOf("/", hostStart);
    if (hostEnd === -1) hostEnd = url.length;
    let start = hostStart;
    const userpassEnd = url.lastIndexOf("@", hostEnd) + 1;
    if (userpassEnd) start = userpassEnd;
    const host = url.slice(start, hostEnd);
    const anchors = [start];
    let offset = 0;
    while ((offset = host.indexOf(".", offset) + 1)) {
      anchors.push(start + offset);
    }
    return anchors;
  }

  /**
   * A parsed urlFilter, in the shape the engine's CompiledUrlFilter builds:
   * the filter split at "*", with the leading and trailing anchors separated
   * off and the leading/trailing wildcards dropped the way the engine does
   * ("|*" and "*|" are not effective anchors).
   *
   * @typedef {{parts: string[], anchorLeft: boolean, anchorDomain: boolean, anchorRight: boolean, trailingSeparator: boolean, raw: string}} ParsedUrlFilter
   */
  function parseUrlFilter(urlFilter) {
    let start = 0;
    let end = urlFilter.length;
    let anchorLeft = false;
    let anchorDomain = false;
    let anchorRight = false;

    if (urlFilter[0] === "|") {
      if (urlFilter[1] === "|") {
        start = 2;
        anchorDomain = true;
      } else {
        start = 1;
        anchorLeft = true;
      }
    }
    if (end > start && urlFilter[end - 1] === "|") {
      --end;
      anchorRight = true;
    }
    while (start < end && urlFilter[start] === "*") {
      ++start;
      anchorLeft = false;
    }
    while (end > start && urlFilter[end - 1] === "*") {
      --end;
      anchorRight = false;
    }
    const trailingSeparator = end > 0 && urlFilter[end - 1] === "^";
    const withoutAnchors = urlFilter.slice(start, end).toLowerCase();
    return {
      parts: withoutAnchors.split("*"),
      anchorLeft,
      anchorDomain,
      anchorRight,
      trailingSeparator,
      raw: urlFilter,
    };
  }

  /** The engine's #matchPartAt: a literal compare where "^" matches one separator. */
  function matchPartAt(part, url, urlIndex, sepStart) {
    if (sepStart === -1) return url.startsWith(part, urlIndex);
    if (urlIndex + part.length > url.length) return false;
    for (let i = 0; i < part.length; i++) {
      const partChar = part[i];
      const urlChar = url[urlIndex + i];
      if (partChar !== urlChar &&
          !(partChar === "^" && urlChar.length === 1 && SEPARATOR_RE.test(urlChar))) {
        return false;
      }
    }
    return true;
  }

  function startsWithPart(part, url, urlIndex) {
    return matchPartAt(part, url, urlIndex, part.indexOf("^"));
  }

  function indexAfterPart(part, url, urlIndex) {
    const sepStart = part.indexOf("^");
    if (sepStart === -1) {
      const i = url.indexOf(part, urlIndex);
      return i === -1 ? -1 : i + part.length;
    }
    const max = url.length - part.length;
    for (let i = urlIndex; i <= max; i++) {
      if (matchPartAt(part, url, i, sepStart)) return i + part.length;
    }
    return -1;
  }

  function indexAfterDomainPart(part, url, urlIndex, anchors) {
    const sepStart = part.indexOf("^");
    for (const offset of anchors) {
      if (matchPartAt(part, url, offset, sepStart)) return offset + part.length;
    }
    return -1;
  }

  /**
   * Tests a urlFilter against the URL the engine would build: the URL with a
   * "^" appended, lowercased (the shipped ruleset sets no
   * isUrlFilterCaseSensitive). This is CompiledUrlFilter::matchesRequest,
   * including its single-pass backtrack of a right-anchored tail.
   *
   * @param {ParsedUrlFilter} filter
   * @param {string} url      the URL WITH the virtual separator appended
   * @param {number[]} anchors  the domain anchors of that URL
   */
  function matchUrlFilter(filter, url, anchors) {
    const parts = filter.parts;
    const realEndOfUrl = url.length - 1;
    let atUrlIndex = 0;

    const head = parts[0];
    if (filter.anchorLeft) {
      if (!startsWithPart(head, url, 0)) return false;
      atUrlIndex = head.length;
    } else if (filter.anchorDomain) {
      atUrlIndex = indexAfterDomainPart(head, url, 0, anchors);
    } else {
      atUrlIndex = indexAfterPart(head, url, 0);
    }

    let previouslyAtUrlIndex = 0;
    for (let i = 1; i < parts.length && atUrlIndex !== -1; i++) {
      previouslyAtUrlIndex = atUrlIndex;
      atUrlIndex = indexAfterPart(parts[i], url, atUrlIndex);
    }
    if (atUrlIndex === -1) return false;
    if (atUrlIndex === url.length) return filter.trailingSeparator;
    if (!filter.anchorRight || atUrlIndex === realEndOfUrl) return true;

    const tail = parts[parts.length - 1];
    const expectedTailIndex = realEndOfUrl - tail.length;
    const expectedTailIndexPlus1 = expectedTailIndex + 1;
    if (parts.length === 1) {
      if (filter.anchorLeft) return false;
      if (filter.anchorDomain) {
        return (anchors.includes(expectedTailIndex) && startsWithPart(tail, url, expectedTailIndex)) ||
               (filter.trailingSeparator && anchors.includes(expectedTailIndexPlus1) &&
                startsWithPart(tail, url, expectedTailIndexPlus1));
      }
    }
    return (expectedTailIndex > previouslyAtUrlIndex && startsWithPart(tail, url, expectedTailIndex)) ||
           (filter.trailingSeparator && expectedTailIndexPlus1 > previouslyAtUrlIndex &&
            startsWithPart(tail, url, expectedTailIndexPlus1));
  }

  /**
   * The initiator host and all of its parent domains, as the engine's
   * `allInitiatorDomains` is: "google.co.uk" -> ["google.co.uk", "co.uk"].
   * Returns null for no initiator (a null-principal request), which is what
   * makes an `initiatorDomains` condition fail to match — the engine's own
   * comment on that path is "unable to only match null principals (bug
   * 1798225)".
   */
  function initiatorDomainChain(initiatorUrl) {
    if (!initiatorUrl) return null;
    // The engine's #domainFromURI: the URI's host (IPv6 bracketed, ports
    // excluded). No shipped filter entry is an IPv6 literal, so the port
    // suffix is dropped and the rest used verbatim.
    return hostFromUrl(initiatorUrl);
  }

  /** The host of a URL, lowercased, or null when it does not parse. */
  function requestHost(url) {
    return hostFromUrl(url);
  }

  /** The host of a URL, from the URI's own host grammar rather than a parser
   *  that would normalise it: the engine matches what the URI carries. */
  function hostFromUrl(url) {
    if (typeof url !== "string" || !url) return null;
    const schemeEnd = url.indexOf("://");
    if (schemeEnd < 0) return null;
    let hostStart = schemeEnd + 3;
    let hostEnd = url.indexOf("/", hostStart);
    if (hostEnd < 0) hostEnd = url.length;
    const userpassEnd = url.lastIndexOf("@", hostEnd) + 1;
    if (userpassEnd) hostStart = userpassEnd;
    let host = url.slice(hostStart, hostEnd).toLowerCase();
    if (!host) return null;
    const colon = host.lastIndexOf(":");
    if (colon > 0) host = host.slice(0, colon);
    return hostFromDomain(host);
  }

  /** The engine's #getAllDomainsWithin: the domain and every superdomain. */
  function hostFromDomain(domain) {
    const domains = [domain];
    let i = 0;
    while ((i = domain.indexOf(".", i) + 1) !== 0) {
      const superdomain = domain.slice(i);
      if (superdomain) domains.push(superdomain);
    }
    return domains;
  }

  /**
   * True when a chain contains one of a condition's domains. This is the
   * engine's #matchesDomains, which builds a Set from the condition list and
   * tests exact membership against the target's chain, so `example.co.uk` is
   * matched by a condition listing `example.co.uk` or `co.uk`, but not by one
   * listing `example.co` — the chain has no `example.co` entry.
   */
  function domainMatches(conditionDomains, chain) {
    if (!chain) return false;
    const wanted = new Set();
    for (const d of conditionDomains) {
      if (typeof d !== "string" || !d) continue;
      const w = d.toLowerCase();
      wanted.add(w.endsWith(".") ? w.slice(0, -1) : w);
    }
    if (!wanted.size) return false;
    for (const have of chain) {
      if (wanted.has(have)) return true;
    }
    return false;
  }

  /**
   * The one predicate: does the STATIC ruleset stop this request?
   *
   * @param {object} rule     one entry of the static ruleset (shipped JSON)
   * @param {{url: string, type: string, initiator?: string|null}} request
   * @returns {boolean} true when the engine would apply this rule's block
   */
  function staticMatch(rule, request) {
    const cond = rule.condition;
    if (!cond) return false;
    if (!rule.action || rule.action.type !== "block") return false;

    const types = cond.resourceTypes;
    const isMainFrame = request.type === "main_frame";
    if (types && types.length) {
      if (!types.includes(request.type)) return false;
    } else if (cond.excludedResourceTypes) {
      if (cond.excludedResourceTypes.includes(request.type)) return false;
    } else if (isMainFrame) {
      // The engine: with no resourceTypes, a main_frame request ignores the
      // rule entirely. A document navigation is never counted as a block.
      return false;
    }

    const urlLower = appendVirtualSeparator(request.url).toLowerCase();
    const anchors = domainAnchors(urlLower);

    if (cond.urlFilter) {
      if (!matchUrlFilter(parseUrlFilter(cond.urlFilter), urlLower, anchors)) return false;
    } else if (cond.regexFilter) {
      let re;
      try {
        re = new RegExp(cond.regexFilter, "i");
      } catch (e) {
        return false;
      }
      if (!re.test(request.url)) return false;
    }

    if (cond.excludedRequestDomains) {
      if (domainMatches(cond.excludedRequestDomains, requestHost(request.url))) return false;
    }
    if (cond.requestDomains) {
      if (!domainMatches(cond.requestDomains, requestHost(request.url))) return false;
    }

    const initiatorChain = cond.initiatorDomains || cond.excludedInitiatorDomains
      ? initiatorDomainChain(request.initiator || null)
      : null;
    if (cond.initiatorDomains) {
      if (!domainMatches(cond.initiatorDomains, initiatorChain)) return false;
    }
    if (cond.excludedInitiatorDomains) {
      if (domainMatches(cond.excludedInitiatorDomains, initiatorChain)) return false;
    }

    if (cond.domainType) {
      // The engine's #isThirdParty compares the eTLD+1 (base domain) of the
      // request and the initiator, falling back to the raw host comparison.
      // getBaseDomain is not available to us (it is a privileged service), so
      // the fallback the engine itself uses is the host comparison: the two
      // are equal, or one is a subdomain of the other.
      const host = requestHost(request.url);
      const initiator = request.initiator ? requestHost(request.initiator) : null;
      const isThirdParty = !initiator || !host ||
        !sameOrSubdomain(host[0], initiator[0]);
      if (cond.domainType === "thirdParty" && !isThirdParty) return false;
      if (cond.domainType === "firstParty" && isThirdParty) return false;
    }

    return true;
  }

  /** True when host is initiator, or a subdomain of it, or vice versa. */
  function sameOrSubdomain(host, initiator) {
    return host === initiator ||
      host.endsWith("." + initiator) ||
      initiator.endsWith("." + host);
  }

  /**
   * An index over the static ruleset: rules bucketed by every host segment
   * their urlFilter could apply to, plus the unanchored bucket.
   *
   * The point is the cost. A linear scan of 28 923 rules per request is not
   * viable on the request path, and the engine itself does not linear-scan:
   * ExtensionDNRStore indexes static rulesets by urlFilter parts. The bucket
   * key is the first literal segment of the filter (the engine's own parts[0]
   * idea), which makes a lookup O(rules that could actually match).
   *
   * The ruleset is a build artifact shipped inside the xpi, so the index is
   * built once at startup and held for the event page's lifetime. With the
   * static tier healthy the residual is small; this index exists so counting
   * the static tier is not the expensive half.
   *
   * @returns {{index: Map<string, Array>, unanchored: Array, count: number}}
   */
  function buildStaticIndex(rules) {
    const index = new Map();
    const unanchored = [];
    for (const rule of rules) {
      const cond = rule && rule.condition;
      if (!cond) continue;
      const key = bucketKey(cond);
      if (key === null) {
        unanchored.push(rule);
        continue;
      }
      let bucket = index.get(key);
      if (!bucket) { bucket = []; index.set(key, bucket); }
      bucket.push(rule);
    }
    return { index, unanchored, count: rules.length };
  }

  /** The bucket key for a rule's condition, or null for "no url filter". */
  function bucketKey(cond) {
    if (!cond.urlFilter) return null;
    const filter = parseUrlFilter(cond.urlFilter);
    if (filter.anchorLeft) return null;
    const head = filter.parts[0];
    if (!head) return null;
    if (filter.anchorDomain) {
      // "||example.com/foo" applies to example.com and every subdomain, so the
      // bucket key is the anchored HOST only: everything after the host (a path
      // or a query) is still evaluated by staticMatch. Keeping only the host is
      // what makes a request for a.b.example.com reach the bucket.
      const host = head.replace(/\^.*$/, "").split("/")[0];
      return "H:" + host;
    }
    // A plain substring filter is bucketed by its head too: it can only match
    // a URL containing that head.
    return "S:" + head.replace(/\^.*$/, "");
  }

  /**
   * The candidate static rules for a request: the buckets its URL can reach.
   * Every subdomain suffix of the host is a candidate bucket for an anchored
   * filter ("||example.com/" matches a.b.example.com), and the substring
   * buckets are always candidates because a substring can appear anywhere.
   */
  function staticCandidates(index, url) {
    const out = [];
    const hostChain = requestHost(url);
    const seen = new Set();
    if (hostChain) {
      // Every suffix of the host is a candidate: "a.b.example.com" reaches the
      // buckets keyed "a.b.example.com", "b.example.com" and "example.com",
      // which is what "||example.com/" and "||b.example.com/" both apply to.
      const labels = hostChain[0].split(".");
      for (let i = 0; i < labels.length; i++) {
        const suffix = labels.slice(i).join(".");
        const bucket = index.index.get("H:" + suffix);
        if (bucket) {
          for (const rule of bucket) {
            if (!seen.has(rule)) { seen.add(rule); out.push(rule); }
          }
        }
      }
    }
    for (const [key, bucket] of index.index) {
      if (key.startsWith("H:")) continue;
      for (const rule of bucket) {
        if (!seen.has(rule)) { seen.add(rule); out.push(rule); }
      }
    }
    if (index.unanchored.length) {
      for (const rule of index.unanchored) {
        if (!seen.has(rule)) { seen.add(rule); out.push(rule); }
      }
    }
    return out;
  }

  /**
   * The static tier's answer for one request: the winning block, or null.
   * Precedence is the engine's compareRule: highest priority first, then the
   * action order (allow < block), then ruleset order, then rule id. Our
   * ruleset is a single static ruleset, so the tie-break that matters is
   * priority then id.
   *
   * Returning the rule (not just true) is what lets the caller classify the
   * item the way the residual path classifies its own: by priority band and
   * by the list the rule came from.
   */
  function staticWinnerFor(candidates, request) {
    let best = null;
    for (const rule of candidates) {
      if (!staticMatch(rule, request)) continue;
      if (best === null) {
        best = rule;
        continue;
      }
      const bp = best.priority || 0;
      const rp = rule.priority || 0;
      if (rp > bp || (rp === bp && (rule.id || 0) < (best.id || 0))) best = rule;
    }
    return best;
  }

  return {
    SEPARATOR_CHARS: SEPARATOR_RE,
    SUBRESOURCE_TYPES,
    isSeparatorChar,
    appendVirtualSeparator,
    domainAnchors,
    parseUrlFilter,
    matchUrlFilter,
    staticMatch,
    buildStaticIndex,
    staticCandidates,
    staticWinnerFor,
    requestHost,
    initiatorDomainChain,
    domainMatches,
    sameOrSubdomain,
  };
});
