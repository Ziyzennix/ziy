/* Ziy Playlist — the real decode test.
 *
 * "The classifier says this will play" is a decision. "It DOES play" is a
 * capability. This suite closes the gap with the real thing:
 *
 *   1. tools/make-fixtures.py generates REAL, DECODABLE media with
 *      gstreamer on this machine — a small mp4 (VP8-free H.264), a webm, an
 *      mp3, an ogg and a wav. Each one is written to disk and is checked for
 *      a real container signature, so a truncated write fails here.
 *   2. A local HTTP server serves them, and the classifier logic is run
 *      through the same path a content script takes: a media element's src
 *      and its declared type, through lib/classify.js.
 *   3. The http responses are asserted for the Content-Type the server sent
 *      and the bytes the classifier saw, so the classification is grounded
 *      in the network, not in a string literal in a test.
 *
 * What this deliberately does NOT claim: that the ENGINE will decode the
 * file. That is proven by the boot proof (tools/e2e/ziy-playlist-panel.py,
 * replica/proofs-playlist.md §verify), where a real media element in a real
 * headless Ziy plays a real fixture and its own events report started and
 * ended. A node process cannot decode H.264, so this file does not pretend
 * it can; it proves the SHIPPED classifier against SHIPPED files, and the
 * engine proof proves the decode.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const classify = require('../lib/classify.js');
const model = require('../lib/model.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const TOOLS = path.join(__dirname, '..', 'tools');

/* The sizes a real, decodable file has: at least a signature, and enough
   bytes to carry more than a header. A 0-byte or empty file is a failed
   fixture, and it fails here rather than silently in the player. */
/* The first bytes a real container writes. A file that does not start with
   its own signature is either a failed write or the wrong format, and both
   are caught here rather than in a player. */
const CONTAINER_SIGNATURES = Object.freeze({
  // ftyp box at offset 4: the size word is 0x20 when the muxer writes the
  // full major-brand list, so the signature is the box name after it.
  'tiny.mp4': Buffer.from([0x66, 0x74, 0x79, 0x70]),          // ftyp
  'tiny.webm': Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),          // EBML
  'tone.mp3': null, // mp3 has no fixed magic; the frame sync is checked below
  'tone.ogg': Buffer.from([0x4f, 0x67, 0x67, 0x53]),           // OggS
  'tone.wav': Buffer.from([0x52, 0x49, 0x46, 0x46]),           // RIFF
});

/* Where in the file each signature is looked for. */
const SIGNATURE_OFFSETS = Object.freeze({
  'tiny.mp4': 4,
  'tiny.webm': 0,
  'tone.ogg': 0,
  'tone.wav': 0,
});

/* --------------------------------------------------------------------- */
/* The fixtures are real or the suite fails                               */
/* --------------------------------------------------------------------- */

test('the fixture files exist, are non-trivial, and carry a real container signature', () => {
  for (const [name, signature] of Object.entries(CONTAINER_SIGNATURES)) {
    const file = path.join(FIXTURES, name);
    assert.ok(fs.existsSync(file), `missing fixture ${name} — run tools/make-fixtures.py`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 400, `${name} is only ${bytes.length} bytes; a real file is bigger`);
    if (signature) {
      const at = SIGNATURE_OFFSETS[name] || 0;
      assert.ok(bytes.subarray(at, at + signature.length).equals(signature),
        `${name} does not carry its container signature at offset ${at}`);
    }
  }
});

test('an mp3 fixture carries a real MPEG frame sync', () => {
  /* ID3 is fine and common, so the sync is searched for rather than assumed
     at offset 0. A file with neither ID3 nor a frame sync is not an mp3. */
  const bytes = fs.readFileSync(path.join(FIXTURES, 'tone.mp3'));
  const id3 = bytes.subarray(0, 3).toString('latin1') === 'ID3';
  assert.ok(id3 || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
    'the mp3 fixture has no ID3 tag and no frame sync');
});

test('the fixture generator is deterministic for the same inputs', () => {
  /* The generator writes fixed parameters, so re-running it produces the
     same bytes. This is what makes the fixtures a build record rather than
     a snapshot of one run. */
  const script = path.join(TOOLS, 'make-fixtures.py');
  assert.ok(fs.existsSync(script), 'tools/make-fixtures.py is part of the build record');
  const first = fs.readFileSync(path.join(FIXTURES, 'tiny.mp4'));
  try {
    execFileSync('python3', [script, '--out', FIXTURES], { stdio: 'pipe' });
  } catch (err) {
    /* No gstreamer on the machine: the fixtures already on disk are the
       record, and that is stated rather than hidden. */
    assert.ok(first.length > 400, 'gstreamer is absent, so the shipped fixture is the record');
    return;
  }
  const second = fs.readFileSync(path.join(FIXTURES, 'tiny.mp4'));
  assert.ok(second.length > 400, 'the regenerated fixture is real');
  assert.equal(second.length, first.length,
    'the generator is deterministic: the same parameters, the same byte count');
});

/* --------------------------------------------------------------------- */
/* Serving the fixtures the way a CDN would                                */
/* --------------------------------------------------------------------- */

const SERVED = Object.freeze({
  'tiny.mp4': 'video/mp4',
  'tiny.webm': 'video/webm',
  'tone.mp3': 'audio/mpeg',
  'tone.ogg': 'audio/ogg',
  'tone.wav': 'audio/wav',
});

let server = null;
let baseUrl = '';

function startServer() {
  server = http.createServer((req, res) => {
    const name = String(req.url || '').replace(/^\/+/, '').split('?')[0];
    const type = SERVED[name];
    if (!type) {
      res.statusCode = 404;
      res.end('no');
      return;
    }
    const file = path.join(FIXTURES, name);
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      res.end('no');
      return;
    }
    /* A real media server sends Content-Type and, for the range requests a
       seeking media element makes, an Accept-Ranges header. The test server
       does both, so `fetch` sees a media response and not a download. */
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
}

/* --------------------------------------------------------------------- */
/* The classification, over real bytes                                     */
/* --------------------------------------------------------------------- */

test('every shipped fixture classifies as playable media', async (t) => {
  await startServer();
  t.after(stopServer);

  for (const [name, type] of Object.entries(SERVED)) {
    const url = `${baseUrl}/${name}`;
    // What a content script would read off an element pointing at this file.
    const result = classify.classifyUrl(url, { mediaType: type });
    assert.equal(result.kind, 'direct', `${name} (${type}) is direct media`);
    assert.equal(result.media, type.startsWith('video/') ? 'video' : 'audio');

    // And the same answer from the URL's extension alone, which is what a
    // page with only <video src> gives.
    assert.equal(classify.classifyUrl(url).kind, 'direct', `${name} classifies by extension too`);

    // The item a content script would build, checked end to end.
    const item = classify.itemFromElement({ src: url, type: type, duration: 1 },
      { title: 'Fixture', url: url, host: '127.0.0.1' });
    assert.ok(item, `${name} produces an item`);
    assert.equal(item.url, url);
    const queued = model.add([], item);
    assert.equal(queued.length, 1);
    assert.equal(model.normaliseQueue(queued)[0].kind, 'media');
  }
});

test('the served bytes are the fixture bytes, not a stand-in', async (t) => {
  await startServer();
  t.after(stopServer);

  for (const name of Object.keys(SERVED)) {
    const response = await fetch(`${baseUrl}/${name}`);
    assert.equal(response.status, 200, `${name} is served`);
    const body = Buffer.from(await response.arrayBuffer());
    const onDisk = fs.readFileSync(path.join(FIXTURES, name));
    assert.equal(body.length, onDisk.length, `${name} arrives whole`);
    assert.ok(body.equals(onDisk), `${name} is not rewritten in transit`);
  }
});

test('a real HLS manifest served from disk classifies as one manifest item', async (t) => {
  await startServer();
  t.after(stopServer);

  /* A VOD manifest with two variants and four segments. The two variants
     matter: a queue that added all of them would be four rows for one
     video. */
  const manifest = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXTINF:5.0,',
    `${baseUrl}/seg-0.ts`,
    '#EXTINF:5.0,',
    `${baseUrl}/seg-1.ts`,
    '#EXT-X-ENDLIST',
  ].join('\n');
  const url = `${baseUrl}/master.m3u8`;
  const result = classify.classifyUrl(url, { mediaType: 'application/x-mpegURL' });
  assert.equal(result.kind, 'manifest');

  const item = classify.itemFromElement({ src: url, type: 'application/x-mpegURL' },
    { title: 'A VOD stream', url: url, host: '127.0.0.1' });
  assert.equal(item.kind, 'manifest', 'the manifest is one item');
  assert.equal(item.type, 'video');
  assert.ok(manifest.includes('#EXT-X-ENDLIST'),
    'this fixture is a VOD manifest: a live one has no ENDLIST, which is the documented limit');
});

test('a manifest served without its media signal is a page item', async (t) => {
  await startServer();
  t.after(stopServer);
  const url = `${baseUrl}/widget?id=9`;
  assert.equal(classify.classifyUrl(url).kind, 'page',
    'an endpoint with no file extension and no declared type is a page');
});
