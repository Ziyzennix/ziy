/* Ziy Playlist — the media-capture classifier's tests.
 *
 * The classifier is the line between "this queue plays" and "this queue
 * promises and fails", so every rule is pinned, including the two that are
 * deliberately conservative:
 *
 *   - a URL with no media signal is a PAGE item, not a hopeful media item
 *   - a blob: URL is never a durable item (it cannot be replayed tomorrow)
 *
 * The JavaScript shipped with the browser is the engine's, but the decoder
 * question this suite really pins is the one the panel makes: the fixtures
 * under test/fixtures/ are REAL files, generated with gstreamer on this
 * machine, and the decode assertion in test/decode.test.js plays them through
 * a real media element in the headless browser. This file pins the decision;
 * that one pins the capability.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const classify = require('../lib/classify.js');

/* --------------------------------------------------------------------- */
/* Direct files                                                           */
/* --------------------------------------------------------------------- */

test('video extensions are direct media', () => {
  for (const url of [
    'https://cdn.example.test/a.mp4',
    'https://cdn.example.test/a.mp4?token=1&expires=2',
    'https://cdn.example.test/a.webm',
    'https://cdn.example.test/a.mov',
    'https://cdn.example.test/a.mkv',
    'https://cdn.example.test/a.ogv',
    'file:///tmp/fixtures/tiny.mp4',
  ]) {
    assert.equal(classify.classifyUrl(url).kind, 'direct', url);
    assert.equal(classify.classifyUrl(url).media, 'video', url);
  }
});

test('audio extensions are direct media with audio type', () => {
  for (const url of [
    'https://cdn.example.test/a.mp3',
    'https://cdn.example.test/a.m4a',
    'https://cdn.example.test/a.opus',
    'https://cdn.example.test/a.ogg',
    'https://cdn.example.test/a.wav',
    'https://cdn.example.test/a.flac',
    'https://cdn.example.test/a.weba',
  ]) {
    const result = classify.classifyUrl(url);
    assert.equal(result.kind, 'direct', url);
    assert.equal(result.media, 'audio', url);
  }
});

test('an extension is read from the path, not from a host that happens to end in .mp4', () => {
  /* The rule is the LAST path segment's dot, so a host-name suffix cannot
     fool it. */
  const result = classify.classifyUrl('https://example.mp4/watch/12345');
  assert.equal(result.kind, 'page', 'a host is not a file');
});

test('a case-different and percent-encoded extension still classifies', () => {
  assert.equal(classify.classifyUrl('https://x.test/a.MP4').kind, 'direct');
  assert.equal(classify.classifyUrl('https://x.test/a%2Emp4').kind, 'direct');
});

/* --------------------------------------------------------------------- */
/* Manifests                                                              */
/* --------------------------------------------------------------------- */

test('an HLS manifest is one media item', () => {
  const result = classify.classifyUrl('https://cdn.example.test/master.m3u8');
  assert.equal(result.kind, 'manifest');
  assert.equal(result.mime, 'application/x-mpegURL');
  assert.equal(classify.classifyUrl('https://cdn.example.test/2.m3u').kind, 'manifest');
});

test('a DASH manifest is a page item, because this engine has no DASH pipeline', () => {
  const result = classify.classifyUrl('https://cdn.example.test/master.mpd');
  assert.equal(result.kind, 'page', 'a control that cannot play is not a control');
});

test('a declared HLS mime outranks an absent extension', () => {
  const result = classify.classifyUrl('https://cdn.example.test/stream/1234',
    { mediaType: 'application/vnd.apple.mpegurl' });
  assert.equal(result.kind, 'manifest');
});

/* --------------------------------------------------------------------- */
/* Declared types                                                         */
/* --------------------------------------------------------------------- */

test('a declared type is the strongest signal', () => {
  const result = classify.classifyUrl('https://cdn.example.test/play/1234',
    { mediaType: 'video/mp4; codecs="avc1.42E01E"' });
  assert.equal(result.kind, 'direct');
  assert.equal(result.media, 'video');
});

test('a declared type we cannot decode is a page item, not a broken media item', () => {
  const result = classify.classifyUrl('https://x.test/a.avi', { mediaType: 'video/x-msvideo' });
  assert.equal(result.kind, 'page');
  assert.equal(result.media, 'video');
});

test('a type attribute that is not a mime type is ignored', () => {
  /* Some players put a comment or a codec string in `type`; a slash is what
     makes it a mime type. */
  const result = classify.classifyUrl('https://x.test/watch/1', { mediaType: 'avc1.42E01E' });
  assert.equal(result.kind, 'page');
});

/* --------------------------------------------------------------------- */
/* Pages and rejections                                                   */
/* --------------------------------------------------------------------- */

test('a page URL is a page item', () => {
  assert.equal(classify.classifyUrl('https://site.test/watch?v=abc').kind, 'page');
  assert.equal(classify.classifyUrl('https://site.test/').kind, 'page');
  assert.equal(classify.classifyUrl('https://site.test/embed/iframe').kind, 'page');
});

test('a url with no scheme, and a data: url, are rejected outright', () => {
  assert.equal(classify.classifyUrl('').kind, 'none');
  assert.equal(classify.classifyUrl('not a url').kind, 'none');
  assert.equal(classify.classifyUrl('data:video/mp4;base64,AAAA').kind, 'none');
});

test('a blob url is never a queue item, because it cannot be replayed later', () => {
  assert.equal(classify.isAddable('blob:https://site.test/1a2b'), false);
  assert.equal(classify.candidatesFor({ src: 'blob:https://site.test/1a2b',
    sources: [{ src: 'https://cdn.test/a.mp4' }] }).length, 1,
    'the blob is skipped, the real file is kept');
});

test('the same url listed twice appears once', () => {
  const candidates = classify.candidatesFor({
    src: 'https://cdn.test/a.mp4',
    currentSrc: 'https://cdn.test/a.mp4',
    sources: [{ src: 'https://cdn.test/a.mp4' }],
  });
  assert.equal(candidates.length, 1);
});

/* --------------------------------------------------------------------- */
/* Metadata extraction                                                     */
/* --------------------------------------------------------------------- */

test('the item title prefers the element, then og:title, then the page', () => {
  const element = { src: 'https://cdn.test/a.mp4', title: 'Episode 4' };
  const page = { title: 'Watch it here', ogTitle: 'The show', host: 'site.test', url: 'https://site.test/e4' };
  assert.equal(classify.bestTitle(element, page), 'Episode 4');
  assert.equal(classify.bestTitle({ src: 'https://cdn.test/a.mp4' }, page), 'The show');
  assert.equal(classify.bestTitle({ src: 'https://cdn.test/a.mp4' },
    { title: 'Watch it here', host: 'site.test' }), 'Watch it here');
});

test('a file name becomes the title when the page has nothing', () => {
  const title = classify.bestTitle(
    { src: 'https://cdn.test/lecture_03_final.mp4' },
    { title: '', ogTitle: '', host: 'cdn.test' });
  assert.equal(title, 'lecture 03 final');
});

test('a poster is the element poster, then og:image, then a schema image', () => {
  const page = { ogImage: 'https://site.test/og.png', schemaImages: ['https://site.test/schema.png'] };
  assert.equal(classify.posterFor({ poster: 'https://cdn.test/poster.png' }, page),
    'https://cdn.test/poster.png');
  assert.equal(classify.posterFor({ poster: '' }, page), 'https://site.test/og.png');
  assert.equal(classify.posterFor({}, { schemaImages: ['https://site.test/schema.png'] }),
    'https://site.test/schema.png');
  assert.equal(classify.posterFor({}, {}), null);
});

test('a page element with only <source> children is still captured', () => {
  const item = classify.itemFromElement({
    src: '',
    sources: [{ src: 'https://cdn.test/a.mp4', type: 'video/mp4' }],
    duration: 40,
  }, { title: 'The show', url: 'https://site.test/e', host: 'site.test' });
  assert.ok(item);
  assert.equal(item.url, 'https://cdn.test/a.mp4');
  assert.equal(item.kind, 'media');
  assert.equal(item.type, 'video');
  assert.equal(item.duration, 40);
  assert.equal(item.source.host, 'site.test');
});

test('an element with nothing playable yields no item', () => {
  assert.equal(classify.itemFromElement({ src: '', sources: [] }, { title: 'x' }), null);
  assert.equal(classify.itemFromElement({ src: 'https://site.test/watch?v=1' },
    { title: 'x' }), null, 'a page URL is not addable from an element');
});

test('an HLS element yields the manifest as one item, not its variants', () => {
  const item = classify.itemFromElement({
    src: 'https://cdn.test/master.m3u8',
    sources: [{ src: 'https://cdn.test/variant-1.m3u8' },
      { src: 'https://cdn.test/variant-2.m3u8' }],
  }, { title: 'Live-ish', url: 'https://site.test/v', host: 'site.test' });
  assert.equal(item.kind, 'manifest');
  assert.equal(item.url, 'https://cdn.test/master.m3u8');
  assert.equal(classify.candidatesFor({
    src: 'https://cdn.test/master.m3u8',
    sources: [{ src: 'https://cdn.test/variant-1.m3u8' }],
  }).length, 2, 'candidates are listed; the item picks the first');
});
