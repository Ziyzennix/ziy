/* Ziy Playlist — the sleep timer state machine's tests.
 *
 * The clock is injected, so every transition is exercised without waiting.
 * The three properties that matter, and that a naive implementation loses:
 *
 *   1. IT FIRES ONCE. A state that fired stays fired: a user who set 15
 *      minutes does not get a second pause 15 minutes later.
 *   2. IT FIRES EVEN IF THE TICK WAS STARVED. shouldPause() re-evaluates the
 *      deadline against the clock, so a panel that was hidden does not
 *      "forget" to pause.
 *   3. IT CAN BE CANCELLED. A timer the user cancelled is gone, in the same
 *      state machine, not in the UI layer.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const sleep = require('../lib/sleep.js');

const T0 = 1_000_000;

/* --------------------------------------------------------------------- */
/* Constructing and cancelling                                             */
/* --------------------------------------------------------------------- */

test('a zero or invalid length is OFF, not a timer of nothing', () => {
  assert.equal(sleep.create(0, T0).state, 'off');
  assert.equal(sleep.create(-1, T0).state, 'off');
  assert.equal(sleep.create(NaN, T0).state, 'off');
  assert.equal(sleep.create(24 * 60 + 1, T0).state, 'off', 'past a day is not a sleep timer');
});

test('a timer carries a deadline one length in its future', () => {
  const state = sleep.create(15, T0);
  assert.equal(state.state, 'running');
  assert.equal(state.endsAt, T0 + 15 * 60 * 1000);
  assert.equal(sleep.remaining(state, T0), 900);
});

test('extending keeps the original start', () => {
  const state = sleep.extend(sleep.create(10, T0), 5, T0);
  assert.equal(state.minutes, 15);
  assert.equal(state.endsAt, T0 + 15 * 60 * 1000);
  assert.equal(state.startedAt, T0, 'the start does not move');
});

test('extending an OFF state starts a timer instead', () => {
  const state = sleep.extend(sleep.off(), 5, T0);
  assert.equal(state.state, 'running');
  assert.equal(state.minutes, 5);
});

test('cancel is total', () => {
  const state = sleep.cancel(sleep.create(5, T0));
  assert.equal(state.state, 'off');
  assert.equal(sleep.isRunning(state), false);
  assert.equal(sleep.remaining(state, T0 + 10 * 60 * 1000), 0);
});

/* --------------------------------------------------------------------- */
/* The deadline                                                            */
/* --------------------------------------------------------------------- */

test('before the deadline it stays running', () => {
  const state = sleep.create(5, T0);
  assert.equal(sleep.tick(state, T0 + 4 * 60 * 1000).state, 'running');
  assert.equal(sleep.shouldPause(state, T0 + 4 * 60 * 1000), false);
});

test('at and past the deadline it fires', () => {
  const state = sleep.create(5, T0);
  const fired = sleep.tick(state, T0 + 5 * 60 * 1000);
  assert.equal(fired.state, 'fired');
  assert.equal(sleep.shouldPause(state, T0 + 5 * 60 * 1000), true,
    'the running-to-fired edge asks for the pause');
});

test('shouldPause is the edge, so repeated ticks do not pause twice', () => {
  /* The panel calls shouldPause on a 1s interval. If it returned true while
     the state stayed fired, the interval would be a pause loop. */
  const state = sleep.create(5, T0);
  const at = T0 + 5 * 60 * 1000;
  assert.equal(sleep.shouldPause(state, at), true, 'the first look pauses');
  const fired = sleep.tick(state, at);
  assert.equal(sleep.shouldPause(fired, at + 1000), false, 'the second does not');
  assert.equal(sleep.shouldPause(fired, at + 60 * 60 * 1000), false, 'nor does one an hour later');
});

test('a clock in the future fires it too, and it does not fire again', () => {
  /* This is the starved-tick case: set a timer, close the panel, come back
     an hour later. The FIRST look must pause, and the second must not. */
  const state = sleep.create(5, T0);
  const late = T0 + 60 * 60 * 1000;
  assert.equal(sleep.shouldPause(state, late), true, 'one late look fires');
  const fired = sleep.tick(state, late);
  assert.equal(sleep.shouldPause(fired, late + 60 * 60 * 1000), false,
    'and it does not fire a second time');
});

test('a fired state is terminal whatever the clock does', () => {
  const fired = sleep.tick(sleep.create(5, T0), T0 + 6 * 60 * 1000);
  assert.equal(sleep.tick(fired, T0 + 7 * 60 * 1000).state, 'fired');
  assert.equal(sleep.isRunning(fired), false, 'it is no longer running');
  assert.equal(sleep.remaining(fired, T0 + 7 * 60 * 1000), 0);
});

test('a fresh timer can be started after a fire, which is the documented way to sleep again', () => {
  const first = sleep.tick(sleep.create(5, T0), T0 + 5 * 60 * 1000);
  const second = sleep.create(15, T0 + 5 * 60 * 1000);
  assert.equal(first.state, 'fired');
  assert.equal(second.state, 'running');
  assert.equal(sleep.shouldPause(second, T0 + 5 * 60 * 1000 + 14 * 60 * 1000), false);
  assert.equal(sleep.shouldPause(second, T0 + 5 * 60 * 1000 + 15 * 60 * 1000), true);
});

/* --------------------------------------------------------------------- */
/* The sentences                                                           */
/* --------------------------------------------------------------------- */

test('the status sentence is a sentence, never a bare number', () => {
  assert.equal(sleep.describe(sleep.off(), T0), 'No sleep timer.');
  assert.equal(sleep.describe(sleep.create(1, T0), T0), 'Sleeping in 1 minute.');
  assert.equal(sleep.describe(sleep.create(1, T0), T0 + 30 * 1000), 'Sleeping in 30 seconds.');
  assert.equal(sleep.describe(sleep.create(5, T0), T0 + 90 * 1000),
    'Sleeping in 3 minutes and 30 seconds.');
  const fired = sleep.tick(sleep.create(5, T0), T0 + 5 * 60 * 1000);
  assert.equal(sleep.describe(fired, T0 + 5 * 60 * 1000),
    'The sleep timer ran out, so playback is paused.');
});

test('an OFF state, described, says so', () => {
  assert.equal(sleep.describe(null, T0), 'No sleep timer.');
});
