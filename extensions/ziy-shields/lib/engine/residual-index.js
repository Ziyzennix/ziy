/* Ziy shields — the webRequest path's rule index.
 *
 * The static tier is capped at 30,000 rules by the engine's own quota
 * (ExtensionDNRStore's RuleQuotaCounter drops an over-cap ruleset entirely), so
 * the EasyList family's remaining ~87,000 rules are covered by the imperative
 * webRequest path instead.
 *
 * A linear scan over 87k rules is not viable — measured on this machine at
 * >300 s for 3,000 synthetic tracker URLs, i.e. far past any request budget —
 * so the residual is indexed by domain. The three shapes a rule can take:
 *
 *   1. domain-anchored  (||domain^...)   -> bucketed by that domain
 *   2. left-anchored    (|https://...)   -> a URL-prefix trie is not worth the
 *                                          complexity; these are few
 *   3. substring        (plain, no |)    -> a host-side token scan
 *
 * A request only tests the buckets it can possibly match: the exact host, its
 * parent domains, the substring rules, and the left-anchored ones. That keeps
 * the per-request work proportional to the rules that could matter.
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
    exports.buildIndex = api.buildIndex;
    exports.candidates = api.candidates;
    exports.describe = api.describe;
    exports.anchorDomain = api.anchorDomain;
    exports.hostAndParents = api.hostAndParents;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

'use strict';

/**
 * @typedef {object} ResidualIndex
 * @property {Map<string, object[]>} byDomain   exact host -> rules anchored there
 * @property {object[]} substring   rules with no anchor
 * @property {object[]} anchored    left-anchored rules
 * @property {number} total         total rules indexed
 */

/**
 * The domain an anchored rule applies to, or null for a non-anchored rule.
 * '||a.example.com/ads' -> 'a.example.com'; '||a.example.com^' -> same.
 *
 * @param {string} pattern
 * @returns {string|null}
 */
function anchorDomain(pattern) {
  if (!pattern.startsWith('||')) return null;
  const m = /^\|\|([^/^*?|]+)/.exec(pattern);
  if (!m) return null;
  const host = m[1];
  // A bare '||' followed by nothing usable is not an anchor.
  if (host === '') return null;
  return host.toLowerCase();
}

/** A request URL's host and its parent domains, longest first. */
function hostAndParents(host) {
  const parts = host.split('.');
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(i).join('.'));
  }
  return out;
}

/**
 * Builds the index for the residual rules.
 *
 * @param {object[]} rules parsed network rules (kind 'network')
 * @returns {ResidualIndex}
 */
function buildIndex(rules) {
  const byDomain = new Map();
  const substring = [];
  const anchored = [];
  let total = 0;

  for (const rule of rules) {
    if (!rule || rule.kind !== 'network') continue;
    total++;
    const domain = anchorDomain(rule.pattern);
    if (domain) {
      let bucket = byDomain.get(domain);
      if (!bucket) { bucket = []; byDomain.set(domain, bucket); }
      bucket.push(rule);
    } else if (rule.pattern.startsWith('|')) {
      anchored.push(rule);
    } else {
      substring.push(rule);
    }
  }
  return { byDomain, substring, anchored, total };
}

/**
 * The candidate rules for a request: the exact host, its parents, plus the two
 * unanchored groups. The caller then runs the full ABP match on this much
 * smaller set.
 *
 * @param {ResidualIndex} index
 * @param {string} url  the request URL
 * @param {string} host the request's host, already lower-cased
 * @returns {object[]}
 */
function candidates(index, url, host) {
  const out = [];
  if (host) {
    for (const domain of hostAndParents(host)) {
      const bucket = index.byDomain.get(domain);
      if (bucket) {
        for (const rule of bucket) out.push(rule);
        // A bucket keyed on a parent domain also covers the subdomains, so stop
        // once one matched: ||example^ covers a.example.
        break;
      }
    }
  }
  for (const rule of index.anchored) out.push(rule);
  for (const rule of index.substring) out.push(rule);
  return out;
}

/** How many rules are in each group, for the diagnostics the options page shows. */
function describe(index) {
  const domains = index.byDomain.size;
  const anchoredDomains = [...index.byDomain.values()].reduce((a, b) => a + b.length, 0);
  return {
    total: index.total,
    domains,
    anchoredDomains,
    substring: index.substring.length,
    leftAnchored: index.anchored.length,
  };
}


  return {
    buildIndex,
    candidates,
    describe,
    anchorDomain,
    hostAndParents,
  };
});
