/* Ziy shields — the webRequest residual index tests.
 *
 * The residual path exists because the engine's static-ruleset quota drops an
 * over-cap ruleset entirely, so ~87k of the EasyList family's rules are covered
 * imperatively. A linear scan of those is ~210 ms per request (measured on this
 * machine), which is not viable; the domain index brings it to ~0.15 ms.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../lib/engine/residual-index.js');

test('anchored rules are bucketed by their domain', () => {
  const idx = R.buildIndex([
    { kind: 'network', pattern: '||tracker.example^' },
    { kind: 'network', pattern: '||tracker.example/ads' },
    { kind: 'network', pattern: '||other.example^' },
  ]);
  assert.deepEqual(R.describe(idx), {
    total: 3, domains: 2, anchoredDomains: 3, substring: 0, leftAnchored: 0,
  });
});

test('a request only tests the buckets it can match', () => {
  const idx = R.buildIndex([
    { kind: 'network', pattern: '||ads.example/banner' },
    { kind: 'network', pattern: '||tracker.example^' },
    { kind: 'network', pattern: '/ad.gif' },          // substring
    { kind: 'network', pattern: '|https://cdn.example' },  // left-anchored
  ]);
  // An exact host hit: its own bucket plus the two unanchored groups.
  const forTracker = R.candidates(idx, 'https://tracker.example/ga.js', 'tracker.example');
  assert.equal(forTracker.length, 3);
  // A subdomain is covered by the parent's bucket: ||example^ matches a.example.
  const forSub = R.candidates(idx, 'https://a.tracker.example/x', 'a.tracker.example');
  assert.equal(forSub.length, 3, 'a subdomain falls through to its parent bucket');
  // An unrelated host gets only the two unanchored groups.
  const unrelated = R.candidates(idx, 'https://other.example/x', 'other.example');
  assert.equal(unrelated.length, 2);
});

test('hostAndParents walks from the most specific domain outward', () => {
  assert.deepEqual(R.hostAndParents('a.b.example.com'),
    ['a.b.example.com', 'b.example.com', 'example.com']);
  assert.deepEqual(R.hostAndParents('example.com'), ['example.com']);
});

test('anchorDomain returns null for the shapes that are not domain-anchored', () => {
  assert.equal(R.anchorDomain('||ads.example^'), 'ads.example');
  assert.equal(R.anchorDomain('||ADS.example/x'), 'ads.example', 'lower-cased');
  assert.equal(R.anchorDomain('|https://cdn.example'), null, 'left-anchored');
  assert.equal(R.anchorDomain('/ad.gif'), null, 'substring');
  assert.equal(R.anchorDomain('||'), null, 'a bare || is not an anchor');
  assert.equal(R.anchorDomain(''), null);
});

test('an empty index yields no candidates', () => {
  const idx = R.buildIndex([]);
  assert.equal(idx.total, 0);
  assert.deepEqual(R.candidates(idx, 'https://x.example/', 'x.example'), []);
});

test('a very large index is still fast enough for the request path', () => {
  // ~87k rules, the residual's real size: the index must cut the per-request
  // candidate set by four orders of magnitude, which is the whole point.
  const rules = [];
  for (let i = 0; i < 87000; i++) {
    rules.push({ kind: 'network', pattern: `||h${i}.example/path${i}` });
  }
  const idx = R.buildIndex(rules);
  assert.equal(idx.total, 87000);
  assert.equal(idx.byDomain.size, 87000);

  const urls = [];
  for (let i = 0; i < 2000; i++) urls.push(`https://h${i}.example/path${i}?utm=1`);
  const t0 = process.hrtime.bigint();
  let total = 0;
  for (const u of urls) {
    total += R.candidates(idx, u, new URL(u).hostname).length;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perRequest = ms / urls.length;
  assert.ok(perRequest < 1.0,
    `per-request candidate lookup must be well under a millisecond, saw ${perRequest.toFixed(4)} ms`);
  // And the candidate set is a rounding error of the whole residual.
  assert.ok(total / urls.length < 100,
    `candidates per request must stay tiny, saw ${(total / urls.length).toFixed(1)}`);
});
