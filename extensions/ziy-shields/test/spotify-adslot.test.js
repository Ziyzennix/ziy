/* Ziy shields — the Spotify ad-slot handler tests.
 *
 * These pin the mechanism the co-owner asked for: block the ad AUDIO and still
 * let the SONG play. The failure mode they guard against is the naive block,
 * which leaves the web player stalled in its ad slot (the uBlock symptom).
 *
 * What is tested here is the pure decision layer in lib/engine/spotify-adslot.js
 * (host classification, the mute/slot state machine, the request verdict). The
 * in-browser end-to-end behaviour is proven in tools/prove-adwall.py against a
 * real boot, the same route tools/prove-blocking.py uses; that evidence is
 * recorded in replica/proofs-blocking-strength.md §5.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const P = require('../lib/engine/precedence.js');
const S = require('../lib/engine/spotify-adslot.js');

/* ------------------------------------------------------------------ *
 * Host classification
 * ------------------------------------------------------------------ */

test('the ad-delivery hosts are recognised as ads', () => {
  assert.equal(S.isAdHost('audio-fa.spotifycdn.com'), true);
  assert.equal(S.isAdHost('audio-sp-ash1.spotifycdn.com'), true);
  assert.equal(S.isAdHost('audio-sp-lhr1.spotifycdn.com'), true);
  assert.equal(S.isAdHost('ads.spotify.com'), true);
  assert.equal(S.isAdHost('audioads.spotify.com'), true);
});

test('the music hosts are never mistaken for ads', () => {
  assert.equal(S.isAdHost('p.scdn.co'), false);
  assert.equal(S.isAdHost('i.scdn.co'), false);
  assert.equal(S.isSongHost('p.scdn.co'), true);
  assert.equal(S.hostKind('p.scdn.co'), 'song');
});

test('the player host is neither an ad nor a song', () => {
  assert.equal(S.hostKind('open.spotify.com'), 'player');
  assert.equal(S.hostKind('spotify.com'), 'player');
  assert.equal(S.isAdHost('open.spotify.com'), false);
});

test('a lookalike host on another domain is not an ad host', () => {
  // The critical case: an attacker (or an ad) must not be able to get the
  // "allow-and-mute" verdict by mimicking the ad hostname on their own domain.
  assert.equal(S.hostKind('audio-fa.spotifycdn.com.attacker.test'), null);
  assert.equal(S.hostKind('notaudio-fa.spotifycdn.com'), null);
  assert.equal(S.hostKind('audio-fa.spotifycdn.com.example.org'), null);
});

test('subdomains of an ad host match, because the family is regional', () => {
  assert.equal(S.isAdHost('ash1.audio-fa.spotifycdn.com'), true);
  // ...but a bare suffix that is not a subdomain does not.
  assert.equal(S.isAdHost('xaudio-fa.spotifycdn.com'), false);
});

test('unrelated hosts are untouched', () => {
  for (const h of ['example.com', 'doubleclick.net', '', null, undefined]) {
    assert.equal(S.hostKind(h), null, `${h} must not be Spotify traffic`);
  }
});

/* ------------------------------------------------------------------ *
 * The request verdict: allow-and-mute, never block
 * ------------------------------------------------------------------ */

test('an ad-slot request is NEVER blocked — it is allowed and muted', () => {
  const t = S.createSlotTracker();
  const v = t.requestVerdict('https://audio-fa.spotifycdn.com/ad-segment.mp3');
  assert.equal(v.action, 'allow-and-mute',
    'a block here is the stall: the player never leaves the ad slot');
  assert.equal(v.host, 'audio-fa.spotifycdn.com');
  assert.equal(v.muted, true);
});

test('a song request is passed through untouched', () => {
  const t = S.createSlotTracker();
  const v = t.requestVerdict('https://p.scdn.co/song.mp3');
  assert.equal(v.action, 'passthrough');
});

test('non-Spotify traffic is passed through untouched', () => {
  const t = S.createSlotTracker();
  assert.equal(t.requestVerdict('https://example.com/x.png').action, 'passthrough');
  assert.equal(t.requestVerdict('about:blank').action, 'passthrough');
});

/* ------------------------------------------------------------------ *
 * The slot state machine: mute while an ad, restore when it ends
 * ------------------------------------------------------------------ */

function fakeElement(muted) {
  return { muted: !!muted, volume: 1 };
}

test('entering a slot mutes the element and remembers its prior state', () => {
  const t = S.createSlotTracker();
  const el = fakeElement(false);        // the page left it audible
  assert.equal(t.enterSlot(el, 'audio-fa.spotifycdn.com'), true);
  assert.equal(el.muted, true, 'the ad slot is silent');
  assert.equal(t.isOurs(el), true);
});

test('leaving a slot restores the pre-slot mute state, so the song is audible', () => {
  const t = S.createSlotTracker();
  const el = fakeElement(false);
  t.enterSlot(el, 'audio-fa.spotifycdn.com');
  assert.equal(el.muted, true);
  assert.equal(t.leaveSlot(el, 'ended'), true);
  assert.equal(el.muted, false, 'restored: the song that follows is audible');
  assert.equal(t.isOurs(el), false);
});

test('an element the user had already muted stays muted after the slot', () => {
  const t = S.createSlotTracker();
  const el = fakeElement(true);
  t.enterSlot(el, 'audio-fa.spotifycdn.com');
  t.leaveSlot(el, 'ended');
  assert.equal(el.muted, true,
    'we restore, we do not unmute: a user-muted element is left user-muted');
});

test('a song element is never put in a slot', () => {
  const t = S.createSlotTracker();
  const el = fakeElement(false);
  assert.equal(t.enterSlot(el, 'p.scdn.co'), false,
    'the song must never be muted by the ad-slot mechanism');
  assert.equal(el.muted, false);
});

test('entering a slot twice is idempotent and keeps the ORIGINAL prior state', () => {
  const t = S.createSlotTracker();
  const el = fakeElement(false);
  t.enterSlot(el, 'audio-fa.spotifycdn.com');
  el.muted = true;                      // the slot holds
  t.enterSlot(el, 'audio-sp-ash1.spotifycdn.com');   // a second ad in the slot
  t.leaveSlot(el, 'ended');
  assert.equal(el.muted, false,
    'the first prior state is the one restored, not the slot-time value');
});

test('leaving a slot that was never entered is a no-op', () => {
  const t = S.createSlotTracker();
  const el = fakeElement(false);
  assert.equal(t.leaveSlot(el, 'ended'), false);
  assert.equal(el.muted, false);
});

test('navigating to the song both ends the slot and returns the URL', () => {
  const t = S.createSlotTracker();
  const el = fakeElement(false);
  t.enterSlot(el, 'audio-fa.spotifycdn.com');
  const nav = t.navigateToSong(el, 'https://p.scdn.co/song.mp3');
  assert.equal(nav.url, 'https://p.scdn.co/song.mp3');
  assert.equal(t.isOurs(el), false, 'the slot ended');
  assert.equal(el.muted, false, 'and the song is audible');
});

test('the mute/unmute callbacks fire, so the content script can observe them', () => {
  const events = [];
  const t = S.createSlotTracker({
    onMute: (el, host) => events.push(['mute', host]),
    onUnmute: (el, reason) => events.push(['unmute', reason]),
  });
  const el = fakeElement(false);
  t.enterSlot(el, 'audio-fa.spotifycdn.com');
  t.leaveSlot(el, 'ended');
  assert.deepEqual(events, [
    ['mute', 'audio-fa.spotifycdn.com'],
    ['unmute', 'ended'],
  ]);
});

/* ------------------------------------------------------------------ *
 * The shields row: per-site, tri-state, default on
 * ------------------------------------------------------------------ */

test('the Spotify ad-slot row ships default-on as a tri-state row', () => {
  assert.equal(P.FACTORY.spotifyAdSlot, 'global',
    'tri-state: global|on|off, and global resolves to the feature being on');
  const resolved = P.resolve({ globalRule: {}, siteRule: {}, session: null });
  const effective = effectiveSpotify(resolved);
  assert.equal(effective, true, 'the default is that the feature is active');
});

test('a per-site off turns the Spotify feature off for that site', () => {
  const resolved = P.resolve({
    globalRule: {},
    siteRule: { spotifyAdSlot: 'off' },
    session: null,
  });
  assert.equal(effectiveSpotify(resolved), false);
});

test('a per-site on keeps the feature on even if the global turns it off', () => {
  const resolved = P.resolve({
    globalRule: { spotifyAdSlot: 'off' },
    siteRule: { spotifyAdSlot: 'on' },
    session: null,
  });
  assert.equal(effectiveSpotify(resolved), true);
});

test('the row is published to the panel and the options page', () => {
  const row = P.ROWS.find(r => r.key === 'spotifyAdSlot');
  assert.ok(row, 'the row exists');
  assert.equal(row.kind, 'toggle');
  assert.ok(Array.isArray(row.options) && row.options.includes('on') &&
    row.options.includes('off'), 'tri-state options');
});

/** The same "inherit" rule the fingerprinting sub-toggles use. */
function effectiveSpotify(resolved) {
  const v = resolved.rule.spotifyAdSlot;
  if (v === 'on') return true;
  if (v === 'off') return false;
  return true;   // 'global' -> on: the feature is on by default
}

/* ------------------------------------------------------------------ *
 * The anti-adblock list entry in the registry
 * ------------------------------------------------------------------ */

test('the registry ships the anti-adblock list', () => {
  const lists = require('../lib/filterlist/lists.js');
  const id = lists.DEFAULT_SOURCES.find(s => s.id === 'antiadblock-warning-removal');
  assert.ok(id, 'the Adblock Warning Removal List is a default source');
  assert.ok(/antiadblockfilters\.txt$/.test(id.url), id.url);
  assert.ok(id.description.toLowerCase().includes('ad blocker'),
    'its description names the wall it removes');
});

test('the shipped snapshot actually carries anti-adblock-wall rules', () => {
  const snap = path.join(__dirname, '..', 'lib', 'filterlist', 'snapshots',
    'antiadblock-warning-removal.txt');
  const text = fs.readFileSync(snap, 'utf8');
  // Generic cosmetic rules that hide the wall itself, which is what makes the
  // "the wall does not appear" claim true rather than a detector flag.
  assert.ok(/#\.adblock_msg/.test(text), 'it hides .adblock_msg');
  assert.ok(/#\.detected-block-modal/.test(text), 'it hides .detected-block-modal');
  assert.ok(/#\.adblock_floating_message/.test(text), 'it hides .adblock_floating_message');
  // And the detector scripts themselves, which is the stronger half.
  assert.ok(/\/adb_script\/\*/.test(text), 'it blocks the /adb_script/ detector');
  assert.ok(/\/mod_ablockdetector\//.test(text), 'it blocks /mod_ablockdetector/');
});
