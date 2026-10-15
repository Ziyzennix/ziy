/* Ziy shields — the cosmetic filter table: element hiding and the block-element
 * tool (recon S12, F05).
 *
 * Cosmetic rules hide elements instead of cancelling requests, so they are a
 * separate table keyed by domain and injected as a stylesheet. The content
 * script asks for a domain's selectors and installs one <style> per group.
 *
 * Two kinds of rule are kept, and only one is safe to inject verbatim:
 *   - plain CSS selectors  (example.com##.ad) — injected directly.
 *   - extended/procedural selectors (example.com#?#div:has(> .x), :contains(),
 *     :xpath(...)) — cannot be a stylesheet. These are marked
 *     extended:true and the content script evaluates them with the DOM it has.
 *
 * Generic rules (no domain part) are shared across all sites; per-domain rules
 * override a generic rule of the same selector only when an exception exists.
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
    exports.PROTOCOL = api.PROTOCOL;
    exports.makeEntry = api.makeEntry;
    exports.isExtendedSelector = api.isExtendedSelector;
    exports.buildForDomain = api.buildForDomain;
    exports.buildStyleText = api.buildStyleText;
    exports.userRule = api.userRule;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

'use strict';

const PROTOCOL = 'ziy-shields:';

/** All selectors are stored in this shape; `extended` is the only flag. */
function makeEntry(domain, selector, isException, createdAt) {
  return {
    domain: domain === '*' ? '*' : domain,
    selector,
    isException: isException === true,
    extended: isExtendedSelector(selector),
    createdAt: createdAt || Date.now(),
  };
}

/**
 * True for the uBO extended-selector forms: the selector needs a real DOM (or a
 * procedural :has-text/:xpath evaluation) to work.
 */
function isExtendedSelector(selector) {
  return /^[:]?(xpath|has|has-text|contains|matches-css|matches-attr|upward|nth-ancestor|if|not|if-not|matches-prop|remove|style|min-text-length|watch-attr)\b/i.test(selector)
    || /:(xpath|has-text|contains|matches-css|matches-attr|upward|nth-ancestor|matches-prop|min-text-length)\s*\(/i.test(selector);
}

/**
 * Groups a cosmetic table by domain for one site.
 * @param {Array} entries the whole table (already filtered to the enabled lists)
 * @param {string} host  the current document's host
 * @returns {{selectors: string[], exceptions: string[], extended: object[]}}
 */
function buildForDomain(entries, host) {
  const selectors = [];
  const exceptions = [];
  const extended = [];
  const seen = new Set();
  const seenExc = new Set();

  // A per-domain rule beats a generic one, and a generic exception beats a
  // per-domain rule. Within a tier the first rule wins (the user's order).
  const relevant = [];
  for (const entry of entries) {
    if (entry.domain === '*' || entry.domain === host) {
      relevant.push({ ...entry, tier: entry.domain === '*' ? 0 : 1 });
    }
  }
  relevant.sort((a, b) => a.tier - b.tier || a.createdAt - b.createdAt);

  for (const entry of relevant) {
    const key = entry.selector;
    if (entry.extended) {
      // Extended selectors are handed to the content script for evaluation.
      extended.push({ selector: entry.selector, isException: entry.isException, domain: entry.domain });
      continue;
    }
    if (entry.isException) {
      if (!seenExc.has(key)) { seenExc.add(key); exceptions.push(entry.selector); }
      continue;
    }
    if (!seen.has(key)) { seen.add(key); selectors.push(entry.selector); }
  }
  // An exception cancels a hide selector of the same text.
  const excSet = new Set(exceptions);
  return {
    selectors: selectors.filter(s => !excSet.has(s)),
    exceptions,
    extended,
  };
}

/**
 * Builds the CSS text for a domain's non-extended rules. Extended rules are not
 * representable in CSS, so they are returned separately and handled by the
 * content script's DOM evaluation.
 */
function buildStyleText(selectors) {
  if (!selectors.length) return '';
  return selectors.map(s => {
    const trimmed = s.trim();
    // A ':style(...)' cosmetic carries its own declaration.
    if (/^:style\(/i.test(trimmed)) {
      const m = /^:style\(([^)]*)\)\s*(.*)$/i.exec(trimmed);
      if (m) {
        const decl = m[1];
        const sel = m[2].trim();
        if (sel) return `${sel} { ${decl}; }`;
        return '';
      }
    }
    return `${trimmed} { display: none !important; }`;
  }).filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ *
 * block-element rules (recon S12 / F05)
 * ------------------------------------------------------------------ */

/**
 * A user-made "block this element" rule. These are session-scoped by default
 * (the recon's "session override is layer 1 of §5.3"), and can be made
 * permanent.
 *
 * @param {string} host
 * @param {string} selector  a CSS selector for the clicked element
 * @param {boolean} permanent
 */
function userRule(host, selector, permanent) {
  return makeEntry(host, selector, false, Date.now()) &&
    { domain: host, selector, isException: false, permanent: permanent === true, userMade: true };
}

  return {
    PROTOCOL,
    makeEntry,
    isExtendedSelector,
    buildForDomain,
    buildStyleText,
    userRule,
  };
});
