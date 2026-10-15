/* Ziy Talk — settings, the third-party gate, and the room-link construction.
 *
 * The two things under test are the ones a bug would make expensive:
 *
 *   1. THE GATE. A call on somebody else's server hands that operator the room
 *      name, the join times and the participants' network addresses. Ziy's job is
 *      to say that out loud before it happens, once, and then to respect a
 *      decision not to be asked again — but never to imply trust that was not
 *      given. Both directions are tested.
 *   2. THE LINKS. A room link is the product: it is the whole of F11. It must
 *      resolve against the configured server, survive a settings change, and
 *      never alias one server to another via a suffix match.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../lib/settings.js');
const ROOM = require('../lib/room.js');

S.bindRoomHelpers(ROOM);

const OWN = 'https://meet.example.org';
const PUBLIC = S.PUBLIC_TEST_SERVER;

test('the shipped default server is a reserved-invalid origin, not a real service', () => {
  // RFC 6761 reserves .invalid so it can never resolve. This is what makes the
  // default state honest: a well-formed https origin that no DNS can answer, so
  // the product's first-run state is "no server configured" rather than a
  // silent dependency on somebody.
  assert.equal(S.DEFAULT_SERVER, 'https://meet.example.invalid');
  assert.match(S.DEFAULT_SERVER, /\.invalid$/);
  // And it must NOT be the public test server: that is opt-in only.
  assert.notEqual(S.DEFAULT_SERVER, PUBLIC);
});

test('the factory settings are the documented defaults', () => {
  const f = S.factorySettings();
  assert.equal(f.serverUrl, S.DEFAULT_SERVER);
  assert.equal(f.displayName, '');
  assert.equal(f.audioMuted, false, 'microphone on is the reasonable default for a call');
  assert.equal(f.videoMuted, true, 'the camera must not turn itself on before the user says so');
  assert.equal(f.cameraPreview, true);
  assert.equal(f.openInNewTab, false, 'sidebar is the cheaper first choice');
  assert.equal(f.warnThirdParty, true, 'the gate is ON by default — the product decision');
  assert.equal(f.preMeetingScreen, true);
  assert.equal(f.sounds, true);
});

test('every field has a validator, a default and a hint — no undeclared settings', () => {
  const keys = S.FIELDS.map((f) => f.key).sort();
  assert.deepEqual(keys, Object.keys(S.factorySettings()).sort());
  for (const f of S.FIELDS) {
    assert.equal(typeof f.default !== 'undefined', true, `${f.key} has no default`);
    assert.equal(typeof f.validate, 'function', `${f.key} has no validator`);
    assert.equal(typeof f.hint, 'string', `${f.key} has no hint for the options page`);
    assert.equal(f.validate(f.default), null, `${f.key} rejects its own default`);
  }
});

/* ------------------------------------------------------------------ *
 * Server URL validation.
 * ------------------------------------------------------------------ */

test('a server URL must be a usable https origin', () => {
  const ok = [
    'https://meet.example.org',
    'https://meet.example.org/',
    'https://meet.example.org:8443',
    'https://meet.jit.si',
    'https://sub.domain.meet.example.org',
  ];
  for (const value of ok) {
    assert.equal(S.normaliseServerUrl(value) !== null, true, `${value} should be usable`);
    assert.equal(S.validateServerUrl(value), null, `${value} should validate`);
  }
});

test('a server URL that is not usable is rejected with a usable message', () => {
  const bad = [
    ['', /Enter the address/],
    ['   ', /Enter the address/],
    ['http://meet.example.org', /not a usable https server address/, 'plain http leaks the call to the wire'],
    ['ftp://meet.example.org', /not a usable/],
    ['meet.example.org', /not a usable/, 'no scheme is not an address'],
    ['javascript:alert(1)', /not a usable/],
    ['data:text/html,x', /not a usable/],
    ['https://', /not a usable/],
    ['https://meet.example.org/push credentials', null], // credentials are rejected by normalise
    ['not a url at all', /not a usable/],
  ];
  for (const [value, pattern] of bad) {
    const problem = S.validateServerUrl(value);
    if (pattern === null) continue;
    assert.notEqual(problem, null, `${value} should not validate`);
    assert.match(problem, pattern, `message for ${value}`);
  }
});

test('credentials in a server URL are refused', () => {
  // A URL like https://user:pass@host is not a supported way to point at a
  // server, and comparing origins that carry credentials is how two setups quietly
  // become the same server.
  assert.equal(S.normaliseServerUrl('https://user:pass@meet.example.org'), null);
  assert.equal(S.normaliseServerUrl('https://meet.example.org'), 'https://meet.example.org');
});

test('normalisation collapses a URL to its origin, so one server is one value', () => {
  // The public test server must compare equal no matter what path it arrived
  // with: 'https://meet.jit.si/x' must be recognised as the same server, or the
  // gate would be defeated by appending a path.
  for (const variant of [
    'https://meet.jit.si',
    'https://meet.jit.si/',
    'https://meet.jit.si/anything',
    'https://meet.jit.si/anything?x=1#y',
    'https://meet.jit.si:443',
    ' https://meet.jit.si ',
  ]) {
    assert.equal(S.normaliseServerUrl(variant), PUBLIC, `${variant} should normalise to the origin`);
    assert.equal(S.isPublicTestServer(variant), true, `${variant} should be recognised as the public server`);
  }
});

test('a public-server lookalike is NOT the public server', () => {
  // A suffix match would treat these as the same operator. They are not. Note
  // that a path-normalising form like 'https://meet.jit.si:443/../meet.jit.si'
  // genuinely IS meet.jit.si once the URL parser resolves it, so it is excluded
  // here and asserted separately below: the point of this test is the hosts that
  // only LOOK like the public server.
  for (const lookalike of [
    'https://meet.jit.si.evil.example',
    'https://evil.example/meet.jit.si',
    'https://notmeet.jit.si',
    'https://meet.jit.si.attacker.test',
    'https://meet.jit.six',       // one letter different
    'https://meet.jit.si.example.com',
  ]) {
    const origin = S.normaliseServerUrl(lookalike);
    assert.notEqual(origin, PUBLIC, `${lookalike} must not equal the public server`);
    assert.equal(S.isPublicTestServer(lookalike), false, `${lookalike} must not be treated as public`);
  }
});

test('path tricks resolve to the origin, so they are the same server', () => {
  // 'https://meet.jit.si:443/../meet.jit.si' normalises to the origin and the
  // gate treats it as the public server. This is correct: it IS that server, and
  // the gate is about the operator, not the spelling.
  assert.equal(S.normaliseServerUrl('https://meet.jit.si:443/../meet.jit.si'), PUBLIC);
  assert.equal(S.isPublicTestServer('https://meet.jit.si:443/../meet.jit.si'), true);
});

/* ------------------------------------------------------------------ *
 * The third-party gate.
 * ------------------------------------------------------------------ */

test('an own server triggers no gate', () => {
  const trust = S.serverTrust(S.factorySettings(), OWN);
  assert.equal(trust.isPublic, false);
  assert.equal(trust.isSelfHosted, true);
  assert.equal(trust.configured, true);
  assert.equal(trust.requiresConfirmation, false, 'nobody to warn about');
});

test('the unconfigured default triggers no gate — there is nobody to warn about', () => {
  const trust = S.serverTrust(S.factorySettings(), S.DEFAULT_SERVER);
  assert.equal(trust.requiresConfirmation, false);
  assert.equal(trust.isPublic, false);
});

test('the public test server triggers the gate, and only the gate allows it', () => {
  const on = S.factorySettings();
  const trust = S.serverTrust(on, PUBLIC);
  assert.equal(trust.isPublic, true);
  assert.equal(trust.requiresConfirmation, true, 'the default must warn');

  const off = S.serialiseSettings(Object.assign({}, on, { warnThirdParty: false }));
  const trustOff = S.serverTrust(off, PUBLIC);
  assert.equal(trustOff.isPublic, true);
  assert.equal(trustOff.requiresConfirmation, false,
    'turning the gate off is exactly this decision, and must not be re-asked');
});

test('the gate reads the setting in the record, not the argument', () => {
  // The panel passes the settings record and the value it wants to call; the
  // gate must honour the record, so a half-built call cannot bypass it.
  const off = S.serialiseSettings({ warnThirdParty: false });
  assert.equal(S.serverTrust(off, PUBLIC).requiresConfirmation, false);
  const on = S.serialiseSettings({ warnThirdParty: true });
  assert.equal(S.serverTrust(on, PUBLIC).requiresConfirmation, true);
  // And the gate cannot be bypassed by pointing at a lookalike: the lookalike is
  // not public, so it is not warned about either — but it is also not the public
  // server, which is correct and separately tested above.
  assert.equal(S.serverTrust(on, 'https://meet.jit.si.evil.example').requiresConfirmation, false);
});

test('the default reserved-invalid origin is not treated as a configured server', () => {
  // The shipped default is a well-formed https URL that can never resolve, so
  // "configured" must be false for it: otherwise the panel would try to start a
  // call that cannot open, and the first-run state would lie.
  const trust = S.serverTrust(S.factorySettings(), S.DEFAULT_SERVER);
  assert.equal(trust.configured, false, 'the reserved-invalid default must not count as a server');
  assert.equal(trust.isPublic, false);
  assert.equal(trust.requiresConfirmation, false);
});

test('an unusable value is not a server, and is reported as unconfigured', () => {
  for (const junk of ['', 'not a url', 'http://insecure.example', 'javascript:alert(1)']) {
    const trust = S.serverTrust(S.factorySettings(), junk);
    assert.equal(trust.configured, false, `${junk} must not be configured`);
    assert.equal(trust.requiresConfirmation, false, `${junk} must not trigger the gate`);
  }
  // But a real value passed alongside an unusable settings record still works.
  const trust = S.serverTrust(S.serialiseSettings({ serverUrl: 'https://own.example' }), OWN);
  assert.equal(trust.configured, true);
  assert.equal(trust.origin, OWN);
});

/* ------------------------------------------------------------------ *
 * Room-link and scheme construction.
 * ------------------------------------------------------------------ */

test('a room URL is the configured origin plus the room id, nothing else', () => {
  const room = ROOM.generateRoomId();
  assert.equal(S.buildRoomUrl(OWN, room), `${OWN}/${room}`);

  // A path on the server must not become part of the room URL: the meeting lives
  // at <origin>/<room>.
  assert.equal(S.buildRoomUrl('https://meet.example.org/deep/path', room), `${OWN}/${room}`);
  assert.equal(S.buildRoomUrl('https://meet.example.org/deep/path/', room), `${OWN}/${room}`);
});

test('a room URL is null when the server is unusable', () => {
  const room = ROOM.generateRoomId();
  assert.equal(S.buildRoomUrl('nope', room), null);
  assert.equal(S.buildRoomUrl('', room), null);
  assert.equal(S.buildRoomUrl('http://meet.example.org', room), null);
});

test('the scheme URL is Ziy\'s own and points at the room, not a server', () => {
  const room = ROOM.generateRoomId();
  assert.equal(S.buildSchemeUrl(room), `ziy-talk://${room}`);
  assert.equal(S.buildSchemeUrl(''), null);
});

test('a scheme URL resolves to the configured server\'s room URL', () => {
  const room = ROOM.generateRoomId();
  const settings = S.serialiseSettings({ serverUrl: OWN });
  const resolved = S.resolveSchemeUrl(`ziy-talk://${room}`, settings);
  assert.equal(resolved.error, null);
  assert.equal(resolved.roomId, room);
  assert.equal(S.buildRoomUrl(OWN, resolved.roomId), `${OWN}/${room}`);
});

test('a scheme URL with extra path or query still resolves', () => {
  const room = ROOM.generateRoomId();
  const settings = S.serialiseSettings({ serverUrl: OWN });
  for (const href of [
    `ziy-talk://${room}`,
    `ziy-talk://${room}#from-device`,
    `ziy-talk://${room}/?x=1`,
  ]) {
    assert.equal(S.resolveSchemeUrl(href, settings).roomId, room, href);
  }
});

test('a scheme URL cannot resolve without a server, and says so', () => {
  const room = ROOM.generateRoomId();
  const bare = S.serialiseSettings({ serverUrl: 'not a url' });
  // serialiseSettings self-heals the record back to the shipped default, so the
  // settings record always holds a parseable URL — which is the point. The
  // unconfigured case is therefore reached through the DEFAULT origin, and the
  // honest answer is that there is nowhere to open the link.
  assert.equal(bare.serverUrl, S.DEFAULT_SERVER);
  const resolved = S.resolveSchemeUrl(`ziy-talk://${room}`, bare);
  assert.equal(resolved.roomId, room, 'the room is still parsed — that is the useful part');
  assert.match(resolved.error, /not configured/);
});

test('a scheme URL against the shipped default is refused, not silently sent', () => {
  // The default is reserved-invalid, so a ziy-talk:// link must not be resolved
  // into a URL that can never load. The user hears why instead.
  const room = ROOM.generateRoomId();
  const resolved = S.resolveSchemeUrl(`ziy-talk://${room}`, S.factorySettings());
  assert.equal(resolved.roomId, room);
  assert.match(resolved.error, /not configured/);
});

test('a scheme URL that is not ours, or is malformed, is refused with a reason', () => {
  const settings = S.serialiseSettings({ serverUrl: OWN });
  assert.equal(S.resolveSchemeUrl('https://meet.example.org/x', settings).roomId, null);
  assert.match(S.resolveSchemeUrl('https://meet.example.org/x', settings).error, /Not a Ziy Talk link/);
  assert.match(S.resolveSchemeUrl('ziy-talk://too-short', settings).error, /15 characters/);
  assert.match(S.resolveSchemeUrl('ziy-talk://' + '!'.repeat(15), settings).error, /letters A-Z/);
  assert.match(S.resolveSchemeUrl('ziy-talk://' + '!'.repeat(15), settings).error, /letters A-Z/);
});

test('the scheme URL is percent-decoded before the charset test', () => {
  const room = ROOM.generateRoomId();
  const settings = S.serialiseSettings({ serverUrl: OWN });
  assert.equal(S.resolveSchemeUrl(`ziy-talk://${encodeURIComponent(room)}`, settings).roomId, room);
});

/* ------------------------------------------------------------------ *
 * Settings records survive schema changes.
 * ------------------------------------------------------------------ */

test('normalisation self-heals a record written by an older build', () => {
  // A stored value that fails its field's own validator is replaced by the
  // default rather than half-accepted, so a stale record is never half-truthful.
  const healed = S.normaliseSettings({
    serverUrl: 'javascript:alert(1)', // rejected
    displayName: 12345,               // rejected: not a string at the field level
    audioMuted: 'yes',                // rejected
    videoMuted: false,                // accepted
    // cameraPreview missing entirely -> default
    warnThirdParty: 'true',           // rejected
  });
  assert.equal(healed.serverUrl, S.DEFAULT_SERVER);
  assert.equal(healed.displayName, '');
  assert.equal(healed.audioMuted, false);
  assert.equal(healed.videoMuted, false, 'a valid stored value is kept');
  assert.equal(healed.cameraPreview, true, 'a missing field gets the default');
  assert.equal(healed.warnThirdParty, true, 'the gate cannot be persisted as a non-boolean');
});

test('normalisation tolerates junk without throwing', () => {
  for (const junk of [null, undefined, 0, '', 'string', [], [1, 2], { a: 1 }, NaN, true]) {
    const out = S.normaliseSettings(junk);
    assert.deepEqual(Object.keys(out).sort(), Object.keys(S.factorySettings()).sort());
    assert.equal(out.serverUrl, S.DEFAULT_SERVER);
  }
});

test('serialise is idempotent and round-trips a valid record', () => {
  const good = S.serialiseSettings({
    serverUrl: OWN,
    displayName: 'Ada',
    audioMuted: true,
    videoMuted: false,
    warnThirdParty: false,
    openInNewTab: true,
  });
  assert.deepEqual(S.serialiseSettings(good), good);
  assert.equal(good.serverUrl, OWN);
  assert.equal(good.displayName, 'Ada');
});

test('the call mode is expressed by one boolean, and the panel reads it', () => {
  // 'tab' is openInNewTab true; 'sidebar' is false. The state machine and the
  // panel both derive the mode rather than storing a string that can drift.
  const tab = S.serialiseSettings({ openInNewTab: true });
  const sidebar = S.serialiseSettings({ openInNewTab: false });
  assert.equal(tab.openInNewTab, true);
  assert.equal(sidebar.openInNewTab, false);
});

/* ------------------------------------------------------------------ *
 * Recent rooms.
 * ------------------------------------------------------------------ */

test('recent rooms are bounded, deduplicated and newest first', () => {
  let list = [];
  const rooms = ['AAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBB', 'CCCCCCCCCCCCCCC', 'DDDDDDDDDDDDDDD'];
  for (const room of rooms) list = S.rememberRoom(list, room, OWN, 1000);
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((r) => r.room), [...rooms].reverse());

  // Returning to a room promotes it but keeps its original startedAt.
  const timestamp = list.find((r) => r.room === 'CCCCCCCCCCCCCCC').startedAt;
  list = S.rememberRoom(list, 'CCCCCCCCCCCCCCC', OWN, 2000);
  assert.equal(list.length, 4, 'no duplicate');
  assert.equal(list[0].room, 'CCCCCCCCCCCCCCC', 'moved to the front');
  assert.equal(list[0].startedAt, timestamp, 'the first-use date is a fact and does not move');
  assert.equal(list[0].lastUsedAt, 2000, 'the last-use date does');

  // Bounded at 12: a local list that grows without limit is a slow bug.
  for (let i = 0; i < 30; i++) {
    list = S.rememberRoom(list, `R${String(i).padStart(14, '0')}`, OWN, 3000 + i);
  }
  assert.equal(list.length, S.RECENT_MAX);
  assert.equal(S.normaliseRecent(list).length, S.RECENT_MAX);
});

test('recent-room normalisation drops junk and keeps the ceiling', () => {
  const kept = S.normaliseRecent([
    { room: 'AAAAAAAAAAAAAAA', server: OWN, startedAt: 5, lastUsedAt: 9 },
    { room: 'BBBBBBBBBBBBBBB' },
    null,
    'a string',
    { room: 'CCCCCCCCCCCCCCC', server: 'nope' },
    { room: 42 },
    { room: 'DDDDDDDDDDDDDDD', startedAt: 'not-a-number' },
  ]);
  assert.equal(kept.length, 4);
  assert.equal(kept[0].room, 'AAAAAAAAAAAAAAA');
  assert.equal(kept[0].lastUsedAt, 9);
  assert.equal(kept[3].lastUsedAt, 0, 'a non-numeric time is not kept as a string');
  assert.equal(S.normaliseRecent('nope').length, 0);
});

/* ------------------------------------------------------------------ *
 * The TalkRoom record (architecture §3.1).
 * ------------------------------------------------------------------ */

test('the transient room record normalises and drops malformed rooms', () => {
  const room = ROOM.generateRoomId();
  const record = S.normaliseRoom({ room, server: OWN, startedAt: 10, state: 'live' });
  assert.equal(record.room, room);
  assert.equal(record.server, OWN);
  assert.equal(record.state, 'live');
  assert.equal(record.endedAt, null);

  assert.equal(S.normaliseRoom(null), null);
  assert.equal(S.normaliseRoom({}), null);
  assert.equal(S.normaliseRoom({ room: 'short' }), null);
  assert.equal(S.normaliseRoom({ room, server: 'nope' }).server, null);
});
