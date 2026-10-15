/* Ziy Playlist — the queue model's tests.
 *
 * The things a bug would make expensive, pinned:
 *
 *   - the item shape (an item that plays nothing is worse than no item)
 *   - add/move/remove/clear, and that they never mutate the caller's array
 *   - de-duplication by url, with the remembered position kept
 *   - the resume point's two rules (the tail is finished; no duration is
 *     unknown, not zero)
 *   - persistence shape: what comes back from storage is what was put in
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../lib/model.js');
const position = require('../lib/position.js');

function item(overrides) {
  return Object.assign({
    url: 'https://media.example.test/clip.mp4',
    kind: 'media',
    type: 'video',
    mime: 'video/mp4',
    title: 'A clip',
    source: { title: 'A page', url: 'https://media.example.test/watch', host: 'media.example.test' },
    thumbnail: null,
    duration: 100,
    addedAt: 1000,
    order: 0,
    position: 0,
    lastPlayedAt: 0,
  }, overrides || {});
}

/* --------------------------------------------------------------------- */
/* Shape                                                                 */
/* --------------------------------------------------------------------- */

test('an item without a usable url is rejected', () => {
  assert.equal(model.normaliseItem({ title: 'no address' }), null);
  assert.equal(model.normaliseItem({ url: 'about:blank' }), null);
  assert.equal(model.normaliseItem(null), null);
});

test('a stored record is coerced to the item shape', () => {
  const norm = model.normaliseItem({
    url: '  https://x.test/a.mp4  ',
    kind: 'nonsense',
    type: 'nonsense',
    duration: 'not a number',
    thumbnail: 'javascript:alert(1)',
    extra: 'dropped',
  });
  assert.equal(norm.url, 'https://x.test/a.mp4');
  assert.equal(norm.kind, 'media', 'an unknown kind becomes media, not a page');
  assert.equal(norm.type, 'audio', 'an unknown type becomes audio, never video by accident');
  assert.equal(norm.duration, 0, 'a non-number duration is 0, not NaN');
  assert.equal(norm.thumbnail, null, 'a non-media thumbnail is dropped');
  assert.equal(norm.extra, undefined, 'unknown fields never survive');
  assert.ok(model.cleanTitle('   a   b  ', 'fallback') === 'a b');
});

test('a corrupt position past its own duration is dropped, not clamped', () => {
  const norm = model.normaliseItem(item({ position: 500, duration: 100 }));
  assert.equal(norm.position, 0, 'seeking past the end cannot work, so the record is dropped');
});

test('page items keep no position', () => {
  const q = model.setPosition([item({ kind: 'page', url: 'https://x.test/watch?v=1' })],
    model.add([], item({ kind: 'page', url: 'https://x.test/watch?v=1' }))[0].id, 42);
  assert.equal(q[0].position, 0);
});

/* --------------------------------------------------------------------- */
/* Add, remove, clear                                                     */
/* --------------------------------------------------------------------- */

test('adding appends and reindexes', () => {
  const a = model.add([], item({ url: 'https://x.test/a.mp4' }));
  const b = model.add(a, item({ url: 'https://x.test/b.mp4' }));
  assert.equal(b.length, 2);
  assert.deepEqual(b.map((r) => r.order), [0, 1]);
  assert.equal(b[0].url, 'https://x.test/a.mp4', 'the first stay first');
});

test('adding a duplicate url moves the row and keeps its position', () => {
  let q = model.add([], item({ url: 'https://x.test/a.mp4', duration: 60 }));
  q = model.add(q, item({ url: 'https://x.test/b.mp4', duration: 60 }));
  const firstId = q[0].id;
  q = model.setPosition(q, firstId, 30);
  q = model.add(q, item({ url: 'https://x.test/a.mp4' }));
  assert.equal(q.length, 2, 'no second row for the same url');
  assert.equal(q[1].url, 'https://x.test/a.mp4', 'it moved to the end');
  assert.equal(q[1].position, 30, 'the remembered position survived');
  assert.equal(q[1].id, firstId, 'the row identity is stable');
});

test('adding at the front puts the row first', () => {
  let q = model.add([], item({ url: 'https://x.test/a.mp4' }));
  q = model.add(q, item({ url: 'https://x.test/b.mp4' }), { at: 'front' });
  assert.equal(q[0].url, 'https://x.test/b.mp4');
});

test('remove drops one row and reindexes', () => {
  let q = model.add([], item({ url: 'https://x.test/a.mp4' }));
  q = model.add(q, item({ url: 'https://x.test/b.mp4' }));
  q = model.remove(q, q[0].id);
  assert.equal(q.length, 1);
  assert.equal(q[0].url, 'https://x.test/b.mp4');
  assert.equal(q[0].order, 0);
});

test('clear empties the queue', () => {
  let q = model.add([], item());
  q = model.add(q, item({ url: 'https://x.test/b.mp4' }));
  assert.equal(model.clear(q).length, 0);
  assert.equal(model.count(model.clear(q)), 0);
});

test('no mutation returns the same array the caller handed in', () => {
  const original = [];
  const next = model.add(original, item());
  assert.notEqual(next, original);
  assert.equal(original.length, 0, 'the caller must not be mutated');
});

/* --------------------------------------------------------------------- */
/* Reorder                                                                */
/* --------------------------------------------------------------------- */

test('move swaps by index, in both directions', () => {
  let q = model.add([], item({ url: 'https://x.test/a.mp4', title: 'A' }));
  q = model.add(q, item({ url: 'https://x.test/b.mp4', title: 'B' }));
  q = model.add(q, item({ url: 'https://x.test/c.mp4', title: 'C' }));
  const moved = model.move(q, 0, 2);
  assert.deepEqual(moved.map((r) => r.title), ['B', 'C', 'A']);
  assert.deepEqual(moved.map((r) => r.order), [0, 1, 2]);
  const back = model.move(moved, 2, 0);
  assert.deepEqual(back.map((r) => r.title), ['A', 'B', 'C'], 'the move is reversible');
});

test('out-of-range moves clamp rather than throw', () => {
  let q = model.add([], item({ url: 'https://x.test/a.mp4' }));
  q = model.add(q, item({ url: 'https://x.test/b.mp4' }));
  assert.deepEqual(model.move(q, -5, 99).map((r) => r.order), [0, 1]);
});

test('moveBefore resolves by id', () => {
  let q = model.add([], item({ url: 'https://x.test/a.mp4' }));
  q = model.add(q, item({ url: 'https://x.test/b.mp4' }));
  q = model.add(q, item({ url: 'https://x.test/c.mp4' }));
  const moved = model.moveBefore(q, q[2].id, q[0].id);
  assert.equal(moved[0].url, 'https://x.test/c.mp4');
});

/* --------------------------------------------------------------------- */
/* Position and resume                                                    */
/* --------------------------------------------------------------------- */

test('the last few seconds count as finished', () => {
  const it = item({ duration: 100 });
  assert.equal(position.isFinished(it, 95), true, 'inside the tail is the end');
  assert.equal(position.isFinished(it, 20), false, 'the middle is not');
  assert.equal(position.isFinished(item({ duration: 0 }), 95), false,
    'no duration means unknown, so nothing is finished');
});

test('a finished item starts over, a half-watched one resumes', () => {
  assert.equal(position.startPosition(item({ position: 95 }), 'always'), 0);
  assert.equal(position.startPosition(item({ position: 20 }), 'always'), 20);
  assert.equal(position.startPosition(item({ position: 20 }), 'never'), 0);
});

test('resume mode asks before resuming only for a live position', () => {
  assert.equal(position.needsPrompt(item({ position: 20 }), 'ask'), true);
  assert.equal(position.needsPrompt(item({ position: 95 }), 'ask'), false,
    'a finished item has nothing to ask about');
  assert.equal(position.needsPrompt(item({ position: 20 }), 'always'), false);
});

test('the resume sentence names the three real states', () => {
  assert.equal(position.resumeLabel(item({ position: 0 }), 'always'), 'not played yet');
  assert.equal(position.resumeLabel(item({ position: 30 }), 'always'), 'resume at 0:30');
  assert.equal(position.resumeLabel(item({ position: 95 }), 'always'), 'play again from the start');
});

test('time formatting round-trips', () => {
  assert.equal(position.formatTime(0), '0:00');
  assert.equal(position.formatTime(75), '1:15');
  assert.equal(position.formatTime(3725), '1:02:05');
  assert.equal(position.parseTime('1:15'), 75);
  assert.equal(position.parseTime('1:02:05'), 3725);
  assert.equal(position.parseTime('nonsense'), null);
});

/* --------------------------------------------------------------------- */
/* Playback navigation                                                     */
/* --------------------------------------------------------------------- */

test('the next playable item wraps and skips page rows', () => {
  let q = model.add([], item({ url: 'https://x.test/a.mp4' }));
  q = model.add(q, item({ url: 'https://x.test/watch?v=1', kind: 'page', type: 'video' }));
  q = model.add(q, item({ url: 'https://x.test/b.mp4' }));
  assert.equal(model.nextPlayable(q, q[0].id).url, 'https://x.test/b.mp4');
  assert.equal(model.nextPlayable(q, q[2].id).url, 'https://x.test/a.mp4', 'it wraps');
});

test('the queue is capped at the documented maximum', () => {
  let q = [];
  for (let i = 0; i < model.MAX_ITEMS + 20; i += 1) {
    q = model.add(q, item({ url: `https://x.test/a${i}.mp4` }));
  }
  assert.equal(q.length, model.MAX_ITEMS);
  assert.equal(q[0].order, 0);
  assert.equal(q[model.MAX_ITEMS - 1].order, model.MAX_ITEMS - 1);
});

test('a persisted queue survives a round trip unchanged', () => {
  let q = model.add([], item({ position: 30 }));
  q = model.add(q, item({ url: 'https://x.test/b.mp4', position: 0, lastPlayedAt: 5 }));
  const stored = JSON.parse(JSON.stringify(q));
  const restored = model.normaliseQueue(stored);
  assert.deepEqual(restored, q, 'what comes back is what went in');
});
