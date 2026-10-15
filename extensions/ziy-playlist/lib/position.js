/* Ziy Playlist — resume points.
 *
 * "Resume where you left off" is a promise about a number, so this module
 * decides when a remembered position is offered and when it is dropped.
 * Pure, no DOM, no browser.*, no I/O — UMD like the rest of lib/.
 *
 * Two rules, both learned from how people actually use a queue:
 *
 *   1. THE TAIL IS FINISH. A position within the last few seconds of a known
 *      duration is the end, not a place: resuming there would fail to seek
 *      and would look like a bug. So the tail is treated as position 0.
 *
 *   2. A POSITION WITHOUT A DURATION IS UNKNOWN, NOT ZERO. Someone who
 *      played 30 seconds of a live-ish stream has a position of 30; someone
 *      who never played has 0. They are different facts, and the panel words
 *      them differently.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyPlaylistPosition = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* How close to the end counts as "watched it". Generous enough that the
     credits are included, small enough that a real rewatch starts over. */
  const TAIL_SECONDS = 10;

  const MODE_ALWAYS = "always";
  const MODE_ASK = "ask";
  const MODE_NEVER = "never";

  /**
   * The position a player should start at, or 0. `mode` is the resume setting;
   * `item.duration` is 0 when the metadata never loaded.
   */
  function startPosition(item, mode) {
    if (!item || typeof item !== "object") return 0;
    if (item.kind === "page") return 0;
    if (mode === MODE_NEVER) return 0;
    const stored = Number(item.position);
    if (!Number.isFinite(stored) || stored <= 0) return 0;
    if (isFinished(item, stored)) return 0;
    return stored;
  }

  /** Whether a position is close enough to the end to count as finished. */
  function isFinished(item, position) {
    if (!item) return false;
    const duration = Number(item.duration);
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const at = Number.isFinite(position) ? position : Number(item.position);
    if (!Number.isFinite(at) || at <= 0) return false;
    return at >= duration - TAIL_SECONDS;
  }

  /**
   * What the row should say about resuming. Three states, three sentences —
   * a row that says "resume" when there is no remembered position is lying.
   */
  function resumeLabel(item, mode) {
    if (!item) return "not played yet";
    if (mode === MODE_NEVER) return "starts from the beginning";
    const stored = Number(item.position);
    if (!Number.isFinite(stored) || stored <= 0) return "not played yet";
    if (isFinished(item, stored)) return "play again from the start";
    return `resume at ${formatTime(stored)}`;
  }

  /** Whether the panel should ask before resuming (the 'ask' mode). */
  function needsPrompt(item, mode) {
    if (mode !== MODE_ASK) return false;
    if (!item) return false;
    const stored = Number(item.position);
    if (!Number.isFinite(stored) || stored <= 0) return false;
    return !isFinished(item, stored);
  }

  /** mm:ss, or h:mm:ss past an hour. Never negative, never NaN. */
  function formatTime(totalSeconds) {
    const n = Number(totalSeconds);
    if (!Number.isFinite(n) || n < 0) return "0:00";
    const whole = Math.floor(n);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const seconds = whole % 60;
    const pad = String(seconds).padStart(2, "0");
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${pad}`;
    return `${minutes}:${pad}`;
  }

  /** Parses mm:ss / h:mm:ss back to seconds, for the settings and tests. */
  function parseTime(text) {
    const match = /^(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(String(text || "").trim());
    if (!match) return null;
    const a = Number(match[1]);
    const b = match[2] === undefined ? null : Number(match[2]);
    const c = match[3] === undefined ? null : Number(match[3]);
    if (b === null) return a;
    if (c === null) return a * 60 + b;
    return a * 3600 + b * 60 + c;
  }

  return {
    TAIL_SECONDS,
    MODE_ALWAYS,
    MODE_ASK,
    MODE_NEVER,
    startPosition,
    isFinished,
    resumeLabel,
    needsPrompt,
    formatTime,
    parseTime,
  };
});
