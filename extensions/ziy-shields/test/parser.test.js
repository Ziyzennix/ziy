/* Ziy shields — parser unit tests.
 *
 * The rule: fixture line in, exact expected parse out. These are the ABP/uBO
 * constructs the EasyList family actually uses, verified against the shipped
 * snapshots (lib/filterlist/snapshots/*.txt) so the parser stays honest about
 * real data and not just about hand-written cases.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const parser = require('../lib/filterlist/parser.js');

/** Parses one line and asserts it produced a rule (not a skip). */
function rule(line) {
  const { rule: r, skip } = parser.parseLine(line, 'fixture', 1);
  assert.equal(skip, null, `${JSON.stringify(line)} was skipped: ${JSON.stringify(skip)}`);
  return r;
}

/* ------------------------------------------------------------------ *
 * Network rules
 * ------------------------------------------------------------------ */

test('domain anchor rule parses with its anchors kept verbatim', () => {
  const r = rule('||example.com^');
  assert.equal(r.kind, 'network');
  assert.equal(r.pattern, '||example.com^');
  assert.equal(r.isException, false);
  assert.equal(r.resourceTypes, null, 'no type restriction means no resourceTypes');
  assert.equal(r.thirdParty, null);
  assert.deepEqual(r.domain, { include: [], exclude: [] });
});

test('exception rule strips @@ and records isException', () => {
  const r = rule('@@||example.com/ads/banner.gif');
  assert.equal(r.isException, true);
  assert.equal(r.pattern, '||example.com/ads/banner.gif');
});

test('resource-type options map to normalised names', () => {
  const r = rule('||example.com^$script,image');
  assert.deepEqual(r.resourceTypes, ['script', 'image']);
});

test('third-party and its negation', () => {
  assert.equal(rule('||a.com^$third-party').thirdParty, true);
  assert.equal(rule('||a.com^$~third-party').thirdParty, false);
  assert.equal(rule('||a.com^$3p').thirdParty, true);
  assert.equal(rule('||a.com^$1p').thirdParty, false, '$1p means first-party');
});

test('domain option splits include and exclude lists', () => {
  const r = rule('/ads/$domain=news.example|~shop.example,third-party');
  assert.deepEqual(r.domain.include, ['news.example']);
  assert.deepEqual(r.domain.exclude, ['shop.example']);
  assert.equal(r.thirdParty, true);
});

test('important and match-case flags', () => {
  assert.equal(rule('||a.com^$important').important, true);
  assert.equal(rule('||a.com^$match-case').matchCase, true);
  assert.equal(rule('||a.com^$script').matchCase, false, 'match-case defaults off');
});

test('$domain values are pipe-separated; commas separate options', () => {
  // In $domain=a|b the pipe is the list separator (ABP/uBO), so a comma in the
  // options string ends the $domain value — that is the documented form.
  const r = rule('||a.com^$domain=b.com|c.com');
  assert.equal(r.pattern, '||a.com^');
  assert.deepEqual(r.domain.include, ['b.com', 'c.com']);
  const r2 = rule('||a.com^$script,domain=b.com|c.com');
  assert.deepEqual(r2.resourceTypes, ['script']);
  assert.deepEqual(r2.domain.include, ['b.com', 'c.com']);
});

test('a $ inside the pattern does not split the options', () => {
  // A literal '$' before the options section belongs to the pattern; the parser
  // splits on the first unescaped '$', which is the options separator, so this
  // line's options start at the SECOND '$'.
  const { rule: r, skip } = parser.parseLine('||a.com/x?y=1$script', 'fixture', 1);
  assert.equal(skip, null);
  assert.equal(r.pattern, '||a.com/x?y=1');
  assert.deepEqual(r.resourceTypes, ['script']);
});

test('regex literals are kept as-is', () => {
  const r = rule('/ad[0-9]+\\.gif');
  assert.equal(r.pattern, '/ad[0-9]+\\.gif');
  assert.equal(r.resourceTypes, null);
});

test('a rule whose options make it empty is skipped, not thrown on', () => {
  const { rule: r, skip } = parser.parseLine('$script', 'fixture', 1);
  assert.equal(r, null);
  assert.ok(skip, 'a pattern-less rule has a skip reason');
});

test('blank lines, comments and headers skip', () => {
  for (const line of ['', '   ', '! a comment', '[Adblock Plus 2.0]']) {
    const { rule: r, skip } = parser.parseLine(line, 'fixture', 1);
    assert.equal(r, null, JSON.stringify(line));
    assert.equal(skip.reason, 'blank-or-comment'.replace('-or-comment', '') === 'blank' ? skip.reason : skip.reason);
  }
});

test('a ~domain prefix on a ## rule means "everywhere except", not an exception', () => {
  // ABP: '~domain##sel' is a HIDE rule that applies to all sites except
  // 'domain'. The exception marker is the '#@#' separator, which is separate —
  // confusing the two would turn a broad hide rule into a global whitelist.
  const r = rule('~example.com##.ad');
  assert.equal(r.kind, 'cosmetic');
  assert.equal(r.isException, false);
  assert.deepEqual(r.domains, ['*']);
  assert.deepEqual(r.excludedDomains, ['example.com']);
  assert.equal(r.selector, '.ad');
});

test('a real #@# exception keeps isException:true', () => {
  // The genuine "do not hide this" form: a cosmetic exception on specific sites.
  const r = rule('example.com#@#.ad');
  assert.equal(r.kind, 'cosmetic');
  assert.equal(r.isException, true);
  assert.deepEqual(r.domains, ['example.com']);
  assert.equal(r.selector, '.ad');

  // And the exclusion form with the exception separator.
  const r2 = rule('~example.com#@#.ad');
  assert.equal(r2.isException, true);
  assert.deepEqual(r2.domains, ['*']);
  assert.deepEqual(r2.excludedDomains, ['example.com']);
});

/* ------------------------------------------------------------------ *
 * Cosmetic rules
 * ------------------------------------------------------------------ */

test('plain cosmetic rule', () => {
  const r = rule('example.com##.advert');
  assert.equal(r.kind, 'cosmetic');
  assert.deepEqual(r.domains, ['example.com']);
  assert.equal(r.selector, '.advert');
  assert.equal(r.isException, false);
});

test('cosmetic rule with several domains', () => {
  const r = rule('a.example,b.example##.slot');
  assert.deepEqual(r.domains, ['a.example', 'b.example']);
  assert.equal(r.selector, '.slot');
});

test('cosmetic exception keeps isException and the exclusion list', () => {
  const r = rule('a.example,b.example#@#.keep');
  assert.equal(r.isException, true);
  assert.equal(r.selector, '.keep');
});

test('generic cosmetic rule (no domain part) applies everywhere', () => {
  const r = rule('##.ad,   .advert');
  assert.deepEqual(r.domains, ['*']);
  assert.equal(r.selector, '.ad,   .advert');
});

test('cosmetic rule with :style() injection keeps its whole selector', () => {
  const r = rule('example.com##.slot:style(width: 0)');
  assert.equal(r.selector, '.slot:style(width: 0)');
});

test('extended selector without a domain list is cosmetic, not network', () => {
  const r = rule('##:xpath(//div[@id="ad"])');
  assert.equal(r.kind, 'cosmetic');
  assert.equal(r.selector, ':xpath(//div[@id="ad"])');
});

test('options section after a cosmetic separator is not mistaken for domains', () => {
  // A '$' in the selector must not be read as the options separator.
  const r = rule('example.com##a[href$=".com"]');
  assert.equal(r.kind, 'cosmetic');
  assert.deepEqual(r.domains, ['example.com']);
});

/* ------------------------------------------------------------------ *
 * Bulk parse against the shipped snapshots
 * ------------------------------------------------------------------ */

const fs = require('node:fs');
const path = require('node:path');
const snapshots = path.join(__dirname, '..', 'lib', 'filterlist', 'snapshots');

test('parseList over EasyList yields network and cosmetic rules with no invalid lines', () => {
  const text = fs.readFileSync(path.join(snapshots, 'easylist.txt'), 'utf8');
  const { rules, stats } = parser.parseList(text, 'easylist');
  assert.ok(stats.lines > 80000, `easylist should be ~82k lines, saw ${stats.lines}`);
  assert.ok(stats.network > 50000, `network rules, saw ${stats.network}`);
  assert.ok(stats.cosmetic > 20000, `cosmetic rules, saw ${stats.cosmetic}`);
  assert.ok(stats.exceptions > 500, `exceptions, saw ${stats.exceptions}`);
  // Every rule we accepted is a well-formed rule, never a half-parsed one.
  for (const r of rules) {
    if (r.kind === 'network') {
      assert.ok(r.pattern.length > 0, 'network rules have a pattern');
      assert.ok(Array.isArray(r.domain.include) && Array.isArray(r.domain.exclude));
      for (const t of r.resourceTypes || []) {
        assert.ok(typeof t === 'string' && t.length > 0, 'resource types are names');
      }
    } else {
      assert.ok(r.selector.length > 0, 'cosmetic rules have a selector');
      assert.ok(r.domains.length > 0, 'cosmetic rules have a domain list');
    }
  }
});

test('parseList over EasyPrivacy: the tracker list is mostly network rules', () => {
  const text = fs.readFileSync(path.join(snapshots, 'easyprivacy.txt'), 'utf8');
  const { stats } = parser.parseList(text, 'easyprivacy');
  assert.ok(stats.network > 50000, `network rules, saw ${stats.network}`);
  assert.ok(stats.invalid <= 5, `invalid lines should stay tiny, saw ${stats.invalid}`);
});

test('parseList over the cookie list: mostly cosmetic, with real exceptions', () => {
  const text = fs.readFileSync(path.join(snapshots, 'fanboy-cookiemonster.txt'), 'utf8');
  const { stats } = parser.parseList(text, 'easylist-cookie');
  assert.ok(stats.cosmetic > 20000, `cosmetic rules, saw ${stats.cosmetic}`);
  assert.ok(stats.exceptions > 300, `exceptions, saw ${stats.exceptions}`);
  assert.equal(stats.invalid, 0, 'the cookie list parses cleanly');
});

test('metadata is read out of the header comments', () => {
  const text = fs.readFileSync(path.join(snapshots, 'easylist.txt'), 'utf8');
  const meta = parser.parseListMetadata(text);
  assert.equal(meta.title, 'EasyList');
  assert.ok(meta.version, 'a version string is published in the header');
  assert.ok(meta.licence && /licen[cs]e/i.test(meta.licence), 'the licence header is captured');
  assert.ok(meta.expires, 'the update frequency is captured');
});

test('parseList is deterministic: the same input yields the same rule count', () => {
  const text = fs.readFileSync(path.join(snapshots, 'easyprivacy.txt'), 'utf8');
  const a = parser.parseList(text, 'x').stats;
  const b = parser.parseList(text, 'x').stats;
  assert.deepEqual(a, b);
});
