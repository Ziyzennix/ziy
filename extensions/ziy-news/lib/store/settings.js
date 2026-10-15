/* Ziy news — user settings.
 *
 * The shape of the reference's options, mapped onto ours:
 *   openLinksInNewTab   "open links where: new tab / current tab"
 *   refreshMinutes      how often the event page wakes to fetch (30 default)
 *   windowHours         the age filter: 24h or 7d
 *   maxItems            rows in the panel and in the NTP snapshot
 *
 * Settings live in storage.local (small, always-needed, launch-critical —
 * architecture §3.1). Values are validated on read, so a corrupted or
 * out-of-range value falls back to a working default instead of disabling
 * the extension.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ZiyNewsSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KEY = "news.settings";

  const DEFAULTS = Object.freeze({
    schemaVersion: 1,
    openLinksInNewTab: false,
    refreshMinutes: 30,
    windowHours: 24,
    maxItems: 40,
    /* When on, a row's image comes from the feed; when off, the panel is
     * text-only, which is the low-bandwidth choice. */
    showImages: true,
  });

  const BOUNDS = Object.freeze({
    refreshMinutes: Object.freeze({ min: 5, max: 180, allowed: Object.freeze([15, 30, 60, 120, 180]) }),
    windowHours: Object.freeze({ min: 24, max: 168, allowed: Object.freeze([24, 72, 168]) }),
    maxItems: Object.freeze({ min: 5, max: 100 }),
  });

  const WINDOWS = Object.freeze([
    Object.freeze({ hours: 24, label: "Last 24 hours" }),
    Object.freeze({ hours: 72, label: "Last 3 days" }),
    Object.freeze({ hours: 168, label: "Last 7 days" }),
  ]);

  const REFRESH_CHOICES = Object.freeze([
    Object.freeze({ minutes: 15, label: "Every 15 minutes" }),
    Object.freeze({ minutes: 30, label: "Every 30 minutes" }),
    Object.freeze({ minutes: 60, label: "Every hour" }),
    Object.freeze({ minutes: 120, label: "Every 2 hours" }),
    Object.freeze({ minutes: 180, label: "Every 3 hours" }),
  ]);

  /** Merges a stored patch over the defaults, dropping nonsense. */
  function normalise(stored) {
    const out = {
      schemaVersion: DEFAULTS.schemaVersion,
      openLinksInNewTab: DEFAULTS.openLinksInNewTab,
      refreshMinutes: DEFAULTS.refreshMinutes,
      windowHours: DEFAULTS.windowHours,
      maxItems: DEFAULTS.maxItems,
      showImages: DEFAULTS.showImages,
    };
    if (!stored || typeof stored !== "object") return out;
    if (typeof stored.openLinksInNewTab === "boolean") {
      out.openLinksInNewTab = stored.openLinksInNewTab;
    }
    if (typeof stored.showImages === "boolean") out.showImages = stored.showImages;
    out.refreshMinutes = pickAllowed(stored.refreshMinutes, BOUNDS.refreshMinutes, DEFAULTS.refreshMinutes);
    out.windowHours = pickAllowed(stored.windowHours, BOUNDS.windowHours, DEFAULTS.windowHours);
    out.maxItems = clampInt(stored.maxItems, BOUNDS.maxItems, DEFAULTS.maxItems);
    return out;
  }

  function pickAllowed(value, bounds, fallback) {
    const n = Number(value);
    if (isFinite(n) && bounds.allowed.indexOf(n) >= 0) return n;
    if (isFinite(n) && n >= bounds.min && n <= bounds.max) return n;
    return fallback;
  }

  function clampInt(value, bounds, fallback) {
    const n = parseInt(value, 10);
    if (!isFinite(n)) return fallback;
    return Math.min(bounds.max, Math.max(bounds.min, n));
  }

  /** Applies a partial patch, validating each field the same way. */
  function patch(current, changes) {
    const merged = Object.assign({}, current || DEFAULTS);
    if (!changes || typeof changes !== "object") return merged;
    if (typeof changes.openLinksInNewTab === "boolean") {
      merged.openLinksInNewTab = changes.openLinksInNewTab;
    }
    if (typeof changes.showImages === "boolean") merged.showImages = changes.showImages;
    if ("refreshMinutes" in changes) {
      merged.refreshMinutes = pickAllowed(changes.refreshMinutes, BOUNDS.refreshMinutes, merged.refreshMinutes);
    }
    if ("windowHours" in changes) {
      merged.windowHours = pickAllowed(changes.windowHours, BOUNDS.windowHours, merged.windowHours);
    }
    if ("maxItems" in changes) {
      merged.maxItems = clampInt(changes.maxItems, BOUNDS.maxItems, merged.maxItems);
    }
    return merged;
  }

  return {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    BOUNDS: BOUNDS,
    WINDOWS: WINDOWS,
    REFRESH_CHOICES: REFRESH_CHOICES,
    normalise: normalise,
    patch: patch,
  };
});
