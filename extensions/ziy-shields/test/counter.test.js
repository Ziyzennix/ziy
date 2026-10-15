/* Ziy shields — the blocked-item counter tests.
 *
 * The shape comes from replica/recon-behavior.md's observed stats widget:
 * ONE combined "Trackers & ads blocked" number, kB saved, seconds saved. These
 * tests pin that shape so the counter cannot drift back to separate ad/tracker
 * rows or to units the product does not use.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../lib/engine/counter.js');

test('the counter reports ONE combined number, not separate ad and tracker rows', () => {
  const t = new C.TabCounter();
  t.record({ category: 'ad', url: 'https://ads.example/x.gif' });
  t.record({ category: 'tracker', url: 'https://tracker.example/ga.js' });
  t.record({ category: 'tracker', url: 'https://t2.example/b.gif' });
  const s = t.stats();
  // There is exactly one figure for the panel: the combined total.
  assert.equal(s.combined, 3);
  assert.ok(!('ads' in s), 'no separate ads figure in the panel shape');
  assert.ok(!('trackers' in s), 'no separate trackers figure in the panel shape');
  // The per-category breakdown exists for the items list, but the widget total
  // stays a single number.
  assert.deepEqual(s.byCategory, { ad: 1, tracker: 2 });
});

test('the units are kB and seconds', () => {
  const t = new C.TabCounter();
  t.record({ category: 'tracker', url: 'a', bytes: 2048 });
  t.record({ category: 'tracker', url: 'b', bytes: 1024 });
  const s = t.stats();
  assert.equal(s.kilobytesSaved, 3, 'bytes are reported as kilobytes');
  assert.ok(typeof s.secondsSaved === 'number');
  assert.equal(s.secondsSaved, 2 * C.SECONDS_PER_REQUEST_ESTIMATE);
  assert.equal(C.formatKilobytes(s.kilobytesSaved), '3 kB');
  assert.match(C.formatSeconds(s.secondsSaved), /seconds$/);
});

test('an empty counter reads as nothing stopped', () => {
  const t = new C.TabCounter();
  const s = t.stats();
  assert.equal(s.combined, 0);
  assert.equal(s.kilobytesSaved, 0);
  assert.equal(s.secondsSaved, 0);
  assert.equal(t.sentence(), 'Nothing stopped this visit');
});

test('the sentence is singular for one and plural for many', () => {
  const one = new C.TabCounter(); one.record({ category: 'ad', url: 'x' });
  assert.equal(one.sentence(), '1 request stopped this visit');
  const many = new C.TabCounter();
  many.record({ category: 'ad', url: 'x' });
  many.record({ category: 'ad', url: 'y' });
  assert.equal(many.sentence(), '2 requests stopped this visit');
});

test('a navigation resets the count but keeps the items list bounded', () => {
  const t = new C.TabCounter();
  t.setTabDomain = t.setTabDomain; // (no-op; keeps the shape explicit)
  t.record({ category: 'tracker', url: 'a' });
  assert.equal(t.stats().combined, 1);
  t.reset();
  assert.equal(t.stats().combined, 0, 'the count resets on navigation');
  assert.equal(t.items.length, 0, 'and the list clears with it');

  // Bounded list, unbounded counter: a page with thousands of subresources
  // still shows a true total.
  for (let i = 0; i < 500; i++) t.record({ category: 'tracker', url: `u${i}` });
  assert.equal(t.items.length, 200, 'the items list is capped for the panel');
  assert.equal(t.stats().combined, 500, 'the counter itself is not capped');
});

test('kilobytes and time formats scale for large values', () => {
  assert.equal(C.formatKilobytes(0), '0 kB');
  assert.equal(C.formatKilobytes(2048), '2.0 MB');
  assert.equal(C.formatKilobytes(20 * 1024), '20 MB');
  assert.equal(C.formatSeconds(0), '0 seconds');
  assert.equal(C.formatSeconds(90), '1 min');
  assert.equal(C.formatSeconds(3700), '1 h 1 min');
  assert.equal(C.formatSeconds(90000), '1 d 1 h');
});

test('upgrades are counted separately from blocks', () => {
  const t = new C.TabCounter();
  t.record({ category: 'tracker', url: 'a' });
  t.recordUpgrade('http://example.com/');
  const s = t.stats();
  assert.equal(s.combined, 1, 'an upgrade is not a block');
  assert.equal(s.upgrades, 1);
});

test('the estimate is documented as a model, not a measurement', () => {
  // A blocked request's saved time depends on the network and the page; the
  // product states a model rather than pretending to have measured it.
  assert.ok(C.SECONDS_PER_REQUEST_ESTIMATE > 0);
  assert.ok(C.SECONDS_PER_REQUEST_ESTIMATE < 0.5, 'a conservative per-request floor');
});
