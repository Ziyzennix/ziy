/* Ziy Playlist — the sleep timer state machine.
 *
 * A sleep timer is a real timer with real consequences: after N minutes it
 * pauses the player, once, and it says so. A sleep timer that keeps ticking
 * after it has fired, or that silently resets, or that cannot be cancelled,
 * is worse than nothing.
 *
 * So the machine is explicit about its states, and every transition is a
 * function from a state to a state. The I/O (the wall clock, the pause
 * command) is injected, so the whole machine is testable with a fake clock
 * and no media element:
 *
 *   create(durationMinutes, now)      -> idle-with-a-deadline state
 *   tick(state, now)                  -> same state, or 'fired'
 *   cancel(state)                     -> idle state
 *   remaining(state, now)             -> seconds left, 0 when none
 *   describe(state, now)              -> a sentence for the panel
 *
 * States:
 *   off      no timer
 *   running  a deadline in the future
 *   fired    the deadline passed: the player has been paused once
 *
 * The fired state is terminal on purpose. A user who sets 15 minutes and
 * walks away does not want a second pause 15 minutes later; "pause, then
 * stop" is what a sleep timer means. Setting a new length starts a fresh
 * timer, which is the documented way to sleep another 15.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyPlaylistSleep = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATE_OFF = "off";
  const STATE_RUNNING = "running";
  const STATE_FIRED = "fired";

  const MIN_MINUTES = 1;
  const MAX_MINUTES = 24 * 60;

  function off() {
    return { state: STATE_OFF, minutes: 0, startedAt: 0, endsAt: 0, firedAt: 0 };
  }

  /**
   * Starts a timer. A non-finite, zero or negative length means OFF, which is
   * how the settings row's "no timer" maps onto the machine.
   *
   * `now` is in MILLISECONDS, the unit the wall clock and the panel's
   * setInterval both use. `minutes` is minutes. The conversion happens once,
   * here, so every other function in this file works in one unit and the
   * "60 seconds per minute" fact cannot be re-derived wrongly elsewhere.
   */
  function create(minutes, now) {
    const start = Number.isFinite(now) ? now : 0;
    const n = Number(minutes);
    if (!Number.isFinite(n) || n < MIN_MINUTES || n > MAX_MINUTES) return off();
    return {
      state: STATE_RUNNING,
      minutes: n,
      startedAt: start,
      endsAt: start + n * 60 * 1000,
      firedAt: 0,
    };
  }

  /** Extends the running timer, keeping its start. */
  function extend(state, extraMinutes, now) {
    const start = Number.isFinite(now) ? now : 0;
    if (!state || state.state !== STATE_RUNNING) return create(extraMinutes, start);
    const n = Number(extraMinutes);
    if (!Number.isFinite(n) || n <= 0) return state;
    return Object.assign({}, state, {
      minutes: state.minutes + n,
      endsAt: state.endsAt + n * 60 * 1000,
    });
  }

  function cancel(state) {
    void state;
    return off();
  }

  /**
   * The machine's heart: given the wall clock, has the deadline passed?
   * Returns the same state when still running, the fired state when it has.
   * A fired state stays fired whatever the clock does.
   */
  function tick(state, now) {
    if (!state) return off();
    if (state.state === STATE_FIRED) return state;
    if (state.state !== STATE_RUNNING) return state;
    const at = Number.isFinite(now) ? now : 0;
    if (at < state.endsAt) return state;
    return Object.assign({}, state, {
      state: STATE_FIRED,
      firedAt: at,
    });
  }

  /** Seconds left, rounded up. 0 when off or already fired. */
  function remaining(state, now) {
    if (!state || state.state !== STATE_RUNNING) return 0;
    const at = Number.isFinite(now) ? now : 0;
    if (at >= state.endsAt) return 0;
    return Math.ceil((state.endsAt - at) / 1000);
  }

  function isRunning(state) {
    return Boolean(state && state.state === STATE_RUNNING);
  }

  function hasFired(state) {
    return Boolean(state && state.state === STATE_FIRED);
  }

  /** The panel's one-line status. Always a sentence, never a bare number. */
  function describe(state, now) {
    if (!state || state.state === STATE_OFF) return "No sleep timer.";
    if (state.state === STATE_FIRED) {
      return "The sleep timer ran out, so playback is paused.";
    }
    const left = remaining(state, now);
    if (left <= 0) return "The sleep timer is about to run out.";
    const minutes = Math.floor(left / 60);
    const secondPart = left % 60;
    if (minutes === 0) return `Sleeping in ${secondPart} second${secondPart === 1 ? "" : "s"}.`;
    const m = `${minutes} minute${minutes === 1 ? "" : "s"}`;
    if (secondPart === 0) return `Sleeping in ${m}.`;
    return `Sleeping in ${m} and ${secondPart} second${secondPart === 1 ? "" : "s"}.`;
  }

  /**
   * TRUE ONLY ON THE TRANSITION. `tick` returns the same object when it
   * does not change state, and a new object when it moves to fired, so
   * identity is the edge detector. A tick on an already-fired state returns
   * that same object again, so a second call after the pause does not ask
   * for a second pause.
   */
  function shouldPause(state, now) {
    const next = tick(state, now);
    return next !== state && hasFired(next);
  }

  return {
    STATE_OFF,
    STATE_RUNNING,
    STATE_FIRED,
    MIN_MINUTES,
    MAX_MINUTES,
    off,
    create,
    extend,
    cancel,
    tick,
    remaining,
    isRunning,
    hasFired,
    describe,
    shouldPause,
  };
});
