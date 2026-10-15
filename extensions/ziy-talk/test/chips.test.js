/* Ziy Talk — the control-chip state machine.
 *
 * The two things that must hold, and are the only things worth testing:
 *
 *   1. EVERY CHIP PRESS ANSWERS HONESTLY. In a live call with a bridge, a press
 *      produces the documented Jitsi command. Without a bridge, the same press
 *      produces the degraded annotation — never a state change, never a fake
 *      toggle, never a silent no-op. With no call at all, it produces a refusal.
 *   2. EVENTS MAP TO STATE, AND UNKNOWN EVENTS DO NOT. Jitsi's events drive the
 *      chips backwards; anything this build has not seen leaves the state alone
 *      rather than inventing a transition.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../lib/chips.js');

const live = () => Object.assign(C.factoryChipState(), { bridge: 'live', call: 'live' });
const sidebar = () => Object.assign(C.factoryChipState(), { bridge: 'absent', call: 'live' });
const idle = () => C.factoryChipState();

/* ------------------------------------------------------------------ *
 * The roster: the seven controls recon S39 names, plus navigation.
 * ------------------------------------------------------------------ */

test('the chip roster is exactly the controls recon S39 lists, plus leave', () => {
  assert.deepEqual(C.CHIP_IDS, [
    'microphone', 'camera', 'screen', 'chat', 'hand', 'participants', 'tiles',
    'advanced', 'leave',
  ]);
  for (const id of ['microphone', 'camera', 'screen', 'chat', 'hand', 'participants', 'tiles']) {
    assert.ok(C.CHIP_IDS.includes(id), `S39 lists ${id} and it is missing`);
  }
});

test('every chip has a Jitsi command, a label pair and a glyph', () => {
  // 'advanced' is the menu opener and 'leave' is navigation; the seven media ones
  // all map to documented commands.
  for (const chip of C.CHIPS) {
    assert.equal(typeof C.LABELS[chip.id], 'object', `${chip.id} has no label pair`);
    assert.equal(typeof C.LABELS[chip.id].off, 'string');
    assert.equal(typeof C.LABELS[chip.id].on, 'string');
    assert.equal(typeof C.glyph(chip.id), 'string', `${chip.id} has no glyph`);
    if (chip.kind !== 'action') {
      assert.equal(typeof chip.jitsi, 'string', `${chip.id} should carry a Jitsi command`);
    }
  }
});

test('every media chip\'s command is one the Jitsi iframe API documents', () => {
  // The documented command set, from the Jitsi handbook's IFrame API pages.
  const documented = new Set([
    'toggleAudio', 'toggleVideo', 'toggleShareScreen', 'toggleChat',
    'toggleRaiseHand', 'toggleParticipantsPane', 'toggleTileView',
    'hangup', 'displayName', 'toggleFilmStrip', 'setVideoQuality',
    'muteEveryone', 'kickParticipant', 'grantModerator', 'password',
    'toggleLobby', 'subject', 'sendChatMessage', 'toggleModeration',
  ]);
  for (const chip of C.CHIPS) {
    if (!chip.jitsi) continue;
    assert.ok(documented.has(chip.jitsi), `${chip.id} maps to ${chip.jitsi}, which is not documented`);
  }
});

/* ------------------------------------------------------------------ *
 * Press: the three honest answers.
 * ------------------------------------------------------------------ */

test('with a live bridge, every media chip press produces its documented command', () => {
  const expected = {
    microphone: 'toggleAudio',
    camera: 'toggleVideo',
    screen: 'toggleShareScreen',
    chat: 'toggleChat',
    hand: 'toggleRaiseHand',
    participants: 'toggleParticipantsPane',
    tiles: 'toggleTileView',
    leave: 'hangup',
  };
  const state = live();
  for (const [id, command] of Object.entries(expected)) {
    const intent = C.press(id, state);
    assert.equal(intent.kind, 'command', `${id} should be a command`);
    assert.equal(intent.command, command, `${id} should run ${command}`);
  }
});

test('without a bridge, the same presses produce annotations, not state changes', () => {
  // This is the load-bearing assertion of the whole module: the degraded path is
  // a real answer with a real message, not a faked toggle.
  const state = sidebar();
  assert.equal(state.bridge, 'absent');
  for (const id of C.CHIP_IDS) {
    if (id === 'advanced' || id === 'leave') continue;
    const intent = C.press(id, state);
    assert.equal(intent.kind, 'degraded', `${id} must degrade rather than pretend`);
    assert.equal(typeof intent.fallback.text, 'string', `${id} must say where the control lives`);
    assert.ok(intent.fallback.text.length > 0, `${id}'s degraded text must be informative`);
    // No command is ever produced, so nothing downstream can pretend to send one.
    assert.equal(intent.command, undefined, `${id} must not produce a command in degraded mode`);
  }
});

test('the degraded annotation names the meeting window rather than the meeting API', () => {
  // The point of the annotation: tell the user where the real control lives.
  const state = sidebar();
  for (const id of ['microphone', 'camera', 'screen', 'chat', 'hand', 'participants', 'tiles']) {
    const text = C.press(id, state).fallback.text.toLowerCase();
    assert.ok(text.includes('meeting'), `${id}'s degraded text should point at the meeting window`);
  }
});

test('every degraded fallback is either an annotation or a link — and says which', () => {
  const kinds = new Set(Object.values(C.DEGRADED_FALLBACK).map((f) => f.kind));
  for (const kind of kinds) {
    assert.ok(['annotate', 'link'].includes(kind), `unknown degraded kind ${kind}`);
  }
});

test('a press with no call is refused, and says so', () => {
  const state = idle();
  for (const id of C.CHIP_IDS) {
    if (id === 'leave') continue;   // leaving is always allowed
    const intent = C.press(id, state);
    assert.equal(intent.kind, 'rejected', `${id} should be refused while idle`);
    assert.match(intent.text, /no call in progress|would do nothing/);
  }
});

test('an unknown chip is refused rather than silently ignored', () => {
  for (const state of [idle(), live(), sidebar()]) {
    const intent = C.press('teleport', state);
    assert.equal(intent.kind, 'rejected');
    assert.match(intent.text, /no teleport control/);
  }
});

test('the bridge value is the only thing that separates command from degraded', () => {
  // Explicit: same call state, same chip, different bridge -> different answer.
  const withBridge = C.press('microphone', Object.assign(live(), { bridge: 'live' }));
  const without = C.press('microphone', Object.assign(sidebar(), { bridge: 'absent' }));
  assert.equal(withBridge.kind, 'command');
  assert.equal(without.kind, 'degraded');
});

/* ------------------------------------------------------------------ *
 * Events -> chip state.
 * ------------------------------------------------------------------ */

test('Jitsi\'s negated toggle values land on the right chips', () => {
  // Jitsi reports `muted: true` for "the microphone is muted", so the chip's ON
  // state is Jitsi's value verbatim. This is the detail most likely to be got
  // backwards: a flip here would show "muted" as "live" and vice versa.
  const cases = [
    ['audioMuteStatusChanged', { muted: true }, 'microphone', true],
    ['audioMuteStatusChanged', { muted: false }, 'microphone', false],
    ['videoMuteStatusChanged', { muted: true }, 'camera', true],
    ['videoMuteStatusChanged', { muted: false }, 'camera', false],
    ['screenSharingStatusChanged', { visible: true }, 'screen', true],
    ['screenSharingStatusChanged', { visible: false }, 'screen', false],
    ['raiseHandUpdated', { visible: true }, 'hand', true],
    ['raiseHandUpdated', { visible: false }, 'hand', false],
  ];
  for (const [event, payload, chip, expected] of cases) {
    const next = C.applyEvent(live(), event, payload);
    assert.equal(next[chip], expected, `${event} ${JSON.stringify(payload)} -> ${chip}=${expected}`);
  }
});

test('participant counts move only with participant events', () => {
  let state = live();
  assert.equal(state.participants, 0);
  state = C.applyEvent(state, 'participantJoined', { id: 'a' });
  state = C.applyEvent(state, 'participantJoined', { id: 'b' });
  assert.equal(state.participants, 2);
  state = C.applyEvent(state, 'participantLeft', { id: 'a' });
  assert.equal(state.participants, 1, 'one left');
  state = C.applyEvent(state, 'participantLeft', { id: 'a' });
  assert.equal(state.participants, 0, 'never below zero — a stale event must not underflow');
  state = C.applyEvent(state, 'participantLeft', { id: 'a' });
  assert.equal(state.participants, 0);
});

test('call lifecycle events move the call state', () => {
  let state = live();
  state = C.applyEvent(state, 'videoConferenceLeft', {});
  assert.equal(state.call, 'ended', 'leaving ends the call');
  state = C.applyEvent(state, 'readyToClose', {});
  assert.equal(state.call, 'ended');
});

test('a fatal error ends the call and keeps the message', () => {
  const state = C.applyEvent(live(), 'errorOccurred', {
    isFatal: true,
    message: 'The connection dropped.',
    type: 'CONNECTION',
  });
  assert.equal(state.call, 'error');
  assert.equal(state.error, 'The connection dropped.');
  // A non-fatal error does not tear down the call: Jitsi emits recoverable
  // errors mid-call and tearing down on them would end healthy calls.
  const nonFatal = C.applyEvent(live(), 'errorOccurred', { isFatal: false, message: 'transient' });
  assert.equal(nonFatal.call, 'live');
  assert.equal(nonFatal.error, null);
});

test('a device that disappears mid-call is reflected on its chip', () => {
  // Jitsi emits availabilityChanged with available:false when a device is gone.
  // The chip must show the muted state rather than a live toggle for hardware
  // that does not exist.
  const noMic = C.applyEvent(live(), 'audioAvailabilityChanged', { available: false });
  assert.equal(noMic.microphone, true, 'no microphone means the chip shows muted');
  const noCam = C.applyEvent(live(), 'videoAvailabilityChanged', { available: false });
  assert.equal(noCam.camera, true, 'no camera means the chip shows off');
  const withMic = C.applyEvent(noMic, 'audioAvailabilityChanged', { available: true });
  assert.equal(withMic.microphone, false, 'and back again when the device returns');
});

test('an unknown event leaves the state untouched', () => {
  // This is what keeps the machine honest against a server that emits something
  // this build has never seen: no transition is invented.
  const state = live();
  for (const event of ['somethingNew', 'some-other-event', 'videoConferenceJoinedLater', '', 'ready']) {
    const next = C.applyEvent(state, event, {});
    assert.deepEqual(next, state, `${event || '(empty)'} must not change the state`);
  }
});

test('an event with no payload does not invent a value', () => {
  const state = live();
  const next = C.applyEvent(state, 'audioMuteStatusChanged', undefined);
  assert.equal(next.microphone, state.microphone, 'no payload, no change');
  const next2 = C.applyEvent(state, 'audioMuteStatusChanged', {});
  assert.equal(next2.microphone, state.microphone, 'a payload without the key is no information');
  // A non-boolean value is not accepted either.
  const next3 = C.applyEvent(state, 'audioMuteStatusChanged', { muted: 'yes' });
  assert.equal(next3.microphone, state.microphone, 'a non-boolean is not a mute state');
});

test('applyEvent is pure — the input state is never mutated', () => {
  const state = live();
  const before = JSON.stringify(state);
  C.applyEvent(state, 'audioMuteStatusChanged', { muted: true });
  C.applyEvent(state, 'participantJoined', {});
  assert.equal(JSON.stringify(state), before, 'the caller\'s state must not be mutated');
});

/* ------------------------------------------------------------------ *
 * Labels and announcements.
 * ------------------------------------------------------------------ */

test('the accessible name carries the state, so the chip is never colour-only', () => {
  const off = live();
  assert.equal(C.label('microphone', off), 'Microphone');
  assert.equal(C.label('camera', off), 'Camera');
  assert.equal(C.label('screen', off), 'Share your screen');

  const on = Object.assign({}, off, { microphone: true, camera: true, screen: true });
  assert.equal(C.label('microphone', on), 'Microphone, muted');
  assert.equal(C.label('camera', on), 'Camera, off');
  assert.equal(C.label('screen', on), 'Stop sharing your screen');
});

test('aria-pressed is returned only for chips that have a pressed state', () => {
  const state = Object.assign(live(), { microphone: true, tiles: false });
  assert.equal(C.pressed('microphone', state), true);
  assert.equal(C.pressed('tiles', state), false);
  // Panes open and close, so they report pressed too.
  assert.equal(C.pressed('chat', Object.assign(live(), { chat: true })), true);
  assert.equal(C.pressed('participants', Object.assign(live(), { participants: true })), true);
  // One-shot actions have no pressed state at all.
  assert.equal(C.pressed('advanced', state), null);
  assert.equal(C.pressed('leave', state), null);
});

test('the participants live region counts people, not zero', () => {
  const base = live();
  assert.equal(C.participantsAnnouncement(base), 'You are the only one here so far.');
  assert.equal(C.participantsAnnouncement(Object.assign(base, { participants: 1 })),
    '1 other person is here.');
  assert.equal(C.participantsAnnouncement(Object.assign(base, { participants: 4 })),
    '4 other people are here.');
  // No call, no announcement.
  assert.equal(C.participantsAnnouncement(idle()), '');
  assert.equal(C.participantsAnnouncement(Object.assign(base, { call: 'ended', participants: 3 })), '');
});

test('the factory chip state is off, idle and bridge-absent', () => {
  const f = C.factoryChipState();
  assert.equal(f.call, 'idle');
  assert.equal(f.bridge, 'absent');
  assert.equal(f.participants, 0);
  assert.equal(f.error, null);
  for (const id of ['microphone', 'camera', 'screen', 'chat', 'hand', 'tiles']) {
    assert.equal(f[id], false, `${id} starts off`);
  }
});
