/** Ziy shields — Adblock Plus / uBlock-Origin filter-list parser.
 *
 * manifest.json in this directory is PURE JSON, by necessity: the engine's
 * JSON.parse of a manifest carrying a comment header fails silently and the
 * whole add-on is dropped from extensions.json with no diagnostic anywhere.
 * That failure cost real debugging time, so the manifest's rationale lives here
 * (and in test/manifest.test.js and replica/proofs-shields.md) instead:
 *   - MV3 with background.scripts, and service_worker declared alongside per
 *     MDN's cross-browser recipe, because Gecko does not implement
 *     background.service_worker (Firefox bug 1573659)
 *   - the blocking engine is declarativeNetRequest + blocking webRequest, and
 *     webRequestBlocking's presence on Gecko is verified from the engine's own
 *     modules/Schemas.sys.mjs and ext-webRequest.js
 *   - content-script match patterns must be full MatchPattern forms
 *     (a wildcard host and a wildcard path, never a bare host)
 *
 * Reads the public EasyList-family syntax:
 *   network rules    ||domain^$opt=val, |anchor|, /regex/, *wildcard*, ^separator
 *   exceptions       @@rule
 *   cosmetic rules   domain##selector , domain#@#selector , #?#extended syntax
 *   resource types   $script $image $stylesheet $subdocument $xmlhttprequest ...
 *   domain options   $domain=a|b|~c , $third-party , ~third-party , $important
 *
 * Output is a normalised rule table (plain objects, JSON-serialisable), which
 * lib/engine/ compiles into declarativeNetRequest rules. This module is pure:
 * no DOM, no storage, no browser APIs, so the unit tests run under plain node.
 *
 * Design notes that matter for correctness:
 *  - Option values keep their case; option names are lower-cased.
 *  - A rule with $domain= gets parsed into {include:[...], exclude:[...]} so the
 *    engine can map it to DNR's initiatorDomains/excludedInitiatorDomains.
 *  - Cosmetic rules keep their raw selector (extended selectors #?# ... are kept
 *    verbatim; a plain-CSS fallback is computed at inject time by the content
 *    script, not here, because procedural selectors need a real DOM).
 *  - The parser never throws on a malformed line: it records a reason and moves
 *    on. One bad line in a 160k-line list must not cost the other 159,999.
 */

/* ------------------------------------------------------------------ *
 * CLASSIC-SCRIPT RULE (documented at replica/proofs-fix-events.md §2)
 *
 * This file is loaded as a classic <script> in the shared global scope of
 * every background page and extension page that lists it, next to the other
 * lib files of this extension. It therefore declares NOTHING at the top
 * level: the whole body, including every const, class and function, lives
 * inside the factory below. Two files that both declare `parseList` or
 * `localGet` at the top level would otherwise throw at PARSE time
 * ("redeclaration of non-configurable global property"), the engine would
 * discard the whole file, and every listener in it would fail to register —
 * which is exactly defect D-2 in replica/test-report.md.
 *
 * The API is published on the single `ziyShields` namespace this extension
 * shares, and on module.exports when the file is require()d by the unit
 * tests. Both routes expose the same names on the same object.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    /* node's cjs-module-lexer only surfaces ESM named imports when the
     * names are assigned with a literal `exports.NAME =`, so each public
     * name is assigned by hand. measure-residual.cjs and the background
     * page read the same names off the namespace. */
    exports.parseLine = api.parseLine;
    exports.parseList = api.parseList;
    exports.parseListMetadata = api.parseListMetadata;
    exports.findCosmeticSeparator = api.findCosmeticSeparator;
    exports.indexOfUnescapedDollar = api.indexOfUnescapedDollar;
    exports.parseOptions = api.parseOptions;
    exports.RESOURCE_TYPES = api.RESOURCE_TYPES;
  } else {
    root.ziyShields = Object.assign(root.ziyShields || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

/* ------------------------------------------------------------------ *
 * Token tables
 * ------------------------------------------------------------------ */

/** ABP/uBO resource-type names, mapped to our normalised names. */
const RESOURCE_TYPES = new Map([
  ['document', ['document']],
  ['subdocument', ['subdocument']],
  ['main_frame', ['main_frame']],
  ['script', ['script']],
  ['stylesheet', ['stylesheet']],
  ['image', ['image']],
  ['object', ['object']],
  ['object-subrequest', ['object_subrequest']],
  ['object_subrequest', ['object_subrequest']],
  ['xmlhttprequest', ['xmlhttprequest']],
  ['xml_dtd', ['xml_dtd']],
  ['xslt', ['xslt']],
  ['ping', ['ping']],
  ['beacon', ['beacon']],
  ['csp_report', ['csp_report']],
  ['font', ['font']],
  ['media', ['media']],
  ['websocket', ['websocket']],
  ['other', ['other']],
  ['imageset', ['imageset']],
  ['web_manifest', ['web_manifest']],
  ['speculative', ['speculative']],
  ['all', null], // 'all' means "any resource type" -> no condition at all
]);

/** Option names that carry a value (vs. plain flags). */
const VALUE_OPTIONS = new Set(['domain', 'match-case', 'method', 'denyallow', 'redirect', 'rewrite', 'csp']);

/**
 * Parses a single filter-list line into a rule, or returns null.
 *
 * @param {string} line            one raw line (newline already stripped)
 * @param {string} listId          id of the list this line came from
 * @param {number} lineNo          1-based line number, for diagnostics
 * @returns {{rule: object|null, skip: {reason: string}|null}}
 */
function parseLine(line, listId, lineNo) {
  if (typeof line !== 'string') return { rule: null, skip: { reason: 'not-a-string' } };

  // A cosmetic or network rule's raw text, before comments are stripped: an
  // empty/comment/blank line is skipped, but a cosmetic rule may legitimately
  // contain a '!' inside a selector, so trimming must happen per-branch.
  const trimmed = line.trim();
  if (trimmed === '') return { rule: null, skip: { reason: 'blank' } };
  if (trimmed.startsWith('!') || trimmed.startsWith('[')) {
    // Header metadata: [Adblock Plus 2.0] plus '!' comment lines.
    return { rule: null, skip: { reason: 'header-or-comment' } };
  }

  const at = { listId, line: lineNo };

  /* ---------------- cosmetic rules ---------------- */
  // The cosmetic separator is the FIRST '#@#' or '##' occurrence, but only when
  // it is not inside a preceding "prefix selector". EasyList puts the domain
  // part before it:  'example.com,foo.com##.ad'  /  '~example.com#@#.keep'
  // and '#?#...' / '$@$...' style extended selectors may appear on the right.
  const sepIndex = findCosmeticSeparator(trimmed);
  if (sepIndex >= 0) {
    return { rule: parseCosmetic(trimmed, sepIndex, at), skip: null };
  }

  /* ---------------- network rules ---------------- */
  // Options are separated by '$', but only after the first '$' that is not
  // escaped and not inside a regex literal (/.../$opt). Splitting on the last
  // unescaped '$' would be wrong: some lists use '$' inside the filter body.
  const split = splitNetworkRule(trimmed);
  if (!split.ok) return { rule: null, skip: { reason: 'empty-after-split' } };

  const { pattern, optionsText } = split;
  const options = parseOptions(optionsText);
  if (options.invalid) return { rule: null, skip: { reason: 'bad-options:' + options.invalid } };

  const isException = pattern.startsWith('@@');
  const patternText = isException ? pattern.slice(2) : pattern;
  if (patternText === '') return { rule: null, skip: { reason: 'empty-pattern' } };

  // 'denyallow' and friends are uBO extensions EasyList does not use; keep the
  // parse strict but permissive, and let the compiler drop what it cannot map.
  const rule = {
    kind: 'network',
    ...at,
    pattern: patternText,
    isException,
    important: options.flags.has('important'),
    matchCase: options.flags.has('match-case'),
    caseInsensitive: options.flags.has('match-case') === false && undefined,
    resourceTypes: options.resourceTypes.length ? options.resourceTypes : null,
    domain: options.domain,
    thirdParty: options.thirdParty,
    popup: options.flags.has('popup'),
  };

  return { rule, skip: null };
}

/* ------------------------------------------------------------------ *
 * Cosmetic rules
 * ------------------------------------------------------------------ */

/**
 * Finds the index of the cosmetic separator in a line, or -1.
 * Handles '##', '#@#' and the uBO extended-selector forms '#?#', '#$#', '#@$',
 * '#%#', '#*#', which some lists use on their own (no leading domain list).
 */
function findCosmeticSeparator(line) {
  // The separator must appear before any '$options' section.
  const dollarIndex = indexOfUnescapedDollar(line);
  const limit = dollarIndex >= 0 ? dollarIndex : line.length;

  let best = -1;
  let bestLen = 0;
  const CANDIDATES = ['#@#', '##', '#?#', '#$#', '#@$', '#%#', '#*#'];
  for (const cand of CANDIDATES) {
    const idx = line.indexOf(cand);
    if (idx >= 0 && idx < limit && (best < 0 || idx < best || (idx === best && cand.length > bestLen))) {
      if (best < 0 || idx < best) { best = idx; bestLen = cand.length; }
      else if (cand.length > bestLen) { bestLen = cand.length; }
    }
  }
  return best;
}

function parseCosmetic(line, sepIndex, at) {
  const left = line.slice(0, sepIndex);
  // Recover which separator matched at this index, longest first so that
  // '#@#' wins over '##' when both could start there.
  const SEPARATORS = ['#@#', '#?#', '#$#', '#@$', '#%#', '#*#', '##'];
  let sep = '##';
  for (const cand of SEPARATORS) {
    if (line.startsWith(cand, sepIndex)) { sep = cand; break; }
  }
  let right = line.slice(sepIndex + sep.length);

  // The separator itself may be an extended-selector marker ('#?#sel' etc.).
  // In that case the line's right side is the whole selector and the line's
  // left side is empty (generic), which is what parseCosmetic already expects.

  // 'left' is a comma-separated domain list; entries may be prefixed with '~'
  // (exclude) or '-' (legacy exclude). An empty left means "every domain".
  const domains = [];
  const excluded = [];
  if (left.trim() !== '') {
    const parts = left.split(',');
    let sawExclude = false;
    for (const raw of parts) {
      const d = raw.trim().toLowerCase();
      if (d === '') continue;
      if (d[0] === '~' || d[0] === '-') {
        excluded.push(d.slice(1));
        sawExclude = true;
      } else {
        domains.push(d);
      }
    }
    // In ABP, 'a.com,~b.com##sel' means "on a.com but not on b.com".
    if (domains.length === 0 && excluded.length > 0 && sawExclude) {
      domains.push('*');
    }
  } else {
    domains.push('*');
  }

  const selector = right.trim();
  if (selector === '') return null;

  const isException = sep === '#@#';

  return {
    kind: 'cosmetic',
    ...at,
    domains,
    excludedDomains: excluded,
    isException,
    selector,
  };
}

/* ------------------------------------------------------------------ *
 * Network rule splitting
 * ------------------------------------------------------------------ */

/** Index of the first '$' that starts the options section, or -1. */
function indexOfUnescapedDollar(line) {
  let inCharClass = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { i++; continue; }
    if (c === '[') inCharClass = true;
    else if (c === ']') inCharClass = false;
    else if (c === '$' && !inCharClass) return i;
  }
  return -1;
}

function splitNetworkRule(line) {
  const dollarIndex = indexOfUnescapedDollar(line);
  const pattern = dollarIndex < 0 ? line : line.slice(0, dollarIndex);
  const optionsText = dollarIndex < 0 ? '' : line.slice(dollarIndex + 1);
  return { ok: pattern !== '', pattern, optionsText };
}

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

function parseOptions(text) {
  const flags = new Set();
  const resourceTypes = [];
  const domain = { include: [], exclude: [] };
  let thirdParty = null;           // true = $third-party, false = ~third-party, null = unset
  let invalid = null;

  if (text.trim() === '') {
    return { flags, resourceTypes, domain, thirdParty, invalid: null };
  }

  // Options are comma-separated, BUT $domain=a|b|c is one option whose value is
  // pipe-separated. So we split on commas first and then, for a `domain`
  // option, split its value on pipes — splitting the whole options string on
  // both separators would turn a $domain=a|b into two options (`domain=a` and
  // a bare `b`) and silently drop the second domain.
  const tokens = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === ',') { tokens.push(current); current = ''; continue; }
    current += c;
  }
  tokens.push(current);

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token === '') continue;

    // Negated or valued option: '~name' or 'name=value'
    let negated = false;
    let name = token;
    let value = null;
    const eq = token.indexOf('=');
    if (eq >= 0) {
      name = token.slice(0, eq);
      value = token.slice(eq + 1);
    }
    if (name.startsWith('~')) {
      negated = true;
      name = name.slice(1);
    }
    name = name.toLowerCase();
    if (name === '') { invalid = 'empty-option-name'; continue; }

    if (value !== null && !VALUE_OPTIONS.has(name)) {
      // Unknown valued option: keep it as a flag-ish record but do not fail.
      // EasyList currently emits no such token; this keeps the parser open.
      flags.add(name + '=' + value);
      continue;
    }

    if (name === 'domain') {
      if (value === null) { invalid = 'domain-without-value'; continue; }
      // $domain=a.com|~b.com  ->  include [a.com], exclude [b.com]
      for (const rawPart of value.split('|')) {
        const part = rawPart.trim().toLowerCase();
        if (part === '') continue;
        if (part[0] === '~') domain.exclude.push(part.slice(1));
        else if (part === 'domain' || part === '*' || part === 'self') {
          // 'self' = the document's own domain; '*' = any (no-op)
          domain.include.push(part);
        } else domain.include.push(part);
      }
      continue;
    }

    if (name === 'third-party' || name === '3p') {
      thirdParty = !negated;
      continue;
    }
    if (name === '1p') {
      // $1p == ~$third-party: first-party request
      thirdParty = false;
      continue;
    }
    if (name === 'strict3p' || name === '3p-strict') {
      // Strict third party: third-party unless the registrable domain matches
      // an allowlisted entry. We treat it as third-party (the safe direction).
      thirdParty = !negated;
      continue;
    }

    if (name === 'match-case') {
      flags.add('match-case');
      continue;
    }

    if (name === 'important') {
      flags.add('important');
      continue;
    }

    if (name === 'all' && value === null) {
      // '$all' with no negation: matches every resource type -> keep the list
      // empty so the compiler emits no resourceTypes condition.
      if (!negated) continue;
    }

    const mapped = RESOURCE_TYPES.get(name);
    if (mapped !== undefined) {
      if (mapped === null) continue;            // 'all': no condition
      if (negated) {
        // Negative resource type. DNR cannot express "all types except X" for
        // block rules (excludedResourceTypes only accepts a list of exclusions
        // and main_frame is implicitly excluded anyway), so we keep it as a
        // flag and let the compiler decide.
        for (const t of mapped) flags.add('not:' + t);
      } else {
        for (const t of mapped) resourceTypes.push(t);
      }
      continue;
    }

    if (name === 'inline-script' || name === 'elemhide' || name === 'jsinject' ||
        name === 'generichide' || name === 'genericblock' || name === 'document' ||
        name === 'popup' || name === 'csp' || name === 'webrtc' || name === 'collapse' ||
        name === 'blocking' || name === 'removeparam' || name === 'redirect-rule' ||
        name === 'method' || name === 'denyallow' || name === 'redirect' ||
        name === 'rewrite' || name === 'content') {
      flags.add(name);
      continue;
    }

    // '~' negations of the text-only options above, and anything unknown.
    if (negated) { flags.add('not:' + name); continue; }
    flags.add(name);
  }

  return { flags, resourceTypes, domain, thirdParty, invalid };
}

/* ------------------------------------------------------------------ *
 * Bulk parsing
 * ------------------------------------------------------------------ */

/**
 * Parses a whole list body.
 *
 * @param {string} text    raw list text
 * @param {string} listId  id to stamp on every rule
 * @returns {{rules: object[], stats: object}}
 */
function parseList(text, listId) {
  const rules = [];
  const stats = {
    lines: 0, network: 0, cosmetic: 0, exceptions: 0,
    skipped: 0, invalid: 0, cosmeticByDomain: 0,
    skipReasons: {},
  };
  if (typeof text !== 'string' || text === '') return { rules, stats };

  let lineNo = 0;
  for (const rawLine of text.split('\n')) {
    lineNo++;
    stats.lines++;
    const { rule, skip } = parseLine(rawLine, listId, lineNo);
    if (rule) {
      if (rule.kind === 'network') {
        stats.network++;
        if (rule.isException) stats.exceptions++;
      } else {
        stats.cosmetic++;
        if (rule.domains.length === 1 && rule.domains[0] !== '*') stats.cosmeticByDomain++;
      }
      rules.push(rule);
    } else if (skip) {
      if (skip.reason === 'blank' || skip.reason === 'header-or-comment') {
        stats.skipped++;
      } else {
        stats.invalid++;
      }
      stats.skipReasons[skip.reason] = (stats.skipReasons[skip.reason] || 0) + 1;
    }
  }
  return { rules, stats };
}

/**
 * Extracts list metadata from a header (name, homepage, licence, checksum,
 * version). Public lists carry these as '!' comments; we read them once at
 * update time and keep them in the list registry.
 */
function parseListMetadata(text) {
  const meta = {};
  if (typeof text !== 'string') return meta;
  let scanned = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('!')) {
      const m = /^!\s*([A-Za-z][A-Za-z0-9 _-]*)\s*:\s*(.+)$/.exec(t);
      if (m) {
        const key = m[1].trim().toLowerCase().replace(/\s+/g, '-');
        meta[key] = m[2].trim();
      }
      continue;
    }
    if (t.startsWith('[')) { if (++scanned > 3) break; continue; }
    // Past the header: the first real rule ends the metadata block.
    break;
  }
  return meta;
}

  return {
    parseLine,
    parseList,
    parseListMetadata,
    findCosmeticSeparator,
    indexOfUnescapedDollar,
    parseOptions,
    RESOURCE_TYPES,
  };
});
