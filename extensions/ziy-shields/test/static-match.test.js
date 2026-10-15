/* Ziy shields — the static DNR tier matcher tests.
 *
 * What these tests are protecting, and why they are worth 30-odd assertions of
 * their own: defect D-7 (replica/test-report.md) shipped a blocked-item count
 * that read 0 on a page whose trackers the static tier stopped, because the
 * counter only watched the webRequest residual tier. The fix counts the static
 * tier by evaluating the shipped ruleset, so the fix is only as honest as the
 * matcher. These tests pin the matcher against the engine's own semantics —
 * taken from ExtensionDNR.sys.mjs's CompiledUrlFilter and RequestEvaluator,
 * not from intuition — and against the REAL ruleset shipped in this repo, so a
 * regression in the matcher is a failing test rather than a silently wrong
 * count in a user's panel.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const S = require('../lib/engine/static-match.js');

const RULESET = path.join(__dirname, '..', 'rules', 'static-ruleset.json');

/** The real shipped ruleset, loaded once. */
const SHIPPED = JSON.parse(fs.readFileSync(RULESET, 'utf8'));
const INDEX = S.buildStaticIndex(SHIPPED);

/** A tiny rule, so a failing case names its condition. */
function rule(condition, priority) {
  return { id: 1, priority: priority || 10, action: { type: 'block' }, condition };
}

/** Ask the matcher the same way the counting listener does. */
function stops(url, type, initiator) {
  const candidates = S.staticCandidates(INDEX, url);
  return S.staticWinnerFor(candidates, { url, type, initiator: initiator || null });
}

/* ------------------------------------------------------------------ *
 * The separator and the domain anchors
 * ------------------------------------------------------------------ */

test('the separator is the engine\'s own class', () => {
  // ExtensionDNR.sys.mjs: static #regexIsSep = /[^A-Za-z0-9_\-.%]/
  assert.equal(S.isSeparatorChar('a'), false);
  assert.equal(S.isSeparatorChar('Z'), false);
  assert.equal(S.isSeparatorChar('0'), false);
  assert.equal(S.isSeparatorChar('_'), false);
  assert.equal(S.isSeparatorChar('-'), false);
  assert.equal(S.isSeparatorChar('.'), false);
  assert.equal(S.isSeparatorChar('%'), false);
  assert.equal(S.isSeparatorChar('/'), true);
  assert.equal(S.isSeparatorChar(':'), true);
  assert.equal(S.isSeparatorChar('?'), true);
  assert.equal(S.isSeparatorChar('&'), true);
  assert.equal(S.isSeparatorChar('='), true);
});

test('the virtual separator is appended to the URL before matching', () => {
  assert.equal(S.appendVirtualSeparator('https://a.test/x'), 'https://a.test/x^');
});

test('domain anchors are every host boundary the engine computes', () => {
  // RequestDataForUrlFilter.#getDomainAnchors: host start, then each offset
  // after a "." inside the host.
  assert.deepEqual(S.domainAnchors('https://a.b.example.com/x^'), [8, 10, 12, 20]);
  assert.deepEqual(S.domainAnchors('https://example.com^'), [8, 16]);
  // Userinfo shifts the host start, exactly as the engine's lastIndexOf("@") does.
  assert.deepEqual(S.domainAnchors('https://u:p@example.com^'), [12, 20]);
});

test('a URL with no scheme has no domain anchors', () => {
  assert.deepEqual(S.domainAnchors('example.com/x^'), []);
});

/* ------------------------------------------------------------------ *
 * The urlFilter predicate, vector by vector
 * ------------------------------------------------------------------ */

/** The engine's matcher over one filter and one URL. */
function m(filter, url) {
  return S.matchUrlFilter(S.parseUrlFilter(filter), S.appendVirtualSeparator(url), S.domainAnchors(S.appendVirtualSeparator(url)));
}

test('a domain anchor matches the host and every subdomain, and nothing else', () => {
  assert.equal(m('||example.com^', 'https://example.com/x'), true);
  assert.equal(m('||example.com^', 'https://a.example.com/x'), true);
  assert.equal(m('||example.com^', 'https://notexample.com/x'), false);
  assert.equal(m('||example.com^', 'https://example.com.evil.test/x'), false);
});

test('a plain substring matches anywhere in the URL', () => {
  assert.equal(m('tracker', 'https://example.com/tracker.js'), true);
  assert.equal(m('tracker', 'https://example.com/app.js'), false);
});

test('the left anchor binds the start of the URL', () => {
  assert.equal(m('|https://cdn.example.com/a.js', 'https://cdn.example.com/a.js'), true);
  assert.equal(m('|https://cdn.example.com/a.js', 'https://other.test/a.js'), false);
});

test('the right anchor binds the end of the URL', () => {
  assert.equal(m('/banner.png|', 'https://example.com/banner.png'), true);
  assert.equal(m('/banner.png|', 'https://example.com/banner.png?v=2'), false);
});

test('^ matches exactly one separator char, or the end of the URL', () => {
  // The ABP meaning the engine keeps: a separator, or nothing at the very end.
  assert.equal(m('||example.com/ads^', 'https://example.com/ads?x=1'), true);
  assert.equal(m('||example.com/ads^', 'https://example.com/ads'), true);
  assert.equal(m('||example.com/ads^', 'https://example.com/adsfoo'), false);
});

test('* is a wildcard that may appear more than once', () => {
  assert.equal(m('||example.com/*/ad.gif', 'https://example.com/a/b/ad.gif'), true);
  assert.equal(m('||example.com/a*c.gif', 'https://example.com/abc.gif'), true);
  assert.equal(m('||example.com/a*c.gif', 'https://example.com/ad.gif'), false);
});

test('a leading or trailing wildcard is not an anchor', () => {
  // The engine strips them: "|*" and "*|" are "not effective anchors".
  assert.equal(m('|*example.com', 'https://example.com/a'), true);
  assert.equal(m('example.com*|', 'https://example.com/a'), true);
});

test('an empty pattern is a match-everything filter', () => {
  assert.equal(m('', 'https://anything.test/x'), true);
});

test('the filter is matched case-insensitively, as the shipped ruleset is', () => {
  // The shipped ruleset sets no isUrlFilterCaseSensitive, so DNR lowercases
  // both the URL and the filter.
  assert.equal(m('||Example.com/AD.js', 'https://example.com/ad.js'), true);
});

test('a regexFilter rule is evaluated with the engine\'s case-insensitive flag', () => {
  const re = rule({ regexFilter: '/ads?[0-9]+\\.gif$' });
  assert.equal(S.staticMatch(re, { url: 'https://example.com/ADS12.gif', type: 'image' }), true);
  assert.equal(S.staticMatch(re, { url: 'https://example.com/plain.gif', type: 'image' }), false);
});

test('an unparseable regexFilter never matches', () => {
  const re = rule({ regexFilter: '([unclosed' });
  assert.equal(S.staticMatch(re, { url: 'https://example.com/x', type: 'image' }), false);
});

/* ------------------------------------------------------------------ *
 * The conditions that decide whether a rule applies at all
 * ------------------------------------------------------------------ */

test('a resourceTypes list restricts the rule to those types', () => {
  const r = rule({ urlFilter: '||example.com/x.js', resourceTypes: ['script', 'xmlhttprequest'] });
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x.js', type: 'script' }), true);
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x.js', type: 'image' }), false);
});

test('a rule with no resourceTypes does not apply to a main_frame request', () => {
  // ExtensionDNR.sys.mjs #matchesRuleCondition: "else if (this.req.type ===
  // 'main_frame') return false". A document navigation is never counted as a
  // block, because nothing in the static table reads like a navigation block.
  const r = rule({ urlFilter: '||example.com/' });
  assert.equal(S.staticMatch(r, { url: 'https://example.com/', type: 'main_frame' }), false);
  assert.equal(S.staticMatch(r, { url: 'https://example.com/a.js', type: 'script' }), true);
});

test('a rule that names main_frame itself still applies to a navigation', () => {
  const r = rule({ urlFilter: '||example.com/', resourceTypes: ['main_frame'] });
  assert.equal(S.staticMatch(r, { url: 'https://example.com/', type: 'main_frame' }), true);
});

test('excludedResourceTypes removes the listed types', () => {
  const r = rule({ urlFilter: '||example.com/x', excludedResourceTypes: ['image'] });
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x', type: 'script' }), true);
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x', type: 'image' }), false);
});

test('an allow rule is never a block', () => {
  // staticWinnerFor only reports blocks; an exception in the static tier means
  // the request goes through, so it must not be counted.
  const allow = { id: 5, priority: 100, action: { type: 'allow' }, condition: { urlFilter: '||example.com/x' } };
  const single = S.buildStaticIndex([allow]);
  const winner = S.staticWinnerFor(S.staticCandidates(single, 'https://example.com/x'),
    { url: 'https://example.com/x', type: 'script' });
  assert.equal(winner, null);
});

test('initiatorDomains matches the initiator host or any parent domain', () => {
  const r = rule({ urlFilter: '||example.com/x', initiatorDomains: ['elinoi.com'] });
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x', type: 'script', initiator: 'https://elinoi.com/' }), true);
  // The engine's allInitiatorDomains is the host AND its superdomains, so a
  // subdomain of a listed initiator matches too.
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x', type: 'script', initiator: 'https://a.elinoi.com/' }), true);
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x', type: 'script', initiator: 'https://other.test/' }), false);
  // A rule that requires an initiator never matches a request without one: the
  // engine's own comment is "unable to only match null principals (bug
  // 1798225)".
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x', type: 'script' }), false);
});

test('excludedInitiatorDomains removes the listed initiators', () => {
  const r = rule({ urlFilter: '||example.com/x', excludedInitiatorDomains: ['elinoi.com'] });
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x', type: 'script', initiator: 'https://other.test/' }), true);
  assert.equal(S.staticMatch(r, { url: 'https://example.com/x', type: 'script', initiator: 'https://elinoi.com/' }), false);
});

test('domainType thirdParty matches only when the initiator is another site', () => {
  const r = rule({ urlFilter: '||tracker.test/x', domainType: 'thirdParty' });
  assert.equal(S.staticMatch(r, { url: 'https://tracker.test/x', type: 'script', initiator: 'https://example.com/' }), true);
  assert.equal(S.staticMatch(r, { url: 'https://tracker.test/x', type: 'script', initiator: 'https://tracker.test/' }), false);
  assert.equal(S.staticMatch(r, { url: 'https://a.tracker.test/x', type: 'script', initiator: 'https://tracker.test/' }), false);
});

test('domainType firstParty matches only when the initiator is the same site', () => {
  const r = rule({ urlFilter: '||tracker.test/x', domainType: 'firstParty' });
  assert.equal(S.staticMatch(r, { url: 'https://tracker.test/x', type: 'script', initiator: 'https://tracker.test/' }), true);
  assert.equal(S.staticMatch(r, { url: 'https://tracker.test/x', type: 'script', initiator: 'https://example.com/' }), false);
});

/* ------------------------------------------------------------------ *
 * Precedence: which block wins
 * ------------------------------------------------------------------ */

test('the highest priority block wins, as the engine\'s compareRule orders them', () => {
  const ordinary = { id: 10, priority: 10, action: { type: 'block' }, condition: { urlFilter: '||example.com/x' } };
  const important = { id: 20, priority: 500, action: { type: 'block' }, condition: { urlFilter: '||example.com/x' } };
  const single = S.buildStaticIndex([ordinary, important]);
  const winner = S.staticWinnerFor(S.staticCandidates(single, 'https://example.com/x'),
    { url: 'https://example.com/x', type: 'script' });
  assert.equal(winner.id, 20);
  assert.equal(winner.priority, 500);
});

test('an equal priority tie breaks on the lower rule id', () => {
  // compareRule's final comparator: cmpLowestNumber(ruleA.id, ruleB.id).
  const a = { id: 7, priority: 10, action: { type: 'block' }, condition: { urlFilter: '||example.com/x' } };
  const b = { id: 3, priority: 10, action: { type: 'block' }, condition: { urlFilter: '||example.com/x' } };
  const single = S.buildStaticIndex([a, b]);
  const winner = S.staticWinnerFor(S.staticCandidates(single, 'https://example.com/x'),
    { url: 'https://example.com/x', type: 'script' });
  assert.equal(winner.id, 3);
});

/* ------------------------------------------------------------------ *
 * The real shipped ruleset
 * ------------------------------------------------------------------ */

test('the shipped ruleset loads and indexes', () => {
  assert.ok(SHIPPED.length > 20000, `expected the 28k-row build artifact, got ${SHIPPED.length}`);
  assert.ok(INDEX.index.size > 10000);
  // Every rule the index holds is a real row of the shipped file.
  assert.equal(INDEX.count, SHIPPED.length);
});

test('a known analytics script is stopped by the static tier', () => {
  // ||google-analytics.com^ is EasyList row 5841 in the shipped ruleset.
  const winner = stops('https://google-analytics.com/ga.js', 'script');
  assert.ok(winner, 'the static tier must stop google-analytics.com/ga.js');
  assert.equal(winner.condition.urlFilter, '||google-analytics.com^');
  assert.equal(winner.action.type, 'block');
});

test('a subdomain of a blocked tracker host is stopped too', () => {
  const winner = stops('https://www.googletagmanager.com/gtag/js', 'script');
  assert.ok(winner, 'www.googletagmanager.com is a subdomain of the blocked host');
});

test('the winner is reported for the request type the page actually made', () => {
  // The same rule must not be reported for a type it cannot apply to.
  const asScript = stops('https://google-analytics.com/ga.js', 'script');
  assert.ok(asScript);
  const asImage = stops('https://google-analytics.com/ga.js', 'image');
  assert.equal(asImage, null, 'a script-only rule does not apply to an image');
});

test('an ordinary page resource is not stopped', () => {
  // The regression this guards is the expensive kind: a count that goes up on
  // requests nobody blocked.
  assert.equal(stops('https://example.com/app.js', 'script'), null);
  assert.equal(stops('https://example.com/style.css', 'stylesheet'), null);
  assert.equal(stops('https://example.com/logo.png', 'image'), null);
});

test('a first-party navigation is never counted as a block', () => {
  assert.equal(stops('https://example.com/', 'main_frame'), null);
  assert.equal(stops('https://google-analytics.com/', 'main_frame'), null);
});

test('an initiator-scoped exception is honoured when counting', () => {
  // Rule 1340 in the shipped ruleset: ||connect.facebook.net^*/fbevents.js is
  // an ALLOW for requests initiated by elinoi.com. It is an allow, so it is not
  // a block, and counting it would be wrong in the other direction.
  const candidates = S.staticCandidates(INDEX, 'https://connect.facebook.net/en_US/fbevents.js');
  const forElinoi = S.staticWinnerFor(candidates,
    { url: 'https://connect.facebook.net/en_US/fbevents.js', type: 'script', initiator: 'https://elinoi.com/' });
  assert.equal(forElinoi, null, 'the exception means the request goes through');
});

/* ------------------------------------------------------------------ *
 * Cost: the counting listener runs on every request
 * ------------------------------------------------------------------ */

test('the index makes the per-request candidate set small, not 28k rules', () => {
  // A linear scan of the shipped table per request is what the residual index
  // already rules out (>300 s measured for 3 000 URLs, per
  // lib/engine/residual-index.js). This is the static-tier equivalent check.
  const candidates = S.staticCandidates(INDEX, 'https://google-analytics.com/ga.js');
  assert.ok(candidates.length < 200,
    `a tracker request must not scan the whole table: ${candidates.length} candidates`);
});

test('a request that matches nothing still resolves quickly', () => {
  const started = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) {
    S.staticCandidates(INDEX, `https://example${i}.test/app.js`);
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 2000, `200 candidate lookups took ${ms.toFixed(1)} ms`);
});
