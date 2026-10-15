/* Ziy news — the feed that the panel and the NTP both read.
 *
 * This is the pure layer between storage and UI: it takes the stored items,
 * the read map, the sources and the settings, and produces the ordered,
 * filtered view. No WebExtension API, no IndexedDB, no fetch — so the same
 * code that renders the sidebar is what the NTP snapshot contract serves,
 * and both are testable without a browser.
 *
 * The `feed.snapshot` message returns exactly this object, which is why the
 * NTP integration is a three-line change: one widget flag, one call, one
 * render into a container the NTP owns.
 */
(function (root, factory) {
  "use strict";
  const api = factory(root.ZiyNewsItem);
  if (typeof module === "object" && module.exports) {
    module.exports = factory(typeof require === "function"
      ? require("../feed/item.js") : root.ZiyNewsItem);
    return;
  }
  root.ZiyNewsFeed = factory(root.ZiyNewsItem);
})(typeof globalThis !== "undefined" ? globalThis : this, function (item) {
  "use strict";

  /* The snapshot contract version. Bumped when the SHAPE of a snapshot
   * record changes; the NTP checks it and renders what it understands. */
  const SNAPSHOT_VERSION = 1;

  /**
   * Builds the combined feed.
   *
   * @param items      stored items, any order
   * @param readMap    { [dedupeKey]: true }
   * @param sources    the source list (for category and enabled state)
   * @param settings   user settings (window, maxItems)
   * @param now        epoch ms, the clock. Injected so the filter is testable.
   * @param filter     { category?, sourceId?, unreadOnly?, query? }
   */
  function buildFeed(items, readMap, sources, settings, now, filter) {
    const at = Number(now);
    const opts = filter || {};
    const windowHours = settings && settings.windowHours ? settings.windowHours : 24;
    const since = at - windowHours * 60 * 60 * 1000;
    const sourceById = new Map();
    for (const source of sources || []) sourceById.set(source.id, source);
    const enabledIds = new Set((sources || [])
      .filter(function (s) { return s && s.enabled !== false; })
      .map(function (s) { return s.id; }));

    const query = String(opts.query || "").trim().toLowerCase();
    let rows = [];
    for (const entry of items || []) {
      if (!entry || typeof entry !== "object") continue;
      /* An item whose source was removed or turned off is not part of the
       * feed, even though it may still be in the database for a moment. */
      if (!enabledIds.has(entry.sourceId)) continue;

      const published = entry.published || 0;
      /* A missing date is a real state, not a reason to drop the row: it
       * stays visible with an "unknown" timestamp rather than hiding a
       * story the user's 24-hour window would have caught. */
      if (entry.published != null && published < since) continue;

      const source = sourceById.get(entry.sourceId) || null;
      if (opts.category && (!source || source.category !== opts.category)) continue;
      if (opts.sourceId && entry.sourceId !== opts.sourceId) continue;

      const key = item.dedupeKey(entry);
      const isRead = key ? !!readMap[key] : false;
      if (opts.unreadOnly && isRead) continue;
      if (query && !matchesQuery(entry, source, query)) continue;

      rows.push(objectAssign(shallow(entry), {
        key: key,
        read: isRead,
        sourceTitle: source ? source.title : "",
        sourceCategory: source ? source.category : "Uncategorised",
        sourceKind: source ? source.kind : "user",
      }));
    }

    rows.sort(item.byNewestFirst);
    const maxItems = settings && settings.maxItems ? settings.maxItems : 40;
    return {
      rows: rows.slice(0, maxItems),
      total: rows.length,
    };
  }

  function matchesQuery(entry, source, query) {
    const haystack = [
      entry.title || "",
      entry.snippet || "",
      entry.author || "",
      source ? source.title : "",
      source ? source.category : "",
    ].join(" ").toLowerCase();
    return haystack.indexOf(query) >= 0;
  }

  /* --------------------------------------------------------------------- */
  /* The message payload.                                                  */
  /* --------------------------------------------------------------------- */

  /**
   * The snapshot the NTP renders. It is deliberately a small, stable
   * projection: the NTP must never have to understand the item shape.
   *
   *   { version, generatedAt, windowHours, total, unread, rows: [{
   *     id, title, snippet, url, sourceTitle, sourceCategory, sourceKind,
   *     image, published, publishedLabel, read, audio, attachments
   *   }]}
   */
  function snapshot(items, readMap, sources, settings, now, request) {
    const req = request || {};
    const n = Math.max(1, Math.min(50, parseInt(req.n, 10) || 10));
    const feed = buildFeed(items, readMap, sources, settings, now, {
      category: req.category || null,
      unreadOnly: req.unreadOnly === true,
    });
    const rows = feed.rows.slice(0, n).map(function (row) {
      return {
        id: row.key || null,
        title: row.title || "",
        snippet: row.snippet || "",
        url: row.link || "",
        sourceTitle: row.sourceTitle,
        sourceCategory: row.sourceCategory,
        sourceKind: row.sourceKind,
        image: row.images && row.images.length ? row.images[0] : null,
        published: row.published || null,
        publishedLabel: relativeLabel(row.published, Number(now)),
        read: row.read,
        audio: firstAudio(row.attachments),
      };
    });
    return {
      version: SNAPSHOT_VERSION,
      generatedAt: Number(now),
      windowHours: settings && settings.windowHours ? settings.windowHours : 24,
      total: feed.total,
      unread: feed.rows.filter(function (row) { return !row.read; }).length,
      rows: rows,
    };
  }

  function firstAudio(attachments) {
    if (!Array.isArray(attachments)) return null;
    for (const a of attachments) if (a && a.kind === "audio") return a;
    return null;
  }

  /* --------------------------------------------------------------------- */
  /* Labels.                                                               */
  /* --------------------------------------------------------------------- */

  /**
   * A relative timestamp in Ziy's own words. `now` is injected so a test can
   * pin it, because a label that depends on the real clock is untestable.
   */
  function relativeLabel(published, now) {
    if (!published) return "date unknown";
    const delta = Math.max(0, Number(now) - published);
    const minutes = Math.floor(delta / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return plural(minutes, "minute") + " ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return plural(hours, "hour") + " ago";
    const days = Math.floor(hours / 24);
    if (days < 7) return plural(days, "day") + " ago";
    return plainDate(published);
  }

  function plural(count, word) {
    return count === 1 ? "1 " + word : count + " " + word + "s";
  }

  function plainDate(published) {
    try {
      const d = new Date(published);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return d.getUTCDate() + " " + months[d.getUTCMonth()];
    } catch (_e) {
      return "date unknown";
    }
  }

  /* --------------------------------------------------------------------- */
  /* Grouping, for the panel's channel filter.                             */
  /* --------------------------------------------------------------------- */

  function categories(sources) {
    const counts = new Map();
    for (const source of sources || []) {
      if (!source || source.enabled === false) continue;
      const name = source.category || "Uncategorised";
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.keys()).sort(function (a, b) {
      return a.localeCompare(b);
    }).map(function (name) {
      return { id: name, label: name, sources: counts.get(name) };
    });
  }

  function objectAssign(target, patch) {
    return Object.assign(target, patch);
  }

  function shallow(value) {
    const out = {};
    for (const key of Object.keys(value)) out[key] = value[key];
    return out;
  }

  return {
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    buildFeed: buildFeed,
    snapshot: snapshot,
    relativeLabel: relativeLabel,
    categories: categories,
  };
});
