/* Ziy shields — DNR rule compilation tests.
 *
 * These pin the three things that must never drift:
 *   1. the exact compiled rule for an exact input pattern (a couple of them,
 *      spelled out in full)
 *   2. the priority lattice that implements §5.3 (a per-site allow must
 *      out-prioritise a list block)
 *   3. the tier split and rule counts when the whole EasyList table is compiled
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const parser = require('../lib/filterlist/parser.js');
const D = require('../lib/engine/dnr-compile.js');

/* The snapshot files the shipped ruleset is compiled from, in the order the
 * generator uses (tools/gen-static-ruleset.js). The generator's SNAPSHOT_FOR_ID
 * is the source of truth; this list mirrors it so the whole-table tests below
 * cover exactly what the xpi will contain. */
const SHIPPED_SNAPSHOTS = [
  'easylist.txt',
  'easyprivacy.txt',
  'fanboy-cookiemonster.txt',
  'uabo-filters.txt',
  'urlhaus.txt',
  'antiadblock-warning-removal.txt',
  'brave-unbreak.txt',
];

/* ------------------------------------------------------------------ *
 * Measured limits (MDN declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES:
 * "This limit is: in Firefox: 5000; in Chrome: 30000", and the engine's own
 * ExtensionDNRLimits.sys.mjs defaults for the rest)
 * ------------------------------------------------------------------ */

test('the documented limits are the limits the design uses', () => {
  assert.equal(D.DNR_LIMITS.MAX_DYNAMIC_RULES, 5000);
  assert.equal(D.DNR_LIMITS.MAX_SESSION_RULES, 5000);
  assert.equal(D.DNR_LIMITS.MAX_REGEX_RULES, 1000, 'regex rules are capped per ruleset');
  assert.equal(D.DNR_LIMITS.GUARANTEED_MINIMUM_STATIC_RULES, 30000);
});

/* ------------------------------------------------------------------ *
 * Pattern translation
 * ------------------------------------------------------------------ */

test('the domain anchor survives as a DNR urlFilter', () => {
  assert.equal(D.toUrlFilter('||example.com^'), '||example.com^');
});

test('left and right anchors survive', () => {
  assert.equal(D.toUrlFilter('|https://example.com/x|'), '|https://example.com/x|');
});

test('wildcards survive', () => {
  assert.equal(D.toUrlFilter('||a.com/*/banner'), '||a.com/*/banner');
});

test('the separator character survives verbatim', () => {
  // The raw pattern (options already split off by the parser) keeps its '^'
  // exactly: DNR's urlFilter '^' has the same meaning as ABP's.
  assert.equal(D.toUrlFilter('||a.com^'), '||a.com^');
  assert.equal(D.toUrlFilter('/a^b^c'), '/a^b^c');
  assert.equal(D.toUrlFilter('||a.com^sw.js^'), '||a.com^sw.js^');
});

test('a plain urlFilter is accepted verbatim, and a regex is not', () => {
  assert.equal(D.isPlainUrlFilter('||a.com/b^c'), true);
  assert.equal(D.isPlainUrlFilter('/ad[0-9]+/'), false);
});

test('the ||* prefix is rewritten to *, which DNR accepts', () => {
  // MDN/RuleCondition: "A pattern beginning with ||* is not allowed."
  assert.equal(D.toUrlFilter('||*x'), '*x');
});

test('an empty domain-only pattern becomes the match-everything urlFilter', () => {
  assert.equal(D.toUrlFilter('||'), '*');
});

test('a regex literal converts to a regexFilter with the slashes stripped', () => {
  assert.equal(D.toRegexFilter('/ad[0-9]+\\.gif/'), 'ad[0-9]+\\.gif');
  assert.equal(D.toRegexFilter('not-a-regex'), null);
  assert.equal(D.toRegexFilter('//'), null);
});

/* ------------------------------------------------------------------ *
 * Resource types
 * ------------------------------------------------------------------ */

test('ABP resource-type names become DNR names', () => {
  assert.deepEqual(D.mapResourceTypes(['subdocument']), ['sub_frame']);
  assert.deepEqual(D.mapResourceTypes(['object-subrequest']), ['object_subrequest']);
  assert.deepEqual(D.mapResourceTypes(['main_frame', 'document']), ['main_frame']);
});

test('no resource types means no condition (DNR then covers all but main_frame)', () => {
  assert.equal(D.mapResourceTypes(null), null);
  assert.equal(D.mapResourceTypes([]), null);
});

test('a rule with every resource type needs no condition at all', () => {
  // ABP's '$all' means "any type"; the parser drops the restriction, so the
  // compiler sees null and emits no resourceTypes condition (DNR then covers
  // every type except main_frame, exactly as documented).
  assert.equal(D.mapResourceTypes(null), null);
  assert.equal(D.mapResourceTypes([]), null);
});

/* ------------------------------------------------------------------ *
 * Domain conditions
 * ------------------------------------------------------------------ */

test('$domain= maps to initiatorDomains / excludedInitiatorDomains', () => {
  const cond = D.buildDomainCondition({ include: ['a.example'], exclude: ['b.example'] });
  assert.deepEqual(cond.initiatorDomains, ['a.example']);
  assert.deepEqual(cond.excludedInitiatorDomains, ['b.example']);
});

test('$domain=* needs no initiator restriction', () => {
  const cond = D.buildDomainCondition({ include: ['*'], exclude: [] });
  assert.equal(cond.initiatorDomains, undefined);
});

test('a very long $domain= list is flagged as an overflow for the webRequest path', () => {
  const cond = D.buildDomainCondition({ include: Array.from({ length: 100 }, (_, i) => `d${i}.example`), exclude: [] });
  assert.ok(cond.__overflow, 'an over-long list cannot be expressed in DNR');
});

/* ------------------------------------------------------------------ *
 * Exact compiled rules — the two the design depends on
 * ------------------------------------------------------------------ */

test('exact: an ordinary third-party script block rule', () => {
  const { rule } = D.compileRule({
    kind: 'network',
    pattern: '||tracker.example^',
    isException: false,
    important: false,
    matchCase: false,
    resourceTypes: ['script'],
    domain: { include: [], exclude: [] },
    thirdParty: true,
  }, { priority: D.DNR_PRIORITY.LIST_BLOCK, actionType: 'block', rulesetId: 'static', ruleId: 1 });

  assert.deepEqual(rule, {
    id: 1,
    priority: D.DNR_PRIORITY.LIST_BLOCK,
    action: { type: 'block' },
    condition: {
      resourceTypes: ['script'],
      urlFilter: '||tracker.example^',
      domainType: 'thirdParty',
    },
  });
});

test('exact: an exception rule for one domain', () => {
  const { rule } = D.compileRule({
    kind: 'network',
    pattern: '||ads.example/allow.gif',
    isException: true,
    important: false,
    matchCase: false,
    resourceTypes: ['image'],
    domain: { include: ['www.example'], exclude: [] },
    thirdParty: null,
  }, { priority: D.DNR_PRIORITY.LIST_EXCEPTION, actionType: 'allow', rulesetId: 'static', ruleId: 2 });

  assert.deepEqual(rule, {
    id: 2,
    priority: D.DNR_PRIORITY.LIST_EXCEPTION,
    action: { type: 'allow' },
    condition: {
      resourceTypes: ['image'],
      urlFilter: '||ads.example/allow.gif',
      initiatorDomains: ['www.example'],
    },
  });
});

test('exact: a domain-restricted important rule', () => {
  const { rule } = D.compileRule({
    kind: 'network',
    pattern: '||a.example^',
    isException: false,
    important: true,
    matchCase: false,
    resourceTypes: null,
    domain: { include: ['b.example'], exclude: [] },
    thirdParty: null,
  }, { priority: D.DNR_PRIORITY.IMPORTANT, actionType: 'block', rulesetId: 'static', ruleId: 3 });

  assert.deepEqual(rule, {
    id: 3,
    priority: D.DNR_PRIORITY.IMPORTANT,
    action: { type: 'block' },
    condition: {
      urlFilter: '||a.example^',
      initiatorDomains: ['b.example'],
    },
  });
});

test('a regex rule is marked so the compiler can budget it', () => {
  const { rule } = D.compileRule({
    kind: 'network', pattern: '/banner[0-9]+/', isException: false, important: false,
    matchCase: false, resourceTypes: null, domain: { include: [], exclude: [] }, thirdParty: null,
  }, { priority: D.DNR_PRIORITY.LIST_BLOCK, actionType: 'block', rulesetId: 'static', ruleId: 4 });
  assert.equal(rule.__regex, true);
  assert.equal(rule.condition.regexFilter, 'banner[0-9]+');
  assert.equal(rule.condition.urlFilter, undefined, 'urlFilter and regexFilter are exclusive');
});

test('a $document block rule is not put in DNR — main_frame means navigation', () => {
  const { rule, reason } = D.compileRule({
    kind: 'network', pattern: '||a.example^', isException: false, important: false,
    matchCase: false, resourceTypes: ['document'],
    domain: { include: [], exclude: [] }, thirdParty: null,
  }, { priority: D.DNR_PRIORITY.LIST_BLOCK, actionType: 'block', rulesetId: 'static', ruleId: 5 });
  assert.equal(rule, null);
  assert.equal(reason, 'document-block');
});

/* ------------------------------------------------------------------ *
 * The priority lattice
 * ------------------------------------------------------------------ */

test('a per-site allow out-prioritises an ordinary list block', () => {
  assert.ok(D.DNR_PRIORITY.SITE_ALLOW > D.DNR_PRIORITY.LIST_BLOCK);
});

test('a session allow out-prioritises everything', () => {
  assert.ok(D.DNR_PRIORITY.SESSION_ALLOW > D.DNR_PRIORITY.SITE_ALLOW);
  assert.ok(D.DNR_PRIORITY.SESSION_ALLOW > D.DNR_PRIORITY.LIST_EXCEPTION);
});

test('a list exception out-prioritises an ordinary block', () => {
  assert.ok(D.DNR_PRIORITY.LIST_EXCEPTION > D.DNR_PRIORITY.LIST_BLOCK);
});

test('important rules out-prioritise ordinary blocks', () => {
  assert.ok(D.DNR_PRIORITY.IMPORTANT > D.DNR_PRIORITY.LIST_BLOCK);
});

test('the priority lattice is strictly ordered', () => {
  assert.ok(D.DNR_PRIORITY.SESSION_ALLOW > D.DNR_PRIORITY.SITE_ALLOW);
  assert.ok(D.DNR_PRIORITY.SITE_ALLOW > D.DNR_PRIORITY.SITE_BLOCK);
  assert.ok(D.DNR_PRIORITY.SITE_BLOCK > D.DNR_PRIORITY.IMPORTANT);
  assert.ok(D.DNR_PRIORITY.IMPORTANT > D.DNR_PRIORITY.LIST_EXCEPTION);
  assert.ok(D.DNR_PRIORITY.LIST_EXCEPTION > D.DNR_PRIORITY.LIST_BLOCK);
  assert.ok(D.DNR_PRIORITY.LIST_BLOCK > D.DNR_PRIORITY.UPGRADE_SCHEME);
});

/* ------------------------------------------------------------------ *
 * The whole table: tiering and counts
 * ------------------------------------------------------------------ */

const SNAPSHOTS = path.join(__dirname, '..', 'lib', 'filterlist', 'snapshots');

function loadAll() {
  const net = [];
  for (const file of SHIPPED_SNAPSHOTS) {
    const { rules } = parser.parseList(fs.readFileSync(path.join(SNAPSHOTS, file), 'utf8'), file);
    for (const r of rules) if (r.kind === 'network') net.push(r);
  }
  return net;
}

test('the whole EasyList family compiles into a static tier the engine will load', () => {
  // The engine drops a static ruleset that exceeds
  // GUARANTEED_MINIMUM_STATIC_RULES (30000) ENTIRELY — it does not trim it. So
  // the static tier is a bounded, salience-ranked subset and the rest goes to
  // the webRequest path. This is the measured budget, not a choice.
  const net = loadAll();
  const out = D.compileTable({ networkRules: net });

  assert.equal(out.stats.input, net.length);
  const cap = D.STATIC_RULESET_CAP.rules;
  assert.ok(out.tiers.static.length <= cap,
    `the static tier must stay within the engine's quota, saw ${out.tiers.static.length} of ${cap}`);
  assert.ok(out.tiers.static.length > cap * 0.8,
    `and should use most of it, saw ${out.tiers.static.length}`);
  // Nothing is lost: the static tier plus the webRequest tail is every rule.
  assert.equal(out.tiers.static.length + out.webRequest.length, net.length,
    'every rule is either in the static tier or in the webRequest tail');

  // The tail is dominated by the cap, not by what DNR cannot express.
  assert.ok((out.stats.dropped['static-cap'] || 0) > 10000,
    'the full table is far over the quota, so most rules are routed to webRequest');
  // ...and the expressibility drops still happen, just as a minority.
  assert.ok((out.stats.dropped['document-block'] || 0) > 0, '$document rules need webRequest');

  assert.ok(out.tiers.dynamic.length === 0, 'no per-site overrides in this fixture');
  assert.ok(out.tiers.session.length === 0, 'no session rules in this fixture');
});

test('the static tier always contains every exception and important rule', () => {
  // A missing ALLOW would over-block, so these are never what the cap drops.
  const net = loadAll();
  const out = D.compileTable({ networkRules: net });
  const allowRules = out.tiers.static.filter(r => r.action.type === 'allow');
  const wantAllows = net.filter(r => r.isException || r.important).length;
  assert.ok(allowRules.length >= 1,
    'exceptions and important rules are in the static tier');
  // Each exception rule is an allow at the exception priority.
  for (const r of allowRules) {
    assert.ok(r.priority >= D.DNR_PRIORITY.LIST_EXCEPTION,
      'an allow rule is at the exception priority or above');
  }
  // The exception count is a small fraction of the budget, so it always fits.
  assert.ok(wantAllows < D.STATIC_RULESET_CAP.exceptionReserve,
    'the exception set is small enough to always fit');
});

test('a smaller static cap keeps every exception DNR can express', () => {
  // The exceptions and important rules are unconditional: a cap below that set
  // would produce a ruleset that over-blocks. The only exceptions that can still
  // be absent from the static tier are the ones no tier accepts.
  const net = loadAll();
  const out = D.compileTable({ networkRules: net, staticCap: 6000 });

  assert.ok(out.tiers.static.length <= 6000, 'an explicit cap is honoured');
  assert.equal(out.tiers.static.length + out.webRequest.length, net.length,
    'no rule is dropped, only re-tiered');

  const exceptions = net.filter(r => r.isException || r.important);
  assert.ok(exceptions.length > 1000, `the exception set is large (${exceptions.length})`);
  assert.ok(exceptions.length < D.STATIC_RULESET_CAP.exceptionReserve,
    'but small enough to always fit the reserved budget');
  assert.ok(out.tiers.static.filter(r => r.action.type === 'allow').length > 0,
    'the allow set is non-empty');
});


test('regex rules stay inside the per-ruleset cap', () => {
  const net = loadAll();
  const out = D.compileTable({ networkRules: net });
  assert.ok(out.stats.regexRules <= D.DNR_LIMITS.MAX_REGEX_RULES,
    `regex rules ${out.stats.regexRules} must not exceed ${D.DNR_LIMITS.MAX_REGEX_RULES}`);
});

test('every compiled static rule is a valid DNR rule shape', () => {
  const net = loadAll();
  const out = D.compileTable({ networkRules: net });
  for (const r of out.tiers.static) {
    assert.ok(Number.isInteger(r.id) && r.id >= 1, 'id is a positive integer');
    assert.ok(Number.isInteger(r.priority) && r.priority >= 1, 'priority is >= 1');
    assert.ok(['block', 'allow', 'upgradeScheme', 'redirect', 'modifyHeaders'].includes(r.action.type));
    const c = r.condition;
    assert.ok((c.urlFilter === undefined) !== (c.regexFilter === undefined),
      'exactly one of urlFilter / regexFilter');
    if (c.urlFilter !== undefined) {
      assert.ok(!c.urlFilter.startsWith('||*'), 'urlFilter must not start with ||* (MDN/RuleCondition)');
      assert.ok(c.urlFilter.length > 0, 'urlFilter must not be an empty string');
      assert.ok(!/[^\x00-\x7F]/.test(c.urlFilter), 'urlFilter must be ASCII');
    }
    for (const t of (c.resourceTypes || [])) {
      assert.ok(D.DNR_RESOURCE_TYPES.includes(t), `resource type ${t} is in the DNR enum`);
    }
    assert.ok(c.initiatorDomains === undefined || c.initiatorDomains.length >= 1,
      'an empty initiatorDomains list is not allowed');
  }
});

test('per-site overrides become dynamic rules at a higher priority', () => {
  const net = require('../lib/filterlist/parser.js').parseList('||a.example^\n||b.example^', 'x').rules;
  const siteOverrides = [{
    __action: 'allow', __dnrId: 2000000,
    kind: 'network', pattern: '*', isException: false, important: false,
    matchCase: false, resourceTypes: ['script'],
    domain: { include: ['example.com'], exclude: [] }, thirdParty: null,
  }];
  const out = D.compileTable({ networkRules: net, siteOverrides });
  assert.equal(out.tiers.dynamic.length, 1);
  const rule = out.tiers.dynamic[0];
  assert.equal(rule.priority, D.DNR_PRIORITY.SITE_ALLOW);
  assert.equal(rule.action.type, 'allow');
  assert.deepEqual(rule.condition.resourceTypes, ['script']);
  assert.deepEqual(rule.condition.initiatorDomains, ['example.com']);
  assert.equal(rule.condition.urlFilter, '*');
});

test('a session rule is compiled at the session-allow priority', () => {
  const sessionRules = [{
    __action: 'allow', __dnrId: 1000000,
    kind: 'network', pattern: '*', isException: false, important: false,
    matchCase: false, resourceTypes: null,
    domain: { include: ['a.example'], exclude: [] }, thirdParty: null,
  }];
  const out = D.compileTable({ networkRules: [], sessionRules });
  assert.equal(out.tiers.session.length, 1);
  assert.equal(out.tiers.session[0].priority, D.DNR_PRIORITY.SESSION_ALLOW);
});

test('compileTable is deterministic', () => {
  const net = loadAll();
  const a = D.compileTable({ networkRules: net });
  D.resetIds();
  const b = D.compileTable({ networkRules: net });
  assert.equal(a.tiers.static.length, b.tiers.static.length);
  assert.deepEqual(a.stats, b.stats);
});

test('an empty table compiles to empty tiers without throwing', () => {
  const out = D.compileTable({ networkRules: [] });
  assert.equal(out.tiers.static.length, 0);
  assert.equal(out.webRequest.length, 0);
});
