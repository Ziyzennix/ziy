/* Ziy Playlist — user settings.
 *
 * The shape of the reference's Playlist settings, mapped onto ours, plus the
 * three choices that are ours to make honestly:
 *
 *   defaultSpeed        playback rate the player starts at (the reference's speed row)
 *   sleepTimerMinutes   the sleep timer's default duration (0 = off)
 *   resumeMode          'always' | 'ask' | 'never' — how a remembered position is used
 *   panelSide           'right' | 'left' — which side the panel should sit on
 *   autoAddPrompt       per-site prompt on/off; the base value is the default
 *   mediaQuality        'auto' | 'low' | 'high' — a PREFERENCE NOTE only (see below)
 *
 * MEDIA QUALITY IS A NOTE, NOT A SWITCH, AND THAT IS DELIBERATE.
 * Choosing a variant is the HLS loader's job, and this engine's loader
 * resolves ONE variant (the highest the manifest's EXT-X-STREAM-INF
 * bandwidth ordering offers) because there is no adaptive bitrate controller
 * here. So the setting records the preference and the panel says what it
 * actually did. A selector that promised "low quality" and then played the
 * same stream would be a fake control, and this product does not ship those.
 *
 * Settings live in storage.local (small, always-needed, launch-critical —
 * architecture §3.1), and are validated on read, so a corrupted or
 * out-of-range value falls back to a working default instead of disabling
 * the extension.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyPlaylistSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KEY = "playlist.settings";

  const SPEED_CHOICES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);

  const SLEEP_CHOICES = Object.freeze([0, 5, 10, 15, 30, 45, 60, 90]);

  const RESUME_MODES = Object.freeze(["always", "ask", "never"]);

  const QUALITY_MODES = Object.freeze(["auto", "high", "low"]);

  const DEFAULTS = Object.freeze({
    defaultSpeed: 1,
    sleepTimerMinutes: 0,
    resumeMode: "always",
    panelSide: "right",
    autoAddPrompt: true,
    mediaQuality: "auto",
  });

  /* Every setting the model owns, with its factory value and its validator.
     A validator returns null for "fine", or a message a person can act on. */
  const FIELDS = Object.freeze([
    {
      key: "defaultSpeed",
      default: 1,
      validate: (v) => {
        if (typeof v !== "number" || !isFinite(v)) return "Speed must be a number.";
        if (v < 0.25 || v > 4) return "Pick a speed between 0.25 and 4.";
        return null;
      },
      hint: "The rate every item starts at. Your pick applies to the item playing now.",
    },
    {
      key: "sleepTimerMinutes",
      default: 0,
      validate: (v) => {
        if (typeof v !== "number" || !isFinite(v) || v < 0) return "Pick a whole number of minutes.";
        if (v > 0 && !SLEEP_CHOICES.includes(v)) return "Pick one of the offered timer lengths.";
        return null;
      },
      hint: "Zero means no timer. Playback pauses when the timer runs out.",
    },
    {
      key: "resumeMode",
      default: "always",
      validate: (v) => (RESUME_MODES.includes(v) ? null : "Choose always, ask, or never."),
      hint: "Whether a half-watched item picks up where it stopped.",
    },
    {
      key: "panelSide",
      default: "right",
      validate: (v) => (v === "right" || v === "left" ? null : "Choose left or right."),
      hint: "Which side of the window the panel should sit on. The browser keeps the final word.",
    },
    {
      key: "autoAddPrompt",
      default: true,
      validate: (v) => (typeof v === "boolean" ? null : "Must be yes or no."),
      hint: "Show the add prompt on pages that are playing media. You can also dismiss it per site.",
    },
    {
      key: "mediaQuality",
      default: "auto",
      validate: (v) => (QUALITY_MODES.includes(v) ? null : "Choose auto, high, or low."),
      hint: "Your preference for streams with several variants. This engine plays the variant the manifest offers first, so the note records what you asked for.",
    },
  ]);

  function factorySettings() {
    const out = {};
    for (const f of FIELDS) out[f.key] = f.default;
    return out;
  }

  /**
   * A stored record becomes a working record: unknown fields dropped, wrong
   * shapes replaced by the default rather than half-accepted. This is what
   * makes a settings row that survives a schema change still be valid.
   */
  function normaliseSettings(stored) {
    const out = factorySettings();
    if (!stored || typeof stored !== "object") return out;
    for (const f of FIELDS) {
      const value = stored[f.key];
      if (value === undefined) continue;
      if (f.validate(value) === null) out[f.key] = value;
    }
    return out;
  }

  /**
   * Applies a partial patch, validating each field. A field whose value fails
   * its validator keeps the CURRENT value rather than falling back to the
   * factory default: a typo in one row must not reset the other five.
   */
  function patch(current, changes) {
    const base = normaliseSettings(current);
    const merged = Object.assign({}, base);
    for (const key of Object.keys(changes || {})) {
      const field = FIELDS.find((f) => f.key === key);
      if (!field) continue;
      if (field.validate(changes[key]) === null) merged[key] = changes[key];
    }
    return normaliseSettings(merged);
  }

  /** The persisted record is exactly the normalised record. */
  function serialiseSettings(settings) {
    return normaliseSettings(settings);
  }

  /**
   * Per-site dismissal of the add prompt. Stored as a second key so a
   * settings change never rewrites the dismissal list and vice versa.
   */
  const KEY_SITES = "playlist.sites";

  function normaliseSites(stored) {
    let value = stored;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch (_e) {
        return {};
      }
    }
    const out = {};
    if (!value || typeof value !== "object") return out;
    for (const key of Object.keys(value)) {
      if (value[key] === true && /^https?:\/\//i.test(key)) out[key] = true;
    }
    // Bounded: a list that grows forever is a slow bug.
    const keys = Object.keys(out).sort();
    if (keys.length <= 200) return out;
    const capped = {};
    for (const key of keys.slice(0, 200)) capped[key] = true;
    return capped;
  }

  function isSiteDismissed(sites, origin) {
    if (!origin) return false;
    return normaliseSites(sites)[origin] === true;
  }

  function dismissSite(sites, origin) {
    const current = normaliseSites(sites);
    if (!origin) return current;
    return normaliseSites(Object.assign({}, current, { [origin]: true }));
  }

  function undismissSite(sites, origin) {
    const current = normaliseSites(sites);
    if (!origin) return current;
    const next = Object.assign({}, current);
    delete next[origin];
    return next;
  }

  return {
    KEY,
    KEY_SITES,
    DEFAULTS,
    FIELDS,
    SPEED_CHOICES,
    SLEEP_CHOICES,
    RESUME_MODES,
    QUALITY_MODES,
    factorySettings,
    normaliseSettings,
    patch,
    serialiseSettings,
    normaliseSites,
    isSiteDismissed,
    dismissSite,
    undismissSite,
  };
});
